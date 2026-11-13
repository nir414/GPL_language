import test from 'node:test';
import assert from 'node:assert/strict';
import { breakOnExceptionNotice, reportBreakOnException } from '../../../debug/session/breakOnExceptionNotice';

const resp = (values: string) => `<DATA>307, 1, 1, 0, "Break on exception code" = ${values}</DATA><STATUS>0</STATUS>`;

test('breakOnExceptionNotice: 전부 0 이면 알리지 않는다', () => {
    assert.strictEqual(breakOnExceptionNotice(resp('0, 0, 0, 0, 0, 0, 0, 0')), null);
});

test('breakOnExceptionNotice: 0 이 아닌 값이 있으면 합쇼체 한 줄', () => {
    const notice = breakOnExceptionNotice(resp('0, 1, 0'));
    assert.ok(notice && /307/.test(notice) && /Try/.test(notice) && /니다\.$/.test(notice));
});

test('breakOnExceptionNotice: 해석 불가·null 은 조용히 null', () => {
    assert.strictEqual(breakOnExceptionNotice(null), null);
    assert.strictEqual(breakOnExceptionNotice('-1503 *Invalid data ID*'), null);
});

test('reportBreakOnException: 전송 실패/예외를 삼키고, 알릴 때만 log', async () => {
    const lines: string[] = [];
    const log = (m: string): void => { lines.push(m); };
    await reportBreakOnException(async (): Promise<string | null> => { throw new Error('x'); }, m => lines.push(m));
    await reportBreakOnException(async () => resp('0'), m => lines.push(m));
    assert.strictEqual(lines.length, 0);
    await reportBreakOnException(async () => resp('2'), log);
    assert.strictEqual(lines.length, 1);
});
