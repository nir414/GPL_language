/**
 * 세션 분해(2026-10-27) 뒤에도 step → 폴 → StoppedEvent → 변수 조회 경로가 같은 명령·이벤트·캐시 규칙으로 도는지
 * vm 으로 로드한 실제 GPLDebugSession 에 모의 제어기를 붙여 검증한다. 제어기에는 연결하지 않는다.
 *
 * 실제 `_sendCmd`(차선 큐 경유)와 폴 프로브(`probeControllerCommand`)를 쓰고 전송 계층만 가짜로 바꾼다.
 * 폴은 타이머가 아니라 `_pollThreadStates()` 직접 호출로 구동해 결정적으로 만든다(`fastPoll` 의 타이머는 호출 직후 접는다).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { controllerDebugConfiguration } from '../../../project/remote/controllerProjectDebug';
import { test } from '../../harness';

const SUCCESS = '<STATUS>0,"Success"</STATUS>';
const THREAD_CMD = 'Show Thread  -web';

interface Scripted { state: 'Paused' | 'Running'; line: number }

function stepFixture() {
    const commands: string[] = [];
    const events: any[] = [];
    const errors: unknown[] = [];
    const disposable = () => ({ dispose() {} });
    const config = { ip: '192.0.2.1', port: 1402, consolePort: 1403, timeoutMs: 10000 };
    const thread: Scripted = { state: 'Paused', line: 12 };
    const hook: { onCommand?: (cmd: string) => void } = {};
    const vscode = {
        workspace: {
            workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
            getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'controller.requireStartConfirmation' ? true : fallback }),
            onDidSaveTextDocument: disposable,
        },
        window: { showWarningMessage: () => { throw new Error('이 시나리오에서 확인 모달을 띄우면 안 된다'); } },
    };
    const respond = (cmd: string): string => {
        hook.onCommand?.(cmd);
        if (cmd === THREAD_CMD) {
            return `<DATA>Probe|${thread.state}|0|0|Probe|Main.Run|10|Main.gpl|${thread.line}</DATA>${SUCCESS}`;
        }
        if (cmd === 'Show Stack Probe') { return `<DATA>Frame 0: Main.Run, Line ${thread.line}, Main.gpl</DATA>${SUCCESS}`; }
        const variable = /^Show Variable -eval Probe 0 (\w+)$/.exec(cmd);
        if (variable) { return `<DATA>${variable[1]}, Double, 1.5</DATA>${SUCCESS}`; }
        return SUCCESS;
    };
    const filename = path.resolve(__dirname, '../../../debug/session/gplDebugSession.js');
    const loaded = new Map<string, { exports: any }>();
    const load = (file: string): any => {
        const hit = loaded.get(file);
        if (hit) { return hit.exports; }
        const mod = { exports: {} as any };
        loaded.set(file, mod);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module: mod, exports: mod.exports, console, setTimeout, clearTimeout, setInterval, clearInterval, Buffer,
            require: (id: string) => stubRequire(id, file),
        }, { filename: file });
        return mod.exports;
    };
    const stubRequire = (id: string, from: string): any => {
        if (id === 'vscode') { return vscode; }
        if (id.endsWith('/controllerConnection')) {
            return {
                getControllerConfig: () => config,
                getConnectionProbeTimeoutMs: () => 1000,
                sendCommand: async (cmd: string) => { commands.push(cmd); return respond(cmd); },
                sendCommandDetailed: async (cmd: string) => { commands.push(cmd); return { raw: respond(cmd) }; },
                probeControllerCommand: async (cmd: string) => { commands.push(cmd); return { ok: true, raw: respond(cmd) }; },
            };
        }
        if (id.endsWith('/deployService')) { return {}; }
        if (id.endsWith('/deployRecord')) { return { onDidRecordCompiled: disposable }; }
        if (id.endsWith('/debugBridge')) {
            return { onDebugPollTrigger: disposable, fireDebugThreadsUpdated() {}, fireDebugProbeResult() {} };
        }
        if (id.startsWith('.')) {
            const target = createRequire(from).resolve(id);
            if (target.includes(`${path.sep}debug${path.sep}`)) { return load(target); }
        }
        return createRequire(from)(id);
    };
    const session = new (load(filename).GPLDebugSession)();
    session.sendResponse = () => {};
    session.sendEvent = (event: unknown) => events.push(event);
    session.sendErrorResponse = (_response: unknown, error: unknown) => errors.push(error);
    session._sources.updateProjectDirs = () => {};
    session._sources.buildSourceFileMap = () => {};
    session._stale.evaluateSourceStaleness = () => {};
    session._setLockedThread = () => {};
    session._bps.bpFileForms = (file: string) => [file];
    // 로컬 변수 이름은 소스 파서가 아니라 고정 목록으로 — 이 테스트의 대상은 조회 순서·재개 판정이다.
    session._symbols.getLocalVariableNames = () => ['a', 'b'];
    // 자동 폴 체인은 끈다. fastPoll 은 실제 구현(캐시 무효화 포함)을 부르되 그 타이머만 곧바로 접는다.
    const poll = session._poll;
    poll.startPolling = () => {};
    const realFastPoll = poll.fastPoll.bind(poll);
    let fastPolls = 0;
    poll.fastPoll = () => { fastPolls++; realFastPoll(); poll.stopPolling(); };
    const args = controllerDebugConfiguration({
        host: config.ip, port: config.port, consolePort: config.consolePort,
        projectName: 'Probe', projectDir: path.resolve('snapshot/Probe'), remotePath: '/GPL/Probe',
    });
    return { session, args, commands, events, errors, thread, hook, fastPolls: () => fastPolls };
}

type Fixture = ReturnType<typeof stepFixture>;

const stoppedEvents = (events: any[]) => events.filter(e => e.event === 'stopped');
/** vm 컨텍스트에서 만든 배열은 realm 이 달라 deepStrictEqual 이 거부하므로 평범한 값으로 옮긴다. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** attach → configurationDone → threads → stackTrace 까지 진행해 정지 쓰레드(Probe, line 12)를 VS Code 가 아는 상태로 만든다. */
async function attachAndStop(s: Fixture) {
    await s.session.attachRequest({}, s.args);
    await s.session.configurationDoneRequest({}, {});
    assert.deepStrictEqual(s.errors, []);
    assert.deepStrictEqual(s.commands, ['ErrorLog', 'Show Break']);
    await s.session.threadsRequest({});
    const stack: any = {};
    await s.session.stackTraceRequest(stack, { threadId: 1 });
    return stack;
}

