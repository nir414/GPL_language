/**
 * 프로젝트 조작 명령의 단일 정본 — Compile / Load / Unload / Start (vscode 무의존, 주입형 IO).
 *
 * ## 왜 이 모듈이 있는가
 *
 * `threadStop.ts`(쓰레드 정지)와 같은 이유다. 제어기의 원시 명령은 **안전한 단위가 아니고**, 각 동작은
 * *전송 + STATUS 판정 + 예외 상태 복구 + 결과 해석* 절차 전체다. 그 절차가 호출부마다 다시 조립되면서
 * 같은 일이 경로에 따라 다르게 동작하고 있었다(2026-09-10 조사, §1-DE):
 *
 * - **Compile**: 배포 경로는 일시적 STATUS(`-742/-746/-752`)를 1회 재시도하고 후보 이름을 순회하는데,
 *   FTP Run 경로는 `-746` 하나만, 그것도 `Stop -all` 을 동원하는 무거운 경로로 처리했다.
 * - **Load**: 배포 경로에만 "응답이 HTTP 면 콘솔이 아니라 웹서버가 답한 것 → 즉시 중단" 가드가 있었다.
 * - **Unload**: 한쪽은 상태 코드 헬퍼(`isProjectNotLoaded`), 다른 쪽은 숫자 리터럴(`-508 || -743`)이었다.
 * - **Start**: 한쪽은 `buildStartCommand`(문서 구문 + `-event`), 다른 쪽은 `` `Start ${name}` `` 손조립이라
 *   그 경로로 시작한 실행만 1403 이벤트를 받지 못했다.
 *
 * 그래서 절차를 여기 하나로 모으고, 호출부는 전송 수단(IO)과 **정책(재시도 여부·복구 허용 여부)** 만 정한다.
 * 결과는 불리언이 아니라 구조화해서 돌려주므로, 진단(Problems) 표시·모달 확인 같은 UI 는 호출부가 그대로 맡는다.
 *
 * 단위 테스트: `src/test/projectCommands.test.ts` (가짜 IO 로 시나리오를 재현한다).
 */

import { buildStartCommand, commandRunsCompiler, StartCommandOptions } from './startCommand';
import type { CommandResponseMeta } from './consoleSocket';
import {
    isProjectAlreadyLoaded,
    isProjectNotLoaded,
    isTransientCompileStatus,
} from './controllerStatusCodes';
import {
    CompileError,
    NO_STATUS_CODE,
    isControllerNonBlockingStatus,
    parseCompileErrors,
    parseStatus,
} from './responseParser';

/** IO 가 돌려주는 1402 응답. `threadStop.ThreadStopResponse` 와 같은 모양이다. */
export interface ProjectCommandResponse {
    raw: string;
    /** 응답 메타(잘림 여부 등) — 로그·결과 보고에 그대로 실린다. 전송 계층이 주지 못하면 생략한다. */
    meta?: CommandResponseMeta;
}

/**
 * 전송·로그를 호출부가 주입한다.
 *
 * `send` 의 `forCompile` 은 "종결자 `</STATUS>` 까지 기다리고 상한을 넉넉히" 라는 뜻이다 — 컴파일은 pass 사이에
 * 수 초간 침묵하므로 idle 기준으로 끊으면 응답이 잘려 **거짓 성공**이 난다(§0.2). 전송 계층마다 그 옵션을
 * 지정하는 방법이 달라 플래그로 넘긴다.
 */
export interface ProjectCommandIo {
    send(command: string, opts?: { forCompile?: boolean }): Promise<ProjectCommandResponse>;
    log(line: string): void;
}

/** 명령 한 건의 STATUS 판정 결과. */
export interface StatusOutcome {
    /** STATUS 0 또는 비차단 STATUS(환경 경고)면 true. */
    ok: boolean;
    statusCode: number;
    message: string;
    raw: string;
}

/** 실패 사유 — 호출부가 사용자 문구·`failedPhase` 로 옮겨 쓴다. */
export interface CommandFailure {
    command: string;
    code: number;
    message: string;
    raw: string;
}

/** 로그 접두(배포 트레이스는 `'│ '`). */
export interface ProjectCommandOptions {
    logPrefix?: string;
}

function prefixOf(opts?: ProjectCommandOptions): string {
    return opts?.logPrefix ?? '';
}

/** 원문 로그 한 줄 — 길면 자른다(트레이스가 응답 본문으로 뒤덮이지 않게). */
export function rawPreview(raw: string): string {
    const compact = (raw ?? '').replace(/\r/g, '').replace(/\n+/g, ' | ').trim();
    return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
}

