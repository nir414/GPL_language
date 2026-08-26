import * as assert from 'assert';
import { test } from './harness';
import { ResponseBodyStreamer } from '../controller/trafficResponseBody';

function collect(maxChars = 0): { lines: string[]; s: ResponseBodyStreamer } {
    const lines: string[] = [];
    const s = new ResponseBodyStreamer(l => lines.push(l), { maxChars });
    return { lines, s };
}

test('traffic body streamer emits complete lines per chunk and holds the partial tail', () => {
    const { lines, s } = collect();
    s.push('<DATA>\r\nThread   State\r\nMain     Run');
    assert.deepStrictEqual(lines, ['<DATA>', 'Thread   State'], '마지막 조각(줄바꿈 미도달)은 보류');
    s.push('ning\r\n</DATA>\r\n<STATUS>0,""</STATUS>\r\n');
    assert.deepStrictEqual(lines, ['<DATA>', 'Thread   State', 'Main     Running', '</DATA>', '<STATUS>0,""</STATUS>']);
    const stats = s.flush();
    assert.strictEqual(stats.emittedLines, 5);
    assert.strictEqual(stats.truncated, false);
    assert.strictEqual(lines.length, 5, 'flush 시 추가 줄 없음(보류 조각도 생략 요약도 없음)');
});

test('traffic body streamer handles CR/LF split across chunk boundary and skips blank lines', () => {
    const { lines, s } = collect();
    s.push('abc\r');
    assert.deepStrictEqual(lines, [], 'CR만 온 상태에서는 줄 완성 대기');
    s.push('\n\r\n   \r\nxyz');
    assert.deepStrictEqual(lines, ['abc'], '공백만 있는 줄은 건너뜀');
    s.flush();
    assert.deepStrictEqual(lines, ['abc', 'xyz'], 'flush 시 보류 조각 emit');
});

test('traffic body streamer flush is idempotent', () => {
    const { lines, s } = collect();
    s.push('tail-without-newline');
    s.flush();
    s.flush();
    s.push('ignored after flush\r\n');
    assert.deepStrictEqual(lines, ['tail-without-newline']);
});

test('traffic body streamer truncates at maxChars and reports omission once', () => {
    const { lines, s } = collect(10);
    s.push('12345\r\n');            // 5 chars emitted
    s.push('abcdefgh\r\n');         // 8 > remaining 5 → partial + …
    s.push('omitted-1\r\n');
    s.push('omitted-2\r\n');
    const stats = s.flush();
    assert.deepStrictEqual(lines.slice(0, 2), ['12345', 'abcde…']);
    assert.strictEqual(lines.length, 3, '생략된 줄들 대신 요약 한 줄');
    assert.ok(lines[2].startsWith('... 본문 2줄/'), lines[2]);
    assert.ok(lines[2].includes('gpl.controller.trafficLogMaxResponseChars'), '설정 키 안내 포함');
    assert.strictEqual(stats.truncated, true);
    assert.strictEqual(stats.emittedChars, 10);
    assert.strictEqual(stats.omittedLines, 2);
    assert.strictEqual(stats.omittedChars, 3 + 'omitted-1'.length + 'omitted-2'.length);
});

test('traffic body streamer with maxChars 0 is unlimited', () => {
    const { lines, s } = collect(0);
    const long = 'x'.repeat(50_000);
    s.push(long + '\r\n' + long + '\r\n');
    const stats = s.flush();
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(stats.truncated, false);
    assert.strictEqual(stats.emittedChars, 100_000);
});

test('traffic body streamer exact budget boundary does not truncate', () => {
    const { lines, s } = collect(6);
    s.push('abc\r\ndef\r\n');
    const stats = s.flush();
    assert.deepStrictEqual(lines, ['abc', 'def']);
    assert.strictEqual(stats.truncated, false);
});
