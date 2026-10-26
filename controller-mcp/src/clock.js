// 제어기 시계 ↔ PC 시계 — 순수 로직(네트워크/MCP 무의존, node:test 로 검증).
//
// 확장 src/controller/diagnostics/controllerClock.ts 의 미러다. 확장 브리지가 살아 있으면 sync_controller_clock 은
// 확장 명령 gpl.controller.syncClock 으로 보내고(왕복 측정이 브리지 지연에 오염되지 않게), 이 모듈의 절차는
// 직접 접속(direct-tcp) 경로와 controller_status.clock 조회에만 쓴다. 규칙을 고칠 때는 두 파일을 함께 고칠 것.
//
// 근거(2026-10-24 실기 관측): `date` = 제어기 시각 표시 `mm-dd-yyyy hh:mm:ss`, `date mm-dd-yyyy hh:mm:ss` = 설정(STATUS 0).
// 제어기에는 시간대가 없다 → PC 로컬 시각을 그대로 보낸다. 재부팅 뒤 유지 여부는 미확인.
// 문서: https://www2.brooksautomation.com/Controller_Software/Software_Reference/Console_Commands/date_cmnd.htm

import { parseStatus } from './parse.js';

export const CLOCK_READ_COMMAND = 'date';
export const DEFAULT_CLOCK_MIN_LEAD_MS = 150;
const LATE_REPLAN_MS = 80;
const MAX_REPLANS = 3;
const SLOW_RTT_MS = 250;
const SLOW_RTT_REREADS = 2;

