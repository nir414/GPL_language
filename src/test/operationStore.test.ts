import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
    OPERATION_VERSION,
    activeOperations,
    beginOperation,
    findActiveByIdempotencyKey,
    listOperations,
    newOperationId,
    operationFilePath,
    operationLogTag,
    readOperation,
    sweepOperations,
    withObservedState,
} from '../controller/operationStore';
import type { OperationRecord } from '../controller/operationStore';

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-operation-test-'));
}

/** 타이머 없이(heartbeatIntervalMs 0) 고정 시각으로 도는 작업 핸들. */
function begin(dir: string, over: Partial<Parameters<typeof beginOperation>[0]> = {}, now = 1_000) {
    return beginOperation(
        { type: 'DEPLOY', controllerId: '192.168.0.1', ...over },
        { dir, now: () => now, heartbeatIntervalMs: 0, pid: process.pid, host: 'TEST-PC' },
    );
}

test('operationStore: 시작하면 RUNNING 기록이 파일로 남고 단계 전이가 반영된다', () => {
    const dir = tmpDir();
    const op = begin(dir, { projectDir: 'C:\\ws\\MergeCode' });
    const read = () => JSON.parse(fs.readFileSync(op.filePath, 'utf8')) as OperationRecord;

    assert.strictEqual(read().version, OPERATION_VERSION);
    assert.strictEqual(read().state, 'RUNNING');
    assert.strictEqual(read().phase, 'PREPARE');
    assert.strictEqual(read().controllerId, '192.168.0.1');
    assert.strictEqual(read().projectDir, 'C:\\ws\\MergeCode');

    op.setPhase('UPLOAD');
    assert.strictEqual(read().phase, 'UPLOAD');
    op.describeTarget({ projectName: 'MergeCode' });
    assert.strictEqual(read().projectName, 'MergeCode');
});

test('operationStore: complete/fail 은 결과를 남기고 멱등이다', () => {
    const dir = tmpDir();
    const ok = begin(dir);
    ok.complete({ success: true, projectName: 'MergeCode' });
    const done = readOperation(ok.operationId, { dir })!;
    assert.strictEqual(done.state, 'COMPLETED');
    assert.strictEqual((done.result as any).success, true);
    assert.ok(done.finishedAt);

    // 두 번째 호출은 첫 결과를 덮지 않는다(예외 경로의 finally 에서 다시 불려도 안전).
    ok.fail({ code: 'X', message: 'y', retryable: false, retryMode: 'NONE', safeToRepeat: false });
    assert.strictEqual(readOperation(ok.operationId, { dir })!.state, 'COMPLETED');

    const bad = begin(dir);
    bad.fail({ code: 'DEPLOY_COMPILE', message: '컴파일 실패', retryable: false, retryMode: 'NONE', safeToRepeat: false });
    const failed = readOperation(bad.operationId, { dir })!;
    assert.strictEqual(failed.state, 'FAILED');
    assert.strictEqual(failed.error?.code, 'DEPLOY_COMPILE');
    assert.strictEqual(failed.error?.retryable, false);
});

test('operationStore: 생존 신호가 끊긴 진행 중 작업은 읽을 때 UNKNOWN — 파일은 고치지 않는다', () => {
    const dir = tmpDir();
    const op = begin(dir);
    // 죽은 프로세스가 남긴 기록처럼 보이게 한다.
    const stale = readOperation(op.operationId, { dir, now: 1_000, pidAlive: () => false })!;
    assert.strictEqual(stale.state, 'UNKNOWN', '보유자가 죽었으면 진행 중이라고 믿지 않는다');
    const fresh = readOperation(op.operationId, { dir, now: 1_000, pidAlive: () => true })!;
    assert.strictEqual(fresh.state, 'RUNNING');
    // heartbeat 가 오래돼도 UNKNOWN.
    assert.strictEqual(readOperation(op.operationId, { dir, now: 1_000 + 600_000 })!.state, 'UNKNOWN');
    // 파일 자체는 RUNNING 그대로여야 한다 — UNKNOWN 은 관측이지 확정이 아니다.
    assert.strictEqual(JSON.parse(fs.readFileSync(op.filePath, 'utf8')).state, 'RUNNING');
    // 끝난 기록은 관측으로 바뀌지 않는다.
    op.complete({});
    assert.strictEqual(readOperation(op.operationId, { dir, now: 1_000, pidAlive: () => false })!.state, 'COMPLETED');
});

