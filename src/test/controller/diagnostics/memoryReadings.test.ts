import * as assert from 'assert';
import { test } from '../../harness';
import {
    MEMORY_READING_REUSE_MS,
    MemoryReading,
    MemoryReadingStore,
    formatMemoryReadingValue,
    isMemoryProbeCommand,
    isReadingReusable,
} from '../../../controller/diagnostics/memoryReadings';
import { buildSystemInfoItems } from '../../../views/tree/systemInfoItems';

const frame = (free: number) => `<DATA>Main Memory:\nFree: ${free} Mb, Segments: 14\nUsed: 2.7 Mb, Segments: 2166</DATA><STATUS>0,""</STATUS>`;
const IP = '192.168.0.102';

test('memoryReadings: 정상 종결 응답만 측정으로 기록하고 구독자에게 알린다', () => {
    const store = new MemoryReadingStore();
    const seen: MemoryReading[] = [];
    const sub = store.onDidRecord(r => seen.push(r));
    assert.strictEqual(store.record(IP, frame(8).replace('</STATUS>', ''), 1), null, '잘린 응답');
    assert.strictEqual(store.record(IP, frame(8).replace('0,""', '-1,"err"'), 2), null, '거부 응답');
    assert.strictEqual(store.record(IP, '<STATUS>0,""</STATUS>', 3), null, 'Free 없음');
    const r = store.record(IP, frame(0.9653), 4, 'Show Memory -all');
    assert.ok(r);
    assert.strictEqual(r.info.freeMb, 0.9653);
    assert.strictEqual(store.latest(IP), r);
    assert.deepStrictEqual(seen.map(x => x.at), [4]);
    sub.dispose();
    store.record(IP, frame(7), 5);
    assert.strictEqual(seen.length, 1, '해제한 구독자는 받지 않는다');
});

test('memoryReadings: 측정 뒤 상태 변경이 없고 기간 안일 때만 재사용한다', () => {
    const r: MemoryReading = { ip: IP, at: 1000, info: { freeMb: 5, usedMb: null, segments: null, freeSegments: null, fileDescriptorsFree: null, fileDescriptorsUsed: null }, raw: frame(5), command: 'Show Memory' };
    assert.ok(isReadingReusable(r, undefined, 1000 + MEMORY_READING_REUSE_MS));
    assert.ok(!isReadingReusable(r, undefined, 1001 + MEMORY_READING_REUSE_MS), '기간 초과');
    assert.ok(!isReadingReusable(r, undefined, 999), '미래 측정(시계 역행)');
    assert.ok(!isReadingReusable(r, { at: 1500, reason: 'Stop -all' }, 2000), '측정 뒤 상태 변경');
    assert.ok(!isReadingReusable(r, { at: 1000, reason: 'Compile x' }, 2000), '같은 ms 변경은 뒤로 친다');
    assert.ok(isReadingReusable(r, { at: 900, reason: 'Stop -all' }, 2000), '측정 전 변경은 무관');
    assert.ok(!isReadingReusable(undefined, undefined, 2000));
    assert.ok(!isReadingReusable(r, undefined, 1000, 0), '재사용 끔');
});

test('memoryReadings: 저장소의 재사용은 제어기별 상태 변경을 따른다', () => {
    const store = new MemoryReadingStore();
    store.record(IP, frame(5), 1000);
    store.record('10.0.0.9', frame(6), 1000);
    assert.ok(store.reusable(IP, 2000));
    store.noteChange(IP, 1500, 'Start App -compile -event');
    assert.strictEqual(store.reusable(IP, 2000), undefined);
    assert.ok(store.reusable('10.0.0.9', 2000), '다른 제어기의 변경은 영향 없음');
    store.noteChange(IP, 1200, 'FTP 업로드');
    assert.strictEqual(store.lastChange(IP)?.at, 1500, '늦게 도착한 옛 변경이 최신을 덮지 않는다');
    store.record(IP, frame(4), 1600);
    assert.strictEqual(store.reusable(IP, 2000)?.info.freeMb, 4, '변경 뒤 새 측정은 재사용 가능');
    store.clear(IP);
    assert.strictEqual(store.latest(IP), undefined);
    assert.ok(store.latest('10.0.0.9'));
});

test('memoryReadings: 측정 명령 판별과 표기', () => {
    assert.ok(isMemoryProbeCommand('Show Memory'));
    assert.ok(isMemoryProbeCommand('  show   memory -all'));
    assert.ok(!isMemoryProbeCommand('Show Thread  -web'));
    assert.ok(!isMemoryProbeCommand('ShowMemory'));
    const r = new MemoryReadingStore().record(IP, frame(7.7756), 1);
    assert.ok(r);
    assert.strictEqual(formatMemoryReadingValue(r), 'Free: 7.7756 MB');
});

test('systemInfoItems: 메모리 행은 측정값 정본을 그린다(없으면 행 없음)', () => {
    const temperature = { readings: [], raw: '', sampledAt: 0, complete: false, note: '미지원' } as any;
    const reading = new MemoryReadingStore().record(IP, frame(0.9653), Date.UTC(2026, 10, 3, 8, 20, 17), 'Show Memory');
    assert.ok(reading);
    const items = buildSystemInfoItems({ memory: reading, flashResp: null, cpuResp: null, temperature });
    const mem = items.find(i => i.label === '메모리');
    assert.ok(mem);
    assert.strictEqual(mem.value, 'Free: 0.9653 MB');
    assert.match(mem.tooltip ?? '', /^Show Memory · .* 측정\nMain Memory:/);
    const none = buildSystemInfoItems({ memory: undefined, flashResp: null, cpuResp: null, temperature });
    assert.ok(!none.some(i => i.label === '메모리'));
});
