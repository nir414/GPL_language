import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  UNLOAD_RISK_REFUSAL,
  PROJECT_NOT_RUNNABLE,
  assessUnloadRisk,
  compiledProjectFromResponse,
  isNotRunnableStartFailure,
  markGroupCompile,
  notRunnableStartDetail,
  parseUnloadCommand,
  readGprInfo,
  readUnloadRiskState,
  unloadRiskFilePath,
  unloadRiskRefusalResult,
  unloadTimeoutGuidance,
} from '../src/unloadRisk.js';
import { commandFailureResult, taggedError, SEND_OUTCOME_NOT_SENT } from '../src/outcome.js';
import { sessionTargetAfterDeploy, targetSourceOf } from '../src/configuredTarget.js';
import { isConsoleStopThreadName, partitionStopTargets } from '../src/stopTargets.js';
import { statusHint } from '../src/parse.js';

const OK = '<STATUS>0,"Success"</STATUS>';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-mcp-unload-risk-'));
}
function removeDir(dir) {
  // fs.rmSync 는 쓰지 않는다(비ASCII 경로 크래시 이력) — 파일·하위 폴더를 직접 지운다.
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) removeDir(p); else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

test('Unload 위험: 표시가 없으면 위험 아님(종전 동작), Unload 가 아니면 판정 대상 아님', () => {
  assert.deepEqual(parseUnloadCommand('Unload -all'), { all: true, target: undefined });
  assert.deepEqual(parseUnloadCommand('unload BinderR3'), { all: false, target: 'BinderR3' });
  assert.equal(parseUnloadCommand('Load /GPL/Lib'), null);
  assert.equal(assessUnloadRisk(null, 'Unload -all').risky, false);
  assert.equal(assessUnloadRisk({ marks: [{ project: 'Lib', at: 1, via: 'Compile' }] }, 'Show Memory'), null);
});

test('Unload 위험: 확장과 같은 파일 계약 — 표시를 켜면 앱 Unload·-all 모두 위험', () => {
  const dir = tempDir();
  try {
    assert.equal(readUnloadRiskState('192.168.0.1', { dir }), null);
    assert.ok(markGroupCompile('192.168.0.1', 'Lib', 'mcp-direct', { dir, now: 1000 }));
    assert.ok(markGroupCompile('192.168.0.1', 'lib', 'Compile', { dir, now: 2000 }), '같은 프로젝트는 갱신');
    assert.ok(unloadRiskFilePath('192.168.0.1', dir).endsWith('unload-risk-192.168.0.1.json'));
    const state = readUnloadRiskState('192.168.0.1', { dir });
    assert.equal(state.marks.length, 1);
    assert.equal(state.version, 1);
    const app = assessUnloadRisk(state, 'Unload BinderR3');
    assert.equal(app.risky, true);
    assert.equal(app.target, 'BinderR3');
    assert.equal(app.lastGroupCompileAt, 2000);
    assert.equal(assessUnloadRisk(state, 'Unload -all').scope, 'all');
    // 확장이 쓰는 모양(채널 유실·해제 기록 필드)도 그대로 읽는다.
    fs.writeFileSync(unloadRiskFilePath('10.0.0.2', dir), JSON.stringify({ version: 1, controllerId: '10.0.0.2', marks: [], updatedAt: 5, lastClearedAt: 5, lastClearedReason: 'gpl-cleared-after-channel-loss' }));
    assert.equal(assessUnloadRisk(readUnloadRiskState('10.0.0.2', { dir }), 'Unload -all').risky, false);
    fs.writeFileSync(unloadRiskFilePath('10.0.0.3', dir), '{broken');
    assert.equal(readUnloadRiskState('10.0.0.3', { dir }), null, '깨진 파일은 표시 없음');
  } finally {
    removeDir(dir);
  }
});

