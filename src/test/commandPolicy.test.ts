import * as assert from 'assert';
import { test } from './harness';
import { classifyPolicyCommand, ControllerCommandPolicy, isPolicyError, PolicyIo } from '../controller/commandPolicy';
import type { ThreadInfo } from '../controller/responseParser';

// ── 가짜 I/O: 가상 시계 + 스크립트된 Show Thread 응답 ─────────────────────

function thread(name: string, state: string, project = name): ThreadInfo {
    return { name, state: state as ThreadInfo['state'], lastStatus: '', project, file: '' };
}

class FakeIo implements PolicyIo {
    t = 100_000;
    logs: string[] = [];
    sleeps: number[] = [];
    listCalls = 0;
    /** listThreads 호출마다 순서대로 소비한다. 마지막 항목은 반복. */
    lists: Array<ThreadInfo[] | null> = [[]];
    now(): number { return this.t; }
    async sleep(ms: number): Promise<void> { this.sleeps.push(ms); this.t += ms; }
    async listThreads(): Promise<ThreadInfo[] | null> {
        const i = Math.min(this.listCalls, this.lists.length - 1);
        this.listCalls++;
        // 조회에도 시간이 흐른다(무한 루프 방지·타임아웃 판정).
        this.t += 10;
        return this.lists[i];
    }
    log(m: string): void { this.logs.push(m); }
}

const OK = '<STATUS>0</STATUS>';
const REJECTED = '<STATUS>-780, "Thread not stopped"</STATUS>';

function policy(overrides = {}) {
    return new ControllerCommandPolicy({ minResumeIntervalMs: 100, settleWaitMs: 2000, startAfterCompileGapMs: 1500, pollIntervalMs: 100, ...overrides });
}

// ── 분류 ──────────────────────────────────────────────────────────────────

test('commandPolicy: 분류 — 스위치는 대상이 아니다', () => {
    assert.deepStrictEqual(classifyPolicyCommand('Step MainThread -over -noerror'), { kind: 'step', target: 'MainThread', listsAllThreads: false });
    assert.deepStrictEqual(classifyPolicyCommand('Continue MainThread -noerror'), { kind: 'continue', target: 'MainThread', listsAllThreads: false });
    assert.deepStrictEqual(classifyPolicyCommand('Stop -all'), { kind: 'stop', target: undefined, listsAllThreads: false });
    assert.deepStrictEqual(classifyPolicyCommand('Start MergeCode -break -bex'), { kind: 'start', target: 'MergeCode', listsAllThreads: false });
    assert.deepStrictEqual(classifyPolicyCommand('Load /flash/projects/MergeCode'), { kind: 'load', target: '/flash/projects/MergeCode', listsAllThreads: false });
});

test('commandPolicy: 분류 — Show Thread 변형', () => {
    assert.deepStrictEqual(classifyPolicyCommand('Show Thread  -web'), { kind: 'show-thread', target: undefined, listsAllThreads: true });
    assert.deepStrictEqual(classifyPolicyCommand('Show Thread'), { kind: 'show-thread', target: undefined, listsAllThreads: false });
    assert.deepStrictEqual(classifyPolicyCommand('Show Thread MainThread'), { kind: 'show-thread', target: 'MainThread', listsAllThreads: false });
    assert.strictEqual(classifyPolicyCommand('Show Stack MainThread').kind, 'other');
    assert.strictEqual(classifyPolicyCommand('ErrorLog').kind, 'other');
    assert.strictEqual(classifyPolicyCommand('').kind, 'other');
});

// ── R1 Step/Continue ──────────────────────────────────────────────────────

test('commandPolicy R1: 첫 Step 은 즉시 통과, STATUS 0 접수 뒤 pending', async () => {
    const p = policy();
    const io = new FakeIo();
    await p.before('Step MainThread -over -noerror', io);
    assert.strictEqual(io.listCalls, 0);
    p.after('Step MainThread -over -noerror', OK, true, io.now());
    assert.strictEqual(p.isResumePending('MainThread'), true);
});

test('commandPolicy R1: 거부된 Step(STATUS≠0)은 pending 을 만들지 않는다', async () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Step MainThread -over', REJECTED, true, io.now());
    assert.strictEqual(p.isResumePending('MainThread'), false);
});

test('commandPolicy R1: 잘린 응답(</STATUS> 없음)은 관측/접수로 쓰지 않는다', async () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Step MainThread -over', '<STATUS>0', false, io.now());
    assert.strictEqual(p.isResumePending('MainThread'), false);
});

