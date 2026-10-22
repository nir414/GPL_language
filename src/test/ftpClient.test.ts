/**
 * ftpClient의 순수 로직 — 원격 경로 정규화와 "폴더 비우기" 안전장치.
 * 실제 FTP 연결이 필요한 부분은 여기서 다루지 않는다(연결 전에 던지는 가드만 검증).
 */
import * as assert from 'assert';
import { test } from './harness';
import { clearRemoteDir, mirrorProject, normalizeAbsoluteRemoteDir, uploadProject } from '../controller/ftpClient';

test('normalizeAbsoluteRemoteDir: 후행/중복 슬래시를 정리한다', () => {
    assert.strictEqual(normalizeAbsoluteRemoteDir('/GPL'), '/GPL');
    assert.strictEqual(normalizeAbsoluteRemoteDir('/GPL/'), '/GPL');
    assert.strictEqual(normalizeAbsoluteRemoteDir('//GPL//sub//'), '/GPL/sub');
    assert.strictEqual(normalizeAbsoluteRemoteDir('GPL'), '/GPL');
    assert.strictEqual(normalizeAbsoluteRemoteDir('/flash/projects'), '/flash/projects');
});

test('normalizeAbsoluteRemoteDir: 빈 경로·루트는 루트로 수렴한다(호출측 가드용)', () => {
    assert.strictEqual(normalizeAbsoluteRemoteDir(''), '/');
    assert.strictEqual(normalizeAbsoluteRemoteDir('/'), '/');
    assert.strictEqual(normalizeAbsoluteRemoteDir('///'), '/');
    assert.strictEqual(normalizeAbsoluteRemoteDir('/./'), '/');
});

test('clearRemoteDir: 루트·빈 경로는 연결 전에 거부한다', async () => {
    for (const bad of ['', '/', '///']) {
        await assert.rejects(
            () => clearRemoteDir('192.0.2.1', bad),
            /안전하지 않습니다/,
            `"${bad}"는 거부되어야 한다`,
        );
    }
});

test('uploadProject/mirrorProject: 이미 취소됐으면 FTP 연결 전에 중단한다', async () => {
	for (const run of [
		() => uploadProject('192.0.2.1', '.', '/GPL/P', { isCancelled: () => true }),
		() => mirrorProject('192.0.2.1', '.', '/GPL/P', { isCancelled: () => true }),
	]) {
		await assert.rejects(run, /업로드가 취소되었습니다/);
	}
});
