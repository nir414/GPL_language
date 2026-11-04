/**
 * GPL Debug Adapter – Brooks 제어기 DAP 세션.
 *
 * DebugAdapterInlineImplementation과 함께 사용되어 extension 프로세스 내에서 실행된다.
 * Brooks TCP 콘솔 명령(포트 1402)을 통해 디버깅 프로토콜을 구현한다.
 */

import { LoggingDebugSession, Event, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, ThreadEvent, Thread, StackFrame, Scope, Source, Breakpoint, InvalidatedEvent, ContinuedEvent } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import * as vscode from 'vscode';
import { sendCommand, sendCommandDetailed, getControllerConfig, ControllerConfig, probeControllerCommand, getConnectionProbeTimeoutMs } from '../../controller/connection/controllerConnection';
import type { ProbeOutcome } from '../../controller/connection/controllerConnection';
import { checkProjectName, describeProjectNameProblem } from '../../controller/projects/projectNameGuard';
import { gprPathInDir } from '../../project/sources/projectSources';
import { normalizeBreakpointCommandFile } from '../../controller/debugging/breakpointCommand';
import { breakpointKey, isResolvedBreakpointRecord } from '../../controller/debugging/breakpointReconcile';
import { getRemoteSourceSession } from '../../controller/files/remoteSourceSession';
import { getDeployLock } from '../../controller/deployment/deployLock';
import { requestDeployCancellation } from '../../controller/deployment/deployCancellation';
import { activeOperations } from '../../controller/automation/operationStore';
import { stopAllAndSettle } from '../../controller/threads/threadStop';
import { parseThreadList, parseThreadDetail, SHOW_THREAD_LIST_CMD, parseBreakList, isSuccess, parseStatus, NO_STATUS_CODE, StackFrameInfo } from '../../controller/protocol/responseParser';
import type { ThreadInfo } from '../../controller/protocol/responseParser';
import { ciEq } from '../../language/syntax/identifiers';
import { isReadOnlyConsoleCommand } from '../../controller/commands/consoleCommandClassifier';
import { fireDebugThreadsUpdated, fireDebugProbeResult, onDebugPollTrigger } from '../../controller/debugging/debugBridge';
import { onDidRecordCompiled } from '../../controller/deployment/deployRecord';
import { shouldGateStepRequest, StepGateReason } from '../execution/stepGate';
import { LaneQueue, CommandLane } from './commandLanes';
import { formatResumeTiming, ResumeTiming, StopPollSource } from '../execution/pollSchedule';
import { formatEvalError, describeNestedExpandFailure, UNDEFINED_SYMBOL_STATUS } from '../evaluation/evalMessages';
import { formatReplBatchResults, parseReplInput } from '../evaluation/replInput';
import { SpontaneousPauseTracker } from '../execution/spontaneousPause';
import { isAllThreadsResumeRequest, resolveExecutionThread, shouldPreserveFocus } from '../execution/threadLock';
import { buildStartCommand, commandRunsCompiler } from '../../controller/commands/startCommand';
import { breakpointCandidateLines, enclosingProcedure, parseCallTargets, resolveBreakpointLine } from '../execution/sourceTargets';
import { classifyVarEntry, dapColorizeType } from '../evaluation/showVariableParser';
import type { SessionSourcesHost } from './sessionSources';
import { SessionSources } from './sessionSources';
import { SourceSymbolIndex } from '../evaluation/sourceSymbolIndex';
import type { VariableEvaluatorIo } from '../evaluation/variableEvaluator';
import { VariableEvaluator } from '../evaluation/variableEvaluator';
import { FrameCache } from './frameCache';
import { ThreadRegistry } from './threadRegistry';
import type { BreakpointMeta } from './sessionBreakpoints';
import { SessionBreakpoints } from './sessionBreakpoints';
import { SourceStalenessTracker } from './sourceStaleness';
import type { PollHost } from '../execution/pollDriver';
import { PollDriver } from '../execution/pollDriver';
import type { IAttachRequestArguments } from './attachPreflight';
import { AttachPreflight } from './attachPreflight';
import { ErrorLocationReporter } from './errorLocation';

// ─── Launch/Attach argument interfaces ───────────────────

// ─── Scope handle payload ────────────────────────────────

// ─── Pending action for StoppedEvent reason ──────────────

type PendingAction = 'step' | 'pause' | 'entry' | 'continue' | null;

// ─── Source staleness (GitHub #21) ──────────────────────

// ─── 조건부 BP / 로그포인트 (클라이언트 측 흉내) ────────────

// ─── Session ─────────────────────────────────────────────

export class GPLDebugSession extends LoggingDebugSession {

    // Controller config
    private _config: ControllerConfig | undefined;

    // Project context — required for breakpoint commands
    private _projectName = '';

    private _previousThreadStates = new Map<string, string>();
    private _isConnected = false;

    private _pollInFlight = false;
    // ② 폴 디바운스: 마지막 폴 완료 시각 + 최소 간격. force=false 트리거(1403/interval
    //    중복)가 이 간격 내면 스킵해 Show Thread 중복 발사를 줄인다. fast poll은 force=true로 우회.
    private _lastPollCompletedAt = 0;

    // ④ 1403 트리거 유실 방지: 폴이 가드(_pollInFlight/_userActionInFlight)에 막혀
    //    스킵됐을 때 pending 액션이 있으면 표시해 두고, 폴 완료 직후 1회 재폴한다.
    private _pollRetryRequested = false;

    // ⑤ Show Thread 목록 캐시: 정지 감지 폴이 방금 가져온 목록을 StoppedEvent 직후
    //    VS Code가 부르는 threadsRequest에서 재사용 — TCP 왕복 1회 제거.
    private _lastThreadList: ReturnType<typeof parseThreadList> | null = null;
    private _lastThreadListAt = 0;
    private static readonly THREAD_LIST_CACHE_TTL_MS = 300;
    // 정지 확인 뒤(pending 없음)에는 목록이 정지 중 인터벌 폴로 계속 갱신되므로 더 길게 재사용한다(2026-11-04 — 정지 감지 뒤
    // Show Stack 왕복이 300 ms 를 넘으면 threadsRequest 가 Show Thread 를 한 번 더 보냈다).
    private static readonly THREAD_LIST_CACHE_STOPPED_TTL_MS = 1500;

    // Controller console is effectively single-request-at-a-time.
    // 세션 안의 모든 명령은 차선 큐(commandLanes.ts)로 직렬화한다 — control(Step/Continue/폴/스택)이 data(변수·Watch·전역
    // 조회)보다 먼저 나가고, 실행 재개 시 아직 보내지 않은 data 조회는 버린다(2026-10-26 "다음 줄로 넘기는 데 한참" 보고).
    private readonly _lanes = new LaneQueue({ failureCooldownMs: 100 });
    /** 직전 제어기 명령의 큐 대기·왕복 시간 — 재개 타이밍 로그(_resumeTiming)용. */
    private _lastCmdTiming: { command: string; queueWaitMs: number; commandMs: number; doneAt: number } | undefined;
    /** 사용자 재개 액션(step/continue/pause)의 타이밍 — 정지 감지 시 한 줄로 기록하고 비운다(pollSchedule.formatResumeTiming). */
    private _resumeTiming: ResumeTiming | null = null;

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

    // 마지막 Continue/Step 시각 — gplThreadInfo가 msSinceResume으로 노출.
    // 확장이 재개 직후 VS Code의 자동 포커스 전환(사용자 클릭 아님)을 걸러내는 데 쓴다.
    private _lastResumeAt = 0;

    // Continue 후 sawRunning=false 상태에서 paused로 관측된 연속 횟수.
    // 같은 위치에서 CONTINUE_PAUSED_CONFIRM_COUNT회 연속 paused면 잔재 상태가 너무
    // 오래 지속되었거나 동일 BP 재히트로 보고 정지로 인정 (마지막 안전망).
    private _pendingContinuePausedSeen = 0;
    /** 연속 paused 관측을 '정지'로 확정하기까지의 횟수 임계값. */
    private static readonly CONTINUE_PAUSED_CONFIRM_COUNT = 3;

    // 사용자 액션(step/continue/pause/disconnect) 처리 중 플래그.
    // 이 플래그가 켜져 있으면 Show Thread 폴링을 보류해서 1402 큐에
    // 사용자 명령이 폴 뒤에 끼는 지연을 방지한다.
    private _userActionInFlight = false;

    // GitHub #28: Step/Continue 게이트. 2026-08-25 16:23 실측 — F12 홀드(키 자동 반복)로 Step 이 31ms 간격
    // 325건/22.5초 송신되어 제어기가 다운됐다. _userActionInFlight 는 송신 중(6~12ms)에만 true 라 키 반복을
    // 막지 못하므로, "이전 step/continue 의 정지 확인 전(_pendingAction 유지 중)" 또는 "최소 간격 미달"이면
    // 새 요청을 제어기에 보내지 않고 응답만 success 로 돌려준다(에러 응답은 키 반복 중 팝업 폭주를 만든다).
    // GDE 도 정지 확인 전에는 Step 버튼이 비활성화된다. 판정은 stepGate.ts(순수 함수, 단위 테스트 대상).
    private static readonly DEFAULT_MIN_STEP_INTERVAL_MS = 100;
    private _minStepIntervalMs = GPLDebugSession.DEFAULT_MIN_STEP_INTERVAL_MS;
    // 게이트로 무시한 요청 수 — 첫 건과 이후 50건마다 로그, pending 해소 시 요약 후 0
    private _stepGateIgnored = 0;
    private static readonly STEP_GATE_LOG_EVERY = 50;
    // 이 쓰레드에 pending 이 없는 상태(최소 간격 게이트)에서 무시한 요청의 UI 복귀용 StoppedEvent 재발사 예약(쓰레드별)
    private _gateResyncTimers = new Map<number, ReturnType<typeof setTimeout>>();

    // 스레드 단일 실행 잠금(threadLock.ts). 값이 있으면 Continue/Step 은 어느 스레드가 포커스든
    // 이 스레드에만 나가고, 다른 스레드의 정지는 포커스를 훔치지 않는다(preserveFocusHint).
    // UI 는 확장 쪽 gpl.debug.lockThread / CALL STACK 메뉴 / 상태바가 제공한다(custom request 로 연동).
    private _lockedThreadName: string | undefined;
    // 잠금 때문에 대상을 되돌린 횟수 — 첫 건만 Debug Console 에 남기고 이후는 조용히(키 반복 로그 폭주 방지)
    private _lockRedirectCount = 0;

    // 자동 재개 횟수(세션 누적) — 첫 건과 이후 일정 간격으로만 로그를 남긴다.
    private _autoResumeCount = 0;

    // ── Jump to Cursor / Step Into Target 의 대상 핸들 ───────────────────────────
    private _gotoTargetHandles = new Map<number, { file: string; line: number; procedure: string }>();
    private _stepInTargetHandles = new Map<number, { label: string; file: string; line: number }>();
    private _targetIdCounter = 0;

    // Session-level disposables — disconnectRequest에서 정리
    private _disposables: vscode.Disposable[] = [];

    // GPL 의 `Paused` 는 디버거 정지 전용 상태가 아니다 — `Thread.Sleep` 등으로 스케줄러가 재운
    // 쓰레드도 Paused 로 보고된다(실측 2026-08-31: 같은 폴 루프를 도는 쓰레드들이 샘플마다
    // Running↔Paused 를 오가고, Paused 인 채로 줄 번호가 818→819 로 전진했다. 그 파일에는 BP 가
    // 하나도 없었다). 사용자 액션 없이 관측된 Paused 를 그대로 정지로 알리면 BP 없는 파일에서
    // 가짜 브레이크가 뜨므로, 등록된 BP 줄과 일치할 때만 즉시 인정하고 나머지는 아래 관측으로 미룬다.
    // 판정 규칙과 근거는 debug/execution/spontaneousPause.ts 참조(단위 테스트 있음).
    // 등록 BP 와 무관한 위치에서 이만큼 연속 관측되면 외부 정지(GDE·MCP `Break` 등)로 보고 인정한다.
    // 스케줄러 대기는 폴 간격(수백 ms)마다 위치가 바뀌거나 Running 이 섞이므로 이 문턱을 넘지 않는다.
    private static readonly SPONTANEOUS_PAUSE_CONFIRM_POLLS = 3;
    // 같은 위치에 머물러야 하는 최소 시간. 1403 트리거로 폴이 POLL_MIN_GAP_MS(250ms)까지 빨라질 수
    // 있어 횟수만으로는 1초도 안 되는 창에서 확정될 수 있다 — 짧은 Sleep 을 외부 정지로 오인하지 않게 한다.
    private static readonly SPONTANEOUS_PAUSE_CONFIRM_MS = 1500;
    private _spontaneousPause = new SpontaneousPauseTracker(
        GPLDebugSession.SPONTANEOUS_PAUSE_CONFIRM_POLLS,
        GPLDebugSession.SPONTANEOUS_PAUSE_CONFIRM_MS,
    );

    // Exception breakpoints — whether to break on runtime errors
    private _breakOnErrors = true;

    // Consecutive poll failures — auto-terminate after threshold.
    // 2026-08-28: 5 → 3 으로, 확장의 연결 건강 모니터(controller/connection/connectionHealth.ts failureThreshold=3)와 맞춘다 —
    // 폴 결과는 debugBridge.fireDebugProbeResult 로도 보고되므로 어댑터의 세션 종료와 확장의 유실 판정이 같은 시점에 난다.
    // 폴은 명령 timeoutMs(10 s) 대신 프로브 타임아웃(gpl.controller.connectionProbeTimeoutMs, 기본 8 s)을 쓴다.
    private _pollFailures = 0;
    private static readonly MAX_POLL_FAILURES = 3;
    private _probeTimeoutMs = 8000;

    // DAP protocol gate — StoppedEvent must not fire before configurationDone
    private _configurationDone = false;
    private _queuedStoppedEvents: { reason: string; threadId: number }[] = [];
    private _stopOnEntry = false;
    // 디버거 분리 시 제어기 측 프로그램도 정지할지 여부(attach args로 설정).
    private _stopAllOnDisconnect = false;
    private _startOnAttach = true;

    // Start 스위치(launch 구성에서 옴 — 문서 구문은 startCommand.ts 참조)
    private _startStackSizeKb: number | undefined;
    private _startShowInitStatements = false;
    private _startTrace = false;

    // Debug pre-deploy 진단은 모듈 공용 컬렉션(getDebugDeployDiagnostics)을 사용한다.
    private _lastControllerCommand = '';

    // ── 협력자(2026-10-27 분해) ──────────────────────────────────────────
    // 세션은 DAP 요청 처리와 정지 상태 머신(_pollThreadStates·pending 액션·게이트·잠금)만 직접 들고, 나머지 책임은
    // 아래 모듈이 맡는다. 모듈은 세션 상태를 _io(읽기 전용 getter + 명령/로그/이벤트)로만 본다 — 정본은 여전히 세션 필드다.
    private readonly _io: SessionSourcesHost & VariableEvaluatorIo & PollHost;
    private readonly _sources: SessionSources;
    private readonly _symbols: SourceSymbolIndex;
    private readonly _frames: FrameCache;
    private readonly _evaluator: VariableEvaluator;
    private readonly _threads = new ThreadRegistry();
    private readonly _bps: SessionBreakpoints;
    private readonly _stale: SourceStalenessTracker;
    private readonly _poll: PollDriver;
    private readonly _attach: AttachPreflight;
    private readonly _errors: ErrorLocationReporter;

    constructor() {
        super('gpl-debug.txt');
        // GPL uses 1-based lines and columns
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);