test('commandPolicy R1: pending 중 두 번째 Step 은 정지 관측까지 기다린 뒤 통과', async () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Step MainThread -over', OK, true, io.now());
    // 1·2회 조회는 Running, 3회에 Paused.
    io.lists = [[thread('MainThread', 'Running')], [thread('MainThread', 'Running')], [thread('MainThread', 'Paused')]];
    await p.before('Step MainThread -over', io);
    assert.strictEqual(io.listCalls, 3);
    assert.strictEqual(p.isResumePending('MainThread'), false);
    assert.ok(io.logs.some(l => l.includes('정지 확인 대기')));
    assert.ok(io.logs.some(l => l.includes('정지 확인 (')));
});

test('commandPolicy R1: settleWaitMs 안에 정지하지 않으면 PolicyError(resume-pending), 목록 조회는 계속 시도', async () => {
    const p = policy({ settleWaitMs: 500, pollIntervalMs: 100 });
    const io = new FakeIo();
    p.after('Step MainThread -over', OK, true, io.now());
    io.lists = [[thread('MainThread', 'Running')]];
    await assert.rejects(p.before('Step MainThread -over', io), (err: unknown) => {
        assert.ok(isPolicyError(err));
        assert.strictEqual((err as { code: string }).code, 'resume-pending');
        assert.ok((err as Error).message.includes('보내지 않았습니다'));
        return true;
    });
    assert.ok(io.listCalls >= 2);
});

test('commandPolicy R1: 다른 쓰레드의 Step 은 pending 과 무관하게 통과', async () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Step MainThread -over', OK, true, io.now());
    await p.before('Step Worker -over', io);
    assert.strictEqual(io.listCalls, 0);
});

test('commandPolicy R1: 정지 확인 뒤에도 최소 간격을 지킨다(대기, 거부 아님)', async () => {
    const p = policy({ minResumeIntervalMs: 100 });
    const io = new FakeIo();
    p.after('Step MainThread -over', OK, true, io.now());
    // 외부 폴러가 정지를 관측해 pending 이 풀린 상황.
    p.observeThreads([thread('MainThread', 'Paused')], true);
    io.t += 30;   // 응답 뒤 30ms 만 지남
    await p.before('Step MainThread -over', io);
    assert.deepStrictEqual(io.sleeps, [70]);
});

test('commandPolicy R1: Continue 는 Running 관측으로도 pending 이 풀린다(Step 은 아니다)', () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Continue A', OK, true, io.now());
    p.after('Step B -over', OK, true, io.now());
    p.observeThreads([thread('A', 'Running'), thread('B', 'Running')], true);
    assert.strictEqual(p.isResumePending('A'), false);
    assert.strictEqual(p.isResumePending('B'), true);
});

test('commandPolicy R1: 전체 목록(-web)에 없는 쓰레드는 종료로 보아 pending 해제, 부분 응답에서는 유지', () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Step Gone -over', OK, true, io.now());
    p.after('Show Thread Other', '<DATA>Other Running</DATA><STATUS>0</STATUS>', true, io.now());
    assert.strictEqual(p.isResumePending('Gone'), true);
    p.after('Show Thread  -web', '<DATA></DATA><STATUS>0</STATUS>', true, io.now());
    assert.strictEqual(p.isResumePending('Gone'), false);
});

test('commandPolicy R1: Stop 이 나가면 그 쓰레드(또는 -all 은 전부)의 pending 해제', () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Step A -over', OK, true, io.now());
    p.after('Step B -over', OK, true, io.now());
    p.after('Stop A', OK, true, io.now());
    assert.strictEqual(p.isResumePending('A'), false);
    assert.strictEqual(p.isResumePending('B'), true);
    p.after('Stop -all', OK, true, io.now());
    assert.strictEqual(p.isResumePending('B'), false);
});

test('commandPolicy R1: Break 는 게이트하지 않는다', async () => {
    const p = policy();
    const io = new FakeIo();
    p.after('Step MainThread -over', OK, true, io.now());
    await p.before('Break MainThread', io);
    assert.strictEqual(io.listCalls, 0);
});

// ── R2 Start/Compile/Load/Unload ──────────────────────────────────────────

test('commandPolicy R2: Stopping 쓰레드가 없으면 Show Thread 1회 확인 뒤 즉시 통과(Running 은 막지 않음)', async () => {
    const p = policy();
    const io = new FakeIo();
    io.lists = [[thread('Other', 'Running'), thread('Main', 'Idle')]];
    await p.before('Start MergeCode', io);
    assert.strictEqual(io.listCalls, 1);
    assert.deepStrictEqual(io.sleeps, []);
});