test('Unload 위험: 거부 결과는 보내지 않음 + confirm 은 사용자 동의 뒤에만', () => {
  const a = assessUnloadRisk({ marks: [{ project: 'Lib', at: 1, via: 'Compile' }] }, 'Unload -all');
  const r = unloadRiskRefusalResult(a, { project: 'X' });
  assert.equal(r.ok, false);
  assert.equal(r.refused, UNLOAD_RISK_REFUSAL);
  assert.equal(r.sent, false);
  assert.equal(r.outcome, SEND_OUTCOME_NOT_SENT);
  assert.match(r.detail, /6번 중 6번/);
  assert.match(r.detail, /동의를 받은 뒤에만/);
  assert.deepEqual(r.recovery.retryWith, { confirm: true });
  assert.equal(r.project, 'X');
  assert.match(unloadTimeoutGuidance(a), /재부팅/);
  for (const text of [r.detail, unloadTimeoutGuidance(a), notRunnableStartDetail('Lib', ['BinderR3'])]) {
    assert.doesNotMatch(text, /\b140[23]\b/, '채널은 이름으로 부른다');
  }
});

test('Unload 위험: 전송 계층 거부(태그 오류)는 "다시 보내도 안전" 이 아니라 거부로 돌아온다', () => {
  const a = assessUnloadRisk({ marks: [{ project: 'Lib', at: 1, via: 'Compile' }] }, 'Unload Lib');
  const refused = commandFailureResult('Unload Lib', taggedError('x', SEND_OUTCOME_NOT_SENT, { code: UNLOAD_RISK_REFUSAL, refused: UNLOAD_RISK_REFUSAL, unloadRisk: a, via: 'extension-bridge' }));
  assert.equal(refused.refused, UNLOAD_RISK_REFUSAL);
  assert.equal(refused.sent, false);
  assert.equal(refused.via, 'extension-bridge');
  assert.equal(refused.recommendedAction, undefined, '"다시 보내도 안전하다" 안내가 붙으면 안 된다');

  const notRunnable = commandFailureResult('Start Lib -compile -event', taggedError('no start', SEND_OUTCOME_NOT_SENT, { code: PROJECT_NOT_RUNNABLE, runnableCandidates: ['BinderR3'] }));
  assert.equal(notRunnable.error, PROJECT_NOT_RUNNABLE);
  assert.equal(notRunnable.sent, false);
  assert.deepEqual(notRunnable.runnableCandidates, ['BinderR3']);
  assert.equal(notRunnable.recovery.action, 'RESOLVE_PROJECT');
});

test('그룹 Compile 근거: Compile 0 / Start -compile 0·-744 만, 에러 줄·미완 응답은 아님', () => {
  assert.equal(compiledProjectFromResponse('Compile Lib', OK), 'Lib');
  assert.equal(compiledProjectFromResponse('Start Lib -compile -event', '<STATUS>-744,"*Invalid start procedure*"</STATUS>'), 'Lib');
  assert.equal(compiledProjectFromResponse('Start Lib -event', OK), null);
  assert.equal(compiledProjectFromResponse('Compile Lib', '<STATUS>-742,"*Compilation errors*"</STATUS>'), null);
  assert.equal(compiledProjectFromResponse('Compile Lib', 'A.gpl:3:(-760): *Invalid assignment*\n<STATUS>0,"Success"</STATUS>'), null);
  assert.equal(compiledProjectFromResponse('Compile Lib', 'begin compiler pass 2'), null);
});

test('.gpr 판정: ProjectStart 유무로 실행 가능 여부, .gpr 없으면 모름(null)', () => {
  const dir = tempDir();
  try {
    assert.equal(readGprInfo(dir), null);
    fs.writeFileSync(path.join(dir, 'Project.gpr'), 'ProjectName="Lib"\r\nProjectSource="A.gpl"\r\n');
    assert.deepEqual(readGprInfo(dir), { projectName: 'Lib', runnable: false });
    fs.writeFileSync(path.join(dir, 'Project.gpr'), 'ProjectName="BinderR3"\r\nProjectStart="BR3_Main.MAIN"\r\n');
    assert.deepEqual(readGprInfo(dir), { projectName: 'BinderR3', runnable: true });
    assert.equal(readGprInfo(null), null);
  } finally {
    removeDir(dir);
  }
});

