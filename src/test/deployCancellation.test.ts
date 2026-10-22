import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
	clearDeployCancellation,
	deployCancellationFilePath,
	isDeployCancellationRequested,
	isStopAllCommand,
	readDeployCancellation,
	requestDeployCancellation,
} from '../controller/deployment/deployCancellation';

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-deploy-cancel-test-'));
}

test('deployCancellation: 요청을 프로세스 간 파일로 기록하고 작업이 끝나면 지운다', () => {
	const dir = tempDir();
	try {
		const request = requestDeployCancellation({
			operationId: 'deploy-1',
			controllerId: '192.168.0.1',
			reason: '사용자 Stop -all',
		}, { dir, now: () => 1234, pid: 77 });
		assert.strictEqual(request.requestedAt, 1234);
		assert.strictEqual(request.requesterPid, 77);
		assert.strictEqual(isDeployCancellationRequested('deploy-1', { dir }), true);
		assert.deepStrictEqual(readDeployCancellation('deploy-1', { dir }).request, request);
		clearDeployCancellation('deploy-1', { dir });
		assert.strictEqual(isDeployCancellationRequested('deploy-1', { dir }), false);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('deployCancellation: 손상된 요청 파일은 안전상 취소로 취급한다', () => {
	const dir = tempDir();
	try {
		const file = deployCancellationFilePath('deploy-2', dir);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, '{broken');
		const status = readDeployCancellation('deploy-2', { dir });
		assert.strictEqual(status.requested, true);
		assert.strictEqual(status.malformed, true);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('deployCancellation: Stop -all/-a만 배포 취소 명령으로 분류한다', () => {
	for (const command of ['Stop -all', ' stop   -A ', 'STOP -ALL']) {
		assert.strictEqual(isStopAllCommand(command), true, command);
	}
	for (const command of ['Stop Main', 'Stop', 'Stop -all now', 'SoftEStop']) {
		assert.strictEqual(isStopAllCommand(command), false, command);
	}
});
