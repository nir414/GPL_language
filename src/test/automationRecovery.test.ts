import * as assert from 'assert';
import { test } from './harness';
import { deployPhaseCode, hasRecovery, recoveryCodes, recoveryFor } from '../controller/automationRecovery';

test('automationRecovery: 모르는 코드는 되풀이 금지 쪽으로 떨어진다', () => {
    const unknown = recoveryFor('SOMETHING_NEW');
    assert.strictEqual(unknown.retryCurrentCommand, false, '"모르면 되풀이한다"가 되면 안 된다');
    assert.strictEqual(unknown.safeToRepeat, false);
    assert.strictEqual(unknown.action, 'CHECK_OPERATION');
    // 코드가 없어도(undefined) 같은 기본값.
    assert.strictEqual(recoveryFor(undefined).retryCurrentCommand, false);
});

test('automationRecovery: 잠금·진행 중은 우회가 아니라 작업 확인으로 이끈다', () => {
    for (const code of ['DEPLOY_LOCKED', 'DEPLOY_IN_PROGRESS', 'BRIDGE_REQUEST_TIMEOUT', 'OPERATION_UNKNOWN']) {
        const r = recoveryFor(code);
        assert.strictEqual(r.action, 'CHECK_OPERATION', code);
        assert.strictEqual(r.retryCurrentCommand, false, `${code}: 같은 명령을 되풀이하게 만들면 중복 배포가 된다`);
    }
    // 잠금은 제어기를 건드리지 않았으므로 되풀이 자체는 무해하다(단, 먼저 확인할 것).
    assert.strictEqual(recoveryFor('DEPLOY_LOCKED').safeToRepeat, true);
    // 타임아웃은 이미 보냈을 수 있으므로 무해하지 않다.
    assert.strictEqual(recoveryFor('BRIDGE_REQUEST_TIMEOUT').safeToRepeat, false);
});

test('automationRecovery: 대상/창이 애매하면 특정하도록 이끈다', () => {
    assert.strictEqual(recoveryFor('PROJECT_AMBIGUOUS').action, 'RESOLVE_PROJECT');
    assert.strictEqual(recoveryFor('PROJECT_NOT_FOUND').action, 'RESOLVE_PROJECT');
    assert.strictEqual(recoveryFor('EXTENSION_AMBIGUOUS').action, 'RESOLVE_EXTENSION');
    // 어느 쪽도 명령을 그대로 되풀이하게 하지 않는다.
    for (const code of ['PROJECT_AMBIGUOUS', 'PROJECT_NOT_FOUND', 'EXTENSION_AMBIGUOUS']) {
        assert.strictEqual(recoveryFor(code).retryCurrentCommand, false, code);
    }
});

test('automationRecovery: 사람의 판단이 필요한 게이트는 ASK_USER 로 나간다', () => {
    assert.strictEqual(recoveryFor('INTERACTIVE_UI_REQUIRED').action, 'ASK_USER');
    assert.strictEqual(recoveryFor('AI_BLOCKED').action, 'ASK_USER');
    assert.strictEqual(recoveryFor('UNSAVED_FILES').action, 'SAVE_OR_ALLOW_SAVE');
});

test('automationRecovery: 컴파일 에러는 되풀이하지 않는다(소스를 고쳐야 한다)', () => {
    const r = recoveryFor('DEPLOY_COMPILE');
    assert.strictEqual(r.action, 'NONE');
    assert.strictEqual(r.retryCurrentCommand, false);
    assert.strictEqual(r.safeToRepeat, false);
});

test('automationRecovery: 배포 단계 → 코드 변환, 모든 단계가 표에 있다', () => {
    assert.strictEqual(deployPhaseCode('LOCKED'), 'DEPLOY_LOCKED');
    assert.strictEqual(deployPhaseCode(undefined), undefined);
    // DeployPhase 전체 — 새 단계를 추가하면 이 테스트가 표 누락을 잡는다.
    const phases = ['LOCKED', 'IN_PROGRESS', 'AUTO_GATE', 'UPLOAD', 'STOP', 'THREAD_CHECK', 'COMPILE_DEFERRED', 'COMPILE', 'START', 'ERROR_CHECK'];
    for (const p of phases) {
        assert.ok(hasRecovery(`DEPLOY_${p}`), `DEPLOY_${p} 의 복구 지시가 없다 — automationRecovery.ts 표에 추가할 것`);
    }
    // 자동화 오류 코드 전체도 등록돼 있어야 한다.
    for (const code of ['NO_GPL_PROJECT', 'PROJECT_NOT_FOUND', 'PROJECT_AMBIGUOUS', 'UNSAVED_FILES', 'INTERACTIVE_UI_REQUIRED', 'COMPILE_UNVERIFIED', 'AI_BLOCKED']) {
        assert.ok(hasRecovery(code), `${code} 의 복구 지시가 없다`);
    }
    assert.ok(recoveryCodes().length >= phases.length, '표가 비어 있지 않다');
});