test('-744 분류: START 단계 -744 만 재시도 금지 대상, statusHint 가 실행 가능한 프로젝트 지정으로 안내', () => {
  assert.equal(isNotRunnableStartFailure('START', -744), true);
  assert.equal(isNotRunnableStartFailure('START', -750), false);
  assert.equal(isNotRunnableStartFailure('COMPILE', -744), false);
  assert.match(statusHint(-744), /실행 가능한 프로젝트/);
});

test('세션 대상: 실행 불가 그룹 배포는 세션 대상을 바꾸지 않는다(2026-10-23 재현)', () => {
  const pinned = { project: 'BinderR3', dir: 'C:\\V2\\BinderR3', verified: true, via: 'extension' };
  const r = sessionTargetAfterDeploy(pinned, { project: 'Lib', dir: 'C:\\V2\\Lib', runnable: false });
  assert.equal(r.target, pinned);
  assert.equal(r.change, null);
  assert.equal(r.kept.reason, 'non-runnable');
  // 세션 대상이 없어도 그룹은 대상이 되지 않는다 — 인자 없는 upload-start 는 PROJECT_TARGET_REQUIRED 로 멈춘다.
  assert.equal(sessionTargetAfterDeploy(null, { project: 'Lib', dir: 'C:\\V2\\Lib', runnable: false }).target, null);
});

test('세션 대상: project_target 고정은 다른 앱 배포로도 바뀌지 않고, 배포가 정한 대상은 바뀌며 change 로 알린다', () => {
  const pinned = { project: 'BinderR3', dir: 'C:\\V2\\BinderR3', verified: true, via: 'extension' };
  const kept = sessionTargetAfterDeploy(pinned, { project: 'Other', dir: 'C:\\V2\\Other', runnable: true });
  assert.equal(kept.target, pinned);
  assert.equal(kept.kept.reason, 'pinned-by-project_target');
  const fromDeploy = { project: 'A', dir: 'C:\\A', verified: true, via: 'deploy' };
  const changed = sessionTargetAfterDeploy(fromDeploy, { project: 'B', dir: 'C:\\B', runnable: true });
  assert.deepEqual(changed.change, { from: 'A', to: 'B' });
  assert.equal(changed.target.via, 'deploy');
  const adopted = sessionTargetAfterDeploy(null, { project: 'B', dir: 'C:\\B', runnable: null });
  assert.deepEqual(adopted.change, { from: null, to: 'B' });
  const same = sessionTargetAfterDeploy(pinned, { project: 'BinderR3', dir: 'c:\\v2\\binderr3\\', runnable: true });
  assert.equal(same.change, null);
  assert.equal(same.kept, null);
  assert.equal(same.target.via, 'extension', '같은 대상이면 고정 출처를 유지');
});

test('대상 출처: 인자 / project_target 고정 / 배포가 정한 대상 / 미확정', () => {
  assert.equal(targetSourceOf('Lib', null), 'argument');
  assert.equal(targetSourceOf(undefined, { project: 'A', via: 'extension' }), 'session-target');
  assert.equal(targetSourceOf('  ', { project: 'A', via: 'deploy' }), 'session-target-from-deploy');
  assert.equal(targetSourceOf(undefined, null), 'unresolved');
});

test('stop_threads 건너뛰기: 영숫자·_ 이외 문자가 하나라도 있으면 이름별 Stop 을 보내지 않는다(-712)', () => {
  for (const name of ['TCPCMD', 'RWK_0', 'TCPLSN_8000', 'Main2']) assert.equal(isConsoleStopThreadName(name), true, name);
  for (const name of ['RWK[0]', 'TCPLSN:4000', 'a.b', 'x-y', 'name#1', '한글', '-all', '']) {
    assert.equal(isConsoleStopThreadName(name), false, name);
  }
  const r = partitionStopTargets(['MAIN', 'TCPLSN:4000', 'RWK_0']);
  assert.deepEqual(r.commands, ['Stop MAIN', 'Stop RWK_0']);
  assert.equal(r.skipped[0].name, 'TCPLSN:4000');
  assert.equal(r.skipped[0].statusIfSent, -712);
  assert.match(r.skipped[0].detail, /-712/);
});
