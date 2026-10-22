/**
 * Start 뒤 메인 쓰레드 감시 — "Upload & Start 는 성공으로 끝났는데 프로그램은 바로 Error 로 멈췄다" 를
 * 배포 결과에 싣는다(2026-10-19 Sample Prep 보고, ai-handoff §1-EU).
 *
 * 왜: 배포의 ERROR_CHECK 단계는 Start 직후 `ErrorLog` 스냅샷만 봤다. 기동 수 초 뒤에 나는 런타임 에러
 * (-1509 Invalid data index 등)는 거기 잡히지 않고 1403 런타임 콘솔에만 흘러, 사용자는 로그를 들여다보고서야
 * 알아챘다(작업 기록은 success:true·compileErrorCount 0). 여기서는 Start 뒤 짧은 창 동안 읽기 전용
 * `Show Thread -web` 로 메인(프로젝트 이름) 쓰레드를 보고, Error 면 `Show Thread <이름>` 상세로 코드·메시지·위치를 읽는다.
 *
 * vscode 무의존. 전송·로그·대기는 threadStop.ts 와 같은 `ThreadStopIo` 로 주입받는다(절차 API 방향 §1-DD).
 * 모션에 영향 없음 — 보내는 명령은 조회뿐이다.
 */
import { parseThreadList, parseThreadDetail, SHOW_THREAD_LIST_CMD, ThreadInfo, ThreadDetailInfo } from './responseParser';
import type { ThreadStopIo } from './threadStop';

/** Start 뒤 메인 쓰레드가 Error 로 멈춘 사실 — 배포 결과(`DeployResult.runtimeError`)와 작업 기록에 실린다. */
export interface PostStartRuntimeError {
    threadName: string;
    statusCode?: number;
    statusMessage?: string;
    file?: string;
    line?: number;
    procedure?: string;
    /** 코드·메시지에서 유추한 원인 힌트(추정임을 문구에 포함). */
    hint?: string;
}

export type PostStartWatchOutcome =
    /** 메인 쓰레드가 Error 로 멈췄다. */
    | { kind: 'error'; error: PostStartRuntimeError; elapsedMs: number }
    /** 감시 창이 끝날 때까지 Error 가 아니었다(Running/Paused 등). */
    | { kind: 'running'; state: string; elapsedMs: number }
    /** 메인 쓰레드가 Idle/Stopped 가 됐거나 목록에서 사라졌다 — 프로그램이 끝났다. */
    | { kind: 'ended'; state: string; elapsedMs: number }
    /** 감시 창 안에 메인 쓰레드를 목록에서 한 번도 보지 못했다(이미 끝났거나 이름이 다름). */
    | { kind: 'not-seen'; elapsedMs: number }
    /** `Show Thread` 응답을 받지 못해 확인하지 못했다. */
    | { kind: 'unconfirmed'; elapsedMs: number }
    | { kind: 'cancelled'; elapsedMs: number };

export interface PostStartWatchOptions {
    /** 감시 창(기본 5000ms). 0 이면 지금 상태만 한 번 본다. */
    windowMs?: number;
    /** 폴링 간격(기본 1000ms, 하한 100ms). */
    pollIntervalMs?: number;
    /** 로그 줄 접두(배포 트레이스의 `'│ '`). */
    logPrefix?: string;
}

/**
 * 코드·메시지에서 유추한 원인 힌트. 확정이 아니라 "확인할 곳" 이므로 문구에 (추정) 을 붙인다.
 * -1509 *Invalid data index* 는 존재하지 않는 로봇/축 번호의 파라미터(DataID)를 읽을 때도 난다 —
 * 2026-10-19 실측: 로봇 1대·3축 제어기에서 96Ch 장비용 프로젝트가 로봇 2 의 DataID 2803 을 읽다 멈췄다.
 */
export function describeRuntimeErrorHint(statusCode?: number, statusMessage?: string): string | undefined {
    if (statusCode === -1509 || /invalid data index/i.test(statusMessage ?? '')) {
        return '존재하지 않는 로봇/축 번호의 파라미터(DataID)를 읽을 때도 나는 코드다 — 이 프로젝트가 가정한 로봇 수·축 수가 제어기 설정과 같은지 확인할 것(추정)';
    }
    return undefined;
}

