import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveBreakpointTarget } from '../project/breakpointTarget';
import { test } from './harness';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-bp-target-'));
    const mainDir = path.join(root, 'projects', 'GenAdp');
    const libDir = path.join(mainDir, 'Lib_Net', 'Server');
    fs.mkdirSync(path.join(mainDir, 'App', 'Host'), { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    const mainGpr = path.join(mainDir, 'Project.gpr');
    const mainText = [
        'ProjectBegin',
        'ProjectName="GenAdp"',
        'ProjectLibrary="GenAdp\\Lib_Net\\Server"',
        'ProjectSource="Main.gpl"',
        'ProjectSource="App\\Host\\Commands.gpl"',
        'ProjectEnd',
    ].join('\r\n');
    const libGpr = path.join(libDir, 'Project.gpr');
    fs.writeFileSync(mainGpr, mainText, 'utf8');
    fs.writeFileSync(libGpr, [
        'ProjectBegin',
        'ProjectName="Lib_NetServer"',
        'ProjectSource="Loop.gpl"',
        'ProjectEnd',
    ].join('\r\n'), 'utf8');
    for (const file of [path.join(mainDir, 'Main.gpl'), path.join(mainDir, 'App', 'Host', 'Commands.gpl'), path.join(libDir, 'Loop.gpl')]) {
        fs.writeFileSync(file, 'Module M\r\nEnd Module\r\n', 'utf8');
    }
    return { root, mainDir, libDir, mainGpr, mainText, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('breakpointTarget: 직접 하위 source는 ProjectSource 원문 경로를 보존한다', () => {
    const p = fixture();
    try {
        const result = resolveBreakpointTarget({
            gprPath: p.mainGpr,
            gprText: p.mainText,
            localPath: path.join(p.mainDir, 'App', 'Host', 'Commands.gpl'),
            line: 461,
        });
        assert.deepStrictEqual(
            { kind: result.kind, projectName: result.projectName, file: result.file, line: result.line },
            { kind: 'direct-source', projectName: 'GenAdp', file: 'App\\Host\\Commands.gpl', line: 461 },
        );
    } finally { p.cleanup(); }
});

test('breakpointTarget: ProjectLibrary source는 명령 대상이 아니다', () => {
    const p = fixture();
    try {
        const result = resolveBreakpointTarget({
            gprPath: p.mainGpr,
            gprText: p.mainText,
            localPath: path.join(p.libDir, 'Loop.gpl'),
            line: 72,
        });
        assert.strictEqual(result.kind, 'library-source');
        assert.strictEqual(result.file, undefined);
        assert.strictEqual(result.libraryName, 'Lib_NetServer');
        assert.ok(result.message?.includes('Promote Source for Breakpoint'));
    } finally { p.cleanup(); }
});

test('breakpointTarget: 같은 basename이어도 직접 source 절대경로만 매칭한다', () => {
    const p = fixture();
    try {
        const decoy = path.join(p.mainDir, 'Other', 'Commands.gpl');
        fs.mkdirSync(path.dirname(decoy), { recursive: true });
        fs.writeFileSync(decoy, '', 'utf8');
        const result = resolveBreakpointTarget({
            gprPath: p.mainGpr,
            gprText: p.mainText,
            localPath: decoy,
            line: 10,
        });
        assert.strictEqual(result.kind, 'outside-project');
    } finally { p.cleanup(); }
});
