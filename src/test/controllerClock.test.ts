import * as assert from 'assert';
import { test } from './harness';
import {
    buildClockSetCommand,
    clockStampToLocalMs,
    describeClockSync,
    describePcTimeZone,
    estimateClockOffset,
    exceedsClockThreshold,
    formatClockOffset,
    formatControllerClock,
    parseControllerClock,
    planClockSet,
    planMidSecondReadAt,
    readControllerClock,
    syncControllerClock,
    ClockIo,
} from '../controller/diagnostics/controllerClock';

const local = (y: number, mo: number, d: number, h: number, mi: number, s: number, ms = 0): number =>
    new Date(y, mo - 1, d, h, mi, s, ms).getTime();

test('controller clock: format/parse mm-dd-yyyy hh:mm:ss', () => {
    assert.strictEqual(formatControllerClock(new Date(local(2026, 10, 24, 1, 5, 9, 999))), '10-24-2026 01:05:09');
    assert.strictEqual(buildClockSetCommand(new Date(local(2026, 1, 2, 23, 59, 0))), 'date 01-02-2026 23:59:00');

    const raw = '<DATA>10-24-2026 01:52:06</DATA>\r\n<STATUS>0</STATUS>\r\n';
    const stamp = parseControllerClock(raw);
    assert.deepStrictEqual(stamp, { year: 2026, month: 10, day: 24, hour: 1, minute: 52, second: 6 });
    assert.strictEqual(clockStampToLocalMs(stamp!), local(2026, 10, 24, 1, 52, 6));

    assert.strictEqual(parseControllerClock('<STATUS>0</STATUS>'), undefined);
    assert.strictEqual(parseControllerClock('13-01-2026 00:00:00'), undefined);
    assert.strictEqual(parseControllerClock('10-24-2026 24:00:00'), undefined);
});

test('controller clock: offset estimate uses the round-trip midpoint and +0.5 s truncation', () => {
    // 제어기 표시 01:52:06, PC 가 01:52:26.000 에 보내고 .100 에 받음 → 중간점 .050, 제어기 추정 06.5
    const est = estimateClockOffset(local(2026, 10, 24, 1, 52, 6), local(2026, 10, 24, 1, 52, 26), local(2026, 10, 24, 1, 52, 26, 100));
    assert.strictEqual(est.rttMs, 100);
    assert.strictEqual(est.offsetMs, -19550);
    assert.strictEqual(est.uncertaintyMs, 550);
    assert.strictEqual(formatClockOffset(est.offsetMs), '-19.6 s');
    assert.strictEqual(formatClockOffset(1234), '+1.2 s');
    assert.strictEqual(formatClockOffset(20), '±0.0 s');
});

test('controller clock: set plan targets the next whole second arriving after one-way latency', () => {
    const now = local(2026, 10, 24, 1, 55, 9, 700);
    const plan = planClockSet(now, 60, 150);
    // 9.700 + 150 + 30 = 9.880 → 목표 10.000, 보낼 시각 9.970
    assert.strictEqual(plan.targetMs, local(2026, 10, 24, 1, 55, 10));
    assert.strictEqual(plan.sendAtMs, local(2026, 10, 24, 1, 55, 9, 970));
    assert.strictEqual(plan.oneWayMs, 30);
    assert.strictEqual(plan.command, 'date 10-24-2026 01:55:10');

    // 여유가 모자라면 그다음 초
    const late = planClockSet(local(2026, 10, 24, 1, 55, 9, 900), 60, 150);
    assert.strictEqual(late.targetMs, local(2026, 10, 24, 1, 55, 11));

    // 확인 읽기는 X.500 도착
    const readAt = planMidSecondReadAt(local(2026, 10, 24, 1, 55, 10, 20), 60, 150);
    assert.strictEqual(readAt, local(2026, 10, 24, 1, 55, 10, 470));
    const readAt2 = planMidSecondReadAt(local(2026, 10, 24, 1, 55, 10, 400), 60, 150);
    assert.strictEqual(readAt2, local(2026, 10, 24, 1, 55, 11, 470));
});