/**
 * 명령 전송 + STATUS 판정. 예외는 던지지 않고 결과로 돌려준다
 * (예외 메시지 안에 STATUS 가 실려 오는 전송 계층이 있어 그것도 파싱한다).
 */
export async function runStatusCommand(
    io: ProjectCommandIo,
    command: string,
    opts?: { forCompile?: boolean },
): Promise<StatusOutcome> {
    try {
        const resp = await io.send(command, opts);
        const status = parseStatus(resp.raw);
        return {
            ok: status.code === 0 || isControllerNonBlockingStatus(status.code),
            statusCode: status.code,
            message: status.message,
            raw: resp.raw,
        };
    } catch (e: any) {
        const raw = e?.message || String(e);
        const status = parseStatus(raw);
        return { ok: false, statusCode: status.code, message: status.message, raw };
    }
}

// ── Load ───────────────────────────────────────────────────────

export interface LoadOutcome {
    ok: boolean;
    /** 이미 로드돼 있어 명령을 건너뛴 경우(성공으로 본다). */
    alreadyLoaded?: boolean;
    /**
     * 응답이 HTTP 였다 — 명령이 콘솔(1402)이 아니라 제어기 웹서버(GoAhead)에 닿았다는 뜻으로,
     * 제어기 이상 징후다(2026-07-03 무응답 사례, §1-F). 재시도로 더 자극하지 말고 중단할 것.
     */
    httpResponse?: boolean;
    failure?: CommandFailure;
}

/** `Load <path>` — 이미 로드된 경우와 HTTP 응답(제어기 이상)을 구분해 돌려준다. */
export async function loadProject(
    io: ProjectCommandIo,
    loadPath: string,
    opts?: ProjectCommandOptions,
): Promise<LoadOutcome> {
    const p = prefixOf(opts);
    const command = `Load ${loadPath}`;
    io.log(`${p}CMD ${command}`);
    const load = await runStatusCommand(io, command);
    io.log(`${p}RAW ${rawPreview(load.raw) || '(empty)'}`);

    if ((load.raw || '').trimStart().startsWith('HTTP/')) {
        io.log(`${p}✘ HTTP 응답 감지 — 콘솔이 아닌 웹서버가 응답함. 제어기 상태 이상 가능성, 즉시 중단.`);
        io.log(`${p}  → 제어기 웹 UI/GDE 접속 가능 여부를 확인하고, 필요 시 재부팅 후 다시 시도하세요.`);
        return {
            ok: false,
            httpResponse: true,
            failure: {
                command,
                code: load.statusCode,
                message: 'HTTP response detected on 1402 (controller may be unhealthy)',
                raw: load.raw,
            },
        };
    }
    if (load.ok) {
        io.log(`${p}✔ Load success: ${loadPath}`);
        return { ok: true };
    }
    if (isProjectAlreadyLoaded(load.statusCode)) {
        io.log(`${p}✔ Load skipped: already loaded (${loadPath})`);
        return { ok: true, alreadyLoaded: true };
    }
    io.log(`${p}✘ Load failed: STATUS ${load.statusCode}: ${load.message || 'Unknown error'}`);
    return {
        ok: false,
        failure: { command, code: load.statusCode, message: load.message || 'Unknown error', raw: load.raw },
    };
}

// ── Unload ─────────────────────────────────────────────────────

export interface UnloadOutcome {
    ok: boolean;
    /** 로드돼 있지 않아 할 일이 없었다(성공으로 본다). */
    notLoaded?: boolean;
    /**
     * `-750`(*Invalid when thread active*) — 쓰레드가 도는 동안에는 Unload 가 원천적으로 불가하다.
     * 호출부는 이 경우 Load 를 강행하지 말고 중단해야 한다(이전 로드본을 컴파일하게 된다, §1-F).
     */
    blockedByActiveThread?: boolean;
    failure?: CommandFailure;
}

/** 쓰레드 실행 중 Unload 거부 STATUS. */
export const UNLOAD_BLOCKED_BY_THREAD = -750;

/** `Unload <project>` — "로드 안 됨"과 "쓰레드 실행 중 거부"를 구분해 돌려준다. */
export async function unloadProject(
    io: ProjectCommandIo,
    projectName: string,
    opts?: ProjectCommandOptions,
): Promise<UnloadOutcome> {
    const p = prefixOf(opts);
    const command = `Unload ${projectName}`;
    io.log(`${p}CMD ${command}`);
    const unload = await runStatusCommand(io, command);
    io.log(`${p}RAW ${rawPreview(unload.raw) || '(empty)'}`);

    if (unload.ok) {
        io.log(`${p}✔ Unload success: ${projectName}`);
        return { ok: true };
    }
    if (isProjectNotLoaded(unload.statusCode)) {
        io.log(`${p}✔ Unload skipped: project not loaded (${projectName})`);
        return { ok: true, notLoaded: true };
    }
    io.log(`${p}✘ Unload failed: STATUS ${unload.statusCode}: ${unload.message || 'Unknown error'}`);
    return {
        ok: false,
        blockedByActiveThread: unload.statusCode === UNLOAD_BLOCKED_BY_THREAD,
        failure: { command, code: unload.statusCode, message: unload.message || 'Unknown error', raw: unload.raw },
    };
}