async function openLocals(s: Fixture): Promise<number> {
    const stack: any = {};
    await s.session.stackTraceRequest(stack, { threadId: 1 });
    const scopes: any = {};
    s.session.scopesRequest(scopes, { frameId: stack.body.stackFrames[0].id });
    const locals = scopes.body.scopes.find((sc: any) => sc.name === 'Locals');
    assert.ok(locals);
    return locals.variablesReference;
}

test('세션 분해 회귀: Step → Running → Paused 가 명령 순서·StoppedEvent·캐시 무효화를 그대로 지킨다', async () => {
    const s = stepFixture();
    const stack = await attachAndStop(s);
    assert.deepStrictEqual(s.commands.slice(2), [THREAD_CMD, 'Show Stack Probe']);
    assert.strictEqual(stack.body.stackFrames[0].line, 12);
    s.session._previousThreadStates.set('Probe', 'Paused');
    const frames = s.session._frames;
    assert.strictEqual(frames.cachedFrames.get('Probe')?.length, 1);
    const genBefore = frames.frameCacheGen;
    const fastBefore = s.fastPolls();

    // Step 요청: pending 설정, 컨텍스트 리셋(clearAll), fastPoll 의 신선도 무효화 → 세대 +2
    const mark = s.commands.length;
    await s.session.nextRequest({}, { threadId: 1 });
    assert.deepStrictEqual(s.commands.slice(mark), ['Step Probe -over -noerror']);
    assert.strictEqual(s.session._pendingAction, 'step');
    assert.strictEqual(s.session._pendingThreadId, 1);
    assert.strictEqual(s.session._userActionInFlight, false);
    assert.strictEqual(s.fastPolls(), fastBefore + 1);
    assert.strictEqual(frames.frameCacheGen, genBefore + 2);
    assert.strictEqual(frames.cachedFrames.size, 0);
    assert.strictEqual(frames.frameIdToInfo.size, 0);
    assert.strictEqual(frames.frameCacheAt.size, 0);

    // pending 중 hover: 명령 없이 (실행 중)
    const hoverMark = s.commands.length;
    const hover: any = {};
    await s.session.evaluateRequest(hover, { expression: 'a', context: 'hover' });
    assert.strictEqual(hover.body.result, '(실행 중)');
    assert.strictEqual(s.commands.length, hoverMark);

    // 폴 1: Running — 정지 이벤트 없음, pending 유지, 폴 가드는 풀림
    s.thread.state = 'Running';
    const runMark = s.commands.length;
    await s.session._pollThreadStates(true, 'manual');
    assert.deepStrictEqual(s.commands.slice(runMark), [THREAD_CMD]);
    assert.strictEqual(stoppedEvents(s.events).length, 0);
    assert.strictEqual(s.session._pendingAction, 'step');
    assert.strictEqual(s.session._pollInFlight, false);
    assert.strictEqual(s.session._previousThreadStates.get('Probe'), 'Running');

    // 폴 2: Paused(다음 줄) — Show Stack 으로 이유 판정 → StoppedEvent(step), pending 해제, 프레임 캐시 재충전
    s.thread.state = 'Paused';
    s.thread.line = 14;
    const stopMark = s.commands.length;
    const genAtStop = frames.frameCacheGen;
    await s.session._pollThreadStates(true, 'manual');
    assert.deepStrictEqual(s.commands.slice(stopMark), [THREAD_CMD, 'Show Stack Probe']);
    const stopped = stoppedEvents(s.events);
    assert.strictEqual(stopped.length, 1);
    assert.strictEqual(stopped[0].body.reason, 'step');
    assert.strictEqual(stopped[0].body.threadId, 1);
    assert.strictEqual(stopped[0].body.allThreadsStopped, false);
    assert.strictEqual(s.session._pendingAction, null);
    assert.strictEqual(s.session._pendingThreadId, undefined);
    assert.strictEqual(s.session._pollInFlight, false);
    assert.strictEqual(frames.frameCacheGen, genAtStop); // 정지 확인은 세대를 올리지 않는다
    assert.strictEqual(frames.cachedFrames.get('Probe')?.[0].fileLine, 14);
    assert.ok(s.events.some(e => e.event === 'invalidated'));
    assert.ok(s.events.some(e => e.event === 'output' && /쓰레드 Probe 정지 \(step\)/.test(e.body.output)));
});

