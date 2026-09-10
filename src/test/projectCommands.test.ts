import * as assert from 'assert';
import { test } from './harness';
import {
    ProjectCommandIo,
    ProjectCommandResponse,
    compileProject,
    loadProject,
    startProject,
    unloadProject,
} from '../controller/projectCommands';

const OK = '<DATA></DATA><STATUS>0,"Success"</STATUS>';

function status(code: number, message = 'msg'): string {
    return `<DATA></DATA><STATUS>${code},"${message}"</STATUS>`;
}

/** 컴파일 에러 라인이 든 응답 — 파서 형식은 `file:line:(code): message` 다. */
function compileError(): string {
    return '<DATA>Main.gpl:12:(-303): Undefined symbol: foo</DATA><STATUS>-746,"Compile errors"</STATUS>';
}

interface FakeIo extends ProjectCommandIo {
    sent: string[];
    compileFlags: boolean[];
    lines: string[];
}

/** 가짜 IO — 명령별 응답을 순서대로 준다. `throw:` 접두는 전송 예외를 흉내 낸다. */
function makeIo(responses: Record<string, string[] | string>): FakeIo {
    const sent: string[] = [];
    const compileFlags: boolean[] = [];
    const lines: string[] = [];
    const queues = new Map<string, string[]>();
    for (const [cmd, value] of Object.entries(responses)) {
        queues.set(cmd, Array.isArray(value) ? [...value] : [value]);
    }
    return {
        sent,
        compileFlags,
        lines,
        send: async (command, opts): Promise<ProjectCommandResponse> => {
            sent.push(command);
            compileFlags.push(opts?.forCompile === true);
            const queue = queues.get(command);
            const raw = !queue || queue.length === 0 ? '' : queue.length > 1 ? queue.shift()! : queue[0];
            if (raw.startsWith('throw:')) { throw new Error(raw.slice('throw:'.length)); }
            return { raw };
        },
        log: line => lines.push(line),
    };
}

// ── Load ───────────────────────────────────────────────────────

test('projectCommands Load: 성공 / 이미 로드됨(-745)은 둘 다 ok, 구분은 alreadyLoaded 로', async () => {
    const ok = await loadProject(makeIo({ 'Load /GPL/P': OK }), '/GPL/P');
    assert.deepStrictEqual({ ok: ok.ok, already: ok.alreadyLoaded }, { ok: true, already: undefined });
    const dup = await loadProject(makeIo({ 'Load /GPL/P': status(-745, 'already loaded') }), '/GPL/P');
    assert.deepStrictEqual({ ok: dup.ok, already: dup.alreadyLoaded }, { ok: true, already: true });
});

test('projectCommands Load: HTTP 응답은 제어기 이상 징후 — 즉시 실패로 알린다(재시도 금지 신호)', async () => {
    const io = makeIo({ 'Load /GPL/P': 'HTTP/1.1 200 OK\r\n\r\n<html>' });
    const out = await loadProject(io, '/GPL/P');
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.httpResponse, true);
    assert.match(out.failure?.message ?? '', /HTTP response detected/);
});

// ── Unload ─────────────────────────────────────────────────────

test('projectCommands Unload: 로드 안 됨은 성공(notLoaded), 쓰레드 실행 중(-750)은 blockedByActiveThread', async () => {
    const none = await unloadProject(makeIo({ 'Unload P': status(-508, 'not loaded') }), 'P');
    assert.deepStrictEqual({ ok: none.ok, notLoaded: none.notLoaded }, { ok: true, notLoaded: true });

    const busy = await unloadProject(makeIo({ 'Unload P': status(-750, 'Invalid when thread active') }), 'P');
    assert.strictEqual(busy.ok, false);
    assert.strictEqual(busy.blockedByActiveThread, true);
    assert.strictEqual(busy.failure?.code, -750);
});

// ── Compile ────────────────────────────────────────────────────

test('projectCommands Compile: 종결자 대기 플래그(forCompile)를 항상 켠다 — 잘린 응답의 거짓 성공 방지', async () => {
    const io = makeIo({ 'Compile P': OK });
    await compileProject(io, { candidates: ['P'] });
    assert.deepStrictEqual(io.compileFlags, [true]);
});

