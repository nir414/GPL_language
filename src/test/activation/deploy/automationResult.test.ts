import * as assert from 'assert';
import { test } from '../../harness';
import {
	automationFailure,
	clampOperationListLimit,
	describeSessionTargetStatus,
	isAutomationFailure,
} from '../../../activation/deploy/automationResult';
import { recoveryFor } from '../../../controller/automation/automationRecovery';
import type { TargetCandidate } from '../../../controller/projects/projectTarget';

const candidates: TargetCandidate[] = [
	{ dir: 'C:\\ws\\Main', projectName: 'Main', runnable: true },
	{ dir: 'C:\\ws\\Main\\Lib', projectName: 'Lib', runnable: false, referencedAsLibraryBy: 'Main' },
];

test('automationResult: automationFailure 는 항상 복구 지시를 싣고 extra 를 그대로 펼친다', () => {
	const f = automationFailure('UNSAVED_FILES', '미저장', { files: ['a.gpl'] });
	assert.deepStrictEqual(f, { ok: false, error: 'UNSAVED_FILES', detail: '미저장', files: ['a.gpl'], recovery: recoveryFor('UNSAVED_FILES') });
	assert.ok(f.recovery, '복구 지시가 빠지면 호출자(AI)가 detail 문장을 해석해 행동을 지어낸다');
	assert.strictEqual(isAutomationFailure(f), true);
});

test('automationResult: isAutomationFailure 는 ok:false + error 문자열만 인정한다', () => {
	assert.strictEqual(isAutomationFailure({ ok: false, error: 'X', detail: '' }), true);
	assert.strictEqual(isAutomationFailure({ ok: true, error: 'X' }), false);
	assert.strictEqual(isAutomationFailure({ ok: false }), false);
	assert.strictEqual(isAutomationFailure(undefined), false);
	assert.strictEqual(isAutomationFailure(null), false);
	assert.strictEqual(isAutomationFailure('ok: false'), false);
});

test('automationResult: 세션 대상 상태 — 고정된 대상은 경로 키 비교(대소문자·구분자 무시)로 찾고 후보에 라이브러리 참조를 싣는다', () => {
	const status = describeSessionTargetStatus(candidates, 'c:/ws/main');
	assert.deepStrictEqual(status.target, { project: 'Main', dir: 'C:\\ws\\Main', runnable: true });
	assert.deepStrictEqual(status.candidates, [
		{ project: 'Main', dir: 'C:\\ws\\Main', runnable: true },
		{ project: 'Lib', dir: 'C:\\ws\\Main\\Lib', runnable: false, referencedAsLibraryBy: 'Main' },
	]);
	assert.ok(status.hint.startsWith('이 대상이 인자 없는 자동화 호출에 쓰입니다.'));
});

test('automationResult: 세션 대상이 없거나 후보에 없으면 target null + PROJECT_AMBIGUOUS 안내', () => {
	for (const dir of [undefined, 'C:\\elsewhere']) {
		const status = describeSessionTargetStatus(candidates, dir);
		assert.strictEqual(status.ok, true);
		assert.strictEqual(status.target, null);
		assert.ok(status.hint.includes('PROJECT_AMBIGUOUS'));
	}
});

test('automationResult: operations 목록 상한 — 기본 20, 1~100 으로 묶는다', () => {
	assert.strictEqual(clampOperationListLimit(undefined), 20);
	assert.strictEqual(clampOperationListLimit(0), 1);
	assert.strictEqual(clampOperationListLimit(-5), 1);
	assert.strictEqual(clampOperationListLimit(50), 50);
	assert.strictEqual(clampOperationListLimit(1000), 100);
});
