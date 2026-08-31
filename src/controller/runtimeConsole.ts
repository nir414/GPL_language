/**
 * 런타임 콘솔 (포트 1403) — 제어기 이벤트 배치 수신.
 * OutputChannel에 파싱된 메시지를 실시간으로 표시한다.
 *
 * 프로토콜 동작 (현재 구현/테스트 기반 가설):
 *   - 연결 → 제어기가 이벤트 큐를 전달 → FIN (정상 종료)
 *   - FIN 후 짧은 지연(`gpl.runtimeConsole.batchReconnectDelayMs`, 기본 250ms) 뒤 재연결 → 다음 배치 대기
 *   - 이벤트 없으면 연결 유지 또는 payload 없이 즉시 FIN (정상 폴링)
 *
 * 접속 churn 완화·재연결 워치독·접속 카운터는 GitHub #22 (2026-08-25 제어기 서비스 다운 사고) 대응.
 * 순수 판정 로직은 ./runtimeConsoleGuards.ts 에 분리되어 있다.
 *
 * ⚠ 소켓 종료 시 반드시 socket.end() 사용 (FIN 전송).
 *   socket.destroy()는 RST를 보내며 제어기 내장 TCP 스택이
 *   해당 포트 서비스를 비정상 상태로 전환할 수 있다.
 */

import * as net from 'net';
import * as vscode from 'vscode';
import { getControllerConfig, getTrafficChannel, formatTrafficTimestamp, recordTrafficLine } from './controllerConnection';
import { normalizeConsoleLine, latin1ToUtf8 } from './responseParser';
import { appendLiveLog } from '../log/liveLogTerminal';
import {
    ConnectReason,
    ConnectStats,
    decideWatchdogAction,
    DEFAULT_LINE_PREFIX,
    formatRuntimeConsoleLine,
    LINE_PREFIX_MODES,
    RuntimeConsoleLinePrefix,
} from './runtimeConsoleGuards';

/**
 * 배치(FIN+데이터) 완료 후 재연결 대기 기본값/하한 — 설정 `gpl.runtimeConsole.batchReconnectDelayMs`.
 * 100 → 250ms 로 상향(GitHub #22): 1403은 배치마다 서버가 FIN 하므로 프로그램이 출력을 내는 동안
 * 100ms 즉시 재접속은 30~40 connect/분의 접속 churn 을 만들었다(제어기 TCP 자원 고갈 가설).
 * 250ms 는 런타임 로그 표시를 배치당 최대 0.15s 늦출 뿐이고, 디버거의 정지 감지는 1402
 * `Show Thread -web` 백업 폴이 보완하므로 체감 차이가 없다. 하한 50ms 는 TCP 정리 여유.
 */
const DEFAULT_BATCH_RECONNECT_DELAY_MS = 250;
const MIN_BATCH_RECONNECT_DELAY_MS = 50;
/** 빈 세션 (이벤트 없이 FIN) 후 고정 간격 재연결 */
const RECONNECT_IDLE_MS = 5_000;
/** 에러/빈 세션 시 지수 백오프 설정 */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 10;
/** end() 후 이 시간 동안 close가 늦어질 수 있어 관찰 로그를 남기는 기준 시간 */
const GRACEFUL_CLOSE_TIMEOUT_MS = 3_000;
// 1403 connect 자체 타임아웃: 방화벽 drop 등 블랙홀 대상에서 OS 기본(수십 초)까지
// 'connecting' 상태로 고착되는 것을 막는다. destroy → close 경로에서 기존 재연결 백오프가 동작.
const CONNECT_TIMEOUT_MS = 5_000;
/**
 * 재연결 워치독 주기 (GitHub #22). 2026-08-25 17:45:05 `CLOSE (empty=2)` 뒤 3분간 RECONNECT/CONNECT
 * 로그가 전무한 채 1403 폴러가 멈춰 사망 직전 런타임 이벤트를 잃었다(원인 미확정). 워치독은
 * "소켓 없음 + 재연결 타이머 없음" 같은 정지 상태를 주기적으로 감지해 강제 재연결한다.
 * 판정 자체는 runtimeConsoleGuards.decideWatchdogAction (순수 함수, 테스트 있음).
 */
const WATCHDOG_INTERVAL_MS = 15_000;
/** 접속 카운터 요약 로그 주기 (누적 N회 접속마다) */
const CONNECT_SUMMARY_EVERY = 50;
/** Connected 상태에서 이 시간 동안 데이터가 없으면 idle 힌트 표시 */
const NO_OUTPUT_HINT_MS = 3_000;
/** payload 없이 종료된 세션이 이 시간 이상 유지되면 정상 idle timeout으로 분류 */
const IDLE_TIMEOUT_SESSION_MS = 1_500;
/** payload 없이 이 시간 안에 종료된 세션은 Immediate EOF(정상 폴링)로 분류 */
const IMMEDIATE_EOF_SESSION_MS = 500;
/** no-payload 경고 스로틀 기본값 (로그 스팸 방지) */
const DEFAULT_UNSTABLE_WARN_COOLDOWN_MS = 60_000;
/** no-payload 누적 경고 임계치 기본값 */
const DEFAULT_NO_PAYLOAD_WARN_THRESHOLD = 10;
/** empty/immediate 로그 출력 주기 기본값 */
const DEFAULT_EMPTY_NOTICE_EVERY = 5;
/** Immediate EOF 재연결 base/max 기본값 (짧은 블라인드 구간 완화) */
const DEFAULT_IMMEDIATE_EOF_RECONNECT_BASE_MS = 1_000;
const DEFAULT_IMMEDIATE_EOF_RECONNECT_MAX_MS = 15_000;
/** 빈 세션 재연결 base/max 기본값 */
const DEFAULT_IDLE_RECONNECT_BASE_MS = RECONNECT_IDLE_MS;
const DEFAULT_IDLE_RECONNECT_MAX_MS = RECONNECT_MAX_MS;

interface RuntimeConsoleTuning {
    /** 배치 완료 후 재연결 지연 (하한 MIN_BATCH_RECONNECT_DELAY_MS) */
    batchReconnectDelayMs: number;
    noPayloadWarnThreshold: number;
    unstableWarnCooldownMs: number;
    emptyNoticeEvery: number;
    immediateEofReconnectBaseMs: number;
    immediateEofReconnectMaxMs: number;
    idleReconnectBaseMs: number;
    idleReconnectMaxMs: number;
}

interface RuntimeConsoleStartOptions {
    forceImmediateReconnect?: boolean;
}

interface RuntimeConsolePrimeOptions {
    windowMs?: number;
    reconnectDelayMs?: number;
}

export interface RuntimeConsoleStatusSnapshot {
    state: 'idle' | 'connecting' | 'connected' | 'connected-no-payload' | 'reconnecting' | 'connect-failed' | 'no-payload' | 'polling' | 'stopped' | 'batch-complete' | 'socket-error';
    connected: boolean;
    reason: string;
    detail?: string;
    noPayloadStreak: number;
    immediateEofStreak: number;
    lastChangedAt: number;
    lastConnectAt?: number;
    lastPayloadAt?: number;
    lastPayloadBytes?: number;
    lastErrorCode?: string;
    reconnectAttempt?: number;
    reconnectDelayMs?: number;
    /** 누적 connect 시도 수 (connectInternal 이 실제로 소켓을 만든 횟수) — GitHub #22 접속 churn 관측 */
    connectCount?: number;
    /** 최근 60초 슬라이딩 윈도우 connect 수 */
    connectsPerMinute?: number;
    /** 재연결 워치독이 개입(강제 재연결/지연 타이머 대리 발화/connecting 고착 정리)한 누적 횟수 */
    watchdogKicks?: number;
}

