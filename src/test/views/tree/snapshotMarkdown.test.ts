import * as assert from 'assert';
import { test } from '../../harness';
import { buildDiagnosticSnapshotMarkdown, buildSituationSnapshotMarkdown } from '../../../views/tree/snapshotMarkdown';
import type { ControllerStatusSnapshot } from '../../../views/tree/treeSnapshot';

const NOW = new Date(2026, 9, 27, 12, 0).getTime();

function baseSnapshot(over: Partial<ControllerStatusSnapshot> = {}): ControllerStatusSnapshot {
    return {
        connected: false,
        config: { ip: '192.168.0.1', port: 1402, consolePort: 1403, ftpBasePath: '/GPL', ftpFlashProjectsPath: '/flash/projects' },
        expectedProjectName: 'Demo',
        expectedProjectFolderName: 'Demo',
        threads: [],
        breakpoints: [],
        errors: [],
        ftpEntries: [],
        ftpError: null,
        ftpFlashEntries: [],
        ftpFlashError: null,
        lastFtpRefreshAt: 0,
        sysInfo: [],
        lastSystemInfoRefreshAt: 0,
        runtimeConsoleStatus: { state: 'idle', connected: false, reason: 'init', noPayloadStreak: 0, immediateEofStreak: 0, lastChangedAt: 0 },
        ...over,
    };
}

const connected = (over: Partial<ControllerStatusSnapshot> = {}) => baseSnapshot({
    connected: true,
    threads: [{ name: 'Demo', state: 'Running', lastStatus: '0', project: 'Demo', file: 'Main.gpl' }],
    errors: ['-1 sample error'],
    ...over,
});

const situation = (s: ControllerStatusSnapshot) => buildSituationSnapshotMarkdown(s, { now: NOW });
const diagnostic = (s: ControllerStatusSnapshot) => buildDiagnosticSnapshotMarkdown(s, { now: NOW });

test('snapshotMarkdown 상황 보고서: 결정적이고 연결 여부·엔드포인트·쓰레드가 반영된다', () => {
    const off = situation(baseSnapshot());
    const on = situation(connected());
    assert.strictEqual(off, situation(baseSnapshot()));
    assert.notStrictEqual(off, on);
    assert.ok(off.includes('192.168.0.1'));
    assert.ok(on.includes('Main.gpl'));
    assert.ok(on.includes('Demo'));
});

test('snapshotMarkdown 상황 보고서: 에러 항목이 있으면 본문에 나타난다', () => {
    assert.ok(situation(connected()).includes('sample error'));
    assert.ok(!situation(baseSnapshot()).includes('sample error'));
});

test('snapshotMarkdown 진단 보고서: 결정적이고 연결 상태·에러가 반영된다', () => {
    const on = diagnostic(connected());
    assert.strictEqual(on, diagnostic(connected()));
    assert.notStrictEqual(on, diagnostic(baseSnapshot()));
    assert.ok(diagnostic(baseSnapshot()).includes('192.168.0.1'));
    assert.ok(on.endsWith('\n') || on.length > 0);
});
