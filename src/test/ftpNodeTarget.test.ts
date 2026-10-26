import * as assert from 'assert';
import { test } from './harness';
import {
	FTP_NODE_CONTEXT,
	checkFtpNodeTarget,
	ftpEntryContext,
	isFlashFtpContext,
	isFtpFolderContext,
	projectFolderNameOf,
} from '../controller/files/ftpNodeTarget';

// PR #38 리뷰: 하위 폴더에서 프로젝트 명령이 basename 으로 나가는 문제·제어기 전환 뒤 옛 노드로 새 제어기를 조작하는 문제.

const CFG = { ip: '192.0.2.10', ftpBasePath: '/GPL', ftpFlashProjectsPath: '/flash/projects' };
const ACTION = { action: 'Unload', requireProjectFolder: true };

test('ftpNodeTarget: 저장 영역 바로 아래 폴더만 프로젝트 폴더다', () => {
	assert.strictEqual(projectFolderNameOf('/GPL/App', ['/GPL', '/flash/projects']), 'App');
	assert.strictEqual(projectFolderNameOf('/gpl/App/', ['/GPL']), 'App');
	assert.strictEqual(projectFolderNameOf('/flash/projects/Lib', ['/GPL', '/flash/projects']), 'Lib');
	assert.strictEqual(projectFolderNameOf('/GPL/App/Utils', ['/GPL', '/flash/projects']), undefined);
	assert.strictEqual(projectFolderNameOf('/GPL', ['/GPL']), undefined);
	assert.strictEqual(projectFolderNameOf('/Other/App', ['/GPL']), undefined);
	assert.strictEqual(projectFolderNameOf('/App', ['/']), undefined, '루트를 저장 영역으로 보지 않는다');
	assert.strictEqual(projectFolderNameOf('/GPL/..', ['/GPL']), undefined);
});

test('ftpNodeTarget: 펼친 폴더 안의 폴더는 프로젝트 폴더와 다른 context 를 받는다', () => {
	assert.strictEqual(ftpEntryContext(true, false, false), FTP_NODE_CONTEXT.projectFolder);
	assert.strictEqual(ftpEntryContext(true, true, false), FTP_NODE_CONTEXT.flashProjectFolder);
	assert.strictEqual(ftpEntryContext(true, false, true), FTP_NODE_CONTEXT.subFolder);
	assert.strictEqual(ftpEntryContext(true, true, true), FTP_NODE_CONTEXT.flashSubFolder);
	assert.strictEqual(ftpEntryContext(false, false, true), FTP_NODE_CONTEXT.file);
	assert.strictEqual(ftpEntryContext(false, true, false), FTP_NODE_CONTEXT.flashFile);
	for (const ctx of ['ftpFolder', 'ftpFlashFolder', 'ftpSubFolder', 'ftpFlashSubFolder']) { assert.ok(isFtpFolderContext(ctx), ctx); }
	assert.ok(!isFtpFolderContext('ftpFile') && !isFtpFolderContext(undefined));
	assert.ok(isFlashFtpContext('ftpFlashSubFolder') && !isFlashFtpContext('ftpSubFolder'));
});

test('ftpNodeTarget: 프로젝트 명령은 하위 폴더에서 거부하고 폴더 이름을 프로젝트 이름으로 준다', () => {
	const ok = checkFtpNodeTarget({ remotePath: '/GPL/App', controllerHost: '192.0.2.10' }, CFG, ACTION);
	assert.deepStrictEqual(ok, { ok: true, host: '192.0.2.10', remotePath: '/GPL/App', projectName: 'App' });
	const nested = checkFtpNodeTarget({ remotePath: '/GPL/App/Utils', controllerHost: '192.0.2.10' }, CFG, ACTION);
	assert.strictEqual(nested.ok, false);
	if (!nested.ok) {
		assert.strictEqual(nested.reason, 'not-project-folder');
		assert.match(nested.message, /\/GPL\/App\/Utils/);
	}
	// 삭제처럼 프로젝트 폴더를 요구하지 않는 동작은 하위 경로도 허용한다(제어기 검사는 그대로).
	const del = checkFtpNodeTarget({ remotePath: '/GPL/App/Utils', controllerHost: '192.0.2.10' }, CFG, { action: '삭제', requireProjectFolder: false });
	assert.ok(del.ok && del.projectName === undefined);
});

test('ftpNodeTarget: 노드를 만든 제어기가 현재 제어기가 아니면 거부한다', () => {
	const changed = checkFtpNodeTarget({ remotePath: '/GPL/App', controllerHost: '192.0.2.10' }, { ...CFG, ip: '192.0.2.20' }, ACTION);
	assert.strictEqual(changed.ok, false);
	if (!changed.ok) {
		assert.strictEqual(changed.reason, 'controller-changed');
		assert.ok(changed.message.includes('192.0.2.10') && changed.message.includes('192.0.2.20'));
	}
	for (const node of [undefined, {}, { remotePath: '/GPL/App' }, { controllerHost: '192.0.2.10' }, { remotePath: 5, controllerHost: '192.0.2.10' }]) {
		const missing = checkFtpNodeTarget(node as any, CFG, ACTION);
		assert.ok(!missing.ok && missing.reason === 'missing-target', JSON.stringify(node));
	}
	assert.ok(checkFtpNodeTarget({ remotePath: '/GPL/App', controllerHost: ' 192.0.2.10 ' }, CFG, ACTION).ok);
});
