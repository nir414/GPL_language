import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import { canResumeControllerDebug, controllerDebugConfiguration, controllerLibraryCandidates } from '../project/controllerProjectDebug';
import { getControllerProjectWriteBlock } from '../project/controllerProjectWorkspace';
import { downloadControllerLibraries, downloadControllerProjectCopy, ControllerDownloadIo } from '../controller/files/controllerProjectDownload';

const target = {
    host: '192.0.2.1', port: 1402, consolePort: 1403,
    remotePath: '/GPL/Probe', projectName: 'ActualProbe', projectDir: path.resolve('snapshot/Probe'),
};

test('controller project debug: Attach 대상을 고정하고 배포·Start·중단점 삭제를 끈다', () => {
    const config = controllerDebugConfiguration(target);
    assert.strictEqual(config.projectName, 'ActualProbe');
    assert.strictEqual(config.projectDir, target.projectDir);
    assert.strictEqual(config.controllerIp, target.host);
    assert.strictEqual(config.controllerPort, target.port);
    for (const key of ['deployBeforeAttach', 'startOnAttach', 'stopAllBeforeAttach', 'stopOnEntry', 'stopAllOnDisconnect', 'clearProjectBreakpointsOnAttach'] as const) {
        assert.strictEqual(config[key], false, key);
    }
    assert.strictEqual(config.preserveExistingBreakpoints, true);
});

test('controller project debug: 창 전환 요청은 같은 작업공간에서 유효 시간 안에만 이어받는다', () => {
    const pending = { workspaceFile: path.resolve('session/controller.code-workspace'), requestedAt: 1000, target, unresolvedLibraries: [] };
    assert.ok(canResumeControllerDebug(pending, pending.workspaceFile.toUpperCase(), 1001));
    assert.ok(!canResumeControllerDebug(pending, path.resolve('other/controller.code-workspace'), 1001));
    assert.ok(!canResumeControllerDebug(pending, pending.workspaceFile, 1000 + 11 * 60 * 1000));
    assert.ok(!canResumeControllerDebug(pending, pending.workspaceFile, 999));
});

test('controller project debug: 라이브러리 경로 후보는 원격 상대 배치를 유지하고 사본 밖을 제외한다', () => {
    const root = path.resolve('snapshot/sources');
    assert.deepStrictEqual(controllerLibraryCandidates(root, '/GPL', path.join(root, 'Probe'), 'Lib\\Core'), [path.join(root, 'Probe', 'Lib', 'Core'), path.join(root, 'Lib', 'Core')]);
    assert.deepStrictEqual(controllerLibraryCandidates(root, '/GPL', path.join(root, 'Probe'), '/GPL/Lib'), [path.join(root, 'Lib')]);
    assert.deepStrictEqual(controllerLibraryCandidates(root, '/GPL', path.join(root, 'Probe'), '/flash/projects/Other'), []);
    assert.deepStrictEqual(controllerLibraryCandidates(root, '/GPL', path.join(root, 'Probe'), '..\\..\\outside'), []);
});

function downloadFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-debug-download-'));
    const sources = path.join(root, 'sources');
    const downloaded: string[] = [];
    const queried: string[] = [];
    const files: Record<string, Record<string, string>> = {
        '/GPL/Probe': { 'Project.gpr': 'ProjectName="ActualProbe"\nProjectSource="Main.gpl"\nProjectLibrary="Lib\\Core"\n', 'Main.gpl': 'Module Main\nEnd Module\n' },
        '/GPL/Lib': {
            'Core/Project.gpr': 'ProjectName="Core"\nProjectSource="Core.gpl"\nProjectLibrary="Lib\\Other"\nProjectLibrary="Probe"\n',
            'Core/Core.gpl': 'Module Core\nEnd Module\n',
            'Other/Project.gpr': 'ProjectName="Other"\nProjectLibrary="Missing"\n',
        },
    };
    const io: ControllerDownloadIo = {
        list: async (_host, remote) => {
            queried.push(remote);
            const allFiles = Object.entries(files).flatMap(([branch, content]) => Object.keys(content).map(file => `${branch}/${file}`));
            const children = allFiles.filter(file => file.startsWith(`${remote}/`)).map(file => file.slice(remote.length + 1));
            // 현장 서버에서 존재하지 않는 경로를 LIST하면 발생하던 오류를 모의한다.
            if (children.length === 0) { throw new Error('This library only supports MLSD, Unix- or DOS-style directory listing.'); }
            const entries = new Map<string, { name: string; isDirectory: boolean; size: number }>();
            for (const child of children) {
                const name = child.split('/')[0];
                entries.set(name, { name, isDirectory: child.includes('/'), size: 1 });
            }
            return [...entries.values()];
        },
        download: async (_host, remote, local) => {
            downloaded.push(remote);
            const entries = Object.entries(files[remote] ?? {});
            for (const [relative, text] of entries) {
                const destination = path.join(local, ...relative.split('/'));
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.writeFileSync(destination, text);
            }
            return { downloaded: entries.length, totalBytes: entries.reduce((sum, [, text]) => sum + Buffer.byteLength(text), 0) };
        },
    };
    return { root, sources, downloaded, queried, io, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('controller project debug: 형제·중첩·순환 라이브러리를 다운로드하고 없는 참조는 보고한다', async () => {
    const p = downloadFixture();
    try {
        const main = path.join(p.sources, 'Probe');
        await downloadControllerProjectCopy(target.host, '/GPL/Probe', main, () => {}, p.io);
        const unresolved = await downloadControllerLibraries(target.host, '/GPL', p.sources, path.join(main, 'Project.gpr'), () => {}, p.io);
        assert.deepStrictEqual(p.downloaded, ['/GPL/Probe', '/GPL/Lib']);
        assert.deepStrictEqual(unresolved, ['Missing']);
        assert.ok(fs.existsSync(path.join(p.sources, 'Lib', 'Core', 'Core.gpl')));
        assert.strictEqual(getControllerProjectWriteBlock(main, target.host)?.kind, 'read-only');
        assert.strictEqual(getControllerProjectWriteBlock(path.join(p.sources, 'Lib', 'Other'), target.host)?.kind, 'read-only');
        assert.strictEqual(p.queried.length, new Set(p.queried.map(value => value.toLowerCase())).size);
        assert.ok(!p.queried.some(remote => remote.includes('/Probe/Lib') || remote.includes('/Missing')), '없는 후보 경로에는 LIST를 보내지 않는다');
        await assert.rejects(() => downloadControllerProjectCopy(target.host, '/GPL/Probe', main, () => {}, p.io), /비어 있지/);
    } finally { p.cleanup(); }
});

test('controller project debug: 확인된 폴더의 목록 형식 오류는 빈 폴더로 숨기지 않는다', async () => {
    const p = downloadFixture();
    try {
        const main = path.join(p.sources, 'Probe');
        await downloadControllerProjectCopy(target.host, '/GPL/Probe', main, () => {}, p.io);
        p.io.list = async () => { throw new Error('Unsupported listing format'); };
        await assert.rejects(() => downloadControllerLibraries(target.host, '/GPL', p.sources, path.join(main, 'Project.gpr'), () => {}, p.io), /FTP 경로 확인 실패.*Unsupported listing format/);
    } finally { p.cleanup(); }
});

test('controller project debug: 라이브러리 경로의 대소문자는 원격 부모 목록의 표기를 사용한다', async () => {
    const p = downloadFixture();
    try {
        const main = path.join(p.sources, 'Probe');
        await downloadControllerProjectCopy(target.host, '/GPL/Probe', main, () => {}, p.io);
        const gpr = path.join(main, 'Project.gpr');
        fs.writeFileSync(gpr, fs.readFileSync(gpr, 'utf8').replace('Lib\\Core', 'lib\\core'));
        const unresolved = await downloadControllerLibraries(target.host, '/GPL', p.sources, gpr, () => {}, p.io);
        assert.deepStrictEqual(p.downloaded, ['/GPL/Probe', '/GPL/Lib']);
        assert.ok(!p.queried.includes('/GPL/lib'));
        assert.deepStrictEqual(unresolved, ['Missing']);
    } finally { p.cleanup(); }
});

test('controller project debug: 라이브러리 통신 실패를 누락으로 숨기지 않는다', async () => {
    const p = downloadFixture();
    try {
        const main = path.join(p.sources, 'Probe');
        await downloadControllerProjectCopy(target.host, '/GPL/Probe', main, () => {}, p.io);
        p.io.list = async () => { throw new Error('ECONNRESET'); };
        await assert.rejects(() => downloadControllerLibraries(target.host, '/GPL', p.sources, path.join(main, 'Project.gpr'), () => {}, p.io), /ECONNRESET/);
    } finally { p.cleanup(); }
});
