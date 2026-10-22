import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CONTROLLER_PROJECT_MANIFEST_FILE,
    chooseAvailableDownloadDir,
    collapseControllerProjectDirs,
    controllerWorkspacePath,
    ensureControllerWorkspaceFile,
    findControllerProjectContext,
    getControllerProjectWriteBlock,
    makeDownloadStagingDir,
    readControllerProjectManifest,
    removeDownloadStagingDir,
    writeControllerProjectManifest,
} from '../project/controllerProjectWorkspace';
import { test } from './harness';

function makeTree() {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-controller-workspace-test-'));
    const root = path.join(parent, 'Lib');
    const nested = path.join(root, 'Lib_Core', 'Log');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, 'Project.gpr'), 'ProjectName="Lib"\r\n', 'utf8');
    fs.writeFileSync(path.join(nested, 'Project.gpr'), 'ProjectName="Lib_Log"\r\n', 'utf8');
    fs.writeFileSync(path.join(nested, 'Logger.gpl'), 'Module LOG\r\nEnd Module\r\n', 'utf8');
    return {
        parent,
        root,
        nested,
        cleanup() { fs.rmSync(parent, { recursive: true, force: true }); },
    };
}

test('controllerProjectWorkspace: manifest는 파일 크기·SHA-256과 다운로드 정책을 기록한다', () => {
    const p = makeTree();
    try {
        const written = writeControllerProjectManifest(p.root, {
            mode: 'live',
            controllerHost: '192.168.0.1',
            sourceRemotePath: '/GPL/Lib',
            projectName: 'Lib',
            downloadedAt: '2026-10-21T00:00:00.000Z',
        });
        assert.strictEqual(written.files.length, 3);
        assert.ok(written.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
        assert.ok(written.files.some(file => file.path === 'Lib_Core/Log/Logger.gpl'));

        const read = readControllerProjectManifest(p.root);
        assert.deepStrictEqual(read, written);
        assert.ok(fs.existsSync(path.join(p.root, CONTROLLER_PROJECT_MANIFEST_FILE)));
    } finally {
        p.cleanup();
    }
});

test('controllerProjectWorkspace: 중첩 .gpr 파일도 FTP 다운로드 루트 하나로 해석한다', () => {
    const p = makeTree();
    try {
        writeControllerProjectManifest(p.root, {
            mode: 'live',
            controllerHost: '192.168.0.1',
            sourceRemotePath: '/GPL/Lib',
            projectName: 'Lib',
            downloadedAt: '2026-10-21T00:00:00.000Z',
        });
        const file = path.join(p.nested, 'Logger.gpl');
        assert.strictEqual(findControllerProjectContext(file)?.root, p.root);
        assert.deepStrictEqual(collapseControllerProjectDirs([p.root, p.nested]), [p.root]);
    } finally {
        p.cleanup();
    }
});

test('controllerProjectWorkspace: 쓰기 게이트는 Snapshot과 다른 제어기를 차단하고 같은 Live 원본은 허용한다', () => {
    const p = makeTree();
    try {
        writeControllerProjectManifest(p.root, {
            mode: 'snapshot',
            controllerHost: '192.168.0.1',
            sourceRemotePath: '/GPL/Lib',
            projectName: 'Lib',
            downloadedAt: '2026-10-21T00:00:00.000Z',
        });
        assert.strictEqual(getControllerProjectWriteBlock(p.nested, '192.168.0.1')?.kind, 'read-only');

        writeControllerProjectManifest(p.root, {
            mode: 'live',
            controllerHost: '192.168.0.1',
            sourceRemotePath: '/GPL/Lib',
            projectName: 'Lib',
            downloadedAt: '2026-10-21T00:00:00.000Z',
        });
        assert.strictEqual(getControllerProjectWriteBlock(p.nested, '192.168.0.2')?.kind, 'controller-mismatch');
        assert.strictEqual(getControllerProjectWriteBlock(p.nested, '192.168.0.1'), undefined);
    } finally {
        p.cleanup();
    }
});

test('controllerProjectWorkspace: 기존 사본은 덮어쓰지 않고 다음 폴더를 선택한다', () => {
    const p = makeTree();
    try {
        assert.strictEqual(chooseAvailableDownloadDir(p.parent, 'Lib'), path.join(p.parent, 'Lib-2'));
        fs.mkdirSync(path.join(p.parent, 'Lib-2'));
        assert.strictEqual(chooseAvailableDownloadDir(p.parent, 'Lib'), path.join(p.parent, 'Lib-3'));
        assert.strictEqual(chooseAvailableDownloadDir(p.parent, 'NewProject'), path.join(p.parent, 'NewProject'));
    } finally {
        p.cleanup();
    }
});

test('controllerProjectWorkspace: 저장된 workspace는 상위 폴더 하나를 루트로 쓰고 기존 설정을 보존한다', () => {
    const p = makeTree();
    try {
        const workspacePath = controllerWorkspacePath(p.parent, '192.168.0.1');
        fs.writeFileSync(workspacePath, JSON.stringify({ settings: { 'editor.tabSize': 4 }, folders: [] }), 'utf8');
        assert.strictEqual(ensureControllerWorkspaceFile(p.parent, '192.168.0.1'), workspacePath);
        const workspace = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
        assert.deepStrictEqual(workspace.folders, [{ path: '.', name: 'GPL Controller 192.168.0.1' }]);
        assert.deepStrictEqual(workspace.settings, { 'editor.tabSize': 4 });
    } finally {
        p.cleanup();
    }
});

test('controllerProjectWorkspace: staging 정리는 기능이 만든 직계 임시 폴더에만 허용한다', () => {
    const p = makeTree();
    try {
        const staging = makeDownloadStagingDir(p.parent, 'Lib');
        fs.writeFileSync(path.join(staging, 'partial.gpl'), 'partial', 'utf8');
        removeDownloadStagingDir(staging, p.parent);
        assert.strictEqual(fs.existsSync(staging), false);
        assert.throws(() => removeDownloadStagingDir(p.root, p.parent), /관리 대상이 아닌 폴더/);
    } finally {
        p.cleanup();
    }
});
