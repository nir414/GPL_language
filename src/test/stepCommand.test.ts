import * as assert from 'assert';
import { test } from './harness';
import { buildStepCommand } from '../controller/stepCommand';

test('stepCommand: over — GDE 캡처 `Step <thread> -over -noerror`', () => {
    assert.strictEqual(buildStepCommand('Main', 'over'), 'Step Main -over -noerror');
});

test('stepCommand: into — GDE 캡처는 -into 플래그 없이 `Step <thread> -noerror`', () => {
    assert.strictEqual(buildStepCommand('Main', 'into'), 'Step Main -noerror');
});

test('stepCommand: out — 문서상 스위치 `-out -noerror`', () => {
    assert.strictEqual(buildStepCommand('Main', 'out'), 'Step Main -out -noerror');
});
