import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import {
    collectLibraryVcs, normalizeSvnUrl, parseInfoItem, parseStatusQ, parseSvnExternals, resolveExternalUrl, svnTarget, versionLabelFromUrl,
} from '../../../controller/deployment/libraryVcs';
import type { LibraryVcsInfo, SvnRunner } from '../../../controller/deployment/libraryVcs';
import {
    buildLibraryProvenance, describeLibraries, hashUploadSet, LibraryProvenanceStore, listUploadSet, summarizeUploadDir,
} from '../../../controller/deployment/libraryProvenance';
import { evaluatePreflight, judgeLibrary, preflightWarning, resolveLibraryPreflightSetting } from '../../../controller/deployment/libraryPreflight';
import { runLibraryPreflight, recordUploadedLibrary } from '../../../controller/deployment/libraryPreflightStage';
import { getAllFiles } from '../../../controller/files/ftpClient';
import { snapshotProjectFiles } from '../../../controller/deployment/deployRecordCore';
import { preparePreprocess, preprocessStageDir } from '../../../controller/deployment/deployPreprocessStage';
import type { DeployContext } from '../../../controller/deployment/deployContext';
import type { DeployProjectInfo } from '../../../controller/deployment/deployPrecheck';
import type { DeployTarget } from '../../../controller/deployment/deployTargetStage';
import { emptyDeployResult } from '../../../controller/deployment/deployTypes';
import { parseGpr } from '../../../controller/protocol/responseParser';

// ─── SVN 출력 해석(캡처한 문자열) ─────────────────────────────────────────────

test('libraryVcs: parseSvnExternals — 새·옛 형식, peg·-r, 인용, 주석 줄', () => {
    const text = [
        '# 공용 라이브러리',
        '../../Lib/v2/PaL PaL',
        '../../Lib/v2/Gantry@5405 Gantry',
        '-r 5400 ^/trunk/Lib/v2/Tools Tools',
        'Old -r12 https://svn.example.com/repo/Lib/Old',
        '"../../Lib/with space" Spaced',
        'garbage',
    ].join('\r\n');
    assert.deepStrictEqual(parseSvnExternals(text), [
        { target: 'PaL', url: '../../Lib/v2/PaL' },
        { target: 'Gantry', url: '../../Lib/v2/Gantry', peg: 5405 },
        { target: 'Tools', url: '^/trunk/Lib/v2/Tools', peg: 5400 },
        { target: 'Old', url: 'https://svn.example.com/repo/Lib/Old', peg: 12 },
        { target: 'Spaced', url: '../../Lib/with space' },
    ]);
});

test('libraryVcs: resolveExternalUrl·normalizeSvnUrl — 속성이 걸린 폴더 URL 기준 상대 경로, 저장소 루트 기준(^/), peg·끝 슬래시 정규화', () => {
    const holder = 'file:///C:/repo/trunk/V2/101/projects';
    assert.strictEqual(resolveExternalUrl('../../Lib/v2/PaL', holder), 'file:///C:/repo/trunk/V2/Lib/v2/PaL');
    assert.strictEqual(resolveExternalUrl('^/trunk/Lib', holder, 'file:///C:/repo'), 'file:///C:/repo/trunk/Lib');
    assert.strictEqual(resolveExternalUrl('^/trunk/Lib', holder), undefined);
    assert.strictEqual(resolveExternalUrl('//host/x', holder), undefined);
    assert.strictEqual(resolveExternalUrl('https://h/a/b@7', holder), 'https://h/a/b');
    assert.strictEqual(normalizeSvnUrl('https://H/a/B/@12'), 'https://h/a/B');
    assert.strictEqual(versionLabelFromUrl('https://h/Lib/v2/PaL'), 'v2');
});

