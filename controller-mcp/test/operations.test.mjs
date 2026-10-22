// 작업 기록(Operation) 읽기 단위 테스트 — 확장 없이 파일 계약만으로 검증한다.
// 확장 쪽 정본은 src/controller/operationStore.ts (src/test/operationStore.test.ts).
// 실행: npm test (node --test)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  OPERATION_VERSION,
  readOperation,
  listOperations,
  activeOperations,
  operationsDir,
  describeOperation,
  operationRecovery,
} from '../src/operations.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-op-test-'));
}

/** 확장이 쓰는 것과 같은 모양의 기록 파일을 만든다. */
function writeOp(dir, overrides = {}) {
  const rec = {
    version: OPERATION_VERSION,
    operationId: 'deploy-1000-1-1',
    type: 'DEPLOY',
    state: 'RUNNING',
    phase: 'COMPILE',
    controllerId: '192.168.0.1',
    extensionInstanceId: 'win-a',
    pid: process.pid,
    host: 'TEST-PC',
    projectDir: 'C:/ws/MergeCode',
    projectName: 'MergeCode',
    createdAt: 1000,
    startedAt: 1000,
    heartbeat: 1000,
    ...overrides,
  };
  fs.mkdirSync(operationsDir(dir), { recursive: true });
  fs.writeFileSync(path.join(operationsDir(dir), `${rec.operationId}.json`), JSON.stringify(rec));
  return rec;
}

test('기록을 읽고, 생존 신호가 끊긴 진행 중 작업은 UNKNOWN 으로 본다', () => {
  const dir = tmpDir();
  writeOp(dir);
  assert.equal(readOperation('deploy-1000-1-1', { dir, now: 1000 }).state, 'RUNNING');
  // pid 가 죽었으면 진행 중이라고 믿지 않는다.
  assert.equal(readOperation('deploy-1000-1-1', { dir, now: 1000, pidAlive: () => false }).state, 'UNKNOWN');
  // heartbeat 가 끊겨도 UNKNOWN.
  assert.equal(readOperation('deploy-1000-1-1', { dir, now: 1000 + 600_000 }).state, 'UNKNOWN');
  // 파일은 고치지 않는다 — UNKNOWN 은 관측이지 확정이 아니다.
  assert.equal(JSON.parse(fs.readFileSync(path.join(operationsDir(dir), 'deploy-1000-1-1.json'), 'utf8')).state, 'RUNNING');
  assert.equal(readOperation('nope', { dir }), null);
});

test('완료 기록은 관측으로 바뀌지 않는다', () => {
  const dir = tmpDir();
  writeOp(dir, { state: 'COMPLETED', finishedAt: 2000, result: { success: true } });
  const rec = readOperation('deploy-1000-1-1', { dir, now: 1e9, pidAlive: () => false });
  assert.equal(rec.state, 'COMPLETED');
  assert.equal(rec.result.success, true);
});

test('목록은 최근 순이고 제어기별로 걸러진다', () => {
  const dir = tmpDir();
  writeOp(dir, { operationId: 'a', createdAt: 1000 });
  writeOp(dir, { operationId: 'b', createdAt: 3000, heartbeat: 3000 });
  writeOp(dir, { operationId: 'c', createdAt: 2000, controllerId: '10.0.0.9' });
  assert.deepEqual(listOperations({ dir, now: 3000 }).map((r) => r.operationId), ['b', 'c', 'a']);
  assert.deepEqual(listOperations({ dir, now: 3000, controllerId: '192.168.0.1' }).map((r) => r.operationId), ['b', 'a']);
  // 진행 중으로 관측되는 것만(a 는 heartbeat 1000 이라 3000+staleMs 밖이 아니므로 여전히 RUNNING).
  assert.deepEqual(activeOperations({ dir, now: 1e9 }).map((r) => r.operationId), []);
});

