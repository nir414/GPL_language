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

test('parseThreadList: pipe (-web) format, skips header/divider', () => {
  const raw = [
    '<DATA>',
    'Name|State|Project',
    'Main|Paused|MergeCode',
    '----|-----|-------',
    'Worker|Running|MergeCode',
    '</DATA><STATUS>0,"Success"</STATUS>',
  ].join('\n');
  const { threads } = parseThreadList(raw);
  assert.equal(threads.length, 2);
  assert.deepEqual(threads.map((t) => t.name), ['Main', 'Worker']);
});
