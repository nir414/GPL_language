import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatus,
  extractData,
  parseCompileErrors,
  parseThreadList,
  parseThreadDetail,
  normalizeThreadState,
  PAUSED_STATES,
  statusHint,
  isSuccess,
  compactThread,
  summarizeThreads,
  parseShowVariable,
  isTypeToken,
  splitVarLine,
} from '../src/parse.js';

test('parseStatus: success', () => {
  const s = parseStatus('<DATA>ok</DATA><STATUS>0,"Success"</STATUS>');
  assert.equal(s.code, 0);
  assert.equal(s.complete, true);
  assert.equal(isSuccess(s), true);
});

test('parseStatus: compile-error status', () => {
  const s = parseStatus('<STATUS>-742,"*Compilation errors*"</STATUS>');
  assert.equal(s.code, -742);
  assert.equal(isSuccess(s), false);
});

test('parseStatus: missing -> -9999 sentinel', () => {
  const s = parseStatus('no status here');
  assert.equal(s.code, -9999);
  assert.equal(s.complete, false);
  assert.equal(isSuccess(s), false);
});

test('extractData: pulls DATA body', () => {
  assert.equal(extractData('<DATA> hello </DATA><STATUS>0,"Success"</STATUS>'), 'hello');
});

test('parseCompileErrors: separates errors from -742 aggregate', () => {
  const raw = [
    'Compile Project: MergeCode',
    'ProtocolModule.gpl:477:(-730): *Invalid symbol type*',
    'ProtocolModule.gpl:478:(-760): *Invalid assignment*',
    'ProtocolModule.gpl:2934:(-742): *Compilation errors*: 4',
    '<STATUS>-742,"*Compilation errors*"</STATUS>',
  ].join('\n');
  const { errors, aggregate } = parseCompileErrors(raw);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].code, -730);
  assert.equal(errors[0].line, 477);
  assert.equal(errors[1].code, -760);
  assert.ok(aggregate);
  assert.equal(aggregate.count, 4);
});

test('parseThreadDetail: comma format with location', () => {
  const raw = [
    '<DATA>',
    'GPL_Code, Paused',
    '0, ""',
    'GPL_Code, MAIN, 2, Entry_Main.gpl, 6',
    '</DATA><STATUS>0,"Success"</STATUS>',
  ].join('\n');
  const d = parseThreadDetail(raw);
  assert.ok(d);
  assert.equal(d.name, 'GPL_Code');
  assert.equal(d.state, 'Paused');
  assert.equal(d.file, 'Entry_Main.gpl');
  assert.equal(d.fileLine, 6);
  assert.equal(d.process, 'MAIN');
  assert.ok(PAUSED_STATES.has(d.state));
});

test('parseThreadDetail: empty payload -> null', () => {
  assert.equal(parseThreadDetail('<DATA></DATA><STATUS>0,"Success"</STATUS>'), null);
});

test('normalizeThreadState: Stopped is not misread as Stopping', () => {
  assert.equal(normalizeThreadState('Stopped'), 'Stopped');
  assert.equal(normalizeThreadState('Stopping'), 'Stopping');
  assert.equal(normalizeThreadState('paused'), 'Paused');
  assert.equal(normalizeThreadState('Break_pt'), 'Break');
  assert.equal(PAUSED_STATES.has(normalizeThreadState('Running')), false);
});

test('statusHint: known codes get actionable guidance, unknown -> undefined', () => {
  assert.match(statusHint(-780), /프로퍼티\/메서드/);
  assert.match(statusHint(-729), /프레임 스코프/);
  assert.match(statusHint(-714), /console-commands\.md/);
  assert.match(statusHint(-9999), /성공으로 간주하지 말/);
  assert.equal(statusHint(0), undefined);
  assert.equal(statusHint(-12345), undefined);
});

// `Show Thread -web` 9열: name| state| code| "msg"| project| func| procLine| file| fileLine (런북 "GDE 1402 실측 명령 포맷")
const WEB_THREADS = [
  '<DATA>',
  'Name|State|Code|Msg|Project|Func|ProcLine|File|FileLine',
  'OpCommandRunThread1| Paused| 0| ""| MergeCode| RNDRobot.armRetract| 12| RobotModule.gpl| 1597',
  '----|-----|-------',
  'JogCommandRunThread| Running| 0| ""| MergeCode| JogModule.run| 3| JogModule.gpl| 40',
  'IdleThread| Idle| 0| ""| MergeCode| | 0| | 0',
  'ErrThread| Error| -1012| "*Some error*"| MergeCode| M.f| 1| M.gpl| 7',
  '</DATA><STATUS>0,"Success"</STATUS>',
].join('\n');

