import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatus,
  extractData,
  parseCompileErrors,
  parseThreadList,
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