const CLOCK_TEXT_RE = /(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/;
const pad2 = (n) => String(n).padStart(2, '0');

/** PC 로컬 시각 → `mm-dd-yyyy hh:mm:ss`(초 미만 절사). */
export function formatControllerClock(date) {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${date.getFullYear()} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function buildClockSetCommand(date) {
  return `${CLOCK_READ_COMMAND} ${formatControllerClock(date)}`;
}

/** 응답에서 첫 `mm-dd-yyyy hh:mm:ss`. 범위 밖이면 undefined. */
export function parseControllerClock(text) {
  const m = CLOCK_TEXT_RE.exec(String(text ?? ''));
  if (!m) return undefined;
  const [month, day, year, hour, minute, second] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  return { year, month, day, hour, minute, second };
}

export function clockStampToLocalMs(s) {
  return new Date(s.year, s.month - 1, s.day, s.hour, s.minute, s.second).getTime();
}

const stampText = (s) => `${pad2(s.month)}-${pad2(s.day)}-${s.year} ${pad2(s.hour)}:${pad2(s.minute)}:${pad2(s.second)}`;

/** 오프셋(제어기 − PC) 추정 — 중간점 기준, 초 절사 보정 +500 ms, 불확실성 ±(500 + 왕복/2). */
export function estimateClockOffset(controllerMs, sentAtMs, receivedAtMs) {
  const rttMs = Math.max(0, receivedAtMs - sentAtMs);
  const pcMidMs = sentAtMs + rttMs / 2;
  return { offsetMs: Math.round(controllerMs + 500 - pcMidMs), rttMs, uncertaintyMs: Math.round(500 + rttMs / 2), pcMidMs };
}

/** 다음 정각 초 T 가 편도 지연 뒤 PC 시각 T 에 도착하도록 보낼 계획. */
export function planClockSet(nowMs, rttMs, minLeadMs = DEFAULT_CLOCK_MIN_LEAD_MS) {
  const oneWayMs = Math.max(0, Math.round(rttMs / 2));
  const targetMs = Math.ceil((nowMs + Math.max(0, minLeadMs) + oneWayMs) / 1000) * 1000;
  const target = new Date(targetMs);
  return { targetMs, sendAtMs: targetMs - oneWayMs, oneWayMs, value: formatControllerClock(target), command: buildClockSetCommand(target) };
}

/** 확인 읽기를 PC 시각 X.500 에 도착하도록 보낼 시각. */
export function planMidSecondReadAt(nowMs, rttMs, minLeadMs = DEFAULT_CLOCK_MIN_LEAD_MS) {
  const oneWayMs = Math.max(0, Math.round(rttMs / 2));
  const earliestArrival = nowMs + Math.max(0, minLeadMs) + oneWayMs;
  return Math.ceil((earliestArrival - 500) / 1000) * 1000 + 500 - oneWayMs;
}

export function describePcTimeZone(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `UTC${minutes >= 0 ? '+' : '-'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

const toSec = (ms) => Math.round(ms) / 1000;

/**
 * `date` 1회 읽기. io = { send(command) → raw, now(), sleep(ms) }.
 * @returns {Promise<{ok:true, controller, pc, offsetMs, rttMs, uncertaintyMs} | {ok:false, error, detail, statusCode?}>}
 */
export async function readControllerClock(io) {
  const sentAt = io.now();
  let raw;
  try {
    raw = await io.send(CLOCK_READ_COMMAND);
  } catch (err) {
    return { ok: false, error: 'send-failed', detail: err?.message ?? String(err) };
  }
  const receivedAt = io.now();
  const status = parseStatus(raw);
  if (status.code !== 0) {
    return { ok: false, error: 'status-error', statusCode: status.code, detail: `STATUS ${status.code}${status.message ? ` ${status.message}` : ''}` };
  }
  const stamp = parseControllerClock(raw);
  if (!stamp) return { ok: false, error: 'unparsed', detail: '응답에서 mm-dd-yyyy hh:mm:ss 형식의 시각을 찾지 못했다.' };
  const est = estimateClockOffset(clockStampToLocalMs(stamp), sentAt, receivedAt);
  return {
    ok: true,
    controller: stampText(stamp),
    pc: formatControllerClock(new Date(est.pcMidMs)),
    offsetMs: est.offsetMs,
    rttMs: est.rttMs,
    uncertaintyMs: est.uncertaintyMs,
  };
}

/** controller_status.clock 모양 — 초 단위. 실패면 {ok:false, error, detail}. */
export function clockStatusField(reading, pcTimeZone = describePcTimeZone()) {
  if (!reading?.ok) return { ok: false, error: reading?.error ?? 'unknown', detail: reading?.detail ?? null };
  return {
    controller: reading.controller,
    pc: reading.pc,
    offsetSec: toSec(reading.offsetMs),
    uncertaintySec: toSec(reading.uncertaintyMs),
    pcTimeZone,
  };
}

/**
 * 동기화 절차(직접 접속 경로용). 확장 gpl.controller.syncClock 과 같은 결과 모양을 돌려준다.
 * @param {{send:(c:string)=>Promise<string>, now:()=>number, sleep:(ms:number)=>Promise<void>}} io
 * @param {{dryRun?:boolean, minLeadMs?:number}} [options]
 */
export async function syncControllerClock(io, options = {}) {
  const dryRun = options.dryRun === true;
  const minLeadMs = options.minLeadMs ?? DEFAULT_CLOCK_MIN_LEAD_MS;
  const pcTimeZone = describePcTimeZone(new Date(io.now()));

  let before = await readControllerClock(io);
  if (!before.ok) {
    return { ok: false, dryRun, pcTimeZone, before, stage: 'read-before', error: before.error, detail: before.detail, outcome: 'not-sent' };
  }
  for (let i = 0; i < SLOW_RTT_REREADS && before.rttMs > SLOW_RTT_MS; i++) {
    const again = await readControllerClock(io);
    if (again.ok && again.rttMs < before.rttMs) before = again;
  }

  let plan = planClockSet(io.now(), before.rttMs, minLeadMs);
  if (dryRun) {
    return { ok: true, dryRun, pcTimeZone, before, plan: { value: plan.value, command: plan.command, oneWayMs: plan.oneWayMs } };
  }
  for (let i = 0; i < MAX_REPLANS; i++) {
    const wait = plan.sendAtMs - io.now();
    if (wait > 0) await io.sleep(wait);
    if (io.now() - plan.sendAtMs <= LATE_REPLAN_MS) break;
    plan = planClockSet(io.now(), before.rttMs, minLeadMs);
  }
  const planInfo = { value: plan.value, command: plan.command, oneWayMs: plan.oneWayMs };
  let setRaw;
  try {
    setRaw = await io.send(plan.command);
  } catch (err) {
    return { ok: false, dryRun, pcTimeZone, before, plan: planInfo, stage: 'set', error: 'send-failed', detail: err?.message ?? String(err), outcome: 'unknown' };
  }
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
  if (wait > 0) await io.sleep(wait);
  const after = await readControllerClock(io);
  if (!after.ok) {
    return { ok: false, dryRun, pcTimeZone, before, plan: planInfo, setStatus: { code: 0, message: setStatus.message }, after, stage: 'read-after', error: after.error, detail: after.detail };
  }
  return { ok: true, dryRun, pcTimeZone, before, plan: planInfo, setStatus: { code: 0, message: setStatus.message }, after, residualMs: after.offsetMs };
}

/** 도구 응답용 요약 — 확장/직접 경로 결과 모두. 초 단위 필드를 덧붙인다. */
export function summarizeClockSync(result) {
  const sec = (r) => (r?.ok ? { controller: r.controller, pc: r.pc, offsetSec: toSec(r.offsetMs), uncertaintySec: toSec(r.uncertaintyMs), rttMs: Math.round(r.rttMs) } : r ?? null);
  return {
    ok: result?.ok === true,
    dryRun: result?.dryRun === true,
    pcTimeZone: result?.pcTimeZone ?? describePcTimeZone(),
    before: sec(result?.before),
    ...(result?.plan ? { [result.dryRun ? 'wouldSend' : 'sent']: result.plan.command, oneWayCompensationMs: result.plan.oneWayMs } : {}),
    ...(result?.setStatus ? { setStatus: result.setStatus } : {}),
    ...(result?.after ? { after: sec(result.after) } : {}),
    ...(typeof result?.residualMs === 'number' ? { residualSec: toSec(result.residualMs) } : {}),
    ...(result?.stage ? { stage: result.stage } : {}),
    ...(result?.error ? { error: result.error, detail: result.detail ?? null } : {}),
    ...(result?.outcome ? { outcome: result.outcome } : {}),
  };
}