test('libraryVcs: parseInfoItem·parseStatusQ — 변경(M·A·D·R·C·!·~, 속성 변경)만 세고 externals(X)·안내 줄은 세지 않는다', () => {
    assert.strictEqual(parseInfoItem('5405\r\n'), '5405');
    assert.strictEqual(parseInfoItem('  \n'), undefined);
    const out = [
        'M       PaL\\Core_Log.gpl',
        ' M      PaL\\Project.gpr',
        'A       PaL\\New.gpl',
        '!       PaL\\Gone.gpl',
        'X       PaL\\ext',
        '',
        'Performing status on external item at \'PaL\\ext\':',
    ].join('\n');
    const s = parseStatusQ(out);
    assert.strictEqual(s.count, 4);
    assert.deepStrictEqual(s.files, ['PaL\\Core_Log.gpl', 'PaL\\Project.gpr', 'PaL\\New.gpl', 'PaL\\Gone.gpl']);
});

/** 장비 projects 폴더에 PaL(고정)·Gantry(따라가기) 가 externals 로 걸린 상태를 흉내 내는 svn 실행기. */
function fakeSvn(opts: { pinnedRevision?: number; palUrl?: string; modified?: string; fail?: boolean } = {}): SvnRunner {
    const projects = path.resolve('/ws/101/projects');
    return async (args) => {
        if (opts.fail) { return { ok: false, stdout: '' }; }
        const [cmd, a, b, target] = args;
        const t = path.resolve(String(target ?? b ?? a));
        if (cmd === 'info' && b === 'url') {
            if (t === projects) { return { ok: true, stdout: 'file:///repo/trunk/V2/101/projects\n' }; }
            return { ok: true, stdout: `${t.endsWith('PaL') ? (opts.palUrl ?? 'file:///repo/trunk/V2/Lib/v2/PaL') : 'file:///repo/trunk/V2/Lib/v2/Gantry'}\n` };
        }
        if (cmd === 'info' && b === 'revision') { return { ok: true, stdout: `${t.endsWith('PaL') ? (opts.pinnedRevision ?? 5405) : 5412}\n` }; }
        if (cmd === 'propget') {
            return path.resolve(String(b)) === projects
                ? { ok: true, stdout: '../../Lib/v2/PaL@5405 PaL\n../../Lib/v2/Gantry Gantry\n' }
                : { ok: true, stdout: '' };
        }
        if (cmd === 'status') { return { ok: true, stdout: t.endsWith('Gantry') ? (opts.modified ?? '') : '' }; }
        return { ok: false, stdout: '' };
    };
}

test('libraryVcs: collectLibraryVcs — 고정(pinned)·따라가기(following)·변경 파일 수, svn 실패면 null', async () => {
    const projects = path.resolve('/ws/101/projects');
    const pal = await collectLibraryVcs(path.join(projects, 'PaL'), fakeSvn());
    assert.deepStrictEqual(pal, {
        kind: 'svn', url: 'file:///repo/trunk/V2/Lib/v2/PaL', revision: 5405, mode: 'pinned', peg: 5405,
        modifiedFiles: 0, expectedUrl: 'file:///repo/trunk/V2/Lib/v2/PaL',
    });
    const mod = 'M       Gantry\\A.gpl\nM       Gantry\\B.gpl\nM       Gantry\\C.gpl\n';
    const gantry = await collectLibraryVcs(path.join(projects, 'Gantry'), fakeSvn({ modified: mod }));
    assert.strictEqual(gantry?.mode, 'following');
    assert.strictEqual(gantry?.modifiedFiles, 3);
    assert.strictEqual(gantry?.peg, undefined);
    assert.strictEqual(await collectLibraryVcs(path.join(projects, 'PaL'), fakeSvn({ fail: true })), null);
    const none = await collectLibraryVcs(path.join(projects, 'Other'), async (args) => (args[0] === 'info'
        ? { ok: true, stdout: args[2] === 'url' ? 'https://h/x/Other\n' : '7\n' } : { ok: args[0] === 'status', stdout: '' }));
    assert.strictEqual(none?.mode, 'none');
});

