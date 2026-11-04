import * as assert from 'assert';
import { test } from '../../harness';
import { buildSystemInfoItems } from '../../../views/tree/systemInfoItems';
import { SectionNode } from '../../../views/tree/treeNodes';
import { TreeRootInput, buildConnectedRoot, buildSystemInfoSection } from '../../../views/tree/treeSections';

// 제어기 패널 섹션의 순서·기본 접힘 상태를 고정한다(2026-11-04 사용자 배치). 바꾸면 SECTION_LAYOUT_EPOCH 도 올린다.

function rootInput(over: Partial<TreeRootInput> = {}): TreeRootInput {
    return {
        connected: true,
        config: { ip: '192.168.0.1', port: 1402, consolePort: 1403, ftpBasePath: '/GPL', ftpFlashProjectsPath: '/flash/projects' },
        expectedProjectName: 'Gantry',
        expectedProjectFolderName: 'Gantry',
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
        ftpCacheMatches: true,
        editorBreakpointTargets: [],
        trafficOptions: { responseBody: false, maxResponseChars: 0 },
        connectionStats: undefined,
        toResource: (dir: string) => dir,
        ...over,
    };
}

test('제어기 패널 루트: 섹션 순서와 기본 접힘 상태', () => {
    const layout = buildConnectedRoot(rootInput()).map(s => `${s.id}:${s.collapsed ? '접힘' : '펼침'}`);
    assert.deepStrictEqual(layout, [
        'connection:접힘',
        'projectContext:펼침',
        'threads:펼침',
        'errorsCode:접힘',
        'breakpoints:접힘',
        'ftp:펼침',
        'system:펼침',
        'io:접힘',
        'errorsEnv:접힘',
        'ftpFlash:접힘',
    ]);
});

test('제어기 패널 루트: 컴파일 검증 필요가 있어도 프로젝트 상태는 펼침(기본과 같음)', () => {
    const root = buildConnectedRoot(rootInput({
        compileStale: [{ ip: '192.168.0.1', projectName: 'Gantry', projectDir: 'C:/p/Gantry', since: 1, markedAt: 1, reason: 'upload-only' }],
    }));
    const ctx = root.find(s => s.id === 'projectContext')!;
    assert.strictEqual(ctx.collapsed, false);
});

test('시스템 정보: CPU 온도는 섹션 바로 아래, 앰프 온도는 접힌 묶음(헤더에 최고 온도)', () => {
    const items = buildSystemInfoItems({
        memory: undefined,
        flashResp: null,
        cpuResp: null,
        temperature: {
            sampledAt: 0,
            raw: 'raw',
            readings: [
                { key: 'cpu-1', kind: 'cpu', label: 'CPU 1', celsius: 55, reportedCelsius: 55 },
                { key: 'robot-1-amp-1', kind: 'amplifier', label: 'Robot 1 · Amp 1', celsius: 38.5, reportedCelsius: 38.5 },
                { key: 'robot-2-amp-1', kind: 'amplifier', label: 'Robot 2 · Amp 1', celsius: 41, reportedCelsius: 41 },
            ],
        } as any,
    });
    const sec = buildSystemInfoSection(items, 1);
    const labels = sec.children.map(c => (c as { label: string }).label);
    assert.deepStrictEqual(labels, ['CPU', 'CPU 1 온도', '앰프 온도 (2)']);
    const group = sec.children[2] as SectionNode;
    assert.ok(group instanceof SectionNode);
    assert.strictEqual(group.collapsed, true);
    assert.strictEqual(group.description, '최고 41.0°C');
    assert.deepStrictEqual(group.children.map(c => (c as { label: string }).label), ['Robot 1 · Amp 1 온도', 'Robot 2 · Amp 1 온도']);
});

test('시스템 정보: 앰프 행이 없으면 묶음도 만들지 않는다', () => {
    const sec = buildSystemInfoSection([{ label: 'CPU', value: '3%' }], 1);
    assert.ok(sec.children.every(c => !(c instanceof SectionNode)));
});
