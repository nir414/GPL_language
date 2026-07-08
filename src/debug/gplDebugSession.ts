/**
 * GPL Debug Adapter – Brooks 제어기 DAP 세션.
 *
 * DebugAdapterInlineImplementation과 함께 사용되어 extension 프로세스 내에서 실행된다.
 * Brooks TCP 콘솔 명령(포트 1402)을 통해 디버깅 프로토콜을 구현한다.
 */

import {
    LoggingDebugSession,
    Event,
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
    InvalidatedEvent,
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
import { deploy, findProjectDirs, resolveErrorFilePath } from '../controller/deployService';

// 디버그 경로(Attach 전 배포)의 컴파일 진단은 세션 인스턴스가 아니라 모듈 공용 컬렉션에 둔다.
// 이유: 세션마다 새 컬렉션을 만들면 (a) 종료 시 지워져 Problems에서 사라지고,
//       (b) 재시도 시 옛 컬렉션이 남아 중복 진단이 생긴다. 공용 1개로 두면 deploy() 시작 시
//       clear로 갱신되고, 세션이 끝나도 Problems에 유지되어 코드로 점프할 수 있다.
let _debugDeployDiagnostics: vscode.DiagnosticCollection | undefined;
function getDebugDeployDiagnostics(): vscode.DiagnosticCollection {
    if (!_debugDeployDiagnostics) {
        _debugDeployDiagnostics = vscode.languages.createDiagnosticCollection('gpl-debug-deploy');
    }
    return _debugDeployDiagnostics;
}
import {
    parseThreadList,
    parseThreadDetail,
    SHOW_THREAD_LIST_CMD,
    parseStack,
    parseVariable,
    parseBreakList,
    parseGpr,
    selectProjectFromCandidates,
    parseErrorLog,
    isSuccess,
    StackFrameInfo,
} from '../controller/responseParser';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../gplParser';
import { fireDebugThreadsUpdated, onDebugPollTrigger } from '../controller/debugBridge';

let sharedDeployOutput: vscode.OutputChannel | undefined;

function getDeployOutputChannel(): vscode.OutputChannel {
    if (!sharedDeployOutput) {
        sharedDeployOutput = vscode.window.createOutputChannel('GPL Deploy (Debug)');
    }
    return sharedDeployOutput;
}

// ─── Launch/Attach argument interfaces ───────────────────

interface IAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    controllerIp?: string;
    controllerPort?: number;
    stopOnEntry?: boolean;
    projectName?: string;
    deployBeforeAttach?: boolean;
    projectDir?: string;
    skipUnchangedOnDeploy?: boolean;
    stopAllBeforeAttach?: boolean;
    clearProjectBreakpointsOnAttach?: boolean;
    /** true면 디버거 분리(세션 종료) 시 제어기 측 프로그램도 정지한다(Stop -all). 기본 false(실행 유지). */
    stopAllOnDisconnect?: boolean;
}

// ─── Scope handle payload ────────────────────────────────

interface ScopeRef {
    type: 'locals' | 'globals';
    threadName: string;
    frameIndex: number;
}

interface GlobalVariableDescriptor {
    displayName: string;
    lookupNames: string[];
}

// ─── Pending action for StoppedEvent reason ──────────────

type PendingAction = 'step' | 'pause' | 'entry' | 'continue' | null;

// ─── Session ─────────────────────────────────────────────

export class GPLDebugSession extends LoggingDebugSession {
    private static readonly MIN_DEBUG_POLL_INTERVAL_MS = 1000;
    private static readonly MAX_DEBUG_POLL_INTERVAL_MS = 5000;

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
    private _fastPollTimer: ReturnType<typeof setTimeout> | undefined;
    private _previousThreadStates = new Map<string, string>();
    private _isConnected = false;
    private _pollIntervalMs = 1000;
    private _pollInFlight = false;
    // ② 폴 디바운스: 마지막 폴 완료 시각 + 최소 간격. force=false 트리거(1403/interval
    //    중복)가 이 간격 내면 스킵해 Show Thread 중복 발사를 줄인다. fast poll은 force=true로 우회.
    private _lastPollCompletedAt = 0;
    private static readonly POLL_MIN_GAP_MS = 250;
    // ④ 1403 트리거 유실 방지: 폴이 가드(_pollInFlight/_userActionInFlight)에 막혀
    //    스킵됐을 때 pending 액션이 있으면 표시해 두고, 폴 완료 직후 1회 재폴한다.
    private _pollRetryRequested = false;
    // ⑤ Show Thread 목록 캐시: 정지 감지 폴이 방금 가져온 목록을 StoppedEvent 직후
    //    VS Code가 부르는 threadsRequest에서 재사용 — TCP 왕복 1회 제거.
    private _lastThreadList: ReturnType<typeof parseThreadList> | null = null;
    private _lastThreadListAt = 0;
    private static readonly THREAD_LIST_CACHE_TTL_MS = 300;
    // ⑥ step/continue 후 fast poll 스케줄(ms): 첫 폴 30ms 시작, 점감 백오프.
    //    (기존 500ms x 2는 1403 트리거 유실 시 첫 관측까지 최소 500ms 체감 지연 유발)
    private static readonly FAST_POLL_DELAYS_MS = [30, 120, 250, 500, 1000];
    // fast poll 체인 세대 토큰 — _stopPolling/새 _fastPoll 시 이전 체인을 무효화.
    private _fastPollGen = 0;

    // Controller console is effectively single-request-at-a-time.
    // Serialize all commands within a debug session to avoid ECONNRESET.
    private _commandQueue: Promise<void> = Promise.resolve();

    // Pending action — determines StoppedEvent reason
    private _pendingAction: PendingAction = null;
    private _pendingThreadId: number | undefined;
    // Continue 후 Running 상태를 실제로 관측했는지 여부.
    // 폴 간격이 1초 이상이라 Running이 짧으면 못 보는 경우가 있으므로,
    // sawRunning을 1차 신호로 쓰되 실패 시 위치 비교(_continueOrigin)와
    // 연속 paused 관측(_pendingContinuePausedSeen)으로 백업 판정한다.
    private _pendingContinueSawRunning = false;

    // Continue 직전 정지 위치(file, line) — sawRunning을 놓쳤을 때 위치 변경으로 새 정지 확인.
    private _continueOrigin = new Map<string, { file: string; line: number }>();

    // Continue 후 sawRunning=false 상태에서 paused로 관측된 연속 횟수.
    // 같은 위치에서 N회 연속 paused면 잔재 상태가 너무 오래 지속되었거나
    // 동일 BP 재히트로 보고 정지로 인정 (마지막 안전망).
    private _pendingContinuePausedSeen = 0;

    // 사용자 액션(step/continue/pause/disconnect) 처리 중 플래그.
    // 이 플래그가 켜져 있으면 Show Thread 폴링을 보류해서 1402 큐에
    // 사용자 명령이 폴 뒤에 끼는 지연을 방지한다.
    private _userActionInFlight = false;

