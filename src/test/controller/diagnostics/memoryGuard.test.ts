import * as assert from 'assert';
import { test } from '../../harness';
import { assessMemory, checkMemory, needsMemoryGuard } from '../../../controller/diagnostics/memoryGuard';

const frame = (free: number) => `<DATA>Main Memory:\nFree: ${free} Mb\nUsed: 1 Mb</DATA><STATUS>0,""</STATUS>`;

test('memoryGuard: current memory boundary and configurable limits', () => {
    assert.strictEqual(assessMemory(frame(2.32)).level, 'critical');
    assert.strictEqual(assessMemory(frame(2.5)).level, 'warning');
    assert.strictEqual(assessMemory(frame(4)).level, 'ok');
    assert.strictEqual(assessMemory(frame(1), { criticalMb: 0, warnMb: 0 }).level, 'ok');
    assert.strictEqual(assessMemory(frame(1), { criticalMb: NaN, warnMb: NaN }).level, 'critical');
});

test('memoryGuard: 어느 수준도 전송을 막지 않는다고 말한다 (2026-10-26 경고 전용)', () => {
    const critical = assessMemory(frame(0.18));
    assert.match(critical.message, /심각\(2\.5 MB 미만/);
    assert.match(critical.message, /전송은 막지 않습니다/);
    assert.match(assessMemory('').message, /검사 없이 계속합니다/);
    assert.deepStrictEqual(Object.keys(critical).sort(), ['criticalMb', 'freeMb', 'level', 'message', 'warnMb']);
});

test('memoryGuard: incomplete, rejected and unparseable samples are unknown', () => {
    for (const raw of [frame(8).replace('</STATUS>', ''), frame(8).replace('0,""', '-1,"error"'), '<STATUS>0,""</STATUS>', '']) {
        assert.strictEqual(assessMemory(raw).level, 'unknown');
    }
});

test('memoryGuard: critical or failed probe reports but never throws — the command continues', async () => {
    const reported: string[] = [];
    const low = await checkMemory(async () => frame(1), undefined, c => reported.push(c.level));
    assert.strictEqual(low.level, 'critical');
    const offline = await checkMemory(async (): Promise<string> => { throw new Error('offline'); }, undefined, c => reported.push(c.level));
    assert.strictEqual(offline.level, 'unknown');
    assert.strictEqual(offline.freeMb, null);
    assert.deepStrictEqual(reported, ['critical', 'unknown']);
    assert.strictEqual((await checkMemory(async () => frame(5))).freeMb, 5);
});

test('memoryGuard: only Compile and Start need command preflight', () => {
    for (const command of ['Compile Lib', 'start App -compile', ' START App']) { assert.ok(needsMemoryGuard(command)); }
    for (const command of ['Show Memory', 'Stop -all', 'Show StartupLog', 'Unload App']) { assert.ok(!needsMemoryGuard(command)); }
});
