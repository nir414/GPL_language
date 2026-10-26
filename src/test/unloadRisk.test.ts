import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
    PROJECT_NOT_RUNNABLE,
    UNLOAD_RISK_EVIDENCE,
    UNLOAD_RISK_REFUSAL,
    assessUnloadRisk,
    clearUnloadRisk,
    compiledProjectFromResponse,
    emptyUnloadRiskState,
    isNotRunnableStartFailure,
    judgeRebootEvidence,
    markGroupCompile,
    normalizeUnloadRiskState,
    noteChannelLoss,
    notRunnableStartDetail,
    parseUnloadCommand,
    startTargetOf,
    unloadRiskRefusalDetail,
    unloadRiskWarning,
    unloadTimeoutGuidance,
} from '../controller/commands/unloadRisk';
import { readUnloadRiskState, unloadRiskFilePath, updateUnloadRiskState, writeUnloadRiskState } from '../controller/commands/unloadRiskStore';
import {
    guardBeforeSend,
    isNotRunnableStartError,
    isUnloadRiskError,
    observeAfterResponse,
    setProjectKindResolver,
    unloadFailureGuidance,
} from '../controller/commands/unloadRiskGuard';
import { remoteDeleteGateAfterStop, remoteDeleteGateForThreads } from '../controller/files/remoteFolderClear';
import { sessionTargetAfterImplicitUse } from '../controller/projects/projectTarget';
import { recoveryFor } from '../controller/automation/automationRecovery';

const OK = '<STATUS>0</STATUS>';
const T0 = Date.UTC(2026, 9, 23, 9, 11, 57);

function riskyState(id = '192.168.0.1') {
    return markGroupCompile(emptyUnloadRiskState(id, T0), { project: 'Lib', at: T0, via: 'Compile' });
}

// ── 명령 해석 ──────────────────────────────────────────────────────────────

test('unloadRisk: Unload 명령 범위를 가린다(-all / 프로젝트 / 그 밖)', () => {
    assert.deepStrictEqual(parseUnloadCommand('Unload -all'), { all: true, target: undefined });
    assert.deepStrictEqual(parseUnloadCommand('  unload   BinderR3 '), { all: false, target: 'BinderR3' });
    assert.strictEqual(parseUnloadCommand('Load /GPL/Lib'), undefined);
    assert.strictEqual(parseUnloadCommand('Show Thread -web'), undefined);
    assert.strictEqual(startTargetOf('Start Lib -compile -event'), 'Lib');
    assert.strictEqual(startTargetOf('Stop -all'), undefined);
});

test('unloadRisk: 컴파일 성공 근거 — Compile STATUS 0, Start -compile 0/-744, 에러 줄·다른 STATUS 는 아님', () => {
    assert.strictEqual(compiledProjectFromResponse('Compile Lib', OK), 'Lib');
    assert.strictEqual(compiledProjectFromResponse('Start Lib -compile -event', '<STATUS>-744 *Invalid start procedure*</STATUS>'), 'Lib');
    assert.strictEqual(compiledProjectFromResponse('Start App -compile', OK), 'App');
    // -compile 없는 Start 는 컴파일하지 않는다(옛 바이너리 실행).
    assert.strictEqual(compiledProjectFromResponse('Start Lib', OK), undefined);
    assert.strictEqual(compiledProjectFromResponse('Compile Lib', '<STATUS>-742 Compilation errors</STATUS>'), undefined);
    assert.strictEqual(compiledProjectFromResponse('Compile Lib', ''), undefined, 'STATUS 미수신은 성공이 아니다');
    assert.strictEqual(compiledProjectFromResponse('Compile -all', OK), undefined);
});

// ── 상태 전이·판정 ─────────────────────────────────────────────────────────

test('unloadRisk: 표시가 없으면 위험 아님 — 종전 동작 그대로(확인 없음)', () => {
    const a = assessUnloadRisk(undefined, 'Unload -all');
    assert.ok(a);
    assert.strictEqual(a!.risky, false);
    assert.strictEqual(assessUnloadRisk(emptyUnloadRiskState('x', T0), 'Unload App')!.risky, false);
    assert.strictEqual(assessUnloadRisk(riskyState(), 'Show Memory'), undefined, 'Unload 가 아니면 판정 대상이 아니다');
});