test('libraryProvenance: 한 줄 요약 — libs PaL v2@r5405(pinned) · Gantry v2@HEAD+3M', async () => {
    const projects = path.resolve('/ws/101/projects');
    const pal = await collectLibraryVcs(path.join(projects, 'PaL'), fakeSvn());
    const mod = 'M       Gantry\\A.gpl\nM       Gantry\\B.gpl\nM       Gantry\\C.gpl\n';
    const gantry = await collectLibraryVcs(path.join(projects, 'Gantry'), fakeSvn({ modified: mod }));
    const rec = (name: string, vcs: LibraryVcsInfo | null) => buildLibraryProvenance({ name, localPath: '/x', vcs, uploaded: { files: 1, sha256: 'x' } });
    assert.strictEqual(describeLibraries([rec('PaL', pal), rec('Gantry', gantry)]), 'libs PaL v2@r5405(pinned) · Gantry v2@HEAD+3M');
    assert.strictEqual(describeLibraries([rec('Tools', null)]), 'libs Tools (vcs ?)');
    assert.strictEqual(describeLibraries([]), '');
    assert.deepStrictEqual(rec('PaL', pal).vcs, { kind: 'svn', url: 'file:///repo/trunk/V2/Lib/v2/PaL', revision: 5405, mode: 'pinned', peg: 5405, modifiedFiles: 0 });
});

// ─── 업로드 집합 해시 · dot 항목(.svn) 제외 ──────────────────────────────────

function makeLibDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-lib-'));
    fs.writeFileSync(path.join(dir, 'Project.gpr'), 'ProjectName="PaL"\r\nProjectEnd\r\n');
    fs.writeFileSync(path.join(dir, 'Core.gpl'), 'Module CORE\r\nEnd Module\r\n');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'Util.gpl'), 'Module UTL\r\nEnd Module\r\n');
    return dir;
}

