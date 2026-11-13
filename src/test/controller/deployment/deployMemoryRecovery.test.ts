import * as assert from 'assert';
import { test } from '../../harness';
import {
    classifyUnloadReply,
    needsUnloadAfterStop,
    pickUnloadCandidates,
    planMemoryRecovery,
} from '../../../controller/deployment/deployMemoryRecovery';
import type { MemoryPrecheck } from '../../../controller/diagnostics/memoryGuard';

const check = (level: MemoryPrecheck['level'], freeMb: number | null = 3): MemoryPrecheck =>
    ({ level, freeMb, warnMb: 4, criticalMb: 2.5, message: '' });

const base = { enabled: true, uploadOnly: false, skipStop: false, autoGate: false };

test('planMemoryRecovery: 업로드 전 측정이 경고·심각일 때만 시도한다', () => {
    assert.deepStrictEqual(planMemoryRecovery({ ...base, preUpload: check('warning') }), { attempt: true });
    assert.deepStrictEqual(planMemoryRecovery({ ...base, preUpload: check('critical', 1) }), { attempt: true });
    assert.strictEqual(planMemoryRecovery({ ...base, preUpload: check('ok', 9) }).attempt, false);
    assert.strictEqual(planMemoryRecovery({ ...base, preUpload: check('unknown', null) }).attempt, false, '측정 실패는 근거가 없다');
    assert.strictEqual(planMemoryRecovery({ ...base, preUpload: undefined }).attempt, false);
});

test('planMemoryRecovery: 설정 꺼짐·Upload Only·autoOnSave·정지 없는 빠른 컴파일은 하지 않는다', () => {
    const low = check('critical', 1);
    assert.strictEqual(planMemoryRecovery({ ...base, enabled: false, preUpload: low }).attempt, false);
    assert.strictEqual(planMemoryRecovery({ ...base, uploadOnly: true, preUpload: low }).attempt, false);
    assert.strictEqual(planMemoryRecovery({ ...base, autoGate: true, preUpload: low }).attempt, false);
    assert.strictEqual(planMemoryRecovery({ ...base, skipStop: true, preUpload: low }).attempt, false);
});

test('needsUnloadAfterStop: 정지 뒤 다시 잰 값이 경고 이하일 때만', () => {
    assert.strictEqual(needsUnloadAfterStop(check('warning')), true);
    assert.strictEqual(needsUnloadAfterStop(check('critical')), true);
    assert.strictEqual(needsUnloadAfterStop(check('ok', 6)), false);
    assert.strictEqual(needsUnloadAfterStop(check('unknown', null)), false);
});

test('pickUnloadCandidates: 다른 실행 프로젝트 먼저, 대상은 맨 끝 — 그룹·성격 모름은 건너뛴다', () => {
    const kinds: Record<string, { runnable: boolean } | undefined> = {
        main: { runnable: true }, other: { runnable: true }, lib_net: { runnable: false },
    };
    const r = pickUnloadCandidates({
        gplFolders: ['Main', 'Lib_Net', 'Other', 'Foreign', 'other'],
        targetName: 'main',
        kindOf: n => kinds[n.toLowerCase()],
    });
    assert.deepStrictEqual(r.unload, [{ name: 'Other', isTarget: false }, { name: 'Main', isTarget: true }]);
    assert.deepStrictEqual(r.skipped.map(s => s.name), ['Lib_Net', 'Foreign']);
    assert.match(r.skipped[0].reason, /그룹/);
    assert.match(r.skipped[1].reason, /성격을 모름/);
});

test('pickUnloadCandidates: 대상이 그룹이면 대상도 Unload 하지 않는다 · 클래식(대상 이름 없음)은 다른 것만', () => {
    const groupTarget = pickUnloadCandidates({ gplFolders: ['Lib'], targetName: 'Lib', kindOf: () => ({ runnable: false }) });
    assert.deepStrictEqual(groupTarget.unload, []);
    const classic = pickUnloadCandidates({ gplFolders: ['A', 'B'], targetName: undefined, kindOf: () => ({ runnable: true }) });
    assert.deepStrictEqual(classic.unload.map(c => c.name), ['A', 'B']);
});

test('classifyUnloadReply: 완료·로드 안 됨·-750·실패·미확정을 가른다', () => {
    const st = (code: number, msg = '') => `<STATUS>${code},"${msg}"</STATUS>`;
    assert.deepStrictEqual(classifyUnloadReply(st(0, 'Success'), true), { kind: 'unloaded' });
    assert.deepStrictEqual(classifyUnloadReply(st(-750, '*Invalid when thread active*'), true), { kind: 'thread-active' });
    assert.strictEqual(classifyUnloadReply(st(-508, '*Project not loaded*'), true).kind, 'not-loaded');
    assert.deepStrictEqual(classifyUnloadReply(st(-701, 'x'), true), { kind: 'failed', code: -701, message: 'x' });
    assert.strictEqual(classifyUnloadReply('<STATUS>0', false).kind, 'unknown', '</STATUS> 없으면 실행 여부 모름');
});
