import * as assert from 'assert';
import { test } from './harness';
import type { ThreadStopIo, ThreadStopResponse } from '../controller/threadStop';
import { describeRuntimeErrorHint, formatRuntimeError, watchMainThreadAfterStart } from '../controller/postStartWatch';

const LIST = 'Show Thread  -web';

/** `Show Thread  -web` 파이프 형식 응답. 열: name| state| status| msg| project| func| procLine| file| fileLine */
function threadList(...rows: Array<[name: string, state: string, status?: string, file?: string, line?: number, func?: string]>): string {
    const data = rows.map(([n, s, st = '0', f = 'Main.gpl', l = 1, fn = 'Main']) => `${n}| ${s}| ${st}| ""| Proj| ${fn}| 1| ${f}| ${l}`).join('\n');
    // 실제 응답처럼 마지막 행 뒤에 줄바꿈을 둔다 — 없으면 태그 제거 뒤 `7` 과 `0,"Success"` 가 붙어 70 으로 읽힌다.
    return `<DATA>${data}\n</DATA><STATUS>0,"Success"</STATUS>`;
}

/** `Show Thread <name>` 상세 응답(2026-10-19 실측 형식). */
const DETAIL = '<DATA>AntiBodyR2, Error\n-1509, "*Invalid data index*: 2803"\nAntiBodyR2, setUseAutoHome, 12, _robot_ExtraModuleHandler.gpl, 484</DATA><STATUS>0,"Success"</STATUS>';

function makeIo(responses: Record<string, Array<string | null> | string | null>): ThreadStopIo & { sent: string[]; lines: string[]; elapsed(): number } {
    let clock = 0;
    const sent: string[] = [];
    const lines: string[] = [];
    const queues = new Map<string, Array<string | null>>();
    for (const [cmd, value] of Object.entries(responses)) { queues.set(cmd, Array.isArray(value) ? [...value] : [value]); }
    return {
        sent, lines, elapsed: () => clock,
        send: async (command): Promise<ThreadStopResponse | null> => {
            sent.push(command);
            clock += 10;
            const queue = queues.get(command);
            if (!queue || queue.length === 0) { return null; }
            const raw = queue.length > 1 ? queue.shift()! : queue[0];
            if (raw === null) { return null; }
            return raw.startsWith('!') ? { raw: raw.slice(1), statusComplete: false } : { raw };
        },
        log: line => lines.push(line),
        sleep: async ms => { clock += ms; },
        now: () => clock,
    };
}

test('postStartWatch: 메인 쓰레드가 Error 면 상세를 읽어 코드·메시지·위치·힌트를 돌려준다(2026-10-19 Sample Prep 재현)', async () => {
    const io = makeIo({
        [LIST]: [threadList(['AntiBodyR2', 'Running']), threadList(['AntiBodyR2', 'Error', '-1509', '_robot_ExtraModuleHandler.gpl', 484, 'setUseAutoHome'])],
        'Show Thread AntiBodyR2': DETAIL,
    });
    const r = await watchMainThreadAfterStart(io, 'AntiBodyR2', { windowMs: 5000, pollIntervalMs: 1000, logPrefix: '│ ' });
    assert.strictEqual(r.kind, 'error');
    if (r.kind !== 'error') { return; }
    assert.strictEqual(r.error.statusCode, -1509);
    assert.strictEqual(r.error.statusMessage, '*Invalid data index*: 2803');
    assert.strictEqual(r.error.file, '_robot_ExtraModuleHandler.gpl');
    assert.strictEqual(r.error.line, 484);
    assert.strictEqual(r.error.procedure, 'setUseAutoHome');
    assert.ok(r.error.hint?.includes('로봇'));
    assert.deepStrictEqual(io.sent, [LIST, LIST, 'Show Thread AntiBodyR2']);
    assert.ok(io.lines.some(l => l.startsWith('│ ✘') && l.includes('-1509')));
    assert.strictEqual(formatRuntimeError(r.error), 'AntiBodyR2 Error — -1509 *Invalid data index*: 2803 @ _robot_ExtraModuleHandler.gpl:484 (setUseAutoHome)');
});

test('postStartWatch: 상세 조회가 실패해도 목록의 상태 코드·위치로 채운다', async () => {
    const io = makeIo({ [LIST]: threadList(['Proj', 'Error', '-200', 'Entry.gpl', 7]), 'Show Thread Proj': null });
    const r = await watchMainThreadAfterStart(io, 'proj', { windowMs: 0 });
    assert.strictEqual(r.kind, 'error');
    if (r.kind !== 'error') { return; }
    assert.strictEqual(r.error.threadName, 'Proj');
    assert.strictEqual(r.error.statusCode, -200);
    assert.strictEqual(r.error.file, 'Entry.gpl');
    assert.strictEqual(r.error.line, 7);
    assert.strictEqual(r.error.hint, undefined);
});

test('postStartWatch: 감시 창 동안 Running 이면 running, Idle/사라짐이면 ended, 한 번도 안 보이면 not-seen', async () => {
    const running = await watchMainThreadAfterStart(makeIo({ [LIST]: threadList(['A', 'Running']) }), 'A', { windowMs: 2500, pollIntervalMs: 1000 });
    assert.strictEqual(running.kind, 'running');
    const ended = await watchMainThreadAfterStart(makeIo({ [LIST]: [threadList(['A', 'Running']), threadList(['A', 'Idle'])] }), 'A', { windowMs: 5000 });
    assert.deepStrictEqual(ended.kind === 'ended' ? ended.state : null, 'Idle');
    const gone = await watchMainThreadAfterStart(makeIo({ [LIST]: [threadList(['A', 'Running']), threadList(['Other', 'Running'])] }), 'A', { windowMs: 5000 });
    assert.strictEqual(gone.kind, 'ended');
    const never = await watchMainThreadAfterStart(makeIo({ [LIST]: threadList(['Other', 'Running']) }), 'A', { windowMs: 1500, pollIntervalMs: 1000 });
    assert.strictEqual(never.kind, 'not-seen');
    // 다른 쓰레드의 Error 는 메인 쓰레드 판정에 영향이 없다.
    const otherError = await watchMainThreadAfterStart(makeIo({ [LIST]: threadList(['A', 'Running'], ['LOG_SOCKET', 'Error']) }), 'A', { windowMs: 0 });
    assert.strictEqual(otherError.kind, 'running');
});

test('postStartWatch: Show Thread 무응답·잘린 응답은 unconfirmed(확인 불가) — 성공으로 읽지 않는다', async () => {
    assert.strictEqual((await watchMainThreadAfterStart(makeIo({ [LIST]: null }), 'A', { windowMs: 0 })).kind, 'unconfirmed');
    assert.strictEqual((await watchMainThreadAfterStart(makeIo({ [LIST]: '!<DATA>' }), 'A', { windowMs: 0 })).kind, 'unconfirmed');
    assert.strictEqual(describeRuntimeErrorHint(-1509), describeRuntimeErrorHint(undefined, 'Invalid data index: 2000'));
    assert.strictEqual(describeRuntimeErrorHint(-200, 'No memory available'), undefined);
});
