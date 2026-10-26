/**
 * 제어기 시계를 PC 시계에 맞추는 순수 로직 (vscode 무의존 — IO 만 주입받는다).
 *
 * 근거(2026-10-24 SamplePrep 세션 실기 관측):
 *  - 명령 콘솔 `date`(인자 없음)는 제어기 시각을 `mm-dd-yyyy hh:mm:ss` 로 출력한다.
 *  - `date mm-dd-yyyy hh:mm:ss` 는 제어기 시각을 설정한다(STATUS 0).
 *  - 제어기에는 시간대(time zone) 개념이 없다 → PC **로컬 시각을 그대로** 보낸다.
 *  - 재부팅 뒤에도 설정한 시각이 유지되는지는 미확인(문서에도 없음).
 *  문서: https://www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/date_cmnd.htm
 *
 * 시각 추정 모델:
 *  - 제어기 표시값은 초 단위 절사로 가정한다. 읽기 요청을 보낸 시각 t0, 응답을 받은 시각 t1 이면 제어기가 시계를 읽은
 *    순간은 대략 중간점 (t0+t1)/2 이고, 그 순간 제어기 시각은 [C, C+1) 초 → 추정값 C+0.5 초.
 *    따라서 오프셋(제어기 − PC) ≈ (C + 500 ms) − (t0+t1)/2, 불확실성 ≈ ±(500 ms + 왕복/2).
 *  - 설정은 "다음 정각 초 T" 값을 실은 `date T` 가 PC 시각 T 에 제어기에 도착하도록, 편도(왕복/2)만큼 먼저 보낸다.
 *  - 확인 읽기는 PC 시각 X.500 에 도착하도록 보낸다 — 시계가 맞았다면 그때 제어기 표시는 X 이고 추정 오프셋은 0 이 된다.
 *
 * 이 모듈은 명령 전송 방법을 모른다. 확장은 직렬 큐(`sendCommandDetailed`)를 주입하고, 명령 정책도 그 경로에서 그대로 적용된다.
 */

import { parseStatus } from '../protocol/responseParser';

/** 제어기 시각 읽기 명령(인자 없음 = 표시). */
export const CLOCK_READ_COMMAND = 'date';

/** 설정 명령을 보내기 전에 남겨 둘 최소 여유(ms) — 계획 직후 바로 보내야 하는 상황을 피한다. */
export const DEFAULT_CLOCK_MIN_LEAD_MS = 150;

/** 예약 시각보다 이만큼 늦게 깨어났으면 다음 초로 다시 계획한다(ms). */
const LATE_REPLAN_MS = 80;
const MAX_REPLANS = 3;

/** 첫 읽기 왕복이 이보다 길면 큐 대기가 섞였다고 보고 다시 읽는다(ms). 명령 콘솔 왕복은 실측 수십 ms. */
const SLOW_RTT_MS = 250;
const SLOW_RTT_REREADS = 2;