export class RuntimeConsole implements vscode.Disposable {
    private socket: net.Socket | null = null;
    private output: vscode.OutputChannel;
    private stateOutput: vscode.OutputChannel;
    private _isConnected = false;
    private carry = '';
    // 1403 type-3 콘솔 라인은 128바이트 청크로 쪼개져 오므로(개행으로 끝나는 청크까지가 한 줄),
    // 개행이 올 때까지 메시지를 이어붙이기 위한 버퍼.
    private _frameMsgBuf = '';
    private _frameMsgProject = '';
    /** 세션 내 `<L>N</L>` ≠ 실제 청크 바이트 수 건수(프레임 경계 오판 진단용, 첫 1회만 로그). */
    private _sessionLenMismatch = 0;
    private disposed = false;
    /** 사용자가 명시적으로 stop()을 호출했을 때 true → 자동 재연결 금지 */
    private _explicitStop = false;
    private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /** _reconnectTimer 의 예정 발화 시각 — 워치독이 "타이머가 있는데 발화하지 않는" 상태를 판정 */
    private _reconnectDueAt = 0;
    /** 다음 connect 의 이유 (접속 카운터 이유별 집계). armReconnectTimer 가 기록한다. */
    private _pendingConnectReason: ConnectReason = 'start';
    /** 최대 재시도 도달로 자동 재연결이 멈춘 상태 — 사용자 조작(start)으로만 해제, 워치독은 개입하지 않는다 */
    private _reconnectStopped = false;
    /** 재연결 워치독 (start()에서 켜고 stop()/dispose()에서 끈다) — GitHub #22 */
    private _watchdogTimer: ReturnType<typeof setInterval> | null = null;
    private _watchdogKicks = 0;
    /** RECONNECT_STOPPED 상태에서 "개입 안 함" 로그를 1회만 남기기 위한 플래그 */
    private _watchdogStoppedNoticeLogged = false;
    /** 접속 카운터: 누적 / 최근 60초 / 이유별 — GitHub #22 제안 1 (자원 고갈 가설 검증) */
    private readonly _connectStats = new ConnectStats(CONNECT_SUMMARY_EVERY);
    private _reconnectAttempt = 0;
    private _lastReconnectDelayMs = 0;
    private _lastError: Error | null = null;
    private _lastErrorCode = '';
    private _lastReason = '초기화 전';
    private _lastDetail = '';
    private _lastChangedAt = Date.now();
    private _state: RuntimeConsoleStatusSnapshot['state'] = 'idle';
    /** 연결 성립 시각 — 로깅용 */
    private _connectedAt = 0;
    /** 마지막 연결 시도 시각 */
    private _lastConnectAttemptAt = 0;
    /** 현재 세션에서 데이터(바이트)를 수신했는지 여부 */
    private _sessionDataReceived = false;
    /** 마지막 payload 수신 시각/크기 */
    private _lastPayloadAt = 0;
    private _lastPayloadBytes = 0;
    /** 현재 세션 누적 수신 바이트(원본 ASCII 길이) */
    private _sessionRxBytes = 0;
    /** 현재 세션에서 emit한 E-블록 프레임 수(heartbeat 포함) */
    private _sessionFrames = 0;
    /** 현재 세션에서 normalize 후 비어 있어 swallow된 프레임 수(heartbeat 등) */
    private _sessionFramesSwallowed = 0;
    /** 현재 세션에서 GPL Console에 실제 표시한 라인 수 */
    private _sessionLinesEmitted = 0;
    /** TEST ITERATION gap 진단용 현재 세션 관측값 */
    private _sessionIterationValues: number[] = [];
    /** 누적 세션 통계 — 연결 시점이 아닌 전체 런타임 기준 */
    private _lifetimeRxBytes = 0;
    private _lifetimeFrames = 0;
    /** 데이터가 전혀 없을 때 UX 힌트 타이머 */
    private _noOutputHintTimer: ReturnType<typeof setTimeout> | null = null;
    /** stop() 호출 후 graceful close 로그 타이머 */
    private _gracefulStopTimer: ReturnType<typeof setTimeout> | null = null;
    /** 첫 batch를 받기 위한 준비 완료 타이머 */
    private _readyForBatchTimer: ReturnType<typeof setTimeout> | null = null;
    private _readyForBatch = false;
    /** 연속 빈 세션 수 (데이터 없이 FIN) — 로그 노이즈 억제용 */
    private _consecutiveEmptySessions = 0;
    /** 연속 무페이로드 시도 수 (Immediate EOF 제외, 실제 이상 후보만 포함) */
    private _consecutiveNoPayloadAttempts = 0;
    /** 이벤트 큐가 비어 있어 payload 없이 즉시 FIN 된 정상 폴링 횟수 */
    private _consecutiveImmediateEofSessions = 0;
    /** 마지막 무페이로드 경고 시각 */
    private _lastUnstableWarnAt = 0;
    /** Start 직전 짧은 실행 로그 손실을 줄이기 위한 빠른 폴링 유지 기한 */
    private _startupPrimeUntil = 0;
    private _startupPrimeReconnectDelayMs = 100;
    private _readyWaiters: Array<(value: boolean) => void> = [];
    private _payloadWaiters: Array<(value: boolean) => void> = [];

    private readonly _onDidConnect = new vscode.EventEmitter<void>();
    private readonly _onDidDisconnect = new vscode.EventEmitter<void>();
    private readonly _onDidReceiveLine = new vscode.EventEmitter<string>();
    private readonly _onDidStatusChanged = new vscode.EventEmitter<RuntimeConsoleStatusSnapshot>();
    /** 세션 최초 데이터 도착 시 + 숫자 상태 이벤트 프레임(<E>N,N</E>) 수신 시 발생.
     *  (기존: 세션당 첫 청크만 → 연결 유지 중 도착한 브레이크/정지 신호를 놓쳐
     *  디버그 감지가 인터벌 폴(최대 수 초)로 밀렸다.) */
    private readonly _onDidReceiveData = new vscode.EventEmitter<void>();

    readonly onDidConnect = this._onDidConnect.event;
    readonly onDidDisconnect = this._onDidDisconnect.event;
    readonly onDidReceiveLine = this._onDidReceiveLine.event;
    readonly onDidStatusChanged = this._onDidStatusChanged.event;
    /** 1403 세션 첫 데이터 + 상태 이벤트 프레임 도착 시 발생. 디버그 즉시 폴 트리거 용도. */
    readonly onDidReceiveData = this._onDidReceiveData.event;

    get isConnected(): boolean { return this._isConnected; }

    getStatusSnapshot(): RuntimeConsoleStatusSnapshot {
        return {
            state: this._state,
            connected: this._isConnected,
            reason: this._lastReason,
            detail: this._lastDetail || undefined,
            noPayloadStreak: this._consecutiveNoPayloadAttempts,
            immediateEofStreak: this._consecutiveImmediateEofSessions,
            lastChangedAt: this._lastChangedAt,
            lastConnectAt: this._lastConnectAttemptAt || undefined,
            lastPayloadAt: this._lastPayloadAt || undefined,
            lastPayloadBytes: this._lastPayloadBytes > 0 ? this._lastPayloadBytes : undefined,
            lastErrorCode: this._lastErrorCode || undefined,
            reconnectAttempt: this._reconnectAttempt > 0 ? this._reconnectAttempt : undefined,
            reconnectDelayMs: this._lastReconnectDelayMs > 0 ? this._lastReconnectDelayMs : undefined,
            connectCount: this._connectStats.total,
            connectsPerMinute: this._connectStats.perMinute(Date.now()),
            watchdogKicks: this._watchdogKicks,
        };
    }

    constructor(output: vscode.OutputChannel, stateOutput?: vscode.OutputChannel) {
        this.output = output;
        this.stateOutput = stateOutput ?? output;
    }

    private updateStatus(
        state: RuntimeConsoleStatusSnapshot['state'],
        reason: string,
        detail = '',
    ): void {
        this._state = state;
        this._lastReason = reason;
        this._lastDetail = detail;
        this._lastChangedAt = Date.now();
        this._onDidStatusChanged.fire(this.getStatusSnapshot());
    }

    private appendStateLine(line: string): void {
        // 상태 로그는 기본적으로 GPL Console(RT payload)와 분리한다.
        // 필요 시 설정으로만 Output 채널 미러링.
        const traffic = getTrafficChannel();
        if (traffic) {
            traffic.appendLine(line);
        }
        appendLiveLog(line);

        const mirrorToOutput = vscode.workspace
            .getConfiguration('gpl.runtimeConsole')
            .get<boolean>('showStateInOutputChannel', false);
        if (mirrorToOutput) {
            this.stateOutput.appendLine(line);
        }
    }