test('operationStore: 같은 idempotencyKey 의 진행 중 작업을 찾는다(중복 배포 차단)', () => {
    const dir = tmpDir();
    const first = begin(dir, { idempotencyKey: 'gpl.deploy:c/ws/mergecode' });
    const found = findActiveByIdempotencyKey('gpl.deploy:c/ws/mergecode', { dir, now: 1_000 });
    assert.strictEqual(found?.operationId, first.operationId);

    // 끝나면 더 이상 걸리지 않는다 — 다음 배포는 정상적으로 시작돼야 한다.
    first.complete({});
    assert.strictEqual(findActiveByIdempotencyKey('gpl.deploy:c/ws/mergecode', { dir, now: 1_000 }), undefined);
    // 다른 키는 막지 않는다.
    begin(dir, { idempotencyKey: 'gpl.quickCompile:c/ws/mergecode' });
    assert.strictEqual(findActiveByIdempotencyKey('gpl.deploy:c/ws/mergecode', { dir, now: 1_000 }), undefined);
    assert.ok(findActiveByIdempotencyKey('gpl.quickCompile:c/ws/mergecode', { dir, now: 1_000 }));
});

test('operationStore: 목록은 최근 순·제어기별, 진행 중만 따로 볼 수 있다', () => {
    const dir = tmpDir();
    const a = begin(dir, { controllerId: '192.168.0.1' }, 1_000);
    const b = begin(dir, { controllerId: '192.168.0.1' }, 2_000);
    begin(dir, { controllerId: '10.0.0.9' }, 3_000);
    a.complete({});

    const mine = listOperations({ dir, now: 2_000, controllerId: '192.168.0.1' });
    assert.deepStrictEqual(mine.map(r => r.operationId), [b.operationId, a.operationId]);
    assert.deepStrictEqual(activeOperations({ dir, now: 2_000, controllerId: '192.168.0.1' }).map(r => r.operationId), [b.operationId]);
});

test('operationStore: sweep 은 진행 중인 기록을 남기고 보관 기간이 지난 것만 지운다', () => {
    const dir = tmpDir();
    const oldDone = begin(dir, {}, 1_000);
    oldDone.complete({});
    // 생존 신호가 계속 갱신되는 진행 중 작업(마지막 heartbeat 를 늦은 시각으로).
    const running = begin(dir, {}, 600_000);

    assert.strictEqual(sweepOperations({ dir, now: 1_000 + 10_000, keepMs: 60_000 }), 0, '보관 기간 안이면 남긴다 — 타임아웃 직후의 조회가 반드시 성공해야 한다');
    assert.strictEqual(sweepOperations({ dir, now: 601_000, keepMs: 60_000 }), 1, '보관 기간이 지난 완료분만 지운다');
    assert.strictEqual(fs.existsSync(operationFilePath(oldDone.operationId, dir)), false);
    assert.ok(fs.existsSync(operationFilePath(running.operationId, dir)), '진행 중 기록은 지우지 않는다');

    // 생존 신호가 끊긴 기록(UNKNOWN)은 보관 기간 안에는 남고, 넘기면 지운다(무한 누적 방지).
    assert.strictEqual(sweepOperations({ dir, now: 601_000 + 30_000, keepMs: 60_000 }), 0);
    assert.ok(fs.existsSync(operationFilePath(running.operationId, dir)));
    assert.strictEqual(sweepOperations({ dir, now: 601_000 + 600_000, keepMs: 60_000 }), 1);
    assert.strictEqual(fs.existsSync(operationFilePath(running.operationId, dir)), false);
});

test('operationStore: id 는 파일명으로 안전하고, 로그 태그에 대상이 드러난다', () => {
    assert.match(newOperationId('DEPLOY', 123, 7), /^deploy-123-7-\d+$/);
    const rec = { operationId: 'deploy-1', extensionInstanceId: '8f4c1234-abcd', projectName: 'MergeCode' };
    assert.strictEqual(operationLogTag(rec), '[op=deploy-1 ext=8f4c1234 project=MergeCode]');
    assert.strictEqual(operationLogTag({ operationId: 'x' }), '[op=x]');
    // withObservedState 는 종료 상태를 건드리지 않는다.
    const done = { state: 'FAILED', heartbeat: 0, pid: -1 } as unknown as OperationRecord;
    assert.strictEqual(withObservedState(done).state, 'FAILED');
});