test('controller clock: threshold and time zone helpers', () => {
    assert.strictEqual(exceedsClockThreshold(2000, 2), false);
    assert.strictEqual(exceedsClockThreshold(-2001, 2), true);
    assert.strictEqual(exceedsClockThreshold(1, Number.NaN), true);
    assert.match(describePcTimeZone(new Date()), /^UTC[+-]\d{2}:\d{2}$/);
});

/** 가상 시계 위의 제어기 — 편도 지연 뒤 명령을 처리하고, 표시값은 초 단위 절사. */
function fakeController(startPcMs: number, offsetMs: number, oneWayMs: number, opts: { rejectSet?: number; failReadAfterSet?: boolean } = {}) {
    let pc = startPcMs;
    let offset = offsetMs;
    let setDone = false;
    const sent: Array<{ at: number; command: string }> = [];
    const io: ClockIo = {
        now: () => pc,
        sleep: async (ms: number) => { pc += Math.max(0, ms); },
        send: async (command: string) => {
            sent.push({ at: pc, command });
            pc += oneWayMs;
            let body = '';
            if (/^date\s*$/i.test(command)) {
                if (setDone && opts.failReadAfterSet) {
                    pc += oneWayMs;
                    return '<STATUS>-714</STATUS>';
                }
                body = `<DATA>${formatControllerClock(new Date(Math.floor((pc + offset) / 1000) * 1000))}</DATA>`;
            } else {
                if (opts.rejectSet !== undefined) {
                    pc += oneWayMs;
                    return `<STATUS>${opts.rejectSet}</STATUS>`;
                }
                const stamp = parseControllerClock(command)!;
                offset = clockStampToLocalMs(stamp) - pc;
                setDone = true;
            }
            pc += oneWayMs;
            return `${body}<STATUS>0</STATUS>`;
        },
    };
    return { io, sent, offset: () => offset };
}

test('controller clock: read reports controller/pc text and offset', async () => {
    const fake = fakeController(local(2026, 10, 24, 1, 52, 26, 0), -20_000, 25);
    const r = await readControllerClock(fake.io);
    assert.ok(r.ok);
    if (!r.ok) { return; }
    assert.strictEqual(r.controller, '10-24-2026 01:52:06');
    assert.strictEqual(r.pc, '10-24-2026 01:52:26');
    assert.strictEqual(r.rttMs, 50);
    // 실제 -20 s, 절사 보정 +0.5 → 추정 -19.525 s (±0.525)
    assert.ok(Math.abs(r.offsetMs - -20_000) <= r.uncertaintyMs);
});

test('controller clock: sync lands the controller within one-way error of the PC and reports residual', async () => {
    const fake = fakeController(local(2026, 10, 24, 1, 52, 26, 333), -20_000, 30);
    const result = await syncControllerClock(fake.io);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.dryRun, false);
    // 설정 명령 1건 + 읽기 2건
    assert.deepStrictEqual(fake.sent.map(s => s.command.split(' ')[0]), ['date', 'date', 'date']);
    const set = fake.sent[1];
    assert.match(set.command, /^date \d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
    // 정각 초 − 편도 에 보냈다 → 제어기 오프셋은 정확히 0
    assert.strictEqual((set.at + 30) % 1000, 0);
    assert.strictEqual(fake.offset(), 0);
    assert.strictEqual(result.residualMs, 0);
    assert.ok(describeClockSync(result).some(l => l.startsWith('동기화 후')));
});