    // Stack frame cache — pending step/continue 동안 UI에 반환할 직전 프레임 캐시
    private _cachedFrames = new Map<string, StackFrameInfo[]>();
    // ③ Show Stack 캐시 신선도: 정지 위치별 마지막 조회 시각 + 짧은 TTL.
    //    같은 정지 동안 stackTrace/scopes/variables 연속 요청을 1회 조회로 합친다.
    private _frameCacheAt = new Map<string, number>();
    // 정지 중 프레임은 변하지 않고 새 step/continue 시 _fastPoll()이 무효화하므로,
    // TTL을 넉넉히 둬서 정지 직후 stackTrace의 Show Stack 재조회 왕복을 줄인다 (400→1500ms).
    private static readonly FRAME_CACHE_TTL_MS = 1500;

    // Evaluate cache — hover/watch 반복 조회가 1402 명령 큐를 막지 않게 한다.
    // 정지 중 값은 불변에 가깝고(step/continue 시 _clearStaleState, setVariable/REPL 명령 시
    // _clearEvaluateCache가 무효화) TTL을 늘려 같은 변수 재호버를 즉시 응답한다 (750→3000ms).
    private static readonly EVALUATE_CACHE_TTL_MS = 3000;
    private _evaluateCache = new Map<string, { value: string; timestamp: number }>();

    // Session-level disposables — disconnectRequest에서 정리
    private _disposables: vscode.Disposable[] = [];

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
    // 디버거 분리 시 제어기 측 프로그램도 정지할지 여부(attach args로 설정).
    private _stopAllOnDisconnect = false;

    // Debug pre-deploy 진단은 모듈 공용 컬렉션(getDebugDeployDiagnostics)을 사용한다.
    private _lastControllerCommand = '';
    private _firstErrorSeenAtByThread = new Map<string, string>();

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

        // 디버그 세션 폴링 간격은 사용자 설정을 우선하되,
        // 과도한 트래픽을 막기 위해 안전 범위(1s~5s)로 제한한다.
        // 즉시 반응이 필요한 step/continue는 _fastPoll()과 1403 트리거가 담당한다.
        const cfgSection = vscode.workspace.getConfiguration('gpl.controller');
        const userInterval = cfgSection.get<number>('threadPollIntervalMs') ?? 5000;
        this._pollIntervalMs = Math.min(
            GPLDebugSession.MAX_DEBUG_POLL_INTERVAL_MS,
            Math.max(GPLDebugSession.MIN_DEBUG_POLL_INTERVAL_MS, userInterval),
        );
        this._log(
            `폴링 간격 적용: user=${userInterval}ms, effective=${this._pollIntervalMs}ms ` +
            `(fast poll: ${GPLDebugSession.FAST_POLL_DELAYS_MS.join('/')}ms, 1403 trigger: on data)`
        );

