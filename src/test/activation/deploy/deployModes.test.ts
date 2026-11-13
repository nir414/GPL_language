import * as assert from 'assert';
import { test } from '../../harness';
import {
	buildOnlySuccessSummary,
	compileStaleReasonAfterFailure,
	deployLockOwner,
	deployModeLabel,
	deployModeName,
	deployRunSuccessSummary,
	gprReconcileAction,
	isAutoOnSaveDeploy,
	isInteractiveDeploy,
	newErrorLogNoticeParts,
	remotePathSuffix,
	uploadBatchSummary,
	libraryUploadNote,
} from '../../../activation/deploy/deployModes';

test('deployModes: 함께 올린 라이브러리 조각 — 없으면 빈 문자열', () => {
	assert.strictEqual(libraryUploadNote(undefined), '');
	assert.strictEqual(libraryUploadNote([]), '');
	assert.strictEqual(libraryUploadNote([{ raw: 'Libraries' }, { raw: 'Common\\Util' }]), ' + 라이브러리 Libraries, Common\\Util');
});

test('deployModes: 여러 프로젝트 Upload Only 요약 — 전부 성공 / 중간 실패 뒤 미실행 / 첫 건 취소', () => {
	const ok = uploadBatchSummary([{ name: 'A', outcome: 'uploaded' }, { name: 'B', outcome: 'uploaded' }]);
	assert.strictEqual(ok.success, true);
	assert.strictEqual(ok.message, 'Upload Only 완료 2/2: A, B (Stop/Compile/Start 미실행)');

	const failed = uploadBatchSummary([
		{ name: 'A', outcome: 'uploaded' }, { name: 'B', outcome: 'failed' }, { name: 'C', outcome: 'notRun' },
	]);
	assert.strictEqual(failed.success, false);
	assert.strictEqual(failed.message, 'Upload Only 중단: B 실패 / 완료 1/3: A / 미실행: C');

	const cancelled = uploadBatchSummary([{ name: 'A', outcome: 'cancelled' }, { name: 'B', outcome: 'notRun' }]);
	assert.strictEqual(cancelled.message, 'Upload Only 중단: A 취소 / 완료 0/2 / 미실행: B');
});

test('deployModes: 스냅샷 라벨 — Upload Only > Build(Quick Compile 포함) > Upload & Start > Deploy & Run', () => {
	assert.strictEqual(deployModeLabel(true, { uploadOnly: true }), 'Upload Only');
	assert.strictEqual(deployModeLabel(false, { uploadOnly: true }), 'Upload Only');
	assert.strictEqual(deployModeLabel(true), 'Build');
	assert.strictEqual(deployModeLabel(true, { quick: true }), 'Build');
	assert.strictEqual(deployModeLabel(false, { skipCompile: true }), 'Upload & Start');
	assert.strictEqual(deployModeLabel(false), 'Deploy & Run');
});

test('deployModes: 로그·알림 모드 이름 — Quick Compile 은 Build 보다 먼저, 업로드 스타트는 한국어', () => {
	assert.strictEqual(deployModeName(true, { uploadOnly: true }), 'Upload Only');
	assert.strictEqual(deployModeName(true, { quick: true }), 'Quick Compile');
	assert.strictEqual(deployModeName(false, { quick: true }), 'Quick Compile');
	assert.strictEqual(deployModeName(true), 'Build');
	assert.strictEqual(deployModeName(false, { skipCompile: true }), '업로드 스타트');
	assert.strictEqual(deployModeName(false), 'Deploy & Run');
});

test('deployModes: 잠금 owner — autoOnSave(changedFiles) 가 최우선, 그 다음 Upload Only·Quick Compile·Upload & Start·Deploy', () => {
	assert.strictEqual(deployLockOwner({ changedFiles: ['a.gpl'], quick: true, uploadOnly: true }), 'autoOnSave Quick Compile');
	assert.strictEqual(deployLockOwner({ changedFiles: [] , uploadOnly: true }), 'Upload Only');
	assert.strictEqual(deployLockOwner({ quick: true }), 'Quick Compile');
	assert.strictEqual(deployLockOwner({ skipCompile: true }), 'Upload & Start');
	assert.strictEqual(deployLockOwner(undefined), 'Deploy');
});

test('deployModes: Project.gpr 대조 동작 이름', () => {
	assert.strictEqual(gprReconcileAction({ uploadOnly: true }), '업로드');
	assert.strictEqual(gprReconcileAction({ quick: true }), 'Quick Compile');
	assert.strictEqual(gprReconcileAction(undefined), '배포');
});

test('deployModes: 대화형 여부 — nonInteractive 도 changedFiles 도 없을 때만 사람 경로', () => {
	assert.strictEqual(isInteractiveDeploy(undefined), true);
	assert.strictEqual(isInteractiveDeploy({ quick: true }), true);
	assert.strictEqual(isInteractiveDeploy({ nonInteractive: true }), false);
	assert.strictEqual(isInteractiveDeploy({ changedFiles: ['a.gpl'] }), false);
	assert.strictEqual(isInteractiveDeploy({ changedFiles: [] }), true);
	assert.strictEqual(isAutoOnSaveDeploy({ changedFiles: ['a.gpl'] }), true);
	assert.strictEqual(isAutoOnSaveDeploy({ changedFiles: [] }), false);
	assert.strictEqual(isAutoOnSaveDeploy(undefined), false);
});