    /** 상태 힌트는 GPL Console(payload 채널)을 더럽히지 않도록 상태/트래픽 로그로만 남긴다. */
    private appendRuntimeHint(message: string): void {
        this.appendStateLine(`[Console][RC1403] HINT=${message}`);
    }

    async waitForPayload(timeoutMs = 1500): Promise<boolean> {
        if (this._sessionDataReceived) { return true; }
        return await new Promise<boolean>((resolve) => {
            // 타임아웃 시 배열에서 자기 자신(wrapped)을 제거한다.
            // (종전에는 push 후 wrapped로 교체한 뒤 filter가 원본 resolver를 찾아 stale waiter가 잔류했다)
            const timeout = setTimeout(() => {
                this._payloadWaiters = this._payloadWaiters.filter(r => r !== wrapped);
                resolve(this._sessionDataReceived);
            }, timeoutMs);
            const wrapped = (value: boolean) => {
                clearTimeout(timeout);
                resolve(value);
            };
            this._payloadWaiters.push(wrapped);
        });
    }

    async waitUntilReady(timeoutMs = 400): Promise<boolean> {
        if (this._readyForBatch) { return true; }
        return await new Promise<boolean>((resolve) => {
            // 위 waitForPayload와 동일한 수정 (stale waiter 잔류 방지).
            const timeout = setTimeout(() => {
                this._readyWaiters = this._readyWaiters.filter(r => r !== wrapped);
                resolve(this._readyForBatch);
            }, timeoutMs);
            const wrapped = (value: boolean) => {
                clearTimeout(timeout);
                resolve(value);
            };
            this._readyWaiters.push(wrapped);
        });
    }

    /**
     * 콘솔 스트리밍 시작.
     *
     * Idempotent: 이미 연결되었거나, 연결 시도 중(소켓 존재) 또는
     * 재연결 대기 중(_reconnectTimer 활성)이면 아무 것도 하지 않는다.
     * → 여러 진입점(배포 후, attach 시점, 사이드바 클릭 등)에서 안전하게 호출 가능.
     *
     * @param delayMs 연결 시도 전 대기 (이전 소켓 TCP 정리 여유)
     */
    start(delayMs = 0, options?: RuntimeConsoleStartOptions): void {
        if (this.disposed) { return; }
        if (this._isConnected) { return; }
        if (this.socket) { return; }
        const forceImmediateReconnect = options?.forceImmediateReconnect === true;
        this._explicitStop = false;
        // 워치독은 스트리밍이 살아 있어야 하는 구간(start~stop)에서만 돈다. 여기서 켜야 "아직 시작한
        // 적 없는" 상태를 멈춤으로 오판해 자동 접속하는 일이 없다.
        this.ensureWatchdog();
        if (this._reconnectTimer) {
            if (forceImmediateReconnect && delayMs <= 0) {
                this.cancelReconnect();
                this.logConsoleTraffic('---', 'RECONNECT timer canceled by forced start()');
                this.connectInternal('start');
            }
            return;
        }
        this._reconnectAttempt = 0;
        // 최대 재시도 도달(RECONNECT_STOPPED)은 사용자 조작인 start()로만 해제한다 (워치독은 존중).
        this._reconnectStopped = false;
        this._watchdogStoppedNoticeLogged = false;
        this._consecutiveEmptySessions = 0;
        this._consecutiveNoPayloadAttempts = 0;
        this._consecutiveImmediateEofSessions = 0;
        this._lastUnstableWarnAt = 0;
        if (delayMs > 0) {
            this.logConsoleTraffic('---', `RECONNECT (start-delayed, ${delayMs}ms, streak=0, reason=start(delayMs))`);
            this.armReconnectTimer(delayMs, 'start');
        } else {
            this.connectInternal('start');
        }
    }

    /**
     * Start 직전/직후의 짧은 로그 burst를 놓치지 않도록 일시적으로 빠른 폴링을 켠다.
     * 평상시 idle 백오프 정책은 유지하고, 지정된 window 안에서만 no-payload 재연결을 당긴다.
     */
    primeForRuntimeStart(options?: RuntimeConsolePrimeOptions): void {
        const windowMs = Math.max(1_000, options?.windowMs ?? 15_000);
        const reconnectDelayMs = Math.max(50, options?.reconnectDelayMs ?? 100);
        this._startupPrimeUntil = Date.now() + windowMs;
        this._startupPrimeReconnectDelayMs = reconnectDelayMs;
        this.logConsoleTraffic('---', `STARTUP_PRIME windowMs=${windowMs} reconnectDelayMs=${reconnectDelayMs}`);
        this.start(0, { forceImmediateReconnect: true });
    }

    /**
     * 콘솔 스트리밍 중지 (명시적). 자동 재연결도 중단.
     * RST 대신 FIN(graceful close)을 사용하여 제어기 TCP 스택 보호.
     */
    stop(): void {
        const wasConnected = this._isConnected;
        this._explicitStop = true;
        this._isConnected = false;
        this.updateStatus('stopped', '사용자 중지', '수동으로 런타임 콘솔 중지');
        const hadReconnectTimer = this._reconnectTimer !== null;
        this.cancelReconnect();
        this.stopWatchdog();
        this.clearReadyState(false);
        this.resolvePayloadWaiters(false);
        if (this._noOutputHintTimer) {
            clearTimeout(this._noOutputHintTimer);
            this._noOutputHintTimer = null;
        }
        if (this._gracefulStopTimer) {
            clearTimeout(this._gracefulStopTimer);
            this._gracefulStopTimer = null;
        }
        if (this.socket) {
            const s = this.socket;
            this.socket = null;
            // 이벤트 리스너 제거 → close 핸들러의 오해 로그 방지
            s.removeAllListeners();
            // 'error' 핸들러를 반드시 다시 등록해야 한다.
            // removeAllListeners 이후 end()/destroy() 중 소켓 에러가 발생하면
            // unhandled 'error' 이벤트가 Node.js 프로세스(=extension host)를 크래시시킨다.
            s.on('error', (err) => {
                this.logConsoleTraffic('---', `STOP error (ignored): ${err.message}`);
            });
            // FIN 기반 종료를 우선한다. (RST 방지)
            // close 이벤트가 늦어질 수 있어 로그만 남기고 강제 destroy는 하지 않는다.
            this._gracefulStopTimer = setTimeout(() => {
                this.logConsoleTraffic('---', `STOP wait over (${GRACEFUL_CLOSE_TIMEOUT_MS}ms), waiting close by FIN path`);
            }, GRACEFUL_CLOSE_TIMEOUT_MS);
            s.end();   // FIN 전송 (graceful close) — error 핸들러 등록 후 호출
            this.logConsoleTraffic('---', 'STOP (graceful FIN)');
        } else if (!this.disposed) {
            // 소켓이 없는 상태의 stop()도 기록한다 (GitHub #22): 종전엔 이 경로가 무기록이어서
            // 사후 분석에서 "재연결이 조용히 멈춘 것"과 "사용자 중지"를 구분할 수 없었다.
            this.logConsoleTraffic('---', `STOP (no socket, reconnectTimerCanceled=${hadReconnectTimer})`);
        }
        if (wasConnected) {
            this._onDidDisconnect.fire();
        }
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
        this._onDidConnect.dispose();
        this._onDidDisconnect.dispose();
        this._onDidReceiveLine.dispose();
        this._onDidStatusChanged.dispose();
        this._onDidReceiveData.dispose();
    }

    /** GPL Traffic 채널에 1403 콘솔 트래픽 로깅 */
    private logConsoleTraffic(direction: '>>>' | '<<<' | '---', message: string): void {
        const ts = formatTrafficTimestamp();
        const line = `[${ts}] [1403] ${direction} ${message}`;
        recordTrafficLine(line); // 연결 유실 사후 스냅샷 링버퍼(GitHub #22)
        const ch = getTrafficChannel();
        if (ch) {
            ch.appendLine(line);
        }
        appendLiveLog(line);
    }

    private cancelReconnect(): void {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._reconnectDueAt = 0;
    }