test('controller clock: dry run sends nothing but the read', async () => {
    const fake = fakeController(local(2026, 10, 24, 1, 52, 26, 0), 5_000, 20);
    const result = await syncControllerClock(fake.io, { dryRun: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(fake.sent.length, 1);
    assert.match(result.plan!.command, /^date 10-24-2026 01:52:2\d$/);
    assert.strictEqual(fake.offset(), 5_000);
});

test('controller clock: rejected set and failed confirm read are reported with their stage', async () => {
    const rejected = await syncControllerClock(fakeController(local(2026, 10, 24, 1, 0, 0), 3_000, 10, { rejectSet: -205 }).io);
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.stage, 'set');
    assert.strictEqual(rejected.error, 'set-rejected');
    assert.strictEqual(rejected.setStatus?.code, -205);

    const unconfirmed = await syncControllerClock(fakeController(local(2026, 10, 24, 1, 0, 0), 3_000, 10, { failReadAfterSet: true }).io);
    assert.strictEqual(unconfirmed.ok, false);
    assert.strictEqual(unconfirmed.stage, 'read-after');
    assert.strictEqual(unconfirmed.setStatus?.code, 0);

    const throwing: ClockIo = { now: () => 0, sleep: async () => undefined, send: async () => { throw new Error('ECONNREFUSED'); } };
    const failed = await syncControllerClock(throwing);
    assert.strictEqual(failed.stage, 'read-before');
    assert.strictEqual(failed.outcome, 'not-sent');
});

test('controller clock: 큐 슬롯을 기다리는 동안 흐른 시간은 설정 값에 섞이지 않는다(sendComposed)', async () => {
    const fake = fakeController(local(2026, 10, 24, 1, 52, 26, 333), -20_000, 30);
    let slotWaits = 0;
    // 큐 앞에 긴 Compile 이 있어 슬롯을 3.7 s 늦게 받는다 — 값은 슬롯 안에서 만들어야 한다.
    fake.io.sendComposed = async (reserved: string, compose: () => Promise<string>) => {
        assert.strictEqual(reserved, 'date');
        await fake.io.sleep(3_700);
        slotWaits++;
        const command = await compose();
        return fake.io.send(command);
    };
    const result = await syncControllerClock(fake.io);
    assert.strictEqual(slotWaits, 1);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fake.offset(), 0, '슬롯 대기 뒤 다시 계획해 정각 초에 도착한다');
    assert.strictEqual(result.residualMs, 0);
    assert.strictEqual(result.plan?.command, fake.sent[1].command, '보고하는 명령은 실제로 보낸 명령이다');

    // 대조: 슬롯 밖에서 값을 만들고 큐에서 밀리면(종전 방식) 그만큼 낡은 시각이 써진다.
    const stale = fakeController(local(2026, 10, 24, 1, 52, 26, 333), -20_000, 30);
    const send = stale.io.send;
    let first = true;
    stale.io.send = async (command: string) => {
        if (/^date \d/.test(command) && first) { first = false; await stale.io.sleep(3_700); }
        return send(command);
    };
    await syncControllerClock(stale.io);
    assert.ok(stale.offset() <= -3_000, `종전 방식은 ${stale.offset()} ms 어긋난다`);
});

test('controller clock: 명령을 만들기 전에 실패하면 보내지 않은 것으로 보고한다', async () => {
    const fake = fakeController(local(2026, 10, 24, 1, 0, 0), 3_000, 10);
    fake.io.sendComposed = async () => { throw new Error('PolicyError'); };
    const result = await syncControllerClock(fake.io);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.stage, 'set');
    assert.strictEqual(result.outcome, 'not-sent');
    assert.strictEqual(fake.offset(), 3_000);

    const unknown = fakeController(local(2026, 10, 24, 1, 0, 0), 3_000, 10);
    unknown.io.sendComposed = async (_r: string, compose: () => Promise<string>) => { await compose(); throw new Error('ECONNRESET'); };
    const lost = await syncControllerClock(unknown.io);
    assert.strictEqual(lost.outcome, 'unknown', '만든 뒤 끊기면 적용됐을 수 있다');
});
