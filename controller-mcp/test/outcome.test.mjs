// outcome.js — 전송 결과 분류와 도달성 판정. 2026-08-31 실측 사건(Unload 타임아웃 → 2.5분 refused → 재부팅 없이 복귀)이
// 다시 "제어기 다운" 결론으로 승격되지 않는지를 고정한다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEND_OUTCOME_NOT_SENT,
  SEND_OUTCOME_UNKNOWN,
  taggedError,
  sendOutcomeOf,
  commandTraits,
  commandFailureResult,
  classifyReachability,
  UnknownCommandMemory,
  unknownCommandResult,
  normalizeCommandKey,
  commandFamily,
  UNKNOWN_COMMAND_STATUS,
} from '../src/outcome.js';

// ── sendOutcomeOf ─────────────────────────────────────────────────────────

test('sendOutcomeOf: 태그가 있으면 그것을 그대로 쓴다', () => {
  assert.equal(sendOutcomeOf(taggedError('정책 보류', SEND_OUTCOME_NOT_SENT)), SEND_OUTCOME_NOT_SENT);
  assert.equal(sendOutcomeOf(taggedError('브리지 모호', SEND_OUTCOME_UNKNOWN)), SEND_OUTCOME_UNKNOWN);
});

test('sendOutcomeOf: 연결 자체가 안 된 오류(errno/문구)는 not-sent — 명령이 나가지 않았다', () => {
  assert.equal(sendOutcomeOf(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), SEND_OUTCOME_NOT_SENT);
  assert.equal(sendOutcomeOf(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' })), SEND_OUTCOME_NOT_SENT);
  assert.equal(sendOutcomeOf(new Error('connect ECONNREFUSED 192.168.0.1:1402')), SEND_OUTCOME_NOT_SENT);
});

test('sendOutcomeOf: 타임아웃은 unknown — 제어기가 실행했을 수 있다(실패로 단정 금지)', () => {
  assert.equal(sendOutcomeOf(new Error('Command timed out after 15000ms: Unload GPL_Code')), SEND_OUTCOME_UNKNOWN);
  assert.equal(sendOutcomeOf(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), SEND_OUTCOME_UNKNOWN);
  assert.equal(sendOutcomeOf(Object.assign(new Error('x'), { code: 'ECONNRESET' })), SEND_OUTCOME_UNKNOWN);
});

// ── commandTraits ─────────────────────────────────────────────────────────

test('commandTraits: Unload/Load/Compile/Start 만 채널 교란 가능(확장 TRAITS_BY_KIND 와 같은 목록)', () => {
  for (const c of ['Unload GPL_Code', 'load /flash/projects/X', 'Compile GPL_Code', 'Start GPL_Code -break']) {
    assert.equal(commandTraits(c).mayDisruptChannel, true, c);
    assert.equal(commandTraits(c).mutability, 'state-changing', c);
  }
  // Stop 은 근거가 없어 포함하지 않는다(2026-08-31 자료: STATUS 0 + 직후 Show Thread 정상).
  for (const c of ['Stop -all', 'Break GPL_Code', 'Step GPL_Code', 'Continue GPL_Code']) {
    assert.equal(commandTraits(c).mayDisruptChannel, false, c);
  }
});

test('commandTraits: 조회 명령은 read-only, -clear 가 붙으면 상태 변경', () => {
  assert.equal(commandTraits('Show Thread -web').mutability, 'read-only');
  assert.equal(commandTraits('pd 2703').mutability, 'read-only');
  assert.equal(commandTraits('ErrorLog -web ,10').mutability, 'read-only');
  assert.equal(commandTraits('ErrorLog -clear').mutability, 'state-changing');
});

// ── commandFailureResult ──────────────────────────────────────────────────

test('commandFailureResult: Unload 타임아웃 → outcome=unknown, controllerHealth=unconfirmed, wait-and-probe', () => {
  const r = commandFailureResult('Unload GPL_Code', new Error('Command timed out after 15000ms: Unload GPL_Code'));
  assert.equal(r.ok, false);
  assert.equal(r.outcome, SEND_OUTCOME_UNKNOWN);
  assert.equal(r.reason, 'command-timeout');
  assert.equal(r.controllerHealth, 'unconfirmed');
  assert.equal(r.causalRelation, 'unconfirmed');
  assert.equal(r.status, null);
  assert.equal(r.traits.mayDisruptChannel, true);
  assert.match(r.note, /실패했다는 뜻이 아니다/);
  assert.match(r.recommendedAction, /^wait-and-probe/);
  assert.match(r.recommendedAction, /연결 거부를 제어기 다운의 증거로 쓰지 말/);
  assert.match(r.recommendedAction, /곧바로 재전송하지 말/);
});

test('commandFailureResult: 조회 명령 타임아웃 → unknown 이지만 probe-then-decide (채널 교란 문구 없음)', () => {
  const r = commandFailureResult('Show Thread -web', new Error('Command timed out after 8000ms'));
  assert.equal(r.outcome, SEND_OUTCOME_UNKNOWN);
  assert.equal(r.traits.mayDisruptChannel, false);
  assert.match(r.recommendedAction, /^probe-then-decide/);
});

test('commandFailureResult: 정책 보류/연결 거부 → not-sent, 그대로 재시도 안전', () => {
  const held = commandFailureResult('Start GPL_Code', taggedError('정책이 보류했다', SEND_OUTCOME_NOT_SENT));
  assert.equal(held.outcome, SEND_OUTCOME_NOT_SENT);
  assert.equal(held.reason, 'not-sent');
  assert.equal(held.controllerHealth, 'unaffected-by-this-command');
  assert.match(held.recommendedAction, /다시 보내도 안전/);
  assert.equal(held.causalRelation, undefined, 'not-sent 에는 인과 필드를 두지 않는다');

  const refused = commandFailureResult('Unload GPL_Code', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
  assert.equal(refused.outcome, SEND_OUTCOME_NOT_SENT);
});

// ── classifyReachability ──────────────────────────────────────────────────

test('classifyReachability: ECONNREFUSED → command-channel-unavailable, controllerHealth 는 unconfirmed', () => {
  const a = classifyReachability({ host: '192.168.0.1', code: 'ECONNREFUSED', icmpAlive: true });
  assert.equal(a.assessment.state, 'command-channel-unavailable');
  assert.equal(a.assessment.confidence, 'high');
  assert.equal(a.assessment.controllerCrashConfirmed, false);
  assert.equal(a.controllerHealth.state, 'unconfirmed');
  assert.equal(a.observations.tcp1402, 'refused');
  assert.equal(a.observations.icmp, 'reachable');
  assert.equal(a.observations.route, 'ambiguous', '라우트를 특정하지 않았으면 ambiguous 로 명시한다(#22 함정)');
  // 채널 교란 뒤 일시적 사용 불가가 대안 설명에 반드시 있어야 한다(2026-08-31 실측).
  assert.ok(a.assessment.alternativeExplanations.some((e) => e.includes('일시적 사용 불가')), JSON.stringify(a.assessment));
  assert.equal(a.assessment.alternativeExplanations.length, 3);
});

test('classifyReachability: refused verdict 는 관측만 단정하고 제어기 다운/전원 재투입을 말하지 않는다', () => {
  const a = classifyReachability({ host: '192.168.0.1', code: 'ECONNREFUSED', icmpAlive: true });
  assert.match(a.verdict, /새 연결이 거부됨\(refused\)/);
  assert.match(a.verdict, /확정할 수 없다/);
  // 종전 문구("제어기 소프트웨어 다운/재시작 중")가 되살아나지 않도록 고정.
  assert.doesNotMatch(a.verdict, /소프트웨어 다운/);
  assert.doesNotMatch(a.verdict, /전원 재투입|Power cycle/i);
  assert.match(a.recommendedAction, /^wait-and-retry/);
  assert.match(a.recommendedAction, /전원 재투입·재부팅을 권고하기 전에 사용자에게/);
});

test('classifyReachability: ICMP만 응답 → unresponsive/medium, 전부 무응답 → host-unreachable + unreachable', () => {
  const busy = classifyReachability({ host: 'h', code: 'ETIMEDOUT', icmpAlive: true });
  assert.equal(busy.assessment.state, 'command-channel-unresponsive');
  assert.equal(busy.assessment.confidence, 'medium');
  assert.equal(busy.controllerHealth.state, 'unconfirmed');
  assert.equal(busy.observations.tcp1402, 'timeout');

  const dead = classifyReachability({ host: 'h', code: 'ETIMEDOUT', icmpAlive: false });
  assert.equal(dead.assessment.state, 'host-unreachable');
  assert.equal(dead.controllerHealth.state, 'unreachable');
  assert.match(dead.recommendedAction, /^ask-user/);
});

test('classifyReachability: ping 판정 불가 → inconclusive/low, 어떤 경우에도 healthy 가 되지 않는다', () => {
  const a = classifyReachability({ host: 'h', code: undefined, icmpAlive: null });
  assert.equal(a.assessment.state, 'inconclusive');
  assert.equal(a.assessment.confidence, 'low');
  assert.equal(a.observations.icmp, 'unknown');
  assert.equal(a.observations.tcp1402, 'error');

  for (const code of ['ECONNREFUSED', 'ETIMEDOUT', undefined]) {
    for (const icmpAlive of [true, false, null]) {
      const r = classifyReachability({ host: 'h', code, icmpAlive });
      assert.notEqual(r.controllerHealth.state, 'healthy', `${code}/${icmpAlive}: 도달성 프로브만으로 healthy 를 말하지 않는다`);
    }
  }
});

// ── UnknownCommandMemory (STATUS -714 추측 재시도 차단) ───────────────────

test('normalizeCommandKey / commandFamily: 공백·대소문자 무시, show 계열은 두 번째 낱말까지, 스위치는 제외', () => {
  assert.equal(normalizeCommandKey('  Show   Project  '), 'show project');
  assert.equal(commandFamily('Show Project -all'), 'show project');
  assert.equal(commandFamily('show  thread  -web'), 'show thread');
  assert.equal(commandFamily('Unload GPL_Code'), 'unload');
  assert.equal(commandFamily('-web'), '');
  assert.equal(commandFamily(''), '');
});

test('UnknownCommandMemory: 같은 명령의 재전송은 차단하고 캐시 결과를 준다 (표기 정규화 포함)', () => {
  const m = new UnknownCommandMemory();
  assert.equal(m.check('Show Project').blocked, false, '처음에는 보내야 한다');
  m.note('Show Project');
  for (const variant of ['Show Project', 'show project', '  SHOW   PROJECT ']) {
    const c = m.check(variant);
    assert.equal(c.blocked, true, variant);
    assert.equal(c.previous.command, 'Show Project');
    assert.match(c.hint, /이미 STATUS -714/);
    assert.match(c.hint, /다시 보내지 않았다/);
    assert.match(c.hint, /표기를 바꿔 추측하지 말고/);
  }
  m.note('Show Project');
  assert.equal(m.check('Show Project').previous.count, 2);
  assert.equal(m.size, 1);
});

test('UnknownCommandMemory: 같은 계열의 다른 표기는 막지 않고 형제 목록만 알린다 (존재할 수도 있는 명령을 닫지 않는다)', () => {
  const m = new UnknownCommandMemory();
  m.note('Show Project');
  m.note('Show Project -all');
  const c = m.check('Show Project -verbose');
  assert.equal(c.blocked, false, '새 표기는 그대로 보낸다');
  assert.deepEqual(c.relatedUnknown.sort(), ['Show Project', 'Show Project -all']);
  // 다른 계열은 영향 없음
  assert.deepEqual(m.check('Show Thread -web').relatedUnknown, []);
  assert.deepEqual(m.check('Unload GPL_Code').relatedUnknown, []);
});

test('UnknownCommandMemory: 빈 명령은 기억하지 않는다', () => {
  const m = new UnknownCommandMemory();
  m.note('   ');
  m.note(undefined);
  assert.equal(m.size, 0);
});

test('unknownCommandResult: 전송하지 않았음을 sent:false·cached 로 드러내고 STATUS 는 -714 로 채운다', () => {
  const m = new UnknownCommandMemory();
  m.note('Show Trace');
  const r = unknownCommandResult('Show Trace', m.check('Show Trace'));
  assert.equal(r.ok, false);
  assert.equal(r.sent, false);
  assert.equal(r.cached, true);
  assert.equal(r.outcome, 'completed', '제어기가 이미 확정 거부한 것이므로 결과 미확정이 아니다');
  assert.equal(r.status.code, UNKNOWN_COMMAND_STATUS);
  assert.equal(r.previousAttempts, 1);
});

test('UnknownCommandMemory: list() 로 이 세션의 -714 이력을 낸다(진단용)', () => {
  const m = new UnknownCommandMemory();
  m.note('Show Project');
  m.note('Show Project');
  m.note('Show Trace');
  assert.deepEqual(
    m.list().sort((a, b) => a.command.localeCompare(b.command)),
    [{ command: 'Show Project', count: 2 }, { command: 'Show Trace', count: 1 }],
  );
});