        const self = this;
        this._io = {
            get config() { return self._config; },
            get projectName() { return self._projectName; },
            get isConnected() { return self._isConnected; },
            get lastControllerCommand() { return self._lastControllerCommand; },
            get pendingAction() { return self._pendingAction; },
            get pollInFlight() { return self._pollInFlight; },
            get lastPollCompletedAt() { return self._lastPollCompletedAt; },
            get lastThreadList() { return self._lastThreadList; },
            get dataQueryPending() { return self._lanes.stats().dataPending > 0; },
            sendCmd: (command, lane) => self._sendCmd(command, lane),
            log: message => self._log(message),
            sendEvent: event => self.sendEvent(event),
            pollThreadStates: (force, source) => self._pollThreadStates(force, source),
            workspaceFolderPaths: () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
            activeFilePath: () => {
                const doc = vscode.window.activeTextEditor?.document;
                return doc?.uri.scheme === 'file' ? doc.uri.fsPath : '';
            },
            onSourceSetChanged: scope => {
                // 소스 구성이 바뀌면 전역 열거/조회 메모도 무효 — 파일 추가·이동·프로젝트 변경 대응.
                if (scope === 'all') { self._evaluator.globalQueryMemo.clear(); }
                self._symbols.invalidate();
            },
            integerHexEnabled: () => vscode.workspace.getConfiguration('gpl').get<boolean>('debug.integerHex', false) === true,
            confirmStateChangingCommand: async expression => {
                if (!vscode.workspace.getConfiguration('gpl').get<boolean>('debug.confirmDestructiveRepl', true)) { return true; }
                const pick = await vscode.window.showWarningMessage(
                    `제어기 상태를 바꾸는 명령입니다: ${expression}`,
                    { modal: true },
                    '전송',
                );
                return pick === '전송';
            },
        };
        this._sources = new SessionSources(this._io);
        this._symbols = new SourceSymbolIndex(this._sources);
        this._frames = new FrameCache(this._io);
        this._evaluator = new VariableEvaluator(this._io, this._symbols, this._frames);
        this._bps = new SessionBreakpoints(this._io, this._sources);
        this._stale = new SourceStalenessTracker(this._io, this._sources, this._bps);
        this._poll = new PollDriver(this._io, this._frames);
        this._attach = new AttachPreflight(this._io, this._sources, this._bps);
        this._errors = new ErrorLocationReporter(this._io, this._frames);
    }

    // ═══════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════

    protected override initializeRequest(
        response: DebugProtocol.InitializeResponse,
        _args: DebugProtocol.InitializeRequestArguments,
    ): void {
        response.body = response.body || {};

        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSetVariable = true;
        response.body.supportsTerminateRequest = false;
        // 디버그 툴바의 정지(빨간 네모) — attach 세션에서 VS Code 는 Disconnect(플러그)만 놓고,
        // Stop 은 이 capability 가 true 일 때만 노출한다(workbench: DebugToolBarStop 메뉴의
        // when = focusedSessionIsAttach && terminateDebuggeeSupported). 이 값이 true 여야
        // disconnect 요청에 terminateDebuggee 플래그도 함께 온다(RawDebugSession.disconnect).
        response.body.supportTerminateDebuggee = true;
        // CALL STACK 쓰레드 우클릭 "스레드 종료" 활성화 — terminateThreadsRequest에서 Stop <이름> 전송
        response.body.supportsTerminateThreadsRequest = true;

        // BP 유효 줄 힌트 — 공식 문서(Set Break): "지정한 명령은 프로시저 안에 있어야 하고, 빈 줄이나
        // 주석을 지정하면 그 다음 실행 가능한 명령에 BP가 설정된다". 제어기가 조용히 옮기는 줄을
        // 로컬 파서로 미리 계산해 보여 준다(제어기 명령 없음 — sourceTargets.ts).
        response.body.supportsBreakpointLocationsRequest = true;

        // 프로시저 이름 브레이크포인트 — 파서로 이름 → 첫 실행 줄을 찾아 Set Break 로 변환한다.
        response.body.supportsFunctionBreakpoints = true;

        // Step Into Target — 현재 줄에 호출이 여러 개면 어느 호출로 들어갈지 고른다.
        // 제어기 Step 에는 대상 지정 스위치가 없으므로 정의 위치에 임시 BP + Continue 로 진입한다.
        response.body.supportsStepInTargetsRequest = true;

        // Jump to Cursor(다음 실행 문장 변경) — 문서상 `Set Thread <thread> -line <n>`.
        // 건너뛴 초기화 때문에 위험하므로 기본값은 실행 전 경고 확인(gpl.debug.jumpToCursor).
        response.body.supportsGotoTargetsRequest = this._jumpToCursorMode() !== 'off';

        // 값 전체 복사 — '값 복사'는 context='clipboard' 로 오며 표시용 축약 없이 원문을 준다.
        response.body.supportsClipboardContext = true;

        // 큰 호출 스택 지연 로딩 — startFrame/levels 를 존중하고 totalFrames 를 돌려준다.
        response.body.supportsDelayedStackTraceLoading = true;

        // 조건부 BP / 히트 조건 / 로그포인트: 제어기에 대응 명령이 없어 **확장이 흉내낸다**
        // (적중마다 조건 평가 + 불일치 시 자동 Continue). 자동 재개는 모션을 다시 움직이므로
        // 기본 OFF(gpl.debug.clientSideBreakpointLogic) — 끄면 관련 UI 자체가 나타나지 않는다.
        const clientSideBpLogic = this._clientSideBpLogicEnabled();
        response.body.supportsConditionalBreakpoints = clientSideBpLogic;
        response.body.supportsHitConditionalBreakpoints = clientSideBpLogic;
        response.body.supportsLogPoints = clientSideBpLogic;

        // Capabilities for step granularity (VS Code 기본 step-over/in/out 모두 지원)
        response.body.supportsSteppingGranularity = false;

        // 스레드 단일 실행: GPL 제어기의 실행 명령은 원래 스레드 단위(`Continue <이름>`)이며
        // 이 어댑터는 요청받지 않은 스레드를 재개하지 않는다. 다만 VS Code 1.135 본체에는
        // supportsSingleThreadExecutionRequests / singleThread 문자열이 없어(2026-08-28 확인)
        // 인자가 오지 않는다 — 실제 잠금 UI 는 확장 쪽 명령·CALL STACK 메뉴·상태바가 제공하고,
        // 이 선언은 인자를 보내는 다른 DAP 클라이언트를 위한 규약 표시다.
        response.body.supportsSingleThreadExecutionRequests = true;

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

    protected override setExceptionBreakPointsRequest(
        response: DebugProtocol.SetExceptionBreakpointsResponse,
        args: DebugProtocol.SetExceptionBreakpointsArguments,
    ): void {
        this._breakOnErrors = (args.filters || []).includes('runtimeErrors');
        this._log(`예외 브레이크포인트: ${this._breakOnErrors ? '활성' : '비활성'}`);
        response.body = { breakpoints: [] };
        this.sendResponse(response);
    }

    protected override async configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments,
    ): Promise<void> {
        super.configurationDoneRequest(response, args);
        this._configurationDone = true;

        // 기존 실행형 구성은 진입 중단 없이 시작한다. Attach Only는 startOnAttach=false로 이 경로를 끈다.
        if (this._startOnAttach && !this._stopOnEntry && this._projectName && this._isConnected) {
            // 자동 Start는 로봇 모션을 즉시 유발할 수 있으므로 기본값으로 모달 확인을 거친다
            // (설정 gpl.controller.requireStartConfirmation, 기본 true).
            const requireConfirm = vscode.workspace
                .getConfiguration('gpl')
                .get<boolean>('controller.requireStartConfirmation', true);
            let startApproved = true;
            if (requireConfirm) {
                const pick = await vscode.window.showWarningMessage(
                    `'${this._projectName}' 프로그램을 시작합니다. 로봇이 움직일 수 있습니다.`,
                    { modal: true },
                    'Start',
                );
                startApproved = pick === 'Start';
            }
            if (startApproved && !(await this._attach.waitDeployLockForStart('자동 Start'))) {
                // 다른 창/프로세스의 업로드/배포가 계속 잡혀 있음 — 업로드 도중 Start는 제어기 이상을 유발할 수 있어 보내지 않는다.
                vscode.window.showWarningMessage(
                    `Start 보류 — 다른 배포/업로드가 진행 중입니다. 완료 후 디버그 콘솔에서 >Start ${this._projectName} 를 사용하세요.`,
                );
            } else if (startApproved) {
                const startCmd = this._buildStartCommand({});
                this._log(`${startCmd} (auto-start after configurationDone)`);
                await this._sendCmd(startCmd);
                // Start 직후 곧바로 히트하는 BP(진입 부근 정지)를 빠르게 감지한다 (읽기 전용 폴).
                this._poll.fastPoll();
            } else {
                // 세션은 attach 상태 그대로 유지 — 사용자가 원할 때 수동으로 시작한다.
                this._log(
                    `Start가 취소되었습니다. 프로그램을 시작하려면 디버그 콘솔에서 >Start ${this._projectName} 를 사용하거나 `
                    + `설정 gpl.controller.requireStartConfirmation을 끄세요.`,
                );
            }
        }

        // configurationDone 이전에 큐에 쌓인 StoppedEvent 발사
        for (const ev of this._queuedStoppedEvents) {
            this.sendEvent(this._stoppedEvent(ev.reason, ev.threadId));
            this._log(`쓰레드 ${ev.threadId} 정지 (${ev.reason}) [지연 발사]`);
        }
        this._queuedStoppedEvents = [];

        this._log('Configuration done — 디버거 준비 완료');
    }

    // ═══════════════════════════════════════════════════════
    // Attach / Disconnect
    // ═══════════════════════════════════════════════════════

    protected override async attachRequest(
        response: DebugProtocol.AttachResponse,
        args: IAttachRequestArguments,
    ): Promise<void> {
        const baseCfg = getControllerConfig();
        this._config = {
            ...baseCfg,
            ip: args.controllerIp || baseCfg.ip,
            port: args.controllerPort ?? baseCfg.port,
        };
        this._sources.remoteSourceSession = undefined;
        this._sources.remoteProject = undefined;

        if (args.remoteSourceSessionId) {
            try {
                const remote = getRemoteSourceSession(args.remoteSourceSessionId);
                if (!remote || !ciEq(remote.host, this._config.ip)) {
                    throw new Error('원격 소스 세션과 제어기 연결 대상이 일치하지 않습니다.');
                }
                const gpr = args.projectDir && gprPathInDir(args.projectDir);
                const remoteGpr = gpr && remote.remotePathForLocal(gpr);
                if (!remoteGpr) { throw new Error('원격 소스 세션에 속한 프로젝트를 찾지 못했습니다.'); }
                const project = await remote.prepareProject(remoteGpr);
                if (args.projectName && !ciEq(args.projectName, project.projectName)) {
                    throw new Error('원격 프로젝트와 디버깅 대상 프로젝트 이름이 일치하지 않습니다.');
                }
                this._sources.remoteSourceSession = remote;
                this._sources.remoteProject = project;
                // 원격 소스는 현재 실행 코드에 연결한다. 구성 기본값으로 장비 상태가 바뀌지 않게 한다.
                args = {
                    ...args, projectName: project.projectName, projectDir: project.projectDir,
                    deployBeforeAttach: false, startOnAttach: false, stopOnEntry: false,
                    stopAllBeforeAttach: false, stopAllOnDisconnect: false,
                    clearProjectBreakpointsOnAttach: false, preserveExistingBreakpoints: true,
                };
            } catch (err) {
                this.sendErrorResponse(response, { id: 1006, format: `원격 소스 준비 실패: ${err instanceof Error ? err.message : String(err)}` });
                return;
            }
        }

        // 디버그 세션 폴링 간격은 사용자 설정을 우선하되,
        // 과도한 트래픽을 막기 위해 안전 범위(1s~5s)로 제한한다.
        // 즉시 반응이 필요한 step/continue는 _fastPoll()과 1403 트리거가 담당한다.
        const cfgSection = vscode.workspace.getConfiguration('gpl.controller');
        const userInterval = cfgSection.get<number>('threadPollIntervalMs') ?? 5000;
        this._poll.pollIntervalMs = Math.min(
            PollDriver.MAX_DEBUG_POLL_INTERVAL_MS,
            Math.max(PollDriver.MIN_DEBUG_POLL_INTERVAL_MS, userInterval),
        );
        this._probeTimeoutMs = getConnectionProbeTimeoutMs();
        this._log(
            `폴링 간격 적용: user=${userInterval}ms, effective=${this._poll.pollIntervalMs}ms ` +
            `(fast poll: ${PollDriver.FAST_POLL_DELAYS_MS.join('/')}ms, 런타임 콘솔 trigger: on data, ` +
            `프로브 타임아웃 ${this._probeTimeoutMs}ms · 연속 ${GPLDebugSession.MAX_POLL_FAILURES}회 실패 시 종료)`
        );

        // GitHub #28 / #22: 세션 동안 고정되는 디버그 설정 — attach 시 1회만 읽어 필드에 보관한다.
        const dbgCfg = vscode.workspace.getConfiguration('gpl.debug');
        const minStepRaw = dbgCfg.get<number>('minStepIntervalMs', GPLDebugSession.DEFAULT_MIN_STEP_INTERVAL_MS);
        this._minStepIntervalMs = typeof minStepRaw === 'number' && Number.isFinite(minStepRaw) && minStepRaw > 0
            ? Math.floor(minStepRaw)
            : 0;
        const backupRaw = dbgCfg.get<number>('runningBackupPollMs', PollDriver.DEFAULT_RUNNING_BACKUP_POLL_MS);
        this._poll.runningBackupPollMs = Math.max(
            PollDriver.MIN_RUNNING_BACKUP_POLL_MS,
            typeof backupRaw === 'number' && Number.isFinite(backupRaw)
                ? Math.floor(backupRaw)
                : PollDriver.DEFAULT_RUNNING_BACKUP_POLL_MS,
        );
        this._poll.backupPollPolicy = undefined;
        this._stepGateIgnored = 0;
        this._log(
            `Step 게이트: 정지 확인 전 요청 무시 + 최소 간격 ${this._minStepIntervalMs > 0 ? `${this._minStepIntervalMs}ms` : '없음'} (GitHub #28) / ` +
            `Running 백업 폴: 런타임 콘솔 부재 시 ${this._poll.runningBackupPollMs}ms, 정상 시 ${this._poll.pollIntervalMs}ms (GitHub #22)`,
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
            const deployResult = await this._attach.runDeployBeforeAttach(args);
            if (deployResult.projectName) { this._projectName = deployResult.projectName; }
            if (!deployResult.ok) {
                this.sendErrorResponse(response, {
                    id: 1003,
                    format: deployResult.cancelled
                        ? '실행 중인 쓰레드를 정지하지 않아 디버깅을 시작하지 않았습니다. 프로그램을 STOP한 뒤 다시 F5로 시작하세요.'
                        : 'Attach 전 배포(Upload/Compile)에 실패했습니다. Debug Console 로그를 확인하세요.',
                });
                return;
            }
        }

        // Detect project name: explicit arg → Project.gpr → Show Thread
        // (deployBeforeAttach가 배포 결과에서 이미 설정한 프로젝트명은 덮어쓰지 않는다)
        this._projectName = args.projectName || this._projectName || '';
        if (typeof args.projectDir === 'string' && args.projectDir.trim()) {
            this._sources.projectDirHint = args.projectDir.trim();
        }
        if (!this._projectName) {
            this._projectName = await this._sources.detectProjectName();
        }
        // 프로젝트명은 Start/Break/Show Global 등 모든 디버그 명령의 인자로 들어간다. 제어기 콘솔은 인자를
        // 공백으로 구분하므로 공백이 든 이름으로는 세션을 열지 않는다(명령이 끊겨 다른 대상을 건드릴 수 있음).
        if (this._projectName) {
            const nameCheck = checkProjectName(this._projectName);
            if (!nameCheck.ok) {
                const reason = describeProjectNameProblem(this._projectName, 'project', nameCheck);
                this._log(`✘ ${reason}`);
                this.sendErrorResponse(response, { id: 1004, format: `디버그 시작 중단 — ${reason}` });
                return;
            }
        }

        // Optional preflight: stop all threads and clear existing breakpoints for clean session.
        // clearProjectBreakpointsOnAttach 기본값: true (이전 세션의 잔재 BP로 인한 중복 설정 방지)
        const stopAllBeforeAttach = args.stopAllBeforeAttach === true;
        this._startOnAttach = args.startOnAttach !== false;
        this._bps.preserveExistingBreakpoints = args.preserveExistingBreakpoints === true;
        this._bps.preservedBreakpoints.clear();
        this._bps.preservedBreakpointResponse = '';
        const clearProjectBreakpointsOnAttach = !this._bps.preserveExistingBreakpoints && args.clearProjectBreakpointsOnAttach !== false;
        // 세션 종료(disconnect) 시 프로그램 정지 여부를 기억해 둔다.
        this._stopAllOnDisconnect = args.stopAllOnDisconnect === true;
        this._startStackSizeKb = typeof args.startStackSizeKb === 'number' ? args.startStackSizeKb : undefined;
        this._startShowInitStatements = args.startShowInitStatements === true;
        this._startTrace = args.startTrace === true;
        if (this._startTrace) {
            this._log('⚠ Start -trace: 실행 문장을 콘솔에 표시합니다 — 공식 문서가 성능 저하를 경고합니다(진단용).');
        }
        if (stopAllBeforeAttach || clearProjectBreakpointsOnAttach) {
            await this._attach.runAttachPreflight(stopAllBeforeAttach, clearProjectBreakpointsOnAttach);
        }

        // Build source file map for path resolution
        this._sources.updateProjectDirs();
        this._sources.buildSourceFileMap();

        if (this._bps.preserveExistingBreakpoints) {
            const existing = await this._sendCmd('Show Break');
            if (!existing || !existing.includes('</STATUS>') || !isSuccess(existing)) {
                this._isConnected = false;
                this.sendErrorResponse(response, { id: 1005, format: '기존 중단점 목록을 확인하지 못해 Attach를 중단했습니다.' });
                return;
            }
            this._bps.preservedBreakpointResponse = existing;
            for (const bp of parseBreakList(existing)) {
                if ((!bp.project || ciEq(bp.project, this._projectName)) && bp.file && bp.fileLine > 0) {
                    for (const form of this._bps.bpFileForms(bp.file)) {
                        this._bps.preservedBreakpoints.add(breakpointKey({ file: form, line: bp.fileLine }));
                    }
                }
            }
            this._log('기존 제어기 중단점 보존 — 이 세션이 추가한 중단점만 관리합니다.');
        }

        // GitHub #21: 로컬 소스가 제어기 컴파일 코드보다 새로운지 판정(Attach only 의 핵심 사용 사례).
        // deployBeforeAttach 성공 경로는 방금 기록이 갱신됐으므로 stale 이 없는 것이 정상이지만, 그래도
        // 호출해 빈 목록 이벤트로 상태바 배지를 정리한다. 이후 세션 중 저장·재컴파일에도 반응한다.
        this._stale.evaluateSourceStaleness('attach');
        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => this._stale.onSourceSavedInSession(doc.uri)),
            onDidRecordCompiled(rec => this._stale.onRecordCompiled(rec)),
        );

        // If stopOnEntry, start the project with -break to pause at Main's first line
        this._stopOnEntry = this._startOnAttach && !!args.stopOnEntry;
        if (this._stopOnEntry && this._projectName && !(await this._attach.waitDeployLockForStart('stopOnEntry Start'))) {
            // 다른 창/프로세스의 업로드/배포가 계속 잡혀 있음 — attach 상태는 유지하고 Start만 보내지 않는다.
            this._log(`⚠ stopOnEntry Start를 보내지 않았습니다. 배포/업로드 완료 후 디버그 콘솔에서 >Start ${this._projectName} -break -bex 를 사용하세요.`);
        } else if (this._stopOnEntry && this._projectName) {
            this._pendingAction = 'entry';
            // -break 진입 시작은 첫 줄에서 즉시 정지하므로(모션은 사용자가 continue해야 시작)
            // 자동 Start 확인 게이트(gpl.controller.requireStartConfirmation) 대상이 아니다.
            const entryStartCmd = this._buildStartCommand({ breakOnEntry: true, breakOnException: true });
            const startResp = await this._sendCmd(entryStartCmd);
            this._log(`${entryStartCmd} (stopOnEntry)`);
            if (startResp) {
                const cleaned = startResp.replace(/<[^>]+>/g, '').trim();
                if (cleaned) { this._log(`  Start 응답: ${cleaned.split(/\r?\n/)[0]}`); }
                // Start 실패 시 pending 'entry'를 즉시 해제 — 남겨두면 이후 무관한 정지가
                // 'entry'로 잘못 보고된다. (STATUS 없는 응답 -9999는 기존처럼 성공 취급)
                const st = parseStatus(startResp);
                if (st.code !== 0 && st.code !== NO_STATUS_CODE) {
                    this._pendingAction = null;
                    this._log(`⚠ Start 실패 (STATUS ${st.code}${st.message ? `: ${st.message}` : ''}) — entry 대기를 해제합니다.`);
                }
            } else {
                // 응답 유실(미연결/타임아웃) — entry 대기를 해제해 오분류를 막는다.
                this._pendingAction = null;
                this._log('⚠ Start 응답 없음 — entry 대기를 해제합니다.');
            }
        }

        this._log(
            `GPL Controller에 연결됨: ${this._config.ip}:${this._config.port}` +
            (this._projectName ? ` (프로젝트: ${this._projectName})` : '') +
            ` [폴링: ${this._poll.pollIntervalMs}ms]`,
        );
        this.sendEvent(new Event('gpl.controllerConnectionChanged', {
            connected: true,
            ip: this._config.ip,
            port: this._config.port,
            projectName: this._projectName,
        }));

        // Start fast polling to quickly detect entry break, then switch to normal
        this._poll.fastPoll();

        // 1403 데이터 도착 시 즉시 Show Thread 폴을 트리거.
        // step/continue 완료 신호(<E>N,N</E>)가 오면 폴링 타이머 대기 없이 바로 상태를 확인한다.
        this._disposables.push(
            onDebugPollTrigger(() => {
                if (!this._isConnected) { return; }
                if (this._pendingAction) {
                    // step/continue/entry/pause 대기 중 — force=true로 250ms 디바운스를
                    // 우회해 트리거가 유실되지 않도록 한다. (가드에 막히면
                    // _pollRetryRequested가 표시되어 직후 재폴된다)
                    this._log('[1403] 런타임 콘솔 데이터 감지 → 즉시 폴 트리거');
                    void this._pollThreadStates(true, '1403');
                } else {
                    // ⑦ pending 액션이 없어도 폴 — 자유 실행 중 BP 히트/다른 쓰레드 정지도
                    // 1403 상태 이벤트로 먼저 신호가 온다. 코얼레싱 예약이라 이벤트가
                    // 폭주해도 폴은 POLL_MIN_GAP_MS당 1회로 합쳐지고, 디바운스/가드에
                    // 걸린 트리거도 유실되지 않는다.
                    this._poll.requestTriggerPoll();
                }
            }),
        );

        this.sendResponse(response);

        // InitializedEvent를 여기서 전송 — VS Code는 이 이벤트 수신 후
        // setBreakPointsRequest를 보내므로 _projectName이 확실히 설정된 상태에서 처리된다.
        this.sendEvent(new InitializedEvent());
    }

    protected override async disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        args: DebugProtocol.DisconnectArguments,
    ): Promise<void> {
        this._poll.stopPolling();
        this._cancelGateResync(); // GitHub #28: 세션 종료 — 예약된 UI 복귀 재발사 전부 취소
        this._userActionInFlight = true;

        // Clear all breakpoints on the controller — 디버거 종료 후에 옛 BP가 잔존하면
        // 다음 세션에서 중복 등록될 수 있으므로 깔끔하게 정리한다.
        if (this._isConnected && this._projectName) {
            for (const [file, lines] of this._bps.breakpoints) {
                for (const line of lines) {
                    await this._bps.sendBpCommandWithFallback('Nobreak', this._projectName, file, line);
                }
            }
            this._log('모든 브레이크포인트 해제 완료');

            // 정지(Stop) 버튼은 terminateDebuggee=true 로 오고, 분리(Disconnect) 버튼·
            // vscode.debug.stopDebugging 은 플래그 없이 온다(attach 세션은 disconnect 로 내려간다).
            // 플래그가 없을 때만 구성값(stopAllOnDisconnect)을 따른다.
            const terminateDebuggee = args.terminateDebuggee === true;
            if (terminateDebuggee || this._stopAllOnDisconnect) {
                // 제어기 측 프로그램도 정지한다(정지 버튼, 또는 stopAllOnDisconnect=true).
                // STATUS 0 은 "정지 요청 접수"일 뿐이므로 정지 완료까지 확인한다(§0.6, controller/threads/threadStop.ts).
                const trigger = terminateDebuggee ? '정지 버튼' : 'stopAllOnDisconnect';
				const controllerId = this._config?.ip;
				if (controllerId) {
					const holder = getDeployLock(controllerId).current()?.record;
					const operationIds = new Set(activeOperations({ controllerId }).map(operation => operation.operationId));
					if (holder?.operationId) { operationIds.add(holder.operationId); }
					for (const operationId of operationIds) {
						requestDeployCancellation({ operationId, controllerId, reason: `디버그 ${trigger}` });
					}
					if (operationIds.size > 0) { this._log(`진행 중 배포 취소 요청 ${operationIds.size}건: ${[...operationIds].join(', ')}`); }
				}
                const outcome = await stopAllAndSettle(this._attach.threadStopIo());
                this._log(outcome.ok
                    ? `프로젝트 정지 완료 (${trigger} → Stop -all)${outcome.settle?.unconfirmed ? ' — Show Thread 무응답으로 확인은 못 함' : ''}`
                    : `Stop -all 후에도 정지가 확인되지 않았습니다 — ${outcome.failure?.message ?? '사유 미상'}`);
            } else {
                // 기본: Disconnect는 "VS Code 디버그 세션 종료"일 뿐 제어기 측 프로젝트 실행은 그대로 둔다.
                // 명시적으로 중지하려면 launch 구성에 stopAllOnDisconnect=true 를 주거나
                // GPL: 모든 쓰레드 중지 / 쓰레드 정지 명령을 사용한다.
                this._log('프로젝트 실행 유지 (디버거만 분리)');
            }
        }

        // GitHub #21: 상태바의 소스 변경 배지 정리(빈 목록 이벤트) + 세션 한정 stale/BP id 상태 초기화
        this._stale.staleFiles.clear();
        this._bps.bpIds.clear();
        this._stale.compiledRecordAt = undefined;
        this._stale.sendSourceStaleEvent('disconnect');

        this._bps.breakpoints.clear();
        this._spontaneousPause.clear();
        this._bps.bpRejectedFiles.clear();
        this._threads.knownThreadNames.clear();
        // 스레드 실행 잠금은 세션 한정 — 해제 이벤트로 확장 상태바까지 내린다.
        this._setLockedThread(undefined);
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

    protected override async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments,
    ): Promise<void> {
        let sourcePath = args.source.path || '';
        const clientLines = args.lines || [];
        if (this._sources.remoteSourceSession) {
            try {
                sourcePath = await this._sources.ensureRemoteSourcePath(sourcePath);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                response.body = { breakpoints: clientLines.map(line => ({ verified: false, line, message })) };
                this._log(`원격 BP 전송 생략: ${message}`);
                this.sendResponse(response);
                return;
            }
        }
        const baseName = path.basename(sourcePath);

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

        const sourceTarget = this._bps.resolveBreakpointTarget(sourcePath, clientLines[0] ?? 1);
        if (!sourceTarget || sourceTarget.kind !== 'direct-source' || !sourceTarget.file) {
            const message = sourceTarget?.message
                ?? `${baseName}을 ${proj}의 ProjectSource에서 찾을 수 없습니다.`;
            response.body = {
                breakpoints: clientLines.map(line => ({ verified: false, line, message }) as DebugProtocol.Breakpoint),
            };
            this._log(`⚠ BP 전송 생략: ${message}`);
            this.sendResponse(response);
            return;
        }
        const controllerFile = sourceTarget.file;
        const controllerFileKey = normalizeBreakpointCommandFile(controllerFile).toLowerCase();

        // Clear existing breakpoints for this file on the controller.
        // 로컬 _breakpoints Map만 믿으면 이전 세션 잔재/외부 변경으로 인해 누적될 수 있으므로,
        // 컨트롤러의 실제 BP 목록을 조회해 해당 파일의 모든 BP를 Nobreak로 정리한다.
        const existingLines = new Set<number>(this._bps.breakpoints.get(controllerFile) || []);
        const preShowResp = await this._sendCmd('Show Break');
        if (preShowResp) {
            const controllerBps = parseBreakList(preShowResp).filter(
                b => normalizeBreakpointCommandFile(b.file).toLowerCase() === controllerFileKey
                    && (!b.project || b.project.toLowerCase() === proj.toLowerCase()),
            );
            for (const bp of controllerBps) {
                if (bp.fileLine > 0) { existingLines.add(bp.fileLine); }
            }
        }
        for (const line of existingLines) {
            // 이 파일의 프로시저 이름 BP(함수 BP)는 별도 목록이 관리한다 — 파일 정리에 휩쓸리지 않게 남긴다.
            if (this._bps.functionBps.some(f => f.file.toLowerCase() === baseName.toLowerCase() && f.line === line)) {
                continue;
            }
            await this._bps.sendBpCommandWithFallback('Nobreak', proj, controllerFile, line);
        }

        // Set new breakpoints using correct Brooks syntax (GDE 캡처 기준):
        // Set Break project_name "file_name"line_number  (따옴표와 줄번호 사이 공백 없음)
        const actualBreakpoints: DebugProtocol.Breakpoint[] = [];
        const newLines = new Set<number>();
        // GitHub #21: 이 파일이 stale(제어기 컴파일 코드보다 새로움)이면 제어기에는 종전대로 Set Break 를 보내되
        // 응답에서 verified=false 로 강등한다 — 제어기는 옛 코드의 줄 번호로 받아 "성공"해도 실제 코드 줄과
        // 어긋날 수 있다. 재배포 후 onDidRecordCompiled 가 BreakpointEvent 로 verified=true 를 복원한다.
        const baseKey = baseName.toLowerCase();
        const staleEntry = this._stale.staleFiles.get(baseKey);
        const staleMessage = staleEntry ? this._stale.staleBreakpointMessage() : undefined;
        // BreakpointEvent('changed') 로 상태를 바꾸려면 id 가 필요 — 파일 단위로 새로 부여(직전 세트는 폐기)
        const idMap = new Map<number, number>();

        // 조건부 BP / 히트 조건 / 로그포인트 메타(설정이 꺼져 있으면 수집하지 않는다 — capability 미선언이라 오지도 않는다)
        const clientSideBpLogic = this._clientSideBpLogicEnabled();
        const metaForFile = new Map<number, BreakpointMeta>();

        for (const requestedLine of clientLines) {
            // 문서 규칙: 빈 줄·주석을 지정하면 제어기가 다음 실행 문장으로 옮긴다.
            // 어느 줄로 옮겨지는지 미리 계산해 그 줄로 설정하고 응답에도 그 줄을 돌려준다
            // (그러지 않으면 VS Code 의 BP 표시와 실제 정지 줄이 어긋난다).
            const adjusted = this._sources.adjustBreakpointLine(this._sources.remoteSourceSession ? sourcePath : baseName, requestedLine);
            const line = adjusted.line;
            if (clientSideBpLogic) {
                const src = (args.breakpoints ?? []).find(b => b.line === requestedLine);
                if (src && (src.condition || src.hitCondition || src.logMessage)) {
                    metaForFile.set(line, {
                        condition: src.condition,
                        hitCondition: src.hitCondition,
                        logMessage: src.logMessage,
                        hits: 0,
                    });
                }
            }
            const cmd = this._bps.bpCommand('Break', proj, controllerFile, line);
            // Nobreak 와 같은 폴백을 태운다(무공백/문서 표기 × basename/프로젝트 상대 경로) —
            // 종전에는 Break 만 basename 무공백 1회여서 표기를 가리는 제어기에서 조용히 실패했다.
            // 단, 이미 -508 로 거부된 파일은 표기 문제가 아니므로 1회만 시도해 왕복을 아낀다.
            const sendBreak = () => (!this._bps.preserveExistingBreakpoints && this._bps.bpRejectedFiles.has(baseKey)
                ? this._sendCmd(cmd)
                : this._bps.sendBpCommandWithFallback('Break', proj, controllerFile, line));
            const resp = await sendBreak();
            // "Duplicate breakpoint" 응답은 컨트롤러에 이미 동일 BP가 있다는 뜻이다.
            // Nobreak 정리가 실패했을 수 있으므로 한 번 더 정리 후 재설정하여 단일 BP 보장.
            let finalResp = resp;
            if (resp !== null && /Duplicate breakpoint/i.test(resp)) {
                this._log(`⚠ Duplicate BP 감지, 재설정: ${cmd}`);
                await this._bps.sendBpCommandWithFallback('Nobreak', proj, controllerFile, line);
                finalResp = await sendBreak();
            }
            const verified = finalResp !== null && isSuccess(finalResp);
            const bp = new Breakpoint(verified && !staleEntry, line) as DebugProtocol.Breakpoint;
            if (this._sources.remoteSourceSession) { bp.source = this._sources.dapSource(sourcePath); }
            bp.id = ++this._bps.bpIdCounter;
            idMap.set(line, bp.id);
            if (!verified) {
                const msg = finalResp
                    ? finalResp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0]
                    : '응답 없음';
                // -508 File not found 는 원문만으로는 원인을 알 수 없다. 라이브러리 소스면
                // 왜 안 되는지와 손 쓸 방법을 툴팁에 함께 준다 (파일당 1회만 로그).
                const notFound = finalResp !== null && parseStatus(finalResp).code === -508;
                const hint = notFound ? this._bps.librarySourceBpHint(baseName) : undefined;
                bp.message = hint ? `${msg} — ${hint}` : msg;
                if (notFound && !this._bps.bpRejectedFiles.has(baseKey)) {
                    this._bps.bpRejectedFiles.add(baseKey);
                    this._log(hint
                        ? `⚠ BP 설정 실패: ${cmd} → ${msg}\n  ${hint}`
                        : `⚠ BP 설정 실패: ${cmd} → ${msg}`);
                } else if (!notFound) {
                    this._log(`⚠ BP 설정 실패: ${cmd} → ${msg}`);
                }
            } else if (staleMessage) {
                bp.message = staleMessage;
            } else if (adjusted.moved) {
                // 옮겨진 이유를 알려 준다 — 사용자가 지정한 줄과 실제 정지 줄이 달라 보이는 것을 설명.
                bp.message = `요청한 ${requestedLine}줄은 빈 줄/주석이라 다음 실행 문장(${line}줄)에 설정했습니다(제어기 동작과 동일).`;
            }
            if (adjusted.moved) {
                this._log(`BP 줄 보정: ${baseName}:${requestedLine} → ${line} (빈 줄/주석 — 문서 규칙)`);
            }
            const meta = metaForFile.get(line);
            if (meta) {
                const kinds = [
                    meta.condition ? `조건 \`${meta.condition}\`` : undefined,
                    meta.hitCondition ? `히트 조건 \`${meta.hitCondition}\`` : undefined,
                    meta.logMessage !== undefined ? '로그포인트' : undefined,
                ].filter(Boolean).join(', ');
                this._log(`클라이언트 측 BP 로직: ${baseName}:${line} — ${kinds} (적중 시 평가 후 필요하면 자동 Continue)`);
            }
            actualBreakpoints.push(bp);
            if (verified) {
                newLines.add(line);
            }
        }

        this._bps.bpIds.set(baseKey, idMap);
        this._bps.breakpoints.set(controllerFile, newLines);
        this._bps.bpMeta.set(baseKey, metaForFile);
        if (staleEntry && newLines.size > 0) {
            this._log(`⚠ stale 파일 BP: ${baseName} [${[...newLines].join(', ')}] — 제어기에는 설정했으나 신뢰 불가 (${staleEntry.relPath}, GitHub #21)`);
        }

        // Show Break로 실제 제어기 상태 검증
        const showResp = await this._sendCmd('Show Break');
        if (showResp) {
            const controllerBPs = parseBreakList(showResp);
            const matching = controllerBPs.filter(b =>
                b.project.toLowerCase() === proj.toLowerCase()
                && normalizeBreakpointCommandFile(b.file).toLowerCase() === controllerFileKey);
            for (const bp of actualBreakpoints) {
                const line = bp.line ?? 0;
                const resolved = matching.some(b => b.fileLine === line && isResolvedBreakpointRecord(b));
                if (resolved) { continue; }
                bp.verified = false;
                bp.message = 'Controller accepted the breakpoint record, but it was not resolved to a procedure instruction.';
                newLines.delete(line);
            }
            this._bps.breakpoints.set(controllerFile, newLines);
            this._log(`브레이크포인트: ${controllerFile} → 요청 [${clientLines.join(', ')}] / 제어기 확인 [`
                + `${matching.map(b => `L${b.fileLine}:${b.proc || '?'}+${b.procLine}`).join(', ')}]`);
        } else {
            for (const bp of actualBreakpoints) {
                bp.verified = false;
                bp.message = 'Show Break 응답을 확인하지 못해 실제 procedure 연결 여부를 검증할 수 없습니다.';
            }
            newLines.clear();
            this._bps.breakpoints.set(controllerFile, newLines);
            this._log(`브레이크포인트: ${controllerFile} → [${[...newLines].join(', ')}] (Show Break 검증 불가)`);
        }

        response.body = { breakpoints: actualBreakpoints };
        this.sendResponse(response);
        this._bps.warnIfBreakpointLimitExceeded();
    }

    // ═══════════════════════════════════════════════════════
    // Threads
    // ═══════════════════════════════════════════════════════

    protected override async threadsRequest(
        response: DebugProtocol.ThreadsResponse,
    ): Promise<void> {
        // ⑤ 정지 감지 폴이 방금 가져온 목록이 신선하면 재사용 — StoppedEvent 직후
        //    VS Code가 부르는 threadsRequest의 TCP 왕복 1회를 제거한다.
        let threads: ReturnType<typeof parseThreadList>;
        const threadListTtl = this._pendingAction
            ? GPLDebugSession.THREAD_LIST_CACHE_TTL_MS
            : GPLDebugSession.THREAD_LIST_CACHE_STOPPED_TTL_MS;
        if (this._lastThreadList
            && Date.now() - this._lastThreadListAt < threadListTtl) {
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
        // 캐시 배열(_lastThreadList)을 제자리 정렬로 오염시키지 않도록 사본을 정렬한다.
        const sorted = [...threads].sort((a, b) => this._threads.threadStateRank(a.state) - this._threads.threadStateRank(b.state));
        const dapThreads: Thread[] = [];
        for (const t of sorted) {
            const id = this._threads.getOrCreateThreadId(t.name);
            // 여기서 VS Code에 이미 알려진 쓰레드는 known 집합에 등록해 다음 폴이
            // 중복 ThreadEvent('started')를 내지 않게 한다.
            this._threads.knownThreadNames.add(t.name);
            dapThreads.push(new Thread(id, this._threads.formatThreadLabel(t.name, t.state, this._lockedThreadName)));
        }

        response.body = { threads: dapThreads };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Stack Trace
    // ═══════════════════════════════════════════════════════

    protected override async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments,
    ): Promise<void> {
        const threadName = this._threads.threadIdToName.get(args.threadId);
        if (!threadName) {
            response.body = { stackFrames: [], totalFrames: 0 };
            this.sendResponse(response);
            return;
        }

        // step/continue 실행 중에는 TCP 명령을 보내지 않고 캐시된 프레임을 반환.
        // 이로써 직렬 큐에 Show Stack이 쌓이지 않아 폴링 지연이 없어진다.
        let frames: StackFrameInfo[];
        if (this._pendingAction === 'step' || this._pendingAction === 'continue') {
            frames = this._frames.cachedFrames.get(threadName) ?? [];
            this._log(`stackTraceRequest: pendingAction=${this._pendingAction}, 캐시 프레임 반환 (${frames.length}개)`);
        } else {
            // 맨 위 프레임만 묻는 요청(levels=1, 정지 직후 VS Code 의 첫 요청)은 Show Stack 응답을 기다리지 않는다 —
            // 폴 줄로 만든 잠정 맨 위 프레임으로 현재 줄을 먼저 보여 주고, 나머지 프레임 요청이 진행 중 조회에 합류한다.
            const topOnly = (args.startFrame ?? 0) === 0 && args.levels === 1
                ? this._frames.topFrameWithoutWaiting(threadName)
                : undefined;
            if (topOnly) {
                const f = topOnly.frame;
                let source: Source | undefined;
                if (f.file) {
                    if (this._sources.remoteSourceSession) {
                        try { await this._sources.ensureRemoteSourcePath(f.file); }
                        catch (err) { this._log(`스택 소스 준비 실패: ${err instanceof Error ? err.message : String(err)}`); }
                    }
                    source = this._sources.dapSource(f.file);
                }
                const frameId = this._frames.allocFrameId(threadName, 0);
                response.body = { stackFrames: [new StackFrame(frameId, f.process || '(unknown)', source, f.fileLine)] };
                this.sendResponse(response);
                return;
            }
            frames = await this._frames.getThreadFrames(threadName);
        }

        const startFrame = args.startFrame ?? 0;
        const levels = args.levels ?? frames.length;
        const endFrame = Math.min(startFrame + levels, frames.length);

        const dapFrames: StackFrame[] = [];
        for (let i = startFrame; i < endFrame; i++) {
            const f = frames[i];
            const frameId = this._frames.allocFrameId(threadName, f.frameIndex);

            let source: Source | undefined;
            if (f.file) {
                if (this._sources.remoteSourceSession) {
                    try { await this._sources.ensureRemoteSourcePath(f.file); }
                    catch (err) { this._log(`스택 소스 준비 실패: ${err instanceof Error ? err.message : String(err)}`); }
                }
                source = this._sources.dapSource(f.file);
            }

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

    protected override scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments,
    ): void {
        const frameInfo = this._frames.frameIdToInfo.get(args.frameId);
        const threadName = frameInfo?.threadName || this._findBreakThread() || '';
        const frameIndex = frameInfo?.frameIndex ?? 0;

        response.body = {
            scopes: [
                new Scope(
                    'Locals',
                    this._evaluator.variableHandles.create({ type: 'locals', threadName, frameIndex }),
                    false,
                ),
                new Scope(
                    'Globals',
                    this._evaluator.variableHandles.create({ type: 'globals', threadName, frameIndex }),
                    true,
                ),
            ],
        };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Variables
    // ═══════════════════════════════════════════════════════

    protected override async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments,
    ): Promise<void> {
        const scopeInfo = this._evaluator.variableHandles.get(args.variablesReference);
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
            const frames = await this._frames.getThreadFrames(scopeInfo.threadName);
            const frame = frames.find(f => f.frameIndex === scopeInfo.frameIndex);

            // 2) 소스 파일을 파싱해서 현재 프로시저의 변수 이름들을 수집한다
            const varNames = frame?.file
                ? this._symbols.getLocalVariableNames(frame.file, frame.fileLine, frame.process)
                : [];

            if (varNames.length > 0) {
                // 3) 각 변수를 개별 Show Variable로 조회 — 배열/객체는 트리로 확장 가능.
                //    실행이 재개되면(정지 컨텍스트 세대 변경) 남은 변수는 조회하지 않는다 — 값이 버려질 뿐 아니라
                //    다음 Step/폴이 그 뒤에 줄을 선다(2026-10-26).
                const stopGen = this._frames.frameCacheGen;
                for (const varName of varNames) {
                    if (this._pendingAction || stopGen !== this._frames.frameCacheGen) { break; }
                    const structured = await this._evaluator.queryVariableStructured(
                        scopeInfo.threadName, scopeInfo.frameIndex, varName,
                    );
                    if (structured) {
                        variables.push(this._evaluator.makeVariable(
                            varName,
                            structured.entry,
                            scopeInfo.threadName,
                            scopeInfo.frameIndex,
                            varName,
                            structured.members,
                        ));
                    }
                }
            } else if (frame?.file) {
                this._log(`로컬 변수 후보를 찾지 못함: ${frame.file}:${frame.fileLine} (${frame.process})`);
            }
        } else if (scopeInfo.type === 'globals') {
            // 소스 파일에서 모듈 레벨 전역 변수를 열거하고 개별 조회.
            // Show Variable -eval을 먼저 시도하는 이유: Show Global은 숫자/문자열 식만
            // 지원해(공식 문서) 배열/객체 전역이 아예 표시되지 않았고, 타입 정보도 없다.
            // 전역은 어느 프레임에서든 접근 가능하므로 정지 쓰레드 컨텍스트로 조회한다.
            //
            // 성능: 전역 1개당 최악 3회(−eval + Show Global ×2)의 직렬 왕복이 정지마다
            // 반복되던 것을, 성공한 조회 방식을 세션 동안 기억(_globalQueryMemo)해
            // 다음 정지부터는 전역당 1회 왕복으로 줄인다. (MergeCode 실측 42개 전역
            // × 최대 3회 = 126회 → 42회)
            const globals = this._symbols.getGlobalVariableDescriptors();

            const stopGen = this._frames.frameCacheGen;
            for (const g of globals) {
                // 실행이 재개되면 남은 전역은 조회하지 않는다(Locals 와 같은 이유).
                if (this._pendingAction || stopGen !== this._frames.frameCacheGen) { break; }
                const memoKey = g.displayName.toLowerCase();
                const memo = this._evaluator.globalQueryMemo.get(memoKey);

                // 1) 이전에 Show Global로만 성공했던 전역은 -eval 생략하고 직행
                if (memo && memo !== 'none' && memo.method === 'global') {
                    const value = await this._evaluator.readGlobalValueSingle(memo.name);
                    if (value) {
                        variables.push(this._evaluator.markGlobalWritability(
                            { name: g.displayName, value, variablesReference: 0 }, g,
                        ));
                    } else {
                        // 상황 변화(프로젝트 재시작 등) — 다음 정지에서 전체 사다리 재시도
                        this._evaluator.globalQueryMemo.delete(memoKey);
                    }
                    continue;
                }

                // 2) -eval 시도 (기본 경로 — 배열/객체 트리 지원)
                let pushed = false;
                if (scopeInfo.threadName) {
                    const structured = await this._evaluator.queryVariableStructured(
                        scopeInfo.threadName, scopeInfo.frameIndex, g.lookupNames[0],
                    );
                    const entry = structured?.entry;
                    if (entry && (classifyVarEntry(entry, structured!.members.length > 0) !== 'simple'
                        || (entry.value && entry.value !== VariableEvaluator.UNDEFINED_VALUE))) {
                        variables.push(this._evaluator.markGlobalWritability(this._evaluator.makeVariable(
                            g.displayName,
                            entry,
                            scopeInfo.threadName,
                            scopeInfo.frameIndex,
                            g.lookupNames[0],
                            structured!.members,
                        ), g));
                        this._evaluator.globalQueryMemo.set(memoKey, { method: 'eval' });
                        pushed = true;
                    }
                }

                // 3) 폴백: Show Global 사다리 — 단, 이전 정지에서 전부 실패했던 전역('none')은
                //    폴백을 생략해 정지당 왕복을 1회로 제한(값이 생기면 -eval이 다시 잡는다).
                if (!pushed && memo !== 'none') {
                    let found = false;
                    for (const name of g.lookupNames) {
                        const value = await this._evaluator.readGlobalValueSingle(name);
                        if (value) {
                            variables.push(this._evaluator.markGlobalWritability(
                                { name: g.displayName, value, variablesReference: 0 }, g,
                            ));
                            this._evaluator.globalQueryMemo.set(memoKey, { method: 'global', name });
                            found = true;
                            break;
                        }
                    }
                    if (!found) { this._evaluator.globalQueryMemo.set(memoKey, 'none'); }
                }
            }

            variables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' }));
        } else if (scopeInfo.type === 'members') {
            // 객체 조회 응답에 동봉돼 있던 멤버 줄들 — 추가 명령 없이 즉시 표시
            for (const m of scopeInfo.entries) {
                const bare = this._evaluator.memberBareName(m.name, scopeInfo.parentExpression);
                variables.push(this._evaluator.makeVariable(
                    bare,
                    m,
                    scopeInfo.threadName,
                    scopeInfo.frameIndex,
                    `${scopeInfo.parentExpression}.${bare}`,
                ));
            }
            // 클래스 Property를 가상 자식으로 — 덤프의 백킹 필드 값을 재사용하므로 왕복 없음(GitHub #26)
            variables.push(...this._evaluator.propertyChildren(
                scopeInfo.classType, scopeInfo.entries, scopeInfo.parentExpression,
                scopeInfo.threadName, scopeInfo.frameIndex,
            ));
        } else if (scopeInfo.type === 'expand') {
            if (classifyVarEntry({ name: '', type: scopeInfo.varType, value: '' }) === 'array') {
                variables.push(...await this._evaluator.expandArrayElements(scopeInfo));
            } else {
                // 중첩 객체(`Loc.Pos` 등)는 지연 재조회.
                // ※ 실기기(GPL 4.2K5, 2026-07-22): 점 표기 멤버 식은 -eval이 거부(-729/-780)
                //   하므로 이 재조회는 이 펌웨어에서 대부분 실패한다 — 실패 시 원인을 표시한다.
                const structured = await this._evaluator.queryVariableStructuredSmart(
                    scopeInfo.threadName, scopeInfo.frameIndex, scopeInfo.expression,
                );
                if (structured) {
                    for (const m of structured.members) {
                        const bare = this._evaluator.memberBareName(m.name, scopeInfo.expression);
                        variables.push(this._evaluator.makeVariable(
                            bare,
                            m,
                            scopeInfo.threadName,
                            scopeInfo.frameIndex,
                            `${structured.resolvedExpression}.${bare}`,
                        ));
                    }
                    variables.push(...this._evaluator.propertyChildren(
                        structured.entry.type, structured.members, structured.resolvedExpression,
                        scopeInfo.threadName, scopeInfo.frameIndex,
                    ));
                    if (structured.members.length === 0) {
                        const hasValue = !!structured.entry.value && structured.entry.value !== VariableEvaluator.UNDEFINED_VALUE;
                        if (hasValue) {
                            // 재조회가 객체가 아닌 단순 값으로 풀린 드문 경우 — 값 그대로 보인다.
                            variables.push({ name: '(값)', value: structured.entry.value, variablesReference: 0 });
                        } else {
                            // 멤버 줄이 없다 — 왜 못 펼쳤는지(-729 프레임 밖 / -780 프로시저 / 멤버 없음)를 행으로 보이고
                            // 상세는 Debug Console 에 남긴다(§1-DS). 종전 `(값) = ℹ …` 는 실패 코드를 버려 원인이 틀릴 수 있었다.
                            const row = describeNestedExpandFailure({
                                expression: scopeInfo.expression,
                                varType: structured.entry.type || scopeInfo.varType,
                                error: structured.error,
                                frameDescription: this._frames.describeFrameForLog(scopeInfo.threadName, scopeInfo.frameIndex),
                            });
                            this._log(row.detail);
                            variables.push({
                                name: row.name,
                                value: row.value,
                                variablesReference: 0,
                                presentationHint: { kind: 'virtual', attributes: ['readOnly'] },
                            });
                        }
                    }
                } else {
                    // 응답 없음(미연결/타임아웃) — 빈 트리 대신 상태를 알린다.
                    variables.push({
                        name: '(조회 실패)',
                        value: '제어기 응답 없음 — 연결 상태를 확인하세요',
                        variablesReference: 0,
                        presentationHint: { kind: 'virtual', attributes: ['readOnly'] },
                    });
                }
            }
        }

        response.body = { variables };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Set Variable (Set Global)
    // ═══════════════════════════════════════════════════════

    protected override async setVariableRequest(
        response: DebugProtocol.SetVariableResponse,
        args: DebugProtocol.SetVariableArguments,
    ): Promise<void> {
        const scopeInfo = this._evaluator.variableHandles.get(args.variablesReference);
        if (!scopeInfo) {
            this.sendErrorResponse(response, { id: 2001, format: 'Invalid scope' });
            return;
        }

        // 값은 콘솔 명령 문자열에 그대로 삽입된다 — 개행(CR/LF)이 섞이면 별도 명령
        // 주입처럼 동작할 수 있으므로 명확한 오류로 거부한다.
        if (/[\r\n]/.test(args.value)) {
            this.sendErrorResponse(response, {
                id: 2003,
                format: '값에 줄바꿈 문자(CR/LF)를 포함할 수 없습니다.',
            });
            return;
        }

        // 멤버/배열 요소 노드에서는 표시 이름이 부분 경로이므로 전체 식으로 조합한다.
        // (객체 멤버: `parent.field`, 배열 요소: 이름이 `(i)` 형태 → `parent(i)`)
        let targetName = args.name;
        if (scopeInfo.type === 'members') {
            targetName = `${scopeInfo.parentExpression}.${args.name}`;
        } else if (scopeInfo.type === 'expand') {
            targetName = args.name.startsWith('(')
                ? `${scopeInfo.expression}${args.name}`
                : `${scopeInfo.expression}.${args.name}`;
        }

        // Use Execute to set variable: Execute <expression>, <project>
        // 전역은 표기 후보가 둘이다(`Mod.Name` / `Name`). 읽기에서 실제로 통했던 표기를 먼저
        // 쓰고 -729면 나머지 표기로 재시도한다 — 조회는 사다리를 타면서 쓰기는 표시 이름만
        // 보내 이름이 어긋나던 문제를 막는다.
        const candidates = scopeInfo.type === 'globals'
            ? this._evaluator.globalWriteCandidates(targetName)
            : [targetName];
        const proj = this._projectName;
        let failure: { code: number; message: string } | undefined;

        for (const name of candidates) {
            const setExpr = `${name} = ${args.value}`;
            const cmd = proj
                ? `Execute ${setExpr}, ${proj}`
                : `Execute ${setExpr}`;
            const resp = await this._sendCmd(cmd);
            this._evaluator.clearEvaluateCache();

            // 하드 규칙 2: 성공/실패는 해당 명령의 STATUS로 판정한다.
            // STATUS가 명시적으로 0이 아니면 실패로 보고(값이 안 바뀌었는데 성공 표시 방지).
            // 응답 유실/무-STATUS(-9999)는 기존 동작(성공 가정) 유지 — 과잉 실패 보고 방지.
            if (!resp) { failure = undefined; break; }
            const st = parseStatus(resp);
            if (st.code === 0 || st.code === NO_STATUS_CODE) { failure = undefined; break; }
            failure = st;
            // 다른 표기를 시도할 가치가 있는 실패는 "이름을 못 찾음"뿐이다.
            if (st.code !== UNDEFINED_SYMBOL_STATUS) { break; }
        }

        if (failure) {
            this.sendErrorResponse(response, {
                id: 2002,
                format: this._evaluator.formatSetVariableError(failure, scopeInfo.type, targetName),
            });
            return;
        }

        response.body = { value: args.value };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Continue / Step / Pause
    // ═══════════════════════════════════════════════════════

    protected override async continueRequest(
        response: DebugProtocol.ContinueResponse,
        args: DebugProtocol.ContinueArguments,
    ): Promise<void> {
        // 스레드 단일 실행 잠금: 포커스가 다른 스레드로 옮겨갔어도 잠근 스레드에만 보낸다.
        args.threadId = this._resolveExecutionTarget('Continue', args.threadId, args.singleThread);
        const threadName = this._threads.threadIdToName.get(args.threadId);
        // GitHub #28: 이전 step/continue 의 정지 확인 전(또는 최소 간격 미달)이면 제어기에 보내지 않고
        // 성공 응답만 — 에러 응답은 키 반복 중 팝업 폭주를 만든다. UI 복귀는 _afterGatedStepRequest 참조.
        const gate = threadName ? this._gateStepRequest('Continue', args.threadId) : null;
        if (gate) {
            response.body = { allThreadsContinued: false };
            this.sendResponse(response);
            this._afterGatedStepRequest(args.threadId);
            return;
        }
        if (threadName) {
            const requestedAt = Date.now();
            // Continue 직전 위치를 origin으로 저장 — 폴이 Running 순간을 놓쳐도
            // 위치 변경으로 새 정지(BP 적중)를 확실히 감지하기 위한 기준점.
            const prevFrames = this._frames.cachedFrames.get(threadName);
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
            this._cancelGateResync(args.threadId); // GitHub #28: 실제 Continue 의 StoppedEvent 가 UI 복귀를 대신한다
            this._clearStaleState();
            this._pendingAction = 'continue';
            this._lastResumeAt = Date.now();
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
            this._noteResumeSent('Continue', threadName, requestedAt);

            // Continue 직후 빠른 재정지를 놓치지 않도록 fast poll 사용
            this._poll.fastPoll();
        }
        response.body = { allThreadsContinued: false };
        this.sendResponse(response);
    }

    protected override async nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments,
    ): Promise<void> {
        args.threadId = this._resolveExecutionTarget('Step over', args.threadId, args.singleThread);
        const threadName = this._threads.threadIdToName.get(args.threadId);
        // GitHub #28 게이트 — continueRequest 의 설명 참조
        const gate = threadName ? this._gateStepRequest('Step', args.threadId) : null;
        if (gate) {
            this.sendResponse(response);
            this._afterGatedStepRequest(args.threadId);
            return;
        }
        if (threadName) {
            const requestedAt = Date.now();
            this._cancelGateResync(args.threadId); // GitHub #28: 실제 Step 의 StoppedEvent 가 UI 복귀를 대신한다
            this._clearStaleState();
            this._pendingAction = 'step';
            this._lastResumeAt = Date.now();
            this._pendingThreadId = args.threadId;
            this._userActionInFlight = true;
            try {
                // GDE 캡처: step over = `Step <proj> -over -noerror`
                await this._sendCmd(`Step ${threadName} -over -noerror`);
                this._log(`Step ${threadName} -over -noerror`);
            } finally {
                this._userActionInFlight = false;
            }
            this._noteResumeSent('Step over', threadName, requestedAt);
            this._poll.fastPoll();
        }
        this.sendResponse(response);
    }

    protected override async stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments,
    ): Promise<void> {
        args.threadId = this._resolveExecutionTarget('Step into', args.threadId, args.singleThread);
        const threadName = this._threads.threadIdToName.get(args.threadId);
        // GitHub #28 게이트 — F12(step into) 홀드가 사고의 실제 경로였다. continueRequest 의 설명 참조
        const gate = threadName ? this._gateStepRequest('Step', args.threadId) : null;
        if (gate) {
            this.sendResponse(response);
            this._afterGatedStepRequest(args.threadId);
            return;
        }
        if (threadName) {
            const requestedAt = Date.now();
            this._cancelGateResync(args.threadId); // GitHub #28: 실제 Step 의 StoppedEvent 가 UI 복귀를 대신한다
            this._clearStaleState();
            this._pendingAction = 'step';
            this._lastResumeAt = Date.now();
            this._pendingThreadId = args.threadId;
            this._userActionInFlight = true;
            try {
                // Step Into Target: 대상이 지정되면(targetId > 0) 제어기에 대상 지정 스위치가 없으므로
                // 정의 위치에 임시 BP + Continue 로 진입한다. 실패하면 기본 Step 으로 되돌린다.
                const viaTarget = args.targetId !== undefined && args.targetId > 0
                    && await this._stepIntoTargetViaTempBreakpoint(threadName, args.targetId);
                if (viaTarget) {
                    // 임시 BP 도달을 기다리는 동안은 continue 상태로 둔다(Step 완료 판정과 구분).
                    this._pendingAction = 'continue';
                } else {
                    // GDE 캡처: step into = `Step <proj> -noerror` (-into 플래그 없음)
                    await this._sendCmd(`Step ${threadName} -noerror`);
                    this._log(`Step ${threadName} -noerror (into)`);
                }
            } finally {
                this._userActionInFlight = false;
            }
            this._noteResumeSent('Step into', threadName, requestedAt);
            this._poll.fastPoll();
        }
        this.sendResponse(response);
    }

    protected override async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments,
    ): Promise<void> {
        args.threadId = this._resolveExecutionTarget('Step out', args.threadId, args.singleThread);
        const threadName = this._threads.threadIdToName.get(args.threadId);
        // GitHub #28 게이트 — continueRequest 의 설명 참조
        const gate = threadName ? this._gateStepRequest('Step', args.threadId) : null;
        if (gate) {
            this.sendResponse(response);
            this._afterGatedStepRequest(args.threadId);
            return;
        }
        if (threadName) {
            const requestedAt = Date.now();
            this._cancelGateResync(args.threadId); // GitHub #28: 실제 Step 의 StoppedEvent 가 UI 복귀를 대신한다
            this._clearStaleState();
            this._pendingAction = 'step';
            this._lastResumeAt = Date.now();
            this._pendingThreadId = args.threadId;
            this._userActionInFlight = true;
            try {
                // step out은 캡처에 없어 기존 -out 유지 + GDE 공통 -noerror 부여
                await this._sendCmd(`Step ${threadName} -out -noerror`);
                this._log(`Step ${threadName} -out -noerror`);
            } finally {
                this._userActionInFlight = false;
            }
            this._noteResumeSent('Step out', threadName, requestedAt);
            this._poll.fastPoll();
        }
        this.sendResponse(response);
    }

    protected override async pauseRequest(
        response: DebugProtocol.PauseResponse,
        args: DebugProtocol.PauseArguments,
    ): Promise<void> {
        const threadName = this._threads.threadIdToName.get(args.threadId);
        if (threadName) {
            const requestedAt = Date.now();
            this._pendingAction = 'pause';
            this._pendingThreadId = args.threadId;
            this._userActionInFlight = true;
            try {
                await this._sendCmd(`Break ${threadName}`);
                this._log(`Break ${threadName} (pause)`);
            } finally {
                this._userActionInFlight = false;
            }
            this._noteResumeSent('Pause', threadName, requestedAt);
            this._poll.fastPoll();
        }
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Step/Continue 게이트 (GitHub #28)
    // ═══════════════════════════════════════════════════════

    /**
     * step/continue 요청 게이트 판정(stepGate.shouldGateStepRequest). 게이트되면 사유를 돌려주고 무시 건수를
     * 기록한다 — 첫 건과 이후 STEP_GATE_LOG_EVERY 건마다 1회 로그, pending 해소 시 _pollThreadStates 가 요약.
     * pauseRequest(Break)는 게이트하지 않는다 — 폭주한 continue 를 멈추는 수단이어야 하므로.
     */
    private _gateStepRequest(kind: 'Step' | 'Continue', threadId: number): StepGateReason | null {
        const now = Date.now();
        const reason = shouldGateStepRequest({
            pendingAction: this._pendingAction,
            pendingThreadId: this._pendingThreadId,
            requestThreadId: threadId,
            lastResumeAt: this._lastResumeAt,
            now,
            minIntervalMs: this._minStepIntervalMs,
        });
        if (!reason) { return null; }
        this._stepGateIgnored++;
        if (this._stepGateIgnored === 1 || this._stepGateIgnored % GPLDebugSession.STEP_GATE_LOG_EVERY === 0) {
            const why = reason === 'min-interval'
                ? `마지막 재개 후 ${now - this._lastResumeAt}ms < 최소 간격 ${this._minStepIntervalMs}ms`
                : `이전 ${this._pendingAction} 정지 확인 대기 중`;
            const tally = this._stepGateIgnored > 1 ? `, 누적 ${this._stepGateIgnored}건` : '';
            this._log(`${kind} 요청 무시 — ${why} (GitHub #28 게이트${tally})`);
        }
        return reason;
    }

    /**
     * 게이트로 무시한 요청의 뒤처리(응답을 보낸 뒤 호출). VS Code 는 next/continue 의 성공 응답을 받으면
     * 해당 쓰레드를 '실행 중'으로 시뮬레이션하고 다음 StoppedEvent 까지 스텝 버튼을 잠근다.
     * - pending 이 남아 있으면: 그 pending 이 해소될 때 _pollThreadStates 가 StoppedEvent 를 보내 UI 가 복귀한다
     *   (stackTraceRequest 는 pending 동안 캐시 프레임을, 해소 뒤에는 _prefetchFramesAfterStop 이 워밍한 프레임을 준다).
     * - 이 쓰레드에 pending 이 없으면(최소 간격 미달 게이트, 또는 다른 쓰레드의 pending 중): 예정된 StoppedEvent 가
     *   없어 UI 가 '실행 중'에 갇힌다. 쓰레드는 이미 정지 상태이므로 최소 간격이 지난 뒤(하한 250ms, 키 반복 중
     *   쓰레드당 1회로 합침) 같은 위치의 StoppedEvent 를 재발사해 UI 를 되돌린다 — 제어기 명령은 없다.
     *   그 사이 이 쓰레드에 실제 step/continue 가 나가면 그쪽 경로가 예약을 접는다(_cancelGateResync).
     */
    private _afterGatedStepRequest(threadId: number): void {
        if (this._isPendingFor(threadId) || this._gateResyncTimers.has(threadId)) { return; }
        const remaining = Math.max(0, this._minStepIntervalMs - (Date.now() - this._lastResumeAt));
        const wait = Math.max(remaining, 250) + 5;
        this._gateResyncTimers.set(threadId, setTimeout(() => {
            this._gateResyncTimers.delete(threadId);
            if (!this._isConnected || !this._configurationDone || this._isPendingFor(threadId)) { return; }
            const name = this._threads.threadIdToName.get(threadId);
            const state = name ? this._previousThreadStates.get(name) : undefined;
            if (state === 'Break' || state === 'Paused' || state === 'Error') {
                // 원래 정지 reason 은 보관하지 않으므로 gplFocusThread 와 같은 상태 기반 근사치(UI 라벨에만 영향)
                // 잠금 중이면 preserveFocusHint 가 함께 붙어 포커스를 잠근 스레드에 남긴다.
                this.sendEvent(this._stoppedEvent(state === 'Error' ? 'exception' : 'breakpoint', threadId));
                this._log(`Step 게이트: 무시한 요청 뒤 UI 복귀용 StoppedEvent 재발사 (${name}, 제어기 명령 없음)`);
            }
        }, wait));
    }

    /** 이 쓰레드의 정지 확인을 기다리는 pending 이 있는가('entry' 는 모든 쓰레드에 해당). 해소 시 StoppedEvent 가 온다. */
    private _isPendingFor(threadId: number): boolean {
        return this._pendingAction === 'entry'
            || (this._pendingAction !== null && this._pendingThreadId === threadId);
    }

    /**
     * UI 복귀 재발사 예약을 접는다 — 그 쓰레드에 실제 step/continue 가 나가면(그쪽 StoppedEvent 가 UI 를 복귀시킴)
     * 해당 쓰레드만, disconnect 시(인자 없음) 전부.
     */
    private _cancelGateResync(threadId?: number): void {
        if (threadId === undefined) {
            for (const handle of this._gateResyncTimers.values()) { clearTimeout(handle); }
            this._gateResyncTimers.clear();
            return;
        }
        const handle = this._gateResyncTimers.get(threadId);
        if (handle) {
            clearTimeout(handle);
            this._gateResyncTimers.delete(threadId);
        }
    }

    // ═══════════════════════════════════════════════════════
    // 스레드 단일 실행 잠금 (threadLock.ts)
    // ═══════════════════════════════════════════════════════

    /**
     * 실행(Continue/Step) 명령을 보낼 스레드를 확정한다.
     *
     * 잠금이 걸려 있으면 VS Code 포커스가 어느 스레드에 있든 잠근 스레드로 되돌린다 — 다른
     * 스레드가 브레이크포인트에 걸려 포커스를 가져간 상태에서 F5/F10 을 눌러 **의도하지 않은
     * 스레드를 움직이는 사고**를 막는 것이 목적이다. 잠근 스레드가 종료돼 목록에 없으면 잠금을
     * 해제하고 요청을 그대로 통과시킨다. 추가 스레드를 재개하는 일은 없다(하드 규칙 9).
     */
    private _resolveExecutionTarget(action: string, requestedThreadId: number, singleThread?: boolean): number {
        if (isAllThreadsResumeRequest(singleThread)) {
            // DAP 상 '모든 스레드 재개' 요청. 제어기 실행 명령은 스레드 단위이고 여러 스레드를
            // 자동 재개하면 모션 영향이 커지므로, 요청 스레드만 재개하고 사실을 남긴다.
            this._log(`${action}: 모든 스레드 재개 요청이지만 스레드 단위로만 보냅니다(요청 스레드 1개).`);
        }

        const decision = resolveExecutionThread({
            lockedName: this._lockedThreadName,
            requestedThreadId,
            threadNameToId: this._threads.threadNameToId,
        });

        if (decision.staleLock) {
            this._log(`스레드 잠금 해제: 잠근 스레드 ${decision.lockedName} 가 목록에 없습니다(종료됨).`);
            this._setLockedThread(undefined);
            return decision.targetThreadId;
        }

        if (decision.redirected) {
            this._lockRedirectCount++;
            if (this._lockRedirectCount === 1) {
                const from = this._threads.threadIdToName.get(requestedThreadId) ?? `#${requestedThreadId}`;
                this._log(
                    `스레드 잠금: ${action} 대상을 ${from} → ${decision.lockedName} 로 되돌렸습니다 `
                    + '(잠금 해제: 상태바 자물쇠 또는 GPL: 스레드 실행 잠금 해제).',
                );
            }
        }
        return decision.targetThreadId;
    }

    /**
     * 잠금 상태 변경 + 되돌림 카운터 리셋. 확장 UI(상태바)가 어댑터 쪽 자동 해제(잠근 스레드 종료 등)를
     * 따라올 수 있도록 `gpl.threadLockChanged` 이벤트를 함께 보낸다.
     */
    private _setLockedThread(name: string | undefined): void {
        const changed = this._lockedThreadName !== name;
        this._lockedThreadName = name;
        this._lockRedirectCount = 0;
        if (changed) {
            this.sendEvent(new Event('gpl.threadLockChanged', { threadName: name ?? null }));
            // CALL STACK 라벨의 자물쇠 표시를 바로 반영 — 목록 캐시를 무효화해 threadsRequest 가
            // 새 라벨을 만들게 한다(읽기 전용 Show Thread 1왕복, 실행 명령 없음).
            this._lastThreadListAt = 0;
            if (this._configurationDone) { this.sendEvent(new InvalidatedEvent(['threads'])); }
        }
    }

    /**
     * StoppedEvent 생성 — 잠금이 걸려 있고 정지한 스레드가 잠근 스레드가 아니면
     * `preserveFocusHint` 를 붙여 VS Code 가 포커스를 그쪽으로 훔치지 않게 한다
     * (VS Code 1.135 가 이 힌트를 실제로 존중하는 것을 본체 번들에서 확인 — 2026-08-28).
     * BREAKPOINTS/CALL STACK 의 정지 표시 자체는 그대로 갱신된다.
     */
    private _stoppedEvent(reason: string, threadId: number, opts?: { forceFocus?: boolean }): StoppedEvent {
        const ev = new StoppedEvent(reason, threadId);
        const body = ev.body as DebugProtocol.StoppedEvent['body'];
        // 제어기의 정지는 항상 스레드 단위다 — 전체 정지를 만들지 않으므로 명시적 false.
        body.allThreadsStopped = false;
        // forceFocus 는 사용자가 그 스레드를 직접 지목한 전환(gplFocusThread)에만 쓴다.
        // 다른 곳에서 켜면 잠금이 조용히 무력화된다.
        if (!opts?.forceFocus
            && shouldPreserveFocus(this._lockedThreadName, this._threads.threadIdToName.get(threadId))) {
            body.preserveFocusHint = true;
        }
        return ev;
    }

    // ═══════════════════════════════════════════════════════
    // 소스 분석 기반 기능 (sourceTargets.ts) — BP 유효 줄 / 함수 BP / Step Into Target / Jump to Cursor
    // ═══════════════════════════════════════════════════════

    /** `gpl.debug.jumpToCursor`: 'warn'(기본, 경고 확인 후 실행) | 'on'(경고 없이) | 'off'(기능 비활성). */
    private _jumpToCursorMode(): 'warn' | 'on' | 'off' {
        const v = vscode.workspace.getConfiguration('gpl').get<string>('debug.jumpToCursor', 'warn');
        return v === 'on' || v === 'off' ? v : 'warn';
    }

    /** `gpl.debug.clientSideBreakpointLogic`(기본 false): 조건부 BP·히트 조건·로그포인트 흉내. */
    private _clientSideBpLogicEnabled(): boolean {
        return vscode.workspace.getConfiguration('gpl').get<boolean>('debug.clientSideBreakpointLogic', false) === true;
    }

    /**
     * 디버거가 보내는 `Start` 명령을 문서 구문(startCommand.ts)으로 조립한다.
     * `-event`(GDE 기본), `-stack`, `-init`, `-trace` 는 설정·launch 구성에서 온다.
     * `-compile` 은 startCommand 기본값으로 항상 붙는다(§1-DN — 없으면 옛 바이너리에 브레이크포인트를 걸게 된다).
     */
    private _buildStartCommand(extra: { breakOnEntry?: boolean; breakOnException?: boolean }): string {
        const cfg = vscode.workspace.getConfiguration('gpl');
        return buildStartCommand({
            projectName: this._projectName ?? '',
            eventMode: cfg.get<boolean>('controller.startEventMode', true),
            breakOnEntry: extra.breakOnEntry,
            breakOnException: extra.breakOnException,
            stackSizeKb: this._startStackSizeKb,
            showInitStatements: this._startShowInitStatements,
            trace: this._startTrace,
        });
    }

    /**
     * BP 유효 줄 힌트 — VS Code 가 이 구간에서 BP를 걸 수 있는 줄을 물어본다.
     * 제어기 명령을 보내지 않고 로컬 파서로만 답한다.
     */
    protected override async breakpointLocationsRequest(
        response: DebugProtocol.BreakpointLocationsResponse,
        args: DebugProtocol.BreakpointLocationsArguments,
    ): Promise<void> {
        let sourcePath = args.source.path || '';
        if (this._sources.remoteSourceSession) {
            try { sourcePath = await this._sources.ensureRemoteSourcePath(sourcePath); }
            catch {
                response.body = { breakpoints: [] };
                this.sendResponse(response);
                return;
            }
        }
        const baseName = this._sources.remoteSourceSession ? sourcePath : path.basename(sourcePath);
        const src = baseName ? this._sources.readSourceLines(baseName) : undefined;
        if (!src) {
            // 소스를 못 읽으면 요청 구간을 그대로 허용한다(힌트를 못 준다고 BP를 막지는 않는다).
            const from = args.line;
            const to = args.endLine ?? args.line;
            const all: DebugProtocol.BreakpointLocation[] = [];
            for (let l = from; l <= to; l++) { all.push({ line: l }); }
            response.body = { breakpoints: all };
            this.sendResponse(response);
            return;
        }
        const ranges = this._sources.procedureRangesFor(baseName, src);
        const lines = breakpointCandidateLines(src, ranges, args.line, args.endLine ?? args.line);
        response.body = { breakpoints: lines.map(l => ({ line: l })) };
        this.sendResponse(response);
    }

    /**
     * 프로시저 이름 브레이크포인트. 이름 → (파일, 첫 실행 줄) 로 바꿔 `Set Break` 를 보낸다.
     * 소스 BP 와 같은 파일에 있을 수 있으므로 목록을 따로 들고 있고,
     * `setBreakPointsRequest` 의 파일 단위 정리에서 이 줄들은 건드리지 않는다.
     */
    protected override async setFunctionBreakPointsRequest(
        response: DebugProtocol.SetFunctionBreakpointsResponse,
        args: DebugProtocol.SetFunctionBreakpointsArguments,
    ): Promise<void> {
        const proj = this._projectName;
        const requested = args.breakpoints ?? [];

        if (!proj) {
            response.body = {
                breakpoints: requested.map(() => ({
                    verified: false,
                    message: '프로젝트를 감지할 수 없습니다. launch.json에 projectName을 지정하세요.',
                }) as DebugProtocol.Breakpoint),
            };
            this.sendResponse(response);
            return;
        }

        if (this._sources.remoteSourceSession) {
            const candidates = requested.map(req => this._sources.findProcedureDefinitions(req.name));
            const problems = candidates.map((defs, i) => {
                if (defs.length === 0) {
                    return `프로시저 '${requested[i].name}'를 현재 내려받은 원격 소스에서 찾지 못했습니다. 해당 파일을 먼저 열고 다시 시도하세요.`;
                }
                if (defs.length !== 1) { return `프로시저 '${requested[i].name}'의 원격 정의가 여러 개라 대상을 확정할 수 없습니다.`; }
                const target = this._bps.resolveBreakpointTarget(this._sources.resolveSourcePath(defs[0].file), defs[0].line);
                return target?.kind === 'direct-source' ? undefined : target?.message ?? '직접 ProjectSource의 프로시저가 아닙니다.';
            });
            if (problems.some(Boolean)) {
                // 미로딩/모호한 함수 때문에 이전 함수 BP까지 해제하지 않는다.
                response.body = { breakpoints: problems.map(message => ({
                    verified: false, message: message ?? '해결되지 않은 원격 함수 BP가 있어 이번 변경을 적용하지 않았습니다.',
                })) };
                this.sendResponse(response);
                return;
            }
        }

        // 이전 함수 BP 해제 — 같은 줄에 소스 BP 가 있으면 남겨 둔다.
        for (const prev of this._bps.functionBps) {
            const sourceLines = [...this._bps.breakpoints.entries()]
                .find(([file]) => path.basename(file).toLowerCase() === prev.file.toLowerCase())?.[1];
            if (sourceLines?.has(prev.line)) { continue; }
            await this._bps.sendBpCommandWithFallback('Nobreak', proj, prev.file, prev.line);
        }
        this._bps.functionBps = [];

        const result: DebugProtocol.Breakpoint[] = [];
        for (const req of requested) {
            const defs = this._sources.findProcedureDefinitions(req.name);
            if (defs.length === 0) {
                result.push({
                    verified: false,
                    message: `프로시저 '${req.name}'를 워크스페이스에서 찾지 못했습니다. Class.Proc 형태로 지정해 보세요.`,
                } as DebugProtocol.Breakpoint);
                continue;
            }
            if (defs.length > 1) {
                this._log(`함수 BP '${req.name}': 정의 ${defs.length}개 발견 — 첫 번째(${defs[0].file}:${defs[0].line}) 사용`);
            }
            const def = defs[0];
            // 소스 BP 와 같은 폴백/안내를 쓴다 — 표기를 가리는 제어기와 라이브러리 소스 모두 대응.
            const defKey = def.file.toLowerCase();
            const resp = !this._bps.preserveExistingBreakpoints && this._bps.bpRejectedFiles.has(defKey)
                ? await this._sendCmd(this._bps.bpCommand('Break', proj, def.file, def.line))
                : await this._bps.sendBpCommandWithFallback('Break', proj, def.file, def.line);
            const verified = resp !== null && (isSuccess(resp) || /Duplicate breakpoint/i.test(resp));
            const bp: DebugProtocol.Breakpoint = {
                verified,
                id: ++this._bps.bpIdCounter,
                line: def.line,
                source: { name: def.file, path: this._sources.safeResolveSourcePath(def.file) },
            };
            if (!verified) {
                const msg = resp ? resp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0] : '응답 없음';
                const hint = resp !== null && parseStatus(resp).code === -508
                    ? this._bps.librarySourceBpHint(def.file)
                    : undefined;
                if (hint) { this._bps.bpRejectedFiles.add(defKey); }
                bp.message = hint ? `${msg} — ${hint}` : msg;
            } else {
                this._bps.functionBps.push({ name: req.name, file: def.file, line: def.line, id: bp.id! });
                this._log(`함수 BP: ${def.label} → ${def.file}:${def.line}`);
            }
            result.push(bp);
        }

        response.body = { breakpoints: result };
        this.sendResponse(response);
        this._bps.warnIfBreakpointLimitExceeded();
    }

    /**
     * Jump to Cursor 후보 — 문서(`Set Thread -line`)상 새 줄은 **현재 줄과 같은 프로시저 안**이어야 하고
     * 실행 가능한 문장이어야 한다. 두 조건을 로컬에서 확인해 통과할 때만 후보를 돌려준다.
     */
    protected override gotoTargetsRequest(
        response: DebugProtocol.GotoTargetsResponse,
        args: DebugProtocol.GotoTargetsArguments,
    ): void {
        response.body = { targets: [] };
        if (this._jumpToCursorMode() === 'off') {
            this.sendResponse(response);
            return;
        }

        const requestedPath = args.source.path || '';
        const sourcePath = this._sources.remoteSourceSession ? this._sources.remoteSourceForInput(requestedPath)?.localPath : requestedPath;
        const baseName = path.basename(sourcePath || '');
        const sourceKey = this._sources.remoteSourceSession ? sourcePath : baseName;
        const src = sourceKey ? this._sources.readSourceLines(sourceKey) : undefined;
        const threadName = this._lockedThreadName ?? this._findBreakThread();
        const frames = threadName ? this._frames.cachedFrames.get(threadName) : undefined;
        const current = frames?.[0];

        if (!src || !current) {
            this.sendResponse(response);
            return;
        }
        if (this._sources.remoteSourceSession) {
            const currentSource = this._sources.remoteSourceForInput(current.file || '');
            if (!currentSource || !sourcePath || !this._sources.isSamePath(currentSource.localPath, sourcePath)) {
                this.sendResponse(response);
                return;
            }
        }
        if (!this._sources.remoteSourceSession && current.file && current.file.toLowerCase() !== baseName.toLowerCase()) {
            // 다른 파일 — 문서상 같은 프로시저여야 하므로 대상이 될 수 없다.
            this.sendResponse(response);
            return;
        }

        const ranges = this._sources.procedureRangesFor(sourceKey || baseName, src);
        const currentProc = enclosingProcedure(ranges, current.fileLine);
        const targetLine = resolveBreakpointLine(src, args.line, currentProc);
        if (!currentProc || targetLine === undefined) {
            this.sendResponse(response);
            return;
        }
        if (!enclosingProcedure(ranges, targetLine) || enclosingProcedure(ranges, targetLine)!.start !== currentProc.start) {
            this.sendResponse(response);
            return;
        }

        const id = ++this._targetIdCounter;
        this._gotoTargetHandles.set(id, { file: baseName, line: targetLine, procedure: currentProc.name });
        response.body = {
            targets: [{
                id,
                label: `${currentProc.name}:${targetLine} 로 이동 (건너뛴 문장은 실행되지 않습니다)`,
                line: targetLine,
            }],
        };
        this.sendResponse(response);
    }

    /**
     * Jump to Cursor 실행 — `Set Thread <thread> -line <n>`.
     *
     * 위험: 지정 줄까지의 문장이 실행되지 않으므로 초기화·안전 조건을 건너뛴 상태로 진행할 수 있다
     * (모션 영향 가능 — §0 하드 규칙 9). 그래서 기본값(`gpl.debug.jumpToCursor: "warn"`)에서는
     * 실행 전에 모달로 확인을 받는다. 기능 자체를 막지는 않는다(사용자 결정 2026-08-28).
     */
    protected override async gotoRequest(
        response: DebugProtocol.GotoResponse,
        args: DebugProtocol.GotoArguments,
    ): Promise<void> {
        const mode = this._jumpToCursorMode();
        const target = this._gotoTargetHandles.get(args.targetId);
        const threadName = this._threads.threadIdToName.get(args.threadId);

        if (mode === 'off') {
            this.sendErrorResponse(response, 1201, 'Jump to Cursor 가 비활성화되어 있습니다(gpl.debug.jumpToCursor).');
            return;
        }
        if (!target || !threadName) {
            this.sendErrorResponse(response, 1202, '이동 대상을 확인할 수 없습니다. 정지된 쓰레드에서 다시 시도하세요.');
            return;
        }

        if (mode === 'warn') {
            const pick = await vscode.window.showWarningMessage(
                `다음 실행 문장을 ${target.file}:${target.line} (${target.procedure})로 옮깁니다.`,
                {
                    modal: true,
                    detail: '건너뛴 문장은 실행되지 않습니다 — 변수 초기화·안전 조건·전원/그리퍼 상태 설정이 빠진 채 진행될 수 있고, '
                        + '그 상태로 모션 명령이 실행되면 예상과 다르게 움직일 수 있습니다.\n\n'
                        + '저속·시뮬레이션에서 먼저 확인하세요. 이 확인창은 gpl.debug.jumpToCursor 를 "on"으로 두면 생략됩니다.',
                },
                '이동',
            );
            if (pick !== '이동') {
                this.sendErrorResponse(response, 1203, 'Jump to Cursor 취소됨(사용자 확인 없음).');
                return;
            }
        }

        const cmd = `Set Thread ${threadName} -line ${target.line}`;
        const resp = await this._sendCmd(cmd);
        if (resp === null || !isSuccess(resp)) {
            const msg = resp ? resp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0] : '응답 없음';
            this._log(`⚠ ${cmd} 실패 → ${msg}`);
            this.sendErrorResponse(response, 1204, `Set Thread -line 실패: ${msg}`);
            return;
        }
        this._log(`${cmd} → 다음 실행 문장을 ${target.file}:${target.line} 로 옮겼습니다(건너뛴 문장 미실행)`);

        this.sendResponse(response);
        // DAP: goto 응답 뒤 StoppedEvent(reason 'goto')로 새 위치를 알린다.
        this._clearStaleState();
        this._frames.prefetchFramesAfterStop(threadName);
        if (this._configurationDone) {
            this.sendEvent(this._stoppedEvent('goto', args.threadId, { forceFocus: true }));
        }
    }

    /**
     * Step Into Target 후보 — 현재 줄의 호출 중 정의를 찾을 수 있는 것만 돌려준다.
     * 첫 항목은 항상 "기본 Step Into"(제어기 `Step -noerror`)로 둬서 종전 동작을 유지한다.
     */
    protected override stepInTargetsRequest(
        response: DebugProtocol.StepInTargetsResponse,
        args: DebugProtocol.StepInTargetsArguments,
    ): void {
        response.body = { targets: [] };
        const info = this._frames.frameIdToInfo.get(args.frameId);
        const frames = info ? this._frames.cachedFrames.get(info.threadName) : undefined;
        const frame = frames?.[info?.frameIndex ?? 0];
        if (!frame?.file || frame.fileLine <= 0) {
            this.sendResponse(response);
            return;
        }
        const src = this._sources.readSourceLines(frame.file);
        const lineText = src?.[frame.fileLine - 1];
        if (!lineText) {
            this.sendResponse(response);
            return;
        }

        const targets: DebugProtocol.StepInTarget[] = [];
        // id 0 = 기본 Step Into(대상 지정 없음)
        targets.push({ id: 0, label: '기본 Step Into (제어기가 정한 대상)' });

        for (const call of parseCallTargets(lineText)) {
            const defs = this._sources.findProcedureDefinitions(call.receiver ? call.name : call.label);
            if (defs.length === 0) { continue; }
            const def = defs[0];
            const id = ++this._targetIdCounter;
            this._stepInTargetHandles.set(id, { label: call.label, file: def.file, line: def.line });
            targets.push({
                id,
                label: `${call.label} → ${def.file}:${def.line}`,
                line: frame.fileLine,
                column: call.column + 1,
            });
        }

        response.body = { targets };
        this.sendResponse(response);
    }

    /**
     * Step Into Target 실행 — 제어기 `Step` 에는 대상 지정 스위치가 없으므로
     * 정의 위치에 **임시 BP** 를 걸고 Continue 한다(MCP `run_to_line` 과 같은 방식).
     * 임시 BP는 다음 정지 시 정리한다. 대상에 도달하지 못하면 그 스레드는 계속 실행되므로
     * 실패 시에는 임시 BP를 즉시 걷어내고 기본 Step 으로 되돌린다.
     *
     * @returns true = 임시 BP + Continue 로 처리함(호출측은 Step 명령을 보내지 않는다)
     */
    private async _stepIntoTargetViaTempBreakpoint(threadName: string, targetId: number): Promise<boolean> {
        const target = this._stepInTargetHandles.get(targetId);
        const proj = this._projectName;
        if (!target || !proj) { return false; }

        const setResp = this._bps.preserveExistingBreakpoints
            ? await this._bps.sendBpCommandWithFallback('Break', proj, target.file, target.line)
            : await this._sendCmd(this._bps.bpCommand('Break', proj, target.file, target.line));
        const ok = setResp !== null && (isSuccess(setResp) || /Duplicate breakpoint/i.test(setResp));
        if (!ok) {
            this._log(`⚠ Step Into Target: 임시 BP 설정 실패(${target.file}:${target.line}) — 기본 Step 으로 진행`);
            return false;
        }
        const existing = this._bps.tempBreakpoints.get(target.file.toLowerCase()) ?? new Set<number>();
        existing.add(target.line);
        this._bps.tempBreakpoints.set(target.file.toLowerCase(), existing);

        const contResp = await this._sendCmd(`Continue ${threadName}`);
        if (contResp === null || !isSuccess(contResp)) {
            const msg = contResp ? contResp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0] : '응답 없음';
            this._log(`⚠ Step Into Target: Continue 실패(${msg}) — 임시 BP 를 정리합니다`);
            await this._bps.clearTempBreakpoints();
            return false;
        }
        this._log(`Step Into Target: ${target.label} → 임시 BP ${target.file}:${target.line} + Continue ${threadName}`);
        return true;
    }

    /**
     * BP 적중 시점의 부수 처리 — ① Step Into Target 임시 BP 정리 ② 조건부 BP/히트 조건/로그포인트 판정.
     *
     * @returns true = 이 정지를 사용자에게 알린다(StoppedEvent 발사).
     *          false = 조건 불일치·로그포인트여서 **자동 Continue** 했다(정지를 알리지 않는다).
     *
     * 자동 Continue 는 모션을 다시 움직이는 행위이므로 `gpl.debug.clientSideBreakpointLogic`(기본 false)이
     * 켜져 있을 때만 일어난다. 조건 평가는 정지한 프레임에서 `Show Variable` 로 하며, 평가에 실패하면
     * **정지를 유지**한다(조건을 확인하지 못한 채 지나치지 않는다).
     */
    private async _handleBreakpointStop(threadName: string, threadId: number): Promise<boolean> {
        await this._bps.clearTempBreakpoints();

        if (!this._clientSideBpLogicEnabled()) { return true; }

        const frames = await this._frames.getThreadFrames(threadName);
        const top = frames[0];
        if (!top?.file || top.fileLine <= 0) { return true; }
        const meta = this._bps.bpMeta.get(top.file.toLowerCase())?.get(top.fileLine);
        if (!meta) { return true; }

        meta.hits++;

        // 로그포인트: 메시지의 `{식}` 을 평가해 Debug Console 에 출력한다.
        if (meta.logMessage !== undefined) {
            const text = await this._evaluator.interpolateLogMessage(meta.logMessage, threadName);
            this._log(`[logpoint] ${top.file}:${top.fileLine} ${text}`);
        }

        let shouldStop = true;
        if (meta.condition) {
            const verdict = await this._evaluator.evaluateBooleanCondition(meta.condition, threadName);
            if (verdict === undefined) {
                this._log(`⚠ 조건 평가 실패(${meta.condition}) — 안전하게 정지를 유지합니다`);
                return true;
            }
            shouldStop = verdict;
        }
        if (shouldStop && meta.hitCondition) {
            shouldStop = this._hitConditionSatisfied(meta.hitCondition, meta.hits);
        }
        // 로그포인트(조건 없음)는 정지하지 않고 지나가는 것이 표준 동작이다.
        if (meta.logMessage !== undefined && !meta.condition && !meta.hitCondition) {
            shouldStop = false;
        }
        if (shouldStop) { return true; }

        // 자동 Continue — 정지 사실을 사용자에게 알리지 않고 실행을 이어 간다.
        this._autoResumeCount++;
        if (this._autoResumeCount === 1 || this._autoResumeCount % 20 === 0) {
            this._log(
                `조건부 BP: ${top.file}:${top.fileLine} 조건 불일치 → 자동 Continue (누적 ${this._autoResumeCount}회). `
                + '자동 재개를 원하지 않으면 gpl.debug.clientSideBreakpointLogic 를 끄세요.',
            );
        }
        this._pendingAction = 'continue';
        this._lastResumeAt = Date.now();
        this._pendingThreadId = threadId;
        this._pendingContinueSawRunning = false;
        this._pendingContinuePausedSeen = 0;
        await this._sendCmd(`Continue ${threadName}`);
        this._poll.fastPoll();
        return false;
    }

    /**
     * 히트 조건 판정 — VS Code 표기(`5`, `>5`, `>=5`, `==5`, `%5`)를 지원한다.
     * 형식을 알 수 없으면 true(정지 유지)로 본다.
     */
    private _hitConditionSatisfied(hitCondition: string, hits: number): boolean {
        const text = hitCondition.trim();
        const m = text.match(/^(>=|<=|==|=|>|<|%)?\s*(\d+)$/);
        if (!m) { return true; }
        const op = m[1] ?? '>=';
        const n = parseInt(m[2], 10);
        switch (op) {
            case '%': return n > 0 && hits % n === 0;
            case '>': return hits > n;
            case '<': return hits < n;
            case '<=': return hits <= n;
            case '==':
            case '=': return hits === n;
            default: return hits >= n;
        }
    }

    // ═══════════════════════════════════════════════════════
    // Custom requests — 확장 UI(GPL Controller 트리 / CALL STACK 메뉴) ↔ 어댑터 연동
    // ═══════════════════════════════════════════════════════

    /**
     * 확장 쪽 customRequest 처리.
     * - `gplFocusThread {name}`: 이미 정지(Break/Paused/Error)한 쓰레드의 StoppedEvent를
     *   재발사해 VS Code 포커스 쓰레드를 전환한다(트리 클릭 → 디버거 연동). 제어기로 명령을
     *   보내지 않는 UI 전용 동작이며, step 상태머신(`_pendingAction`)은 건드리지 않는다.
     *   정지 상태가 아니면 무시하고 `{focused:false}`를 돌려준다.
     * - `gplThreadInfo {threadId}`: DAP threadId → 쓰레드 이름/최근 폴 상태 조회.
     *   CALL STACK에서 Running 쓰레드 클릭 시 확장이 실행 위치를 열기 위한 UI 전용
     *   조회이며 제어기로 명령을 보내지 않는다. `msSinceResume`은 마지막 Continue/Step
     *   이후 경과 ms — 재개 직후 자동 포커스 이벤트를 사용자 클릭과 구분하는 용도.
     * - `gplLockThread {name|threadId}` / `gplUnlockThread` / `gplLockState`: 스레드 단일 실행
     *   잠금 설정·해제·조회. 잠금 중에는 Continue/Step 이 포커스와 무관하게 잠근 스레드로만
     *   나가고, 다른 스레드의 정지는 포커스를 훔치지 않는다. 제어기 명령을 보내지 않는다.
     * - `gplThreadList`: 잠금 대상 선택(QuickPick)용 스레드 목록 — 마지막 폴 결과 기준, 조회 없음.
     */
    protected override customRequest(
        command: string,
        response: DebugProtocol.Response,
        args: any,
        request?: DebugProtocol.Request,
    ): void {
        if (command === 'gplFocusThread') {
            const name: string | undefined = typeof args?.name === 'string' ? args.name : undefined;
            const id = name ? this._threads.threadNameToId.get(name) : undefined;
            const state = name ? this._previousThreadStates.get(name) : undefined;
            const isStopped = state === 'Break' || state === 'Paused' || state === 'Error';
            if (name && id !== undefined && isStopped && this._configurationDone) {
                // 원래 정지 reason은 보관하지 않으므로 상태 기반 근사치 사용 (UI 라벨에만 영향).
                // 사용자가 직접 지목한 전환이므로 잠금 중에도 포커스를 준다(forceFocus).
                this.sendEvent(this._stoppedEvent(state === 'Error' ? 'exception' : 'breakpoint', id, { forceFocus: true }));
                this._log(`쓰레드 ${name} 포커스 전환 (트리 클릭 연동, StoppedEvent 재발사)`);
                response.body = { focused: true };
            } else {
                response.body = { focused: false };
            }
            this.sendResponse(response);
            return;
        }
        if (command === 'gplLockThread') {
            // 스레드 단일 실행 잠금 설정. name 또는 threadId 중 하나로 지정한다.
            const byName: string | undefined = typeof args?.name === 'string' ? args.name : undefined;
            const byId: number | undefined = typeof args?.threadId === 'number' ? args.threadId : undefined;
            const name = byName ?? (byId !== undefined ? this._threads.threadIdToName.get(byId) : undefined);
            if (!name || !this._threads.threadNameToId.has(name)) {
                response.body = { locked: false, name: null, reason: 'unknown-thread' };
                this.sendResponse(response);
                return;
            }
            this._setLockedThread(name);
            this._log(`스레드 실행 잠금: ${name} — Continue/Step 은 포커스와 무관하게 이 스레드에만 나갑니다.`);
            response.body = { locked: true, name };
            this.sendResponse(response);
            return;
        }
        if (command === 'gplUnlockThread') {
            const prev = this._lockedThreadName;
            this._setLockedThread(undefined);
            if (prev) { this._log(`스레드 실행 잠금 해제 (${prev}).`); }
            response.body = { locked: false, name: null, previous: prev ?? null };
            this.sendResponse(response);
            return;
        }
        if (command === 'gplLockState') {
            response.body = {
                name: this._lockedThreadName ?? null,
                redirects: this._lockRedirectCount,
            };
            this.sendResponse(response);
            return;
        }
        if (command === 'gplThreadList') {
            // 잠금 대상 선택용 목록(UI 전용 — 제어기 명령 없음, 마지막 폴 결과 기준).
            const threads = [...this._threads.threadNameToId.entries()].map(([name, id]) => ({
                id,
                name,
                state: this._previousThreadStates.get(name) ?? null,
            }));
            response.body = { threads, locked: this._lockedThreadName ?? null };
            this.sendResponse(response);
            return;
        }
        if (command === 'gplThreadInfo') {
            const threadId: number | undefined = typeof args?.threadId === 'number' ? args.threadId : undefined;
            const name = threadId !== undefined ? this._threads.threadIdToName.get(threadId) : undefined;
            response.body = {
                name: name ?? null,
                state: (name ? this._previousThreadStates.get(name) : undefined) ?? null,
                msSinceResume: this._lastResumeAt > 0 ? Date.now() - this._lastResumeAt : null,
            };
            this.sendResponse(response);
            return;
        }
        super.customRequest(command, response, args, request);
    }

    /**
     * CALL STACK 쓰레드 우클릭 "스레드 종료" — 표준 DAP 경로.
     * 선택한 쓰레드에만 `Stop <name>`을 전송한다 (전체 정지가 아님 — 그건 툴바 Stop -all).
     * 성공/실패는 §0.2대로 각 Stop 명령 자신의 STATUS로만 판정하고, 하나라도 실패하면
     * 에러 응답으로 알린다. 상태 반영은 폴링(_fastPoll)이 수행한다.
     */
    /** 잠근 스레드가 사라지는 경로(스레드 종료 등)에서 잠금을 정리한다. */
    private _releaseLockIfThread(name: string): void {
        if (this._lockedThreadName === name) {
            this._setLockedThread(undefined);
            this._log(`스레드 잠금 해제: 잠근 스레드 ${name} 가 종료되었습니다.`);
        }
    }

    protected override async terminateThreadsRequest(
        response: DebugProtocol.TerminateThreadsResponse,
        args: DebugProtocol.TerminateThreadsArguments,
    ): Promise<void> {
        const failures: string[] = [];
        this._userActionInFlight = true;
        try {
            for (const threadId of args.threadIds ?? []) {
                const name = this._threads.threadIdToName.get(threadId);
                if (!name) {
                    failures.push(`ID ${threadId}: 미등록 쓰레드`);
                    continue;
                }
                try {
                    const resp = await this._sendCmd(`Stop ${name}`);
                    const st = parseStatus(resp ?? '');
                    if (st.code === 0) {
                        this._log(`Stop ${name} (스레드 종료 메뉴) → STATUS 0`);
                        this._releaseLockIfThread(name);
                    } else {
                        this._log(`⚠ Stop ${name} (스레드 종료 메뉴) 실패 → STATUS ${st.code}${st.message ? `: ${st.message}` : ''}`);
                        failures.push(`${name}: STATUS ${st.code}${st.message ? ` ${st.message}` : ''}`);
                    }
                } catch (err: any) {
                    failures.push(`${name}: ${err?.message ?? err}`);
                }
            }
        } finally {
            this._userActionInFlight = false;
        }
        this._poll.fastPoll();
        if (failures.length) {
            this.sendErrorResponse(response, 1102, `쓰레드 Stop 실패 — ${failures.join(', ')}`);
        } else {
            this.sendResponse(response);
        }
    }

    // ═══════════════════════════════════════════════════════
    // Evaluate (hover / watch / REPL)
    // ═══════════════════════════════════════════════════════

    protected override async evaluateRequest(
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
        let evalRef = 0; // 배열/객체 결과의 variablesReference (0 = 확장 불가)
        // 값 색상화용 DAP 표준 타입 — 없으면 VS Code가 흐린 일반색으로 칠한다(dapColorizeType 주석).
        let evalType: string | undefined;

        // Determine thread context from frame or find first break thread
        let threadName: string | undefined;
        let frameIndex = 0;
        if (args.frameId !== undefined) {
            const fi = this._frames.frameIdToInfo.get(args.frameId);
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
            // 여러 줄을 붙여 넣으면 빈 줄을 빼고 위에서 아래로 순차 처리한다.
            // 각 줄의 정책은 단일 입력과 같다: 변수 평가 → 읽기 전용 폴백, `>`는 강제 전송.
            const entries = parseReplInput(args.expression);
            if (entries.length > 1) {
                const confirmationTargets = entries.filter(entry =>
                    entry.forceRaw
                    && entry.expression.length > 0
                    && !isReadOnlyConsoleCommand(entry.expression));
                const confirmBatch = confirmationTargets.length > 0
                    && vscode.workspace.getConfiguration('gpl')
                        .get<boolean>('debug.confirmDestructiveRepl', true);

                if (confirmBatch) {
                    const shown = confirmationTargets.slice(0, 8)
                        .map(entry => `> ${entry.expression}`);
                    if (confirmationTargets.length > shown.length) {
                        shown.push(`… 외 ${confirmationTargets.length - shown.length}개`);
                    }
                    const pick = await vscode.window.showWarningMessage(
                        [
                            `제어기 상태를 바꾸거나 분류되지 않은 명령 ${confirmationTargets.length}개를 포함합니다.`,
                            `입력 ${entries.length}개를 위에서 아래로 순서대로 실행할까요?`,
                            ...shown,
                        ].join('\n'),
                        { modal: true },
                        '모두 실행',
                    );
                    if (pick !== '모두 실행') {
                        response.body = {
                            result: '(취소됨 — 여러 줄 입력을 실행하지 않았습니다)',
                            variablesReference: 0,
                        };
                        this.sendResponse(response);
                        return;
                    }
                }

                const batchResults = [];
                for (const entry of entries) {
                    const evaluated = await this._evaluator.evaluateReplEntry(
                        entry,
                        threadName,
                        frameIndex,
                        true,
                    );
                    batchResults.push({ entry, result: evaluated.result });
                }
                result = formatReplBatchResults(batchResults);
            } else {
                const entry = entries[0] ?? {
                    source: expression,
                    expression,
                    forceRaw: false,
                };
                const evaluated = await this._evaluator.evaluateReplEntry(entry, threadName, frameIndex, false);
                result = evaluated.result;
                evalType = evaluated.type;
            }
        } else if (args.context === 'hover' || args.context === 'watch') {
            const cacheKey = [
                args.context,
                threadName,
                frameIndex,
                this._projectName,
                expression,
            ].join('\u001f');
            const cached = this._evaluator.getCachedEvaluate(cacheKey);
            if (cached !== undefined) {
                result = cached.value;
                evalRef = cached.ref;
                evalType = cached.type;
            } else {
                // Show Variable -eval thread frame variable → 배열/객체는 트리로 확장 가능
                // (변수 인덱스 식 `armList(i)`는 식별자 치환 재시도로 지원)
                const structured = threadName
                    ? await this._evaluator.queryVariableStructuredSmart(threadName, frameIndex, expression)
                    : null;
                if (structured) {
                    const kind = classifyVarEntry(structured.entry, structured.members.length > 0);
                    if (kind !== 'simple') {
                        const v = this._evaluator.makeVariable(
                            expression,
                            structured.entry,
                            threadName!,
                            frameIndex,
                            structured.resolvedExpression,
                            structured.members,
                        );
                        result = v.value;
                        evalRef = v.variablesReference;
                    } else if (structured.entry.value && structured.entry.value !== VariableEvaluator.UNDEFINED_VALUE) {
                        result = structured.entry.type
                            ? `${structured.entry.value}  (${structured.entry.type})`
                            : structured.entry.value;
                        evalType = dapColorizeType(structured.entry.type, structured.entry.value);
                    } else if (/\bnull\s*$/i.test(structured.entry.type)) {
                        // null 객체 참조 요소 (`armList(1), Object() null`)
                        result = `null  (${structured.entry.type})`;
                    }
                    // 프로퍼티를 백킹 필드로 치환해 얻은 값이면 출처를 함께 보인다(GitHub #26)
                    if (result && structured.via) { result += `  ← ${structured.via}`; }
                }
                if (!result && this._projectName) {
                    // Fallback: might be a global variable — Show Global은 프로젝트명이
                    // 필요하므로 비어 있으면 스킵한다 (REPL 경로와 동일한 가드).
                    const gResp = await this._sendCmd(
                        `Show Global ${expression}, ${this._projectName}`,
                        'data',
                    );
                    if (gResp) {
                        const lines = this._evaluator.showGlobalResponseLines(gResp);
                        result = lines.length > 0 ? lines.join('\n') : '';
                    }
                }
                // 모든 조회가 실패했을 때만 STATUS 에러 원인을 표시한다 — -729(미정의 심볼)는
                // 다른 모듈 전역일 수도 있어 Show Global 폴백을 먼저 거쳐야 한다.
                if (!result && structured?.error) {
                    result = formatEvalError(expression, structured.error);
                }
                this._evaluator.setCachedEvaluate(cacheKey, result || `(${expression} 평가 불가)`, evalRef, evalType);
            }
        } else if (args.context === 'clipboard') {
            // '값 복사' — 표시용 타입 접미·hex 힌트·백킹 필드 주석 없이 **원문 값만** 준다.
            // (supportsClipboardContext 를 선언하면 VS Code 가 이 컨텍스트로 다시 물어본다.)
            const structured = threadName
                ? await this._evaluator.queryVariableStructuredSmart(threadName, frameIndex, expression)
                : null;
            if (structured) {
                const kind = classifyVarEntry(structured.entry, structured.members.length > 0);
                if (kind === 'simple') {
                    result = structured.entry.value ?? '';
                } else {
                    // 배열/객체는 멤버를 `이름 = 값` 줄로 펼쳐서 복사할 수 있게 한다.
                    result = structured.members.length > 0
                        ? structured.members.map(m => `${m.name} = ${m.value}`).join('\n')
                        : (structured.entry.value ?? structured.entry.type ?? '');
                }
            }
            if (!result && this._projectName) {
                const gResp = await this._sendCmd(`Show Global ${expression}, ${this._projectName}`, 'data');
                if (gResp) { result = this._evaluator.showGlobalResponseLines(gResp).join('\n'); }
            }
        } else {
            result = expression;
        }

        response.body = { result: result || `(${expression} 평가 불가)`, variablesReference: evalRef, type: evalType };
        this.sendResponse(response);
    }

    // ═══════════════════════════════════════════════════════
    // Internal helpers
    // ═══════════════════════════════════════════════════════

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
        // 아직 보내지 않은 변수·Watch·전역 조회는 버린다 — 정지 컨텍스트가 바뀌어 값이 쓰이지 않는다(commandLanes.ts).
        this._lanes.invalidateData();
        this._evaluator.variableHandles.reset();
        this._frames.clearAll(); // ⑧ 진행 중이던 프레임 조회의 캐시 기록도 무효화
        this._evaluator.clearEvaluateCache();
        // 사용자 액션(step/continue/pause)이 나갔으면 자발적 Paused 추적은 의미가 없다 —
        // 이후 정지는 pending 경로가 판정한다. 남겨 두면 announced 플래그가 재히트를 가린다.
        this._spontaneousPause.clear();
    }

    // ═══════════════════════════════════════════════════════
    // 구조적 변수 표시 (배열/객체 트리 확장)
    // 응답 파싱/분류는 showVariableParser.ts — 실기기 캡처 픽스처로 단위 테스트한다.
    // ═══════════════════════════════════════════════════════

    // ─── Property → 백킹 필드 해석 (GitHub #26) ─────────────────────────────
    // 실측(GPL 4.2K5, 2026-08-25): -eval은 식의 **마지막 요소**가 사용자 Property/Function이면 -780을 낸다(체인 중간은 실행됨).
    // 값 자체는 백킹 필드에 있고, 객체 덤프에는 Private 포함 전체 필드가 프레임과 무관하게 실려 온다. 그래서
    // Property 이름 → 백킹 필드(파서가 기록한 Get 반환식 또는 관례 m_이름) → 필요 시 부모 덤프 추출 순으로 값을 찾는다.

    private async _resolveStopReasonForThread(threadName: string, fallback: string, polled?: ThreadInfo): Promise<string> {
        // 폴 줄(`Show Thread -web`)에 위치가 있으면 그것으로 판정한다 — Show Stack 응답을 기다리지 않고 StoppedEvent 를
        // 보내기 위해서다(2026-11-04, BP 판정은 맨 위 프레임의 파일·줄만 본다). 위치가 없는 형식일 때만 스택을 읽는다.
        const top = polled?.file && polled.fileLine && polled.fileLine > 0
            ? { file: polled.file, fileLine: polled.fileLine }
            : (await this._frames.getThreadFrames(threadName))[0];
        if (!top?.file || top.fileLine <= 0) {
            return fallback;
        }

        if (this._bps.hasBreakpointAt(top.file, top.fileLine)) {
            this._log(`현재 위치가 브레이크포인트와 일치: ${top.file}:${top.fileLine}`);
            return 'breakpoint';
        }

        return fallback;
    }

    /**
     * 차선 큐 등록. control 은 data 보다 먼저 나가고, data 는 실행 재개(_clearStaleState → invalidateData) 뒤 보내지 않고
     * null 로 끝난다. 연결 실패 뒤에는 100ms 쉬고 다음 명령(종전 동작 유지).
     */
    private _enqueueCommand<T>(work: (ctx: { waitedMs: number }) => Promise<T>, lane: CommandLane = 'control', staleValue?: T): Promise<T> {
        return this._lanes.enqueue(lane, work, { staleValue });
    }

    /**
     * Show Thread 폴을 연결 건강 프로브로 보낸다(프로브 타임아웃·실패 종류 분류, 예외 없음). 세션이 끊겨 있으면 null.
     * 결과는 호출측이 debugBridge.fireDebugProbeResult 로 확장에 보고한다 — 디버그 중엔 트리 폴링이 꺼져 있어
     * 확장의 유실 판정(controller/connection/connectionHealth.ts)은 이 경로에 의존한다(2026-08-28).
     */
    private async _probeThreadList(): Promise<ProbeOutcome | null> {
        if (!this._config || !this._isConnected) { return null; }
        this._lastControllerCommand = SHOW_THREAD_LIST_CMD;
        return this._enqueueCommand(async () => {
            if (!this._config || !this._isConnected) { return null; }
            return probeControllerCommand(SHOW_THREAD_LIST_CMD, this._config, this._probeTimeoutMs);
        });
    }

    /**
     * 제어기 명령 1회. `lane` 이 'data'(변수·Watch·전역 조회)면 control 명령 뒤로 밀리고, 실행 재개 뒤에는 보내지 않고
     * null 을 돌려준다 — 호출측은 null 을 "응답 없음"과 같이 다룬다(어차피 버려질 값이다).
     */
    private async _sendCmd(command: string, lane: CommandLane = 'control'): Promise<string | null> {
        if (!this._config || !this._isConnected) { return null; }
        this._lastControllerCommand = command;
        return this._enqueueCommand<string | null>(async ctx => {
            if (!this._config || !this._isConnected) { return null; }
            try {
                const started = Date.now();
                // `-compile` 이 붙은 Start 는 컴파일까지 수행해 응답이 Compile 과 같다(pass 사이 수 초 침묵).
                // 짧은 idle 완료로 받으면 잘려서 `-9999 No STATUS found` 가 되므로 종결자까지 기다린다(§1-DN).
                const result = commandRunsCompiler(command)
                    ? (await sendCommandDetailed(command, this._config, {
                        waitForStatusClose: true,
                        timeoutMs: Math.max(this._config.timeoutMs, 60000),
                    })).raw
                    : await sendCommand(command, this._config);
                const doneAt = Date.now();
                this._lastCmdTiming = { command, queueWaitMs: ctx.waitedMs, commandMs: doneAt - started, doneAt };
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
        }, lane, null);
    }

    /**
     * 재개 액션(step/continue/pause)의 명령이 끝난 직후 호출 — 타이밍 기록을 열고 pending 백업 폴 기준 시각을 잡는다.
     * 정지 감지 시 _pollThreadStates 의 finally 가 한 줄로 남긴다.
     */
    private _noteResumeSent(kind: string, threadName: string, requestedAt: number): void {
        const t = this._lastCmdTiming;
        this._resumeTiming = {
            kind, threadName, requestedAt, polls: 0,
            queueWaitMs: t?.queueWaitMs,
            commandMs: t?.commandMs,
            commandDoneAt: t?.doneAt,
        };
    }

    /**
     * Send a message to the Debug Console output.
     */
    private _log(message: string): void {
        this.sendEvent(new OutputEvent(`[GPL Debug] ${message}\n`, 'console'));
    }

    // ─── State Polling ────────────────────────────────────

    // 첫 N회 폴링에서 raw 응답을 로깅하여 진단 지원
    private _pollCount = 0;
    private static readonly DIAG_POLL_COUNT = 3;

    private async _pollThreadStates(force: boolean = false, source: StopPollSource = 'manual'): Promise<void> {
        if (!this._isConnected) { return; }
        if (this._pollInFlight) {
            // ④ 진행 중인 폴이 이번 상태 변화를 이미 지나쳤을 수 있으므로,
            //    트리거(force)이거나 pending 액션이 있으면 폴 완료 직후 1회 재폴 (유실 방지).
            if (force || this._pendingAction) { this._pollRetryRequested = true; }
            return;
        }
        // 사용자 액션(step/continue/pause/disconnect)이 진행 중이면 폴링을 보류.
        // 폴 명령이 1402 큐에서 사용자 명령보다 먼저 자리를 차지하지 않도록 한다.
        if (this._userActionInFlight) {
            if (force || this._pendingAction) { this._pollRetryRequested = true; }
            return;
        }
        // ② 디바운스: fast poll/1403 트리거(force=true)가 아닌 interval 폴이 직전 완료 후
        //    최소 간격 이내면 스킵 (중복 Show Thread 제거).
        if (!force && Date.now() - this._lastPollCompletedAt < PollDriver.POLL_MIN_GAP_MS) { return; }
        this._pollInFlight = true;
        const pendingBefore = this._pendingAction;
        if (this._resumeTiming && pendingBefore) { this._resumeTiming.polls++; }
        try {
            this._pollCount++;

            const probe = await this._probeThreadList();
            if (!probe) { return; }  // 세션이 이미 끊긴 뒤(_isConnected=false) — 보고할 것 없음
            // 확장의 연결 건강 모니터에 보고 — 디버그 중엔 트리 폴링이 꺼져 있어 이 결과가 유실 판정의 프로브다.
            fireDebugProbeResult(probe);
            if (!probe.ok) {
                this._pollFailures++;
                this._log(`[poll #${this._pollCount}] Show Thread 실패 ${this._pollFailures}/${GPLDebugSession.MAX_POLL_FAILURES}: ${probe.kind} — ${probe.detail}`);
                if (this._pollFailures >= GPLDebugSession.MAX_POLL_FAILURES) {
                    this._log(`연결 불안정 — ${this._pollFailures}회 연속 실패, 디버거를 종료합니다.`);
                    this._poll.stopPolling();
                    this._isConnected = false;
                    // 확장에도 알린다(connected:false). 확장은 이를 단정하지 않고 유실 힌트로 받아 자체 프로브로 확정한다 —
                    // 위 fireDebugProbeResult 로 이미 같은 실패가 보고돼 있으면 대개 이 시점에 유실이 확정된 뒤다.
                    this.sendEvent(new Event('gpl.controllerConnectionChanged', {
                        connected: false,
                        ip: this._config?.ip,
                        port: this._config?.port,
                        reason: `poll-failures: Show Thread ${this._pollFailures}회 연속 실패 (${probe.kind})`,
                    }));
                    this.sendEvent(new TerminatedEvent());
                }
                return;
            }
            this._pollFailures = 0;
            const resp = probe.raw;

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
                if (!this._threads.knownThreadNames.has(name)) {
                    const id = this._threads.getOrCreateThreadId(name);
                    this._threads.knownThreadNames.add(name);
                    if (this._configurationDone) {
                        this.sendEvent(new ThreadEvent('started', id));
                        this._log(`쓰레드 시작: ${name} (id=${id})`);
                    }
                }
            }

            // 사라진 쓰레드 → ThreadEvent('exited')
            for (const name of this._threads.knownThreadNames) {
                if (!currentNames.has(name)) {
                    const id = this._threads.threadNameToId.get(name);
                    this._threads.knownThreadNames.delete(name);
                    this._previousThreadStates.delete(name);
                    this._continueOrigin.delete(name); // 누적 방지
                    this._spontaneousPause.reset(name);

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
                const id = this._threads.getOrCreateThreadId(t.name);
                const isPausedState = t.state === 'Break' || t.state === 'Paused';
                // 정지 계열을 벗어나면(실행 재개 등) 자발적 Paused 추적을 초기화한다 —
                // 같은 위치에 다시 정지하는 경우에도 새 정지로 인정하기 위해서다.
                if (!isPausedState) { this._spontaneousPause.reset(t.name); }

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
                                    if (this._pendingContinuePausedSeen >= GPLDebugSession.CONTINUE_PAUSED_CONFIRM_COUNT) {
                                        isRealStop = true;
                                        this._log(`Continue 후 ${t.name} origin 없이 ${this._pendingContinuePausedSeen}회 paused 관측 → 정지 처리`);
                                    }
                                } else if (detail.file !== origin.file || detail.fileLine !== origin.line) {
                                    isRealStop = true;
                                    this._log(`Continue 후 위치 변경 감지: ${origin.file}:${origin.line} → ${detail.file}:${detail.fileLine}`);
                                } else {
                                    this._pendingContinuePausedSeen++;
                                    if (this._pendingContinuePausedSeen >= GPLDebugSession.CONTINUE_PAUSED_CONFIRM_COUNT) {
                                        isRealStop = true;
                                        this._log(`Continue 후 ${t.name} 같은 위치(${detail.file}:${detail.fileLine})에서 ${this._pendingContinuePausedSeen}회 paused → 정지 처리 (루프 재히트 또는 잔재 지속)`);
                                    }
                                }
                            } else {
                                // 위치 조회 실패 — 카운터 누적
                                this._pendingContinuePausedSeen++;
                                if (this._pendingContinuePausedSeen >= GPLDebugSession.CONTINUE_PAUSED_CONFIRM_COUNT) {
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

                            // 임시 BP 정리 + 조건부 BP/히트 조건/로그포인트 판정(자동 Continue 가능)
                            const announce = await this._handleBreakpointStop(t.name, id);
                            if (!announce) {
                                this._previousThreadStates.set(t.name, t.state);
                                if (t.state !== prevState) { threadStateChanged = true; }
                                continue;
                            }
                            if (!this._configurationDone) {
                                this._queuedStoppedEvents.push({ reason: 'breakpoint', threadId: id });
                                this._log(`쓰레드 ${t.name} Continue 후 정지 감지 → configurationDone 대기 중`);
                            } else {
                                this.sendEvent(this._stoppedEvent('breakpoint', id));
                                this._log(`쓰레드 ${t.name} 정지 (breakpoint)`);
                            }
                            // ⑧ 곧 도착할 stackTraceRequest를 위해 프레임 선조회(캐시 워밍)
                            this._frames.prefetchFramesAfterStop(t.name, t);

                            this._previousThreadStates.set(t.name, t.state);
                            if (t.state !== prevState) { threadStateChanged = true; }
                            continue;
                        }
                    }
                }

                // Step 명령은 폴링 사이에 Running 상태를 놓칠 수 있으므로,
                // pending step 상태에서 다시 paused/break가 보이면 step 완료로 처리한다.
                if (this._pendingAction === 'step' && this._pendingThreadId === id && isPausedState) {
                    this._frames.prefetchFramesAfterStop(t.name, t);
                    const reason = await this._resolveStopReasonForThread(t.name, 'step', t);
                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinueSawRunning = false;

                    if (!this._configurationDone) {
                        this._queuedStoppedEvents.push({ reason, threadId: id });
                        this._log(`쓰레드 ${t.name} 스텝 완료 감지 (${reason}) → configurationDone 대기 중`);
                    } else {
                        this.sendEvent(this._stoppedEvent(reason, id));
                        this._log(`쓰레드 ${t.name} 정지 (${reason})`);
                    }

                    this._previousThreadStates.set(t.name, t.state);
                    if (t.state !== prevState) { threadStateChanged = true; }
                    continue;
                }

                // ── 자발적 Paused 판별 (가짜 브레이크 차단) ──
                // 이 쓰레드를 기다리는 사용자 액션이 없는데 Paused/Break 가 보이는 경우다. GPL 은
                // Thread.Sleep 으로 자는 쓰레드도 Paused 로 보고하므로, 상태 전이만 보고 알리면
                // BP 없는 파일에서 가짜 브레이크가 뜬다. 위치를 근거로 걸러 낸다(추가 1402 왕복 없음).
                if (isPausedState && !this._isPendingFor(id)) {
                    const verdict = this._spontaneousPause.observe(
                        t.name, t.file, t.fileLine, (f, l) => this._bps.hasBreakpointAt(f, l));
                    if (verdict === 'scheduler' || verdict === 'announced') {
                        this._previousThreadStates.set(t.name, t.state);
                        if (t.state !== prevState) { threadStateChanged = true; }
                        continue;
                    }

                    // 정지로 인정 — 직전 정지의 값이 캐시에 남아 있을 수 있으므로 무효화한다.
                    this._evaluator.clearEvaluateCache();
                    this._frames.dropThread(t.name);

                    const where = `${t.file || '?'}:${t.fileLine ?? 0}`;
                    const reason = verdict === 'breakpoint' ? 'breakpoint' : 'pause';
                    if (reason === 'breakpoint') {
                        const announce = await this._handleBreakpointStop(t.name, id);
                        if (!announce) {
                            this._previousThreadStates.set(t.name, t.state);
                            if (t.state !== prevState) { threadStateChanged = true; }
                            continue;
                        }
                    }

                    if (!this._configurationDone) {
                        this._queuedStoppedEvents.push({ reason, threadId: id });
                        this._log(`쓰레드 ${t.name} 정지 감지 (${reason}, ${where}) → configurationDone 대기 중`);
                    } else {
                        this.sendEvent(this._stoppedEvent(reason, id));
                        this._log(verdict === 'breakpoint'
                            ? `쓰레드 ${t.name} 정지 (breakpoint ${where})`
                            : `쓰레드 ${t.name} 외부 정지 확정 (${where} 에서 ${this._spontaneousPause.confirmPolls}회 연속·`
                                + `${this._spontaneousPause.confirmMs}ms 이상 Paused — GDE/REPL 등 외부 Break 로 판단)`);
                    }
                    this._frames.prefetchFramesAfterStop(t.name, t);

                    this._previousThreadStates.set(t.name, t.state);
                    if (t.state !== prevState) { threadStateChanged = true; }
                    continue;
                }

                // Detect transition to Paused/Break state
                // 여기에 오는 것은 이 쓰레드를 기다리는 pending 액션이 있는 경우뿐이다
                // (그 외 자발적 Paused 는 위 블록이 판별 후 continue 로 처리한다).
                if (isPausedState &&
                    prevState !== 'Break' && prevState !== 'Paused') {

                    // Determine stop reason based on pending action
                    let reason = 'breakpoint';
                    if (this._pendingAction === 'step' && this._pendingThreadId === id) {
                        this._frames.prefetchFramesAfterStop(t.name, t);
                        reason = await this._resolveStopReasonForThread(t.name, 'step', t);
                    } else if (this._pendingAction === 'pause' && this._pendingThreadId === id) {
                        reason = 'pause';
                    } else if (this._pendingAction === 'entry') {
                        reason = 'entry';
                    }

                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinueSawRunning = false;

                    // BP 적중으로 판단되는 정지에만 조건 판정을 적용한다(step/pause/entry 는 사용자 조작).
                    if (reason === 'breakpoint') {
                        const announce = await this._handleBreakpointStop(t.name, id);
                        if (!announce) {
                            this._previousThreadStates.set(t.name, t.state);
                            if (t.state !== prevState) { threadStateChanged = true; }
                            continue;
                        }
                    }

                    // configurationDone 전이면 큐에 보관 (DAP 프로토콜 준수)
                    if (!this._configurationDone) {
                        this._queuedStoppedEvents.push({ reason, threadId: id });
                        this._log(`쓰레드 ${t.name} 정지 감지 (${reason}) → configurationDone 대기 중`);
                    } else {
                        this.sendEvent(this._stoppedEvent(reason, id));
                        this._log(`쓰레드 ${t.name} 정지 (${reason})`);
                    }
                    // ⑧ 곧 도착할 stackTraceRequest를 위해 프레임 선조회(캐시 워밍)
                    this._frames.prefetchFramesAfterStop(t.name, t);
                }

                // Detect transition to Error state → break on errors가 활성일 때만
                if (t.state === 'Error' && prevState !== 'Error') {
                    this._pendingAction = null;
                    this._pendingThreadId = undefined;
                    this._pendingContinueSawRunning = false;

                    await this._errors.emitErrorLocationEvent(id, t.name, t.lastStatus || 'Error');

                    if (this._breakOnErrors) {
                        if (!this._configurationDone) {
                            this._queuedStoppedEvents.push({ reason: 'exception', threadId: id });
                            this._log(`쓰레드 ${t.name} 에러 감지 → configurationDone 대기 중`);
                        } else {
                            this.sendEvent(this._stoppedEvent('exception', id));
                            this._log(`쓰레드 ${t.name} 에러 발생 (exception break)`);
                        }
                    } else {
                        this._log(`쓰레드 ${t.name} 에러 발생 (break on errors 비활성 — 무시)`);
                    }
                }

                // 외부 재개 감지: pending 액션 없이 Paused/Break/Error → Running 전이가 보이면
                // (GDE, REPL >Continue 등) ContinuedEvent로 VS Code의 일시정지 UI를 해제한다.
                // allThreadsContinued=false 를 **명시**해야 한다: VS Code 는 이 이벤트를
                // `body.allThreadsContinued !== false` 로 읽어(1.135 번들 확인 — 응답 필드와 기본값
                // 해석이 반대다) 필드를 생략하면 '전체 재개'로 보고 정지 상태로 남아 있는 다른
                // 스레드의 CALL STACK/변수까지 지운다.
                if (t.state === 'Running'
                    && (prevState === 'Break' || prevState === 'Paused' || prevState === 'Error')
                    && !this._pendingAction
                    && this._configurationDone) {
                    this.sendEvent(new ContinuedEvent(id, false));
                    this._log(`쓰레드 ${t.name} 외부 재개 감지 (continued)`);
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
            // 재개 액션의 정지가 이 폴에서 확인됐으면 타이밍을 한 줄로 남긴다 — 느릴 때 어느 구간(큐 대기/명령/감지)인지 보인다.
            if (this._resumeTiming && pendingBefore && !this._pendingAction) {
                this._log(formatResumeTiming(this._resumeTiming, this._lastPollCompletedAt, source));
                this._resumeTiming = null;
            }
            // GitHub #28: pending 이 해소됐으면 게이트로 무시한 요청 수를 1회 요약하고 0 으로
            if (!this._pendingAction && this._stepGateIgnored > 0) {
                this._log(`Step 게이트: 정지 확인 대기·최소 간격으로 무시한 요청 ${this._stepGateIgnored}건 (GitHub #28)`);
                this._stepGateIgnored = 0;
            }
            // ④ 이번 폴 진행 중 유실된 트리거가 있으면 즉시 1회 재폴 (30ms 뒤, force)
            if (this._pollRetryRequested) {
                this._pollRetryRequested = false;
                if (this._isConnected) {
                    setTimeout(() => { void this._pollThreadStates(true, 'retry'); }, 30);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // Source staleness — 제어기 컴파일 코드보다 새로운 소스 감지 + BP 강등 (GitHub #21)
    // ═══════════════════════════════════════════════════════

}
