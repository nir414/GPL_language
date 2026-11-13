import * as assert from 'assert';
import {
    defaultLockOwner,
    defaultOperationType,
    doneLabelFor,
    modeSuffixFor,
    stopGateLabelFor,
    totalPhasesFor,
    uploadLockStageFor,
} from '../../../controller/deployment/deployModes';
import { createDeployContext } from '../../../controller/deployment/deployContext';
import type { DeployControllerIo, DeployHostIo } from '../../../controller/deployment/deployContext';
import { emptyDeployResult } from '../../../controller/deployment/deployTypes';
import type { DeployOptions } from '../../../controller/deployment/deployTypes';
import { test } from '../../harness';

const base = { projectDir: 'C:\\p' } as unknown as DeployOptions;
const opts = (o: Partial<DeployOptions>): DeployOptions => ({ ...base, ...o });

test('deployModes: 옵션 조합별 잠금 owner·작업 종류·단계 수·라벨', () => {
    assert.strictEqual(defaultLockOwner(opts({})), 'Deploy & Run');
    assert.strictEqual(defaultLockOwner(opts({ skipStart: true })), 'Deploy');
    assert.strictEqual(defaultLockOwner(opts({ skipStop: true })), 'Quick Compile');
    assert.strictEqual(defaultLockOwner(opts({ skipCompile: true })), 'Upload & Start');
    assert.strictEqual(defaultLockOwner(opts({ uploadOnly: true })), 'Upload Only');
    assert.strictEqual(defaultOperationType(opts({ operationType: 'X' })), 'X');
    assert.strictEqual(defaultOperationType(opts({ skipStop: true })), 'QUICK_COMPILE');
    assert.strictEqual(defaultOperationType(opts({})), 'DEPLOY');
    assert.strictEqual(totalPhasesFor(opts({})), 4);
    assert.strictEqual(totalPhasesFor(opts({ skipStart: true })), 3);
    assert.strictEqual(totalPhasesFor(opts({ uploadOnly: true })), 1);
    assert.strictEqual(modeSuffixFor(opts({})), '');
    assert.strictEqual(modeSuffixFor(opts({ skipStart: true })), ' (Build Only)');
    assert.strictEqual(stopGateLabelFor(opts({ skipStop: true })), '쓰레드 상태 확인');
    assert.strictEqual(uploadLockStageFor(opts({})), 'UPLOAD+STOP');
    assert.strictEqual(uploadLockStageFor(opts({ skipStop: true })), 'UPLOAD+THREAD_CHECK');
    assert.strictEqual(doneLabelFor(opts({ skipCompile: true })), 'Upload & Start');
});

test('deployContext: 취소 결과는 멱등이고 같은 결과 참조를 돌려준다', () => {
    const lines: string[] = [];
    const stages: string[] = [];
    const host = { appendLine: (l: string) => lines.push(l) } as unknown as DeployHostIo;
    const ctx = createDeployContext({
        options: opts({}),
        cfg: { ip: '10.0.0.1', timeoutMs: 1000 } as any,
        lock: { setStage: (s: string) => stages.push(s) } as any,
        operationId: 'op-test-no-cancel-file',
        token: { isCancellationRequested: true },
        host,
        io: {} as DeployControllerIo,
    });
    assert.ok(ctx.isCancelled());
    const first = ctx.cancelResult('PREPARE');
    const second = ctx.cancelResult('다른 곳');
    assert.strictEqual(first, ctx.result);
    assert.strictEqual(second, ctx.result);
    assert.strictEqual(ctx.result.failedPhase, 'CANCELLED');
    assert.strictEqual(ctx.result.failedCommand, 'PREPARE');
    assert.deepStrictEqual(stages, ['CANCELLED']);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(ctx.result.trace.length, 1);
    assert.strictEqual(ctx.rawPreview('a\r\nb\n\nc'), 'a | b | c');
    assert.strictEqual(emptyDeployResult().success, false);
});
