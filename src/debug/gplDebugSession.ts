/**
 * GPL Debug Adapter – Brooks 제어기 DAP 세션.
 *
 * DebugAdapterInlineImplementation과 함께 사용되어 extension 프로세스 내에서 실행된다.
 * Brooks TCP 콘솔 명령(포트 1402)을 통해 디버깅 프로토콜을 구현한다.
 */

import {
    LoggingDebugSession,
    InitializedEvent,
    TerminatedEvent,
    StoppedEvent,
    OutputEvent,
    ThreadEvent,
    Thread,
    StackFrame,
    Scope,
    Source,
    Handles,
    Breakpoint,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import {
    sendCommand,
    getControllerConfig,
    ControllerConfig,
} from '../controller/controllerConnection';
import {
    parseThreadList,
    parseThreadDetail,
    parseStack,
    parseVariable,
    parseBreakList,
    parseGpr,
    isSuccess,
    StackFrameInfo,
} from '../controller/responseParser';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';

// ─── Launch/Attach argument interfaces ───────────────────

interface IAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    controllerIp?: string;
    controllerPort?: number;
    stopOnEntry?: boolean;
    projectName?: string;
}

// ─── Scope handle payload ────────────────────────────────

interface ScopeRef {
    type: 'locals' | 'globals';
    threadName: string;
    frameIndex: number;
}

// ─── Pending action for StoppedEvent reason ──────────────

type PendingAction = 'step' | 'pause' | 'entry' | 'continue' | null;

// ─── Session ─────────────────────────────────────────────

export class GPLDebugSession extends LoggingDebugSession {

    // Thread name ↔ integer ID (DAP requires integer thread IDs)
    private _threadNameToId = new Map<string, number>();
    private _threadIdToName = new Map<number, string>();
    private _nextThreadId = 1;

    // Variable handle management
    private _variableHandles = new Handles<ScopeRef>();

    // Frame ID — globally unique across all threads
    private _frameIdCounter = 0;
    private _frameIdToInfo = new Map<number, { threadName: string; frameIndex: number }>();

    // Controller config
    private _config: ControllerConfig | undefined;

    // Project context — required for breakpoint commands
    private _projectName = '';

    // Workspace source file cache: basename → full path
    private _sourceFileMap = new Map<string, string>();

    // State polling
    private _pollTimer: ReturnType<typeof setInterval> | undefined;
    private _fastPollTimer: ReturnType<typeof setInterval> | undefined;
    private _previousThreadStates = new Map<string, string>();
    private _isConnected = false;
    private _pollIntervalMs = 1000;
    private _pollInFlight = false;

    // Controller console is effectively single-request-at-a-time.
    // Serialize all commands within a debug session to avoid ECONNRESET.
    private _commandQueue: Promise<void> = Promise.resolve();

    // Pending action — determines StoppedEvent reason
    private _pendingAction: PendingAction = null;
    private _pendingThreadId: number | undefined;
    // continue 직후 paused 상태 재관측 횟수(빠른 상태 전이 누락 보정)
    private _pendingContinuePausedSeen = 0;

    // Breakpoint tracking — file basename → set of line numbers
    private _breakpoints = new Map<string, Set<number>>();

    // Exception breakpoints — whether to break on runtime errors
    private _breakOnErrors = true;

    // Known thread names — for detecting new/exited threads (ThreadEvent)
    private _knownThreadNames = new Set<string>();

    // Consecutive poll failures — auto-terminate after threshold
    private _pollFailures = 0;
    private static readonly MAX_POLL_FAILURES = 5;

    // DAP protocol gate — StoppedEvent must not fire before configurationDone
    private _configurationDone = false;
    private _queuedStoppedEvents: { reason: string; threadId: number }[] = [];
    private _stopOnEntry = false;

    constructor() {
        super('gpl-debug.txt');
        // GPL uses 1-based lines and columns
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    // ═══════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        _args: DebugProtocol.InitializeRequestArguments,
    ): void {
        response.body = response.body || {};

        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSetVariable = true;
        response.body.supportsTerminateRequest = false;
        response.body.supportsBreakpointLocationsRequest = false;

        // Capabilities for step granularity (VS Code 기본 step-over/in/out 모두 지원)
        response.body.supportsSteppingGranularity = false;

        // Exception breakpoint filters
        response.body.supportsExceptionInfoRequest = false;
        response.body.exceptionBreakpointFilters = [
            {
                filter: 'runtimeErrors',
                label: 'Runtime Errors',
                description: 'Break when a GPL thread enters Error state',
                default: true,
                supportsCondition: false,
            },
        ];

        this.sendResponse(response);
        // InitializedEvent는 attachRequest 완료 후 전송 — 프로젝트 감지 이후에
        // setBreakPointsRequest가 오도록 보장한다.
    }

    // ═══════════════════════════════════════════════════════
    // Exception Breakpoints
    // ═══════════════════════════════════════════════════════

    protected setExceptionBreakPointsRequest(
        response: DebugProtocol.SetExceptionBreakpointsResponse,
        args: DebugProtocol.SetExceptionBreakpointsArguments,
    ): void {
        this._breakOnErrors = (args.filters || []).includes('runtimeErrors');
        this._log(`예외 브레이크포인트: ${this._breakOnErrors ? '활성' : '비활성'}`);
        response.body = { breakpoints: [] };
        this.sendResponse(response);
    }