test('unloadRisk: 그룹 Compile 뒤에는 대상이 앱이든 -all 이든 위험', () => {
    const s = riskyState();
    const all = assessUnloadRisk(s, 'Unload -all')!;
    assert.strictEqual(all.risky, true);
    assert.strictEqual(all.scope, 'all');
    assert.deepStrictEqual(all.groupProjects, ['Lib']);
    const app = assessUnloadRisk(s, 'Unload BinderR3')!;
    assert.strictEqual(app.risky, true, '10-23 17:51 앱 Unload 도 같은 증상');
    assert.strictEqual(app.target, 'BinderR3');
    // 같은 프로젝트를 다시 표시하면 시각만 갱신(중복 없음).
    const again = markGroupCompile(s, { project: 'lib', at: T0 + 1000, via: 'Start -compile' });
    assert.strictEqual(again.marks.length, 1);
    assert.strictEqual(assessUnloadRisk(again, 'Unload -all')!.lastGroupCompileAt, T0 + 1000);
});

test('unloadRisk: 재부팅 근거 — 유실 + /GPL 에 그룹 폴더 없음일 때만 해제, 모르면 유지', () => {
    const s = riskyState();
    assert.strictEqual(judgeRebootEvidence(undefined, []).reason, 'no-risk');
    // 유실 관측 없음 — /GPL 이 비어 있어도(FTP 로 지웠을 수 있다) 해제하지 않는다.
    assert.deepStrictEqual([judgeRebootEvidence(s, []).rebooted, judgeRebootEvidence(s, []).reason], [false, 'no-channel-loss']);
    // 표시보다 앞선 유실은 근거가 아니다.
    assert.strictEqual(judgeRebootEvidence(noteChannelLoss(s, T0 - 1), []).reason, 'no-channel-loss');
    const lost = noteChannelLoss(s, T0 + 60_000);
    assert.strictEqual(judgeRebootEvidence(lost, null).reason, 'listing-unavailable');
    assert.strictEqual(judgeRebootEvidence(lost, ['LIB', 'BinderR3']).reason, 'group-folder-present', '10-22 06:03 — 네트워크 재연결로 복귀, /GPL/Lib 그대로');
    const j = judgeRebootEvidence(lost, ['BinderR3']);
    assert.strictEqual(j.rebooted, true);
    assert.strictEqual(j.reason, 'gpl-cleared-after-channel-loss');
    assert.strictEqual(judgeRebootEvidence(lost, []).rebooted, true, '10-23 18:10 재부팅 직후 /GPL 비어 있음');
    const cleared = clearUnloadRisk(lost, T0 + 120_000, j.reason);
    assert.strictEqual(cleared.marks.length, 0);
    assert.strictEqual(cleared.channelLossAt, undefined);
    assert.strictEqual(assessUnloadRisk(cleared, 'Unload -all')!.risky, false);
});

test('unloadRisk: 표시가 없으면 유실 기록도 남기지 않는다(파일을 만들 이유가 없다)', () => {
    const e = emptyUnloadRiskState('x', T0);
    assert.strictEqual(noteChannelLoss(e, T0 + 1), e);
});

test('unloadRisk: 파일 값 정규화 — 깨진 항목은 버리고 모양이 다르면 undefined', () => {
    assert.strictEqual(normalizeUnloadRiskState(null, 'x'), undefined);
    const n = normalizeUnloadRiskState({ marks: [{ project: 'Lib', at: 1 }, { project: '', at: 2 }, { at: 3 }, 'x'], channelLossAt: 'no' }, 'ip');
    assert.ok(n);
    assert.deepStrictEqual(n!.marks, [{ project: 'Lib', at: 1, via: 'unknown' }]);
    assert.strictEqual(n!.channelLossAt, undefined);
    assert.strictEqual(n!.controllerId, 'ip');
});

// ── 문구 ───────────────────────────────────────────────────────────────────

