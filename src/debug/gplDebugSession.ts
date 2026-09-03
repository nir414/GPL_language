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
    BreakpointEvent,
    InvalidatedEvent,
    ContinuedEvent,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

import {
    sendCommand,
    getControllerConfig,
    ControllerConfig,
    probeControllerCommand,
    getConnectionProbeTimeoutMs,
} from '../controller/controllerConnection';
import type { ProbeOutcome } from '../controller/controllerConnection';
import { deploy, findProjectDirs, jumpToFirstCompileError } from '../controller/deployService';
import { checkProjectName, describeProjectNameProblem } from '../controller/projectNameGuard';
import { gprPathInDir, resolveGprSourcePaths, resolveProjectLibraryDirs, walkTree } from '../project/projectSources';
import { getDeployLock, describeDeployLock } from '../controller/deployLock';
import {
    parseThreadList,
    parseThreadDetail,
    SHOW_THREAD_LIST_CMD,
    parseStack,
    parseVariable,
    parseBreakList,
    parseGpr,
    selectProjectFromCandidates,
    pickSourceCandidate,
    parseErrorLog,
    isSuccess,
    parseStatus,
    NO_STATUS_CODE,
    StackFrameInfo,
} from '../controller/responseParser';
import { GPLParser, GPLSymbolKind, GPLSymbol } from '../gplParser';
import { isReadOnlyConsoleCommand } from '../controller/consoleCommandClassifier';
import { fireDebugThreadsUpdated, fireDebugProbeResult, onDebugPollTrigger, getRuntimeConsoleHealth } from '../controller/debugBridge';
import {
    getCompiledRecord,
    compareWithLocal,
    onDidRecordCompiled,
    formatCompiledAt,
} from '../controller/deployRecord';
import type { CompiledRecord, SnapshotDiff } from '../controller/deployRecord';
import { shouldGateStepRequest, StepGateReason } from './stepGate';
import { SpontaneousPauseTracker } from './spontaneousPause';
import {
    isAllThreadsResumeRequest,
    resolveExecutionThread,
    shouldPreserveFocus,
} from './threadLock';
import { buildStartCommand } from '../controller/startCommand';
import {
    breakpointCandidateLines,
    buildProcedureRanges,
    enclosingProcedure,
    parseCallTargets,
    resolveBreakpointLine,
    ProcedureRange,
} from './sourceTargets';
import {
    ParsedVarEntry,
    parseShowVariableMulti,
    classifyVarEntry,
    arrayRank,
    isLocationType,
    summarizeLocation,
    annotateLocationMember,
    dapColorizeType,
} from './showVariableParser';
import {
    extractIndexIdentifierTokens,
    replaceIndexIdentifierTokens,
} from '../language/cursorExpression';

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

let sharedDeployOutput: vscode.OutputChannel | undefined;

function getDeployOutputChannel(): vscode.OutputChannel {
    if (!sharedDeployOutput) {
        sharedDeployOutput = vscode.window.createOutputChannel('GPL Deploy (Debug)');
    }
    return sharedDeployOutput;
}

/** GPL 콘솔 STATUS -729 "*Undefined symbol*" — 그 실행 컨텍스트에서 이름이 보이지 않음. */
const UNDEFINED_SYMBOL_STATUS = -729;

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
    /** `Start -stack <KB>` — 프로시저 스택 크기(문서 기본 4 KB). 1~1024 범위 밖은 무시. */
    startStackSizeKb?: number;
    /** `Start -init` — trace/단일 스텝 중 초기화 문장도 표시(문서: -break/-trace 와 함께 쓴다). */
    startShowInitStatements?: boolean;
    /** `Start -trace` — 실행 문장을 콘솔에 표시. 문서가 성능 저하를 경고하므로 진단용으로만. */
    startTrace?: boolean;
}

// ─── Scope handle payload ────────────────────────────────

/**
 * Variables 패널 핸들 페이로드.
 * - locals/globals: 최상위 스코프
 * - members: 객체 조회 응답에 이미 포함된 멤버 줄들(공식 Show Variable 문서: 객체는
 *   `variable, Object` + 멤버별 `variable.field, type, value` 줄로 응답) — 재조회 없이 표시
 * - expand: 배열 또는 중첩 객체 노드 — 펼칠 때 Show Variable -eval로 지연 조회
 */
type ScopeRef =
    | { type: 'locals'; threadName: string; frameIndex: number }
    | { type: 'globals'; threadName: string; frameIndex: number }
    | {
        type: 'members';
        threadName: string;
        frameIndex: number;
        /** 멤버 경로 조합용 부모 식 (setVariable/Watch 추가에 사용) */
        parentExpression: string;
        entries: ParsedVarEntry[];
        /** 헤더 타입(`Object RNDRobot`) — 클래스 Property 가상 자식 생성용(GitHub #26) */
        classType?: string;
    }
    | {
        type: 'expand';
        threadName: string;
        frameIndex: number;
        /** 제어기에 보낼 전체 식 (예: `loc.Pos`, `myArr`) */
        expression: string;
        /** Show Variable이 보고한 타입 문자열 (예: `Object`, `Double(,)`) */
        varType: string;
    };

interface GlobalVariableDescriptor {
    displayName: string;
    lookupNames: string[];
    /** 선언이 `Private`인 모듈 전역 — 값 쓰기 실패의 원인 설명에 쓴다(열거는 종전대로 한다). */
    isPrivate?: boolean;
}

// ─── Pending action for StoppedEvent reason ──────────────

type PendingAction = 'step' | 'pause' | 'entry' | 'continue' | null;

// ─── Source staleness (GitHub #21) ──────────────────────

/**
 * "로컬 소스가 제어기 컴파일 코드보다 새로움" 항목. 근거:
 * - compiled-before-edit: 마지막 Compile 스냅샷(deployRecord)과 파일 내용(sha1)이 다름
 * - saved-in-session: 이 디버그 세션 중 저장됨(스냅샷이 없어도 확정 가능 — 제어기는 attach 전 코드를 실행 중)
 */
interface StaleSourceEntry {
    /** 프로젝트 폴더 기준 상대 경로('/' 구분) — 이벤트/로그 표기용 */
    relPath: string;
    reason: 'compiled-before-edit' | 'saved-in-session';
    /** 세션 중 저장 시각(ms). 컴파일 기록이 이 시각 이후로 갱신되면(재컴파일) 해제 */
    savedAt?: number;
}

// ─── 조건부 BP / 로그포인트 (클라이언트 측 흉내) ────────────

/**
 * BP 하나에 붙은 조건 메타. 제어기에는 조건 개념이 없으므로 어댑터가 적중 시점에 판정한다.
 * `hits`는 이 세션에서 그 줄이 적중한 횟수(히트 조건 판정용).
 */
interface BreakpointMeta {
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
    hits: number;
}

/** 프로시저 이름 브레이크포인트 한 개. */
interface FunctionBreakpointEntry {
    /** 사용자가 입력한 이름(`Class.Proc` 또는 `Proc`) */
    name: string;
    /** 해석된 파일 basename */
    file: string;
    /** 해석된 1-based 줄(첫 실행 문장) */
    line: number;
    id: number;
}

// ─── Session ─────────────────────────────────────────────

export class GPLDebugSession extends LoggingDebugSession {
    private static readonly MIN_DEBUG_POLL_INTERVAL_MS = 1000;
    private static readonly MAX_DEBUG_POLL_INTERVAL_MS = 5000;
    // ⑦ 백업 인터벌 폴 간격(Running 쓰레드 존재 + 1403 부재 시). 실행 중 BP 히트는 1403 상태
    //    이벤트 트리거가 주 신호이고, 이 값은 1403 유실/미연결 시의 안전망이다.
    //    GitHub #22('5번째 다운' 제안 2): 1403 이 정상인데도 항상 1Hz 로 돌던 이 폴이 부팅 후 77분간
    //    Show Thread -web 922회를 만들었다. 이제 debugBridge 의 1403 health 가 alive 면 사용자 간격
    //    (_pollIntervalMs)으로 완화하고, 1403 부재일 때만 이 값(설정 gpl.debug.runningBackupPollMs,
    //    하한 250ms, attach 시 1회 읽음)을 쓴다. (그 이전: 항상 사용자 간격 → BP 히트 감지 최대 5초 지연)
    private static readonly DEFAULT_RUNNING_BACKUP_POLL_MS = 1000;
    private static readonly MIN_RUNNING_BACKUP_POLL_MS = 250;
    private _runningBackupPollMs = GPLDebugSession.DEFAULT_RUNNING_BACKUP_POLL_MS;
    // 직전에 적용한 백업 폴 정책 — 바뀔 때만 1회 로그(폴마다 로그하면 소음)
    private _backupPollPolicy: 'alive' | 'absent' | undefined;

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

    // Workspace source file cache: basename → 후보 전체 경로들(동명 파일 전부 보존).
    // 기존에는 경로 1개만 저장해 스캔 순서상 마지막 파일이 조용히 이겼고, 워크스페이스에
    // 프로젝트 사본/백업 폴더가 있으면 정지 시 엉뚱한 폴더의 파일이 열렸다.
    private _sourceFileMap = new Map<string, string[]>();
    /**
     * 소스맵을 컴파일 단위(`_projectDirs`)로 좁혔는데 못 찾은 파일이 나와 워크스페이스 전체로
     * 넓혔는가. 한 번 넓히면 세션(정확히는 다음 `_updateProjectDirs`)까지 유지한다 — 재구축마다
     * 좁혔다 넓혔다 하면 같은 스캔을 반복한다.
     */
    private _sourceMapWidened = false;
    // 디버그 대상 프로젝트의 폴더(Project.gpr 위치들) — 동명 소스 경합 시 우선 선택 기준.
    private _projectDirs: string[] = [];
    /** 대상 프로젝트 .gpr 의 ProjectSource 절대 경로 — 동명 소스 경합 판정의 1순위 기준. */
    private _projectSourcePaths: string[] = [];
    /**
     * `ProjectLibrary` 로 참조된 하위 프로젝트의 폴더(= `_projectDirs` 중 라이브러리 몫).
     * 이 폴더 아래 소스는 제어기가 BP 대상 파일로 찾지 못한다 — `_librarySourceBpHint` 참조.
     */
    private _libraryDirs: string[] = [];
    /**
     * 제어기가 `-508 File not found` 로 거부한 BP 대상 파일(basename 소문자). 같은 파일의 다음
     * 줄부터는 표기 폴백(최대 4왕복)을 생략하고 1회만 시도한다 — 어차피 표기 문제가 아니다.
     */
    private _bpRejectedFiles = new Set<string>();
    /** BP 대상 파일을 프로젝트 기준 상대 경로로 지칭해야 하는 제어기인지(첫 성공에서 학습). */
    private _bpPreferProjectRelativeFile = false;
    // 경합 경고 로그를 베이스네임당 1회로 제한(소스맵 재구축 시 리셋)
    private _sourceResolveWarned = new Set<string>();
    // 전역 조회 방식 메모(세션 유지, 소스맵 재구축 시 리셋): 정지마다 전역당 최대 3회이던
    // 직렬 왕복을 성공 방식 기억으로 1회로 줄인다. 'none' = 전부 실패(폴백 생략 대상).
    private _globalQueryMemo = new Map<
        string,
        { method: 'eval' } | { method: 'global'; name: string } | 'none'
    >();
    // 전역 후보 열거 캐시 — 63파일 read+parse를 variablesRequest마다 반복하지 않는다.
    private _globalDescriptorsCache: GlobalVariableDescriptor[] | undefined;
    // Property 심볼 색인(이름별·클래스별) — -780 백킹 필드 치환과 가상 Property 자식에 사용(GitHub #26). 소스맵 세대 동안 캐시.
    private _propertyIndexCache: { byName: Map<string, GPLSymbol[]>; byClass: Map<string, GPLSymbol[]> } | undefined;

    // State polling
    private _pollTimer: ReturnType<typeof setTimeout> | undefined;
    // 인터벌 폴 체인 세대 토큰 — _stopPolling/_startPolling 시 이전 체인 무효화.
    private _pollTimerGen = 0;
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
    // ⑦ 1403 트리거(비-pending) 코얼레싱: 디바운스 창 안에 도착한 트리거를 버리지 않고
    //    창 만료 직후 1회 폴로 합쳐 예약한다 (자유 실행 BP 히트 감지 유실 방지).
    private _triggerPollPending = false;
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

    // ── 조건부 BP / 히트 조건 / 로그포인트 (클라이언트 측 흉내, 기본 OFF) ──────────────
    // 제어기 `Set Break` 에는 조건·히트 조건·로그 스위치가 없다(공식 문서 확인). 그래서 조건은
    // "적중 → 조건 평가 → 불일치면 자동 Continue" 로 흉내낸다. 자동 재개는 모션을 다시 움직이므로
    // 설정으로 켤 때만 동작한다. 키: basename 소문자 → 줄 번호 → 메타.
    private _bpMeta = new Map<string, Map<number, BreakpointMeta>>();
    // 자동 재개 횟수(세션 누적) — 첫 건과 이후 일정 간격으로만 로그를 남긴다.
    private _autoResumeCount = 0;

    // ── 프로시저 이름 브레이크포인트 ─────────────────────────────────────────────
    // VS Code BREAKPOINTS 뷰의 함수 BP. 파서로 `Class.Proc` → 파일·첫 실행 줄을 찾아 Set Break 로 바꾼다.
    // 소스 BP 와 같은 파일에 있을 수 있으므로 setBreakPointsRequest 의 파일 정리에서 제외해야 한다.
    private _functionBps: FunctionBreakpointEntry[] = [];

    // ── Jump to Cursor / Step Into Target 의 대상 핸들 ───────────────────────────
    private _gotoTargetHandles = new Map<number, { file: string; line: number; procedure: string }>();
    private _stepInTargetHandles = new Map<number, { label: string; file: string; line: number }>();
    private _targetIdCounter = 0;
    // Step Into Target 이 심어 둔 임시 BP(정지 후 정리). basename 소문자 → 줄 집합.
    private _tempBreakpoints = new Map<string, Set<number>>();

    // Stack frame cache — pending step/continue 동안 UI에 반환할 직전 프레임 캐시
    private _cachedFrames = new Map<string, StackFrameInfo[]>();
    // ③ Show Stack 캐시 신선도: 정지 위치별 마지막 조회 시각 + 짧은 TTL.
    //    같은 정지 동안 stackTrace/scopes/variables 연속 요청을 1회 조회로 합친다.
    private _frameCacheAt = new Map<string, number>();
    // ⑧ 프레임 캐시 세대 — _clearStaleState/_fastPoll에서 bump. 진행 중이던 Show Stack
    //    조회가 무효화 이후 완료되면 결과를 캐시에 기록하지 않는다(stale 재주입 방지).
    private _frameCacheGen = 0;
    // 정지 중 프레임은 변하지 않고 새 step/continue 시 _fastPoll()이 무효화하므로,
    // TTL을 넉넉히 둬서 정지 직후 stackTrace의 Show Stack 재조회 왕복을 줄인다 (400→1500ms).
    private static readonly FRAME_CACHE_TTL_MS = 1500;

    // Evaluate cache — hover/watch 반복 조회가 1402 명령 큐를 막지 않게 한다.
    // 정지 중 값은 불변에 가깝고(step/continue 시 _clearStaleState, setVariable/REPL 명령 시
    // _clearEvaluateCache가 무효화) TTL을 늘려 같은 변수 재호버를 즉시 응답한다 (750→3000ms).
    private static readonly EVALUATE_CACHE_TTL_MS = 3000;
    // ref: 배열/객체 결과의 variablesReference — 핸들은 _clearStaleState에서 캐시와 함께
    // 리셋되므로 수명이 일치한다(캐시가 무효 핸들을 돌려줄 일 없음).
    private _evaluateCache = new Map<string, { value: string; ref: number; type?: string; timestamp: number }>();

    // Session-level disposables — disconnectRequest에서 정리
    private _disposables: vscode.Disposable[] = [];

    // Breakpoint tracking — file basename → set of line numbers
    private _breakpoints = new Map<string, Set<number>>();

    // GPL 의 `Paused` 는 디버거 정지 전용 상태가 아니다 — `Thread.Sleep` 등으로 스케줄러가 재운
    // 쓰레드도 Paused 로 보고된다(실측 2026-08-31: 같은 폴 루프를 도는 쓰레드들이 샘플마다
    // Running↔Paused 를 오가고, Paused 인 채로 줄 번호가 818→819 로 전진했다. 그 파일에는 BP 가
    // 하나도 없었다). 사용자 액션 없이 관측된 Paused 를 그대로 정지로 알리면 BP 없는 파일에서
    // 가짜 브레이크가 뜨므로, 등록된 BP 줄과 일치할 때만 즉시 인정하고 나머지는 아래 관측으로 미룬다.
    // 판정 규칙과 근거는 debug/spontaneousPause.ts 참조(단위 테스트 있음).
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

    // GitHub #21: 제어기 컴파일 코드보다 새로운 로컬 소스(basename 소문자 → 항목). 이 파일들의 BP 는
    // 제어기에는 종전대로 설정하되 verified=false 로 강등한다 — 제어기는 옛 컴파일 코드의 줄 번호로 BP 를
    // 받아 "성공"을 돌려주지만 실제 코드 줄과 어긋나 절대 걸리지 않을 수 있다.
    private _staleFiles = new Map<string, StaleSourceEntry>();
    // 판정에 쓴 컴파일 기록의 시각(BP message/이벤트 표기용). 기록 없음 = undefined
    private _compiledRecordAt: number | undefined;
    private _staleNoRecordLogged = false;
    // DAP breakpoint id(BreakpointEvent 로 verified 상태를 바꾸려면 id 가 필요) — basename 소문자 → (line → id)
    private _bpIdCounter = 0;
    private _bpIds = new Map<string, Map<number, number>>();

    // Known thread names — for detecting new/exited threads (ThreadEvent)
    private _knownThreadNames = new Set<string>();

