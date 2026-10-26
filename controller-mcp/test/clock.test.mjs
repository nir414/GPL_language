// clock.js — 제어기 시계 읽기/동기화 절차. 확장 controllerClock.ts 와 같은 규칙인지(형식·보정·결과 모양)를 고정한다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatControllerClock,
  buildClockSetCommand,
  parseControllerClock,
  clockStampToLocalMs,
  estimateClockOffset,
  planClockSet,
  planMidSecondReadAt,
  readControllerClock,
  syncControllerClock,
  clockStatusField,
  summarizeClockSync,
} from '../src/clock.js';
import { commandTraits } from '../src/outcome.js';
import { isRetrySafeCommand } from '../src/extensionBridge.js';

const local = (y, mo, d, h, mi, s, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();

test('date 형식: mm-dd-yyyy hh:mm:ss 왕복', () => {
  assert.equal(formatControllerClock(new Date(local(2026, 10, 24, 1, 5, 9, 999))), '10-24-2026 01:05:09');
  assert.equal(buildClockSetCommand(new Date(local(2026, 1, 2, 23, 59, 0))), 'date 01-02-2026 23:59:00');
  const stamp = parseControllerClock('<DATA>10-24-2026 01:52:06</DATA><STATUS>0</STATUS>');
  assert.deepEqual(stamp, { year: 2026, month: 10, day: 24, hour: 1, minute: 52, second: 6 });
  assert.equal(clockStampToLocalMs(stamp), local(2026, 10, 24, 1, 52, 6));
  assert.equal(parseControllerClock('13-01-2026 00:00:00'), undefined);
});

test('오프셋 추정과 전송 계획', () => {
  const est = estimateClockOffset(local(2026, 10, 24, 1, 52, 6), local(2026, 10, 24, 1, 52, 26), local(2026, 10, 24, 1, 52, 26, 100));
  assert.equal(est.offsetMs, -19550);
  assert.equal(est.uncertaintyMs, 550);
  const plan = planClockSet(local(2026, 10, 24, 1, 55, 9, 700), 60, 150);
  assert.equal(plan.targetMs, local(2026, 10, 24, 1, 55, 10));
  assert.equal(plan.sendAtMs, local(2026, 10, 24, 1, 55, 9, 970));
  assert.equal(plan.command, 'date 10-24-2026 01:55:10');
  assert.equal(planMidSecondReadAt(local(2026, 10, 24, 1, 55, 10, 20), 60, 150), local(2026, 10, 24, 1, 55, 10, 470));
});

function fakeController(startPcMs, offsetMs, oneWayMs, { rejectSet } = {}) {
  let pc = startPcMs;
  let offset = offsetMs;
  const sent = [];
  const io = {
    now: () => pc,
    sleep: async (ms) => { pc += Math.max(0, ms); },
    send: async (command) => {
      sent.push({ at: pc, command });
      pc += oneWayMs;
      let body = '';
      if (/^date\s*$/i.test(command)) {
        body = `<DATA>${formatControllerClock(new Date(Math.floor((pc + offset) / 1000) * 1000))}</DATA>`;
      } else if (rejectSet !== undefined) {
        pc += oneWayMs;
        return `<STATUS>${rejectSet}</STATUS>`;
      } else {
        offset = clockStampToLocalMs(parseControllerClock(command)) - pc;
      }
      pc += oneWayMs;
      return `${body}<STATUS>0</STATUS>`;
    },
  };
  return { io, sent, offset: () => offset };
}

test('controller_status.clock: 초 단위 필드, 실패는 ok:false', async () => {
  const fake = fakeController(local(2026, 10, 24, 1, 52, 26), -20_000, 25);
  const field = clockStatusField(await readControllerClock(fake.io), 'UTC+09:00');
  assert.equal(field.controller, '10-24-2026 01:52:06');
  assert.equal(field.pc, '10-24-2026 01:52:26');
  assert.equal(field.offsetSec, -19.525);
  assert.equal(field.pcTimeZone, 'UTC+09:00');

  const failing = { now: () => 0, sleep: async () => {}, send: async () => { throw new Error('ECONNREFUSED'); } };
  const failed = clockStatusField(await readControllerClock(failing));
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'send-failed');
});

test('sync: dry run 은 읽기만, confirm 은 정각 초에 맞춰 설정하고 잔여 오차를 보고', async () => {
  const dry = fakeController(local(2026, 10, 24, 1, 52, 26), 5_000, 20);
  const preview = summarizeClockSync(await syncControllerClock(dry.io, { dryRun: true }));
  assert.equal(preview.ok, true);
  assert.equal(preview.dryRun, true);
  assert.match(preview.wouldSend, /^date 10-24-2026 01:52:2\d$/);
  assert.equal(dry.sent.length, 1);
  assert.equal(dry.offset(), 5_000);

  const live = fakeController(local(2026, 10, 24, 1, 52, 26, 333), -20_000, 30);
  const done = summarizeClockSync(await syncControllerClock(live.io));
  assert.equal(done.ok, true);
  assert.equal(live.offset(), 0);
  assert.equal(done.residualSec, 0);
  assert.match(done.sent, /^date \d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
  assert.equal((live.sent[1].at + 30) % 1000, 0);
});

test('sync: sendComposed 가 있으면 큐 슬롯을 얻은 뒤 값을 만든다(슬롯 대기가 값에 섞이지 않음)', async () => {
  const fake = fakeController(local(2026, 10, 24, 1, 52, 26, 333), -20_000, 30);
  fake.io.sendComposed = async (reserved, compose) => {
    assert.equal(reserved, 'date');
    await fake.io.sleep(3_700);   // 앞의 긴 Compile
    return fake.io.send(await compose());
  };
  const r = summarizeClockSync(await syncControllerClock(fake.io));
  assert.equal(r.ok, true);
  assert.equal(fake.offset(), 0);
  assert.equal(r.sent, fake.sent[1].command);

  const refused = fakeController(local(2026, 10, 24, 1, 0, 0), 3_000, 10);
  refused.io.sendComposed = async () => { throw new Error('busy'); };
  assert.equal(summarizeClockSync(await syncControllerClock(refused.io)).outcome, 'not-sent');
});

test('sync: 설정 거부는 stage=set·setStatus 로', async () => {
  const fake = fakeController(local(2026, 10, 24, 1, 0, 0), 3_000, 10, { rejectSet: -205 });
  const r = summarizeClockSync(await syncControllerClock(fake.io));
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'set');
  assert.equal(r.setStatus.code, -205);
});

test('date 분류: 단독은 조회(재전송 안전), 인자 있으면 상태 변경', () => {
  assert.equal(commandTraits('date').mutability, 'read-only');
  assert.equal(commandTraits('date 10-24-2026 01:55:10').mutability, 'state-changing');
  assert.equal(isRetrySafeCommand('Date'), true);
  assert.equal(isRetrySafeCommand('date 10-24-2026 01:55:10'), false);
});
