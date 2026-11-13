import * as assert from 'assert';
import { test } from '../../harness';
import { THREAD_REFRESH_BURST_MS, ThreadRefreshScheduler } from '../../../views/tree/threadRefreshScheduler';
import { affectsThreadState } from '../../../controller/commands/consoleCommandClassifier';

/** 가짜 시계 — 타이머를 시각 순으로 직접 돌린다. run 은 durationMs 동안 걸린다. */
function harness(durationMs = 0) {
    let now = 0;
    let nextId = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const runs: Array<{ at: number; reasons: readonly string[] }> = [];
    let release: (() => void) | undefined;
    const scheduler = new ThreadRefreshScheduler({
        now: () => now,
        setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
        clearTimer: h => { timers.delete(h as number); },
        run: async reasons => {
            runs.push({ at: now, reasons });
            if (durationMs > 0) { await new Promise<void>(r => { release = r; }); }
        },
    }, 250);
    /** 시각을 t 까지 진행하며 도래한 타이머를 순서대로 실행한다. */
    async function advanceTo(t: number): Promise<void> {
        for (;;) {
            const next = [...timers.entries()].filter(([, v]) => v.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) { break; }
            timers.delete(next[0]);
            now = next[1].at;
            next[1].fn();
            await Promise.resolve();
            await Promise.resolve();
        }
        now = t;
    }
    async function finishRun(): Promise<void> {
        const r = release; release = undefined; r?.();
        for (let i = 0; i < 5; i++) { await Promise.resolve(); }
    }
    return { scheduler, runs, advanceTo, finishRun, timers, setNow: (t: number) => { now = t; } };
}

test('threadRefreshScheduler: 즉시 요청 여러 개는 한 번의 조회로 합친다', async () => {
    const h = harness();
    h.scheduler.request('1403');
    h.scheduler.request('1403');
    h.scheduler.request('Stop -all 뒤');
    await h.advanceTo(10);
    assert.strictEqual(h.runs.length, 1);
    assert.deepStrictEqual([...h.runs[0].reasons].sort(), ['1403', 'Stop -all 뒤']);
    assert.strictEqual(h.scheduler.pendingCount, 0);
});

test('threadRefreshScheduler: burst 는 정해진 시점마다 조회하고 시작 간격 하한을 지킨다', async () => {
    const h = harness();
    h.scheduler.burst('Start App 뒤');
    await h.advanceTo(5000);
    assert.deepStrictEqual(h.runs.map(r => r.at), [...THREAD_REFRESH_BURST_MS]);
    h.scheduler.request('a');
    h.scheduler.request('b', 100);
    await h.advanceTo(5300);
    // 5000 에 a, b(5100)는 마지막 시작 + 250 = 5250 으로 밀린다
    assert.deepStrictEqual(h.runs.slice(-2).map(r => r.at), [5000, 5250]);
});

test('threadRefreshScheduler: 조회 중 들어온 요청은 버리지 않고 끝난 뒤 한 번 더 돈다', async () => {
    const h = harness(1);
    h.scheduler.request('first');
    await h.advanceTo(0);
    assert.strictEqual(h.runs.length, 1);
    assert.ok(h.scheduler.isRunning);
    h.setNow(100);
    h.scheduler.request('during-1');
    h.scheduler.request('during-2');
    h.setNow(400);
    await h.finishRun();
    await h.advanceTo(400);
    assert.strictEqual(h.runs.length, 2);
    assert.deepStrictEqual([...h.runs[1].reasons].sort(), ['during-1', 'during-2']);
    await h.finishRun();
    await h.advanceTo(2000);
    assert.strictEqual(h.runs.length, 2, '더 돌 예약이 없다');
});

test('threadRefreshScheduler: cancel 뒤에는 예약도, 진행 중 조회 뒤의 재실행도 없다', async () => {
    const h = harness(1);
    h.scheduler.burst('Stop -all 뒤');
    await h.advanceTo(THREAD_REFRESH_BURST_MS[0]);
    assert.strictEqual(h.runs.length, 1);
    h.scheduler.cancel();
    await h.finishRun();
    await h.advanceTo(10_000);
    assert.strictEqual(h.runs.length, 1);
    assert.strictEqual(h.timers.size, 0);
});

test('affectsThreadState: 쓰레드를 움직이는 명령만', () => {
    for (const c of ['Start App -compile -event', 'Stop -all', 'stop RWK_3', 'Execute Foo', 'Continue RWK_3', 'Step RWK_3 -over -noerror', 'Break RWK_3', 'SoftEStop', 'Unload -all']) {
        assert.ok(affectsThreadState(c), c);
    }
    for (const c of ['Show Thread  -web', 'Set Break App "a.gpl"12', 'Compile App', 'Load /GPL/App', 'ErrorLog -clear', 'date', '']) {
        assert.ok(!affectsThreadState(c), c);
    }
});
