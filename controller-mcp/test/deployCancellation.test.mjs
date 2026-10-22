import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deployCancellationFile,
  isStopAllCommand,
  requestDeployCancellation,
} from '../src/deployCancellation.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-mcp-cancel-test-'));
}

test('requestDeployCancellation: 확장과 공유하는 operationId 파일을 기록한다', () => {
  const dir = tmpDir();
  try {
    const record = requestDeployCancellation({
      operationId: 'deploy:1', controllerId: '192.168.0.1', reason: 'MCP Stop -all',
    }, { dir, now: () => 1234, pid: 88 });
    const file = deployCancellationFile('deploy:1', { dir });
    assert.equal(path.basename(file), 'deploy_1.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), record);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('isStopAllCommand: Stop -all/-a만 잡는다', () => {
  assert.equal(isStopAllCommand(' Stop -all '), true);
  assert.equal(isStopAllCommand('STOP -A'), true);
  assert.equal(isStopAllCommand('Stop Worker'), false);
  assert.equal(isStopAllCommand('SoftEStop'), false);
});
