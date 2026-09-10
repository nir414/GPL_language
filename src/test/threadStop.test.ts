import * as assert from 'assert';
import { test } from './harness';
import {
    STOP_ALL_CMD,
    ThreadStopIo,
    ThreadStopResponse,
    probeThreads,
    stopAllAndSettle,
    stopThreadAndSettle,
    waitThreadsSettle,
} from '../controller/threadStop';

const OK = '<DATA></DATA><STATUS>0,"Success"</STATUS>';
const BUSY = '<DATA></DATA><STATUS>-752,"Timeout stopping thread"</STATUS>';
const FAILED = '<DATA></DATA><STATUS>-500,"Some other failure"</STATUS>';

/** `Show Thread  -web` 파이프 형식 응답을 만든다. */
function threadList(...rows: Array<[name: string, state: string]>): string {
    const data = rows.map(([n, s]) => `${n}| ${s}| 0| ""| Proj| Main| 1| Main.gpl| 1`).join('\n');
    return `<DATA>${data}</DATA><STATUS>0,"Success"</STATUS>`;
}

interface FakeIo extends ThreadStopIo {
    sent: string[];
    lines: string[];
    elapsed(): number;
}

/**
 * 가짜 IO — 명령별 응답을 순서대로 돌려주고 가상 시계를 쓴다(테스트가 실제로 기다리지 않는다).
 * `responses` 의 값이 배열이면 호출마다 하나씩 소비하고, 다 쓰면 마지막 것을 계속 돌려준다.
 */
function makeIo(responses: Record<string, Array<string | null> | string | null>, opts?: { cancelAfterMs?: number }): FakeIo {
    let clock = 0;
    const sent: string[] = [];
    const lines: string[] = [];
    const queues = new Map<string, Array<string | null>>();
    for (const [cmd, value] of Object.entries(responses)) {
        queues.set(cmd, Array.isArray(value) ? [...value] : [value]);
    }
    return {
        sent,
        lines,
        elapsed: () => clock,
        send: async (command): Promise<ThreadStopResponse | null> => {
            sent.push(command);
            clock += 10; // 왕복 비용
            const queue = queues.get(command);
            if (!queue || queue.length === 0) { return null; }
            const raw = queue.length > 1 ? queue.shift()! : queue[0];
            if (raw === null) { return null; }
            // "STATUS 종결자를 못 받은 응답"은 앞에 `!` 를 붙여 표시한다.
            return raw.startsWith('!') ? { raw: raw.slice(1), statusComplete: false } : { raw };
        },
        log: line => lines.push(line),
        sleep: async ms => { clock += ms; },
        now: () => clock,
        isCancelled: () => opts?.cancelAfterMs !== undefined && clock >= opts.cancelAfterMs,
    };
}

// ── probeThreads ───────────────────────────────────────────────

test('threadStop probe: 목록을 활성/전체로 가른다 (Idle·Stopped·Error 는 정지 계열)', async () => {
    const io = makeIo({ 'Show Thread  -web': threadList(['A', 'Running'], ['B', 'Idle'], ['C', 'Error']) });
    const probe = await probeThreads(io);
    assert.ok(probe);
    assert.strictEqual(probe.total, 3);
    assert.deepStrictEqual(probe.active.map(t => t.name), ['A']);
});

test('threadStop probe: STATUS 종결자를 못 받으면 null(확인 불가) — 빈 목록과 구분한다', async () => {
    const truncated = await probeThreads(makeIo({ 'Show Thread  -web': '!<DATA>' }));
    assert.strictEqual(truncated, null);
    const noResponse = await probeThreads(makeIo({ 'Show Thread  -web': null }));
    assert.strictEqual(noResponse, null);
    const empty = await probeThreads(makeIo({ 'Show Thread  -web': threadList() }));
    assert.deepStrictEqual(empty && { total: empty.total, active: empty.active.length }, { total: 0, active: 0 });
});

