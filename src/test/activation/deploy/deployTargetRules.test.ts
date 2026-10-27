import * as assert from 'assert';
import * as path from 'path';
import { test } from '../../harness';
import { isPathInsideDir, pickDeepestProjectDir } from '../../../activation/deploy/deployTargetRules';
import { parseAutoOnSaveMode } from '../../../activation/deploy/autoOnSaveRules';

const root = path.resolve('ws');
const p = (...parts: string[]) => path.join(root, ...parts);

test('deployTargetRules: isPathInsideDir — 하위 파일만 참, 같은 경로·형제·상위는 거짓', () => {
	assert.strictEqual(isPathInsideDir(p('Proj'), p('Proj', 'Main.gpl')), true);
	assert.strictEqual(isPathInsideDir(p('Proj'), p('Proj', 'sub', 'Util.gpl')), true);
	assert.strictEqual(isPathInsideDir(p('Proj'), p('Proj')), false);
	assert.strictEqual(isPathInsideDir(p('Proj'), p('Proj2', 'Main.gpl')), false);
	assert.strictEqual(isPathInsideDir(p('Proj'), root), false);
	// 상대 경로도 resolve 해 비교한다.
	assert.strictEqual(isPathInsideDir('ws/Proj', 'ws/Proj/Main.gpl'), true);
});

test('deployTargetRules: pickDeepestProjectDir — 품는 폴더 중 가장 깊은(긴) 것, 없으면 undefined', () => {
	const dirs = [p('Proj'), p('Proj', 'Lib'), p('Other')];
	assert.strictEqual(pickDeepestProjectDir(p('Proj', 'Lib', 'A.gpl'), dirs), p('Proj', 'Lib'));
	assert.strictEqual(pickDeepestProjectDir(p('Proj', 'A.gpl'), dirs), p('Proj'));
	assert.strictEqual(pickDeepestProjectDir(p('Elsewhere', 'A.gpl'), dirs), undefined);
	assert.strictEqual(pickDeepestProjectDir(p('Proj', 'A.gpl'), []), undefined);
	// 입력 배열은 바꾸지 않는다.
	const before = [...dirs];
	pickDeepestProjectDir(p('Proj', 'Lib', 'A.gpl'), dirs);
	assert.deepStrictEqual(dirs, before);
});

test('autoOnSaveRules: 설정값 해석 — 구 boolean 호환(true→on, false→off), 그 밖은 auto', () => {
	assert.strictEqual(parseAutoOnSaveMode(true), 'on');
	assert.strictEqual(parseAutoOnSaveMode('on'), 'on');
	assert.strictEqual(parseAutoOnSaveMode(false), 'off');
	assert.strictEqual(parseAutoOnSaveMode('off'), 'off');
	assert.strictEqual(parseAutoOnSaveMode('auto'), 'auto');
	assert.strictEqual(parseAutoOnSaveMode(undefined), 'auto');
	assert.strictEqual(parseAutoOnSaveMode('ON'), 'auto');
	assert.strictEqual(parseAutoOnSaveMode(1), 'auto');
});