test('손상된 파일·버전 불일치는 건너뛴다', () => {
  const dir = tmpDir();
  writeOp(dir, { operationId: 'good' });
  fs.writeFileSync(path.join(operationsDir(dir), 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(operationsDir(dir), 'oldver.json'), JSON.stringify({ version: 99, operationId: 'oldver' }));
  assert.deepEqual(listOperations({ dir, now: 1000 }).map((r) => r.operationId), ['good']);
});

test('복구 지시: UNKNOWN 은 재실행 금지, 실패는 error 의 지시를 따른다(§16·§17)', () => {
  assert.equal(operationRecovery({ state: 'RUNNING', phase: 'UPLOAD' }).action, 'CHECK_OPERATION');
  assert.equal(operationRecovery({ state: 'RUNNING', phase: 'UPLOAD' }).retryCurrentCommand, false);

  const unknown = operationRecovery({ state: 'UNKNOWN' });
  assert.equal(unknown.action, 'CHECK_OPERATION');
  assert.equal(unknown.retryCurrentCommand, false);
  assert.match(unknown.detail, /결과 미확정/);

  assert.equal(operationRecovery({ state: 'COMPLETED' }).action, 'NONE');

  // 컴파일 실패는 되풀이해도 같은 결과다 — 재실행하지 않는다.
  const compileFail = operationRecovery({ state: 'FAILED', error: { retryMode: 'NONE', retryable: false, safeToRepeat: false, message: '컴파일 실패' } });
  assert.equal(compileFail.action, 'NONE');
  assert.equal(compileFail.retryCurrentCommand, false);

  // 잠금에 막힌 실패는 되풀이해도 안전하고, 같은 요청을 다시 보내면 된다.
  const locked = operationRecovery({ state: 'FAILED', error: { retryMode: 'RETRY_SAME_REQUEST', retryable: true, safeToRepeat: true, message: 'x' } });
  assert.equal(locked.retryCurrentCommand, true);
});

test('사람이 읽는 한 줄에 종류·상태·단계·경과가 담긴다', () => {
  const line = describeOperation({ operationId: 'deploy-1', type: 'DEPLOY', state: 'RUNNING', phase: 'COMPILE', startedAt: 1000 }, 100_000);
  assert.match(line, /deploy-1/);
  assert.match(line, /DEPLOY/);
  assert.match(line, /RUNNING/);
  assert.match(line, /COMPILE/);
  assert.match(line, /1분 39초/);
});

// ── 결과 전달 기억 · 요약 · 축약 (§1-EP) ───────────────────────────────────────────────
import {
  DeliveredResultMemory,
  isTerminalOperationState,
  summarizeOperationResult,
  compactOperationResult,
  compactOperation,
  compactOperationRecord,
} from '../src/operations.js';

const deployResult = {
  success: true,
  projectName: 'MergeCode',
  compileErrorCount: 0,
  uploadStats: { uploaded: 71, skipped: 0, totalBytes: 896253, deleted: 0 },
  remoteProjectPath: '/GPL/MergeCode',
  compiledSnapshotFiles: 71,
  provenance: {
    inSync: true,
    localRevision: '0db0ea25d87caa2642edb3e2bbfa8a0f41474579',
    uploadedRevision: '0db0ea25d87caa2642edb3e2bbfa8a0f41474579',
    changedSinceUpload: [],
    notUploaded: [],
    fileCount: 71,
    verifiedBy: 'upload-manifest',
  },
};

test('전달 기억: 완료 결과는 한 번 전달하면 재조회가 redundant, 진행 중은 기록하지 않는다', () => {
  const mem = new DeliveredResultMemory();
  assert.equal(mem.check('op-1', 'COMPLETED').redundant, false);
  mem.mark('op-1', 'RUNNING');
  assert.equal(mem.check('op-1', 'RUNNING').redundant, false, '진행 중 상태는 다음 조회에 새 정보가 있다');
  mem.mark('op-1', 'COMPLETED', 5000);
  const c = mem.check('op-1', 'COMPLETED');
  assert.equal(c.redundant, true);
  assert.equal(c.deliveries, 1);
  assert.equal(c.firstAt, 5000);
  mem.mark('op-1', 'COMPLETED');
  assert.equal(mem.check('op-1', 'COMPLETED').deliveries, 2);
  // 상태가 바뀌면(이론상 FAILED 재기록) 새 결과로 본다.
  assert.equal(mem.check('op-1', 'FAILED').redundant, false);
  assert.equal(isTerminalOperationState('UNKNOWN'), false, 'UNKNOWN 은 미확정이라 다시 봐야 한다');
});

test('결과 요약 한 줄: 업로드/컴파일/동기화 상태가 목록에서 읽힌다', () => {
  assert.equal(summarizeOperationResult({ result: deployResult }), 'uploaded 71 · skipped 0 · compileErrors 0 · inSync');
  assert.equal(
    summarizeOperationResult({ result: { ...deployResult, compileErrorCount: 2, provenance: { inSync: false, changedSinceUpload: ['a', 'b', 'c'] } } }),
    'uploaded 71 · skipped 0 · compileErrors 2 · notInSync (changed 3)',
  );
  assert.equal(summarizeOperationResult({ error: { message: '컴파일 실패' } }), 'error: 컴파일 실패');
  assert.equal(summarizeOperationResult({ result: { anything: 1 } }), null);
});

test('결과 축약: 내부 해시·식별자는 빠지고 긴 배열은 잘리며 나머지 구조는 보존된다', () => {
  const c = compactOperationResult({ ...deployResult, provenance: { ...deployResult.provenance, changedSinceUpload: Array.from({ length: 13 }, (_, i) => `f${i}.gpl`) } });
  assert.equal(c.compiledSnapshotFiles, undefined);
  assert.equal(c.provenance.localRevision, undefined);
  assert.equal(c.provenance.inSync, true);
  assert.equal(c.uploadStats.uploaded, 71);
  assert.equal(c.provenance.changedSinceUpload.length, 11);
  assert.equal(c.provenance.changedSinceUpload[10], '…(+3)');
  assert.equal(compactOperationResult(null), null);
});

test('목록 항목·상세 축약: 식별/상태/요약만 남고 pid·host·heartbeat 는 빠진다', () => {
  const rec = {
    version: 1, operationId: 'deploy-1', type: 'DEPLOY', state: 'COMPLETED', phase: 'ERROR_CHECK', pid: 1, host: 'PC',
    heartbeat: 2000, controllerId: '192.168.0.1', extensionInstanceId: 'win', projectDir: 'C:/ws/MergeCode', projectName: 'MergeCode',
    idempotencyKey: 'k', createdAt: 1000, startedAt: 1000, finishedAt: 2000, result: deployResult,
  };
  const item = compactOperation(rec, 3000);
  assert.deepEqual(Object.keys(item), ['operationId', 'type', 'state', 'phase', 'projectName', 'createdAt', 'finishedAt', 'summary', 'resultSummary']);
  assert.match(item.resultSummary, /uploaded 71/);
  const detail = compactOperationRecord(rec);
  assert.equal(detail.pid, undefined);
  assert.equal(detail.heartbeat, undefined);
  assert.equal(detail.idempotencyKey, undefined);
  assert.equal(detail.projectDir, 'C:/ws/MergeCode');
  assert.equal(detail.result.provenance.uploadedRevision, undefined);
});

// ── Start 뒤 메인 쓰레드 Error 요약(§1-EU) ──────────────────────────────────────

import { summarizeOperationResult as summarizeOperationResultForRuntimeError } from '../src/operations.js';

test('summarizeOperationResult: runtimeError 가 있으면 목록 요약에 코드·위치가 붙는다', () => {
  const rec = { result: { success: true, compileErrorCount: 0, runtimeError: { threadName: 'AntiBodyR2', statusCode: -1509, file: '_robot_ExtraModuleHandler.gpl', line: 484 } } };
  assert.equal(summarizeOperationResultForRuntimeError(rec), 'compileErrors 0 · runtimeError -1509 @ _robot_ExtraModuleHandler.gpl:484');
});