    protected async configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments,
    ): Promise<void> {
        super.configurationDoneRequest(response, args);
        this._configurationDone = true;

        // stopOnEntry=false 이면 프로젝트를 시작해야 쓰레드가 생긴다
        if (!this._stopOnEntry && this._projectName && this._isConnected) {
            this._log(`Start ${this._projectName} (auto-start after configurationDone)`);
            await this._sendCmd(`Start ${this._projectName}`);
        }

        // configurationDone 이전에 큐에 쌓인 StoppedEvent 발사
        for (const ev of this._queuedStoppedEvents) {
            this.sendEvent(new StoppedEvent(ev.reason, ev.threadId));
            this._log(`쓰레드 ${ev.threadId} 정지 (${ev.reason}) [지연 발사]`);
        }
        this._queuedStoppedEvents = [];

        this._log('Configuration done — 디버거 준비 완료');
    }

    // ═══════════════════════════════════════════════════════
    // Attach / Disconnect
    // ═══════════════════════════════════════════════════════

    protected async attachRequest(
        response: DebugProtocol.AttachResponse,
        args: IAttachRequestArguments,
    ): Promise<void> {
        const baseCfg = getControllerConfig();
        this._config = {
            ...baseCfg,
            ip: args.controllerIp || baseCfg.ip,
            port: args.controllerPort ?? baseCfg.port,
        };

        // 디버그 세션은 빠른 응답이 필요하므로 폴링 간격을 짧게 설정
        // (사이드바 트리는 5000ms라도 디버거는 500ms가 적절)
        const cfgSection = vscode.workspace.getConfiguration('gpl.controller');
        const userInterval = cfgSection.get<number>('threadPollIntervalMs') ?? 5000;
        this._pollIntervalMs = Math.min(userInterval, 500);

        // Verify controller is reachable
        this._log(`제어기 연결 중: ${this._config.ip}:${this._config.port}`);
        try {
            const resp = await sendCommand('ErrorLog', this._config, 5000);
            if (!resp.includes('<STATUS>')) {
                this.sendErrorResponse(response, {
                    id: 1001,
                    format: 'Controller 연결 실패: STATUS 응답 없음',
                });
                return;
            }
        } catch (err: any) {
            this.sendErrorResponse(response, {
                id: 1002,
                format: `Controller 연결 실패: ${err.message}`,
            });
            return;
        }

        this._isConnected = true;

        // Detect project name: explicit arg → Project.gpr → Show Thread
        this._projectName = args.projectName || '';
        if (!this._projectName) {
            this._projectName = await this._detectProjectName();
        }

        // Build source file map for path resolution
        this._buildSourceFileMap();

        // If stopOnEntry, start the project with -break to pause at Main's first line
        this._stopOnEntry = !!args.stopOnEntry;
        if (this._stopOnEntry && this._projectName) {
            this._pendingAction = 'entry';
            const startResp = await this._sendCmd(`Start ${this._projectName} -break -bex`);
            this._log(`Start ${this._projectName} -break -bex (stopOnEntry)`);
            if (startResp) {
                const cleaned = startResp.replace(/<[^>]+>/g, '').trim();
                if (cleaned) { this._log(`  Start 응답: ${cleaned.split(/\r?\n/)[0]}`); }
            }
        }

        this._log(
            `GPL Controller에 연결됨: ${this._config.ip}:${this._config.port}` +
            (this._projectName ? ` (프로젝트: ${this._projectName})` : '') +
            ` [폴링: ${this._pollIntervalMs}ms]`,
        );

        // Start fast polling to quickly detect entry break, then switch to normal
        this._fastPoll();

        this.sendResponse(response);

        // InitializedEvent를 여기서 전송 — VS Code는 이 이벤트 수신 후
        // setBreakPointsRequest를 보내므로 _projectName이 확실히 설정된 상태에서 처리된다.
        this.sendEvent(new InitializedEvent());
    }

    protected async disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        args: DebugProtocol.DisconnectArguments,
    ): Promise<void> {
        this._stopPolling();

        // Clear all breakpoints on the controller
        if (this._isConnected && this._projectName) {
            for (const [file, lines] of this._breakpoints) {
                for (const line of lines) {
                    await this._sendCmd(`Set Nobreak ${this._projectName} "${file}" ${line}`);
                }
            }
            this._log('모든 브레이크포인트 해제 완료');

            // attach 세션에서는 disconnect 시 기본적으로 프로젝트를 정지한다.
            // Paused 상태로 남겨두면 제어기에 좀비 쓰레드가 남기 때문.
            // terminateDebuggee가 명시적 false일 때만 Stop을 건너뛴다.
            if (args.terminateDebuggee !== false) {
                await this._sendCmd(`Stop ${this._projectName}`);
                this._log(`프로젝트 정지: ${this._projectName}`);
            } else {
                this._log('프로젝트 유지 (terminateDebuggee=false)');
            }
        }

        this._breakpoints.clear();
        this._knownThreadNames.clear();
        this._isConnected = false;
        this._configurationDone = false;
        this._queuedStoppedEvents = [];
        this._pendingAction = null;
        this._pendingContinuePausedSeen = 0;
        this._clearStaleState();
        this._log('디버거 연결 해제');
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Breakpoints
    // ═══════════════════════════════════════════════════════

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments,
    ): Promise<void> {
        const sourcePath = args.source.path || '';
        const baseName = path.basename(sourcePath);
        const clientLines = args.lines || [];

        // Project name is required for Brooks breakpoint commands
        const proj = this._projectName;
        if (!proj) {
            // Without project context, breakpoints cannot be set
            response.body = {
                breakpoints: clientLines.map(l => ({
                    verified: false,
                    line: l,
                    message: '프로젝트를 감지할 수 없습니다. launch.json에 projectName을 지정하세요.',
                }) as DebugProtocol.Breakpoint),
            };
            this.sendResponse(response);
            return;
        }

        // Clear existing breakpoints for this file on the controller
        const existing = this._breakpoints.get(baseName) || new Set<number>();
        for (const line of existing) {
            await this._sendCmd(`Set Nobreak ${proj} "${baseName}" ${line}`);
        }

        // Set new breakpoints using correct Brooks syntax:
        // Set Break project_name "file_name" line_number
        const actualBreakpoints: DebugProtocol.Breakpoint[] = [];
        const newLines = new Set<number>();

        for (const line of clientLines) {
            const cmd = `Set Break ${proj} "${baseName}" ${line}`;
            const resp = await this._sendCmd(cmd);
            const isDuplicate = resp !== null && /Duplicate breakpoint/i.test(resp);
            const verified = resp !== null && (isSuccess(resp) || isDuplicate);
            const bp = new Breakpoint(verified, line) as DebugProtocol.Breakpoint;
            if (!verified) {
                const msg = resp
                    ? resp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0]
                    : '응답 없음';
                bp.message = msg;
                this._log(`⚠ BP 설정 실패: ${cmd} → ${msg}`);
            }
            actualBreakpoints.push(bp);
            if (verified) {
                newLines.add(line);
            }
        }

        this._breakpoints.set(baseName, newLines);

        // Show Break로 실제 제어기 상태 검증
        const showResp = await this._sendCmd('Show Break');
        if (showResp) {
            const controllerBPs = parseBreakList(showResp);
            const matching = controllerBPs.filter(
                b => b.file.toLowerCase() === baseName.toLowerCase(),
            );
            this._log(`브레이크포인트: ${baseName} → 요청 [${clientLines.join(', ')}] / 제어기 확인 [${matching.map(b => `L${b.fileLine}`).join(', ')}]`);
        } else {
            this._log(`브레이크포인트: ${baseName} → [${[...newLines].join(', ')}] (Show Break 검증 불가)`);
        }

        response.body = { breakpoints: actualBreakpoints };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Threads
    // ═══════════════════════════════════════════════════════

    protected async threadsRequest(
        response: DebugProtocol.ThreadsResponse,
    ): Promise<void> {
        const resp = await this._sendCmd('Show Thread');
        if (!resp) {
            response.body = { threads: [] };
            this.sendResponse(response);
            return;
        }

        const threads = parseThreadList(resp);
        const dapThreads: Thread[] = [];
        for (const t of threads) {
            const id = this._getOrCreateThreadId(t.name);
            dapThreads.push(new Thread(id, t.name));
        }

        response.body = { threads: dapThreads };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Stack Trace
    // ═══════════════════════════════════════════════════════

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments,
    ): Promise<void> {
        const threadName = this._threadIdToName.get(args.threadId);
        if (!threadName) {
            response.body = { stackFrames: [], totalFrames: 0 };
            this.sendResponse(response);
            return;
        }

        const frames = await this._getThreadFrames(threadName);
        const startFrame = args.startFrame ?? 0;
        const levels = args.levels ?? frames.length;
        const endFrame = Math.min(startFrame + levels, frames.length);

        const dapFrames: StackFrame[] = [];
        for (let i = startFrame; i < endFrame; i++) {
            const f = frames[i];
            const frameId = this._allocFrameId(threadName, f.frameIndex);

            const source = f.file
                ? new Source(f.file, this._resolveSourcePath(f.file))
                : undefined;

            dapFrames.push(new StackFrame(frameId, f.process || '(unknown)', source, f.fileLine));
        }

        response.body = {
            stackFrames: dapFrames,
            totalFrames: frames.length,
        };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Scopes
    // ═══════════════════════════════════════════════════════

    protected scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments,
    ): void {
        const frameInfo = this._frameIdToInfo.get(args.frameId);
        const threadName = frameInfo?.threadName || this._findBreakThread() || '';
        const frameIndex = frameInfo?.frameIndex ?? 0;

        response.body = {
            scopes: [
                new Scope(
                    'Locals',
                    this._variableHandles.create({ type: 'locals', threadName, frameIndex }),
                    false,
                ),
                new Scope(
                    'Globals',
                    this._variableHandles.create({ type: 'globals', threadName, frameIndex }),
                    true,
                ),
            ],
        };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Variables
    // ═══════════════════════════════════════════════════════

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments,
    ): Promise<void> {
        const scopeInfo = this._variableHandles.get(args.variablesReference);
        const variables: DebugProtocol.Variable[] = [];

        if (!scopeInfo) {
            response.body = { variables };
            this.sendResponse(response);
            return;
        }

        if (scopeInfo.type === 'locals') {
            // 1) Show Stack으로 현재 파일/줄 정보를 얻는다
            const frames = await this._getThreadFrames(scopeInfo.threadName);
            const frame = frames.find(f => f.frameIndex === scopeInfo.frameIndex);

            // 2) 소스 파일을 파싱해서 현재 프로시저의 변수 이름들을 수집한다
            const varNames = frame?.file
                ? this._getLocalVariableNames(frame.file, frame.fileLine, frame.process)
                : [];

            if (varNames.length > 0) {
                // 3) 각 변수를 개별 Show Variable로 조회
                for (const varName of varNames) {
                    const resp = await this._sendCmd(
                        `Show Variable -eval ${scopeInfo.threadName} ${scopeInfo.frameIndex} ${varName}`,
                    );
                    if (resp) {
                        const parsed = this._parseShowVariableEval(resp);
                        const display = parsed.type
                            ? `${parsed.value}  (${parsed.type})`
                            : parsed.value;
                        variables.push({ name: varName, value: display, variablesReference: 0 });
                    }
                }
            } else if (frame?.file) {
                this._log(`로컬 변수 후보를 찾지 못함: ${frame.file}:${frame.fileLine} (${frame.process})`);
            }
        } else if (scopeInfo.type === 'globals') {
            // 소스 파일에서 모듈 레벨 Public 변수를 열거하고 개별 Show Global로 조회
            const globalNames = this._getGlobalVariableNames();

            if (globalNames.length > 0) {
                for (const gName of globalNames) {
                    const resp = await this._sendCmd(
                        this._projectName
                            ? `Show Global ${gName}, ${this._projectName}`
                            : `Show Global ${gName}`,
                    );
                    if (resp) {
                        const cleaned = resp.replace(/<[^>]+>/g, '').trim();
                        const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
                        if (lines.length > 0) {
                            variables.push({
                                name: gName,
                                value: lines.join(', '),
                                variablesReference: 0,
                            });
                        }
                    }
                }
            }
        }

        response.body = { variables };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Set Variable (Set Global)
    // ═══════════════════════════════════════════════════════

    protected async setVariableRequest(
        response: DebugProtocol.SetVariableResponse,
        args: DebugProtocol.SetVariableArguments,
    ): Promise<void> {
        const scopeInfo = this._variableHandles.get(args.variablesReference);
        if (!scopeInfo) {
            this.sendErrorResponse(response, { id: 2001, format: 'Invalid scope' });
            return;
        }

        // Use Execute to set variable: Execute <expression>, <project>
        const proj = this._projectName;
        const setExpr = `${args.name} = ${args.value}`;
        const cmd = proj
            ? `Execute ${setExpr}, ${proj}`
            : `Execute ${setExpr}`;
        const resp = await this._sendCmd(cmd);

        response.body = { value: args.value };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Continue / Step / Pause
    // ═══════════════════════════════════════════════════════

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        args: DebugProtocol.ContinueArguments,
    ): Promise<void> {
        const threadName = this._threadIdToName.get(args.threadId);
        if (threadName) {
            // Clear stale handles from previous stop
            this._clearStaleState();
            this._pendingAction = 'continue';
            this._pendingThreadId = args.threadId;
            this._pendingContinuePausedSeen = 0;

            // If thread is in Error state, use -noerror to skip the failed step
            const state = this._previousThreadStates.get(threadName);
            if (state === 'Error') {
                await this._sendCmd(`Continue ${threadName} -noerror`);
                this._log(`Continue ${threadName} -noerror (다음 중단점 또는 종료까지)`);
            } else {
                await this._sendCmd(`Continue ${threadName}`);
                this._log(`Continue ${threadName} (다음 중단점 또는 종료까지)`);
            }

            // Continue 직후 빠른 재정지를 놓치지 않도록 fast poll 사용
            this._fastPoll();
        }
        response.body = { allThreadsContinued: false };
        this.sendResponse(response);
    }

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments,
    ): Promise<void> {
        const threadName = this._threadIdToName.get(args.threadId);
        if (threadName) {
            this._clearStaleState();
            this._pendingAction = 'step';
            this._pendingThreadId = args.threadId;
            await this._sendCmd(`Step ${threadName} -over`);
            this._log(`Step ${threadName} -over`);
            // Trigger fast polling to detect step completion quickly
            this._fastPoll();
        }
        this.sendResponse(response);
    }

    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments,
    ): Promise<void> {
        const threadName = this._threadIdToName.get(args.threadId);
        if (threadName) {
            this._clearStaleState();
            this._pendingAction = 'step';
            this._pendingThreadId = args.threadId;
            await this._sendCmd(`Step ${threadName} -into`);
            this._log(`Step ${threadName} -into`);
            this._fastPoll();
        }
        this.sendResponse(response);
    }

    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments,
    ): Promise<void> {
        const threadName = this._threadIdToName.get(args.threadId);
        if (threadName) {
            this._clearStaleState();
            this._pendingAction = 'step';
            this._pendingThreadId = args.threadId;
            await this._sendCmd(`Step ${threadName} -out`);
            this._log(`Step ${threadName} -out`);
            this._fastPoll();
        }
        this.sendResponse(response);
    }

    protected async pauseRequest(
        response: DebugProtocol.PauseResponse,
        args: DebugProtocol.PauseArguments,
    ): Promise<void> {
        const threadName = this._threadIdToName.get(args.threadId);
        if (threadName) {
            this._pendingAction = 'pause';
            this._pendingThreadId = args.threadId;
            await this._sendCmd(`Break ${threadName}`);
            this._log(`Break ${threadName} (pause)`);
            this._fastPoll();
        }
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Evaluate (hover / watch / REPL)
    // ═══════════════════════════════════════════════════════

    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments,
    ): Promise<void> {
        const expression = args.expression.trim();
        if (!expression) {
            response.body = { result: '', variablesReference: 0 };
            this.sendResponse(response);
            return;
        }

        let result = '';

        // Determine thread context from frame or find first break thread
        let threadName: string | undefined;
        let frameIndex = 0;
        if (args.frameId !== undefined) {
            const fi = this._frameIdToInfo.get(args.frameId);
            threadName = fi?.threadName;
            frameIndex = fi?.frameIndex ?? 0;
        }
        threadName = threadName || this._findBreakThread();

        if (!threadName) {
            response.body = { result: '(일시정지된 쓰레드 없음)', variablesReference: 0 };
            this.sendResponse(response);
            return;
        }

        if (args.context === 'repl') {
            // REPL: 식 평가를 우선 시도, 실패 시 전역 → 직접 실행 순서로 폴백
            const varResp = await this._sendCmd(
                `Show Variable -eval ${threadName} ${frameIndex} ${expression}`,
            );
            if (varResp) {
                const parsed = this._parseShowVariableEval(varResp);
                if (parsed.value) {
                    result = parsed.type
                        ? `${parsed.value}  (${parsed.type})`
                        : parsed.value;
                }
            }
            if (!result && this._projectName) {
                const gResp = await this._sendCmd(
                    `Show Global ${expression}, ${this._projectName}`,
                );
                if (gResp) {
                    const cleaned = gResp.replace(/<[^>]+>/g, '').trim();
                    const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
                    if (lines.length > 0) { result = lines.join('\n'); }
                }
            }
            if (!result) { result = '(평가 불가)'; }
        } else if (args.context === 'hover' || args.context === 'watch') {
            // Show Variable -eval thread frame variable → "name, type, value" 형식
            const resp = await this._sendCmd(
                `Show Variable -eval ${threadName} ${frameIndex} ${expression}`,
            );
            if (resp) {
                const parsed = this._parseShowVariableEval(resp);
                result = parsed.value || '';
            }
            if (!result) {
                // Fallback: might be a global variable
                const gResp = await this._sendCmd(
                    `Show Global ${expression}, ${this._projectName}`,
                );
                if (gResp) {
                    const cleaned = gResp.replace(/<[^>]+>/g, '').trim();
                    const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
                    result = lines.length > 0 ? lines.join('\n') : '';
                }
            }
        } else {
            result = expression;
        }

        response.body = { result: result || `(${expression} 평가 불가)`, variablesReference: 0 };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Internal helpers
    // ═══════════════════════════════════════════════════════

    private _getOrCreateThreadId(name: string): number {
        let id = this._threadNameToId.get(name);
        if (id === undefined) {
            id = this._nextThreadId++;
            this._threadNameToId.set(name, id);
            this._threadIdToName.set(id, name);
        }
        return id;
    }

    private _allocFrameId(threadName: string, frameIndex: number): number {
        const id = ++this._frameIdCounter;
        this._frameIdToInfo.set(id, { threadName, frameIndex });
        return id;
    }

    /**
     * Find the first thread currently in Break/Paused/Error state (from last poll).
     */
    private _findBreakThread(): string | undefined {
        for (const [name, state] of this._previousThreadStates) {
            if (state === 'Break' || state === 'Paused' || state === 'Error') {
                return name;
            }
        }
        return undefined;
    }

    /**
     * Clear stale frame/handle state between stop events.
     * Called before step/continue to prevent old frame IDs from leaking.
     */
    private _clearStaleState(): void {
        this._variableHandles.reset();
        this._frameIdToInfo.clear();
        this._frameIdCounter = 0;
    }

    /**
     * Resolve a controller filename (basename) to a workspace file path.
     * Uses the pre-built source file map for fast lookup.
     */
    private _resolveSourcePath(filename: string): string {
        const lower = filename.toLowerCase();
        const cached = this._sourceFileMap.get(lower);
        if (cached) { return cached; }
        return filename;
    }

    /**
     * filePath가 dirPath 하위 경로인지 검사.
     */
    private _isPathUnder(filePath: string, dirPath: string): boolean {
        try {
            const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
            return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        } catch {
            return false;
        }
    }

    /**
     * Detect project name from workspace Project.gpr or Show Thread response.
     */
    private async _detectProjectName(): Promise<string> {
        const candidates: Array<{
            projectName: string;
            gprPath: string;
            sourceNames: Set<string>;
        }> = [];

        // 1) Collect workspace Project.gpr files
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
            for (const folder of folders) {
                const gprFiles = await this._findFiles(folder.uri.fsPath, 'Project.gpr');
                for (const gprPath of gprFiles) {
                    try {
                        const content = fs.readFileSync(gprPath, 'utf-8');
                        const info = parseGpr(content);
                        if (info.projectName) {
                            candidates.push({
                                projectName: info.projectName,
                                gprPath,
                                sourceNames: new Set(
                                    info.sources.map(s => path.basename(s).toLowerCase()),
                                ),
                            });
                        }
                    } catch { /* skip */ }
                }
            }
        }

        if (candidates.length === 1) {
            this._log(`프로젝트 감지: ${candidates[0].projectName} (from ${candidates[0].gprPath})`);
            return candidates[0].projectName;
        }

        // 2) 다중 프로젝트일 때는 활성 편집 파일 기준으로 선택
        if (candidates.length > 1) {
            const activeDoc = vscode.window.activeTextEditor?.document;
            const activePath = activeDoc?.uri.scheme === 'file'
                ? activeDoc.uri.fsPath
                : '';

            if (activePath) {
                const activeBase = path.basename(activePath).toLowerCase();
                const dirMatches = candidates.filter(c =>
                    this._isPathUnder(activePath, path.dirname(c.gprPath)),
                );
                const sourceMatches = candidates.filter(c => c.sourceNames.has(activeBase));

                const bothMatch = sourceMatches.find(s =>
                    dirMatches.some(d => d.gprPath === s.gprPath),
                );

                const preferred = bothMatch
                    || sourceMatches[0]
                    || dirMatches.sort(
                        (a, b) => path.dirname(b.gprPath).length - path.dirname(a.gprPath).length,
                    )[0];

                if (preferred) {
                    this._log(
                        `프로젝트 감지: ${preferred.projectName} (active file: ${path.basename(activePath)})`,
                    );
                    return preferred.projectName;
                }
            }

            // 활성 파일로도 판별이 안 되면 기존 동작처럼 기본값(첫 후보) 사용
            const sorted = [...candidates].sort((a, b) => a.gprPath.localeCompare(b.gprPath));
            this._log(
                `프로젝트 자동감지: 다중 Project.gpr(${sorted.length}개) — 기본 ${sorted[0].projectName}`,
            );
            return sorted[0].projectName;
        }

        // 3) Fallback: detect from Show Thread (running thread's project)
        const resp = await this._sendCmd('Show Thread');
        if (resp) {
            const threads = parseThreadList(resp);
            for (const t of threads) {
                if (t.project) {
                    this._log(`프로젝트 감지: ${t.project} (from running thread)`);
                    return t.project;
                }
            }
        }

        return '';
    }

    /**
     * `Show Variable -eval` 응답 파싱.
     * 제어기 응답 형식: `name, type, value` (예: `i, Integer, 0`)
     * value에 쉼표가 포함될 수 있으므로 세 번째 필드 이후를 모두 value로 취급한다.
     */
    private _parseShowVariableEval(raw: string): { name: string; type: string; value: string } {
        const cleaned = raw.replace(/<[^>]+>/g, '').trim();
        const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length === 0) {
            return { name: '', type: '', value: '(undefined)' };
        }
        // 첫 번째 유효 줄에서 파싱
        const line = lines[0].trim();
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 3) {
            return {
                name: parts[0],
                type: parts[1],
                value: parts.slice(2).join(', '),
            };
        }
        if (parts.length === 2) {
            return { name: parts[0], type: '', value: parts[1] };
        }
        // 쉼표 없는 단순 값
        return { name: '', type: '', value: line };
    }

    private async _getThreadFrames(threadName: string): Promise<StackFrameInfo[]> {
        const resp = await this._sendCmd(`Show Stack ${threadName}`);
        const frames = resp ? parseStack(resp) : [];
        if (frames.length > 0) {
            return frames;
        }

        const detailResp = await this._sendCmd(`Show Thread ${threadName}`);
        const detail = detailResp ? parseThreadDetail(detailResp) : null;
        if (detail?.file && detail.fileLine > 0) {
            this._log(`Show Stack ${threadName} → 0 frames, Show Thread fallback 사용 (${detail.file}:${detail.fileLine})`);
            return [{
                frameIndex: 0,
                project: detail.project,
                process: detail.process || threadName,
                procLine: detail.procLine,
                file: detail.file,
                fileLine: detail.fileLine,
                size: 0,
            }];
        }

        return [];
    }

    /**
     * Build a map of basename(lowercase) → full path for all .gpl/.gpo files in workspace.
     */
    private _buildSourceFileMap(): void {
        this._sourceFileMap.clear();
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) { return; }

        for (const folder of folders) {
            this._scanDir(folder.uri.fsPath);
        }
        this._log(`소스 파일 맵: ${this._sourceFileMap.size}개 파일 인덱싱 완료`);
    }

    private _scanDir(dir: string): void {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Skip common non-source directories
                    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') { continue; }
                    this._scanDir(full);
                } else if (/\.gpl$/i.test(entry.name) || /\.gpo$/i.test(entry.name)) {
                    this._sourceFileMap.set(entry.name.toLowerCase(), full);
                }
            }
        } catch { /* permission errors etc */ }
    }

    /**
     * Find files matching a name recursively under a directory.
     */
    private _findFiles(dir: string, targetName: string): string[] {
        const results: string[] = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') { continue; }
                    results.push(...this._findFiles(full, targetName));
                } else if (entry.name.toLowerCase() === targetName.toLowerCase()) {
                    results.push(full);
                }
            }
        } catch { /* skip */ }
        return results;
    }

    /**
     * GPL 소스를 파싱하여 특정 프로시저 내 로컬 변수/파라미터 이름을 수집한다.
     * @param fileName 제어기가 반환한 파일 basename (e.g. "Entry_Main.gpl")
     * @param _line 현재 실행 줄 (향후 scope 정밀화에 사용 가능)
     * @param process 스택 프레임의 프로시저 이름 (e.g. "Module.Method" 또는 "Method")
     */
    private _getLocalVariableNames(fileName: string, line: number, process: string): string[] {
        const filePath = this._resolveSourcePath(fileName);
        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return [];
        }

        const symbols = GPLParser.parseDocument(content, filePath, {
            includeLocals: true,
            includeParameters: true,
        });

        // process = "Module.Method" → method name만 추출
        const methodName = process?.includes('.')
            ? process.split('.').pop()!
            : (process || '');
        if (!methodName) { return []; }

        // 프로시저 심볼들에서 매칭되는 프로시저의 줄 범위를 구한다
        const procs = symbols.filter(
            s => s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub,
        );
        let start = -1;
        let end = Infinity;
        for (let i = 0; i < procs.length; i++) {
            if (procs[i].name.toLowerCase() === methodName.toLowerCase()) {
                start = procs[i].line;
                end = (i + 1 < procs.length) ? procs[i + 1].line : Infinity;
                break;
            }
        }

        // process 이름이 심볼 이름과 다를 때는 현재 실행 줄이 속한 프로시저를 찾는다.
        if (start < 0 && line > 0) {
            const lineIndex = line - 1; // controller line is 1-based
            for (let i = 0; i < procs.length; i++) {
                const procStart = procs[i].line;
                const procEnd = (i + 1 < procs.length) ? procs[i + 1].line : Infinity;
                if (procStart <= lineIndex && lineIndex < procEnd) {
                    start = procStart;
                    end = procEnd;
                    break;
                }
            }
        }

        if (start < 0) { return []; }

        // 프로시저 범위 내 isLocal 심볼들을 수집 (중복 제거, 대소문자 무시)
        const seen = new Set<string>();
        const names: string[] = [];
        for (const s of symbols) {
            if (s.isLocal && s.line >= start && s.line < end) {
                const lower = s.name.toLowerCase();
                if (!seen.has(lower)) {
                    seen.add(lower);
                    names.push(s.name);
                }
            }
        }
        return names;
    }

    /**
     * 워크스페이스의 모든 GPL 소스에서 모듈 레벨(비로컬) Public 변수를 열거한다.
     * 디버거 Globals 패널용.
     */
    private _getGlobalVariableNames(): string[] {
        const seen = new Set<string>();
        const names: string[] = [];

        for (const [, filePath] of this._sourceFileMap) {
            let content: string;
            try {
                content = fs.readFileSync(filePath, 'utf-8');
            } catch { continue; }

            const symbols = GPLParser.parseDocument(content, filePath, {
                includeLocals: false,
                includeParameters: false,
            });

            for (const s of symbols) {
                if ((s.kind === GPLSymbolKind.Variable || s.kind === GPLSymbolKind.Constant)
                    && !s.isLocal
                    && s.accessModifier === 'public') {
                    // Qualified name: Module.VarName
                    const qName = s.module ? `${s.module}.${s.name}` : s.name;
                    const lower = qName.toLowerCase();
                    if (!seen.has(lower)) {
                        seen.add(lower);
                        names.push(qName);
                    }
                }
            }
        }
        return names;
    }

    private _enqueueCommand<T>(work: () => Promise<T>): Promise<T> {
        const run = this._commandQueue.then(() => work(), () => work());
        this._commandQueue = run.then(
            () => undefined,
            () => new Promise<void>(r => setTimeout(r, 100)),  // 연결 실패 시 100ms 대기 후 다음 명령
        );
        return run;
    }

    private async _sendCmd(command: string): Promise<string | null> {
        if (!this._config || !this._isConnected) { return null; }
        return this._enqueueCommand(async () => {
            if (!this._config || !this._isConnected) { return null; }
            try {
                const result = await sendCommand(command, this._config);
                // 주요 명령은 응답 첫 줄을 디버그 콘솔에 표시
                if (/^(Set |Start |Stop |Continue |Step |Break |Compile |Execute )/i.test(command)) {
                    const firstLine = result?.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0] || '';
                    this._log(`CMD: ${command} → ${firstLine || '(ok)'}`);
                }
                return result;
            } catch (err: any) {
                this._log(`명령 실패 [${command}]: ${err.message ?? err}`);
                return null;
            }
        });
    }

    /**
     * Send a message to the Debug Console output.
     */
    private _log(message: string): void {
        this.sendEvent(new OutputEvent(`[GPL Debug] ${message}\n`, 'console'));
    }

    // ─── State Polling ────────────────────────────────────

    private _startPolling(): void {
        this._stopPolling();
        this._pollTimer = setInterval(() => {
            if (this._pollInFlight) { return; }
            void this._pollThreadStates();
        }, this._pollIntervalMs);
    }

    private _stopPolling(): void {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = undefined;
        }
        if (this._fastPollTimer) {
            clearInterval(this._fastPollTimer);
            this._fastPollTimer = undefined;
        }
    }

    /**
     * Trigger an immediate poll after step/pause commands.
     * Schedules 3 rapid polls (100ms apart) then returns to normal interval.
     */
    private _fastPoll(): void {
        this._stopPolling();
        let count = 0;
        this._fastPollTimer = setInterval(() => {
            if (!this._isConnected) {
                this._stopPolling();
                return;
            }
            if (this._pollInFlight) { return; }

            void (async () => {
                await this._pollThreadStates();
                count++;
                if (count >= 5) {
                    if (this._fastPollTimer) {
                        clearInterval(this._fastPollTimer);
                        this._fastPollTimer = undefined;
                    }
                    // Resume normal polling
                    this._startPolling();
                }
            })();
        }, 300);
    }

    // 첫 N회 폴링에서 raw 응답을 로깅하여 진단 지원
    private _pollCount = 0;
    private static readonly DIAG_POLL_COUNT = 3;

    private async _pollThreadStates(): Promise<void> {
        if (!this._isConnected || this._pollInFlight) { return; }
        this._pollInFlight = true;
        try {
            this._pollCount++;

            const resp = await this._sendCmd('Show Thread');
            if (!resp) {
                this._pollFailures++;
                if (this._pollCount <= GPLDebugSession.DIAG_POLL_COUNT) {
                    this._log(`[poll #${this._pollCount}] Show Thread → (응답 없음)`);
                }
                if (this._pollFailures >= GPLDebugSession.MAX_POLL_FAILURES) {
                    this._log(`연결 불안정 — ${this._pollFailures}회 연속 실패, 디버거를 종료합니다.`);
                    this._stopPolling();
                    this._isConnected = false;
                    this.sendEvent(new TerminatedEvent());
                }
                return;
            }
            this._pollFailures = 0;

            const threads = parseThreadList(resp);

            // 진단 로그: 처음 N회는 원시 응답과 파싱 결과를 표시
            if (this._pollCount <= GPLDebugSession.DIAG_POLL_COUNT) {
                const raw = resp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/).filter(l => l.trim()).slice(0, 5).join(' | ');
                this._log(`[poll #${this._pollCount}] Show Thread → ${threads.length}개 쓰레드 (raw: ${raw || '(빈 응답)'})`);
            }

            // ── ThreadEvent: 새로 생긴 쓰레드 / 사라진 쓰레드 감지 ──
            const currentNames = new Set(threads.map(t => t.name));

            // 새 쓰레드 → ThreadEvent('started')
            for (const name of currentNames) {
                if (!this._knownThreadNames.has(name)) {
                    const id = this._getOrCreateThreadId(name);
                    this._knownThreadNames.add(name);
                    if (this._configurationDone) {
                        this.sendEvent(new ThreadEvent('started', id));
                        this._log(`쓰레드 시작: ${name} (id=${id})`);
                    }
                }
            }

            // 사라진 쓰레드 → ThreadEvent('exited')
            for (const name of this._knownThreadNames) {
                if (!currentNames.has(name)) {
                    const id = this._threadNameToId.get(name);
                    this._knownThreadNames.delete(name);
                    this._previousThreadStates.delete(name);

                    if (id !== undefined
                        && this._pendingAction === 'continue'
                        && this._pendingThreadId === id) {
                        this._pendingAction = null;
                        this._pendingThreadId = undefined;
                        this._pendingContinuePausedSeen = 0;
                        this._log(`쓰레드 ${name} 종료 (Continue 후 중단점 미도달/프로그램 종료)`);
                    }

                    if (id !== undefined && this._configurationDone) {
                        this.sendEvent(new ThreadEvent('exited', id));
                        this._log(`쓰레드 종료: ${name} (id=${id})`);
                    }
                }
            }

            // ── 상태 전이 감지 ──
            for (const t of threads) {
                const prevState = this._previousThreadStates.get(t.name);
                const id = this._getOrCreateThreadId(t.name);
                const isPausedState = t.state === 'Break' || t.state === 'Paused';

                if (this._pendingAction === 'continue' && this._pendingThreadId === id) {
                    // Continue 후 상태 전이를 놓치면 paused->paused로만 보일 수 있다.
                    // 동일 paused 상태가 2회 연속 관측되면 다음 중단점 정지로 간주한다.
                    if (isPausedState) {
                        this._pendingContinuePausedSeen++;
                        if (this._pendingContinuePausedSeen >= 2) {
                            this._pendingAction = null;
                            this._pendingThreadId = undefined;
                            this._pendingContinuePausedSeen = 0;

                            if (!this._configurationDone) {
                                this._queuedStoppedEvents.push({ reason: 'breakpoint', threadId: id });
                                this._log(`쓰레드 ${t.name} Continue 후 정지 감지 → configurationDone 대기 중`);
                            } else {
                                this.sendEvent(new StoppedEvent('breakpoint', id));
                                this._log(`쓰레드 ${t.name} 정지 (breakpoint)`);
                            }

                            this._previousThreadStates.set(t.name, t.state);
                            continue;
                        }
                    } else {
                        this._pendingContinuePausedSeen = 0;
                    }
                }

                // Step 명령은 폴링 사이에 Running 상태를 놓칠 수 있으므로,
                // pending step 상태에서 다시 paused/break가 보이면 step 완료로 처리한다.
                if (this._pendingAction === 'step' && this._pendingThreadId === id && isPausedState) {
                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinuePausedSeen = 0;

                    if (!this._configurationDone) {
                        this._queuedStoppedEvents.push({ reason: 'step', threadId: id });
                        this._log(`쓰레드 ${t.name} 스텝 완료 감지 → configurationDone 대기 중`);
                    } else {
                        this.sendEvent(new StoppedEvent('step', id));
                        this._log(`쓰레드 ${t.name} 정지 (step)`);
                    }

                    this._previousThreadStates.set(t.name, t.state);
                    continue;
                }

                // Detect transition to Paused/Break state
                if (isPausedState &&
                    prevState !== 'Break' && prevState !== 'Paused') {

                    // Determine stop reason based on pending action
                    let reason = 'breakpoint';
                    if (this._pendingAction === 'step' && this._pendingThreadId === id) {
                        reason = 'step';
                    } else if (this._pendingAction === 'pause' && this._pendingThreadId === id) {
                        reason = 'pause';
                    } else if (this._pendingAction === 'entry') {
                        reason = 'entry';
                    }

                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinuePausedSeen = 0;

                    // configurationDone 전이면 큐에 보관 (DAP 프로토콜 준수)
                    if (!this._configurationDone) {
                        this._queuedStoppedEvents.push({ reason, threadId: id });
                        this._log(`쓰레드 ${t.name} 정지 감지 (${reason}) → configurationDone 대기 중`);
                    } else {
                        this.sendEvent(new StoppedEvent(reason, id));
                        this._log(`쓰레드 ${t.name} 정지 (${reason})`);
                    }
                }

                // Detect transition to Error state → break on errors가 활성일 때만
                if (t.state === 'Error' && prevState !== 'Error') {
                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinuePausedSeen = 0;

                    if (this._breakOnErrors) {
                        if (!this._configurationDone) {
                            this._queuedStoppedEvents.push({ reason: 'exception', threadId: id });
                            this._log(`쓰레드 ${t.name} 에러 감지 → configurationDone 대기 중`);
                        } else {
                            this.sendEvent(new StoppedEvent('exception', id));
                            this._log(`쓰레드 ${t.name} 에러 발생 (exception break)`);
                        }
                    } else {
                        this._log(`쓰레드 ${t.name} 에러 발생 (break on errors 비활성 — 무시)`);
                    }
                }

                this._previousThreadStates.set(t.name, t.state);
            }
        } finally {
            this._pollInFlight = false;
        }
    }
}