/** 독립 작업 사본(externals 로 받은 폴더)처럼 `.svn` 폴더와 그 안 파일을 만든다. */
function addSvnMeta(dir: string): void {
    fs.mkdirSync(path.join(dir, '.svn', 'pristine', 'ab'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.svn', 'wc.db'), 'sqlite');
    fs.writeFileSync(path.join(dir, '.svn', 'pristine', 'ab', 'abcd.svn-base'), 'x');
}

function rmTree(dir: string): void {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { rmTree(full); } else { fs.unlinkSync(full); }
    }
    fs.rmdirSync(dir);
}

test('libraryProvenance: 업로드 집합 해시 — 정렬·결정적, 내용이 바뀌면 달라지고, .svn 같은 점 항목은 집합에 들지 않는다', () => {
    const dir = makeLibDir();
    try {
        const before = summarizeUploadDir(dir);
        assert.deepStrictEqual(listUploadSet(dir), ['Core.gpl', 'Project.gpr', 'sub/Util.gpl']);
        addSvnMeta(dir);
        assert.deepStrictEqual(listUploadSet(dir), ['Core.gpl', 'Project.gpr', 'sub/Util.gpl']);
        assert.deepStrictEqual(summarizeUploadDir(dir), before, '.svn 이 생겨도 집합·해시는 그대로');
        assert.strictEqual(before.files, 3);
        fs.writeFileSync(path.join(dir, 'Core.gpl'), 'Module CORE\r\n\r\nEnd Module\r\n');
        assert.notStrictEqual(summarizeUploadDir(dir).sha256, before.sha256);
        assert.strictEqual(hashUploadSet([{ rel: 'B', sha256: '1' }, { rel: 'a', sha256: '2' }]), hashUploadSet([{ rel: 'A', sha256: '2' }, { rel: 'b', sha256: '1' }]));
    } finally { rmTree(dir); }
});

test('회귀: 독립 작업 사본(.svn)인 형제 라이브러리 — ftpClient 업로드 목록·증적 스냅샷·전처리 사본 모두 점 항목을 무시한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-svnwc-'));
    const ip = '10.250.0.9';
    try {
        const app = path.join(root, 'App');
        const pal = path.join(root, 'PaL');
        fs.mkdirSync(app);
        fs.mkdirSync(pal);
        fs.writeFileSync(path.join(app, 'Project.gpr'), 'ProjectName="App"\r\nProjectStart="Main"\r\nProjectSource="App.gpl"\r\nProjectLibrary="PaL"\r\nProjectEnd\r\n');
        fs.writeFileSync(path.join(app, 'App.gpl'), 'Module App\r\n    Public Sub Main()\r\n        CORE.Go()\r\n    End Sub\r\nEnd Module\r\n');
        fs.writeFileSync(path.join(pal, 'Project.gpr'), 'ProjectName="PaL"\r\nProjectSource="Core.gpl"\r\nProjectEnd\r\n');
        fs.writeFileSync(path.join(pal, 'Core.gpl'), 'Module CORE\r\n    Public Sub Go()\r\n    End Sub\r\nEnd Module\r\n');
        addSvnMeta(pal);
        addSvnMeta(app);

        const rel = (files: string[], base: string): string[] => files.map(f => path.relative(base, f).split(path.sep).join('/')).sort();
        assert.deepStrictEqual(rel(getAllFiles(pal), pal), ['Core.gpl', 'Project.gpr']);
        assert.deepStrictEqual(Object.keys(snapshotProjectFiles(pal)).sort(), ['Core.gpl', 'Project.gpr']);

        const gprPath = path.join(app, 'Project.gpr');
        const gprText = fs.readFileSync(gprPath, 'utf8');
        const project: DeployProjectInfo = { gprPath, gprText, gprInfo: parseGpr(gprText), folderName: 'App', projectName: 'App' };
        const target = {
            directActive: true, ftpProjectDir: '/GPL/App',
            libraryPlan: { uploads: [{ raw: 'PaL', localDir: pal, remoteDir: '/GPL/PaL' }], covered: [], embedded: [], skipped: [], unresolved: [] },
        } as unknown as DeployTarget;
        const result = emptyDeployResult();
        const ctx = {
            options: { projectDir: app }, cfg: { ip }, result, pushTrace: (l: string) => result.trace.push(l),
            host: { readSourceExtensionsSetting: () => undefined, readPreprocessSetting: () => ({ stripComments: true }) },
        } as unknown as DeployContext;
        const prepared = preparePreprocess(ctx, project, target)!;
        assert.ok(prepared);
        assert.ok(!fs.existsSync(path.join(prepared.uploadDirFor(pal), '.svn')));
        assert.ok(!fs.existsSync(path.join(prepared.uploadDirFor(app), '.svn')));
        assert.deepStrictEqual(listUploadSet(prepared.uploadDirFor(pal)), ['Core.gpl', 'Project.gpr']);
    } finally {
        rmTree(root);
        const stage = preprocessStageDir(ip, '');
        if (fs.existsSync(stage)) { rmTree(stage); }
    }
});

test('libraryProvenance: 이전 업로드 기록 저장소 — 키는 ip+원격 폴더(대소문자 무시), Memento 에 저장·복원', () => {
    const mem: Record<string, any> = {};
    const memento = { get: <T>(k: string, d: T): T => (k in mem ? mem[k] : d), update: (k: string, v: any) => { mem[k] = v; return Promise.resolve(); } };
    const a = new LibraryProvenanceStore();
    a.attach(memento);
    const lib = buildLibraryProvenance({ name: 'PaL', localPath: '/x', remoteDir: '/GPL/PaL', vcs: null, uploaded: { files: 2, sha256: 'h' } });
    a.record('192.168.0.1', '/GPL/PaL', lib, 1000);
    const b = new LibraryProvenanceStore();
    b.attach(memento);
    assert.deepStrictEqual(b.get('192.168.0.1', '/gpl/pal/')?.library.uploaded, { files: 2, sha256: 'h' });
    assert.strictEqual(b.get('192.168.0.2', '/GPL/PaL'), undefined);
});