test('parseThreadList: pipe (-web) format → named keys, skips header/divider', () => {
  const { threads } = parseThreadList(WEB_THREADS);
  assert.equal(threads.length, 4);
  assert.deepEqual(threads.map((t) => t.name), ['OpCommandRunThread1', 'JogCommandRunThread', 'IdleThread', 'ErrThread']);
  const t0 = threads[0];
  assert.equal(t0.state, 'Paused');
  assert.equal(t0.project, 'MergeCode');
  assert.equal(t0.procedure, 'RNDRobot.armRetract');
  assert.equal(t0.procLine, 12);
  assert.equal(t0.file, 'RobotModule.gpl');
  assert.equal(t0.line, 1597);
  assert.equal(threads[3].statusCode, -1012);
  assert.equal(threads[3].statusMessage, '*Some error*'); // 따옴표 제거
  assert.ok(Array.isArray(t0.fields) && typeof t0.raw === 'string'); // verbose용 원문 유지
});

test('compactThread: raw/fields/빈 값 제거 — 정지 스레드는 위치 포함', () => {
  const { threads } = parseThreadList(WEB_THREADS);
  assert.deepEqual(compactThread(threads[0]), {
    name: 'OpCommandRunThread1', state: 'Paused', project: 'MergeCode', procedure: 'RNDRobot.armRetract',
    file: 'RobotModule.gpl', line: 1597, procLine: 12,
  });
  assert.deepEqual(compactThread(threads[2]), { name: 'IdleThread', state: 'Idle', project: 'MergeCode' });
  assert.equal(JSON.stringify(compactThread(threads[0])).includes('"raw"'), false);
});

test('summarizeThreads: 상태별 개수 + 정지 스레드 위치', () => {
  const { threads } = parseThreadList(WEB_THREADS);
  const s = summarizeThreads(threads);
  assert.equal(s.total, 4);
  assert.equal(s.paused, 1);
  assert.equal(s.running, 1);
  assert.equal(s.idle, 1);
  assert.equal(s.error, 1);
  assert.deepEqual(s.pausedThreads.map((t) => t.name), ['OpCommandRunThread1', 'ErrThread']);
  assert.equal(s.pausedThreads[0].line, 1597);
});

test('parseShowVariable: 단순값/객체 덤프/배열 헤더/에러 응답', () => {
  const simple = parseShowVariable('<DATA>curHand, Integer, 1</DATA><STATUS>0,"Success"</STATUS>');
  assert.deepEqual(simple, { name: 'curHand', type: 'Integer', value: '1', kind: 'simple', members: [] });
  const obj = parseShowVariable('<DATA>cmd, Object Command\ncmd.m_cmd, String, "get"\ncmd.m_rawArg, String, "7,6"</DATA><STATUS>0,"Success"</STATUS>');
  assert.equal(obj.kind, 'object');
  assert.equal(obj.members.length, 2);
  assert.equal(obj.members[1].value, '"7,6"'); // 값 속 쉼표 보존
  const arr = parseShowVariable('<DATA>buf, Double(,)</DATA><STATUS>0,"Success"</STATUS>');
  assert.equal(arr.kind, 'array');
  assert.equal(parseShowVariable('<DATA></DATA>\n<STATUS>-780,"*Unsupported procedure reference*"</STATUS>'), null);
});

test('parseShowVariable: 시스템 Location 덤프의 2열 멤버(name, value)+주석 값 (GitHub #27 실측)', () => {
  const raw = [
    '<DATA>Robot.Where(1), Object Location',
    'Robot.Where(1).Type, 0 = Cartesian',
    'Robot.Where(1).Config, 1  = Righty',
    'Robot.Where(1).X, 636',
    'Robot.Where(1).RefFrame, Null',
    'Robot.Where(1).ZClearance, 1E+32',
    '</DATA><STATUS>0,"Success"</STATUS>',
  ].join('\n');
  const loc = parseShowVariable(raw);
  assert.equal(loc.kind, 'object');
  assert.equal(loc.type, 'Object Location');
  const by = (leaf) => loc.members.find((m) => m.name.endsWith(`.${leaf}`));
  assert.deepEqual(by('X'), { name: 'Robot.Where(1).X', type: '', value: '636' });
  assert.equal(by('Type').value, '0 = Cartesian');
  assert.equal(by('RefFrame').value, 'null');
  assert.equal(isTypeToken('Object Location'), true);
  assert.equal(isTypeToken('636'), false);
  assert.deepEqual(splitVarLine('arr(0,1), Double(,), 30.5', 3), ['arr(0,1)', 'Double(,)', '30.5']);
});

test('statusHint: -712/-762/-763 추가', () => {
  assert.match(statusHint(-712), /Me\./);
  assert.match(statusHint(-762), /Angles/);
  assert.match(statusHint(-763), /Cartesian/);
});