        // Verify controller is reachable
        this._log(`제어기 연결 중: ${this._config.ip}:${this._config.port}`);
        try {
            const preflightTimeoutMs = Math.max(5000, this._config.timeoutMs);
            const resp = await sendCommand('ErrorLog', this._config, preflightTimeoutMs);
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

        // Optional: deploy(build-only) before attaching so F5 can do Upload + Debug.
        if (args.deployBeforeAttach) {
            const deployOk = await this._runDeployBeforeAttach(args);
            if (!deployOk) {
                this.sendErrorResponse(response, {
                    id: 1003,
                    format: 'Attach 전 배포(Upload/Compile)에 실패했습니다. Debug Console 로그를 확인하세요.',
                });
                return;
            }
        }

        // Detect project name: explicit arg → Project.gpr → Show Thread
        this._projectName = args.projectName || '';
        if (!this._projectName) {
            this._projectName = await this._detectProjectName();
        }

        // Optional preflight: stop all threads and clear existing breakpoints for clean session.
        // clearProjectBreakpointsOnAttach 기본값: true (이전 세션의 잔재 BP로 인한 중복 설정 방지)
        const stopAllBeforeAttach = args.stopAllBeforeAttach === true;
        const clearProjectBreakpointsOnAttach = args.clearProjectBreakpointsOnAttach !== false;
        // 세션 종료(disconnect) 시 프로그램 정지 여부를 기억해 둔다.
        this._stopAllOnDisconnect = args.stopAllOnDisconnect === true;
        if (stopAllBeforeAttach || clearProjectBreakpointsOnAttach) {
            await this._runAttachPreflight(stopAllBeforeAttach, clearProjectBreakpointsOnAttach);
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
        this.sendEvent(new Event('gpl.controllerConnectionChanged', {
            connected: true,
            ip: this._config.ip,
            port: this._config.port,
            projectName: this._projectName,
        }));

        // Start fast polling to quickly detect entry break, then switch to normal
        this._fastPoll();

        // 1403 데이터 도착 시 즉시 Show Thread 폴을 트리거.
        // step/continue 완료 신호(<E>N,N</E>)가 오면 폴링 타이머 대기 없이 바로 상태를 확인한다.
        this._disposables.push(
            onDebugPollTrigger(() => {
                if (this._isConnected && (this._pendingAction === 'step' || this._pendingAction === 'continue' || this._pendingAction === 'entry')) {
                    this._log('[1403] 데이터 감지 → 즉시 폴 트리거');
                    // force=true: 250ms 디바운스에 걸려 트리거가 유실되지 않도록 한다.
                    // (가드에 막히면 _pollRetryRequested가 표시되어 직후 재폴된다)
                    void this._pollThreadStates(true);
                }
            }),
        );

        this.sendResponse(response);

        // InitializedEvent를 여기서 전송 — VS Code는 이 이벤트 수신 후
        // setBreakPointsRequest를 보내므로 _projectName이 확실히 설정된 상태에서 처리된다.
        this.sendEvent(new InitializedEvent());
    }

    protected async disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments,
    ): Promise<void> {
        this._stopPolling();
        this._userActionInFlight = true;

        // Clear all breakpoints on the controller — 디버거 종료 후에 옛 BP가 잔존하면
        // 다음 세션에서 중복 등록될 수 있으므로 깔끔하게 정리한다.
        if (this._isConnected && this._projectName) {
            for (const [file, lines] of this._breakpoints) {
                for (const line of lines) {
                    await this._sendCmd(`Set Nobreak ${this._projectName} "${file}" ${line}`);
                }
            }
            this._log('모든 브레이크포인트 해제 완료');

            if (this._stopAllOnDisconnect) {
                // stopAllOnDisconnect=true: 디버거 분리 시 제어기 측 프로그램도 정지한다.
                const stopResp = await this._sendCmd('Stop -all');
                const okStop = /<STATUS>\s*0\s*,/.test(stopResp || '');
                this._log(okStop ? '프로젝트 정지 완료 (Stop -all)' : 'Stop -all 전송(응답 STATUS 확인 필요)');
            } else {
                // 기본: Disconnect는 "VS Code 디버그 세션 종료"일 뿐 제어기 측 프로젝트 실행은 그대로 둔다.
                // 명시적으로 중지하려면 launch 구성에 stopAllOnDisconnect=true 를 주거나
                // GPL: 모든 쓰레드 중지 / 쓰레드 정지 명령을 사용한다.
                this._log('프로젝트 실행 유지 (디버거만 분리)');
            }
        }

        this._breakpoints.clear();
        this._knownThreadNames.clear();
        this._isConnected = false;
        this._configurationDone = false;
        this._queuedStoppedEvents = [];
        this._pendingAction = null;
        this._pendingContinueSawRunning = false;
        this._pendingContinuePausedSeen = 0;
        this._continueOrigin.clear();
        this._clearStaleState();
        // NOTE: 컴파일 진단(_debugDeployDiagnostics)은 여기서 지우지 않는다.
        // 세션 종료 시 지우면 F5 배포 실패의 컴파일 에러가 Problems에서 즉시 사라져
        // 코드로 점프할 수 없게 된다. 진단은 다음 배포 시작 시 deploy()가 clear로 갱신한다.
        // 세션 이벤트 구독 해제 (1403 폴 트리거 등)
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
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

        // Clear existing breakpoints for this file on the controller.
        // 로컬 _breakpoints Map만 믿으면 이전 세션 잔재/외부 변경으로 인해 누적될 수 있으므로,
        // 컨트롤러의 실제 BP 목록을 조회해 해당 파일의 모든 BP를 Nobreak로 정리한다.
        const existingLines = new Set<number>(this._breakpoints.get(baseName) || []);
        const preShowResp = await this._sendCmd('Show Break');
        if (preShowResp) {
            const controllerBps = parseBreakList(preShowResp).filter(
                b => b.file.toLowerCase() === baseName.toLowerCase()
                    && (!b.project || b.project.toLowerCase() === proj.toLowerCase()),
            );
            for (const bp of controllerBps) {
                if (bp.fileLine > 0) { existingLines.add(bp.fileLine); }
            }
        }
        for (const line of existingLines) {
            await this._sendCmd(`Set Nobreak ${proj} "${baseName}"${line}`);
        }

        // Set new breakpoints using correct Brooks syntax (GDE 캡처 기준):
        // Set Break project_name "file_name"line_number  (따옴표와 줄번호 사이 공백 없음)
        const actualBreakpoints: DebugProtocol.Breakpoint[] = [];
        const newLines = new Set<number>();

        for (const line of clientLines) {
            const cmd = `Set Break ${proj} "${baseName}"${line}`;
            const resp = await this._sendCmd(cmd);
            // "Duplicate breakpoint" 응답은 컨트롤러에 이미 동일 BP가 있다는 뜻이다.
            // Nobreak 정리가 실패했을 수 있으므로 한 번 더 정리 후 재설정하여 단일 BP 보장.
            let finalResp = resp;
            if (resp !== null && /Duplicate breakpoint/i.test(resp)) {
                this._log(`⚠ Duplicate BP 감지, 재설정: ${cmd}`);
                await this._sendCmd(`Set Nobreak ${proj} "${baseName}"${line}`);
                finalResp = await this._sendCmd(cmd);
            }
            const verified = finalResp !== null && isSuccess(finalResp);
            const bp = new Breakpoint(verified, line) as DebugProtocol.Breakpoint;
            if (!verified) {
                const msg = finalResp
                    ? finalResp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0]
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
        // ⑤ 정지 감지 폴이 방금 가져온 목록이 신선하면 재사용 — StoppedEvent 직후
        //    VS Code가 부르는 threadsRequest의 TCP 왕복 1회를 제거한다.
        let threads: ReturnType<typeof parseThreadList>;
        if (this._lastThreadList
            && Date.now() - this._lastThreadListAt < GPLDebugSession.THREAD_LIST_CACHE_TTL_MS) {
            threads = this._lastThreadList;
        } else {
            const resp = await this._sendCmd(SHOW_THREAD_LIST_CMD);
            if (!resp) {
                response.body = { threads: [] };
                this.sendResponse(response);
                return;
            }
            threads = parseThreadList(resp);
            this._lastThreadList = threads;
            this._lastThreadListAt = Date.now();
        }
        // 정지/에러 쓰레드를 맨 위로 끌어올려 평평한 목록에서 바로 눈에 띄게 한다.
        // (안정 정렬이므로 동일 상태 내에서는 제어기가 반환한 원래 순서를 유지)
        threads.sort((a, b) => this._threadStateRank(a.state) - this._threadStateRank(b.state));
        const dapThreads: Thread[] = [];
        for (const t of threads) {
            const id = this._getOrCreateThreadId(t.name);
            dapThreads.push(new Thread(id, this._formatThreadLabel(t.name, t.state)));
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

        // step/continue 실행 중에는 TCP 명령을 보내지 않고 캐시된 프레임을 반환.
        // 이로써 직렬 큐에 Show Stack이 쌓이지 않아 폴링 지연이 없어진다.
        let frames: StackFrameInfo[];
        if (this._pendingAction === 'step' || this._pendingAction === 'continue') {
            frames = this._cachedFrames.get(threadName) ?? [];
            this._log(`stackTraceRequest: pendingAction=${this._pendingAction}, 캐시 프레임 반환 (${frames.length}개)`);
        } else {
            frames = await this._getThreadFrames(threadName);
        }

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

        // step/continue 실행 중에는 TCP 명령 없이 빈 목록을 즉시 반환.
        // Watch 패널이 실행 중에도 계속 폴링하는데 이게 직렬 큐를 막는 주요 원인.
        if (this._pendingAction === 'step' || this._pendingAction === 'continue') {
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
            // 소스 파일에서 모듈 레벨 전역 변수를 열거하고 개별 Show Global로 조회
            const globals = this._getGlobalVariableDescriptors();

            if (globals.length > 0) {
                for (const g of globals) {
                    const value = await this._readGlobalValue(g.lookupNames);
                    if (value) {
                        variables.push({
                            name: g.displayName,
                            value,
                            variablesReference: 0,
                        });
                    }
                }
            }

            variables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' }));
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
        this._clearEvaluateCache();

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
            // Continue 직전 위치를 origin으로 저장 — 폴이 Running 순간을 놓쳐도
            // 위치 변경으로 새 정지(BP 적중)를 확실히 감지하기 위한 기준점.
            const prevFrames = this._cachedFrames.get(threadName);
            const topFrame = prevFrames?.[0];
            if (topFrame?.file && topFrame.fileLine > 0) {
                this._continueOrigin.set(threadName, {
                    file: topFrame.file,
                    line: topFrame.fileLine,
                });
            } else {
                this._continueOrigin.delete(threadName);
            }

            // Clear stale handles from previous stop
            this._clearStaleState();
            this._pendingAction = 'continue';
            this._pendingThreadId = args.threadId;
            this._pendingContinueSawRunning = false;
            this._pendingContinuePausedSeen = 0;

            this._userActionInFlight = true;
            try {
                // If thread is in Error state, use -noerror to skip the failed step
                const state = this._previousThreadStates.get(threadName);
                if (state === 'Error') {
                    await this._sendCmd(`Continue ${threadName} -noerror`);
                    this._log(`Continue ${threadName} -noerror (다음 중단점 또는 종료까지)`);
                } else {
                    await this._sendCmd(`Continue ${threadName}`);
                    this._log(`Continue ${threadName} (다음 중단점 또는 종료까지)`);
                }
            } finally {
                this._userActionInFlight = false;
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
            this._userActionInFlight = true;
            try {
                // GDE 캡처: step over = `Step <proj> -over -noerror`
                await this._sendCmd(`Step ${threadName} -over -noerror`);
                this._log(`Step ${threadName} -over -noerror`);
            } finally {
                this._userActionInFlight = false;
            }
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
            this._userActionInFlight = true;
            try {
                // GDE 캡처: step into = `Step <proj> -noerror` (-into 플래그 없음)
                await this._sendCmd(`Step ${threadName} -noerror`);
                this._log(`Step ${threadName} -noerror (into)`);
            } finally {
                this._userActionInFlight = false;
            }
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
            this._userActionInFlight = true;
            try {
                // step out은 캡처에 없어 기존 -out 유지 + GDE 공통 -noerror 부여
                await this._sendCmd(`Step ${threadName} -out -noerror`);
                this._log(`Step ${threadName} -out -noerror`);
            } finally {
                this._userActionInFlight = false;
            }
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
            this._userActionInFlight = true;
            try {
                await this._sendCmd(`Break ${threadName}`);
                this._log(`Break ${threadName} (pause)`);
            } finally {
                this._userActionInFlight = false;
            }
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

        // step/continue 실행 중에는 Watch/hover 평가 없이 즉시 반환.
        // 이로써 Show Variable 명령이 직렬 큐에 쌓이지 않는다.
        if (this._pendingAction === 'step' || this._pendingAction === 'continue') {
            response.body = { result: '(실행 중)', variablesReference: 0 };
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

        // REPL은 멈춘 쓰레드가 없어도 임의 제어기 명령을 보낼 수 있도록 허용한다.
        // hover/watch는 변수 평가 전용이므로 멈춘 쓰레드가 없으면 기존처럼 안내만 한다.
        if (!threadName && args.context !== 'repl') {
            response.body = { result: '(일시정지된 쓰레드 없음 — 임의 명령은 디버그 콘솔에 직접 입력하거나 "GPL: Send Command to Controller" 사용)', variablesReference: 0 };
            this.sendResponse(response);
            return;
        }

        if (args.context === 'repl') {
            // REPL 처리 순서:
            //  1) '>' 접두사면 무조건 제어기 명령으로 전송 (강제 패스스루)
            //  2) 멈춘 쓰레드가 있으면 변수/식 평가(Show Variable -eval) → 전역(Show Global) 시도
            //  3) 위에서 결과가 없으면 입력 전체를 제어기 명령으로 전송
            const forceRaw = expression.startsWith('>');
            const rawCommand = forceRaw ? expression.slice(1).trim() : expression;

            if (!forceRaw && threadName) {
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
            }

            // 변수 평가가 불가하거나 멈춘 쓰레드가 없으면 → 임의 제어기 명령으로 전송
            if (!result && rawCommand) {
                const raw = await this._sendCmd(rawCommand);
                if (raw === null) {
                    result = '(제어기 미연결 — 디버그 세션/연결 상태를 확인하세요)';
                } else {
                    const cleaned = raw.replace(/<[^>]+>/g, '').trim();
                    result = cleaned.length > 0 ? cleaned : '(ok)';
                }
                // 임의 명령은 제어기 상태를 바꿀 수 있으므로 hover/watch 캐시를 무효화
                this._clearEvaluateCache();
            }
            if (!result) { result = '(평가 불가)'; }
        } else if (args.context === 'hover' || args.context === 'watch') {
            const cacheKey = [
                args.context,
                threadName,
                frameIndex,
                this._projectName,
                expression,
            ].join('\u001f');
            const cached = this._getCachedEvaluate(cacheKey);
            if (cached !== undefined) {
                result = cached;
            } else {
                // Show Variable -eval thread frame variable → "name, type, value" 형식
                const resp = await this._sendCmd(
                    `Show Variable -eval ${threadName} ${frameIndex} ${expression}`,
                );
                if (resp) {
                    const parsed = this._parseShowVariableEval(resp);
                    if (parsed.value) {
                        result = parsed.type
                            ? `${parsed.value}  (${parsed.type})`
                            : parsed.value;
                    }
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
                this._setCachedEvaluate(cacheKey, result || `(${expression} 평가 불가)`);
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

    /** Format thread label shown in VS Code CALL STACK panel: "ThreadName  [▶ Running]" */
    private _formatThreadLabel(name: string, state: string): string {
        const icons: Record<string, string> = {
            Running:  '▶',
            Idle:     '○',
            Break:    '⏸',
            Paused:   '⏸',
            Error:    '⚠',
            Stopping: '■',
            Stopped:  '■',
        };
        const icon = icons[state] ?? '?';
        // 주의가 필요한 상태(정지/에러)는 선두 마커(●)와 대문자 상태로 강조해
        // 실행 중인 다른 쓰레드 사이에서 한눈에 구분되게 한다.
        const attention = state === 'Paused' || state === 'Break' || state === 'Error';
        if (attention) {
            return `● ${name}  [${icon} ${state.toUpperCase()}]`;
        }
        return `${name}  [${icon} ${state}]`;
    }

    /**
     * 호출 스택/쓰레드 목록 정렬용 상태 우선순위.
     * 값이 작을수록 위에 표시된다: Error → Paused/Break → Stopping/Stopped → Running → Idle → 기타.
     */
    private _threadStateRank(state: string): number {
        switch (state) {
            case 'Error':    return 0;
            case 'Paused':
            case 'Break':    return 1;
            case 'Stopping':
            case 'Stopped':  return 2;
            case 'Running':  return 3;
            case 'Idle':     return 4;
            default:         return 5;
        }
    }

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
        this._cachedFrames.clear();
        this._clearEvaluateCache();
    }

    private _getCachedEvaluate(key: string): string | undefined {
        const entry = this._evaluateCache.get(key);
        if (!entry) { return undefined; }
        if (Date.now() - entry.timestamp > GPLDebugSession.EVALUATE_CACHE_TTL_MS) {
            this._evaluateCache.delete(key);
            return undefined;
        }
        return entry.value;
    }

    private _setCachedEvaluate(key: string, value: string): void {
        this._evaluateCache.set(key, { value, timestamp: Date.now() });
        if (this._evaluateCache.size > 200) {
            const oldestKey = this._evaluateCache.keys().next().value;
            if (oldestKey !== undefined) {
                this._evaluateCache.delete(oldestKey);
            }
        }
    }

    private _clearEvaluateCache(): void {
        this._evaluateCache.clear();
    }

    /**
     * Resolve a controller filename (basename) to a workspace file path.
     * Uses the pre-built source file map for fast lookup.
     */
    private _resolveSourcePath(filename: string): string {
        // 제어기가 전체 경로(예: /flash/projects/MergeCode/PDBModule.gpl)를 줄 수도 있으므로
        // 항상 베이스네임으로 정규화한 뒤 워크스페이스 소스맵에서 조회한다.
        const base = filename.replace(/^.*[\\/]/, '');
        const lower = base.toLowerCase();

        const cached = this._sourceFileMap.get(lower);
        if (cached) { return cached; }

        // 미스: attach 이후 추가/이동된 파일일 수 있으므로 소스맵을 1회 재인덱싱 후 재시도.
        this._buildSourceFileMap();
        const rebuilt = this._sourceFileMap.get(lower);
        if (rebuilt) { return rebuilt; }

        // 그래도 못 찾으면 원본을 그대로 반환하되, 왜 이동이 안 되는지 진단 로그를 남긴다.
        this._log(
            `소스 경로 해석 실패: "${filename}" (basename: ${base}) — ` +
            `워크스페이스 소스맵(${this._sourceFileMap.size}개)에서 찾지 못했습니다. ` +
            `해당 .gpl/.gpo 파일이 열린 워크스페이스 폴더에 포함되어 있는지 확인하세요.`,
        );
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

        // 2) 활성 편집 파일(있으면)을 신호로 프로젝트를 선택한다.
        //    우선순위: 폴더포함+소스일치 → 폴더포함(최심) → 고유 소스명 일치 → 결정적 fallback.
        //    (선택 규칙은 selectProjectFromCandidates로 분리 — 순수 함수/단위 테스트 대상)
        const activeDoc = vscode.window.activeTextEditor?.document;
        const activePath = activeDoc?.uri.scheme === 'file'
            ? activeDoc.uri.fsPath
            : '';

        const selection = selectProjectFromCandidates(candidates, activePath);
        if (selection) {
            this._log(`프로젝트 감지: ${selection.projectName} — ${selection.reason}`);
            if (selection.ambiguous) {
                this._log(
                    '⚠ 프로젝트 자동감지가 모호합니다(여러 프로젝트가 후보). 의도와 다른 프로젝트가 '
                    + '선택될 수 있으니 launch.json의 "projectName"으로 대상을 명시하는 것을 권장합니다.',
                );
            }
            return selection.projectName;
        }

        // 3) Fallback: detect from Show Thread (running thread's project)
        const resp = await this._sendCmd(SHOW_THREAD_LIST_CMD);
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
     *
     * ⚠ 주의: 응답 끝에는 항상 `<STATUS>0, "Success"</STATUS>` 같은 STATUS 블록이 붙는다.
     * 단순히 태그만 제거하면 `0, "Success"` 텍스트가 남아 변수 값으로 잘못 파싱된다.
     * → STATUS 블록은 먼저 통째로 제거해야 한다.
     */
    private _parseShowVariableEval(raw: string): { name: string; type: string; value: string } {
        const withoutStatus = raw.replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '');
        const cleaned = withoutStatus.replace(/<[^>]+>/g, '').trim();
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
        // ③ Show Stack 캐시: 같은 정지 동안 stackTrace/scopes/variables가 연달아
        //    요청해도 짧은 TTL 내에는 1회 조회 결과를 재사용한다(_fastPoll에서 무효화).
        const cachedFresh = this._cachedFrames.get(threadName);
        const cachedAt = this._frameCacheAt.get(threadName) ?? 0;
        if (cachedFresh && cachedFresh.length > 0
            && Date.now() - cachedAt < GPLDebugSession.FRAME_CACHE_TTL_MS) {
            return cachedFresh;
        }

        const resp = await this._sendCmd(`Show Stack ${threadName}`);
        const frames = resp ? parseStack(resp) : [];
        if (frames.length > 0) {
            this._cachedFrames.set(threadName, frames);
            this._frameCacheAt.set(threadName, Date.now());
            return frames;
        }

        const detailResp = await this._sendCmd(`Show Thread ${threadName}`);
        const detail = detailResp ? parseThreadDetail(detailResp) : null;
        if (detail?.file && detail.fileLine > 0) {
            this._log(`Show Stack ${threadName} → 0 frames, Show Thread fallback 사용 (${detail.file}:${detail.fileLine})`);
            const fallback: StackFrameInfo[] = [{
                frameIndex: 0,
                project: detail.project,
                process: detail.process || threadName,
                procLine: detail.procLine,
                file: detail.file,
                fileLine: detail.fileLine,
                size: 0,
            }];
            this._cachedFrames.set(threadName, fallback);
            this._frameCacheAt.set(threadName, Date.now());
            return fallback;
        }

        return [];
    }

    private async _resolveStopReasonForThread(threadName: string, fallback: string): Promise<string> {
        const frames = await this._getThreadFrames(threadName);
        const top = frames[0];
        if (!top?.file || top.fileLine <= 0) {
            return fallback;
        }

        const breakpointLines = this._breakpoints.get(path.basename(top.file));
        if (breakpointLines?.has(top.fileLine)) {
            this._log(`현재 위치가 브레이크포인트와 일치: ${top.file}:${top.fileLine}`);
            return 'breakpoint';
        }

        return fallback;
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
                    // dot 디렉터리(.history/.vscode/.git 등)와 빌드/출력 폴더는 건너뛴다.
                    // 특히 .history(Local History 확장)에는 과거 이름의 stale Project.gpr 사본이
                    // 쌓여 있어 프로젝트 오인식의 원인이 된다.
                    if (
                        entry.name.startsWith('.')
                        || entry.name === 'node_modules'
                        || entry.name === 'out'
                        || entry.name === 'dist'
                        || entry.name === 'bin'
                    ) { continue; }
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
     * 워크스페이스의 모든 GPL 소스에서 모듈 레벨(비로컬) 전역 변수를 열거한다.
     * Globals 패널은 public/private 여부와 무관하게 현재 프로젝트의 모듈 전역 상태를 보여주는 것이 유용하다.
     */
    private _getGlobalVariableDescriptors(): GlobalVariableDescriptor[] {
        const seen = new Set<string>();
        const globals: GlobalVariableDescriptor[] = [];

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
                // 컴파일타임 Const는 런타임 변수가 아니므로 제외 (`Show Global`이 의미 있는 값을 반환하지 않음).
                if (s.kind === GPLSymbolKind.Variable
                    && !s.isLocal
                    && !s.className) {
                    const displayName = s.module ? `${s.module}.${s.name}` : s.name;
                    const lookupNames = s.module
                        ? [`${s.module}.${s.name}`, s.name]
                        : [s.name];
                    const lower = displayName.toLowerCase();
                    if (!seen.has(lower)) {
                        seen.add(lower);
                        globals.push({ displayName, lookupNames });
                    }
                }
            }
        }

        return globals.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'accent' }));
    }

    /**
     * Show Global 질의는 펌웨어/심볼 형태에 따라 qualified/unqualified 이름 중 하나만 먹을 수 있다.
     * 후보를 순서대로 시도해서 첫 성공 값을 반환한다.
     */
    private async _readGlobalValue(lookupNames: string[]): Promise<string> {
        for (const name of lookupNames) {
            const resp = await this._sendCmd(
                this._projectName
                    ? `Show Global ${name}, ${this._projectName}`
                    : `Show Global ${name}`,
            );
            if (!resp || !isSuccess(resp)) {
                continue;
            }

            const parsedEval = this._parseShowVariableEval(resp);
            if (parsedEval.value && parsedEval.value !== '(undefined)') {
                return parsedEval.type
                    ? `${parsedEval.value}  (${parsedEval.type})`
                    : parsedEval.value;
            }

            const parsedVars = parseVariable(resp);
            if (parsedVars.length > 0) {
                return parsedVars.map(v => `${v.name} = ${v.value}`).join(', ');
            }

            const cleaned = resp
                .replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
                .replace(/<[^>]+>/g, '')
                .trim();
            const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            if (lines.length > 0) {
                return lines.join(', ');
            }
        }

        return '';
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
        this._lastControllerCommand = command;
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

    private async _emitErrorLocationEvent(threadId: number, threadName: string, statusText: string): Promise<void> {
        const frames = await this._getThreadFrames(threadName);
        const top = frames[0];
        const errorDetail = await this._getThreadErrorDetail(threadName, statusText);
        if (!this._firstErrorSeenAtByThread.has(threadName)) {
            this._firstErrorSeenAtByThread.set(threadName, new Date().toISOString());
        }
        const firstSeenAt = this._firstErrorSeenAtByThread.get(threadName);
        const stackFrames = frames
            .slice(0, 6)
            .map(f => `${f.process || '(unknown)'} @ ${f.file || '?'}:${f.fileLine || 0}`);
        const relatedFunctions = frames
            .map(f => (f.process || '').trim())
            .filter(Boolean)
            .filter((v, idx, arr) => arr.indexOf(v) === idx)
            .slice(0, 6);
        if (!top?.file || top.fileLine <= 0) {
            this.sendEvent(new Event('gpl.errorLocation', {
                threadId,
                threadName,
                statusText,
                errorCode: errorDetail.code,
                errorMessage: errorDetail.message,
                errorLogLines: errorDetail.errorLogLines,
                firstSeenAt,
                lastCommand: this._lastControllerCommand,
                stackFrames,
                relatedFunctions,
            }));
            return;
        }

        this.sendEvent(new Event('gpl.errorLocation', {
            threadId,
            threadName,
            file: top.file,
            line: top.fileLine,
            process: top.process,
            statusText,
            errorCode: errorDetail.code,
            errorMessage: errorDetail.message,
            errorLogLines: errorDetail.errorLogLines,
            firstSeenAt,
            lastCommand: this._lastControllerCommand,
            stackFrames,
            relatedFunctions,
        }));
    }

    private async _getThreadErrorDetail(
        threadName: string,
        fallbackStatus: string,
    ): Promise<{ code?: number; message: string; errorLogLines: string[] }> {
        let code: number | undefined;
        let message = fallbackStatus && fallbackStatus !== 'Error' ? fallbackStatus : '';

        const detailResp = await this._sendCmd(`Show Thread ${threadName}`);
        const detail = detailResp ? parseThreadDetail(detailResp) : null;
        if (detail) {
            if (detail.statusCode !== 0) {
                code = detail.statusCode;
            }
            if (detail.statusMessage) {
                message = detail.statusMessage;
            }
        }

        let errorLogLines: string[] = [];
        const errorLogResp = await this._sendCmd('ErrorLog');
        if (errorLogResp) {
            errorLogLines = parseErrorLog(errorLogResp).slice(0, 5);
        }

        if (!message && errorLogLines.length > 0) {
            message = errorLogLines[0];
        }
        if (!message && typeof code === 'number') {
            message = `STATUS ${code}`;
        }
        if (!message) {
            message = fallbackStatus || 'Error';
        }

        return { code, message, errorLogLines };
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
        // 진행 중인 fast poll 체인 무효화 — 지연 콜백이 뒤늦게 재폴/재스케줄하지 않도록.
        this._fastPollGen++;
        if (this._fastPollTimer) {
            clearTimeout(this._fastPollTimer);
            this._fastPollTimer = undefined;
        }
    }

    /**
     * Trigger fast polling after step/continue/pause commands.
     * ⑥ 첫 폴을 30ms에 시작해 점감 백오프(FAST_POLL_DELAYS_MS)로 재관측한다 —
     * 짧은 스텝은 명령 STATUS 직후 첫 폴에서 바로 잡혀 체감 지연이 최소화된다.
     * 1403 즉시 트리거가 주 신호이고 이 스케줄은 트리거 유실 대비 백업.
     * pending 액션이 해소되면 남은 스케줄을 버리고 일반 폴링으로 복귀한다.
     */
    private _fastPoll(): void {
        this._stopPolling();
        // ③ 곧 위치가 바뀌므로 stack 프레임 캐시 신선도를 무효화(다음 정지 후 1회 재조회).
        this._frameCacheAt.clear();
        const gen = ++this._fastPollGen;
        const delays = GPLDebugSession.FAST_POLL_DELAYS_MS;
        const schedule = (idx: number): void => {
            if (gen !== this._fastPollGen) { return; }
            if (idx >= delays.length) {
                if (this._isConnected) { this._startPolling(); }
                return;
            }
            this._fastPollTimer = setTimeout(() => {
                this._fastPollTimer = undefined;
                if (gen !== this._fastPollGen || !this._isConnected) { return; }
                void (async () => {
                    if (!this._pollInFlight) {
                        await this._pollThreadStates(true);
                    }
                    if (gen !== this._fastPollGen || !this._isConnected) { return; }
                    // 정지를 이미 감지했으면(pending 해소) fast poll 조기 종료 → 일반 폴링 복귀
                    if (!this._pendingAction) {
                        if (!this._pollTimer) { this._startPolling(); }
                        return;
                    }
                    schedule(idx + 1);
                })();
            }, delays[idx]);
        };
        schedule(0);
    }

    // 첫 N회 폴링에서 raw 응답을 로깅하여 진단 지원
    private _pollCount = 0;
    private static readonly DIAG_POLL_COUNT = 3;

    private async _pollThreadStates(force: boolean = false): Promise<void> {
        if (!this._isConnected) { return; }
        if (this._pollInFlight) {
            // ④ 진행 중인 폴이 이번 상태 변화를 이미 지나쳤을 수 있으므로,
            //    pending 액션이 있으면 폴 완료 직후 1회 재폴하도록 표시한다 (트리거 유실 방지).
            if (this._pendingAction) { this._pollRetryRequested = true; }
            return;
        }
        // 사용자 액션(step/continue/pause/disconnect)이 진행 중이면 폴링을 보류.
        // 폴 명령이 1402 큐에서 사용자 명령보다 먼저 자리를 차지하지 않도록 한다.
        if (this._userActionInFlight) {
            if (this._pendingAction) { this._pollRetryRequested = true; }
            return;
        }
        // ② 디바운스: fast poll/1403 트리거(force=true)가 아닌 interval 폴이 직전 완료 후
        //    최소 간격 이내면 스킵 (중복 Show Thread 제거).
        if (!force && Date.now() - this._lastPollCompletedAt < GPLDebugSession.POLL_MIN_GAP_MS) { return; }
        this._pollInFlight = true;
        try {
            this._pollCount++;

            const resp = await this._sendCmd(SHOW_THREAD_LIST_CMD);
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
            // ⑤ StoppedEvent 직후의 threadsRequest가 재사용할 수 있도록 최신 목록을 캐시
            this._lastThreadList = threads;
            this._lastThreadListAt = Date.now();

            // 디버그 쓰레드 상태를 사이드바 트리에 push (추가 TCP 없이 실시간 갱신)
            fireDebugThreadsUpdated(threads);

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
                        this._pendingContinueSawRunning = false;
                        this._log(`쓰레드 ${name} 종료 (Continue 후 중단점 미도달/프로그램 종료)`);
                    }

                    if (id !== undefined && this._configurationDone) {
                        this.sendEvent(new ThreadEvent('exited', id));
                        this._log(`쓰레드 종료: ${name} (id=${id})`);
                    }
                }
            }

            // ── 상태 전이 감지 ──
            let threadStateChanged = false;
            for (const t of threads) {
                const prevState = this._previousThreadStates.get(t.name);
                const id = this._getOrCreateThreadId(t.name);
                const isPausedState = t.state === 'Break' || t.state === 'Paused';

                if (this._pendingAction === 'continue' && this._pendingThreadId === id) {
                    // Continue 정지 감지: 1차 신호는 Running 관측, 2차 신호는 위치 변경.
                    // 폴 간격이 길어서 짧은 Running을 못 본 경우에도 file/line이 바뀌었으면
                    // 새 정지(BP 적중)로 인정한다. 마지막 안전망으로 같은 위치에서 N회 연속
                    // paused면 잔재 상태가 너무 길거나 동일 BP 재히트로 보고 정지로 처리.
                    if (t.state === 'Running') {
                        this._pendingContinueSawRunning = true;
                        this._pendingContinuePausedSeen = 0;
                    } else if (isPausedState) {
                        let isRealStop = this._pendingContinueSawRunning;

                        if (!isRealStop) {
                            // 위치 비교 백업: Show Thread <name>으로 현재 file/line 조회.
                            // 추가 TCP 1회는 의심 구간에서만 발생하므로 평시 부하 증가는 없다.
                            const detailResp = await this._sendCmd(`Show Thread ${t.name}`);
                            const detail = detailResp ? parseThreadDetail(detailResp) : null;
                            const origin = this._continueOrigin.get(t.name);

                            if (detail?.file && detail.fileLine > 0) {
                                if (!origin) {
                                    // origin 미기록 — 비교 불가, 단일 paused 관측만으로는 보류하고
                                    // 카운터로 누적 판정.
                                    this._pendingContinuePausedSeen++;
                                    if (this._pendingContinuePausedSeen >= 3) {
                                        isRealStop = true;
                                        this._log(`Continue 후 ${t.name} origin 없이 ${this._pendingContinuePausedSeen}회 paused 관측 → 정지 처리`);
                                    }
                                } else if (detail.file !== origin.file || detail.fileLine !== origin.line) {
                                    isRealStop = true;
                                    this._log(`Continue 후 위치 변경 감지: ${origin.file}:${origin.line} → ${detail.file}:${detail.fileLine}`);
                                } else {
                                    this._pendingContinuePausedSeen++;
                                    if (this._pendingContinuePausedSeen >= 3) {
                                        isRealStop = true;
                                        this._log(`Continue 후 ${t.name} 같은 위치(${detail.file}:${detail.fileLine})에서 ${this._pendingContinuePausedSeen}회 paused → 정지 처리 (루프 재히트 또는 잔재 지속)`);
                                    }
                                }
                            } else {
                                // 위치 조회 실패 — 카운터 누적
                                this._pendingContinuePausedSeen++;
                                if (this._pendingContinuePausedSeen >= 3) {
                                    isRealStop = true;
                                    this._log(`Continue 후 ${t.name} 위치 조회 불가 + ${this._pendingContinuePausedSeen}회 paused → 정지 처리`);
                                }
                            }
                        }

                        if (isRealStop) {
                            this._pendingAction = null;
                            this._pendingThreadId = undefined;
                            this._pendingContinueSawRunning = false;
                            this._pendingContinuePausedSeen = 0;
                            this._continueOrigin.delete(t.name);

                            if (!this._configurationDone) {
                                this._queuedStoppedEvents.push({ reason: 'breakpoint', threadId: id });
                                this._log(`쓰레드 ${t.name} Continue 후 정지 감지 → configurationDone 대기 중`);
                            } else {
                                this.sendEvent(new StoppedEvent('breakpoint', id));
                                this._log(`쓰레드 ${t.name} 정지 (breakpoint)`);
                            }

                            this._previousThreadStates.set(t.name, t.state);
                            if (t.state !== prevState) { threadStateChanged = true; }
                            continue;
                        }
                    }
                }

                // Step 명령은 폴링 사이에 Running 상태를 놓칠 수 있으므로,
                // pending step 상태에서 다시 paused/break가 보이면 step 완료로 처리한다.
                if (this._pendingAction === 'step' && this._pendingThreadId === id && isPausedState) {
                    const reason = await this._resolveStopReasonForThread(t.name, 'step');
                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinueSawRunning = false;

                    if (!this._configurationDone) {
                        this._queuedStoppedEvents.push({ reason, threadId: id });
                        this._log(`쓰레드 ${t.name} 스텝 완료 감지 (${reason}) → configurationDone 대기 중`);
                    } else {
                        this.sendEvent(new StoppedEvent(reason, id));
                        this._log(`쓰레드 ${t.name} 정지 (${reason})`);
                    }

                    this._previousThreadStates.set(t.name, t.state);
                    if (t.state !== prevState) { threadStateChanged = true; }
                    continue;
                }

                // Detect transition to Paused/Break state
                if (isPausedState &&
                    prevState !== 'Break' && prevState !== 'Paused') {

                    // Determine stop reason based on pending action
                    let reason = 'breakpoint';
                    if (this._pendingAction === 'step' && this._pendingThreadId === id) {
                        reason = await this._resolveStopReasonForThread(t.name, 'step');
                    } else if (this._pendingAction === 'pause' && this._pendingThreadId === id) {
                        reason = 'pause';
                    } else if (this._pendingAction === 'entry') {
                        reason = 'entry';
                    }

                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinueSawRunning = false;

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
                    this._pendingContinueSawRunning = false;

                    await this._emitErrorLocationEvent(id, t.name, t.lastStatus || 'Error');

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
                if (t.state !== prevState) { threadStateChanged = true; }
            }
            if (threadStateChanged) {
                this.sendEvent(new InvalidatedEvent(['threads']));
            }
        } finally {
            this._pollInFlight = false;
            this._lastPollCompletedAt = Date.now();
            // ④ 이번 폴 진행 중 유실된 트리거가 있으면 즉시 1회 재폴 (30ms 뒤, force)
            if (this._pollRetryRequested) {
                this._pollRetryRequested = false;
                if (this._isConnected && this._pendingAction) {
                    setTimeout(() => { void this._pollThreadStates(true); }, 30);
                }
            }
        }
    }

    /**
     * Run build-only deploy before attach.
     */
    private async _runDeployBeforeAttach(args: IAttachRequestArguments): Promise<boolean> {
        const projectDir = await this._resolveDeployProjectDir(args);
        if (!projectDir) {
            this._log('[deploy] 배포할 Project.gpr 폴더를 찾지 못했습니다.');
            return false;
        }

        const deployDiagnostics = getDebugDeployDiagnostics();
        const deployOutput = getDeployOutputChannel();

        this._log(`[deploy] Attach 전 배포 시작: ${projectDir}`);
        const result = await deploy(
            {
                projectDir,
                skipStart: true,
                skipUnchanged: args.skipUnchangedOnDeploy,
                // flash 경유 없이 /GPL/<name>에 직접 미러 동기화한다(변경분만 업로드 + 원격 전용 파일 삭제).
                // Attach 전 STOP은 그대로 수행되므로 쓰레드 락(-750) 없이 안전하며,
                // /GPL/<name>이 아직 없으면(최초 배포) deploy()가 classic(flash + Load) 경로로 자동 폴백한다.
                directGpl: true,
            },
            deployOutput,
            deployDiagnostics,
            undefined,
            this._config,
        );

        if (!result.success) {
            this._log(`[deploy] 실패: ${result.compileErrors.length}개 컴파일 에러`);
            if (result.failedPhase) {
                this._log(`[deploy] 실패 단계: ${result.failedPhase}`);
            }
            if (result.failedCommand) {
                this._log(`[deploy] 실패 명령: ${result.failedCommand}`);
            }
            if (typeof result.failedStatusCode === 'number') {
                this._log(`[deploy] STATUS: ${result.failedStatusCode} (${result.failedStatusMessage || 'Unknown'})`);
            } else if (result.failedStatusMessage) {
                this._log(`[deploy] 사유: ${result.failedStatusMessage}`);
            }
            if (result.attemptedProjectNames && result.attemptedProjectNames.length > 0) {
                this._log(`[deploy] 후보 이름 시도 순서: ${result.attemptedProjectNames.join(' -> ')}`);
            }
            if (result.trace.length > 0) {
                this._log('[deploy] --- raw trace begin ---');
                for (const line of result.trace) {
                    this._log(`[deploy] ${line}`);
                }
                this._log('[deploy] --- raw trace end ---');
            }
            for (const err of result.compileErrors) {
                this._log(`[deploy]   ${err.file}:${err.line} (${err.code}): ${err.message}`);
            }
            if (result.errorLog.length > 0) {
                for (const el of result.errorLog) {
                    this._log(`[deploy]   ${el}`);
                }
            }

            // 컴파일 에러가 있으면 첫 에러 위치로 점프하고 Problems 패널을 띄운다.
            // (수동 Deploy 경로와 동일한 UX. 설정 gpl.deploy.jumpToFirstError로 토글.)
            if (result.compileErrors.length > 0) {
                const jumpEnabled = vscode.workspace
                    .getConfiguration('gpl')
                    .get<boolean>('deploy.jumpToFirstError', true);
                if (jumpEnabled) {
                    const first = result.compileErrors[0];
                    try {
                        const filePath = resolveErrorFilePath(first.file, projectDir);
                        const doc = await vscode.workspace.openTextDocument(filePath);
                        const editor = await vscode.window.showTextDocument(doc, { preview: false });
                        const targetLine = Math.max(0, first.line - 1);
                        const range = doc.lineAt(Math.min(targetLine, doc.lineCount - 1)).range;
                        editor.selection = new vscode.Selection(range.start, range.start);
                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                    } catch (jumpErr: any) {
                        this._log(`[deploy] 첫 에러 파일 열기 실패: ${jumpErr?.message ?? jumpErr}`);
                    }
                    await vscode.commands.executeCommand('workbench.actions.view.problems');
                }
            }

            deployOutput.show(true);
            return false;
        }

        if (!this._projectName && result.projectName) {
            this._projectName = result.projectName;
            this._log(`[deploy] 프로젝트 설정: ${this._projectName}`);
        }

        this._log(`[deploy] 성공: ${result.projectName}`);
        return true;
    }

    /**
     * Choose deploy project directory from args/workspace.
     */
    private async _resolveDeployProjectDir(args: IAttachRequestArguments): Promise<string | undefined> {
        if (args.projectDir && fs.existsSync(args.projectDir)) {
            return args.projectDir;
        }

        const dirs = await findProjectDirs();
        if (dirs.length === 0) {
            return undefined;
        }
        if (dirs.length === 1) {
            return dirs[0];
        }

        // 1) projectName 우선 매칭
        if (args.projectName) {
            const target = args.projectName.toLowerCase();
            for (const dir of dirs) {
                const byFolder = path.basename(dir).toLowerCase() === target;
                let byGpr = false;
                try {
                    const gprFiles = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.gpr'));
                    for (const gprFile of gprFiles) {
                        const gprText = fs.readFileSync(path.join(dir, gprFile), 'utf-8');
                        if ((parseGpr(gprText).projectName || '').toLowerCase() === target) {
                            byGpr = true;
                            break;
                        }
                    }
                } catch {
                    // ignore parse errors and continue fallback matching
                }
                if (byFolder || byGpr) {
                    return dir;
                }
            }
        }

        // 2) 활성 파일 기준 매칭
        const activePath = vscode.window.activeTextEditor?.document?.uri.scheme === 'file'
            ? vscode.window.activeTextEditor.document.uri.fsPath
            : '';
        if (activePath) {
            const matched = dirs
                .filter(d => this._isPathUnder(activePath, d))
                .sort((a, b) => b.length - a.length)[0];
            if (matched) {
                return matched;
            }
        }

        // 3) deterministic fallback
        return [...dirs].sort((a, b) => a.localeCompare(b))[0];
    }

    /**
     * Preflight for stable debugging sessions.
     */
    private async _runAttachPreflight(stopAll: boolean, clearProjectBps: boolean): Promise<void> {
        if (!this._isConnected) { return; }

        if (stopAll) {
            const stopResp = await this._sendCmd('Stop -all');
            if (stopResp) {
                this._log('attach preflight: Stop -all 완료');
            } else {
                this._log('attach preflight: Stop -all 실패(계속 진행)');
            }
        }

        if (clearProjectBps && this._projectName) {
            await this._clearBreakpointsForProject(this._projectName);
        }
    }

    /**
     * Clear all controller breakpoints for the specified project.
     */
    private async _clearBreakpointsForProject(projectName: string): Promise<void> {
        const showResp = await this._sendCmd('Show Break');
        if (!showResp) {
            this._log('attach preflight: Show Break 실패(브레이크포인트 정리 스킵)');
            return;
        }

        const controllerBps = parseBreakList(showResp).filter(
            b => (b.project || '').toLowerCase() === projectName.toLowerCase(),
        );

        if (controllerBps.length === 0) {
            this._log(`attach preflight: ${projectName} 브레이크포인트 없음`);
            return;
        }

        let cleared = 0;
        for (const bp of controllerBps) {
            const file = bp.file || '';
            const line = bp.fileLine || 0;
            if (!file || line <= 0) { continue; }
            const resp = await this._sendCmd(`Set Nobreak ${projectName} "${file}"${line}`);
            if (resp) { cleared++; }
        }

        this._log(`attach preflight: ${projectName} 브레이크포인트 ${cleared}/${controllerBps.length} 정리`);
    }
}