// ── Compile ────────────────────────────────────────────────────

/** Compile 시도 한 건의 기록 — 호출부가 결과 보고에 그대로 싣는다. */
export interface CompileAttempt {
    command: string;
    ok: boolean;
    statusCode: number;
    message: string;
    errors: CompileError[];
    raw: string;
    meta?: CommandResponseMeta;
    /** 판정 근거 한 줄(STATUS 미수신 등). */
    note?: string;
}

export interface CompileOutcome {
    ok: boolean;
    /** 성공한 후보 이름(여러 이름을 시도할 수 있다 — `.gpr` 프로젝트명 / 폴더명 / `/GPL` 폴더명). */
    projectName?: string;
    /** 시도 전부(실패 보고·재현용). */
    attempts: CompileAttempt[];
    /** 마지막 시도의 컴파일 에러 — 호출부가 Problems 진단으로 표시한다. */
    errors: CompileError[];
    failure?: CommandFailure;
}

/**
 * `Compile <project>` 한 번. **성공은 STATUS 0(또는 비차단 STATUS) + 에러 라인 0 뿐이다.**
 *
 * STATUS 종결자까지 기다렸는데도 STATUS 가 없으면 결과를 확인하지 못한 것이므로 실패로 둔다 —
 * 과거 `compile successful` 텍스트나 pass 로그로 성공 처리하던 것이 실제 컴파일 에러를 가린
 * 오판의 직접 원인이었다(§0.2/§0.3).
 */
export async function compileOnce(io: ProjectCommandIo, projectName: string): Promise<CompileAttempt> {
    const command = `Compile ${projectName}`;
    try {
        const resp = await io.send(command, { forCompile: true });
        const status = parseStatus(resp.raw);
        const errors = parseCompileErrors(resp.raw);
        const statusMissing = status.code === NO_STATUS_CODE;
        const ok = errors.length === 0
            && (status.code === 0 || isControllerNonBlockingStatus(status.code));
        return {
            command,
            ok,
            statusCode: status.code,
            message: status.message,
            errors,
            raw: resp.raw,
            meta: resp.meta,
            note: ok || !statusMissing
                ? undefined
                : errors.length > 0
                    ? 'STATUS 미수신이나 에러 라인 검출 → 실패'
                    : 'STATUS 미수신: 컴파일 결과 확인 실패(성공 간주 안 함)',
        };
    } catch (e: any) {
        const raw = e?.message || String(e);
        return {
            command,
            ok: false,
            statusCode: NO_STATUS_CODE,
            message: raw,
            errors: parseCompileErrors(raw),
            raw,
        };
    }
}

export interface CompileOptions extends ProjectCommandOptions {
    /**
     * 시도할 프로젝트 이름 후보(앞에서부터). `.gpr` 의 프로젝트명 · 폴더명 · `/GPL` 의 실제 폴더명이
     * 다를 수 있어 순회한다. 첫 성공에서 멈추고 그 이름을 `projectName` 으로 돌려준다.
     */
    candidates: string[];
    /**
     * 일시적 STATUS(`-742/-746/-752`)에 한해 1회 재시도한다(기본 true). 컴파일 에러가 있으면 재시도하지 않는다 —
     * 그건 일시적 상태가 아니라 소스 문제다.
     */
    retryTransient?: boolean;
    /** 재시도 전 대기(ms). 기본 250. */
    retryDelayMs?: number;
    sleep?(ms: number): Promise<void>;
}