test('세션 분해 회귀: 정지 뒤 Locals 는 지역 변수마다 Show Variable -eval 을 순서대로 보낸다', async () => {
    const s = stepFixture();
    await attachAndStop(s);
    const ref = await openLocals(s);

    const mark = s.commands.length;
    const vars: any = {};
    await s.session.variablesRequest(vars, { variablesReference: ref });
    assert.deepStrictEqual(s.commands.slice(mark), [
        'Show Variable -eval Probe 0 a',
        'Show Variable -eval Probe 0 b',
    ]);
    assert.deepStrictEqual(plain(vars.body.variables.map((v: any) => [v.name, v.value])), [['a', '1.5  (Double)'], ['b', '1.5  (Double)']]);
});

test('세션 분해 회귀: Locals 조회 중 실행이 재개되면 남은 변수를 보내지 않고, pending 중에는 명령 없이 빈 목록', async () => {
    const s = stepFixture();
    await attachAndStop(s);
    const ref = await openLocals(s);

    // 첫 변수 조회가 나가는 순간 다른 경로가 step 을 보낸 것처럼 정지 컨텍스트 세대를 올린다
    s.hook.onCommand = cmd => {
        if (cmd === 'Show Variable -eval Probe 0 a') { s.session._frames.invalidateFreshness(); }
    };
    const mark = s.commands.length;
    const vars: any = {};
    await s.session.variablesRequest(vars, { variablesReference: ref });
    assert.deepStrictEqual(s.commands.slice(mark), ['Show Variable -eval Probe 0 a']);
    assert.deepStrictEqual(plain(vars.body.variables.map((v: any) => v.name)), ['a']);

    s.hook.onCommand = undefined;
    s.session._pendingAction = 'step';
    const idle = s.commands.length;
    const pendingVars: any = {};
    await s.session.variablesRequest(pendingVars, { variablesReference: ref });
    assert.strictEqual(pendingVars.body.variables.length, 0);
    assert.strictEqual(s.commands.length, idle);
});