export interface ControllerClockStamp {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const CLOCK_TEXT_RE = /(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** PC 로컬 시각 → 제어기 `date` 형식 `mm-dd-yyyy hh:mm:ss` (초 미만 절사). */
export function formatControllerClock(date: Date): string {
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${date.getFullYear()} `
        + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 제어기 시각 설정 명령 `date mm-dd-yyyy hh:mm:ss`. */
export function buildClockSetCommand(date: Date): string {
    return `${CLOCK_READ_COMMAND} ${formatControllerClock(date)}`;
}

/** 응답 텍스트에서 첫 `mm-dd-yyyy hh:mm:ss` 를 찾는다. 범위를 벗어나면 undefined. */
export function parseControllerClock(text: string): ControllerClockStamp | undefined {
    const m = CLOCK_TEXT_RE.exec(text ?? '');
    if (!m) { return undefined; }
    const [month, day, year, hour, minute, second] = m.slice(1).map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
        return undefined;
    }
    return { year, month, day, hour, minute, second };
}

/** 제어기 시각을 PC 로컬 시간대의 epoch ms 로 해석한다(제어기에 시간대가 없으므로). */
export function clockStampToLocalMs(stamp: ControllerClockStamp): number {
    return new Date(stamp.year, stamp.month - 1, stamp.day, stamp.hour, stamp.minute, stamp.second).getTime();
}

export interface ClockOffsetEstimate {
    /** 제어기 − PC (ms). 양수면 제어기가 앞서 있다. */
    offsetMs: number;
    /** 읽기 명령의 왕복 시간(ms) — 큐 대기·정책 처리 포함 벽시계 기준. */
    rttMs: number;
    /** 오프셋 추정의 불확실성 ±(ms) — 초 단위 표시(±500) + 편도. */
    uncertaintyMs: number;
    /** 제어기가 시계를 읽은 것으로 보는 PC 시각(ms, 중간점). */
    pcMidMs: number;
}

export function estimateClockOffset(controllerMs: number, sentAtMs: number, receivedAtMs: number): ClockOffsetEstimate {
    const rttMs = Math.max(0, receivedAtMs - sentAtMs);
    const pcMidMs = sentAtMs + rttMs / 2;
    return {
        offsetMs: Math.round(controllerMs + 500 - pcMidMs),
        rttMs,
        uncertaintyMs: Math.round(500 + rttMs / 2),
        pcMidMs,
    };
}

export interface ClockSetPlan {
    /** 제어기에 설정할 PC 시각(정각 초, ms). */
    targetMs: number;
    /** 이 PC 시각에 보내면 편도 지연 뒤 targetMs 에 도착한다. */
    sendAtMs: number;
    /** 왕복/2 로 잡은 편도 지연(ms). */
    oneWayMs: number;
    /** 보낼 값 `mm-dd-yyyy hh:mm:ss`. */
    value: string;
    /** 보낼 명령 `date <value>`. */
    command: string;
}

/** 지금(nowMs)부터 minLead 이후 보낼 수 있는 가장 이른 정각 초를 목표로 잡는다. */
export function planClockSet(nowMs: number, rttMs: number, minLeadMs: number = DEFAULT_CLOCK_MIN_LEAD_MS): ClockSetPlan {
    const oneWayMs = Math.max(0, Math.round(rttMs / 2));
    const targetMs = Math.ceil((nowMs + Math.max(0, minLeadMs) + oneWayMs) / 1000) * 1000;
    const target = new Date(targetMs);
    return {
        targetMs,
        sendAtMs: targetMs - oneWayMs,
        oneWayMs,
        value: formatControllerClock(target),
        command: buildClockSetCommand(target),
    };
}

/** 확인 읽기를 보낼 PC 시각 — 제어기에 X.500 초에 도착하도록(시계가 맞으면 추정 오프셋이 0 이 되는 위상). */
export function planMidSecondReadAt(nowMs: number, rttMs: number, minLeadMs: number = DEFAULT_CLOCK_MIN_LEAD_MS): number {
    const oneWayMs = Math.max(0, Math.round(rttMs / 2));
    const earliestArrival = nowMs + Math.max(0, minLeadMs) + oneWayMs;
    const arrival = Math.ceil((earliestArrival - 500) / 1000) * 1000 + 500;
    return arrival - oneWayMs;
}

/** 자동 동기화 판정 — |오프셋| 이 임계값(초)을 넘을 때만. 임계값이 음수/비정상이면 0 으로 본다. */
export function exceedsClockThreshold(offsetMs: number, thresholdSec: number): boolean {
    const t = Number.isFinite(thresholdSec) ? Math.max(0, thresholdSec) : 0;
    return Math.abs(offsetMs) > t * 1000;
}

/** `+20.3 s` / `-0.4 s` — 사람용 오프셋 표기. */
export function formatClockOffset(offsetMs: number): string {
    const sec = Math.sign(offsetMs) * Math.round(Math.abs(offsetMs) / 100) / 10;   // 부호와 무관하게 대칭 반올림
    return `${sec > 0 ? '+' : sec < 0 ? '-' : '±'}${Math.abs(sec).toFixed(1)} s`;
}

/** PC 로컬 시간대 표기 `UTC+09:00` — 제어기에는 시간대가 없으므로 표시용. */
export function describePcTimeZone(date: Date = new Date()): string {
    const minutes = -date.getTimezoneOffset();
    const sign = minutes >= 0 ? '+' : '-';
    const abs = Math.abs(minutes);
    return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

// ── 절차 (IO 주입) ────────────────────────────────────────────────

export interface ClockIo {
    /** 명령 콘솔로 명령 1건을 보내고 원시 응답을 돌려준다(직렬 큐 경유). 전송 실패는 throw. */
    send(command: string): Promise<string>;
    now(): number;
    sleep(ms: number): Promise<void>;
    /**
     * 직렬 큐 슬롯을 먼저 얻고, 그 안에서 `compose()` 로 보낼 명령을 만든 뒤 바로 보낸다(이름은 `reserved` 와 같다).
     * 시계 설정은 값이 전송 시각에 묶여 있으므로 **예약 시각 대기와 값 계산을 슬롯 안에서** 해야 한다 — 슬롯 밖에서
     * 값을 만든 뒤 큐에 넣으면 앞의 긴 명령(Compile 등)이 끝날 때까지 밀려 낡은 시각이 써진다(PR #38 리뷰).
     * 다른 명령과 큐를 나누는 IO 는 반드시 제공한다. 없으면 `send(await compose())` — 큐가 없는 IO(테스트 대역 등)용.
     */
    sendComposed?(reserved: string, compose: () => Promise<string>): Promise<string>;
}

export interface ControllerClockReading {
    ok: true;
    /** 제어기 표시값 `mm-dd-yyyy hh:mm:ss`. */
    controller: string;
    /** 같은 순간(중간점)의 PC 로컬 시각, 같은 형식. */
    pc: string;
    offsetMs: number;
    rttMs: number;
    uncertaintyMs: number;
}

export interface ClockReadFailure {
    ok: false;
    error: 'send-failed' | 'status-error' | 'unparsed';
    detail: string;
    statusCode?: number;
    raw?: string;
}

export type ClockReadResult = ControllerClockReading | ClockReadFailure;

export async function readControllerClock(io: ClockIo): Promise<ClockReadResult> {
    const sentAt = io.now();
    let raw: string;
    try {
        raw = await io.send(CLOCK_READ_COMMAND);
    } catch (err: any) {
        return { ok: false, error: 'send-failed', detail: err?.message ?? String(err) };
    }
    const receivedAt = io.now();
    const status = parseStatus(raw);
    if (status.code !== 0) {
        return { ok: false, error: 'status-error', statusCode: status.code, detail: `STATUS ${status.code}${status.message ? ` ${status.message}` : ''}`, raw };
    }
    const stamp = parseControllerClock(raw);
    if (!stamp) {
        return { ok: false, error: 'unparsed', detail: '응답에서 mm-dd-yyyy hh:mm:ss 형식의 시각을 찾지 못했습니다.', raw };
    }
    const est = estimateClockOffset(clockStampToLocalMs(stamp), sentAt, receivedAt);
    return {
        ok: true,
        controller: `${pad2(stamp.month)}-${pad2(stamp.day)}-${stamp.year} ${pad2(stamp.hour)}:${pad2(stamp.minute)}:${pad2(stamp.second)}`,
        pc: formatControllerClock(new Date(est.pcMidMs)),
        offsetMs: est.offsetMs,
        rttMs: est.rttMs,
        uncertaintyMs: est.uncertaintyMs,
    };
}

export interface ClockSyncOptions {
    /** true 면 설정하지 않고 현재 오프셋과 보낼 값만 돌려준다. */
    dryRun?: boolean;
    minLeadMs?: number;
}

export type ClockSyncStage = 'read-before' | 'set' | 'read-after';

export interface ClockSyncResult {
    ok: boolean;
    dryRun: boolean;
    /** PC 로컬 시간대(표시용) — 제어기에는 이 시간대의 로컬 시각을 그대로 보낸다. */
    pcTimeZone: string;
    before?: ClockReadResult;
    /** 보낸(또는 dryRun 이면 보낼) 값과 명령. */
    plan?: { value: string; command: string; oneWayMs: number };
    setStatus?: { code: number; message: string };
    after?: ClockReadResult;
    /** 동기화 뒤 남은 오차(제어기 − PC, ms). 확인 읽기가 성공한 경우만. */
    residualMs?: number;
    stage?: ClockSyncStage;
    error?: string;
    detail?: string;
    /** 설정 명령 전송이 실패했을 때 'unknown' — 제어기가 이미 적용했을 수 있다. */
    outcome?: 'unknown' | 'not-sent';
}

export async function syncControllerClock(io: ClockIo, options: ClockSyncOptions = {}): Promise<ClockSyncResult> {
    const dryRun = options.dryRun === true;
    const minLeadMs = options.minLeadMs ?? DEFAULT_CLOCK_MIN_LEAD_MS;
    const pcTimeZone = describePcTimeZone(new Date(io.now()));

    let before = await readControllerClock(io);
    if (!before.ok) {
        return { ok: false, dryRun, pcTimeZone, before, stage: 'read-before', error: before.error, detail: before.detail, outcome: 'not-sent' };
    }
    // 왕복이 길면(같은 큐의 다른 명령이 앞에 있었을 수 있다) 몇 번 더 읽어 가장 짧은 왕복을 보정 근거로 쓴다.
    for (let i = 0; i < SLOW_RTT_REREADS && before.rttMs > SLOW_RTT_MS; i++) {
        const again = await readControllerClock(io);
        if (again.ok && again.rttMs < before.rttMs) { before = again; }
    }

    let plan = planClockSet(io.now(), before.rttMs, minLeadMs);
    if (dryRun) {
        return { ok: true, dryRun, pcTimeZone, before, plan: { value: plan.value, command: plan.command, oneWayMs: plan.oneWayMs } };
    }

    // 큐 슬롯을 얻은 **뒤** 그 시각으로 다시 계획하고 예약 시각까지 기다린다. 늦게 깨어났으면(타이머 지연) 다음 정각 초로 다시 계획한다.
    // 슬롯을 기다리는 동안(앞의 긴 명령) 흐른 시간은 여기서 다시 계획하므로 값에 섞이지 않는다.
    const rttMs = before.rttMs;
    let composed = false;
    const compose = async (): Promise<string> => {
        plan = planClockSet(io.now(), rttMs, minLeadMs);
        for (let i = 0; i < MAX_REPLANS; i++) {
            const wait = plan.sendAtMs - io.now();
            if (wait > 0) { await io.sleep(wait); }
            if (io.now() - plan.sendAtMs <= LATE_REPLAN_MS) { break; }
            plan = planClockSet(io.now(), rttMs, minLeadMs);
        }
        composed = true;
        return plan.command;
    };

    let setRaw: string;
    try {
        setRaw = io.sendComposed
            ? await io.sendComposed(CLOCK_READ_COMMAND, compose)
            : await io.send(await compose());
    } catch (err: any) {
        // 명령을 만들기 전에(슬롯·안전 검사 단계) 실패했거나 전송 전 거부(sent:false)면 보내지 않은 것이다.
        const notSent = !composed || err?.sent === false;
        return {
            ok: false, dryRun, pcTimeZone, before, plan: { value: plan.value, command: plan.command, oneWayMs: plan.oneWayMs },
            stage: 'set', error: 'send-failed', detail: err?.message ?? String(err), outcome: notSent ? 'not-sent' : 'unknown',
        };
    }
    const planInfo = { value: plan.value, command: plan.command, oneWayMs: plan.oneWayMs };
    const setStatus = parseStatus(setRaw);
    if (setStatus.code !== 0) {
        return {
            ok: false, dryRun, pcTimeZone, before, plan: planInfo, stage: 'set', error: 'set-rejected',
            setStatus: { code: setStatus.code, message: setStatus.message },
            detail: `STATUS ${setStatus.code}${setStatus.message ? ` ${setStatus.message}` : ''}`,
        };
    }

    const readAt = planMidSecondReadAt(io.now(), before.rttMs, minLeadMs);
    const wait = readAt - io.now();
    if (wait > 0) { await io.sleep(wait); }
    const after = await readControllerClock(io);
    if (!after.ok) {
        // 설정은 STATUS 0 으로 끝났다 — 확인만 못 했다.
        return {
            ok: false, dryRun, pcTimeZone, before, plan: planInfo, setStatus: { code: 0, message: setStatus.message },
            after, stage: 'read-after', error: after.error, detail: after.detail,
        };
    }
    return {
        ok: true, dryRun, pcTimeZone, before, plan: planInfo, setStatus: { code: 0, message: setStatus.message },
        after, residualMs: after.offsetMs,
    };
}

/** 사람용 요약 줄(Output 채널). */
export function describeClockSync(result: ClockSyncResult): string[] {
    const lines: string[] = [];
    const reading = (label: string, r: ClockReadResult | undefined): void => {
        if (!r) { return; }
        lines.push(r.ok
            ? `${label}: 제어기 ${r.controller} / PC ${r.pc} (${result.pcTimeZone}) → 오프셋 ${formatClockOffset(r.offsetMs)} (±${(r.uncertaintyMs / 1000).toFixed(1)} s, 왕복 ${Math.round(r.rttMs)} ms)`
            : `${label}: 읽기 실패 — ${r.detail}`);
    };
    reading('동기화 전', result.before);
    if (result.plan) {
        lines.push(`${result.dryRun ? '보낼 명령(미리보기)' : '보낸 명령'}: ${result.plan.command} (편도 보정 ${result.plan.oneWayMs} ms)`);
    }
    if (result.setStatus && result.setStatus.code !== 0) {
        lines.push(`설정 거부: STATUS ${result.setStatus.code}${result.setStatus.message ? ` ${result.setStatus.message}` : ''}`);
    }
    reading('동기화 후', result.after);
    if (result.stage === 'set' && result.outcome === 'unknown') {
        lines.push(`설정 명령 결과 미확정 — 제어기가 이미 적용했을 수 있습니다: ${result.detail ?? ''}`);
    }
    return lines;
}