test('unloadRisk: 문구 — 실측 횟수·재부팅·confirm 동의·채널 이름(포트 번호 아님)', () => {
    const a = assessUnloadRisk(riskyState(), 'Unload -all')!;
    const w = unloadRiskWarning(a);
    const counts = `${UNLOAD_RISK_EVIDENCE.observed}번 중 ${UNLOAD_RISK_EVIDENCE.disrupted}번`;
    assert.ok(w.message.includes(counts) && w.message.includes('재부팅'), w.message);
    assert.ok(w.message.includes('Lib'));
    const r = unloadRiskRefusalDetail(a);
    assert.ok(r.includes('confirm:true') && r.includes('동의'), r);
    assert.ok(unloadTimeoutGuidance(a).includes('재부팅'));
    for (const text of [w.message, w.detail, r, unloadTimeoutGuidance(a), notRunnableStartDetail('Lib', ['BinderR3'])]) {
        assert.ok(!/\b140[23]\b/.test(text), `채널은 이름으로 부른다: ${text}`);
    }
    assert.ok(notRunnableStartDetail('Lib', ['BinderR3']).includes('BinderR3'));
    assert.strictEqual(UNLOAD_RISK_REFUSAL, 'unload-after-group-compile');
});

test('unloadRisk: -744 START 실패만 실행 불가로 분류', () => {
    assert.strictEqual(isNotRunnableStartFailure('START', -744), true);
    assert.strictEqual(isNotRunnableStartFailure('START', -742), false);
    assert.strictEqual(isNotRunnableStartFailure('COMPILE', -744), false);
    assert.strictEqual(recoveryFor(PROJECT_NOT_RUNNABLE).action, 'RESOLVE_PROJECT');
    assert.strictEqual(recoveryFor(PROJECT_NOT_RUNNABLE).retryCurrentCommand, false);
});

// ── 파일 저장소 ───────────────────────────────────────────────────────────

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-unload-risk-test-'));
}

function removeDir(dir: string): void {
    // fs.rmSync 는 쓰지 않는다(비ASCII 경로 크래시 이력) — 파일을 지운 뒤 빈 폴더만 지운다.
    for (const f of fs.readdirSync(dir)) { fs.unlinkSync(path.join(dir, f)); }
    fs.rmdirSync(dir);
}

test('unloadRiskStore: 쓰기·읽기·갱신이 같은 계약을 쓴다(없으면 undefined)', () => {
    const dir = tempDir();
    try {
        assert.strictEqual(readUnloadRiskState('10.0.0.9', dir), undefined);
        writeUnloadRiskState(riskyState('10.0.0.9'), dir);
        assert.ok(unloadRiskFilePath('10.0.0.9', dir).endsWith('unload-risk-10.0.0.9.json'));
        assert.deepStrictEqual(readUnloadRiskState('10.0.0.9', dir)!.marks.map(m => m.project), ['Lib']);
        const updated = updateUnloadRiskState('10.0.0.9', s => noteChannelLoss(s, T0 + 5), T0 + 5, dir);
        assert.strictEqual(updated!.channelLossAt, T0 + 5);
        assert.strictEqual(readUnloadRiskState('10.0.0.9', dir)!.channelLossAt, T0 + 5);
        fs.writeFileSync(unloadRiskFilePath('10.0.0.9', dir), '{broken', 'utf8');
        assert.strictEqual(readUnloadRiskState('10.0.0.9', dir), undefined, '깨진 파일은 표시 없음');
    } finally {
        removeDir(dir);
    }
});

// ── 가드 (전송 직렬 큐에 걸리는 지점) ─────────────────────────────────────

test('unloadRiskGuard: 위험 상태 Unload 는 confirm 없이 거부, confirm 이면 통과, 위험 없으면 그대로', async () => {
    const id = `guard-test-${process.pid}-${Date.now()}`;
    const file = unloadRiskFilePath(id);
    try {
        await guardBeforeSend('Unload -all', id);   // 표시 없음 — 종전 동작
        writeUnloadRiskState(riskyState(id));
        let caught: unknown;
        try { await guardBeforeSend('Unload -all', id); } catch (err) { caught = err; }
        assert.ok(isUnloadRiskError(caught), '확인 없이 보내지 않는다');
        assert.strictEqual((caught as { sent?: boolean }).sent, false);
        assert.strictEqual((caught as { code?: string }).code, UNLOAD_RISK_REFUSAL);
        await guardBeforeSend('Unload -all', id, { confirmUnloadRisk: true });
        await guardBeforeSend('Show Thread -web', id);   // Unload 가 아니면 상관없음
        assert.ok(unloadFailureGuidance('Unload BinderR3', id)?.includes('재부팅'));
        assert.strictEqual(unloadFailureGuidance('Compile Lib', id), undefined);
    } finally {
        try { fs.unlinkSync(file); } catch { /* noop */ }
    }
});

