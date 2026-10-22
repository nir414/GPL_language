import * as assert from 'assert';
import { test } from './harness';
import { assessMemory, checkMemory, needsMemoryGuard, MemoryGuardError } from '../controller/memoryGuard';

const frame = (free: number) => `<DATA>Main Memory:\nFree: ${free} Mb\nUsed: 1 Mb</DATA><STATUS>0,""</STATUS>`;

test('memoryGuard: current memory boundary and configurable limits', () => {
    assert.strictEqual(assessMemory(frame(2.32)).level, 'blocked');
    assert.strictEqual(assessMemory(frame(2.5)).level, 'warning');
    assert.strictEqual(assessMemory(frame(4)).level, 'ok');
    assert.strictEqual(assessMemory(frame(1), { blockMb: 0, warnMb: 0 }).level, 'ok');
    assert.strictEqual(assessMemory(frame(1), { blockMb: NaN, warnMb: NaN }).level, 'blocked');
});

test('memoryGuard: incomplete, rejected and unparseable samples are unknown', () => {
    for (const raw of [frame(8).replace('</STATUS>', ''), frame(8).replace('0,""', '-1,"error"'), '<STATUS>0,""</STATUS>', '']) {
        assert.strictEqual(assessMemory(raw).level, 'unknown');
    }
});

test('memoryGuard: blocked or failed probe does not continue to command', async () => {
    let sent = false;
    for (const probe of [async () => frame(1), async (): Promise<string> => { throw new Error('offline'); }]) {
        await assert.rejects(async () => { await checkMemory(probe); sent = true; }, MemoryGuardError);
    }
    assert.strictEqual(sent, false);
    assert.strictEqual((await checkMemory(async () => frame(5))).freeMb, 5);
});

test('memoryGuard: only Compile and Start need command preflight', () => {
    for (const command of ['Compile Lib', 'start App -compile', ' START App']) { assert.ok(needsMemoryGuard(command)); }
    for (const command of ['Show Memory', 'Stop -all', 'Show StartupLog', 'Unload App']) { assert.ok(!needsMemoryGuard(command)); }
});