test('libraryProvenance: 두 창이 같은 저장소를 쓸 때 — 먼저 붙은 창도 나중 기록을 읽고, 기록할 때 상대 항목을 지우지 않는다', () => {
    const mem: Record<string, any> = {};
    const memento = { get: <T>(k: string, d: T): T => (k in mem ? mem[k] : d), update: (k: string, v: any) => { mem[k] = v; return Promise.resolve(); } };
    const libOf = (sha: string) => buildLibraryProvenance({ name: 'PaL', localPath: '/x', remoteDir: '/GPL/PaL', vcs: null, uploaded: { files: 1, sha256: sha } });
    const early = new LibraryProvenanceStore();
    early.attach(memento);
    early.record('192.168.0.1', '/GPL/PaL', libOf('old'), 1000);
    const late = new LibraryProvenanceStore();
    late.attach(memento);
    late.record('192.168.0.1', '/GPL/PaL', libOf('new'), 2000);
    late.record('192.168.0.1', '/GPL/Gantry', libOf('g'), 2001);
    // 먼저 붙은 창이 낡은 기록으로 판정하지 않는다.
    assert.strictEqual(early.get('192.168.0.1', '/GPL/PaL')?.library.uploaded.sha256, 'new');
    // 먼저 붙은 창이 다른 항목을 기록해도 상대가 쓴 항목이 남는다.
    early.record('192.168.0.1', '/GPL/Other', libOf('o'), 3000);
    const keys = Object.keys(mem['gpl.libraryProvenance']).sort();
    assert.deepStrictEqual(keys, ['192.168.0.1|/gpl/gantry', '192.168.0.1|/gpl/other', '192.168.0.1|/gpl/pal']);
    assert.strictEqual(mem['gpl.libraryProvenance']['192.168.0.1|/gpl/pal'].library.uploaded.sha256, 'new');
});

// ─── preflight 판정 ──────────────────────────────────────────────────────────

const vcsOf = (over: Partial<LibraryVcsInfo> = {}): LibraryVcsInfo => ({
    kind: 'svn', url: 'file:///repo/Lib/v2/PaL', revision: 5405, mode: 'pinned', peg: 5405, modifiedFiles: 0, expectedUrl: 'file:///repo/Lib/v2/PaL', ...over,
});
const base = { name: 'PaL', localPath: '/ws/PaL', folderExists: true, gprExists: true };

test('libraryPreflight: 폴더·Project.gpr 없음은 fail(missing), 고정 드리프트(S6)·URL 불일치는 mismatch, 로컬 변경은 warn', () => {
    assert.strictEqual(judgeLibrary({ ...base, folderExists: false, gprExists: false, vcs: null }).status, 'fail');
    const noGpr = judgeLibrary({ ...base, gprExists: false, vcs: null });
    assert.deepStrictEqual(noGpr.issues, ['missing']);
    const ok = judgeLibrary({ ...base, vcs: vcsOf() });
    assert.strictEqual(ok.status, 'ok');
    assert.strictEqual(ok.previousUpload, 'unknown');
    const drift = judgeLibrary({ ...base, vcs: vcsOf({ revision: 5410 }) });
    assert.deepStrictEqual(drift.issues, ['pinnedDrift']);
    assert.strictEqual(drift.status, 'mismatch');
    assert.match(drift.notes.join(' '), /HEAD 로 올립니다/);
    assert.deepStrictEqual(judgeLibrary({ ...base, vcs: vcsOf({ mode: 'following', peg: undefined, url: 'file:///repo/Lib/v3/PaL' }) }).issues, ['pinnedDrift']);
    const dirty = judgeLibrary({ ...base, vcs: vcsOf({ modifiedFiles: 2, modified: ['a.gpl', 'b.gpl'] }) });
    assert.deepStrictEqual(dirty.issues, ['modified']);
    assert.strictEqual(dirty.status, 'warn');
    assert.deepStrictEqual(dirty.modified, { count: 2, files: ['a.gpl', 'b.gpl'] });
    assert.ok(preflightWarning(dirty)!.includes('a.gpl'));
    assert.strictEqual(preflightWarning(ok), undefined);
});

