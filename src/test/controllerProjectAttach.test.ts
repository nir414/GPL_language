/** 실제 DAP 초기화·중단점·분리 경로를 모의 통신으로 실행한다. 제어기에는 연결하지 않는다. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { controllerDebugConfiguration } from '../project/controllerProjectDebug';
import { parseBreakpointCommand } from '../controller/debugging/breakpointCommand';
import { test } from './harness';

const SUCCESS = '<STATUS>0,"Success"</STATUS>';
const BREAKS = `<DATA>1, Probe, Main, 1, Main.gpl, 10, 0\n2, Other, Main, 1, Main.gpl, 20, 0</DATA>${SUCCESS}`;

function sessionFixture(breakResponse = BREAKS, requireStartConfirmation = true, realSourceMap = false) {
    const commands: string[] = [];
    const errors: unknown[] = [];
    const disposable = () => ({ dispose() {} });
    const config = { ip: '192.0.2.1', port: 1402, consolePort: 1403, timeoutMs: 10000 };
    const vscode = {
        workspace: {
            workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
            getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'controller.requireStartConfirmation' ? requireStartConfirmation : fallback }),
            onDidSaveTextDocument: disposable,
        },
        window: { showWarningMessage: () => { throw new Error('Attach에서 Start 확인을 요청하면 안 된다'); } },
    };
    const filename = path.resolve(__dirname, '../debug/gplDebugSession.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} as any };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, console, setTimeout, clearTimeout, setInterval, clearInterval, Buffer,
        require: (id: string) => {
            if (id === 'vscode') { return vscode; }
            if (id.endsWith('/controllerConnection')) {
                return { getControllerConfig: () => config, getConnectionProbeTimeoutMs: () => 1000, sendCommand: async (cmd: string) => { commands.push(cmd); return SUCCESS; } };
            }
            if (id.endsWith('/deployService')) { return {}; }
            if (id.endsWith('/deployRecord')) { return { onDidRecordCompiled: disposable }; }
            if (id.endsWith('/debugBridge')) { return { onDebugPollTrigger: disposable }; }
            return realRequire(id);
        },
    }, { filename });
    const session = new module.exports.GPLDebugSession();
    session._log = () => {};
    session.sendResponse = () => {};
    session.sendEvent = () => {};
    session.sendErrorResponse = (_response: unknown, error: unknown) => errors.push(error);
    const controllerLines = new Set([10]);
    session._sendCmd = async (cmd: string) => {
        commands.push(cmd);
        const bp = parseBreakpointCommand(cmd);
        if (bp?.project === 'Probe') {
            if (bp.kind === 'Break') { controllerLines.add(bp.line); } else { controllerLines.delete(bp.line); }
        }
        if (cmd !== 'Show Break') { return SUCCESS; }
        if (breakResponse !== BREAKS) { return breakResponse; }
        return `<DATA>${[...controllerLines].map((line, i) => `${i + 1}, Probe, Main, 1, Main.gpl, ${line}, 0`).join('\n')}\n2, Other, Main, 1, Main.gpl, 20, 0</DATA>${SUCCESS}`;
    };
    if (!realSourceMap) {
        session._updateProjectDirs = () => {};
        session._buildSourceFileMap = () => {};
    }
    session._evaluateSourceStaleness = () => {};
    session._startPolling = () => {};
    session._fastPoll = () => {};
    if (!realSourceMap) { session._bpFileForms = (file: string) => [file]; }
    session._setLockedThread = () => {};
    const args = controllerDebugConfiguration({
        host: config.ip, port: config.port, consolePort: config.consolePort,
        projectName: 'Probe', projectDir: path.resolve('snapshot/Probe'), remotePath: '/GPL/Probe',
    });
    return { session, args, commands, errors, vscode };
}

test('controller project Attach: 초기화와 configurationDone에서 읽기 명령만 보낸다', async () => {
    for (const stopOnEntry of [false, true]) {
        const s = sessionFixture();
        await s.session.attachRequest({}, { ...s.args, stopOnEntry });
        await s.session.configurationDoneRequest({}, {});
        assert.deepStrictEqual(s.errors, []);
        assert.deepStrictEqual(s.commands, ['ErrorLog', 'Show Break']);
    }
});

test('controller project Attach: 기존 BP는 수정·분리 때 남기고 새 BP만 해제한다', async () => {
    const s = sessionFixture();
    await s.session.attachRequest({}, s.args);
    s.session._resolveBreakpointTarget = () => ({ kind: 'direct-source', file: 'Main.gpl' });
    s.session._adjustBreakpointLine = (_file: string, line: number) => ({ line, moved: false });
    s.session._clientSideBpLogicEnabled = () => false;
    await s.session.setBreakPointsRequest({}, { source: { path: 'Main.gpl' }, lines: [10, 11] });
    await s.session.disconnectRequest({}, {});
    const writes = s.commands.filter(cmd => /^Set /i.test(cmd));
    assert.deepStrictEqual(writes, ['Set Break Probe "Main.gpl"11', 'Set Nobreak Probe "Main.gpl"11']);
    assert.ok(!s.commands.some(cmd => /^(Stop|Start|Compile|Load|Unload)\b/i.test(cmd)));
});

test('controller project Attach: basename으로 조회된 기존 BP를 상대 경로 요청에서도 보존한다', async () => {
    const s = sessionFixture();
    s.session._bpFileForms = (file: string) => file.includes('\\') ? [file] : [file, `Sub\\${file}`];
    await s.session.attachRequest({}, s.args);
    const count = s.commands.length;
    await s.session._sendBpCommandWithFallback('Nobreak', 'Probe', 'Sub\\Main.gpl', 10);
    assert.strictEqual(s.commands.length, count);
});

test('controller project Attach: 기존 구성의 자동 Start 기본 동작은 유지한다', async () => {
    const s = sessionFixture(BREAKS, false);
    s.session._waitDeployLockForStart = async () => true;
    await s.session.attachRequest({}, { ...s.args, startOnAttach: undefined });
    await s.session.configurationDoneRequest({}, {});
    assert.strictEqual(s.commands.filter(cmd => /^Start Probe\b/.test(cmd)).length, 1);
});

test('controller project Attach: 기존 BP 조회 실패 때는 상태를 바꾸지 않고 중단한다', async () => {
    for (const response of ['<STATUS>-1,"Failed"</STATUS>', '<STATUS>0,"Success"']) {
        const s = sessionFixture(response);
        await s.session.attachRequest({}, s.args);
        assert.strictEqual(s.errors.length, 1);
        assert.strictEqual(s.session._isConnected, false);
        assert.deepStrictEqual(s.commands, ['ErrorLog', 'Show Break']);
    }
});

test('controller project Attach: 동명 사본이 있어도 선택한 폴더와 참조 라이브러리로 소스를 매핑한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-debug-source-map-'));
    try {
        const main = path.join(root, 'FolderName');
        const library = path.join(root, 'Lib', 'Core');
        const copy = path.join(root, 'OlderCopy');
        for (const dir of [main, library, copy]) { fs.mkdirSync(dir, { recursive: true }); }
        const gpr = 'ProjectName="Probe"\nProjectSource="Main.gpl"\nProjectLibrary="Lib\\Core"\n';
        fs.writeFileSync(path.join(main, 'Project.gpr'), gpr);
        fs.writeFileSync(path.join(main, 'Main.gpl'), 'Module Main\nEnd Module\n');
        fs.writeFileSync(path.join(copy, 'Project.gpr'), gpr);
        fs.writeFileSync(path.join(copy, 'Main.gpl'), 'Module OlderMain\nEnd Module\n');
        fs.writeFileSync(path.join(library, 'Project.gpr'), 'ProjectName="Core"\nProjectSource="Core.gpl"\n');
        fs.writeFileSync(path.join(library, 'Core.gpl'), 'Module Core\nEnd Module\n');
        const s = sessionFixture(BREAKS, true, true);
        s.vscode.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
        await s.session.attachRequest({}, { ...s.args, projectDir: main });
        assert.deepStrictEqual(s.errors, []);
        assert.strictEqual(s.session._resolveSourcePath('Main.gpl'), path.join(main, 'Main.gpl'));
        assert.strictEqual(s.session._resolveSourcePath('Core.gpl'), path.join(library, 'Core.gpl'));
        assert.ok(!s.session._projectDirs.includes(copy));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
