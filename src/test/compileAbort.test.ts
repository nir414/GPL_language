import * as assert from 'assert';
import { test } from './harness';
import {
    COMPILE_ABORT_HINT,
    classifyCompileAbort,
    livenessFromProbe,
    summarizeCompileCommand,
} from '../controller/deployment/compileAbort';
import { NO_STATUS_CODE } from '../controller/protocol/responseParser';
import type { CommandResponseMeta } from '../controller/connection/consoleSocket';

// 2026-10-22 22:01 KST: deploy_project(build) 의 Compile 이 22 s 뒤 ECONNRESET, pass 줄 0 — 결과는 "compileErrors 0" 이라 구분이 어려웠다.
const meta = (over: Partial<CommandResponseMeta>): CommandResponseMeta => ({
    responseComplete: true, bytesReceived: 0, lastChunkAt: '', idleTimeoutMs: 300, statusTagReceived: true,
    dataTagClosed: true, extraIdleApplied: false, durationMs: 0, socketReused: false, socketKept: false, ...over,
});

test('compileAbort: 응답 없이 ECONNRESET 으로 끝난 Compile → compileAborted(출력 0줄)', () => {
    const a = classifyCompileAbort({
        command: 'Compile BINDER_Probe', ok: false, errors: [],
        raw: 'Connection error (192.168.0.1:1402): read ECONNRESET',
        elapsedMs: 22010,
        transportError: { code: 'ECONNRESET', message: 'Connection error (192.168.0.1:1402): read ECONNRESET' },
    });
    assert.deepStrictEqual(a, { reason: 'ECONNRESET', command: 'Compile BINDER_Probe', elapsedMs: 22010, outputLines: 0, hint: COMPILE_ABORT_HINT });
});

test('compileAbort: 출력 일부를 받고 </STATUS> 없이 소켓이 닫힘 → ECONNCLOSED + 받은 줄 수', () => {
    const a = classifyCompileAbort({
        command: 'Compile P', ok: false, errors: [],
        raw: 'Pass 1\r\nPass 2\r\n',
        meta: meta({ responseComplete: false, statusTagReceived: false, durationMs: 1500, bytesReceived: 16 }),
    });
    assert.strictEqual(a?.reason, 'ECONNCLOSED');
    assert.strictEqual(a?.outputLines, 2);
    assert.strictEqual(a?.elapsedMs, 1500);
});

test('compileAbort: 컴파일 에러·STATUS 실패·타임아웃·연결 거부·메모리 차단은 끊김이 아니다', () => {
    const base = { command: 'Compile P', ok: false };
    assert.strictEqual(classifyCompileAbort({ ...base, raw: '<STATUS>-742,"x"</STATUS>', errors: [], meta: meta({}) }), undefined);
    assert.strictEqual(classifyCompileAbort({ ...base, raw: 'x', errors: [{ file: 'a.gpl', line: 1, code: -727, message: 'dup' }] as any, transportError: { code: 'ECONNRESET', message: 'reset' } }), undefined);
    assert.strictEqual(classifyCompileAbort({ ...base, raw: 'Command timeout (60000ms): Compile P', errors: [], transportError: { code: 'COMMAND_TIMEOUT', message: 'Command timeout (60000ms): Compile P' } }), undefined);
    assert.strictEqual(classifyCompileAbort({ ...base, raw: 'connect ECONNREFUSED', errors: [], transportError: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' } }), undefined);
    assert.strictEqual(classifyCompileAbort({ ...base, raw: 'LOW', errors: [], transportError: { code: 'LOW_MEMORY', message: '여유 메모리 2.3 MB' } }), undefined);
    assert.strictEqual(classifyCompileAbort({ command: 'Compile P', ok: true, raw: '<STATUS>0,""</STATUS>', errors: [] }), undefined);
});

test('compileAbort: 생존 확인 결과 → controllerHealth', () => {
    const at = Date.UTC(2026, 9, 22, 13, 2, 4);
    assert.deepStrictEqual(livenessFromProbe({ ok: true, raw: '<STATUS>0,""</STATUS>' }, 'Show Thread -web', at),
        { state: 'responsive', probe: 'Show Thread -web', detail: '명령 콘솔이 STATUS 로 응답함', checkedAt: new Date(at).toISOString() });
    const dead = livenessFromProbe({ ok: false, kind: 'timeout', detail: 'Command timeout (5000ms)' }, 'Show Thread -web', at);
    assert.strictEqual(dead.state, 'unresponsive');
    assert.match(dead.detail, /^timeout — /);
});

test('compileAbort: 작업 기록용 Compile 요약 — 끊긴 시도는 ABORTED, 나머지는 STATUS', () => {
    const aborted = { reason: 'ECONNRESET', command: 'Compile P', elapsedMs: 22010, outputLines: 0, hint: COMPILE_ABORT_HINT };
    assert.deepStrictEqual(summarizeCompileCommand({ command: 'Compile P', statusCode: NO_STATUS_CODE, elapsedMs: 22010 }, aborted),
        { command: 'Compile P', statusCode: NO_STATUS_CODE, elapsedMs: 22010, outcome: 'ABORTED ECONNRESET' });
    assert.strictEqual(summarizeCompileCommand({ command: 'Compile P', statusCode: 0 }).outcome, 'STATUS 0');
    assert.strictEqual(summarizeCompileCommand({ command: 'Compile P', statusCode: -742 }, aborted).outcome, 'STATUS -742');
    assert.strictEqual(summarizeCompileCommand({ command: 'Compile P', statusCode: NO_STATUS_CODE }).outcome, 'NO STATUS');
});