test('libraryPreflight: 이전 업로드 출처 — 같으면 match, 다르면 mismatch, 기록 없음·svn 없음·로컬 변경은 unknown(일치로 보지 않는다)', () => {
    const prevOf = (vcs: LibraryVcsInfo | null) => buildLibraryProvenance({ name: 'PaL', localPath: '/ws/PaL', vcs, uploaded: { files: 1, sha256: 'x' } });
    assert.strictEqual(judgeLibrary({ ...base, vcs: vcsOf(), previous: prevOf(vcsOf()) }).previousUpload, 'match');
    const other = judgeLibrary({ ...base, vcs: vcsOf(), previous: prevOf(vcsOf({ revision: 5300, peg: undefined, mode: 'following' })) });
    assert.strictEqual(other.previousUpload, 'mismatch');
    assert.ok(other.issues.includes('uploadMismatch'));
    assert.strictEqual(judgeLibrary({ ...base, vcs: vcsOf() }).previousUpload, 'unknown');
    assert.strictEqual(judgeLibrary({ ...base, vcs: null, previous: prevOf(vcsOf()) }).previousUpload, 'unknown');
    assert.strictEqual(judgeLibrary({ ...base, vcs: vcsOf(), previous: prevOf(null) }).previousUpload, 'unknown');
    assert.strictEqual(judgeLibrary({ ...base, vcs: vcsOf({ modifiedFiles: 1 }), previous: prevOf(vcsOf()) }).previousUpload, 'unknown');
    // svn status 가 실패·시간 초과면 "변경 없음"이 아니라 모름 — 일치로 보지 않고, 막지도 않고, 확인하지 못했다고 남긴다.
    const unknown = judgeLibrary({ ...base, vcs: vcsOf({ statusUnknown: true }), previous: prevOf(vcsOf()) });
    assert.strictEqual(unknown.previousUpload, 'unknown');
    assert.deepStrictEqual(unknown.issues, []);
    assert.match(unknown.notes.join(' '), /확인하지 못했습니다/);
});

test('libraryVcs: svn status 실패는 statusUnknown 으로 남고, 경로의 @ 는 끝에 @ 를 붙여 peg 로 읽히지 않게 한다', async () => {
    const projects = path.resolve('/ws/101/projects');
    const inner = fakeSvn();
    const failing: SvnRunner = async (args, cwd) => { return args[0] === 'status' ? { ok: false, stdout: '' } : inner(args, cwd); };
    const pal = await collectLibraryVcs(path.join(projects, 'PaL'), failing);
    assert.strictEqual(pal?.statusUnknown, true);
    assert.strictEqual(pal?.modifiedFiles, 0);
    assert.strictEqual((await collectLibraryVcs(path.join(projects, 'PaL'), fakeSvn()))?.statusUnknown, undefined);
    assert.strictEqual(svnTarget('C:\\ws\\Lib\\PaL@2'), 'C:\\ws\\Lib\\PaL@2@');
    assert.strictEqual(svnTarget('C:\\ws\\Lib\\PaL'), 'C:\\ws\\Lib\\PaL');
});

test('libraryPreflight: blockOn — 기본 [] 는 경고만, 지정한 항목에 해당하면 막고 사유를 담는다', () => {
    assert.deepStrictEqual(resolveLibraryPreflightSetting(undefined).blockOn, []);
    assert.deepStrictEqual(resolveLibraryPreflightSetting({ blockOn: ['Missing', 'pinnedDrift', 'bogus', 'missing'] }).blockOn, ['missing', 'pinnedDrift']);
    const entries = [judgeLibrary({ ...base, vcs: vcsOf({ revision: 5410 }) }), judgeLibrary({ ...base, name: 'G', vcs: vcsOf({ modifiedFiles: 1 }) })];
    assert.strictEqual(evaluatePreflight(entries, { blockOn: [] }).blocked, undefined);
    const blocked = evaluatePreflight(entries, { blockOn: ['pinnedDrift'] }).blocked!;
    assert.deepStrictEqual(blocked.on, ['pinnedDrift']);
    assert.strictEqual(blocked.reasons.length, 1);
    assert.strictEqual(evaluatePreflight(entries, { blockOn: ['missing'] }).blocked, undefined);
});

// ─── 단계(접착) ─────────────────────────────────────────────────────────────

