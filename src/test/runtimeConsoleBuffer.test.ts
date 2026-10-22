import * as assert from 'assert';
import { test } from './harness';
import { RuntimeConsoleBuffer, compileUntilPattern } from '../controller/runtime/runtimeConsoleBuffer';

// ── 커서 읽기 ───────────────────────────────────────────────────────────────

test('RuntimeConsoleBuffer.read: 커서 없이 부르면 최근 줄, 커서를 주면 그 이후 줄과 다음 커서', () => {
    const b = new RuntimeConsoleBuffer(10);
    assert.strictEqual(b.cursorNow, 0);
    b.push('a', undefined, 1);
    b.push('b', 'Proj', 2);
    b.push('c', undefined, 3);
    const tail = b.read(undefined, 2);
    assert.deepStrictEqual(tail.lines.map(l => l.text), ['b', 'c']);
    assert.strictEqual(tail.nextCursor, 3);
    assert.strictEqual(tail.lines[0].project, 'Proj');
    const since = b.read(1);
    assert.deepStrictEqual(since.lines.map(l => l.seq), [1, 2]);
    assert.strictEqual(since.nextCursor, 3);
    assert.strictEqual(since.dropped, 0);
    // 다 읽은 커서로 다시 부르면 빈 결과 + 같은 커서
    const empty = b.read(3);
    assert.strictEqual(empty.lines.length, 0);
    assert.strictEqual(empty.nextCursor, 3);
});

test('RuntimeConsoleBuffer: 용량을 넘으면 오래된 줄이 밀리고 dropped 로 알린다', () => {
    const b = new RuntimeConsoleBuffer(3);
    for (let i = 0; i < 5; i++) { b.push(`l${i}`); }
    assert.strictEqual(b.size, 3);
    assert.strictEqual(b.oldestSeq, 2);
    const r = b.read(0);
    assert.strictEqual(r.dropped, 2, '커서 0 이후 seq 0·1 은 밀려서 못 본다');
    assert.deepStrictEqual(r.lines.map(l => l.text), ['l2', 'l3', 'l4']);
    assert.strictEqual(r.nextCursor, 5);
    // 미래 커서(버퍼보다 앞)는 빈 결과, dropped 0
    const future = b.read(9);
    assert.strictEqual(future.lines.length, 0);
    assert.strictEqual(future.dropped, 0);
    assert.strictEqual(future.nextCursor, 9);
});

// ── 조건 대기 ───────────────────────────────────────────────────────────────

test('waitFor: 패턴이 이미 버퍼에 있으면 즉시, 매치 줄까지만 잘라 돌려준다', async () => {
    const b = new RuntimeConsoleBuffer(10);
    b.push('start');
    b.push('Station 3 READY');
    b.push('after');
    const r = await b.waitFor({ cursor: 0, untilPattern: /ready/i, timeoutMs: 1000 });
    assert.strictEqual(r.matched, true);
    assert.strictEqual(r.timedOut, false);
    assert.deepStrictEqual(r.lines.map(l => l.text), ['start', 'Station 3 READY']);
    assert.strictEqual(r.nextCursor, 2, '매치 뒤 줄(after)은 다음 커서로 넘긴다');
});

test('waitFor: 나중에 오는 줄을 기다렸다가 매치되면 끝난다', async () => {
    const b = new RuntimeConsoleBuffer(10);
    const p = b.waitFor({ untilPattern: /done/i, timeoutMs: 2000 });
    setTimeout(() => { b.push('working'); b.push('DONE: ok'); }, 20);
    const r = await p;
    assert.strictEqual(r.matched, true);
    assert.deepStrictEqual(r.lines.map(l => l.text), ['working', 'DONE: ok']);
    assert.strictEqual(r.timedOut, false);
    assert.ok(r.waitedMs >= 0);
});

test('waitFor: 시간 안에 조건을 못 채우면 timedOut 과 그때까지의 줄', async () => {
    const b = new RuntimeConsoleBuffer(10);
    const p = b.waitFor({ untilPattern: /never/, timeoutMs: 60 });
    setTimeout(() => b.push('something else'), 10);
    const r = await p;
    assert.strictEqual(r.matched, false);
    assert.strictEqual(r.timedOut, true);
    assert.deepStrictEqual(r.lines.map(l => l.text), ['something else']);
    assert.strictEqual(r.nextCursor, 1);
});

test('waitFor: 패턴 없이 waitMs 만 주면 첫 새 줄에서 끝나고, timeoutMs 0 이면 기다리지 않는다', async () => {
    const b = new RuntimeConsoleBuffer(10);
    const immediate = await b.waitFor({ timeoutMs: 0 });
    assert.strictEqual(immediate.lines.length, 0);
    assert.strictEqual(immediate.timedOut, false, '기다리지 않았으므로 시간 초과가 아니다');
    const p = b.waitFor({ timeoutMs: 1000 });
    setTimeout(() => b.push('first'), 10);
    const r = await p;
    assert.strictEqual(r.matched, true);
    assert.deepStrictEqual(r.lines.map(l => l.text), ['first']);
});

// 2026-10-22 Sample Prep: cursor 없이 부르면 buffered 1393 인데 lines:[] 였다(도구 설명은 "최근 줄부터").
test('waitFor: 커서 없이 기다리지도 않으면 최근 maxLines 줄을 돌려준다(read() 와 같다)', async () => {
    const b = new RuntimeConsoleBuffer(10);
    for (const t of ['a', 'b', 'c', 'Cycle end']) { b.push(t); }
    const r = await b.waitFor({ maxLines: 2, timeoutMs: 0 });
    assert.deepStrictEqual(r.lines.map(l => l.text), ['c', 'Cycle end']);
    assert.strictEqual(r.nextCursor, 4);
    assert.strictEqual(r.timedOut, false);
    const withPattern = await b.waitFor({ maxLines: 10, untilPattern: /cycle end/i, timeoutMs: 0 });
    assert.strictEqual(withPattern.matched, true);
    assert.strictEqual(withPattern.lines.length, 4);
});

test('waitFor: 커서 없이 기다리면 종전대로 "지금부터" 오는 줄만 본다', async () => {
    const b = new RuntimeConsoleBuffer(10);
    b.push('old');
    const p = b.waitFor({ timeoutMs: 1000 });
    setTimeout(() => b.push('new'), 10);
    const r = await p;
    assert.deepStrictEqual(r.lines.map(l => l.text), ['new']);
});

test('waitFor: maxLines 를 채우면 매치 없이도 끝낸다(다음 호출이 이어 읽는다)', async () => {
    const b = new RuntimeConsoleBuffer(10);
    for (let i = 0; i < 5; i++) { b.push(`x${i}`); }
    const r = await b.waitFor({ cursor: 0, untilPattern: /never/, maxLines: 3, timeoutMs: 1000 });
    assert.strictEqual(r.matched, false);
    assert.strictEqual(r.timedOut, false);
    assert.strictEqual(r.lines.length, 3);
    assert.strictEqual(r.nextCursor, 3);
});

test('compileUntilPattern: 빈 값은 undefined, 잘못된 정규식은 null, 정상은 대소문자 무시', () => {
    assert.strictEqual(compileUntilPattern(undefined), undefined);
    assert.strictEqual(compileUntilPattern(''), undefined);
    assert.strictEqual(compileUntilPattern('('), null);
    const re = compileUntilPattern('ready');
    assert.ok(re instanceof RegExp && re.test('READY'));
});