// ── waitThreadsSettle ──────────────────────────────────────────

test('threadStop settle: 활성이 사라질 때까지 폴링하고 정지를 확인한다', async () => {
    const io = makeIo({
        'Show Thread  -web': [threadList(['A', 'Running']), threadList(['A', 'Running']), threadList()],
    });
    const outcome = await waitThreadsSettle(io);
    assert.strictEqual(outcome.settled, true);
    assert.strictEqual(outcome.unconfirmed, false);
    assert.strictEqual(io.sent.length, 3);
});

test('threadStop settle: 상한까지 안 멈추면 settled=false + 활성 설명을 남긴다', async () => {
    const io = makeIo({ 'Show Thread  -web': threadList(['A', 'Running'], ['B', 'Stopping']) });
    const outcome = await waitThreadsSettle(io, { settleTimeoutMs: 2000, pollIntervalMs: 500 });
    assert.strictEqual(outcome.settled, false);
    assert.strictEqual(outcome.activeDesc, 'A(Running), B(Stopping)');
    assert.ok(outcome.elapsedMs >= 2000, `elapsed=${outcome.elapsedMs}`);
});

test('threadStop settle: Show Thread 무응답은 unconfirmed — 통과시키되 "확인함"으로 위장하지 않는다', async () => {
    const io = makeIo({ 'Show Thread  -web': null });
    const outcome = await waitThreadsSettle(io);
    assert.deepStrictEqual({ settled: outcome.settled, unconfirmed: outcome.unconfirmed }, { settled: true, unconfirmed: true });
});

test('threadStop settle: 취소 신호는 즉시 중단(cancelled)', async () => {
    const io = makeIo({ 'Show Thread  -web': threadList(['A', 'Running']) }, { cancelAfterMs: 0 });
    const outcome = await waitThreadsSettle(io);
    assert.strictEqual(outcome.cancelled, true);
    assert.strictEqual(outcome.settled, false);
});

// ── stopAllAndSettle ───────────────────────────────────────────

test('threadStop stopAll: STATUS 0 은 "접수"일 뿐이라 반드시 정지 확인까지 간다', async () => {
    const io = makeIo({ [STOP_ALL_CMD]: OK, 'Show Thread  -web': threadList() });
    const outcome = await stopAllAndSettle(io);
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(outcome.attempts, 1);
    assert.strictEqual(outcome.send.kind, 'accepted');
    // Stop 한 번 + 정지 확인 한 번 — 확인 없이 성공을 보고하지 않는다.
    assert.deepStrictEqual(io.sent, [STOP_ALL_CMD, 'Show Thread  -web']);
});

test('threadStop stopAll: -752 는 실패가 아니라 "정지 진행 중" — settle 로 판정한다', async () => {
    const io = makeIo({
        [STOP_ALL_CMD]: BUSY,
        'Show Thread  -web': [threadList(['A', 'Running']), threadList()],
    });
    const outcome = await stopAllAndSettle(io);
    assert.strictEqual(outcome.send.kind, 'stopping');
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(outcome.attempts, 1);
});

test('threadStop stopAll: 정지가 확인되지 않으면 Stop 을 한 번 더 보내고, 그래도면 실패', async () => {
    const io = makeIo({ [STOP_ALL_CMD]: OK, 'Show Thread  -web': threadList(['A', 'Running']) });
    const outcome = await stopAllAndSettle(io, { settleTimeoutMs: 1000, pollIntervalMs: 500 });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.attempts, 2);
    assert.strictEqual(io.sent.filter(c => c === STOP_ALL_CMD).length, 2);
    assert.match(outcome.failure?.message ?? '', /A\(Running\)/);
    assert.strictEqual(outcome.failure?.command, 'Show Thread (stop settle gate)');
});

