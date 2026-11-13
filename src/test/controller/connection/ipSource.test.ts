import * as assert from 'assert';
import { test } from '../../harness';
import { resolveControllerIp, pickIpSaveScope, describeIpSource, describeIpSourceLine } from '../../../controller/connection/ipSource';

test('제어기 IP 해석: 세션 > 워크스페이스 설정 > 마지막 연결 > User > 기본값', () => {
	const inspect = { workspaceValue: '10.0.0.5', globalValue: '10.0.0.9', defaultValue: '192.168.0.1' };
	assert.deepStrictEqual(resolveControllerIp({ sessionOverride: '1.1.1.1', inspect, lastConnected: '10.0.0.7' }), { ip: '1.1.1.1', source: 'session' });
	assert.deepStrictEqual(resolveControllerIp({ inspect, lastConnected: '10.0.0.7' }), { ip: '10.0.0.5', source: 'workspace' });
	assert.deepStrictEqual(resolveControllerIp({ inspect: { workspaceFolderValue: '10.0.0.6', workspaceValue: '10.0.0.5' } }), { ip: '10.0.0.6', source: 'workspace' });
	const last = resolveControllerIp({ inspect: { globalValue: '10.0.0.9' }, lastConnected: '10.0.0.7' });
	assert.deepStrictEqual(last, { ip: '10.0.0.7', source: 'last-connected', shadowedUser: '10.0.0.9' });
	// 마지막 연결과 User 값이 같으면 가려진 값은 없다.
	assert.deepStrictEqual(resolveControllerIp({ inspect: { globalValue: '10.0.0.7' }, lastConnected: '10.0.0.7' }), { ip: '10.0.0.7', source: 'last-connected' });
	assert.deepStrictEqual(resolveControllerIp({ inspect: { globalValue: '10.0.0.9' } }), { ip: '10.0.0.9', source: 'user' });
	assert.deepStrictEqual(resolveControllerIp({ inspect: { defaultValue: '192.168.0.1' } }), { ip: '192.168.0.1', source: 'default' });
	assert.deepStrictEqual(resolveControllerIp({ inspect: undefined }), { ip: '192.168.0.1', source: 'default' });
	// 빈 문자열·공백은 값이 아니다.
	assert.strictEqual(resolveControllerIp({ inspect: { workspaceValue: '  ', globalValue: '10.0.0.9' } }).source, 'user');
});

test('IP 저장 범위: 워크스페이스 값이 이미 있을 때만 워크스페이스, 아니면 User(새 파일을 만들지 않는다)', () => {
	assert.strictEqual(pickIpSaveScope({ workspaceValue: '10.0.0.5', globalValue: '10.0.0.9' }), 'workspace');
	assert.strictEqual(pickIpSaveScope({ globalValue: '10.0.0.9' }), 'global');
	assert.strictEqual(pickIpSaveScope({}), 'global');
	assert.strictEqual(pickIpSaveScope(undefined), 'global');
});

test('상태바 출처 문구', () => {
	assert.strictEqual(describeIpSource({ ip: 'x', source: 'workspace' }), '워크스페이스 설정');
	assert.strictEqual(describeIpSource({ ip: 'x', source: 'user' }), 'User 설정');
	const line = describeIpSourceLine({ ip: '10.0.0.7', source: 'last-connected', shadowedUser: '10.0.0.9' });
	assert.ok(line.includes('10.0.0.7') && line.includes('마지막 연결') && line.includes('10.0.0.9'));
});