test('commandPolicy R2: Stopping 이면 정착까지 기다린 뒤 통과', async () => {
    const p = policy();
    const io = new FakeIo();
    io.lists = [[thread('Main', 'Stopping')], [thread('Main', 'Stopping')], [thread('Main', 'Stopped')]];
    await p.before('Compile MergeCode', io);
    assert.strictEqual(io.listCalls, 3);
    assert.ok(io.logs.some(l => l.includes('Stopping 쓰레드 Main 정착 대기')));
    assert.ok(io.logs.some(l => l.includes('정지 정착 확인')));
});

test('commandPolicy R2: settleWaitMs 안에 정착하지 않으면 PolicyError(threads-transitioning)', async () => {
    const p = policy({ settleWaitMs: 400, pollIntervalMs: 100 });
    const io = new FakeIo();
    io.lists = [[thread('Main', 'Stopping')]];
    await assert.rejects(p.before('Start MergeCode', io), (err: unknown) => {
        assert.ok(isPolicyError(err));
        assert.strictEqual((err as { code: string }).code, 'threads-transitioning');
        return true;
    });
});

test('commandPolicy R2: 상태를 끝내 확인하지 못하면 PolicyError(threads-unknown) — 모름을 정착으로 치지 않는다', async () => {
    const p = policy({ settleWaitMs: 400, pollIntervalMs: 100 });
    const io = new FakeIo();
    io.lists = [null];
    await assert.rejects(p.before('Load /flash/projects/MergeCode', io), (err: unknown) => {
        assert.strictEqual((err as { code: string }).code, 'threads-unknown');
        return true;
    });
});

test('commandPolicy R2: 조회 실패 뒤 응답이 오면 정상 진행', async () => {
    const p = policy();
    const io = new FakeIo();
    io.lists = [null, [thread('Main', 'Idle')]];
    await p.before('Unload MergeCode', io);
    assert.strictEqual(io.listCalls, 2);
});

// ── R3 Compile → Start 완충 ────────────────────────────────────────────────

test('commandPolicy R3: Compile 완료 직후 같은 프로젝트 Start 는 남은 완충만큼 기다린다', async () => {
    const p = policy({ startAfterCompileGapMs: 1500 });
    const io = new FakeIo();
    p.after('Compile MergeCode', OK, true, io.now());
    io.t += 400;
    io.lists = [[]];
    await p.before('Start MergeCode -break', io);
    // listThreads 가 10ms 소비 → 남은 완충 1500-410 = 1090
    assert.deepStrictEqual(io.sleeps, [1090]);
    assert.ok(io.logs.some(l => l.startsWith('R3 start MergeCode')));
});

test('commandPolicy R3: 다른 프로젝트·완충 경과·옵션 0 이면 대기 없음', async () => {
    const p = policy({ startAfterCompileGapMs: 1500 });
    const io = new FakeIo();
    p.after('Compile MergeCode', OK, true, io.now());
    await p.before('Start Other', io);
    assert.deepStrictEqual(io.sleeps, []);
    io.t += 5000;
    await p.before('Start MergeCode', io);
    assert.deepStrictEqual(io.sleeps, []);
    const p0 = policy({ startAfterCompileGapMs: 0 });
    const io0 = new FakeIo();
    p0.after('Compile MergeCode', OK, true, io0.now());
    await p0.before('Start MergeCode', io0);
    assert.deepStrictEqual(io0.sleeps, []);
});

test('commandPolicy R3: Load 경로 키와 Compile 프로젝트 키는 마지막 경로 요소로 일치시킨다(대소문자 무시)', async () => {
    const p = policy({ startAfterCompileGapMs: 1000 });
    const io = new FakeIo();
    p.after('Compile mergecode', OK, true, io.now());
    await p.before('Start MergeCode', io);
    assert.strictEqual(io.sleeps.length, 1);
});

// ── 기타 ──────────────────────────────────────────────────────────────────

test('commandPolicy: 읽기 전용·기타 명령은 I/O 없이 즉시 통과', async () => {
    const p = policy();
    const io = new FakeIo();
    for (const c of ['Show Thread  -web', 'Show Stack Main', 'ErrorLog', 'Show Variable -eval Main 0 x', 'Set Break Main Foo.gpl 10', 'pd 2703']) {
        await p.before(c, io);
    }
    assert.strictEqual(io.listCalls, 0);
    assert.deepStrictEqual(io.sleeps, []);
});