    // Consecutive poll failures — auto-terminate after threshold.
    // 2026-08-28: 5 → 3 으로, 확장의 연결 건강 모니터(controller/connectionHealth.ts failureThreshold=3)와 맞춘다 —
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
    // Start 스위치(launch 구성에서 옴 — 문서 구문은 startCommand.ts 참조)
    private _startStackSizeKb: number | undefined;
    private _startShowInitStatements = false;
    private _startTrace = false;

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
            if (startApproved && !(await this._waitDeployLockForStart('자동 Start'))) {
                // 다른 창/프로세스의 업로드/배포가 계속 잡혀 있음 — 업로드 도중 Start는 제어기 이상을 유발할 수 있어 보내지 않는다.
                vscode.window.showWarningMessage(
                    `Start 보류 — 다른 배포/업로드가 진행 중입니다. 완료 후 디버그 콘솔에서 >Start ${this._projectName} 를 사용하세요.`,
                );
            } else if (startApproved) {
                const startCmd = this._buildStartCommand({});
                this._log(`${startCmd} (auto-start after configurationDone)`);
                await this._sendCmd(startCmd);
                // Start 직후 곧바로 히트하는 BP(진입 부근 정지)를 빠르게 감지한다 (읽기 전용 폴).
                this._fastPoll();
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
        this._probeTimeoutMs = getConnectionProbeTimeoutMs();
        this._log(
            `폴링 간격 적용: user=${userInterval}ms, effective=${this._pollIntervalMs}ms ` +
            `(fast poll: ${GPLDebugSession.FAST_POLL_DELAYS_MS.join('/')}ms, 1403 trigger: on data, ` +
            `프로브 타임아웃 ${this._probeTimeoutMs}ms · 연속 ${GPLDebugSession.MAX_POLL_FAILURES}회 실패 시 종료)`
        );

        // GitHub #28 / #22: 세션 동안 고정되는 디버그 설정 — attach 시 1회만 읽어 필드에 보관한다.
        const dbgCfg = vscode.workspace.getConfiguration('gpl.debug');
        const minStepRaw = dbgCfg.get<number>('minStepIntervalMs', GPLDebugSession.DEFAULT_MIN_STEP_INTERVAL_MS);
        this._minStepIntervalMs = typeof minStepRaw === 'number' && Number.isFinite(minStepRaw) && minStepRaw > 0
            ? Math.floor(minStepRaw)
            : 0;
        const backupRaw = dbgCfg.get<number>('runningBackupPollMs', GPLDebugSession.DEFAULT_RUNNING_BACKUP_POLL_MS);
        this._runningBackupPollMs = Math.max(
            GPLDebugSession.MIN_RUNNING_BACKUP_POLL_MS,
            typeof backupRaw === 'number' && Number.isFinite(backupRaw)
                ? Math.floor(backupRaw)
                : GPLDebugSession.DEFAULT_RUNNING_BACKUP_POLL_MS,
        );
        this._backupPollPolicy = undefined;
        this._stepGateIgnored = 0;
        this._log(
            `Step 게이트: 정지 확인 전 요청 무시 + 최소 간격 ${this._minStepIntervalMs > 0 ? `${this._minStepIntervalMs}ms` : '없음'} (GitHub #28) / ` +
            `Running 백업 폴: 1403 부재 시 ${this._runningBackupPollMs}ms, 1403 정상 시 ${this._pollIntervalMs}ms (GitHub #22)`,
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
            const deployResult = await this._runDeployBeforeAttach(args);
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
        if (!this._projectName) {
            this._projectName = await this._detectProjectName();
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
        const clearProjectBreakpointsOnAttach = args.clearProjectBreakpointsOnAttach !== false;
        // 세션 종료(disconnect) 시 프로그램 정지 여부를 기억해 둔다.
        this._stopAllOnDisconnect = args.stopAllOnDisconnect === true;
        this._startStackSizeKb = typeof args.startStackSizeKb === 'number' ? args.startStackSizeKb : undefined;
        this._startShowInitStatements = args.startShowInitStatements === true;
        this._startTrace = args.startTrace === true;
        if (this._startTrace) {
            this._log('⚠ Start -trace: 실행 문장을 콘솔에 표시합니다 — 공식 문서가 성능 저하를 경고합니다(진단용).');
        }
        if (stopAllBeforeAttach || clearProjectBreakpointsOnAttach) {
            await this._runAttachPreflight(stopAllBeforeAttach, clearProjectBreakpointsOnAttach);
        }

        // Build source file map for path resolution
        this._updateProjectDirs();
        this._buildSourceFileMap();

        // GitHub #21: 로컬 소스가 제어기 컴파일 코드보다 새로운지 판정(Attach only 의 핵심 사용 사례).
        // deployBeforeAttach 성공 경로는 방금 기록이 갱신됐으므로 stale 이 없는 것이 정상이지만, 그래도
        // 호출해 빈 목록 이벤트로 상태바 배지를 정리한다. 이후 세션 중 저장·재컴파일에도 반응한다.
        this._evaluateSourceStaleness('attach');
        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument(doc => this._onSourceSavedInSession(doc)),
            onDidRecordCompiled(rec => this._onRecordCompiled(rec)),
        );

        // If stopOnEntry, start the project with -break to pause at Main's first line
        this._stopOnEntry = !!args.stopOnEntry;
        if (this._stopOnEntry && this._projectName && !(await this._waitDeployLockForStart('stopOnEntry Start'))) {
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
                if (!this._isConnected) { return; }
                if (this._pendingAction) {
                    // step/continue/entry/pause 대기 중 — force=true로 250ms 디바운스를
                    // 우회해 트리거가 유실되지 않도록 한다. (가드에 막히면
                    // _pollRetryRequested가 표시되어 직후 재폴된다)
                    this._log('[1403] 데이터 감지 → 즉시 폴 트리거');
                    void this._pollThreadStates(true);
                } else {
                    // ⑦ pending 액션이 없어도 폴 — 자유 실행 중 BP 히트/다른 쓰레드 정지도
                    // 1403 상태 이벤트로 먼저 신호가 온다. 코얼레싱 예약이라 이벤트가
                    // 폭주해도 폴은 POLL_MIN_GAP_MS당 1회로 합쳐지고, 디바운스/가드에
                    // 걸린 트리거도 유실되지 않는다.
                    this._requestTriggerPoll();
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
        this._cancelGateResync(); // GitHub #28: 세션 종료 — 예약된 UI 복귀 재발사 전부 취소
        this._userActionInFlight = true;

        // Clear all breakpoints on the controller — 디버거 종료 후에 옛 BP가 잔존하면
        // 다음 세션에서 중복 등록될 수 있으므로 깔끔하게 정리한다.
        if (this._isConnected && this._projectName) {
            for (const [file, lines] of this._breakpoints) {
                for (const line of lines) {
                    await this._sendBpCommandWithFallback('Nobreak', this._projectName, file, line);
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

        // GitHub #21: 상태바의 소스 변경 배지 정리(빈 목록 이벤트) + 세션 한정 stale/BP id 상태 초기화
        this._staleFiles.clear();
        this._bpIds.clear();
        this._compiledRecordAt = undefined;
        this._sendSourceStaleEvent('disconnect');

        this._breakpoints.clear();
        this._spontaneousPause.clear();
        this._bpRejectedFiles.clear();
        this._knownThreadNames.clear();
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
            // 이 파일의 프로시저 이름 BP(함수 BP)는 별도 목록이 관리한다 — 파일 정리에 휩쓸리지 않게 남긴다.
            if (this._functionBps.some(f => f.file.toLowerCase() === baseName.toLowerCase() && f.line === line)) {
                continue;
            }
            await this._sendBpCommandWithFallback('Nobreak', proj, baseName, line);
        }

        // Set new breakpoints using correct Brooks syntax (GDE 캡처 기준):
        // Set Break project_name "file_name"line_number  (따옴표와 줄번호 사이 공백 없음)
        const actualBreakpoints: DebugProtocol.Breakpoint[] = [];
        const newLines = new Set<number>();
        // GitHub #21: 이 파일이 stale(제어기 컴파일 코드보다 새로움)이면 제어기에는 종전대로 Set Break 를 보내되
        // 응답에서 verified=false 로 강등한다 — 제어기는 옛 코드의 줄 번호로 받아 "성공"해도 실제 코드 줄과
        // 어긋날 수 있다. 재배포 후 onDidRecordCompiled 가 BreakpointEvent 로 verified=true 를 복원한다.
        const baseKey = baseName.toLowerCase();
        const staleEntry = this._staleFiles.get(baseKey);
        const staleMessage = staleEntry ? this._staleBreakpointMessage() : undefined;
        // BreakpointEvent('changed') 로 상태를 바꾸려면 id 가 필요 — 파일 단위로 새로 부여(직전 세트는 폐기)
        const idMap = new Map<number, number>();

        // 조건부 BP / 히트 조건 / 로그포인트 메타(설정이 꺼져 있으면 수집하지 않는다 — capability 미선언이라 오지도 않는다)
        const clientSideBpLogic = this._clientSideBpLogicEnabled();
        const metaForFile = new Map<number, BreakpointMeta>();

        for (const requestedLine of clientLines) {
            // 문서 규칙: 빈 줄·주석을 지정하면 제어기가 다음 실행 문장으로 옮긴다.
            // 어느 줄로 옮겨지는지 미리 계산해 그 줄로 설정하고 응답에도 그 줄을 돌려준다
            // (그러지 않으면 VS Code 의 BP 표시와 실제 정지 줄이 어긋난다).
            const adjusted = this._adjustBreakpointLine(baseName, requestedLine);
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
            const cmd = this._bpCommand('Break', proj, baseName, line);
            // Nobreak 와 같은 폴백을 태운다(무공백/문서 표기 × basename/프로젝트 상대 경로) —
            // 종전에는 Break 만 basename 무공백 1회여서 표기를 가리는 제어기에서 조용히 실패했다.
            // 단, 이미 -508 로 거부된 파일은 표기 문제가 아니므로 1회만 시도해 왕복을 아낀다.
            const sendBreak = () => (this._bpRejectedFiles.has(baseKey)
                ? this._sendCmd(cmd)
                : this._sendBpCommandWithFallback('Break', proj, baseName, line));
            const resp = await sendBreak();
            // "Duplicate breakpoint" 응답은 컨트롤러에 이미 동일 BP가 있다는 뜻이다.
            // Nobreak 정리가 실패했을 수 있으므로 한 번 더 정리 후 재설정하여 단일 BP 보장.
            let finalResp = resp;
            if (resp !== null && /Duplicate breakpoint/i.test(resp)) {
                this._log(`⚠ Duplicate BP 감지, 재설정: ${cmd}`);
                await this._sendBpCommandWithFallback('Nobreak', proj, baseName, line);
                finalResp = await sendBreak();
            }
            const verified = finalResp !== null && isSuccess(finalResp);
            const bp = new Breakpoint(verified && !staleEntry, line) as DebugProtocol.Breakpoint;
            bp.id = ++this._bpIdCounter;
            idMap.set(line, bp.id);
            if (!verified) {
                const msg = finalResp
                    ? finalResp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0]
                    : '응답 없음';
                // -508 File not found 는 원문만으로는 원인을 알 수 없다. 라이브러리 소스면
                // 왜 안 되는지와 손 쓸 방법을 툴팁에 함께 준다 (파일당 1회만 로그).
                const notFound = finalResp !== null && parseStatus(finalResp).code === -508;
                const hint = notFound ? this._librarySourceBpHint(baseName) : undefined;
                bp.message = hint ? `${msg} — ${hint}` : msg;
                if (notFound && !this._bpRejectedFiles.has(baseKey)) {
                    this._bpRejectedFiles.add(baseKey);
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

        this._bpIds.set(baseKey, idMap);
        this._breakpoints.set(baseName, newLines);
        this._bpMeta.set(baseKey, metaForFile);
        if (staleEntry && newLines.size > 0) {
            this._log(`⚠ stale 파일 BP: ${baseName} [${[...newLines].join(', ')}] — 제어기에는 설정했으나 신뢰 불가 (${staleEntry.relPath}, GitHub #21)`);
        }

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
        this._warnIfBreakpointLimitExceeded();
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
        // 캐시 배열(_lastThreadList)을 제자리 정렬로 오염시키지 않도록 사본을 정렬한다.
        const sorted = [...threads].sort((a, b) => this._threadStateRank(a.state) - this._threadStateRank(b.state));
        const dapThreads: Thread[] = [];
        for (const t of sorted) {
            const id = this._getOrCreateThreadId(t.name);
            // 여기서 VS Code에 이미 알려진 쓰레드는 known 집합에 등록해 다음 폴이
            // 중복 ThreadEvent('started')를 내지 않게 한다.
            this._knownThreadNames.add(t.name);
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
                // 3) 각 변수를 개별 Show Variable로 조회 — 배열/객체는 트리로 확장 가능
                for (const varName of varNames) {
                    const structured = await this._queryVariableStructured(
                        scopeInfo.threadName, scopeInfo.frameIndex, varName,
                    );
                    if (structured) {
                        variables.push(this._makeVariable(
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
            const globals = this._getGlobalVariableDescriptors();

            for (const g of globals) {
                const memoKey = g.displayName.toLowerCase();
                const memo = this._globalQueryMemo.get(memoKey);

                // 1) 이전에 Show Global로만 성공했던 전역은 -eval 생략하고 직행
                if (memo && memo !== 'none' && memo.method === 'global') {
                    const value = await this._readGlobalValueSingle(memo.name);
                    if (value) {
                        variables.push(this._markGlobalWritability(
                            { name: g.displayName, value, variablesReference: 0 }, g,
                        ));
                    } else {
                        // 상황 변화(프로젝트 재시작 등) — 다음 정지에서 전체 사다리 재시도
                        this._globalQueryMemo.delete(memoKey);
                    }
                    continue;
                }

                // 2) -eval 시도 (기본 경로 — 배열/객체 트리 지원)
                let pushed = false;
                if (scopeInfo.threadName) {
                    const structured = await this._queryVariableStructured(
                        scopeInfo.threadName, scopeInfo.frameIndex, g.lookupNames[0],
                    );
                    const entry = structured?.entry;
                    if (entry && (classifyVarEntry(entry, structured!.members.length > 0) !== 'simple'
                        || (entry.value && entry.value !== GPLDebugSession.UNDEFINED_VALUE))) {
                        variables.push(this._markGlobalWritability(this._makeVariable(
                            g.displayName,
                            entry,
                            scopeInfo.threadName,
                            scopeInfo.frameIndex,
                            g.lookupNames[0],
                            structured!.members,
                        ), g));
                        this._globalQueryMemo.set(memoKey, { method: 'eval' });
                        pushed = true;
                    }
                }

                // 3) 폴백: Show Global 사다리 — 단, 이전 정지에서 전부 실패했던 전역('none')은
                //    폴백을 생략해 정지당 왕복을 1회로 제한(값이 생기면 -eval이 다시 잡는다).
                if (!pushed && memo !== 'none') {
                    let found = false;
                    for (const name of g.lookupNames) {
                        const value = await this._readGlobalValueSingle(name);
                        if (value) {
                            variables.push(this._markGlobalWritability(
                                { name: g.displayName, value, variablesReference: 0 }, g,
                            ));
                            this._globalQueryMemo.set(memoKey, { method: 'global', name });
                            found = true;
                            break;
                        }
                    }
                    if (!found) { this._globalQueryMemo.set(memoKey, 'none'); }
                }
            }

            variables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' }));
        } else if (scopeInfo.type === 'members') {
            // 객체 조회 응답에 동봉돼 있던 멤버 줄들 — 추가 명령 없이 즉시 표시
            for (const m of scopeInfo.entries) {
                const bare = this._memberBareName(m.name, scopeInfo.parentExpression);
                variables.push(this._makeVariable(
                    bare,
                    m,
                    scopeInfo.threadName,
                    scopeInfo.frameIndex,
                    `${scopeInfo.parentExpression}.${bare}`,
                ));
            }
            // 클래스 Property를 가상 자식으로 — 덤프의 백킹 필드 값을 재사용하므로 왕복 없음(GitHub #26)
            variables.push(...this._propertyChildren(
                scopeInfo.classType, scopeInfo.entries, scopeInfo.parentExpression,
                scopeInfo.threadName, scopeInfo.frameIndex,
            ));
        } else if (scopeInfo.type === 'expand') {
            if (classifyVarEntry({ name: '', type: scopeInfo.varType, value: '' }) === 'array') {
                variables.push(...await this._expandArrayElements(scopeInfo));
            } else {
                // 중첩 객체(`Loc.Pos` 등)는 지연 재조회.
                // ※ 실기기(GPL 4.2K5, 2026-07-22): 점 표기 멤버 식은 -eval이 거부(-729/-780)
                //   하므로 이 재조회는 이 펌웨어에서 대부분 실패한다 — 실패 시 원인을 표시한다.
                const structured = await this._queryVariableStructuredSmart(
                    scopeInfo.threadName, scopeInfo.frameIndex, scopeInfo.expression,
                );
                if (structured) {
                    for (const m of structured.members) {
                        const bare = this._memberBareName(m.name, scopeInfo.expression);
                        variables.push(this._makeVariable(
                            bare,
                            m,
                            scopeInfo.threadName,
                            scopeInfo.frameIndex,
                            `${structured.resolvedExpression}.${bare}`,
                        ));
                    }
                    variables.push(...this._propertyChildren(
                        structured.entry.type, structured.members, structured.resolvedExpression,
                        scopeInfo.threadName, scopeInfo.frameIndex,
                    ));
                    if (structured.members.length === 0) {
                        const value = structured.entry.value && structured.entry.value !== GPLDebugSession.UNDEFINED_VALUE
                            ? structured.entry.value
                            : 'ℹ 이 제어기는 중첩 객체 멤버의 개별 조회를 지원하지 않습니다'
                              + ' (상위 객체 덤프에 표시된 값까지만 제공)';
                        variables.push({ name: '(값)', value, variablesReference: 0 });
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
            ? this._globalWriteCandidates(targetName)
            : [targetName];
        const proj = this._projectName;
        let failure: { code: number; message: string } | undefined;

        for (const name of candidates) {
            const setExpr = `${name} = ${args.value}`;
            const cmd = proj
                ? `Execute ${setExpr}, ${proj}`
                : `Execute ${setExpr}`;
            const resp = await this._sendCmd(cmd);
            this._clearEvaluateCache();

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
                format: this._formatSetVariableError(failure, scopeInfo.type, targetName),
            });
            return;
        }

        response.body = { value: args.value };
        this.sendResponse(response);
    }

    /**
     * 전역 행에 "쓰기 가능한가"를 표시한다.
     * `Private` 모듈 전역은 표기와 무관하게 쓸 수 없다(실기기 확인 2026-08-31) — 값 편집은
     * `Execute`로 하는데 그것은 별도 쓰레드 `_Cmd_<project>`의 전역 스코프에서 실행되어
     * 모듈 밖에서는 이름이 보이지 않기 때문이다. 반면 읽기는 정지한 프레임 컨텍스트라 된다.
     * 그래서 읽기는 종전대로 보여 주고(디버깅에 필요한 상태는 대개 Private `m_*`에 있다),
     * 성공할 수 없는 편집 제스처만 DAP `readOnly` 힌트로 막는다.
     */
    private _markGlobalWritability(
        variable: DebugProtocol.Variable,
        descriptor: GlobalVariableDescriptor,
    ): DebugProtocol.Variable {
        if (!descriptor.isPrivate) { return variable; }
        variable.presentationHint = {
            ...variable.presentationHint,
            visibility: 'private',
            attributes: [...(variable.presentationHint?.attributes ?? []), 'readOnly'],
        };
        return variable;
    }

    /**
     * 전역 값 쓰기에 시도할 이름 표기 순서.
     * 조회는 `Mod.Name` → `Name` 사다리를 타고 성공한 표기를 _globalQueryMemo에 남기므로,
     * 쓰기도 같은 표기를 먼저 쓴다(그 다음 남은 표기를 -729 시 재시도).
     */
    private _globalWriteCandidates(displayName: string): string[] {
        const names: string[] = [];
        const add = (n: string | undefined) => {
            if (n && !names.some(x => x.toLowerCase() === n.toLowerCase())) { names.push(n); }
        };
        const memo = this._globalQueryMemo.get(displayName.toLowerCase());
        if (memo && memo !== 'none' && memo.method === 'global') { add(memo.name); }
        add(displayName);
        const dot = displayName.lastIndexOf('.');
        if (dot > 0) { add(displayName.slice(dot + 1)); }
        return names;
    }

    /**
     * 변수 쓰기 실패 STATUS를 사용자 안내 문구로 바꾼다.
     * 실기기 확인(2026-08-31, GPL 4.2K5 시뮬레이터): `Private` 모듈 전역은 표기(`Mod.Name`·`Name`)와
     * 무관하게 -729다. 값 읽기는 정지한 쓰레드의 프레임 컨텍스트(모듈 안)에서 하지만,
     * 쓰기에 쓰는 `Execute`는 별도 쓰레드 `_Cmd_<project>`의 전역 스코프에서 실행돼
     * 모듈 밖에서는 이름이 보이지 않기 때문이다 — 즉 이 조합은 원리상 읽기만 된다.
     */
    private _formatSetVariableError(
        status: { code: number; message: string },
        scopeType: string,
        targetName: string,
    ): string {
        const base = `변수 설정 실패 (STATUS ${status.code}${status.message ? `: ${status.message}` : ''})`;
        if (status.code !== UNDEFINED_SYMBOL_STATUS) { return base; }
        if (scopeType === 'globals'
            && this._getGlobalVariableDescriptors().some(
                g => g.displayName.toLowerCase() === targetName.toLowerCase() && g.isPrivate,
            )) {
            return `${base} — \`${targetName}\`은 Private 모듈 전역이라 값을 쓸 수 없습니다.`
                + ' 쓰기에 쓰는 Execute는 별도 쓰레드(_Cmd_<프로젝트>)의 전역 스코프에서 실행돼'
                + ' 모듈 밖에서는 이 이름이 보이지 않습니다(읽기는 정지한 프레임 컨텍스트라 가능).'
                + ' 값을 바꾸려면 선언을 Public으로 바꾸거나, 같은 모듈의 Public Sub/Property를 통해 설정하세요';
        }
        return `${base} — 이 실행 컨텍스트에서 \`${targetName}\` 이름을 찾지 못했습니다`
            + ' (Execute는 별도 쓰레드의 전역 스코프에서 실행되므로 프레임 로컬·Private 모듈 변수는 보이지 않습니다)';
    }

    // ═══════════════════════════════════════════════════════
    // Continue / Step / Pause
    // ═══════════════════════════════════════════════════════

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        args: DebugProtocol.ContinueArguments,
    ): Promise<void> {
        // 스레드 단일 실행 잠금: 포커스가 다른 스레드로 옮겨갔어도 잠근 스레드에만 보낸다.
        args.threadId = this._resolveExecutionTarget('Continue', args.threadId, args.singleThread);
        const threadName = this._threadIdToName.get(args.threadId);
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
        args.threadId = this._resolveExecutionTarget('Step over', args.threadId, args.singleThread);
        const threadName = this._threadIdToName.get(args.threadId);
        // GitHub #28 게이트 — continueRequest 의 설명 참조
        const gate = threadName ? this._gateStepRequest('Step', args.threadId) : null;
        if (gate) {
            this.sendResponse(response);
            this._afterGatedStepRequest(args.threadId);
            return;
        }
        if (threadName) {
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
            this._fastPoll();
        }
        this.sendResponse(response);
    }

    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments,
    ): Promise<void> {
        args.threadId = this._resolveExecutionTarget('Step into', args.threadId, args.singleThread);
        const threadName = this._threadIdToName.get(args.threadId);
        // GitHub #28 게이트 — F12(step into) 홀드가 사고의 실제 경로였다. continueRequest 의 설명 참조
        const gate = threadName ? this._gateStepRequest('Step', args.threadId) : null;
        if (gate) {
            this.sendResponse(response);
            this._afterGatedStepRequest(args.threadId);
            return;
        }
        if (threadName) {
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
            this._fastPoll();
        }
        this.sendResponse(response);
    }

    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments,
    ): Promise<void> {
        args.threadId = this._resolveExecutionTarget('Step out', args.threadId, args.singleThread);
        const threadName = this._threadIdToName.get(args.threadId);
        // GitHub #28 게이트 — continueRequest 의 설명 참조
        const gate = threadName ? this._gateStepRequest('Step', args.threadId) : null;
        if (gate) {
            this.sendResponse(response);
            this._afterGatedStepRequest(args.threadId);
            return;
        }
        if (threadName) {
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
            const name = this._threadIdToName.get(threadId);
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
     * 해제하고 요청을 그대로 통과시킨다. 추가 스레드를 재개하는 일은 없다(하드 규칙 6).
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
            threadNameToId: this._threadNameToId,
        });

        if (decision.staleLock) {
            this._log(`스레드 잠금 해제: 잠근 스레드 ${decision.lockedName} 가 목록에 없습니다(종료됨).`);
            this._setLockedThread(undefined);
            return decision.targetThreadId;
        }

        if (decision.redirected) {
            this._lockRedirectCount++;
            if (this._lockRedirectCount === 1) {
                const from = this._threadIdToName.get(requestedThreadId) ?? `#${requestedThreadId}`;
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
            && shouldPreserveFocus(this._lockedThreadName, this._threadIdToName.get(threadId))) {
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

    /** `gpl.debug.integerHex`(기본 false): 정수 값에 16진수 표기를 병기. */
    private _integerHexEnabled(): boolean {
        return vscode.workspace.getConfiguration('gpl').get<boolean>('debug.integerHex', false) === true;
    }

    /**
     * 디버거가 보내는 `Start` 명령을 문서 구문(startCommand.ts)으로 조립한다.
     * `-event`(GDE 기본), `-stack`, `-init`, `-trace` 는 설정·launch 구성에서 온다.
     * `-compile` 은 붙이지 않는다(Start 가 자체 컴파일 — 하드 규칙 7).
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

    /** basename → 소스 줄 배열(읽기 실패 시 undefined). 파일 시스템 접근만 — 제어기 명령 없음. */
    private _readSourceLines(baseName: string): string[] | undefined {
        try {
            const filePath = this._resolveSourcePath(baseName);
            return fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
        } catch {
            return undefined;
        }
    }

    /** basename 의 프로시저 범위(파서 + `End Sub` 기준). 소스를 못 읽으면 빈 배열. */
    private _procedureRangesFor(baseName: string, lines?: string[]): ProcedureRange[] {
        const src = lines ?? this._readSourceLines(baseName);
        if (!src) { return []; }
        let filePath: string;
        try { filePath = this._resolveSourcePath(baseName); } catch { return []; }
        const symbols = GPLParser.parseDocument(src.join('\n'), filePath, {
            includeLocals: false,
            includeParameters: false,
        });
        const procs = symbols
            .filter(s => s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub)
            .map(s => ({ name: s.className ? `${s.className}.${s.name}` : s.name, line: s.line + 1 }));
        return buildProcedureRanges(procs, src.length, src);
    }

    /**
     * 제어기가 실제로 BP를 걸 줄로 보정한다(문서 규칙: 빈 줄·주석이면 다음 실행 문장).
     * 소스를 못 읽으면 요청 줄을 그대로 쓴다(보정은 어디까지나 힌트).
     */
    private _adjustBreakpointLine(baseName: string, line: number): { line: number; moved: boolean } {
        const src = this._readSourceLines(baseName);
        if (!src) { return { line, moved: false }; }
        const resolved = resolveBreakpointLine(src, line);
        if (resolved === undefined || resolved === line) { return { line, moved: false }; }
        return { line: resolved, moved: true };
    }

    /**
     * 프로시저 이름(`Class.Proc` / `Module.Proc` / `Proc`)으로 정의 위치를 찾는다.
     * 워크스페이스 소스맵을 훑어 Sub/Function 심볼과 이름을 맞춘다(제어기 명령 없음).
     */
    private _findProcedureDefinitions(name: string): { file: string; line: number; label: string }[] {
        const wanted = name.trim().toLowerCase();
        if (!wanted) { return []; }
        const wantedTail = wanted.includes('.') ? wanted.split('.').pop()! : wanted;
        const out: { file: string; line: number; label: string }[] = [];

        for (const [key, candidates] of this._sourceFileMap) {
            const filePath = this._pickSourcePath(key, candidates);
            if (this._projectDirs.length > 0
                && !this._projectDirs.some(d => this._isPathUnder(filePath, d))) { continue; }
            let content: string;
            try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
            const symbols = GPLParser.parseDocument(content, filePath, {
                includeLocals: false,
                includeParameters: false,
            });
            const lines = content.split(/\r?\n/);
            const procs = symbols
                .filter(s => s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub);
            const ranges = buildProcedureRanges(
                procs.map(s => ({ name: s.name, line: s.line + 1 })),
                lines.length,
                lines,
            );
            for (const s of procs) {
                const qualified = [
                    s.className ? `${s.className}.${s.name}` : undefined,
                    s.module ? `${s.module}.${s.name}` : undefined,
                    s.name,
                ].filter(Boolean).map(v => v!.toLowerCase());
                const matches = qualified.includes(wanted)
                    || (!wanted.includes('.') && s.name.toLowerCase() === wantedTail);
                if (!matches) { continue; }
                const header = s.line + 1;
                const range = ranges.find(r => r.start === header);
                // 헤더 다음 줄부터 첫 실행 문장을 찾는다(헤더 자체는 실행 명령이 아니다).
                const bpLine = resolveBreakpointLine(lines, header + 1, range);
                if (bpLine === undefined) { continue; }
                out.push({
                    file: path.basename(filePath),
                    line: bpLine,
                    label: s.className ? `${s.className}.${s.name}` : s.name,
                });
            }
        }
        return out;
    }

    /**
     * BP 유효 줄 힌트 — VS Code 가 이 구간에서 BP를 걸 수 있는 줄을 물어본다.
     * 제어기 명령을 보내지 않고 로컬 파서로만 답한다.
     */
    protected breakpointLocationsRequest(
        response: DebugProtocol.BreakpointLocationsResponse,
        args: DebugProtocol.BreakpointLocationsArguments,
    ): void {
        const baseName = path.basename(args.source.path || '');
        const src = baseName ? this._readSourceLines(baseName) : undefined;
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
        const ranges = this._procedureRangesFor(baseName, src);
        const lines = breakpointCandidateLines(src, ranges, args.line, args.endLine ?? args.line);
        response.body = { breakpoints: lines.map(l => ({ line: l })) };
        this.sendResponse(response);
    }

    /**
     * 프로시저 이름 브레이크포인트. 이름 → (파일, 첫 실행 줄) 로 바꿔 `Set Break` 를 보낸다.
     * 소스 BP 와 같은 파일에 있을 수 있으므로 목록을 따로 들고 있고,
     * `setBreakPointsRequest` 의 파일 단위 정리에서 이 줄들은 건드리지 않는다.
     */
    protected async setFunctionBreakPointsRequest(
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

        // 이전 함수 BP 해제 — 같은 줄에 소스 BP 가 있으면 남겨 둔다.
        for (const prev of this._functionBps) {
            const sourceLines = this._breakpoints.get(prev.file);
            if (sourceLines?.has(prev.line)) { continue; }
            await this._sendBpCommandWithFallback('Nobreak', proj, prev.file, prev.line);
        }
        this._functionBps = [];

        const result: DebugProtocol.Breakpoint[] = [];
        for (const req of requested) {
            const defs = this._findProcedureDefinitions(req.name);
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
            const resp = this._bpRejectedFiles.has(defKey)
                ? await this._sendCmd(this._bpCommand('Break', proj, def.file, def.line))
                : await this._sendBpCommandWithFallback('Break', proj, def.file, def.line);
            const verified = resp !== null && (isSuccess(resp) || /Duplicate breakpoint/i.test(resp));
            const bp: DebugProtocol.Breakpoint = {
                verified,
                id: ++this._bpIdCounter,
                line: def.line,
                source: { name: def.file, path: this._safeResolveSourcePath(def.file) },
            };
            if (!verified) {
                const msg = resp ? resp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0] : '응답 없음';
                const hint = resp !== null && parseStatus(resp).code === -508
                    ? this._librarySourceBpHint(def.file)
                    : undefined;
                if (hint) { this._bpRejectedFiles.add(defKey); }
                bp.message = hint ? `${msg} — ${hint}` : msg;
            } else {
                this._functionBps.push({ name: req.name, file: def.file, line: def.line, id: bp.id! });
                this._log(`함수 BP: ${def.label} → ${def.file}:${def.line}`);
            }
            result.push(bp);
        }

        response.body = { breakpoints: result };
        this.sendResponse(response);
        this._warnIfBreakpointLimitExceeded();
    }

    /** 소스 경로 해석 실패를 예외 없이 흘려보낸다(BP 응답의 source 표기용). */
    private _safeResolveSourcePath(baseName: string): string | undefined {
        try { return this._resolveSourcePath(baseName); } catch { return undefined; }
    }

    /**
     * `gpl.debug.integerHex` 가 켜져 있으면 정수 값에 16진수 표기를 병기한다
     * (`&H` 는 GPL 의 16진수 리터럴 표기 — DataID 마스크·비트 플래그를 읽을 때 유용).
     * 값이 정수가 아니면 그대로 돌려준다. VS Code 는 DAP `supportsValueFormattingOptions` 를
     * 소비하지 않으므로(1.135 번들 확인) 표준 hex 토글 대신 이 설정으로 제공한다.
     */
    private _withHexHint(value: string): string {
        if (!this._integerHexEnabled()) { return value; }
        const text = value.trim();
        if (!/^-?\d+$/.test(text)) { return value; }
        const n = Number(text);
        if (!Number.isSafeInteger(n) || (n > -16 && n < 16)) { return value; }
        const hex = n < 0
            ? `-&H${Math.abs(n).toString(16).toUpperCase()}`
            : `&H${n.toString(16).toUpperCase()}`;
        return `${value} (${hex})`;
    }

    /** 문서 제약: 동시 BP는 최대 32개. 넘으면 제어기가 거부할 수 있으므로 알린다. */
    private _warnIfBreakpointLimitExceeded(): void {
        let total = this._functionBps.length;
        for (const lines of this._breakpoints.values()) { total += lines.size; }
        if (total > 32) {
            this._log(`⚠ 브레이크포인트 ${total}개 — 공식 문서상 동시 상한은 32개입니다. 초과분은 제어기가 거부할 수 있습니다.`);
        }
    }

    /**
     * Jump to Cursor 후보 — 문서(`Set Thread -line`)상 새 줄은 **현재 줄과 같은 프로시저 안**이어야 하고
     * 실행 가능한 문장이어야 한다. 두 조건을 로컬에서 확인해 통과할 때만 후보를 돌려준다.
     */
    protected gotoTargetsRequest(
        response: DebugProtocol.GotoTargetsResponse,
        args: DebugProtocol.GotoTargetsArguments,
    ): void {
        response.body = { targets: [] };
        if (this._jumpToCursorMode() === 'off') {
            this.sendResponse(response);
            return;
        }

        const baseName = path.basename(args.source.path || '');
        const src = baseName ? this._readSourceLines(baseName) : undefined;
        const threadName = this._lockedThreadName ?? this._findBreakThread();
        const frames = threadName ? this._cachedFrames.get(threadName) : undefined;
        const current = frames?.[0];

        if (!src || !current) {
            this.sendResponse(response);
            return;
        }
        if (current.file && current.file.toLowerCase() !== baseName.toLowerCase()) {
            // 다른 파일 — 문서상 같은 프로시저여야 하므로 대상이 될 수 없다.
            this.sendResponse(response);
            return;
        }

        const ranges = this._procedureRangesFor(baseName, src);
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
     * (모션 영향 가능 — §0 하드 규칙 6). 그래서 기본값(`gpl.debug.jumpToCursor: "warn"`)에서는
     * 실행 전에 모달로 확인을 받는다. 기능 자체를 막지는 않는다(사용자 결정 2026-08-28).
     */
    protected async gotoRequest(
        response: DebugProtocol.GotoResponse,
        args: DebugProtocol.GotoArguments,
    ): Promise<void> {
        const mode = this._jumpToCursorMode();
        const target = this._gotoTargetHandles.get(args.targetId);
        const threadName = this._threadIdToName.get(args.threadId);

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
        this._prefetchFramesAfterStop(threadName);
        if (this._configurationDone) {
            this.sendEvent(this._stoppedEvent('goto', args.threadId, { forceFocus: true }));
        }
    }

    /**
     * Step Into Target 후보 — 현재 줄의 호출 중 정의를 찾을 수 있는 것만 돌려준다.
     * 첫 항목은 항상 "기본 Step Into"(제어기 `Step -noerror`)로 둬서 종전 동작을 유지한다.
     */
    protected stepInTargetsRequest(
        response: DebugProtocol.StepInTargetsResponse,
        args: DebugProtocol.StepInTargetsArguments,
    ): void {
        response.body = { targets: [] };
        const info = this._frameIdToInfo.get(args.frameId);
        const frames = info ? this._cachedFrames.get(info.threadName) : undefined;
        const frame = frames?.[info?.frameIndex ?? 0];
        if (!frame?.file || frame.fileLine <= 0) {
            this.sendResponse(response);
            return;
        }
        const src = this._readSourceLines(frame.file);
        const lineText = src?.[frame.fileLine - 1];
        if (!lineText) {
            this.sendResponse(response);
            return;
        }

        const targets: DebugProtocol.StepInTarget[] = [];
        // id 0 = 기본 Step Into(대상 지정 없음)
        targets.push({ id: 0, label: '기본 Step Into (제어기가 정한 대상)' });

        for (const call of parseCallTargets(lineText)) {
            const defs = this._findProcedureDefinitions(call.receiver ? call.name : call.label);
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

        const setResp = await this._sendCmd(this._bpCommand('Break', proj, target.file, target.line));
        const ok = setResp !== null && (isSuccess(setResp) || /Duplicate breakpoint/i.test(setResp));
        if (!ok) {
            this._log(`⚠ Step Into Target: 임시 BP 설정 실패(${target.file}:${target.line}) — 기본 Step 으로 진행`);
            return false;
        }
        const existing = this._tempBreakpoints.get(target.file.toLowerCase()) ?? new Set<number>();
        existing.add(target.line);
        this._tempBreakpoints.set(target.file.toLowerCase(), existing);

        const contResp = await this._sendCmd(`Continue ${threadName}`);
        if (contResp === null || !isSuccess(contResp)) {
            const msg = contResp ? contResp.replace(/<[^>]+>/g, '').trim().split(/\r?\n/)[0] : '응답 없음';
            this._log(`⚠ Step Into Target: Continue 실패(${msg}) — 임시 BP 를 정리합니다`);
            await this._clearTempBreakpoints();
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
        await this._clearTempBreakpoints();

        if (!this._clientSideBpLogicEnabled()) { return true; }

        const frames = await this._getThreadFrames(threadName);
        const top = frames[0];
        if (!top?.file || top.fileLine <= 0) { return true; }
        const meta = this._bpMeta.get(top.file.toLowerCase())?.get(top.fileLine);
        if (!meta) { return true; }

        meta.hits++;

        // 로그포인트: 메시지의 `{식}` 을 평가해 Debug Console 에 출력한다.
        if (meta.logMessage !== undefined) {
            const text = await this._interpolateLogMessage(meta.logMessage, threadName);
            this._log(`[logpoint] ${top.file}:${top.fileLine} ${text}`);
        }

        let shouldStop = true;
        if (meta.condition) {
            const verdict = await this._evaluateBooleanCondition(meta.condition, threadName);
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
        this._fastPoll();
        return false;
    }

    /** 로그포인트 메시지의 `{식}` 을 정지 프레임에서 평가해 치환한다. 평가 실패는 `<?>`로 남긴다. */
    private async _interpolateLogMessage(message: string, threadName: string): Promise<string> {
        const parts = message.split(/(\{[^}]*\})/);
        let out = '';
        for (const part of parts) {
            const m = part.match(/^\{([^}]*)\}$/);
            if (!m) { out += part; continue; }
            const expr = m[1].trim();
            if (!expr) { out += part; continue; }
            const value = await this._queryVariableStructuredSmart(threadName, 0, expr);
            out += value?.entry?.value ?? '<?>';
        }
        return out;
    }

    /** 조건식을 정지 프레임에서 평가해 참/거짓으로 해석한다. 판정 불가는 undefined. */
    private async _evaluateBooleanCondition(condition: string, threadName: string): Promise<boolean | undefined> {
        const res = await this._queryVariableStructuredSmart(threadName, 0, condition);
        const raw = (res?.entry?.value ?? '').trim();
        if (!raw) { return undefined; }
        if (/^(true|-1)$/i.test(raw)) { return true; }
        if (/^(false|0)$/i.test(raw)) { return false; }
        const num = Number(raw);
        if (!Number.isNaN(num)) { return num !== 0; }
        return undefined;
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

    /** Step Into Target 이 심어 둔 임시 BP 를 모두 해제한다(같은 줄에 사용자 BP 가 있으면 남긴다). */
    private async _clearTempBreakpoints(): Promise<void> {
        const proj = this._projectName;
        if (!proj || this._tempBreakpoints.size === 0) { return; }
        for (const [fileKey, lines] of this._tempBreakpoints) {
            for (const line of lines) {
                const userLines = this._breakpoints.get(fileKey) ?? this._breakpoints.get(fileKey.toLowerCase());
                const isFunctionBp = this._functionBps.some(
                    f => f.file.toLowerCase() === fileKey && f.line === line,
                );
                if (userLines?.has(line) || isFunctionBp) { continue; }
                await this._sendBpCommandWithFallback('Nobreak', proj, fileKey, line);
            }
        }
        this._tempBreakpoints.clear();
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
    protected customRequest(
        command: string,
        response: DebugProtocol.Response,
        args: any,
        request?: DebugProtocol.Request,
    ): void {
        if (command === 'gplFocusThread') {
            const name: string | undefined = typeof args?.name === 'string' ? args.name : undefined;
            const id = name ? this._threadNameToId.get(name) : undefined;
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
            const name = byName ?? (byId !== undefined ? this._threadIdToName.get(byId) : undefined);
            if (!name || !this._threadNameToId.has(name)) {
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
            const threads = [...this._threadNameToId.entries()].map(([name, id]) => ({
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
            const name = threadId !== undefined ? this._threadIdToName.get(threadId) : undefined;
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

    protected async terminateThreadsRequest(
        response: DebugProtocol.TerminateThreadsResponse,
        args: DebugProtocol.TerminateThreadsArguments,
    ): Promise<void> {
        const failures: string[] = [];
        this._userActionInFlight = true;
        try {
            for (const threadId of args.threadIds ?? []) {
                const name = this._threadIdToName.get(threadId);
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
        this._fastPoll();
        if (failures.length) {
            this.sendErrorResponse(response, 1102, `쓰레드 Stop 실패 — ${failures.join(', ')}`);
        } else {
            this.sendResponse(response);
        }
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
        let evalRef = 0; // 배열/객체 결과의 variablesReference (0 = 확장 불가)
        // 값 색상화용 DAP 표준 타입 — 없으면 VS Code가 흐린 일반색으로 칠한다(dapColorizeType 주석).
        let evalType: string | undefined;

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
            let evalError: { code: number; message: string } | undefined;

            if (!forceRaw && threadName) {
                const structured = await this._queryVariableStructuredSmart(
                    threadName, frameIndex, expression,
                );
                if (structured) {
                    evalError = structured.error;
                    const kind = classifyVarEntry(structured.entry, structured.members.length > 0);
                    if (kind === 'object' && structured.members.length > 0) {
                        // 객체는 응답의 멤버 줄 전체를 보여준다 (기존: 첫 줄만 파싱해 "Object"만 표시).
                        // Location은 한 줄 요약을 헤더에 덧붙이고, 2열 멤버(타입 없음)는 빈 칸 없이 잇는다(GitHub #27).
                        const locSummary = isLocationType(structured.entry.type) ? summarizeLocation(structured.members) : undefined;
                        result = [
                            `${structured.entry.name || expression}, ${structured.entry.type || 'Object'}${locSummary ? `  ${locSummary}` : ''}`,
                            ...structured.members.map(m => `  ${[m.name, m.type, m.value].filter(Boolean).join(', ')}`),
                        ].join('\n');
                    } else if (kind === 'array') {
                        result = `${structured.entry.type} 배열 — 요소는 ${expression}(i) 형식으로 조회`;
                    } else if (structured.entry.value && structured.entry.value !== GPLDebugSession.UNDEFINED_VALUE) {
                        result = structured.entry.type
                            ? `${structured.entry.value}  (${structured.entry.type})`
                            : structured.entry.value;
                        evalType = dapColorizeType(structured.entry.type, structured.entry.value);
                    } else if (/\bnull\s*$/i.test(structured.entry.type)) {
                        // null 객체 참조 요소 (`armList(1), Object() null`)
                        result = `null  (${structured.entry.type})`;
                    }
                    if (result && structured.via) { result += `\n  ← ${structured.via}`; }
                }
                if (!result && this._projectName) {
                    const gResp = await this._sendCmd(
                        `Show Global ${expression}, ${this._projectName}`,
                    );
                    if (gResp) {
                        const lines = this._showGlobalResponseLines(gResp);
                        if (lines.length > 0) { result = lines.join('\n'); }
                    }
                }
            }

            // 변수 평가가 불가하거나 멈춘 쓰레드가 없으면 → 임의 제어기 명령으로 전송
            if (!result && rawCommand) {
                const readOnly = isReadOnlyConsoleCommand(rawCommand);
                if (!forceRaw && !readOnly) {
                    // 비접두사 입력의 폴백 전송은 읽기 전용 명령만 허용 — 오타/변수명이
                    // 상태 변경 명령으로 흘러가는 사고를 막는다. 의도적 전송은 '>' 접두사로.
                    result = evalError
                        ? `${this._formatEvalError(expression, evalError)}\n제어기 명령으로 보내려면 '>' 접두사를 사용하세요.`
                        : `변수 평가 실패. 제어기 명령으로 보내려면 '>' 접두사를 사용하세요.`;
                } else {
                    let approved = true;
                    if (!readOnly && vscode.workspace.getConfiguration('gpl')
                        .get<boolean>('debug.confirmDestructiveRepl', true)) {
                        // 상태 변경(또는 미분류) 명령은 기본값으로 모달 확인을 거친다.
                        const pick = await vscode.window.showWarningMessage(
                            `제어기 상태를 바꾸는 명령입니다: ${rawCommand}`,
                            { modal: true },
                            '전송',
                        );
                        approved = pick === '전송';
                    }
                    if (!approved) {
                        result = '(취소됨)';
                    } else {
                        const raw = await this._sendCmd(rawCommand);
                        if (raw === null) {
                            result = '(제어기 미연결 — 디버그 세션/연결 상태를 확인하세요)';
                        } else {
                            const cleaned = raw.replace(/<[^>]+>/g, '').trim();
                            result = cleaned.length > 0 ? cleaned : '(ok)';
                        }
                        // 임의 명령은 제어기 상태를 바꿀 수 있으므로 hover/watch 캐시와
                        // 프레임 캐시 신선도를 함께 무효화한다 (예: >Step 뒤 옛 스택 방지).
                        this._clearEvaluateCache();
                        this._frameCacheAt.clear();
                        this._frameCacheGen++;
                    }
                }
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
                result = cached.value;
                evalRef = cached.ref;
                evalType = cached.type;
            } else {
                // Show Variable -eval thread frame variable → 배열/객체는 트리로 확장 가능
                // (변수 인덱스 식 `armList(i)`는 식별자 치환 재시도로 지원)
                const structured = threadName
                    ? await this._queryVariableStructuredSmart(threadName, frameIndex, expression)
                    : null;
                if (structured) {
                    const kind = classifyVarEntry(structured.entry, structured.members.length > 0);
                    if (kind !== 'simple') {
                        const v = this._makeVariable(
                            expression,
                            structured.entry,
                            threadName!,
                            frameIndex,
                            structured.resolvedExpression,
                            structured.members,
                        );
                        result = v.value;
                        evalRef = v.variablesReference;
                    } else if (structured.entry.value && structured.entry.value !== GPLDebugSession.UNDEFINED_VALUE) {
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
                    );
                    if (gResp) {
                        const lines = this._showGlobalResponseLines(gResp);
                        result = lines.length > 0 ? lines.join('\n') : '';
                    }
                }
                // 모든 조회가 실패했을 때만 STATUS 에러 원인을 표시한다 — -729(미정의 심볼)는
                // 다른 모듈 전역일 수도 있어 Show Global 폴백을 먼저 거쳐야 한다.
                if (!result && structured?.error) {
                    result = this._formatEvalError(expression, structured.error);
                }
                this._setCachedEvaluate(cacheKey, result || `(${expression} 평가 불가)`, evalRef, evalType);
            }
        } else if (args.context === 'clipboard') {
            // '값 복사' — 표시용 타입 접미·hex 힌트·백킹 필드 주석 없이 **원문 값만** 준다.
            // (supportsClipboardContext 를 선언하면 VS Code 가 이 컨텍스트로 다시 물어본다.)
            const structured = threadName
                ? await this._queryVariableStructuredSmart(threadName, frameIndex, expression)
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
                const gResp = await this._sendCmd(`Show Global ${expression}, ${this._projectName}`);
                if (gResp) { result = this._showGlobalResponseLines(gResp).join('\n'); }
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
        // 실행 잠금이 걸린 스레드는 자물쇠를 앞에 붙인다 — Continue/Step 이 포커스와 무관하게
        // 이 스레드로 간다는 표시(라벨은 표시 전용이며 스레드 식별은 name↔id 맵으로만 한다).
        const lock = this._lockedThreadName === name ? '🔒 ' : '';
        if (attention) {
            return `${lock}● ${name}  [${icon} ${state.toUpperCase()}]`;
        }
        return `${lock}${name}  [${icon} ${state}]`;
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
        this._frameCacheGen++; // ⑧ 진행 중이던 프레임 조회의 캐시 기록도 무효화
        this._clearEvaluateCache();
        // 사용자 액션(step/continue/pause)이 나갔으면 자발적 Paused 추적은 의미가 없다 —
        // 이후 정지는 pending 경로가 판정한다. 남겨 두면 announced 플래그가 재히트를 가린다.
        this._spontaneousPause.clear();
    }

    private _getCachedEvaluate(key: string): { value: string; ref: number; type?: string } | undefined {
        const entry = this._evaluateCache.get(key);
        if (!entry) { return undefined; }
        if (Date.now() - entry.timestamp > GPLDebugSession.EVALUATE_CACHE_TTL_MS) {
            this._evaluateCache.delete(key);
            return undefined;
        }
        return { value: entry.value, ref: entry.ref, type: entry.type };
    }

    private _setCachedEvaluate(key: string, value: string, ref = 0, type?: string): void {
        this._evaluateCache.set(key, { value, ref, type, timestamp: Date.now() });
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
     * 브레이크포인트 명령 문자열 생성 — 모든 전송 지점이 이 헬퍼를 사용한다.
     * GDE 패킷 캡처 실측(runbook) 형식: `Set Break <proj> "<file>"<line>` —
     * 닫는 따옴표와 줄번호 사이에 공백이 없다.
     */
    private _bpCommand(kind: 'Break' | 'Nobreak', project: string, file: string, line: number): string {
        return `Set ${kind} ${project} "${file}"${line}`;
    }

    /**
     * 공식 문서 표기(따옴표와 줄번호 사이 **공백 있음**): `Set Break My_project "Testfile.gpl" 30`.
     * 실기기(GDE 캡처)는 공백 없는 형식이 동작하는 것이 확인됐지만 `Set Nobreak` 는 캡처 근거가 없어,
     * 무공백 형식이 실패하면 문서 표기로 한 번 더 시도한다(`_sendBpCommandWithFallback`).
     */
    private _bpCommandSpaced(kind: 'Break' | 'Nobreak', project: string, file: string, line: number): string {
        return `Set ${kind} ${project} "${file}" ${line}`;
    }

    /**
     * BP 명령에서 파일을 지칭할 후보 표기 — ① 파일명(basename) → ② 프로젝트 기준 상대 경로.
     *
     * 프로젝트가 하위 폴더로 나뉘면(`ProjectSource="T1\T2\T2.gpl"`, 2026-08-28 실제 파일 확인)
     * 제어기가 소스를 파일명으로 아는지 상대 경로로 아는지는 실기기 확인 사항이다(공식 문서 예시는
     * `Set Break My_project "Testfile.gpl" 30` — 평면 프로젝트만 보여 준다). 평면 프로젝트에서는
     * 두 표기가 같으므로 후보가 하나뿐이고, 보내는 명령도 종전과 완전히 동일하다.
     */
    private _bpFileForms(file: string): string[] {
        const base = file.replace(/^.*[\\/]/, '');
        if (this._projectDirs.length === 0) { return [base]; }
        const local = this._resolveSourcePath(base);
        const dir = this._projectDirs.find(d => this._isPathUnder(local, d));
        if (!dir) { return [base]; }
        const rel = path.relative(dir, local);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { return [base]; }
        const gprStyle = rel.replace(/\//g, '\\');
        return gprStyle.toLowerCase() === base.toLowerCase() ? [base] : [base, gprStyle];
    }

    /**
     * BP 설정/해제 전송 — 무공백(실측) 형식으로 먼저 보내고, STATUS 실패면 문서 표기(공백)로 재시도한다.
     * 문서상 `Set Nobreak` 는 대상이 없어도 에러가 아니므로, 실패 STATUS 는 형식 거부로 볼 수 있다.
     *
     * 하위 폴더 소스는 파일명 표기가 거부될 수 있어(`_bpFileForms`) 두 표기를 순서대로 시도하고,
     * 성공한 표기를 세션에 기억해 다음부터 먼저 보낸다. 평면 프로젝트는 후보가 하나라 종전과 같다.
     * @returns 성공한 응답 문자열, 모두 실패하면 마지막 응답(또는 null)
     */
    private async _sendBpCommandWithFallback(
        kind: 'Break' | 'Nobreak',
        project: string,
        file: string,
        line: number,
    ): Promise<string | null> {
        const forms = this._bpFileForms(file);
        const ordered = this._bpPreferProjectRelativeFile && forms.length > 1
            ? [...forms].reverse()
            : forms;

        let last: string | null = null;
        for (const form of ordered) {
            const primary = await this._sendCmd(this._bpCommand(kind, project, form, line));
            if (primary !== null && (isSuccess(primary) || /Duplicate breakpoint/i.test(primary))) {
                this._noteBpFileForm(form, file);
                return primary;
            }
            const spacedCmd = this._bpCommandSpaced(kind, project, form, line);
            this._log(`Set ${kind} 무공백 형식 실패 → 문서 표기로 재시도: ${spacedCmd}`);
            const fallback = await this._sendCmd(spacedCmd);
            if (fallback !== null && isSuccess(fallback)) {
                this._log(`✔ 문서 표기(${kind}, 공백 있음)가 동작했습니다 — 이 제어기는 문서 형식을 요구합니다.`);
                this._noteBpFileForm(form, file);
                return fallback;
            }
            last = fallback ?? primary;
            if (ordered.length > 1 && form === ordered[0]) {
                this._log(`Set ${kind}: 파일 표기 "${form}" 거부 → 다른 표기로 재시도합니다.`);
            }
        }
        return last;
    }

    /** 성공한 파일 표기가 상대 경로였으면 이 세션에서는 그 표기를 먼저 쓴다(명령 왕복 절감). */
    /**
     * BP 대상 파일이 `ProjectLibrary` 로 참조된 하위 프로젝트의 소스면, 사용자가 손 쓸 수 있는
     * 안내 문구를 돌려준다(아니면 undefined).
     *
     * 실측(2026-08-31, 시뮬레이터 192.168.0.1): 제어기는 `Set Break <project> "<file>"<line>` 의
     * 파일을 **그 프로젝트가 직접 선언한 `ProjectSource`** 안에서만 찾는다. `ProjectLibrary` 로
     * 접혀 들어온 소스는 코드로는 실행되고 `Show Thread`·`Show Stack` 에도
     * `GPL_Code\Lib_Net/TcpServer.gpl` 처럼 나오지만 BP 대상 파일로는 잡히지 않아, 어떤 표기를
     * 써도 `-508` 이다(basename·프로젝트 상대·제어기 보고 문자열 그대로·절대경로·라이브러리
     * 프로젝트명 조합 등 12종 확인). 같은 시점에 메인 프로젝트 소스는 STATUS 0 으로 성공했다.
     * 배경과 실험 기록은 `docs/ai-handoff.md` §1-CK(-508 규명)·§1-CT(승격 검증·자동화).
     */
    private _librarySourceBpHint(file: string): string | undefined {
        if (this._libraryDirs.length === 0) { return undefined; }
        const base = file.replace(/^.*[\\/]/, '');
        const local = this._resolveSourcePath(base);
        const libDir = this._libraryDirs.find(d => this._isPathUnder(local, d));
        if (!libDir) { return undefined; }

        const libName = path.basename(libDir);
        // 메인 프로젝트 폴더 기준 상대 경로 — Project.gpr 에 그대로 적을 수 있는 형태로 보여 준다.
        const isLibrary = (d: string) => this._libraryDirs.some(l => l.toLowerCase() === d.toLowerCase());
        const mainDir = this._projectDirs.find(d => !isLibrary(d) && this._isPathUnder(local, d));
        const rel = mainDir ? path.relative(mainDir, local).replace(/\//g, '\\') : base;
        return `${base} 은 ProjectLibrary 로 참조된 하위 프로젝트(${libName})의 소스입니다. `
            + '제어기는 BP 대상 파일을 그 프로젝트가 직접 선언한 ProjectSource 안에서만 찾으므로, '
            + '라이브러리 경유 소스에는 그대로는 브레이크포인트를 걸 수 없습니다(-508). '
            + `메인 프로젝트 Project.gpr 에 ProjectSource="${rel}" 로 직접 등재하면 걸립니다`
            + '(2026-09-02 실측 확인). 명령 팔레트의 '
            + '"GPL: 브레이크포인트용 소스 승격"(gpl.project.promoteSourceForBreakpoint)이 '
            + '그 편집을 계산해 미리보기로 보여 줍니다 — 대상 파일을 끌어오는 ProjectLibrary 참조를 빼고 '
            + '그 그룹이 제공하던 나머지 라이브러리를 개별 참조로 되살려, 컴파일 집합을 그대로 유지합니다.';
    }

    private _noteBpFileForm(usedForm: string, requestedFile: string): void {
        const base = requestedFile.replace(/^.*[\\/]/, '');
        const isRelative = usedForm.toLowerCase() !== base.toLowerCase();
        if (isRelative && !this._bpPreferProjectRelativeFile) {
            this._bpPreferProjectRelativeFile = true;
            this._log(
                `✔ 이 제어기는 BP 대상 파일을 프로젝트 기준 상대 경로로 받습니다("${usedForm}") — `
                + '이후 BP 명령은 이 표기를 먼저 씁니다.',
            );
        }
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
        if (cached?.length) { return this._pickSourcePath(lower, cached); }

        // 미스: attach 이후 추가/이동된 파일일 수 있으므로 소스맵을 1회 재인덱싱 후 재시도.
        this._buildSourceFileMap();
        const rebuilt = this._sourceFileMap.get(lower);
        if (rebuilt?.length) { return this._pickSourcePath(lower, rebuilt); }

        // 컴파일 단위로 좁힌 상태였다면 워크스페이스 전체로 한 번 넓혀 본다 —
        // `.gpr`에 아직 등재되지 않은 파일이나 단위 판정이 어긋난 경우까지 놓치지 않게.
        if (!this._sourceMapWidened && this._projectDirs.length > 0) {
            this._sourceMapWidened = true;
            this._buildSourceFileMap();
            const wide = this._sourceFileMap.get(lower);
            if (wide?.length) {
                this._log(
                    `ⓘ "${base}" 는 컴파일 단위(${this._projectName}) 밖에서 찾았습니다 — `
                    + '소스맵을 워크스페이스 전체로 넓혔습니다. 엉뚱한 파일이 열리면 .gpr 등재 상태를 확인하세요.',
                );
                return this._pickSourcePath(lower, wide);
            }
        }

        // 그래도 못 찾으면 원본을 그대로 반환하되, 왜 이동이 안 되는지 진단 로그를 남긴다.
        this._log(
            `소스 경로 해석 실패: "${filename}" (basename: ${base}) — ` +
            `워크스페이스 소스맵(${this._sourceFileMap.size}개)에서 찾지 못했습니다. ` +
            `해당 .gpl/.gpo 파일이 열린 워크스페이스 폴더에 포함되어 있는지 확인하세요.`,
        );
        return filename;
    }

    /** 동명 소스 경합 시 프로젝트 폴더 우선으로 선택하고, 모호하면 베이스네임당 1회 경고를 남긴다. */
    private _pickSourcePath(key: string, candidates: string[]): string {
        const pick = pickSourceCandidate(candidates, this._projectDirs, this._projectSourcePaths)!;
        if (pick.ambiguous.length > 0 && !this._sourceResolveWarned.has(key)) {
            this._sourceResolveWarned.add(key);
            this._log(
                `⚠ 동명 소스 ${candidates.length}개 경합: "${key}" → ${pick.path} 선택 ` +
                `(제외: ${pick.ambiguous.join(' | ')}). 엉뚱한 파일이 열리면 워크스페이스에서 ` +
                `사본/백업 폴더를 정리하거나 launch.json "projectName"을 확인하세요.`,
            );
        }
        return pick.path;
    }

    /**
     * 확정된 _projectName과 이름이 일치하는 Project.gpr 폴더들을 수집한다.
     * 동명 소스 경합(_pickSourcePath)과 Globals 열거 범위 제한의 기준이 된다.
     *
     * 폴더와 함께 `ProjectSource` 목록도 절대 경로로 풀어 둔다 — 하위 폴더로 나뉜 프로젝트
     * (`ProjectSource="T1\T2\T2.gpl"`)에서 제어기가 주는 basename을 어느 파일로 볼지 판정할 때
     * "컴파일 집합에 들어 있는가"가 폴더 깊이보다 정확한 기준이다.
     *
     * `ProjectLibrary`로 참조된 라이브러리 프로젝트의 폴더·소스도 함께 넣는다 — 문서상 라이브러리
     * 파일은 메인 프로젝트에 논리적으로 포함되어 함께 컴파일되므로, 제어기가 보고하는 파일이
     * 라이브러리 폴더(중첩이든 형제든)에 있을 수 있다. 넣지 않으면 그 파일의 브레이크포인트가
     * basename 표기로만 나가고 스택의 소스 열기도 어긋난다.
     */
    private _updateProjectDirs(): void {
        this._projectDirs = [];
        this._projectSourcePaths = [];
        this._libraryDirs = [];
        // 단위가 다시 확정되므로 "넓힌 상태"를 되돌린다 — 새 대상에서는 다시 좁혀서 시작한다.
        this._sourceMapWidened = false;
        if (!this._projectName) { return; }
        const want = this._projectName.toLowerCase();
        const allGprPaths: string[] = [];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            allGprPaths.push(...this._findFiles(folder.uri.fsPath, 'Project.gpr'));
        }

        // 라이브러리 폴더는 메인 프로젝트 폴더 **뒤에** 붙인다 — `_bpFileForms`가 첫 일치 폴더를 기준으로
        // 상대 경로 표기를 만들기 때문에, 메인 프로젝트 기준(`MyLibrary\Project.gpl`)이 먼저 나와야 한다.
        const libraryDirs: string[] = [];
        for (const gprPath of allGprPaths) {
            try {
                const text = fs.readFileSync(gprPath, 'utf-8');
                const info = parseGpr(text);
                if (!info.projectName || info.projectName.toLowerCase() !== want) { continue; }
                this._projectDirs.push(path.dirname(gprPath));
                this._projectSourcePaths.push(...resolveGprSourcePaths(gprPath, text));

                // 참조된 라이브러리 프로젝트는 문서상 메인 프로젝트에 논리적으로 포함되어 함께
                // 컴파일된다 → 제어기가 보고하는 소스도 이 폴더들에서 나올 수 있다.
                const libs = resolveProjectLibraryDirs(gprPath, text, { knownGprPaths: allGprPaths });
                for (const dir of libs.dirs) {
                    libraryDirs.push(dir);
                    const libGpr = gprPathInDir(dir);
                    if (!libGpr) { continue; }
                    try {
                        this._projectSourcePaths.push(...resolveGprSourcePaths(libGpr, fs.readFileSync(libGpr, 'utf-8')));
                    } catch { /* skip */ }
                }
                if (libs.unresolved.length > 0) {
                    this._log(`⚠ ProjectLibrary 폴더를 찾지 못했습니다: ${libs.unresolved.join(', ')}`
                        + ' — 그 라이브러리의 소스는 브레이크포인트/스택 매핑에서 빠집니다.');
                }
            } catch { /* skip */ }
        }
        for (const dir of libraryDirs) {
            if (!this._libraryDirs.some(d => d.toLowerCase() === dir.toLowerCase())) {
                this._libraryDirs.push(dir);
            }
            if (!this._projectDirs.some(d => d.toLowerCase() === dir.toLowerCase())) {
                this._projectDirs.push(dir);
            }
        }

        if (this._projectDirs.length > 0) {
            this._log(
                `프로젝트 폴더 확정: ${this._projectDirs.join(', ')}`
                + (libraryDirs.length > 0 ? ` (라이브러리 ${libraryDirs.length}개 포함)` : '')
                + ` (소스 ${this._projectSourcePaths.length}개)`,
            );
        }
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
     * 변수 조회 응답에서 첫 항목만 취하는 래퍼 — 항목이 없으면 value '(undefined)'.
     * (형식 해석과 STATUS 블록 제거는 parseShowVariableMulti가 담당한다.)
     */
    private _parseShowVariableEval(raw: string): { name: string; type: string; value: string } {
        const entries = parseShowVariableMulti(raw);
        if (entries.length === 0) {
            return { name: '', type: '', value: GPLDebugSession.UNDEFINED_VALUE };
        }
        return entries[0];
    }

    /**
     * `Show Global` 응답을 표시용 텍스트 라인으로 정리한다.
     * STATUS 블록을 먼저 통째로 제거 — 태그만 벗기면 `0, "Success"`가 값처럼 남는다.
     */
    private _showGlobalResponseLines(raw: string): string[] {
        const cleaned = raw
            .replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
            .replace(/<[^>]+>/g, '')
            .trim();
        return cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
    }

    // ═══════════════════════════════════════════════════════
    // 구조적 변수 표시 (배열/객체 트리 확장)
    // 응답 파싱/분류는 showVariableParser.ts — 실기기 캡처 픽스처로 단위 테스트한다.
    // ═══════════════════════════════════════════════════════

    /** 배열 확장 시 순차 조회 상한 — 선언 크기를 알 수 없어(공식 문서: 배열 전체 값은
     *  표시되지 않음) 인덱스 0부터 실패할 때까지 조회하며, 직렬 명령 큐 보호를 위해 제한한다. */
    private static readonly ARRAY_EXPAND_MAX = 30;

    /** 변수 조회 실패/값 없음을 나타내는 표시용 센티널 값. */
    private static readonly UNDEFINED_VALUE = '(undefined)';

    /**
     * 파싱된 항목을 DAP Variable로 변환한다. 배열/객체는 variablesReference를 부여해
     * Variables/Watch 패널에서 트리로 펼칠 수 있게 한다.
     * @param memberEntries 객체 조회 응답에 동봉된 멤버 줄들(있으면 재조회 없이 사용)
     */
    private _makeVariable(
        displayName: string,
        entry: ParsedVarEntry,
        threadName: string,
        frameIndex: number,
        expression: string,
        memberEntries?: ParsedVarEntry[],
    ): DebugProtocol.Variable {
        const kind = classifyVarEntry(entry, (memberEntries?.length ?? 0) > 0);
        if (kind === 'object') {
            const ref = memberEntries && memberEntries.length > 0
                ? this._variableHandles.create({
                    type: 'members',
                    threadName,
                    frameIndex,
                    parentExpression: expression,
                    entries: memberEntries,
                    classType: entry.type,
                })
                : this._variableHandles.create({
                    type: 'expand', threadName, frameIndex, expression, varType: entry.type,
                });
            // 시스템 Location은 펼치지 않아도 읽히게 한 줄 요약을 값에 넣는다(GitHub #27):
            // Cartesian `(X, Y, Z | Yaw, Pitch, Roll) cfg=N`, Angles `Angles(a1, …)`.
            const locSummary = isLocationType(entry.type) && memberEntries?.length ? summarizeLocation(memberEntries) : undefined;
            return {
                name: displayName,
                // 실기기는 타입에 클래스명을 포함해 보고한다(`Object Command`) — 그대로 노출.
                value: locSummary ? `${locSummary}  (${entry.type})` : (entry.type || 'Object'),
                type: entry.type,
                evaluateName: expression,
                variablesReference: ref,
            };
        }
        if (kind === 'array') {
            const ref = this._variableHandles.create({
                type: 'expand', threadName, frameIndex, expression, varType: entry.type,
            });
            return {
                name: displayName,
                // 객체 배열 헤더의 런타임 클래스 자리 `null`은 표시에서 뺀다 (`Object() null` → `Object()`)
                value: `${entry.type.replace(/\s+null\s*$/i, '')} 배열`,
                type: entry.type,
                evaluateName: expression,
                variablesReference: ref,
            };
        }
        // null 객체 참조(`Object() null`, 값 없음)는 빈 값 대신 'null'로 표시.
        // Location 멤버의 ZClearance 1E+32는 "(미설정)" 주석을 붙인다(GitHub #27).
        const displayValue = this._withHexHint(
            annotateLocationMember(entry.name, entry.value)
            || (/\bnull\s*$/i.test(entry.type) ? 'null' : ''),
        );
        return {
            name: displayName,
            value: entry.type ? `${displayValue}  (${entry.type})` : displayValue,
            // 원시 타입은 DAP 표준 이름으로 알려 값이 전용색(불투명)으로 칠해지게 한다 —
            // 정확한 GPL 타입은 값 접미 `(Integer)`로 계속 보인다(dapColorizeType 주석).
            type: dapColorizeType(entry.type, entry.value) ?? (entry.type || undefined),
            evaluateName: expression,
            variablesReference: 0,
        };
    }

    /**
     * Show Variable -eval 1회로 변수/식을 구조적으로 조회한다.
     * @returns null = 응답 없음(미연결 등). 파싱 실패 시 value '(undefined)'인 단순 항목
     *          + STATUS가 실패면 error(코드/메시지) 동봉 — hover/watch가 원인을 표시한다.
     */
    private async _queryVariableStructured(
        threadName: string,
        frameIndex: number,
        expression: string,
    ): Promise<{ entry: ParsedVarEntry; members: ParsedVarEntry[]; error?: { code: number; message: string } } | null> {
        const resp = await this._sendCmd(
            `Show Variable -eval ${threadName} ${frameIndex} ${expression}`,
        );
        if (!resp) { return null; }
        const entries = parseShowVariableMulti(resp);
        if (entries.length === 0) {
            const st = parseStatus(resp);
            return {
                entry: { name: expression, type: '', value: GPLDebugSession.UNDEFINED_VALUE },
                members: [],
                error: st.code !== 0 ? { code: st.code, message: st.message } : undefined,
            };
        }
        return { entry: entries[0], members: entries.slice(1) };
    }

    /**
     * -eval의 제어기 측 한계를 우회하는 조회 (실기기 확인 2026-07-22, GPL 4.2K5):
     * ① 원식 조회 → ② 실패 시 괄호 안 식별자를 정수 값으로 치환해 재시도(`armList(i)`→`armList(3)`)
     * → ③ 그래도 실패하고 점 표기 식이면 **부모 객체를 덤프해 멤버 줄에서 값 추출**
     *   (`readyLoc.extraZ2` — 이 펌웨어는 점 표기 멤버 식을 -729/-780으로 거부하고,
     *    멤버 값은 부모 덤프에만 실려 온다).
     * @returns resolvedExpression — 실제로 평가에 성공한 식(트리 확장/Watch 추가용)
     */
    private async _queryVariableStructuredSmart(
        threadName: string,
        frameIndex: number,
        expression: string,
        depth: number = 0,
    ): Promise<{
        entry: ParsedVarEntry;
        members: ParsedVarEntry[];
        error?: { code: number; message: string };
        resolvedExpression: string;
        /** 프로퍼티를 백킹 필드로 치환해 얻은 값이면 그 출처 설명(표시용, GitHub #26) */
        via?: string;
    } | null> {
        const miss = (r: { entry: ParsedVarEntry; members: ParsedVarEntry[] } | null) =>
            !r || (r.members.length === 0 && (!r.entry.value || r.entry.value === GPLDebugSession.UNDEFINED_VALUE));

        // `Me.x`는 이 제어기 콘솔에서 -712 Invalid syntax(실측 2026-08-25, GitHub #26) — 접두를 벗기고 평가한다.
        expression = expression.replace(/^Me\.(?=[A-Za-z_])/i, '');

        // ① 원식 그대로
        const first = await this._queryVariableStructured(threadName, frameIndex, expression);
        const firstResult = first ? { ...first, resolvedExpression: expression } : null;
        if (!miss(first)) { return firstResult; }

        // ② 변수 인덱스 치환
        const tokens = extractIndexIdentifierTokens(expression);
        if (tokens && tokens.length > 0) {
            const values = new Map<string, string>();
            let allResolved = true;
            for (const t of tokens) {
                const r = await this._queryVariableStructured(threadName, frameIndex, t);
                const v = r?.entry.value?.trim();
                // 정수로 조회된 식별자만 치환 대상
                if (!v || !/^-?\d+$/.test(v)) { allResolved = false; break; }
                values.set(t, v);
            }
            if (allResolved) {
                const rewritten = replaceIndexIdentifierTokens(expression, values);
                if (rewritten !== expression) {
                    const second = await this._queryVariableStructured(threadName, frameIndex, rewritten);
                    if (!miss(second)) {
                        this._log(`인덱스 치환 평가: ${expression} → ${rewritten}`);
                        return { ...second!, resolvedExpression: rewritten };
                    }
                }
            }
        }

        // ②-b 프로퍼티 → 백킹 필드 치환 (GitHub #26). -780은 "식의 마지막 요소가 사용자 프로시저"일 때 난다(실측 2026-08-25).
        //     같은 클래스 프레임이면 점 표기 치환식이 바로 읽히고, 다른 클래스 프레임에서는 Private 필드 점 표기가
        //     -729라 부모 객체 덤프(프레임 무관, Private 포함 전체 필드)에서 멤버 줄을 추출한다.
        if (depth === 0 && first?.error?.code === -780) {
            let candidates = this._propertyBackingCandidates(expression);
            // 부모 객체 덤프는 한 번만 받아 후보 클래스 판별(GitHub #32)과 -729 폴백(#26)에 함께 쓴다.
            const parentExprOfLeaf = candidates[0]?.parentExpr;
            let parentDump: Awaited<ReturnType<GPLDebugSession['_queryVariableStructuredSmart']>> | undefined;
            const getParentDump = async () => {
                if (parentDump === undefined) {
                    parentDump = parentExprOfLeaf
                        ? await this._queryVariableStructuredSmart(threadName, frameIndex, parentExprOfLeaf, depth + 1)
                        : null;
                }
                return parentDump;
            };
            // GitHub #32: 동명 Property가 여러 클래스에 있으면 부모 객체의 **런타임 클래스**(덤프 헤더 `Object RobotArm`)로
            //     후보를 좁힌다 — 남의 클래스 백킹 필드를 먼저 시도하거나 `.Pos` 우회를 잘못 적용하지 않도록.
            const candidateClasses = new Set(candidates.flatMap(c => c.symbols.map(s => (s.className ?? '').toLowerCase())));
            if (parentExprOfLeaf && candidateClasses.size > 1) {
                const parent = await getParentDump();
                const runtimeClass = this._classNameOfType(parent?.entry.type);
                const narrowed = runtimeClass ? this._propertyBackingCandidates(expression, runtimeClass) : [];
                if (narrowed.length > 0) {
                    this._log(`프로퍼티 후보 클래스 한정(#32): ${expression} → ${runtimeClass} (${candidateClasses.size}개 클래스 중)`);
                    candidates = narrowed;
                }
            }
            for (const cand of candidates) {
                const r = await this._queryVariableStructured(threadName, frameIndex, cand.expr);
                if (!miss(r)) {
                    this._log(`프로퍼티 치환 평가: ${expression} → ${cand.expr}`);
                    return { ...r!, resolvedExpression: cand.expr, via: cand.via };
                }
                if (cand.parentExpr && r?.error?.code === UNDEFINED_SYMBOL_STATUS) {
                    const parent = await getParentDump();
                    const wanted = `.${cand.backingLeaf.toLowerCase()}`;
                    const m = parent?.members.find(e => e.name.toLowerCase().endsWith(wanted));
                    if (parent && m) {
                        this._log(`프로퍼티 치환(부모 덤프) 평가: ${expression} → ${parent.resolvedExpression} 덤프의 ${m.name}`);
                        return {
                            entry: m,
                            members: [],
                            resolvedExpression: `${parent.resolvedExpression}.${cand.backingLeaf}`,
                            via: cand.via,
                        };
                    }
                }
            }
            // 반환형이 Location인 프로퍼티는 시스템 멤버 `.Pos`를 붙이면 체인 중간 실행이 허용돼 덤프를 받을 수 있다(실측 2026-08-25).
            if (candidates.some(c => c.symbols.some(s => /^Location$/i.test(s.returnType ?? '')))) {
                const posExpr = `${expression}.Pos`;
                const r = await this._queryVariableStructured(threadName, frameIndex, posExpr);
                if (!miss(r)) {
                    this._log(`Location 프로퍼티 우회 평가: ${expression} → ${posExpr}`);
                    return { ...r!, resolvedExpression: posExpr, via: `${posExpr} (Location 프로퍼티 우회)` };
                }
            }
        }

        // ③ 점 표기 식 → 부모 덤프에서 멤버 값 추출 (1단계만 — 중첩 객체의 멤버는
        //    부모 덤프에도 "존재"만 실려 와 더 내려갈 수 없다)
        const lastDot = expression.lastIndexOf('.');
        if (depth === 0 && lastDot > 0) {
            const parentExpr = expression.slice(0, lastDot);
            const leaf = expression.slice(lastDot + 1);
            // 멤버 이름만 허용 (인덱스 접미사 등 복합 leaf는 덤프에 없음)
            if (/^[A-Za-z_]\w*$/.test(leaf)) {
                const parent = await this._queryVariableStructuredSmart(
                    threadName, frameIndex, parentExpr, depth + 1,
                );
                if (parent && parent.members.length > 0) {
                    const wanted = `.${leaf.toLowerCase()}`;
                    const m = parent.members.find(e => e.name.toLowerCase().endsWith(wanted));
                    if (m) {
                        this._log(`부모 덤프 폴백: ${expression} → ${parent.resolvedExpression} 덤프의 ${m.name}`);
                        return {
                            entry: m,
                            members: [],
                            resolvedExpression: `${parent.resolvedExpression}.${leaf}`,
                        };
                    }
                }
            }
        }

        return firstResult;
    }

    /**
     * Show Variable 실패 STATUS를 사용자 안내 문구로 변환한다.
     * 실기기 확인(2026-07-22, GPL 4.2K5): -eval은 필드/로컬만 평가한다.
     * - -780 "*Unsupported procedure reference*": 이름이 프로퍼티/메서드로 해석됨 —
     *   인자 유무와 무관하게 프로퍼티도 평가 불가(`cmd.ints(0)`, 클래스 프로퍼티 `robotIndex` 모두).
     * - -729 "*Undefined symbol*": 해당 프레임 스코프에 없는 이름(다른 프레임 로컬 등),
     *   또는 객체의 배열 필드 접근(`cmd.m_rawArgs(0)`).
     */
    private _formatEvalError(expression: string, error: { code: number; message: string }): string {
        const base = `(평가 실패 ${error.code}: ${error.message || '원인 미상'})`;
        if (error.code === -780) {
            return `${base} — 프로퍼티/메서드 참조는 제어기 콘솔이 평가하지 못합니다(필드/로컬만 가능). 소스에서 Property로 확인되면 백킹 필드(Get 반환식·m_이름)로 자동 치환하지만 이 식은 치환할 수 없었습니다. 백킹 필드를 직접 확인하세요 (예: ${expression.split('.')[0] || expression} 객체를 펼쳐 m_* 필드 조회)`;
        }
        if (error.code === UNDEFINED_SYMBOL_STATUS) {
            return `${base} — 현재 프레임 스코프에 없는 이름이거나, 점 표기 멤버 접근입니다 (이 제어기의 콘솔 평가는 프레임의 로컬/파라미터 이름만 지원 — 멤버 값은 부모 객체를 조회하세요)`;
        }
        if (error.code === -762 || error.code === -763) {
            // 실측(2026-08-25, GitHub #27): -762 "*Location not a Cartesian type*"(Angles에 X 접근), -763 "*Location not an angles type*"(Cartesian에 Angle(i) 접근)
            const guide = error.code === -763
                ? 'Cartesian(Type 0)이라 Angle(i)가 없습니다 — X/Y/Z/Yaw/Pitch/Roll을'
                : 'Angles(Type 1)라 X/Y/Z/Yaw/Pitch/Roll이 없습니다 — Angle(1..n)을';
            return `${base} — Location 타입 불일치: 이 Location은 ${guide} 조회하세요`;
        }
        if (error.code === -712) {
            return `${base} — 콘솔 평가기가 받지 않는 구문입니다(\`Me.\` 접두, CStr/CInt 같은 시스템 함수 감싸기, 산술식). 변수/필드 식만 입력하세요`;
        }
        return base;
    }

    // ─── Property → 백킹 필드 해석 (GitHub #26) ─────────────────────────────
    // 실측(GPL 4.2K5, 2026-08-25): -eval은 식의 **마지막 요소**가 사용자 Property/Function이면 -780을 낸다(체인 중간은 실행됨).
    // 값 자체는 백킹 필드에 있고, 객체 덤프에는 Private 포함 전체 필드가 프레임과 무관하게 실려 온다. 그래서
    // Property 이름 → 백킹 필드(파서가 기록한 Get 반환식 또는 관례 m_이름) → 필요 시 부모 덤프 추출 순으로 값을 찾는다.

    /** 프로젝트 소스의 Property 심볼 색인(이름별·클래스별, 소문자 키). 소스맵 세대 동안 캐시(_buildSourceFileMap에서 무효화). */
    private _getPropertyIndex(): { byName: Map<string, GPLSymbol[]>; byClass: Map<string, GPLSymbol[]> } {
        if (this._propertyIndexCache) { return this._propertyIndexCache; }
        const byName = new Map<string, GPLSymbol[]>();
        const byClass = new Map<string, GPLSymbol[]>();
        for (const [key, candidates] of this._sourceFileMap) {
            const filePath = this._pickSourcePath(key, candidates);
            if (this._projectDirs.length > 0
                && !this._projectDirs.some(d => this._isPathUnder(filePath, d))) { continue; }
            let content: string;
            try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
            const symbols = GPLParser.parseDocument(content, filePath, { includeLocals: false, includeParameters: false });
            for (const s of symbols) {
                if (s.kind !== GPLSymbolKind.Property) { continue; }
                const n = s.name.toLowerCase();
                byName.set(n, [...(byName.get(n) ?? []), s]);
                if (s.className) {
                    const c = s.className.toLowerCase();
                    byClass.set(c, [...(byClass.get(c) ?? []), s]);
                }
            }
        }
        this._propertyIndexCache = { byName, byClass };
        return this._propertyIndexCache;
    }

    /** `Object RNDRobot` / `Object() RobotArm` 헤더 타입에서 클래스 이름. `null`이나 타입만 있으면 undefined. */
    private _classNameOfType(type: string | undefined): string | undefined {
        const m = (type ?? '').match(/^object\b[^A-Za-z_]*([A-Za-z_]\w*)\s*$/i);
        const name = m?.[1];
        return name && !/^null$/i.test(name) ? name : undefined;
    }

    /**
     * Property 식의 백킹 필드 후보. 식의 마지막 요소가 소스에서 Property로 확인될 때만 만든다(인자 있는 프로퍼티는 제외).
     * 순서: ① Get 본문 `Return <식>`(getterReturnExpr) ② 관례 `m_<이름>`(getter가 있는 프로퍼티만).
     * @param className 수신자 클래스가 알려지면(GitHub #32) 그 클래스의 Property만 — 그 클래스에 없으면(상속 등) 빈 배열.
     */
    private _propertyBackingCandidates(expression: string, className?: string): Array<{
        /** 제어기에 보낼 치환식(부모 식 포함) */ expr: string;
        /** 부모 덤프에서 찾을 멤버 leaf 이름 */ backingLeaf: string;
        /** 표시용 출처 설명 */ via: string;
        parentExpr: string | undefined;
        symbols: GPLSymbol[];
    }> {
        const lastDot = expression.lastIndexOf('.');
        const leaf = lastDot >= 0 ? expression.slice(lastDot + 1) : expression;
        if (!/^[A-Za-z_]\w*$/.test(leaf)) { return []; }
        const indexed = this._getPropertyIndex().byName.get(leaf.toLowerCase()) ?? [];
        const symbols = className
            ? indexed.filter(s => (s.className ?? '').toLowerCase() === className.toLowerCase())
            : indexed;
        if (symbols.length === 0) { return []; }
        const parentExpr = lastDot > 0 ? expression.slice(0, lastDot) : undefined;
        const out: ReturnType<GPLDebugSession['_propertyBackingCandidates']> = [];
        const seen = new Set<string>();
        const add = (backing: string, via: string) => {
            const key = backing.toLowerCase();
            if (seen.has(key)) { return; }
            seen.add(key);
            out.push({
                expr: parentExpr ? `${parentExpr}.${backing}` : backing,
                backingLeaf: backing.split('.').pop()!.replace(/\(.*$/, ''),
                via,
                parentExpr,
                symbols,
            });
        };
        for (const s of symbols) {
            // 단순 식(식별자·점 체인·인덱스)만 — 산술/함수 감싸기는 콘솔이 -712로 거부해 왕복만 낭비한다
            if (s.getterReturnExpr && /^[A-Za-z_][\w.]*(\([^()]*\))?$/.test(s.getterReturnExpr)) {
                add(s.getterReturnExpr, `${s.getterReturnExpr} (Get 반환식)`);
            }
        }
        if (symbols.some(s => s.hasGetter !== false)) {
            add(`m_${leaf}`, `m_${leaf} (관례)`);
        }
        return out;
    }

    /**
     * 클래스 객체 노드의 가상 Property 자식(GitHub #26 제안 4). 덤프에 이미 실려 온 멤버 줄에서 백킹 필드 값을 찾으므로
     * 제어기 왕복이 없다. 해석 불가(복잡한 getter·백킹 필드 없음)면 `(프로시저 — 평가 불가)`, WriteOnly는 제외.
     */
    private _propertyChildren(
        classType: string | undefined,
        members: ParsedVarEntry[],
        parentExpression: string,
        threadName: string,
        frameIndex: number,
    ): DebugProtocol.Variable[] {
        const className = this._classNameOfType(classType);
        if (!className || members.length === 0) { return []; }
        const props = this._getPropertyIndex().byClass.get(className.toLowerCase());
        if (!props || props.length === 0) { return []; }
        const bareOf = (e: ParsedVarEntry) => this._memberBareName(e.name, parentExpression);
        const memberNames = new Set(members.map(e => bareOf(e).toLowerCase()));
        const out: DebugProtocol.Variable[] = [];
        const seen = new Set<string>();
        for (const p of props) {
            const key = p.name.toLowerCase();
            if (seen.has(key) || p.hasGetter === false || memberNames.has(key)) { continue; }
            seen.add(key);
            const backing = [p.getterReturnExpr, `m_${p.name}`]
                .filter((b): b is string => !!b && /^[A-Za-z_]\w*$/.test(b))
                .map(b => b.toLowerCase());
            const m = members.find(e => backing.includes(bareOf(e).toLowerCase()));
            const hint: DebugProtocol.VariablePresentationHint = { kind: 'property', attributes: ['readOnly'] };
            if (!m) {
                out.push({ name: p.name, value: '(프로시저 — 평가 불가)', variablesReference: 0, presentationHint: hint });
                continue;
            }
            const bare = bareOf(m);
            const v = this._makeVariable(p.name, m, threadName, frameIndex, `${parentExpression}.${bare}`);
            out.push({ ...v, value: `${v.value}  ← ${bare}`, presentationHint: hint });
        }
        return out;
    }

    /** 멤버 전체 경로(`Loc.Pos.X`)에서 부모 식을 제외한 표시용 이름을 얻는다. */
    private _memberBareName(fullName: string, parentExpression: string): string {
        const prefix = `${parentExpression}.`;
        if (fullName.toLowerCase().startsWith(prefix.toLowerCase())) {
            return fullName.slice(prefix.length);
        }
        const lastDot = fullName.lastIndexOf('.');
        return lastDot >= 0 ? fullName.slice(lastDot + 1) : fullName;
    }

    /**
     * 배열 노드 확장: 선언 크기를 조회할 방법이 없으므로(공식 문서 — 전체 배열 값은
     * 표시되지 않고 요소 단위 조회만 가능) 인덱스 0부터 순차 조회하고 범위 밖(STATUS
     * 오류)에서 멈춘다. 다차원 배열은 첫 인덱스만 순회하고 나머지는 0으로 고정한다.
     */
    private async _expandArrayElements(
        scope: { threadName: string; frameIndex: number; expression: string; varType: string },
    ): Promise<DebugProtocol.Variable[]> {
        const out: DebugProtocol.Variable[] = [];
        const rank = arrayRank(scope.varType);
        const suffix = rank > 1 ? ',0'.repeat(rank - 1) : '';

        const gen = this._frameCacheGen;
        let i = 0;
        for (; i < GPLDebugSession.ARRAY_EXPAND_MAX; i++) {
            // 확장 도중 새 step/continue가 시작되면(pending 액션/캐시 세대 변경) 즉시
            // 중단해 직렬 명령 큐를 사용자 액션에 양보한다.
            if (this._pendingAction || gen !== this._frameCacheGen) {
                out.push({ name: '…', value: '(실행 재개로 조회 중단)', variablesReference: 0 });
                break;
            }
            const elemExpr = `${scope.expression}(${i}${suffix})`;
            const resp = await this._sendCmd(
                `Show Variable -eval ${scope.threadName} ${scope.frameIndex} ${elemExpr}`,
            );
            if (!resp) {
                // 응답 없음(타임아웃/연결 끊김)은 배열 끝이 아니다 — 실패 표식 후 중단.
                out.push({ name: `(${i}${suffix})`, value: '(조회 실패)', variablesReference: 0 });
                break;
            }
            if (!isSuccess(resp)) { break; } // 범위 밖(STATUS 오류) = 배열 끝
            const entries = parseShowVariableMulti(resp);
            const first = entries[0];
            if (!first) { break; }
            // STATUS 성공이면 값이 빈 문자열이어도 유효한 요소다(빈 String 등) — 계속 진행.
            out.push(this._makeVariable(
                `(${i}${suffix})`,
                first,
                scope.threadName,
                scope.frameIndex,
                elemExpr,
                entries.slice(1),
            ));
        }

        if (i >= GPLDebugSession.ARRAY_EXPAND_MAX) {
            out.push({
                name: '…',
                value: `(${GPLDebugSession.ARRAY_EXPAND_MAX}개까지만 표시 — 이후 요소는 Watch에 ${scope.expression}(${GPLDebugSession.ARRAY_EXPAND_MAX}${suffix}) 형식으로 입력)`,
                variablesReference: 0,
            });
        }
        if (rank > 1) {
            out.push({
                name: 'ℹ',
                value: `${rank}차원 배열 — 첫 인덱스만 순회(나머지 0 고정). 개별 요소는 Watch에 ${scope.expression}(i${',j'.repeat(rank - 1)}) 형식으로 입력`,
                variablesReference: 0,
            });
        }
        if (out.length === 0) {
            out.push({
                name: '(요소 없음)',
                value: `요소 조회 실패 — Watch에 ${scope.expression}(0${suffix}) 형식으로 확인 가능`,
                variablesReference: 0,
            });
        }
        return out;
    }

    // ⑧ 동일 쓰레드 프레임 조회의 중복 방지 — 정지 감지 직후 프리페치와 VS Code의
    //    stackTraceRequest가 겹칠 때 같은 Show Stack을 두 번 보내지 않고 합류시킨다.
    private _framesInFlight = new Map<string, Promise<StackFrameInfo[]>>();

    /** ⑧ 정지 감지 직후 스택 프레임 선조회로 캐시를 데워 둔다(읽기 전용 Show Stack).
     *  StoppedEvent 직후 오는 stackTraceRequest가 진행 중 조회에 합류해
     *  왕복 1회분의 전환 체감 지연을 줄인다. */
    private _prefetchFramesAfterStop(threadName: string): void {
        void this._getThreadFrames(threadName).catch(() => undefined);
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

        const inFlight = this._framesInFlight.get(threadName);
        if (inFlight) { return inFlight; }
        const fetch = this._fetchThreadFramesUncached(threadName);
        this._framesInFlight.set(threadName, fetch);
        try {
            return await fetch;
        } finally {
            this._framesInFlight.delete(threadName);
        }
    }

    private async _fetchThreadFramesUncached(threadName: string): Promise<StackFrameInfo[]> {
        // ⑧ 조회 시작 시점의 캐시 세대 캡처 — 조회 중 새 step/continue로 무효화되면
        //    (특히 Show Stack 0프레임 → Show Thread fallback이 Step 뒤에 큐잉되는 경우)
        //    과도기 위치를 fresh로 재주입하지 않도록 캐시 기록만 건너뛴다.
        const gen = this._frameCacheGen;
        const resp = await this._sendCmd(`Show Stack ${threadName}`);
        const frames = resp ? parseStack(resp) : [];
        if (frames.length > 0) {
            if (gen === this._frameCacheGen) {
                this._cachedFrames.set(threadName, frames);
                this._frameCacheAt.set(threadName, Date.now());
            }
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
            if (gen === this._frameCacheGen) {
                this._cachedFrames.set(threadName, fallback);
                this._frameCacheAt.set(threadName, Date.now());
            }
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

        if (this._hasBreakpointAt(top.file, top.fileLine)) {
            this._log(`현재 위치가 브레이크포인트와 일치: ${top.file}:${top.fileLine}`);
            return 'breakpoint';
        }

        return fallback;
    }

    /**
     * 이 위치에 우리가 설정한 BP 가 있는가 — 소스 BP(`_breakpoints`) · 함수 BP(`_functionBps`) ·
     * Step Into Target 임시 BP(`_tempBreakpoints`) 를 모두 본다. 파일은 basename 대소문자 무시 비교.
     */
    private _hasBreakpointAt(file: string, line: number): boolean {
        if (!file || line <= 0) { return false; }
        const base = path.basename(file);
        const key = base.toLowerCase();

        for (const [name, lines] of this._breakpoints) {
            if (name.toLowerCase() === key && lines.has(line)) { return true; }
        }
        if (this._tempBreakpoints.get(key)?.has(line)) { return true; }
        return this._functionBps.some(f => f.file.toLowerCase() === key && f.line === line);
    }


    /**
     * Build a map of basename(lowercase) → 동명 후보 전체 경로 배열, for all .gpl/.gpo files in workspace.
     */
    private _buildSourceFileMap(): void {
        this._sourceFileMap.clear();
        this._sourceResolveWarned.clear();
        // 소스 구성이 바뀌면 전역 열거/조회 메모도 무효 — 파일 추가·이동·프로젝트 변경 대응.
        this._globalQueryMemo.clear();
        this._globalDescriptorsCache = undefined;
        this._propertyIndexCache = undefined;
        const roots = this._sourceMapRoots();
        if (roots.dirs.length === 0) { return; }

        let truncated = false;
        for (const dir of roots.dirs) {
            truncated = this._scanDir(dir) || truncated;
        }
        this._log(`소스 파일 맵: ${this._sourceFileMap.size}개 파일 인덱싱 완료 (${roots.label})`);
        if (truncated) {
            this._log(
                '⚠ 소스 탐색이 깊이/개수 상한에 걸렸습니다 — 일부 폴더의 소스는 매핑되지 않습니다. '
                + '프로젝트 상위 폴더 대신 프로젝트(또는 projects) 폴더를 워크스페이스로 여세요.',
            );
        }
    }

    /**
     * 소스맵 스캔 루트 — **컴파일 단위 우선**.
     *
     * 워크스페이스를 프로젝트가 아니라 상위 폴더에서 여는 구조(`…\시뮬레이션`)에서는 무관한
     * 형제 프로젝트의 동명 파일이 소스맵에 함께 들어온다(실측 2026-09-02: `.gpl` 96개 중 basename
     * 충돌 53건 — `MergeCode`/`MergeCode_Beta`, `Main.gpl` 2곳). 제어기가 보고하는 파일은 정의상
     * 이 컴파일 단위 안에 있으므로, 스캔 범위를 `_projectDirs`(메인 + `ProjectLibrary` 재귀)로 좁히면
     * 경합 자체가 사라지고 상위 폴더 워크스페이스에서의 스캔 비용도 줄어든다.
     *
     * 단위를 판정할 수 없으면(프로젝트명과 일치하는 `.gpr` 없음) 워크스페이스 전체로 떨어진다 —
     * 모를 때 좁히면 소스 이동이 아예 안 되는 퇴보가 되므로 **누락 방지를 우선**한다.
     */
    private _sourceMapRoots(): { dirs: string[]; label: string } {
        const workspace = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
        if (this._sourceMapWidened || this._projectDirs.length === 0) {
            return { dirs: workspace, label: '워크스페이스 전체' };
        }
        // 라이브러리 폴더가 메인 폴더 안에 있으면(이 구조가 그렇다) 중복 스캔이므로 최상위만 남긴다.
        const tops = this._projectDirs.filter(
            (d, i) => !this._projectDirs.some((other, j) => j !== i && this._isPathUnder(d, other)),
        );
        return { dirs: tops, label: `컴파일 단위 ${tops.length}폴더` };
    }

    /** 소스 맵 채우기. 깊이/개수 상한에 걸렸으면 true(호출측이 경고). */
    private _scanDir(dir: string): boolean {
        const { truncated } = walkTree(dir, (full, name) => {
            if (!/\.gpl$/i.test(name) && !/\.gpo$/i.test(name)) { return; }
            const key = name.toLowerCase();
            const list = this._sourceFileMap.get(key);
            if (list) { list.push(full); } else { this._sourceFileMap.set(key, [full]); }
        });
        return truncated;
    }

    /**
     * Find files matching a name recursively under a directory.
     * 상한은 walkTree가 관리한다 — 상위 저장소 폴더를 워크스페이스로 열어도 UI가 멈추지 않게.
     */
    private _findFiles(dir: string, targetName: string): string[] {
        const results: string[] = [];
        const wanted = targetName.toLowerCase();
        walkTree(dir, (full, name) => {
            if (name.toLowerCase() === wanted) { results.push(full); }
        });
        return results;
    }

    /**
     * GPL 소스를 파싱하여 특정 프로시저 내 로컬 변수/파라미터 이름을 수집한다.
     * @param fileName 제어기가 반환한 파일 basename (e.g. "Entry_Main.gpl")
     * @param line 현재 실행 줄 — process 이름으로 프로시저를 못 찾을 때 이 줄이 속한 프로시저를 선택하는 데 사용
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
     * 결과는 소스맵 세대 동안 캐시된다(_buildSourceFileMap에서 무효화) — 정지마다
     * 프로젝트 전체 read+parse를 반복하지 않는다.
     */
    private _getGlobalVariableDescriptors(): GlobalVariableDescriptor[] {
        if (this._globalDescriptorsCache) { return this._globalDescriptorsCache; }
        const seen = new Set<string>();
        const globals: GlobalVariableDescriptor[] = [];

        for (const [key, candidates] of this._sourceFileMap) {
            const filePath = this._pickSourcePath(key, candidates);
            // 프로젝트 폴더를 알면 그 밖의 소스(다른 프로젝트/사본)는 전역 열거에서 제외 —
            // Globals 패널에 무관한 프로젝트의 전역이 섞이는 것을 막는다.
            if (this._projectDirs.length > 0
                && !this._projectDirs.some(d => this._isPathUnder(filePath, d))) { continue; }
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
                        globals.push({
                            displayName,
                            lookupNames,
                            isPrivate: s.accessModifier === 'private',
                        });
                    }
                }
            }
        }

        this._globalDescriptorsCache = globals.sort(
            (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'accent' }),
        );
        return this._globalDescriptorsCache;
    }

    /** `Show Global <name>` 1회 조회 — 성공 시 표시용 값, 실패 시 ''. */
    private async _readGlobalValueSingle(name: string): Promise<string> {
        const resp = await this._sendCmd(
            this._projectName
                ? `Show Global ${name}, ${this._projectName}`
                : `Show Global ${name}`,
        );
        if (!resp || !isSuccess(resp)) {
            return '';
        }

        const parsedEval = this._parseShowVariableEval(resp);
        if (parsedEval.value && parsedEval.value !== GPLDebugSession.UNDEFINED_VALUE) {
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
        return lines.length > 0 ? lines.join(', ') : '';
    }

    private _enqueueCommand<T>(work: () => Promise<T>): Promise<T> {
        const run = this._commandQueue.then(() => work(), () => work());
        this._commandQueue = run.then(
            () => undefined,
            () => new Promise<void>(r => setTimeout(r, 100)),  // 연결 실패 시 100ms 대기 후 다음 명령
        );
        return run;
    }

    /**
     * Show Thread 폴을 연결 건강 프로브로 보낸다(프로브 타임아웃·실패 종류 분류, 예외 없음). 세션이 끊겨 있으면 null.
     * 결과는 호출측이 debugBridge.fireDebugProbeResult 로 확장에 보고한다 — 디버그 중엔 트리 폴링이 꺼져 있어
     * 확장의 유실 판정(controller/connectionHealth.ts)은 이 경로에 의존한다(2026-08-28).
     */
    private async _probeThreadList(): Promise<ProbeOutcome | null> {
        if (!this._config || !this._isConnected) { return null; }
        this._lastControllerCommand = SHOW_THREAD_LIST_CMD;
        return this._enqueueCommand(async () => {
            if (!this._config || !this._isConnected) { return null; }
            return probeControllerCommand(SHOW_THREAD_LIST_CMD, this._config, this._probeTimeoutMs);
        });
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

    /**
     * ⑦ 비-pending 1403 트리거용 코얼레싱 폴 예약. 디바운스 창(POLL_MIN_GAP_MS)이
     * 지나는 시점에 force 폴 1회를 보장한다 — 창 안에 도착한 트리거를 그냥 버리면
     * 자유 실행 BP 히트 감지가 인터벌 백업(≥1s)까지 밀리는 구멍이 생긴다.
     */
    private _requestTriggerPoll(): void {
        if (this._triggerPollPending) { return; }
        this._triggerPollPending = true;
        const since = Date.now() - this._lastPollCompletedAt;
        const delay = Math.max(0, GPLDebugSession.POLL_MIN_GAP_MS - since) + 5;
        setTimeout(() => {
            this._triggerPollPending = false;
            if (!this._isConnected) { return; }
            // force=true: 만료 시점 폴이 다시 디바운스에 걸리지 않도록. 폴 진행 중이면
            // _pollRetryRequested(force 경로)로 재폴이 예약된다.
            void this._pollThreadStates(true);
        }, delay);
    }

    // 폴 체인 예외는 첫 1회만 Debug Console에 알리고(스팸 방지) 이후는 조용히 재스케줄한다.
    private _pollChainErrorLogged = false;

    private _logPollChainError(chain: string, err: unknown): void {
        if (this._pollChainErrorLogged) { return; }
        this._pollChainErrorLogged = true;
        const msg = err instanceof Error ? err.message : String(err);
        this._log(`⚠ ${chain} 폴 체인 예외 (체인은 유지됨): ${msg}`);
    }

    private _startPolling(): void {
        this._stopPolling();
        this._scheduleNextIntervalPoll(++this._pollTimerGen);
    }

    /**
     * ⑦ 적응형 백업 폴: Running 쓰레드가 있고 1403 이 부재(health 없음/비alive)이면 짧은 간격
     * (_runningBackupPollMs)으로, 1403 이 정상이거나 모두 정지/Idle이면 사용자 간격(_pollIntervalMs)으로 재관측한다.
     * GitHub #22: 1403 이 정상이면 정지/BP 히트는 1403 트리거(onDebugPollTrigger)가 먼저 알려주므로 촘촘한
     * 백업 폴은 트래픽 낭비다(실측 77분간 Show Thread 922회). 정책은 폴마다 재평가하되 로그는 바뀔 때만 남긴다.
     * 정지 중 상태 변화는 사용자 액션이 시작점이라 _fastPoll이 즉시 커버하므로 정지 중 트래픽은 기존과 동일하다.
     */
    private _scheduleNextIntervalPoll(gen: number): void {
        if (gen !== this._pollTimerGen || !this._isConnected) { return; }
        const anyRunning = (this._lastThreadList ?? []).some(t => t.state === 'Running');
        let delay = this._pollIntervalMs;
        if (anyRunning) {
            const health = getRuntimeConsoleHealth();
            const alive = health?.alive === true;
            delay = alive ? this._pollIntervalMs : Math.min(this._runningBackupPollMs, this._pollIntervalMs);
            const policy: 'alive' | 'absent' = alive ? 'alive' : 'absent';
            if (policy !== this._backupPollPolicy) {
                this._backupPollPolicy = policy;
                this._log(alive
                    ? `백업 폴: 1403 정상(${health?.state}) → ${delay}ms (GitHub #22)`
                    : `백업 폴: 1403 부재(${health ? health.state : '상태 공급자 없음'}) → ${delay}ms (GitHub #22)`);
            }
        }
        this._pollTimer = setTimeout(() => {
            this._pollTimer = undefined;
            void (async () => {
                if (gen !== this._pollTimerGen || !this._isConnected) { return; }
                try {
                    if (!this._pollInFlight) {
                        await this._pollThreadStates();
                    }
                } catch (err) {
                    // 폴 1회 예외로 인터벌 체인이 조용히 끊기지 않게 한다 (재스케줄 보장).
                    this._logPollChainError('interval', err);
                } finally {
                    this._scheduleNextIntervalPoll(gen);
                }
            })();
        }, delay);
    }

    private _stopPolling(): void {
        this._pollTimerGen++;
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
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
        this._frameCacheGen++; // ⑧ 진행 중이던 프레임 조회의 캐시 기록도 무효화
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
                    try {
                        if (!this._pollInFlight) {
                            await this._pollThreadStates(true);
                        }
                    } catch (err) {
                        // 폴 1회 예외로 fast poll 체인이 끊기지 않게 한다 (다음 스케줄 유지).
                        this._logPollChainError('fast', err);
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
        if (!force && Date.now() - this._lastPollCompletedAt < GPLDebugSession.POLL_MIN_GAP_MS) { return; }
        this._pollInFlight = true;
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
                    this._stopPolling();
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
                const id = this._getOrCreateThreadId(t.name);
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
                            this._prefetchFramesAfterStop(t.name);

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
                        t.name, t.file, t.fileLine, (f, l) => this._hasBreakpointAt(f, l));
                    if (verdict === 'scheduler' || verdict === 'announced') {
                        this._previousThreadStates.set(t.name, t.state);
                        if (t.state !== prevState) { threadStateChanged = true; }
                        continue;
                    }

                    // 정지로 인정 — 직전 정지의 값이 캐시에 남아 있을 수 있으므로 무효화한다.
                    this._clearEvaluateCache();
                    this._cachedFrames.delete(t.name);
                    this._frameCacheAt.delete(t.name);
                    this._frameCacheGen++;

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
                    this._prefetchFramesAfterStop(t.name);

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
                        reason = await this._resolveStopReasonForThread(t.name, 'step');
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
                    this._prefetchFramesAfterStop(t.name);
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
            // GitHub #28: pending 이 해소됐으면 게이트로 무시한 요청 수를 1회 요약하고 0 으로
            if (!this._pendingAction && this._stepGateIgnored > 0) {
                this._log(`Step 게이트: 정지 확인 대기·최소 간격으로 무시한 요청 ${this._stepGateIgnored}건 (GitHub #28)`);
                this._stepGateIgnored = 0;
            }
            // ④ 이번 폴 진행 중 유실된 트리거가 있으면 즉시 1회 재폴 (30ms 뒤, force)
            if (this._pollRetryRequested) {
                this._pollRetryRequested = false;
                if (this._isConnected) {
                    setTimeout(() => { void this._pollThreadStates(true); }, 30);
                }
            }
        }
    }

    /**
     * Start 전 배포 잠금 확인 — 다른 창/프로세스가 업로드/배포 중이면 최대 20초 기다리고, 그래도 잡혀 있으면 false.
     * 업로드 도중 Start는 제어기 이상을 유발할 수 있다(이슈 #17). 이 세션의 F5 배포는 deploy() 종료 시 이미 해제됐다.
     */
    private async _waitDeployLockForStart(what: string): Promise<boolean> {
        if (!this._config) { return true; }
        const lock = getDeployLock(this._config.ip);
        const deadline = Date.now() + 20_000;
        let logged = false;
        for (;;) {
            const cur = lock.current();
            if (!cur) { return true; }
            if (!logged) {
                this._log(`${what} 대기: 배포 잠금 보유 중 (${describeDeployLock(cur.record)}) — 최대 20초`);
                logged = true;
            }
            if (Date.now() >= deadline) {
                this._log(`⚠ ${what} 보류: 배포 잠금이 계속 잡혀 있음 (${describeDeployLock(cur.record)}) — 업로드 도중 Start는 제어기 이상을 유발할 수 있어 보내지 않습니다.`);
                return false;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * Run build-only deploy before attach.
     */
    private async _runDeployBeforeAttach(args: IAttachRequestArguments): Promise<{ ok: boolean; cancelled?: boolean }> {
        const projectDir = await this._resolveDeployProjectDir(args);
        if (!projectDir) {
            this._log('[deploy] 배포할 Project.gpr 폴더를 찾지 못했습니다.');
            return { ok: false };
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
                // /GPL/<name>이 아직 없으면(최초 배포) deploy()가 FTP로 폴더를 생성해 직접 업로드한다.
                directGpl: true,
                // 배포 잠금 owner 라벨(다른 창/MCP 경고 문구에 표시). 잠금 자체는 deploy() 안에서 획득된다.
                lockOwner: 'F5 Deploy',
                // 무조건 Stop -all 하지 않는다: 업로드 뒤 Compile 직전에 Show Thread로 확인하고, 활성 쓰레드가
                // 있을 때만 사용자에게 정지 여부를 모달로 묻는다(Quick Compile과 동일한 게이트, §0.6).
                // 미승인 시 THREAD_CHECK로 중단 — 업로드는 이미 끝났고 Compile만 수행하지 않는다.
                skipStop: true,
                confirmStopOnActive: async (activeDesc: string) => {
                    const pick = await vscode.window.showWarningMessage(
                        '실행 중인 쓰레드가 있습니다. Stop -all로 정지한 후 Compile하고 디버깅을 시작할까요?',
                        {
                            modal: true,
                            detail:
                                `활성 쓰레드: ${activeDesc}\n\n` +
                                '업로드는 완료되었습니다. 정지하지 않으면 Compile과 디버깅을 시작하지 않습니다 ' +
                                '(정지 미완료 상태의 Compile은 제어기 이상을 유발할 수 있습니다).',
                        },
                        'Stop 후 디버그 시작',
                    );
                    return pick === 'Stop 후 디버그 시작';
                },
            },
            deployOutput,
            deployDiagnostics,
            undefined,
            this._config,
        );

        if (!result.success) {
            // 배포 잠금을 다른 배포/창/프로세스가 보유 중 — 제어기를 건드리지 않았다. 컨텍스트를 남기고 중단.
            if (result.failedPhase === 'LOCKED') {
                this._log(`[deploy] 배포 잠금 보유 중이라 시작하지 않음 — ${result.failedStatusMessage ?? '(보유자 미상)'}`);
                vscode.window.showWarningMessage(`디버그 배포 불가 — ${result.failedStatusMessage ?? '배포가 이미 진행 중입니다'}. 완료 후 다시 시도하세요.`);
                return { ok: false, cancelled: true };
            }
            // 사용자가 쓰레드 정지 확인을 취소한 경우(THREAD_CHECK)는 실패가 아니라 취소로 다룬다.
            // 컴파일 에러 UI(첫 에러 점프 / Problems 패널)를 띄우지 않고 조용히 중단한다.
            if (result.failedPhase === 'THREAD_CHECK') {
                this._log('[deploy] 사용자가 쓰레드 정지를 취소하여 디버깅을 시작하지 않습니다.');
                if (result.failedStatusMessage) {
                    this._log(`[deploy] ${result.failedStatusMessage}`);
                }
                return { ok: false, cancelled: true };
            }
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

            await jumpToFirstCompileError(result.compileErrors, projectDir,
                msg => this._log(`[deploy] ${msg}`));

            deployOutput.show(true);
            return { ok: false };
        }

        if (!this._projectName && result.projectName) {
            this._projectName = result.projectName;
            this._log(`[deploy] 프로젝트 설정: ${this._projectName}`);
        }

        this._log(`[deploy] 성공: ${result.projectName}`);
        return { ok: true };
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
            const resp = await this._sendCmd(this._bpCommand('Nobreak', projectName, file, line));
            if (resp) { cleared++; }
        }

        this._log(`attach preflight: ${projectName} 브레이크포인트 ${cleared}/${controllerBps.length} 정리`);
    }

    // ═══════════════════════════════════════════════════════
    // Source staleness — 제어기 컴파일 코드보다 새로운 소스 감지 + BP 강등 (GitHub #21)
    // ═══════════════════════════════════════════════════════

    /**
     * 컴파일 스냅샷(deployRecord)과 현재 로컬 소스를 비교해 _staleFiles 를 재구성하고 `gpl.sourceStale` 이벤트를
     * 보낸다(빈 목록 = 해소 → 확장이 상태바 배지를 지운다). 판정 근거는 "우리가 올려서 컴파일한 소스의 스냅샷"이며
     * 제어기 상태가 아니다(§0 — 제어기 상태는 <STATUS> 로만 판정).
     * - 기록 없음: 판정 불가 → 1회 로그, 'compiled-before-edit' 항목은 버리고(세션 중 저장 항목은 유지) 이벤트 전송.
     * - .gpl/.gpo 만 stale 대상. .gpr 변경은 'project-file' 로 로그만(파일 목록/옵션 변경은 BP 줄 번호와 무관).
     * - 세션 중 저장(saved-in-session) 항목은 기록이 그 저장 이후 갱신된 경우(재컴파일)에만 해제한다.
     */
    private _evaluateSourceStaleness(trigger: string): void {
        const rec = this._config && this._projectName
            ? getCompiledRecord(this._config.ip, this._projectName)
            : undefined;
        if (!rec) {
            if (!this._staleNoRecordLogged) {
                this._staleNoRecordLogged = true;
                this._log(this._projectName
                    ? '[stale] 배포 기록 없음 — 이 워크스페이스에서 Deploy/F5 로 컴파일한 이력이 없어 BP 신뢰성을 판정할 수 없습니다 (GitHub #21)'
                    : '[stale] 프로젝트명 미확정 — BP 신뢰성 판정을 생략합니다 (GitHub #21)');
            }
            this._compiledRecordAt = undefined;
            for (const [key, e] of [...this._staleFiles]) {
                if (e.reason === 'compiled-before-edit') { this._staleFiles.delete(key); }
            }
            this._sendSourceStaleEvent(trigger);
            return;
        }

        // 비교 기준 폴더: 기록의 projectDir 이 이 세션의 프로젝트 폴더 중 하나면 그것, 아니면 첫 프로젝트 폴더
        // (워크스페이스에 사본이 있어도 디버그 대상 폴더로 비교), 둘 다 없으면 기록의 폴더.
        const projectDir = this._projectDirs.find(d => this._isSamePath(d, rec.projectDir))
            ?? this._projectDirs[0]
            ?? rec.projectDir;
        let diff: SnapshotDiff;
        try {
            diff = compareWithLocal(rec, projectDir);
        } catch (err: any) {
            this._log(`[stale] 스냅샷 비교 실패(무시): ${err?.message ?? err} — ${projectDir}`);
            return;
        }
        this._compiledRecordAt = rec.compiledAt;

        const isSource = (p: string) => /\.(gpl|gpo)$/i.test(p);
        const next = new Map<string, StaleSourceEntry>();
        for (const rel of diff.stale) {
            if (!isSource(rel)) { continue; }
            next.set(path.posix.basename(rel).toLowerCase(), { relPath: rel, reason: 'compiled-before-edit' });
        }
        // 세션 중 저장 항목 이월 — 기록이 저장 이후 갱신됐으면(재컴파일) 해제
        for (const [key, e] of this._staleFiles) {
            if (e.reason !== 'saved-in-session' || next.has(key)) { continue; }
            if (rec.compiledAt > (e.savedAt ?? 0)) { continue; }
            next.set(key, e);
        }
        this._staleFiles = next;

        const when = formatCompiledAt(rec.compiledAt);
        if (next.size > 0) {
            const list = [...next.values()].map(e => e.relPath).join(', ');
            this._log(`[stale] 마지막 Compile(${when}) 이후 변경된 소스 ${next.size}개 (${trigger}): ${list} — 이 파일들의 BP 는 재배포 전까지 신뢰 불가 (GitHub #21)`);
        } else {
            this._log(`[stale] 로컬 소스가 마지막 Compile(${when}) 스냅샷과 일치 (${trigger})`);
        }
        const gprChanged = diff.stale.filter(p => /\.gpr$/i.test(p));
        if (gprChanged.length > 0) {
            this._log(`[stale] project-file 변경: ${gprChanged.join(', ')} — 파일 목록/옵션이 바뀌었을 수 있습니다(BP 판정에는 미반영)`);
        }
        const composition = [
            ...diff.missing.filter(isSource).map(p => `삭제 ${p}`),
            ...diff.added.filter(isSource).map(p => `추가 ${p}`),
        ];
        if (composition.length > 0) {
            this._log(`[stale] 컴파일 이후 파일 구성 변경: ${composition.join(', ')} (추가된 파일은 제어기에 코드가 없어 BP 가 걸리지 않습니다)`);
        }
        this._sendSourceStaleEvent(trigger);
    }

    /** 확장(extension.ts)이 상태바 배지/알림으로 표시하는 커스텀 이벤트. staleFiles 가 비어 있으면 해소. */
    private _sendSourceStaleEvent(trigger: string): void {
        this.sendEvent(new Event('gpl.sourceStale', {
            projectName: this._projectName,
            compiledAt: this._compiledRecordAt,
            staleFiles: [...this._staleFiles.values()].map(e => e.relPath),
            trigger,
        }));
    }

    /** stale 파일 BP 의 DAP message(BREAKPOINTS 뷰 툴팁). 기록이 없으면 세션 중 저장 근거로 표기. */
    private _staleBreakpointMessage(): string {
        const since = this._compiledRecordAt !== undefined
            ? `마지막 Compile ${formatCompiledAt(this._compiledRecordAt)} 이후 수정`
            : '이 디버그 세션 중 저장됨';
        return `소스가 제어기 컴파일 코드보다 새로움(${since}) — Stop + Upload + Run 으로 재배포해야 BP 가 실제 코드 줄에 걸립니다`;
    }

    /**
     * 세션 중 .gpl/.gpo 저장 감지(디버그 대상 프로젝트 폴더 아래만). 저장 내용이 컴파일 스냅샷과 같으면
     * (무변경 저장·되돌리기) stale 이 아니며 오히려 기존 stale 을 해제한다 — 기록이 있을 때만 판정 가능.
     * 그 외에는 'saved-in-session' 으로 표시하고 그 파일의 BP 를 BreakpointEvent 로 강등한다.
     */
    private _onSourceSavedInSession(doc: vscode.TextDocument): void {
        if (!this._isConnected || doc.uri.scheme !== 'file') { return; }
        const fsPath = doc.uri.fsPath;
        if (!/\.(gpl|gpo)$/i.test(fsPath)) { return; }
        const dir = this._projectDirs.find(d => this._isPathUnder(fsPath, d));
        if (!dir) { return; } // 다른 프로젝트/사본 폴더의 파일은 이 세션과 무관
        const relPath = path.relative(dir, fsPath).replace(/\\/g, '/');
        const key = path.basename(fsPath).toLowerCase();

        const rec = this._config ? getCompiledRecord(this._config.ip, this._projectName) : undefined;
        if (rec && this._matchesCompiledSnapshot(rec, relPath, fsPath)) {
            if (this._staleFiles.delete(key)) {
                this._log(`[stale] ${relPath} 저장 내용이 컴파일 스냅샷과 일치 — stale 해제, BP 신뢰성 복원 (GitHub #21)`);
                this._emitBreakpointStateForFile(key, true);
                this._sendSourceStaleEvent('saved');
            }
            return;
        }

        const existing = this._staleFiles.get(key);
        const savedAt = Date.now();
        this._staleFiles.set(key, existing
            ? { ...existing, savedAt }
            : { relPath, reason: 'saved-in-session', savedAt });
        if (existing) { return; } // 이미 stale — BP 는 강등돼 있고 배지도 표시 중(중복 이벤트/로그 방지)
        this._log(`[stale] 세션 중 저장 감지: ${relPath} — 제어기는 옛 컴파일 코드를 실행 중이므로 이 파일의 BP 는 재배포 전까지 신뢰 불가 (GitHub #21)`);
        this._emitBreakpointStateForFile(key, false, this._staleBreakpointMessage());
        this._sendSourceStaleEvent('saved');
    }

    /** 컴파일 성공 기록이 갱신되면(같은 제어기·프로젝트) stale 을 재평가하고 풀린/새로 생긴 파일의 BP 상태를 갱신한다. */
    private _onRecordCompiled(rec: CompiledRecord): void {
        if (!this._isConnected || !this._config) { return; }
        if (rec.ip.trim().toLowerCase() !== this._config.ip.trim().toLowerCase()) { return; }
        if (rec.projectName.trim().toLowerCase() !== this._projectName.trim().toLowerCase()) { return; }
        // 재컴파일로 프로젝트 구성(.gpr 의 ProjectSource/ProjectLibrary)이 바뀌었을 수 있으므로
        // "제어기가 거부한 파일" 기억을 버린다 — 다음 BP 설정은 폴백까지 다시 시도한다.
        this._bpRejectedFiles.clear();
        const before = new Set(this._staleFiles.keys());
        this._evaluateSourceStaleness('recompiled');
        for (const key of before) {
            if (!this._staleFiles.has(key)) { this._emitBreakpointStateForFile(key, true); }
        }
        const message = this._staleBreakpointMessage();
        for (const key of this._staleFiles.keys()) {
            if (!before.has(key)) { this._emitBreakpointStateForFile(key, false, message); }
        }
    }

    /** 저장된 파일의 sha1 이 기록의 스냅샷과 같은가(경로는 '/'·대소문자 무시 비교). 스탬프/sha1 없으면 false. */
    private _matchesCompiledSnapshot(rec: CompiledRecord, relPath: string, fsPath: string): boolean {
        const want = relPath.toLowerCase();
        const stampKey = Object.keys(rec.files).find(k => k.replace(/\\/g, '/').toLowerCase() === want);
        const stamp = stampKey ? rec.files[stampKey] : undefined;
        if (!stamp?.sha1) { return false; }
        try {
            return crypto.createHash('sha1').update(fs.readFileSync(fsPath)).digest('hex') === stamp.sha1;
        } catch {
            return false;
        }
    }

    /**
     * 파일의 BP 들에 BreakpointEvent('changed') 로 verified/message 를 갱신한다. 제어기가 실제로 받아준 줄
     * (_breakpoints)만 대상 — STATUS 실패로 verified=false 였던 BP 를 true 로 올리지 않는다.
     */
    private _emitBreakpointStateForFile(key: string, verified: boolean, message?: string): void {
        const idMap = this._bpIds.get(key);
        if (!idMap || idMap.size === 0) { return; }
        const acceptedEntry = [...this._breakpoints.entries()].find(([file]) => file.toLowerCase() === key);
        const accepted = acceptedEntry?.[1] ?? new Set<number>();
        for (const [line, id] of idMap) {
            if (!accepted.has(line)) { continue; }
            const bp: DebugProtocol.Breakpoint = { id, verified, line };
            if (!verified && message) { bp.message = message; }
            this.sendEvent(new BreakpointEvent('changed', bp));
        }
    }

    /** 두 경로가 같은 폴더인가(Windows 대소문자 무시 — path.win32.relative 가 처리). */
    private _isSamePath(a: string, b: string): boolean {
        try {
            return path.relative(path.resolve(a), path.resolve(b)) === '';
        } catch {
            return false;
        }
    }
}
