// 배포 취소 요청 — VS Code 확장(src/controller/deployment/deployCancellation.ts)과 파일 계약을 공유한다.
// 사용자가 명시적으로 Stop -all/-a를 보낼 때 현재 잠금의 operationId에 취소 파일을 남긴다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEPLOY_CANCELLATION_VERSION = 1;
export const DEPLOY_CANCELLATION_DIR_NAME = 'gpl-controller';

export function deployCancellationRoot(env = process.env) {
  return env.GPL_LOCK_DIR || path.join(os.tmpdir(), DEPLOY_CANCELLATION_DIR_NAME);
}

export function sanitizeOperationId(id) {
  const safe = String(id || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'unknown';
}

export function deployCancellationFile(operationId, { dir } = {}) {
  return path.join(dir || deployCancellationRoot(), 'cancellations', `${sanitizeOperationId(operationId)}.json`);
}

export function isStopAllCommand(command) {
  return /^\s*stop\s+-(?:all|a)\s*$/i.test(command);
}

export function requestDeployCancellation(
  { operationId, controllerId, reason },
  { dir, now = Date.now, pid = process.pid } = {},
) {
  const record = {
    version: DEPLOY_CANCELLATION_VERSION,
    operationId,
    controllerId,
    reason,
    requestedAt: now(),
    requesterPid: pid,
  };
  const file = deployCancellationFile(operationId, { dir });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  try {
    fs.renameSync(tmp, file);
  } catch {
    try { fs.writeFileSync(file, JSON.stringify(record)); } finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
  }
  return record;
}