test('threadStop stopAll: 무응답이면 재전송하고, 그래도 없으면 실패로 판정한다(성공 추정 금지)', async () => {
    const io = makeIo({ [STOP_ALL_CMD]: null, 'Show Thread  -web': threadList() });
    const outcome = await stopAllAndSettle(io);
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.send.kind, 'failed');
    assert.strictEqual(io.sent.filter(c => c === STOP_ALL_CMD).length, 2);
    // 전송이 실패했으면 정지 확인으로 넘어가지 않는다.
    assert.strictEqual(io.sent.includes('Show Thread  -web'), false);
});

test('threadStop stopAll: busy 가 아닌 STATUS 는 실패 — 코드를 그대로 넘긴다', async () => {
    const io = makeIo({ [STOP_ALL_CMD]: FAILED });
    const outcome = await stopAllAndSettle(io);
    assert.strictEqual(outcome.ok, false);
    assert.deepStrictEqual(
        { kind: outcome.send.kind, code: outcome.failure?.statusCode, cmd: outcome.failure?.command },
        { kind: 'failed', code: -500, cmd: STOP_ALL_CMD },
    );
});

test('threadStop stopAll: STATUS 가 아예 없는 응답을 성공으로 보지 않는다', async () => {
    const io = makeIo({ [STOP_ALL_CMD]: '<DATA>stopped</DATA>' });
    const outcome = await stopAllAndSettle(io);
    assert.strictEqual(outcome.ok, false);
    assert.match(outcome.failure?.message ?? '', /STATUS 없음/);
});

test('threadStop stopAll: 확인 불가로 통과한 경우 unconfirmed 로 드러난다(호출부가 정책을 고른다)', async () => {
    const io = makeIo({ [STOP_ALL_CMD]: OK, 'Show Thread  -web': null });
    const outcome = await stopAllAndSettle(io);
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(outcome.settle?.unconfirmed, true);
});

test('threadStop stopAll: 로그 접두(logPrefix)가 모든 줄에 붙는다(배포 트레이스 합류용)', async () => {
    const io = makeIo({ [STOP_ALL_CMD]: OK, 'Show Thread  -web': threadList() });
    await stopAllAndSettle(io, { logPrefix: '│ ' });
    assert.ok(io.lines.length > 0);
    assert.deepStrictEqual(io.lines.filter(l => !l.startsWith('│ ')), []);
});

// ── stopThreadAndSettle (개별 정지) ─────────────────────────────

test('threadStop 개별: Stop <thread> 를 보내고 그 쓰레드만 정지 확인한다', async () => {
    const io = makeIo({
        'Stop worker1': OK,
        // 다른 쓰레드(worker2)가 계속 돌아도 대상만 멈추면 통과다.
        'Show Thread  -web': [threadList(['worker1', 'Running'], ['worker2', 'Running']), threadList(['worker2', 'Running'])],
    });
    const outcome = await stopThreadAndSettle(io, 'worker1');
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(io.sent[0], 'Stop worker1');
});

test('threadStop 개별: 대상 쓰레드 이름은 대소문자를 구분하지 않는다(GPL 규칙)', async () => {
    const io = makeIo({ 'Stop WORKER1': OK, 'Show Thread  -web': threadList(['worker1', 'Idle']) });
    const outcome = await stopThreadAndSettle(io, 'WORKER1');
    assert.strictEqual(outcome.ok, true);
});

test('threadStop 개별: 대상이 안 멈추면 재시도 후 실패 — 남의 쓰레드는 사유에 넣지 않는다', async () => {
    const io = makeIo({
        'Stop worker1': OK,
        'Show Thread  -web': threadList(['worker1', 'Running'], ['worker2', 'Running']),
    });
    const outcome = await stopThreadAndSettle(io, 'worker1', { settleTimeoutMs: 500, pollIntervalMs: 500 });
    assert.strictEqual(outcome.ok, false);
    assert.match(outcome.failure?.message ?? '', /worker1\(Running\)/);
    assert.doesNotMatch(outcome.failure?.message ?? '', /worker2/);
});