test('deployModes: 원격 경로 조각은 있을 때만 붙는다', () => {
	assert.strictEqual(remotePathSuffix('/GPL/Proj'), ' / 경로: /GPL/Proj');
	assert.strictEqual(remotePathSuffix(undefined), '');
	assert.strictEqual(remotePathSuffix(''), '');
});

test('deployModes: 실패 뒤 "컴파일 검증 필요" 사유 — 업로드 스타트의 Start 실패는 컴파일 에러 수로, 그 밖은 단계명으로', () => {
	assert.strictEqual(
		compileStaleReasonAfterFailure('업로드 스타트', { skipCompile: true }, { failedPhase: 'START', compileErrors: [1, 2] }),
		'업로드 스타트: Start -compile 컴파일 에러 2건',
	);
	assert.strictEqual(
		compileStaleReasonAfterFailure('업로드 스타트', { skipCompile: true }, { failedPhase: 'START', compileErrors: [], failedStatusCode: -750 }),
		'업로드 스타트: Start 실패(STATUS -750) — 컴파일 에러 위치는 응답에서 확인되지 않음',
	);
	// 2026-11-03 inbox ③: 1402 ECONNRESET 으로 STATUS 없이 끝난 Start 는 컴파일 에러가 아니라 결과 미확정이다.
	assert.strictEqual(
		compileStaleReasonAfterFailure('업로드 스타트', { skipCompile: true }, { failedPhase: 'START', compileErrors: [], failedStatusCode: -9999, failedStatusMessage: 'No STATUS found' }),
		'업로드 스타트: Start 결과 미확정(STATUS 없음 — 연결이 끊겼을 수 있고, 제어기가 실행했을 수 있음)',
	);
	assert.strictEqual(
		compileStaleReasonAfterFailure('업로드 스타트', { skipCompile: true }, { failedPhase: 'START', compileErrors: [], failedStatusMessage: '사용자가 Start 실행을 취소했습니다' }),
		'업로드 스타트: Start 미전송(사용자가 Start 실행을 취소했습니다)',
	);
	assert.strictEqual(
		compileStaleReasonAfterFailure('Build', undefined, { failedPhase: 'COMPILE', compileErrors: [], failedStatusCode: -9999 }),
		'Build 업로드 후 Compile 결과 미확정(STATUS 없음)',
	);
	assert.strictEqual(
		compileStaleReasonAfterFailure('업로드 스타트', { skipCompile: true }, { failedPhase: 'COMPILE', compileErrors: [] }),
		'업로드 스타트 업로드 후 Compile 실패(COMPILE)',
	);
	assert.strictEqual(
		compileStaleReasonAfterFailure('Build', undefined, { failedPhase: undefined, compileErrors: [] }),
		'Build 업로드 후 Compile 실패(FAIL)',
	);
});

test('deployModes: 성공 스냅샷 summary — Build Only 는 시스템 경고 수, Deploy & Run 은 런타임 Error 위치가 우선', () => {
	assert.strictEqual(buildOnlySuccessSummary(0, ''), '빌드 성공');
	assert.strictEqual(buildOnlySuccessSummary(2, ' / 경로: /GPL/P'), '빌드 성공 / 제어기 시스템 경고 2건 / 경로: /GPL/P');
	assert.strictEqual(
		deployRunSuccessSummary({ runtimeError: undefined, sysCount: 0, deployErrCount: 0, remotePathInfo: '' }),
		'배포 성공',
	);
	assert.strictEqual(
		deployRunSuccessSummary({ runtimeError: undefined, sysCount: 1, deployErrCount: 0, remotePathInfo: ' / 경로: /GPL/P' }),
		'배포 성공 / 배포 에러 0건 / 시스템 경고 1건 / 경로: /GPL/P',
	);
	assert.strictEqual(
		deployRunSuccessSummary({ runtimeError: { statusCode: -1509, file: 'Main.gpl', line: 12 }, sysCount: 3, deployErrCount: 1, remotePathInfo: '' }),
		'배포 성공 / Start 뒤 메인 쓰레드 Error(-1509) Main.gpl:12',
	);
	assert.strictEqual(
		deployRunSuccessSummary({ runtimeError: {}, sysCount: 0, deployErrCount: 0, remotePathInfo: '' }),
		'배포 성공 / Start 뒤 메인 쓰레드 Error(?)',
	);
});

test('deployModes: 배포 완료 경고의 조각 — 새 배포 에러가 먼저, 새 시스템 경고가 뒤, 없으면 빈 배열', () => {
	assert.deepStrictEqual(newErrorLogNoticeParts({ newDeployErr: [], newSys: [] }), []);
	assert.deepStrictEqual(newErrorLogNoticeParts({ newDeployErr: ['e'], newSys: ['s', 's'] }),
		['새 배포 에러 1건', '새 제어기 시스템 경고 2건 (배포 원인 아님)']);
	assert.deepStrictEqual(newErrorLogNoticeParts({ newDeployErr: [], newSys: ['s'] }), ['새 제어기 시스템 경고 1건 (배포 원인 아님)']);
});