/** 사용자 문구 한 줄: `AntiBodyR2 Error — -1509 *Invalid data index*: 2803 @ _robot_ExtraModuleHandler.gpl:484 (setUseAutoHome)`. */
export function formatRuntimeError(e: PostStartRuntimeError): string {
    const code = typeof e.statusCode === 'number' ? `${e.statusCode}` : '';
    const message = (e.statusMessage ?? '').trim();
    const what = [code, message].filter(Boolean).join(' ');
    const loc = e.file ? ` @ ${e.file}${e.line ? `:${e.line}` : ''}${e.procedure ? ` (${e.procedure})` : ''}` : '';
    return `${e.threadName} Error${what ? ` — ${what}` : ''}${loc}`;
}

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function parseStatusCode(raw: string | undefined): number | undefined {
    const n = Number.parseInt((raw ?? '').trim(), 10);
    return Number.isNaN(n) ? undefined : n;
}

async function readRuntimeError(io: ThreadStopIo, main: ThreadInfo): Promise<PostStartRuntimeError> {
    let detail: ThreadDetailInfo | null = null;
    try {
        const resp = await io.send(`Show Thread ${main.name}`);
        if (resp && resp.statusComplete !== false) { detail = parseThreadDetail(resp.raw); }
    } catch {
        detail = null;
    }
    const statusCode = detail && detail.statusCode !== 0 ? detail.statusCode : (parseStatusCode(main.lastStatus) ?? detail?.statusCode);
    const statusMessage = detail?.statusMessage || undefined;
    const file = detail?.file || main.file || undefined;
    const line = (detail?.fileLine || main.fileLine) || undefined;
    const procedure = detail?.process || main.func || undefined;
    return { threadName: main.name, statusCode, statusMessage, file, line, procedure, hint: describeRuntimeErrorHint(statusCode, statusMessage) };
}

/**
 * Start 뒤 `windowMs` 동안 메인 쓰레드(이름 = 프로젝트 이름)를 폴링한다. Error 를 보면 즉시 상세를 읽고 끝낸다.
 * 메인 쓰레드가 Idle/Stopped 가 되거나 목록에서 사라지면 "끝났다" 로 보고 더 기다리지 않는다.
 */
export async function watchMainThreadAfterStart(
    io: ThreadStopIo,
    projectName: string,
    opts?: PostStartWatchOptions,
): Promise<PostStartWatchOutcome> {
    const windowMs = Math.max(0, opts?.windowMs ?? 5000);
    const pollIntervalMs = Math.max(100, opts?.pollIntervalMs ?? 1000);
    const prefix = opts?.logPrefix ?? '';
    const now = io.now ?? Date.now;
    const startedAt = now();
    const deadline = startedAt + windowMs;
    const elapsed = () => now() - startedAt;
    let seen: ThreadInfo | undefined;

    for (;;) {
        if (io.isCancelled?.()) { return { kind: 'cancelled', elapsedMs: elapsed() }; }
        let resp;
        try { resp = await io.send(SHOW_THREAD_LIST_CMD); } catch { resp = null; }
        if (!resp || resp.statusComplete === false) {
            io.log(`${prefix}⚠ Show Thread 무응답 — Start 뒤 메인 쓰레드 상태를 확인하지 못했다`);
            return { kind: 'unconfirmed', elapsedMs: elapsed() };
        }
        const main = parseThreadList(resp.raw).find(t => sameName(t.name, projectName));
        if (main) {
            if (main.state === 'Error') {
                const error = await readRuntimeError(io, main);
                io.log(`${prefix}✘ Start 뒤 메인 쓰레드가 Error 로 멈췄다: ${formatRuntimeError(error)}`);
                return { kind: 'error', error, elapsedMs: elapsed() };
            }
            if (main.state === 'Idle' || main.state === 'Stopped') {
                io.log(`${prefix}✔ 메인 쓰레드 '${main.name}' ${main.state} — 프로그램이 끝났다 (${(elapsed() / 1000).toFixed(1)}s)`);
                return { kind: 'ended', state: main.state, elapsedMs: elapsed() };
            }
            seen = main;
        } else if (seen) {
            io.log(`${prefix}✔ 메인 쓰레드 '${seen.name}' 가 목록에서 사라졌다 — 프로그램이 끝났다 (마지막 상태 ${seen.state})`);
            return { kind: 'ended', state: seen.state, elapsedMs: elapsed() };
        }
        const remaining = deadline - now();
        if (remaining <= 0) { break; }
        await io.sleep(Math.min(pollIntervalMs, remaining));
    }

    if (!seen) {
        io.log(`${prefix}… 메인 쓰레드 '${projectName}' 를 ${windowMs}ms 안에 목록에서 보지 못했다(이미 끝났거나 쓰레드 이름이 프로젝트 이름과 다름)`);
        return { kind: 'not-seen', elapsedMs: elapsed() };
    }
    io.log(`${prefix}✔ 메인 쓰레드 '${seen.name}' ${seen.state} — ${windowMs}ms 감시 동안 Error 없음`);
    return { kind: 'running', state: seen.state, elapsedMs: elapsed() };
}