test('projectCommands Compile: 후보 이름을 순서대로 시도하고 첫 성공에서 멈춘다', async () => {
    const io = makeIo({ 'Compile A': status(-508, 'not loaded'), 'Compile B': OK });
    const out = await compileProject(io, { candidates: ['A', 'B'] });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.projectName, 'B');
    assert.deepStrictEqual(io.sent, ['Compile A', 'Compile B']);
});

test('projectCommands Compile: 일시적 STATUS(-742/-746/-752)는 1회 재시도한다', async () => {
    for (const code of [-742, -746, -752]) {
        const io = makeIo({ 'Compile P': [status(code, 'transient'), OK] });
        const out = await compileProject(io, { candidates: ['P'], retryDelayMs: 0 });
        assert.strictEqual(out.ok, true, `code=${code}`);
        assert.strictEqual(io.sent.length, 2, `code=${code}`);
    }
});

test('projectCommands Compile: 에러 라인이 있으면 일시적 STATUS 라도 재시도하지 않는다(소스 문제)', async () => {
    const io = makeIo({ 'Compile P': [compileError(), OK] });
    const out = await compileProject(io, { candidates: ['P'], retryDelayMs: 0 });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(io.sent.length, 1);
    assert.strictEqual(out.errors.length, 1);
    assert.strictEqual(out.errors[0].line, 12);
});

test('projectCommands Compile: STATUS 0 이어도 에러 라인이 있으면 실패다', async () => {
    const raw = '<DATA>Main.gpl:3:(-303): Undefined symbol: x</DATA><STATUS>0,"Success"</STATUS>';
    const out = await compileProject(makeIo({ 'Compile P': raw }), { candidates: ['P'], retryDelayMs: 0 });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.errors.length, 1);
});

test('projectCommands Compile: STATUS 가 없으면 성공으로 추정하지 않고 사유를 남긴다', async () => {
    const out = await compileProject(makeIo({ 'Compile P': '<DATA>compile successful</DATA>' }), { candidates: ['P'] });
    assert.strictEqual(out.ok, false);
    assert.match(out.attempts[0].note ?? '', /STATUS 미수신/);
});

test('projectCommands Compile: 전송 예외도 실패 결과로 돌려준다(던지지 않는다)', async () => {
    const out = await compileProject(makeIo({ 'Compile P': 'throw:socket closed' }), { candidates: ['P'] });
    assert.strictEqual(out.ok, false);
    assert.match(out.failure?.message ?? '', /socket closed/);
});

// ── Start ──────────────────────────────────────────────────────

test('projectCommands Start: 명령은 항상 buildStartCommand 로 조립한다(-event 누락 방지)', async () => {
    const io = makeIo({ 'Start P -event': OK });
    const out = await startProject(io, { projectName: 'P' });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.command, 'Start P -event');
    assert.deepStrictEqual(io.sent, ['Start P -event']);
});

test('projectCommands Start: 디버거 스위치도 같은 조립기를 거친다', async () => {
    const io = makeIo({ 'Start P -bex -break -event': OK });
    const out = await startProject(io, { projectName: 'P', breakOnEntry: true, breakOnException: true });
    assert.strictEqual(out.ok, true);
});

test('projectCommands Start: 비차단 STATUS 는 성공이되 경고로 표시한다', async () => {
    const io = makeIo({ 'Start P -event': status(-1000, 'environment warning') });
    const out = await startProject(io, { projectName: 'P' });
    assert.strictEqual(out.ok, isNonBlocking(-1000));
    if (out.ok) { assert.strictEqual(out.nonBlockingWarning, true); }
});

test('projectCommands Start: 실패 STATUS 는 failure 로 그대로 옮긴다', async () => {
    const io = makeIo({ 'Start P -event': status(-303, 'Undefined symbol') });
    const out = await startProject(io, { projectName: 'P' });
    assert.strictEqual(out.ok, false);
    assert.deepStrictEqual(
        { code: out.failure?.code, cmd: out.failure?.command },
        { code: -303, cmd: 'Start P -event' },
    );
});

// 비차단 STATUS 집합은 controllerStatusCodes 가 정본이라 테스트에서 직접 가져와 대조한다.
import { isControllerNonBlockingStatus } from '../controller/responseParser';
function isNonBlocking(code: number): boolean {
    return isControllerNonBlockingStatus(code);
}