/** 후보 이름을 순회하며 Compile 한다(일시적 STATUS 는 1회 재시도). 로드 상태 복구는 호출부의 몫이다. */
export async function compileProject(io: ProjectCommandIo, opts: CompileOptions): Promise<CompileOutcome> {
    const p = prefixOf(opts);
    const attempts: CompileAttempt[] = [];
    const retryTransient = opts.retryTransient !== false;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    let last: CompileAttempt | undefined;

    for (const candidate of opts.candidates) {
        io.log(`${p}CMD Compile ${candidate}`);
        let attempt = await compileOnce(io, candidate);
        attempts.push(attempt);
        io.log(`${p}RAW ${rawPreview(attempt.raw) || '(empty)'}`);
        if (attempt.note) { io.log(`${p}NOTE ${attempt.note}`); }
        if (attempt.meta && attempt.meta.responseComplete === false) {
            io.log(`${p}META responseComplete=false bytesReceived=${attempt.meta.bytesReceived} lastChunkAt=${attempt.meta.lastChunkAt} idleTimeoutMs=${attempt.meta.idleTimeoutMs}`);
        }

        // 일시적 STATUS 는 제어기가 방금 전 작업을 정리 중이라는 뜻이다 — 소스 문제(에러 라인)가 없을 때만 한 번 더.
        if (!attempt.ok && retryTransient && attempt.errors.length === 0 && isTransientCompileStatus(attempt.statusCode)) {
            io.log(`${p}⚠ STATUS ${attempt.statusCode} (일시적) — 잠시 후 1회 재시도합니다`);
            await sleep(Math.max(0, opts.retryDelayMs ?? 250));
            attempt = await compileOnce(io, candidate);
            attempts.push(attempt);
            io.log(`${p}RAW ${rawPreview(attempt.raw) || '(empty)'}`);
            if (attempt.note) { io.log(`${p}NOTE ${attempt.note}`); }
        }

        last = attempt;
        if (attempt.ok) {
            io.log(`${p}✔ Compile success: ${candidate}`);
            return { ok: true, projectName: candidate, attempts, errors: [] };
        }
        io.log(`${p}✘ Compile failed: STATUS ${attempt.statusCode}: ${attempt.message || 'Unknown error'}`);
    }

    return {
        ok: false,
        attempts,
        errors: last?.errors ?? [],
        failure: last && {
            command: last.command,
            code: last.statusCode,
            message: last.message || 'Unknown error',
            raw: last.raw,
        },
    };
}

// ── Start ──────────────────────────────────────────────────────

export interface StartOutcome {
    ok: boolean;
    /** 실제로 보낸 명령(문서 구문으로 조립된 것). */
    command: string;
    statusCode: number;
    message: string;
    raw: string;
    /** 비차단 STATUS(환경 경고)로 성공한 경우 — 호출부가 경고를 남긴다. */
    nonBlockingWarning?: boolean;
    failure?: CommandFailure;
}

/**
 * `Start <project> [스위치]` — 명령 문자열은 **항상** `startCommand.buildStartCommand` 로 만든다.
 *
 * 손으로 조립하면 경로마다 스위치가 달라진다(실제로 FTP Run 경로에는 `-event` 가 빠져 있어 그 경로로
 * 시작한 실행만 1403 이벤트를 받지 못했다). `-compile` 은 기본으로 붙는다 — 없으면 옛 바이너리가 실행된다(§1-DN).
 *
 * ※ 모션 확인 모달·배포 잠금·컴파일 검증 게이트는 **호출부**의 몫이다(사용자 상호작용이므로).
 */
export async function startProject(
    io: ProjectCommandIo,
    startOptions: StartCommandOptions,
    opts?: ProjectCommandOptions,
): Promise<StartOutcome> {
    const p = prefixOf(opts);
    const command = buildStartCommand(startOptions);
    io.log(`${p}CMD ${command}`);
    // `-compile` 이 붙은 Start 는 Compile 과 같은 응답(수 초 침묵 + 긴 출력)이라 같은 대기 규칙으로 보낸다.
    // 짧은 idle 완료로 받으면 compiler pass 도중 잘려 `-9999 No STATUS found` 가 된다(§1-DN).
    const start = await runStatusCommand(io, command, { forCompile: commandRunsCompiler(command) });
    io.log(`${p}RAW ${rawPreview(start.raw) || '(empty)'}`);

    if (start.ok) {
        const nonBlockingWarning = start.statusCode !== 0;
        if (nonBlockingWarning) {
            io.log(`${p}⚠ Start STATUS ${start.statusCode} non-blocking (controller environment warning)`);
        }
        io.log(`${p}✔ Start success`);
        return {
            ok: true,
            command,
            statusCode: start.statusCode,
            message: start.message,
            raw: start.raw,
            nonBlockingWarning,
        };
    }

    io.log(`${p}✘ Start failed: STATUS ${start.statusCode}: ${start.message || 'Unknown error'}`);
    return {
        ok: false,
        command,
        statusCode: start.statusCode,
        message: start.message || 'Unknown error',
        raw: start.raw,
        failure: { command, code: start.statusCode, message: start.message || 'Unknown error', raw: start.raw },
    };
}