test('libraryPreflightStage: 검사 결과·요약·경고를 결과에 담고, blockOn 에 걸리면 UPLOAD 단계 실패로 멈추며, 업로드 뒤 출처를 기록한다', async () => {
    const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-pf-'));
    try {
        const app = path.join(projects, 'App');
        const pal = path.join(projects, 'PaL');
        fs.mkdirSync(app);
        fs.mkdirSync(pal);
        fs.writeFileSync(path.join(pal, 'Project.gpr'), 'ProjectName="PaL"\r\nProjectEnd\r\n');
        fs.writeFileSync(path.join(pal, 'Core.gpl'), 'Module CORE\r\nEnd Module\r\n');
        const recorded: any[] = [];
        const make = (setting: unknown, svn: SvnRunner): DeployContext => {
            const result = emptyDeployResult();
            return {
                options: { projectDir: app }, cfg: { ip: '10.0.0.1' }, result, pushTrace: (l: string) => result.trace.push(l),
                host: { svnRunner: svn, readLibraryPreflightSetting: () => setting },
                io: { getLibraryProvenance: () => undefined, recordLibraryProvenance: (_ip: string, remote: string, lib: any) => recorded.push([remote, lib]) },
            } as unknown as DeployContext;
        };
        const target = {
            libraryPlan: { uploads: [{ raw: 'PaL', localDir: pal, remoteDir: '/GPL/PaL' }], covered: [], embedded: [], skipped: [], unresolved: ['Missing\\Lib'] },
        } as unknown as DeployTarget;
        const project = { gprInfo: { libraries: ['PaL'] } } as unknown as DeployProjectInfo;
        // 폴더 PaL 만 있는 fake: externals 는 고정 5405 인데 작업 사본은 5410.
        const svn: SvnRunner = async (args) => {
            const [cmd, , b, t] = args;
            if (cmd === 'info' && b === 'url') { return { ok: true, stdout: String(t) === projects ? `file:///r/projects\n` : 'file:///r/Lib/v2/PaL\n' }; }
            if (cmd === 'info' && b === 'revision') { return { ok: true, stdout: '5410\n' }; }
            if (cmd === 'propget') { return { ok: true, stdout: '../Lib/v2/PaL@5405 PaL\n' }; }
            return { ok: cmd === 'status', stdout: '' };
        };

        const warnOnly = make({}, svn);
        assert.strictEqual(await runLibraryPreflight(warnOnly, project, target), true);
        assert.deepStrictEqual(warnOnly.result.preflight!.libraries.map(l => [l.name, l.status]), [['PaL', 'mismatch'], ['Missing\\Lib', 'fail']]);
        assert.strictEqual(warnOnly.result.librarySummary, 'libs PaL v2@r5405(pinned) · Missing\\Lib (vcs ?)');
        assert.ok(warnOnly.result.precheckWarnings.some(w => w.includes('PaL') && w.includes('5410')));
        assert.strictEqual(warnOnly.result.failedPhase, undefined);

        const blocking = make({ blockOn: ['missing'] }, svn);
        assert.strictEqual(await runLibraryPreflight(blocking, project, target), false);
        assert.strictEqual(blocking.result.failedPhase, 'UPLOAD');
        assert.strictEqual(blocking.result.failedCommand, 'Library preflight');

        // svn 실패 → vcs:null 로 계속(막지 않음), 업로드 뒤 출처 기록.
        const noSvn = make({}, async () => ({ ok: false, stdout: '' }));
        assert.strictEqual(await runLibraryPreflight(noSvn, project, { libraryPlan: { ...target.libraryPlan!, unresolved: [] } } as unknown as DeployTarget), true);
        recordUploadedLibrary(noSvn, { raw: 'PaL', localDir: pal, remoteDir: '/GPL/PaL' }, pal);
        assert.strictEqual(noSvn.result.libraries!.length, 1);
        assert.strictEqual(noSvn.result.libraries![0].vcs, null);
        assert.strictEqual(noSvn.result.libraries![0].uploaded.files, 2);
        assert.strictEqual(recorded[0][0], '/GPL/PaL');
    } finally { rmTree(projects); }
});