test('unloadRiskGuard: 그룹 Compile 성공을 관측하면 표시를 켜고, 앱·모르는 이름은 켜지 않는다', async () => {
    const id = `observe-test-${process.pid}-${Date.now()}`;
    const file = unloadRiskFilePath(id);
    setProjectKindResolver({
        lookup: async name => (name === 'Lib' ? { runnable: false } : name === 'App' ? { runnable: true } : undefined),
        runnableProjects: async () => ['App'],
    });
    try {
        await observeAfterResponse('Compile App', id, OK, T0);
        await observeAfterResponse('Compile Unknown', id, OK, T0);
        await observeAfterResponse('Compile Lib', id, '<STATUS>-742 x</STATUS>', T0);
        assert.strictEqual(readUnloadRiskState(id), undefined);
        await observeAfterResponse('Start Lib -compile -event', id, '<STATUS>-744 *Invalid start procedure*</STATUS>', T0);
        assert.deepStrictEqual(readUnloadRiskState(id)!.marks.map(m => [m.project, m.via]), [['Lib', 'Start -compile']]);

        // 실행 불가 그룹 Start 는 보내지 않는다(후보 포함), 앱·모르는 이름은 통과.
        let caught: unknown;
        try { await guardBeforeSend('Start Lib -compile -event', `other-${id}`); } catch (err) { caught = err; }
        assert.ok(isNotRunnableStartError(caught));
        assert.deepStrictEqual((caught as { runnableCandidates: string[] }).runnableCandidates, ['App']);
        await guardBeforeSend('Start App -compile -event', `other-${id}`);
        await guardBeforeSend('Start Unknown -compile', `other-${id}`);
    } finally {
        setProjectKindResolver(undefined);
        try { fs.unlinkSync(file); } catch { /* noop */ }
    }
});

// ── /GPL 비우기 정지 게이트 ───────────────────────────────────────────────

test('remoteFolderClear: 정지가 확인되지 않으면 지우지 않는다', () => {
    const unknown = remoteDeleteGateForThreads(null);
    assert.ok(unknown !== 'needs-stop' && !unknown.proceed && unknown.reason === 'thread-state-unknown');
    assert.deepStrictEqual(remoteDeleteGateForThreads(0), { proceed: true });
    assert.strictEqual(remoteDeleteGateForThreads(2), 'needs-stop');
    const failed = remoteDeleteGateAfterStop({ sendFailed: true, message: 'No response (timeout or connection failure)', ok: false, unconfirmed: false });
    assert.ok(!failed.proceed && failed.reason === 'stop-failed' && failed.detail.includes('No response'), JSON.stringify(failed));
    const unconfirmed = remoteDeleteGateAfterStop({ sendFailed: false, ok: true, unconfirmed: true });
    assert.ok(!unconfirmed.proceed && unconfirmed.reason === 'stop-unconfirmed');
    assert.deepStrictEqual(remoteDeleteGateAfterStop({ sendFailed: false, ok: true, unconfirmed: false }), { proceed: true });
});

// ── 세션 대상 부수 효과 ───────────────────────────────────────────────────

test('projectTarget: 배포·실행 호출은 실행 불가 대상을 세션 대상으로 삼지 않고 기존 대상을 바꾸지 않는다', () => {
    const app = 'C:\\w\\projects\\BinderR3';
    const lib = 'C:\\w\\V2\\Lib';
    assert.deepStrictEqual(sessionTargetAfterImplicitUse(app, { dir: lib, runnable: false }), { nextDir: app, changed: false, reason: 'kept-non-runnable' });
    assert.deepStrictEqual(sessionTargetAfterImplicitUse(undefined, { dir: lib, runnable: false }), { nextDir: undefined, changed: false, reason: 'kept-non-runnable' });
    assert.deepStrictEqual(sessionTargetAfterImplicitUse(undefined, { dir: app, runnable: true }), { nextDir: app, changed: true, reason: 'adopted' });
    assert.strictEqual(sessionTargetAfterImplicitUse(app, { dir: 'C:\\w\\projects\\Other', runnable: true }).reason, 'kept-existing');
    assert.strictEqual(sessionTargetAfterImplicitUse(app, { dir: app.toLowerCase(), runnable: true }).reason, 'same');
});
