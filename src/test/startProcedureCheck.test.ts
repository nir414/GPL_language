import * as assert from 'assert';
import { test } from './harness';
import { describeStartProcedureMismatch, outermostProcedure, startProcedureName } from '../controller/commands/startProcedureCheck';

// ─── 진입점 대조 — 스택 최하단 프레임 vs .gpr ProjectStart (§1-EA) ───
// 근거: 2026-09-21 GenAdp 실측. ProjectStart="ORCH_Main.MAIN" 인데 스레드가 LineBuffer.Init 한 프레임만
// 가진 채 -757 로 죽어 MAIN 이 한 줄도 돌지 않았다.

test('startProcedureCheck: ProjectStart 의 한정자를 떼어 프로시저 이름만 쓴다', () => {
    assert.strictEqual(startProcedureName('ORCH_Main.MAIN'), 'MAIN');
    assert.strictEqual(startProcedureName('  Main  '), 'Main', '한정자가 없으면 그대로');
    assert.strictEqual(startProcedureName(''), undefined);
    assert.strictEqual(startProcedureName(undefined), undefined);
});

test('startProcedureCheck: 진입점은 스택의 마지막 줄(가장 바깥 프레임)이다', () => {
    assert.strictEqual(outermostProcedure(['Init @ LineBuffer.gpl:69']), 'Init');
    assert.strictEqual(
        outermostProcedure(['Write @ Logger.gpl:12', 'Setup @ App.gpl:40', 'MAIN @ Main.gpl:53']),
        'MAIN',
        'Show Stack 은 프레임 0 이 가장 안쪽이므로 마지막이 진입점',
    );
    assert.strictEqual(outermostProcedure([]), undefined);
});

test('startProcedureCheck: 진입점이 Init 이면 확정된 원인(모듈 초기화 훅)까지 말한다', () => {
    const msg = describeStartProcedureMismatch('ORCH_Main.MAIN', ['Init @ LineBuffer.gpl:69']);
    assert.ok(msg, '진입점이 다르면 보고해야 한다');
    assert.ok(msg.includes('MAIN') && msg.includes('Init'));
    assert.ok(msg.includes('모듈 초기화') && msg.includes('-757'), '2026-09-21 실기 재현으로 확정된 원인을 밝힌다');
    assert.ok(msg.includes('modules.htm'), '근거 문서를 가리킨다');
});

test('startProcedureCheck: 진입점이 Init 이 아닌 다른 이름이면 불일치 사실만 말한다', () => {
    const msg = describeStartProcedureMismatch('ORCH_Main.MAIN', ['Setup @ App.gpl:40']);
    assert.ok(msg && msg.includes('Setup'));
    assert.ok(!msg.includes('모듈 초기화'), 'Init 훅 원인은 Init 일 때만 말한다');
});

test('startProcedureCheck: 일치하거나 재료가 없으면 조용하다 (모름을 경고로 바꾸지 않는다)', () => {
    assert.strictEqual(describeStartProcedureMismatch('ORCH_Main.MAIN', ['MAIN @ Main.gpl:53']), undefined);
    assert.strictEqual(
        describeStartProcedureMismatch('ORCH_Main.MAIN', ['main @ Main.gpl:53']),
        undefined,
        'GPL 식별자는 대소문자를 구분하지 않는다',
    );
    assert.strictEqual(describeStartProcedureMismatch(undefined, ['Init @ LineBuffer.gpl:69']), undefined);
    assert.strictEqual(describeStartProcedureMismatch('ORCH_Main.MAIN', []), undefined);
});

test('startProcedureCheck: 작업 쓰레드·다른 프로젝트·미완결 스택은 진입점 불일치로 단정하지 않는다', () => {
    const context = { threadName: 'App', threadProject: 'App', targetProject: 'App', stackComplete: true };
    const stack = ['Init @ Module.gpl:1'];
    assert.ok(describeStartProcedureMismatch('Main.Main', stack, context));
    for (const uncertain of [{...context, threadName:'LOG_WORKER'}, {...context, threadProject:'Other'},
        {...context, targetProject:undefined}, {...context, stackComplete:false}]) {
        assert.strictEqual(describeStartProcedureMismatch('Main.Main', stack, uncertain), undefined);
    }
});

test('startProcedureCheck: 깊은 스택은 전체 프레임의 진입점을 비교한다', () => {
    const frames = [...Array.from({length: 10}, (_, i) => `Nested${i} @ App.gpl:1`), 'Main @ Main.gpl:1'];
    const context = { threadName: 'app', threadProject: 'APP', targetProject: 'App', stackComplete: true };
    assert.strictEqual(describeStartProcedureMismatch('Main.Main', frames, context), undefined);
    assert.strictEqual(describeStartProcedureMismatch('Main.Main', frames.slice(0, 8), {...context, stackComplete:false}), undefined);
});