    /**
     * 재연결 타이머를 한 곳에서 건다 (GitHub #22). 예정 시각(_reconnectDueAt)과 이유를 기록해
     * 워치독이 "타이머가 있는데 발화하지 않는" 상태를 판정하고, 접속 카운터가 이유별로 집계한다.
     * 기존 타이머가 있으면 교체한다(종전에는 덮어써서 고아 타이머가 남을 수 있었다).
     */
    private armReconnectTimer(delayMs: number, reason: ConnectReason): void {
        this.cancelReconnect();
        this._pendingConnectReason = reason;
        this._reconnectDueAt = Date.now() + delayMs;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._reconnectDueAt = 0;
            this.connectInternal(reason);
        }, delayMs);
    }

    // ── 재연결 워치독 (GitHub #22) ─────────────────────────────────────────────

    private ensureWatchdog(): void {
        if (this._watchdogTimer || this.disposed) { return; }
        const timer = setInterval(() => this.runWatchdogTick(), WATCHDOG_INTERVAL_MS);
        timer.unref?.();   // 확장 호스트 종료를 이 타이머가 붙잡지 않도록
        this._watchdogTimer = timer;
    }

    private stopWatchdog(): void {
        if (this._watchdogTimer) {
            clearInterval(this._watchdogTimer);
            this._watchdogTimer = null;
        }
    }

    private runWatchdogTick(): void {
        const now = Date.now();
        const decision = decideWatchdogAction({
            now,
            active: !this.disposed && !this._explicitStop,
            connected: this._isConnected,
            hasSocket: this.socket !== null,
            connectAttemptAt: this._lastConnectAttemptAt,
            connectTimeoutMs: CONNECT_TIMEOUT_MS,
            hasReconnectTimer: this._reconnectTimer !== null,
            reconnectDueAt: this._reconnectDueAt,
            reconnectStopped: this._reconnectStopped,
        });
        switch (decision.action) {
            case 'none':
                return;
            case 'skip-reconnect-stopped':
                // 최대 재시도 도달 상태는 사용자 조작으로만 재개 (기존 의미 유지). 1회만 기록.
                if (!this._watchdogStoppedNoticeLogged) {
                    this._watchdogStoppedNoticeLogged = true;
                    this.logConsoleTraffic('---', 'WATCHDOG: RECONNECT_STOPPED 상태라 개입 안 함 (재개는 사용자 조작: 콘솔 시작)');
                }
                return;
            case 'force-reconnect':
                this._watchdogKicks++;
                this.logConsoleTraffic('---', `WATCHDOG: 재연결 스케줄 부재 감지 → 강제 재연결 (${decision.detail}, kicks=${this._watchdogKicks})`);
                this.appendStateLine(`[Console][RC1403] EVENT=WATCHDOG_KICK action=${decision.action} kicks=${this._watchdogKicks}`);
                this.connectInternal('watchdog');
                return;
            case 'fire-overdue-timer':
                this._watchdogKicks++;
                this.logConsoleTraffic('---', `WATCHDOG: 재연결 타이머 미발화 감지 → 타이머 취소 후 강제 재연결 (${decision.detail}, kicks=${this._watchdogKicks})`);
                this.appendStateLine(`[Console][RC1403] EVENT=WATCHDOG_KICK action=${decision.action} kicks=${this._watchdogKicks}`);
                this.cancelReconnect();
                this.connectInternal('watchdog');
                return;
            case 'destroy-stuck-connecting':
                this._watchdogKicks++;
                this.logConsoleTraffic('---', `WATCHDOG: connecting 고착 감지 → 소켓 destroy 후 재스케줄 (${decision.detail}, kicks=${this._watchdogKicks})`);
                this.appendStateLine(`[Console][RC1403] EVENT=WATCHDOG_KICK action=${decision.action} kicks=${this._watchdogKicks}`);
                this.destroyStuckSocket();
                // 연결 자체가 안 되는 상황이므로 connect-timeout 경로와 같은 지수 백오프로 재스케줄.
                this.scheduleReconnect();
                return;
        }
    }

    /**
     * connect 콜백 없이 'connecting' 이 고착된 소켓을 정리한다. 아직 연결이 성립하지 않은 소켓이므로
     * FIN 을 보낼 상대가 없고(파일 상단 RST 경고는 성립된 세션에 관한 것), destroy 가 유일한 수단.
     * close 핸들러가 재스케줄까지 도달하지 못한 상황을 가정하므로 리스너를 떼고 호출자가 직접 재스케줄한다.
     */
    private destroyStuckSocket(): void {
        const s = this.socket;
        if (!s) { return; }
        this.socket = null;
        this._isConnected = false;
        s.removeAllListeners();
        s.on('error', () => { /* 정리 중 에러는 무시 — unhandled 'error' 로 확장 호스트가 죽지 않게 */ });
        s.destroy();
        this._lastErrorCode = 'WATCHDOG_STUCK_CONNECTING';
        this.updateStatus('connect-failed', '연결 고착 정리', '워치독이 connect 응답 없는 소켓을 정리했습니다');
    }

    private clearReadyState(valueForWaiters: boolean): void {
        this._readyForBatch = false;
        if (this._readyForBatchTimer) {
            clearTimeout(this._readyForBatchTimer);
            this._readyForBatchTimer = null;
        }
        const waiters = this._readyWaiters.splice(0, this._readyWaiters.length);
        for (const waiter of waiters) {
            waiter(valueForWaiters);
        }
    }

    private scheduleReadyForBatch(): void {
        this.clearReadyState(false);
        this._readyForBatchTimer = setTimeout(() => {
            this._readyForBatchTimer = null;
            if (this._isConnected && !this._explicitStop) {
                this._readyForBatch = true;
                const waiters = this._readyWaiters.splice(0, this._readyWaiters.length);
                for (const waiter of waiters) {
                    waiter(true);
                }
                this.logConsoleTraffic('---', 'READY for first batch');
            }
        }, 75);
    }

    private resolvePayloadWaiters(value: boolean): void {
        const waiters = this._payloadWaiters.splice(0, this._payloadWaiters.length);
        for (const waiter of waiters) {
            waiter(value);
        }
    }

    private getTuning(): RuntimeConsoleTuning {
        const cfg = vscode.workspace.getConfiguration('gpl.runtimeConsole');
        const threshold = Math.max(1, cfg.get<number>('noPayloadWarnThreshold', DEFAULT_NO_PAYLOAD_WARN_THRESHOLD));
        const cooldown = Math.max(1_000, cfg.get<number>('unstableWarnCooldownMs', DEFAULT_UNSTABLE_WARN_COOLDOWN_MS));
        const noticeEvery = Math.max(1, cfg.get<number>('emptyNoticeEvery', DEFAULT_EMPTY_NOTICE_EVERY));
        const immediateBase = Math.max(250, cfg.get<number>('immediateEofReconnectBaseMs', DEFAULT_IMMEDIATE_EOF_RECONNECT_BASE_MS));
        const immediateMax = Math.max(immediateBase, cfg.get<number>('immediateEofReconnectMaxMs', DEFAULT_IMMEDIATE_EOF_RECONNECT_MAX_MS));
        const idleBase = Math.max(500, cfg.get<number>('idleReconnectBaseMs', DEFAULT_IDLE_RECONNECT_BASE_MS));
        const idleMax = Math.max(idleBase, cfg.get<number>('idleReconnectMaxMs', DEFAULT_IDLE_RECONNECT_MAX_MS));
        // 설정값이 숫자가 아니면(NaN) setTimeout 이 1ms 로 동작해 churn 이 오히려 심해지므로 기본값으로 되돌린다.
        const batchRaw = cfg.get<number>('batchReconnectDelayMs', DEFAULT_BATCH_RECONNECT_DELAY_MS);
        const batchDelay = Math.max(
            MIN_BATCH_RECONNECT_DELAY_MS,
            Number.isFinite(batchRaw) ? batchRaw : DEFAULT_BATCH_RECONNECT_DELAY_MS,
        );
        return {
            batchReconnectDelayMs: batchDelay,
            noPayloadWarnThreshold: threshold,
            unstableWarnCooldownMs: cooldown,
            emptyNoticeEvery: noticeEvery,
            immediateEofReconnectBaseMs: immediateBase,
            immediateEofReconnectMaxMs: immediateMax,
            idleReconnectBaseMs: idleBase,
            idleReconnectMaxMs: idleMax,
        };
    }

    private shouldEmitNoPayloadNotice(attempt: number, emptyNoticeEvery: number): boolean {
        return attempt <= 1 || attempt % emptyNoticeEvery === 0;
    }

    private computeAdaptiveReconnectDelayMs(attempt: number, baseMs: number, maxMs: number): number {
        const growthStep = Math.max(1, Math.floor((attempt + 1) / 2));
        return Math.min(baseMs * growthStep, maxMs);
    }

    private handleNoPayloadAttempt(reason: string): void {
        const tuning = this.getTuning();
        this._consecutiveNoPayloadAttempts++;
        this._consecutiveImmediateEofSessions = 0;
        if (this.shouldEmitNoPayloadNotice(this._consecutiveNoPayloadAttempts, tuning.emptyNoticeEvery)) {
            this.logConsoleTraffic('---', `NO_PAYLOAD attempt=${this._consecutiveNoPayloadAttempts} (${reason})`);
            this.appendRuntimeHint(`payload 없음: ${reason} (streak=${this._consecutiveNoPayloadAttempts})`);
        }
        if (this._consecutiveNoPayloadAttempts >= tuning.noPayloadWarnThreshold) {
            const now = Date.now();
            if (now - this._lastUnstableWarnAt < tuning.unstableWarnCooldownMs) {
                return;
            }
            this._lastUnstableWarnAt = now;

            const burstCount = this._consecutiveNoPayloadAttempts > tuning.noPayloadWarnThreshold
                ? `${tuning.noPayloadWarnThreshold}+`
                : `${this._consecutiveNoPayloadAttempts}`;
            this.appendStateLine(`[Console][RC1403] STATE=UNSTABLE noPayloadStreak=${burstCount} reason=${reason}`);
            this.appendStateLine('[Console][RC1403] ACTION=CHECK_RUNTIME_CONSOLE_SOURCE');
            this.appendRuntimeHint(`무출력 상태 지속(noPayloadStreak=${burstCount}) — 1403 서비스 상태 및 런타임 출력 경로 점검 권장`);
        }
    }

    private handleImmediateEofPolling(): void {
        const tuning = this.getTuning();
        this._consecutiveImmediateEofSessions++;
        if (this.shouldEmitNoPayloadNotice(this._consecutiveImmediateEofSessions, tuning.emptyNoticeEvery)) {
            this.logConsoleTraffic('---', `POLL_EMPTY immediateEofStreak=${this._consecutiveImmediateEofSessions}`);
            this.appendRuntimeHint(`이벤트 대기 폴링(Immediate EOF, streak=${this._consecutiveImmediateEofSessions})`);
        }
    }

    private handleIdleTimeoutPolling(elapsedMs: number): void {
        const tuning = this.getTuning();
        this._consecutiveImmediateEofSessions = 0;
        if (this.shouldEmitNoPayloadNotice(this._consecutiveEmptySessions, tuning.emptyNoticeEvery)) {
            this.logConsoleTraffic('---', `POLL_IDLE emptySessions=${this._consecutiveEmptySessions} elapsedMs=${elapsedMs}`);
            this.appendRuntimeHint(`이벤트 대기 폴링(Idle timeout, elapsed=${elapsedMs}ms)`);
        }
    }

    private handleEmptyBatchPolling(elapsedMs: number): void {
        const tuning = this.getTuning();
        this._consecutiveImmediateEofSessions = 0;
        if (this.shouldEmitNoPayloadNotice(this._consecutiveEmptySessions, tuning.emptyNoticeEvery)) {
            this.logConsoleTraffic('---', `POLL_EMPTY_BATCH emptySessions=${this._consecutiveEmptySessions} elapsedMs=${elapsedMs}`);
            this.appendRuntimeHint(`이벤트 대기 폴링(Empty batch, elapsed=${elapsedMs}ms)`);
        }
    }

    private emitConsoleLine(line: string, isFrame = false): void {
        if (isFrame) {
            this._sessionFrames++;
            this._lifetimeFrames++;
        }
        const normalized = normalizeConsoleLine(latin1ToUtf8(line));
        if (normalized) {
            this.outputLine(normalized);
        } else if (isFrame) {
            this._sessionFramesSwallowed++;
        }
    }

    /** GPL Console 줄 접두사 모드 (설정, 잘못된 값은 기본값으로 폴백). */
    private getLinePrefixMode(): RuntimeConsoleLinePrefix {
        const raw = vscode.workspace
            .getConfiguration('gpl.runtimeConsole')
            .get<string>('linePrefix', DEFAULT_LINE_PREFIX);
        return (LINE_PREFIX_MODES as readonly string[]).includes(raw)
            ? raw as RuntimeConsoleLinePrefix
            : DEFAULT_LINE_PREFIX;
    }

    /**
     * 정규화가 끝난 한 줄을 출력 채널/리스너로 내보낸다.
     * 접두사(시각/프로젝트)는 출력 채널에만 붙고, 리스너에는 원문 그대로 전달한다.
     */
    private outputLine(normalized: string, project = ''): void {
        if (!normalized) { return; }
        this._sessionLinesEmitted++;
        this.recordIterationValue(normalized);
        this.output.appendLine(formatRuntimeConsoleLine(normalized, project, this.getLinePrefixMode()));
        this._onDidReceiveLine.fire(normalized);
    }

    /**
     * 단일 `<E>...</E>` 프레임 처리.
     * type-3(콘솔 출력) 프레임은 128바이트 청크로 쪼개질 수 있으므로, 메시지가 개행으로
     * 끝나는 청크가 도착할 때까지 이어붙여 한 줄로 완성한다. 그 외 프레임(상태 `<E>1,N</E>` 등)은
     * 기존 경로로 그대로 넘긴다.
     */
    private emitConsoleFrame(frame: string): void {
        const clean = frame.replace(/\0/g, '').replace(/\r/g, '');
        const m = clean.match(/^<E>(\d+),([^<]*)<L>(\d+)<\/L>([\s\S]*)<\/E>$/);
        if (m && m[1] === '3') {
            this._sessionFrames++;
            this._lifetimeFrames++;
            const project = m[2].trim();
            const chunk = m[4];
            // `<L>N</L>` = 청크의 바이트 길이(GDE 캡처 68/68 일치). latin1 문자열이라 length == 바이트 수.
            // 어긋나면 프레임 경계 판정이 잘못됐다는 신호 — 세션당 첫 1회만 상태 로그에 남긴다.
            const declaredLen = Number.parseInt(m[3], 10);
            if (Number.isFinite(declaredLen) && declaredLen !== chunk.length) {
                this._sessionLenMismatch++;
                if (this._sessionLenMismatch === 1) {
                    this.appendStateLine(`[Console][RC1403] WARN=L_MISMATCH declared=${declaredLen} got=${chunk.length}`);
                }
            }
            // 프로젝트가 바뀌면(이론상) 진행 중 버퍼를 먼저 비운다.
            if (this._frameMsgBuf && project && this._frameMsgProject && this._frameMsgProject !== project) {
                this.flushConsoleFrameBuffer();
            }
            if (project) { this._frameMsgProject = project; }
            this._frameMsgBuf += chunk;
            // 개행으로 끝나는 청크 = 한 줄 완성.
            if (chunk.endsWith('\n')) {
                this.flushConsoleFrameBuffer();
            }
            return;
        }
        // type-3가 아닌 프레임: 진행 중인 줄을 먼저 비우고 기존 경로로 처리.
        this.flushConsoleFrameBuffer();
        // 숫자 상태 이벤트(<E>N,N</E>: 브레이크 도달/스텝 완료 등 상태 변화 신호)는
        // 세션 최초 데이터가 아니어도 즉시 폴 트리거를 발사한다. 콘솔 텍스트(type-3)는
        // 여기로 오지 않으므로 출력 폭주가 트리거 폭주로 이어지지 않는다.
        if (/^<E>\d+,\d+<\/E>$/.test(clean.trim())) {
            this._onDidReceiveData.fire();
        }
        this.emitConsoleLine(frame, true);
    }

    /** 재조립 중이던 type-3 메시지를 한 줄로 내보낸다. */
    private flushConsoleFrameBuffer(): void {
        if (!this._frameMsgBuf) { return; }
        // 청크(latin1)를 모두 이어 붙인 뒤에 UTF-8 디코딩 — 128바이트 경계가 글자 중간에 걸려도 온전하다.
        const msg = latin1ToUtf8(this._frameMsgBuf).replace(/\n+$/, '').trim();
        const project = this._frameMsgProject;
        this._frameMsgBuf = '';
        this._frameMsgProject = '';
        if (!msg) {
            this._sessionFramesSwallowed++;
            return;
        }
        this.outputLine(msg, project);
    }

    private processConsoleText(raw: string, flush = false): void {
        this.carry += raw.replace(/\r/g, '');

        let searchFrom = 0;
        while (true) {
            const start = this.carry.indexOf('<E>', searchFrom);
            if (start < 0) { break; }

            if (start > 0) {
                const prefix = this.carry.slice(0, start);
                const rest = this.carry.slice(start);
                this.emitCompletePlainLines(prefix, true);
                this.carry = rest;
                searchFrom = 0;
            }

            const end = this.carry.indexOf('</E>', 3);
            if (end < 0) { break; }

            const frameEnd = end + 4;
            const frame = this.carry.slice(0, frameEnd);
            this.emitConsoleFrame(frame);
            this.carry = this.carry.slice(frameEnd);
            searchFrom = 0;
        }

        // carry가 미완성 프레임(`<E>`로 시작하지만 아직 `</E>` 없음)으로 끝나면,
        // 평문으로 흘리지 않고 그대로 보존한다. (메시지 끝 `\n`이 먼저 도착하고 `</E>`가
        // 다음 세그먼트로 넘어오는 경우, 평문 처리하면 프레임이 깨져서 깨진 줄이 출력된다.)
        const looksLikeOpenFrame =
            this.carry.startsWith('<E>') && this.carry.indexOf('</E>', 3) < 0;
        if (!looksLikeOpenFrame) {
            this.emitCompletePlainLines(this.carry, flush);
        }

        // 세션 종료/플러시 시 재조립 중이던 마지막 줄을 비운다.
        if (flush) {
            this.flushConsoleFrameBuffer();
        }
    }

    private emitCompletePlainLines(text: string, flush: boolean): void {
        if (!text) {
            this.carry = '';
            return;
        }

        const normalizedText = text.replace(/\r/g, '');
        const lines = normalizedText.split('\n');
        const hasTrailingNewline = normalizedText.endsWith('\n');
        const completeCount = hasTrailingNewline ? lines.length : lines.length - 1;

        for (let i = 0; i < completeCount; i++) {
            this.emitConsoleLine(lines[i]);
        }

        const tail = hasTrailingNewline ? '' : lines[lines.length - 1];
        if (flush && tail.trim()) {
            this.emitConsoleLine(tail);
            this.carry = '';
        } else {
            this.carry = tail;
        }
    }

    private recordIterationValue(line: string): void {
        const match = line.match(/\bTEST ITERATION\s+(\d+)\b/i);
        if (!match) { return; }
        const value = Number.parseInt(match[1], 10);
        if (!Number.isFinite(value)) { return; }
        this._sessionIterationValues.push(value);
        if (this._sessionIterationValues.length > 2_000) {
            this._sessionIterationValues.splice(0, this._sessionIterationValues.length - 2_000);
        }
    }

    private computeGcd(a: number, b: number): number {
        let x = Math.abs(a);
        let y = Math.abs(b);
        while (y !== 0) {
            const t = y;
            y = x % y;
            x = t;
        }
        return x;
    }

    private buildIterationGapSummary(): string {
        const values = this._sessionIterationValues;
        if (values.length < 2) { return ''; }

        const diffs: number[] = [];
        for (let i = 1; i < values.length; i++) {
            const diff = values[i] - values[i - 1];
            if (diff > 0) {
                diffs.push(diff);
            }
        }
        if (diffs.length === 0) { return ''; }

        let expectedStep = diffs[0];
        for (let i = 1; i < diffs.length; i++) {
            expectedStep = this.computeGcd(expectedStep, diffs[i]);
        }
        if (expectedStep <= 0) { return ''; }

        const gaps: string[] = [];
        let missingTotal = 0;
        for (let i = 1; i < values.length; i++) {
            const prev = values[i - 1];
            const current = values[i];
            const diff = current - prev;
            if (diff <= expectedStep) { continue; }

            const missing: number[] = [];
            for (let n = prev + expectedStep; n < current; n += expectedStep) {
                missing.push(n);
            }
            if (missing.length === 0) { continue; }

            missingTotal += missing.length;
            const preview = missing.length > 8
                ? `${missing.slice(0, 8).join(',')}...`
                : missing.join(',');
            gaps.push(`${prev}->${current} missing=${preview}`);
            if (gaps.length >= 6) { break; }
        }

        if (missingTotal === 0) { return ''; }
        return `ITERATION_GAP expectedStep=${expectedStep} observed=${values.length} missingTotal=${missingTotal} gaps=${gaps.join(' | ')}`;
    }

    private async scheduleReconnectByPolicy(dataReceived: boolean, hadError: boolean, noPayloadReason?: string): Promise<void> {
        if (this._explicitStop || this.disposed) { return; }

        const tuning = this.getTuning();

        if (dataReceived && !hadError) {
            // 이벤트 배치 정상 완료 → 짧은 지연 뒤 재연결 (다음 배치 대기).
            // 지연은 설정 batchReconnectDelayMs (기본 250ms, 하한 50ms) — 상단 상수 주석 참조 (GitHub #22).
            const delay = tuning.batchReconnectDelayMs;
            this._reconnectAttempt = 0;
            this._lastReconnectDelayMs = delay;
            this.updateStatus('reconnecting', '재연결 대기', `batch complete 후 ${delay}ms 뒤 재연결`);
            this.logConsoleTraffic('---', `RECONNECT (batch-complete, ${delay}ms, streak=0, reason=batch complete)`);
            this.armReconnectTimer(delay, 'batch');
            return;
        }

        if (!hadError) {
            // 빈 세션 (이벤트 없음) → 이유별 적응형 재연결
            this._reconnectAttempt = 0;
            const reason = noPayloadReason || 'No payload';
            const isImmediateEof = reason === 'Immediate EOF';
            const isIdleTimeout = reason === 'Idle timeout';
            const isEmptyPoll = reason === 'Empty batch';
            const startupPrimeActive = Date.now() < this._startupPrimeUntil;
            const reconnectStreak = isImmediateEof
                ? this._consecutiveImmediateEofSessions
                : isEmptyPoll || isIdleTimeout
                ? this._consecutiveEmptySessions
                : this._consecutiveNoPayloadAttempts;
            const idleDelay = startupPrimeActive
                ? this._startupPrimeReconnectDelayMs
                : isIdleTimeout || isEmptyPoll
                ? tuning.idleReconnectBaseMs
                : isImmediateEof
                ? this.computeAdaptiveReconnectDelayMs(
                    reconnectStreak,
                    tuning.immediateEofReconnectBaseMs,
                    tuning.immediateEofReconnectMaxMs,
                )
                : this.computeAdaptiveReconnectDelayMs(
                    reconnectStreak,
                    tuning.idleReconnectBaseMs,
                    tuning.idleReconnectMaxMs,
                );
            this._lastReconnectDelayMs = idleDelay;
            const statusReason = (isImmediateEof || isIdleTimeout || isEmptyPoll) ? '이벤트 대기 폴링' : '재연결 대기';
            const statusDetail = isImmediateEof
                ? `이벤트 큐 비어 있음, ${idleDelay}ms 뒤 폴링`
                : isIdleTimeout
                ? `Idle timeout, ${idleDelay}ms 뒤 폴링`
                : isEmptyPoll
                ? `빈 이벤트 배치, ${idleDelay}ms 뒤 폴링`
                : `${reason} 후 ${idleDelay}ms 뒤 재연결`;
            this.updateStatus('reconnecting', statusReason, statusDetail);
            const policy = startupPrimeActive
                ? 'startup-prime'
                : isImmediateEof
                ? 'immediate-eof-adaptive'
                : (isIdleTimeout ? 'idle-timeout-fixed' : (isEmptyPoll ? 'empty-batch-fixed' : 'idle-adaptive'));
            // 재연결 스케줄 로그는 shouldEmitNoPayloadNotice 게이트 없이 항상 남긴다 (GitHub #22):
            // 2026-08-25 17:45 1403 침묵 사고에서 이 로그가 억제되어 "스케줄이 없었는지 / 타이머가
            // 발화하지 않았는지" 를 사후에 구분할 수 없었다. 스팸 억제는 HINT/STATE(상태 채널) 게이트만 유지.
            this.logConsoleTraffic('---', `RECONNECT (${policy}, ${idleDelay}ms, streak=${reconnectStreak}, reason=${reason})`);
            const connectReason: ConnectReason = startupPrimeActive
                ? 'startup-prime'
                : isImmediateEof
                ? 'immediate-eof'
                : isIdleTimeout
                ? 'idle-timeout'
                : isEmptyPoll
                ? 'empty-batch'
                : 'no-payload';
            this.armReconnectTimer(idleDelay, connectReason);
            return;
        }

        // 에러 → 지수 백오프
        this.scheduleReconnect();
    }

    /**
     * 자동 재연결 스케줄링 (지수 백오프).
     */
    private scheduleReconnect(): void {
        if (this.disposed || this._explicitStop) { return; }
        if (this._reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
            this._lastReconnectDelayMs = 0;
            // 자동 재연결 중단. 워치독도 이 상태를 존중한다 (재개는 사용자 조작 start()만) — GitHub #22.
            this._reconnectStopped = true;
            this.updateStatus('connect-failed', '재연결 중단', `최대 재시도 ${RECONNECT_MAX_ATTEMPTS}회 도달`);
            this.logConsoleTraffic('---', `RECONNECT (stopped, attempts=${RECONNECT_MAX_ATTEMPTS}/${RECONNECT_MAX_ATTEMPTS}, reason=max attempts reached; 재개는 콘솔 시작)`);
            this.appendStateLine(`[Console][RC1403] STATE=RECONNECT_STOPPED attempts=${RECONNECT_MAX_ATTEMPTS}`);
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt),
            RECONNECT_MAX_MS,
        );
        this._reconnectAttempt++;
        this._lastReconnectDelayMs = delay;

        this.updateStatus('reconnecting', '재연결 대기', `delay=${delay}ms attempt=${this._reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS}`);
        this.logConsoleTraffic('---', `RECONNECT (error-backoff, ${delay}ms, attempt=${this._reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS}, reason=${this._lastErrorCode || 'socket error'})`);
        this.appendStateLine(`[Console][RC1403] STATE=RECONNECT_SCHEDULED delayMs=${delay} attempt=${this._reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS}`);
        this.armReconnectTimer(delay, 'error');
    }

    /**
     * @param reason 이 connect 를 유발한 스케줄 이유 (접속 카운터 집계·CONNECT 로그용).
     *               생략 시 armReconnectTimer 가 기록한 값.
     */
    private connectInternal(reason: ConnectReason = this._pendingConnectReason): void {
        if (this.disposed) { return; }
        if (this._explicitStop) {
            // 타이머/워치독이 stop() 뒤에 발화한 경우 — 재연결하지 않되 기록은 남긴다 (GitHub #22 사후 분석용).
            this.logConsoleTraffic('---', `CONNECT skipped (explicit stop, reason=${reason})`);
            return;
        }
        if (this.socket) {
            // 소켓이 이미 있는데 또 connect 하면 소켓이 이중으로 남는다. 워치독/타이머 경합 방어.
            this.logConsoleTraffic('---', `CONNECT skipped (socket already exists, reason=${reason})`);
            return;
        }

        const cfg = getControllerConfig();
        const socket = new net.Socket();
        this.socket = socket;
        this._lastError = null;
        this._lastErrorCode = '';
        this._lastConnectAttemptAt = Date.now();
        this._lastReconnectDelayMs = 0;
        this._pendingConnectReason = 'start';
        // 접속 카운터 (GitHub #22 제안 1): 누적/분당 접속 수를 50회마다 요약해 자원 고갈 가설을 검증할 수 있게 한다.
        this._connectStats.record(reason, this._lastConnectAttemptAt);
        if (this._connectStats.shouldEmitSummary()) {
            this.logConsoleTraffic('---', this._connectStats.formatSummary(this._lastConnectAttemptAt));
        }
        this.updateStatus('connecting', '연결 시도 중', `${cfg.ip}:${cfg.consolePort}`);

        this.logConsoleTraffic('>>>', `CONNECT ${cfg.ip}:${cfg.consolePort} (#${this._connectStats.total}, ${reason})`);

        const connectTimer = setTimeout(() => {
            if (!this._isConnected && this.socket === socket) {
                this.logConsoleTraffic('---', `CONNECT timeout (${CONNECT_TIMEOUT_MS}ms) — destroy, 재연결 경로로 위임`);
                socket.destroy(new Error('connect timeout'));
            }
        }, CONNECT_TIMEOUT_MS);

        const connectOptions = cfg.preferIPv4
            ? { host: cfg.ip, port: cfg.consolePort, family: 4 }
            : { host: cfg.ip, port: cfg.consolePort };

        socket.connect(connectOptions, () => {
            clearTimeout(connectTimer);
            this._isConnected = true;
            this._connectedAt = Date.now();
            this.carry = '';
            this._frameMsgBuf = '';
            this._frameMsgProject = '';
            this._sessionDataReceived = false;
            this._sessionRxBytes = 0;
            this._sessionFrames = 0;
            this._sessionLenMismatch = 0;
            this._sessionFramesSwallowed = 0;
            this._sessionLinesEmitted = 0;
            this._sessionIterationValues = [];
            socket.setKeepAlive(true, 5_000);  // 5초 간격 TCP keepalive
            socket.setNoDelay(true);
            this.scheduleReadyForBatch();
            this.updateStatus('connected', 'Connected', `${cfg.ip}:${cfg.consolePort}`);

            if (this._noOutputHintTimer) {
                clearTimeout(this._noOutputHintTimer);
                this._noOutputHintTimer = null;
            }
            this._noOutputHintTimer = setTimeout(() => {
                // 연결은 정상인데 런타임 출력이 없는 경우(Idle/무출력)를 장애와 분리해서 안내
                if (this._isConnected && !this._sessionDataReceived) {
                    this.updateStatus('connected-no-payload', 'payload 없음', '소켓은 연결됐지만 아직 payload가 없다');
                    this.appendStateLine('[Console][RC1403] STATE=CONNECTED_NO_PAYLOAD');
                    this.logConsoleTraffic('---', 'CONNECTED no payload yet (idle-or-unstable)');
                    this.appendRuntimeHint('연결됨, payload 대기 중 (컨트롤러 idle 가능)');
                }
            }, NO_OUTPUT_HINT_MS);

            if (this._consecutiveEmptySessions === 0) {
                this.appendStateLine(`[Console][RC1403] STATE=CONNECTED endpoint=${cfg.ip}:${cfg.consolePort}`);
            }
            this.logConsoleTraffic('---', `CONNECTED (local ${socket.localAddress}:${socket.localPort}, idle=${this._consecutiveEmptySessions})`);
            this._onDidConnect.fire();
        });

        socket.on('data', (data: Buffer) => {
            const wasWaitingPayload = !this._sessionDataReceived;
            this._sessionDataReceived = true;
            this._consecutiveNoPayloadAttempts = 0;
            this._consecutiveImmediateEofSessions = 0;
            this._lastPayloadAt = Date.now();
            this._lastPayloadBytes = data.length;
            this.resolvePayloadWaiters(true);
            // 세션에서 처음 데이터가 도착하면 즉시 폴 트리거 (디버그 세션용)
            if (wasWaitingPayload) {
                this._onDidReceiveData.fire();
            }
            if (this._noOutputHintTimer) {
                clearTimeout(this._noOutputHintTimer);
                this._noOutputHintTimer = null;
            }
            // 바이트 보존(latin1)으로 문자열화 — 프레임/청크 경계는 ASCII 마커라 그대로 찾을 수 있고,
            // UTF-8 디코딩은 청크를 이어 붙인 완성 메시지 단위에서만 한다(latin1ToUtf8). 종전 'ascii'는
            // 상위 비트를 버려 한글 콘솔 출력이 복구 불가능하게 깨졌다(2026-08-28 GDE 캡처 판독).
            const raw = data.toString('latin1');
            this._sessionRxBytes += data.length;
            this._lifetimeRxBytes += data.length;
            this.logConsoleTraffic('<<<', latin1ToUtf8(raw).replace(/[\r\n]+/g, '\\n'));
            if (wasWaitingPayload) {
                this.updateStatus('connected', 'Connected', `payload ${data.length} bytes 수신`);
            }
            this.processConsoleText(raw);
        });

        socket.on('end', () => {
            // 서버가 FIN(쓰기 종료)을 보냄 — close 전에 발생
            this.processConsoleText('', true);
            const elapsed = this._connectedAt > 0 ? Date.now() - this._connectedAt : 0;
            this.logConsoleTraffic('---', `END (server sent FIN, connected ${elapsed}ms)`);
        });

        socket.on('error', (err: Error) => {
            this._lastError = err;
            this._lastErrorCode = ((err as any).code as string | undefined) ?? '';
            this.logConsoleTraffic('---', `ERROR: ${err.message} (${(err as any).code ?? 'no code'})`);
            this.appendStateLine(`[Console][RC1403] EVENT=SOCKET_ERROR code=${(err as any).code ?? 'NA'} message=${err.message}`);
        });

        socket.on('close', (hadError: boolean) => {
            clearTimeout(connectTimer);
            this.socket = null;
            // 'end' 없이 에러로 닫힌 경우에도 마지막 미완 라인(carry)을 flush한다 (유실 방지).
            try { this.processConsoleText('', true); } catch { /* noop */ }
            if (!this._sessionDataReceived) {
                this.resolvePayloadWaiters(false);
            }
            if (this._gracefulStopTimer) {
                clearTimeout(this._gracefulStopTimer);
                this._gracefulStopTimer = null;
            }
            this.clearReadyState(false);
            if (this._noOutputHintTimer) {
                clearTimeout(this._noOutputHintTimer);
                this._noOutputHintTimer = null;
            }
            const dataReceived = this._sessionDataReceived;
            let noPayloadReason: string | undefined;
            if (this._isConnected) {
                this._isConnected = false;
                const elapsed = Date.now() - this._connectedAt;

                if (hadError) {
                    // 에러로 인한 종료
                    const errCode = (this._lastError as any)?.code as string | undefined;
                    if (errCode === 'ECONNREFUSED') {
                        this.updateStatus('socket-error', '연결 거부', '1403 포트가 연결을 거부했습니다 (ECONNREFUSED)');
                    } else {
                        this.updateStatus('socket-error', '소켓 에러', this._lastError?.message ?? '알 수 없는 소켓 에러');
                    }
                    this.appendStateLine(`[Console][RC1403] STATE=DISCONNECTED mode=error elapsedMs=${elapsed} message=${this._lastError?.message ?? 'unknown'}`);
                    if (!dataReceived) {
                        if (errCode === 'ECONNREFUSED') {
                            this.handleNoPayloadAttempt('Connection refused');
                        } else {
                            this.handleNoPayloadAttempt('Socket error (no payload)');
                        }
                    }
                    this._consecutiveEmptySessions = 0;
                    this._consecutiveImmediateEofSessions = 0;
                } else if (dataReceived) {
                    // 데이터 수신 후 정상 종료 (이벤트 배치 완료)
                    this.updateStatus('batch-complete', '배치 완료 후 재연결', '이벤트 배치 수신 후 서버가 FIN으로 세션 종료');
                    this.appendStateLine(`[Console][RC1403] STATE=DISCONNECTED mode=batch_complete elapsedMs=${elapsed}`);
                    this._consecutiveEmptySessions = 0;
                    this._consecutiveImmediateEofSessions = 0;
                } else {
                    // 빈 세션 — 이벤트 없이 FIN
                    this._consecutiveEmptySessions++;
                    const reason = elapsed <= IMMEDIATE_EOF_SESSION_MS
                        ? 'Immediate EOF'
                        : (elapsed >= IDLE_TIMEOUT_SESSION_MS ? 'Idle timeout' : 'Empty batch');
                    noPayloadReason = reason;
                    const isImmediateEof = reason === 'Immediate EOF';
                    const isIdleTimeout = reason === 'Idle timeout';
                    const isEmptyPoll = reason === 'Empty batch';
                    if (isImmediateEof) {
                        this.handleImmediateEofPolling();
                    } else if (isIdleTimeout) {
                        this.handleIdleTimeoutPolling(elapsed);
                    } else if (isEmptyPoll) {
                        this.handleEmptyBatchPolling(elapsed);
                    } else {
                        this.handleNoPayloadAttempt(reason);
                    }
                    this.updateStatus(
                        (isImmediateEof || isIdleTimeout || isEmptyPoll) ? 'polling' : 'no-payload',
                        (isImmediateEof || isIdleTimeout || isEmptyPoll) ? '이벤트 대기 폴링' : '빈 세션',
                        isImmediateEof
                        ? '이벤트 큐가 비어 있어 payload 없이 세션이 종료되었습니다'
                        : isIdleTimeout
                        ? 'idle timeout으로 payload 없이 세션이 종료되었습니다 (정상 폴링 가능)'
                        : isEmptyPoll
                        ? '빈 이벤트 배치로 payload 없이 세션이 종료되었습니다 (정상 폴링 가능)'
                        : '연결은 되었지만 payload 없이 세션이 종료되었습니다',
                    );
                    const tuning = this.getTuning();
                    const streak = isImmediateEof
                        ? this._consecutiveImmediateEofSessions
                        : ((isIdleTimeout || isEmptyPoll) ? this._consecutiveEmptySessions : this._consecutiveNoPayloadAttempts);
                    if (this.shouldEmitNoPayloadNotice(streak, tuning.emptyNoticeEvery)) {
                        const mode = isImmediateEof
                            ? 'poll_empty'
                            : (isIdleTimeout ? 'poll_idle' : (isEmptyPoll ? 'poll_empty_batch' : 'no_payload'));
                        this.appendStateLine(`[Console][RC1403] STATE=DISCONNECTED mode=${mode} reason=${reason} payloadBytes=0 elapsedMs=${elapsed} streak=${streak}`);
                    }
                }

                const iterationGapSummary = this.buildIterationGapSummary();
                if (iterationGapSummary) {
                    this.logConsoleTraffic('---', iterationGapSummary);
                    this.appendStateLine(`[Console][RC1403] ${iterationGapSummary}`);
                }

                this.logConsoleTraffic(
                    '---',
                    `CLOSE (${elapsed}ms, hadError=${hadError}, data=${dataReceived}, empty=${this._consecutiveEmptySessions}, `
                    + `rxBytes=${this._sessionRxBytes}, rawFrames=${this._sessionFrames}, emittedLines=${this._sessionLinesEmitted}, `
                    + `swallowed=${this._sessionFramesSwallowed}, `
                    + `lifetimeBytes=${this._lifetimeRxBytes}, lifetimeFrames=${this._lifetimeFrames}, `
                    + `connects=${this._connectStats.total})`,
                );
                this._onDidDisconnect.fire();
            } else {
                // connect 콜백 전에 close 된 경우
                const errMsg = this._lastError?.message ?? 'unknown';
                const errCode = (this._lastError as any)?.code as string | undefined;
                this.logConsoleTraffic('---', `CLOSE (connect failed: ${errMsg}, connects=${this._connectStats.total})`);
                if (errCode === 'ECONNREFUSED') {
                    this.updateStatus('connect-failed', '연결 거부', '1403 포트가 연결을 거부했습니다 (ECONNREFUSED)');
                    this.appendStateLine('[Console][RC1403] STATE=CONNECT_FAILED reason=ECONNREFUSED');
                    this.handleNoPayloadAttempt('Connection refused');
                } else {
                    this.updateStatus('connect-failed', '연결 실패', errMsg);
                    this.appendStateLine(`[Console][RC1403] STATE=CONNECT_FAILED reason=${errMsg}`);
                    this.handleNoPayloadAttempt('Connect error');
                }
                this._consecutiveEmptySessions = 0;
                this._consecutiveImmediateEofSessions = 0;
            }
            this._lastError = null;

            // 명시적 stop이 아닌 연결 종료 → 정책 기반 재연결
            void this.scheduleReconnectByPolicy(dataReceived, hadError, noPayloadReason);
        });
    }
}
