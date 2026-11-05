import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { breakpointSendTarget, listLibraryProjectNames, resolveBreakpointTarget } from '../../../project/remote/breakpointTarget';
import { test } from '../../harness';

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

test('breakpointTarget: ProjectLibrary source는 라이브러리 프로젝트 이름 + 라이브러리 안 파일로 보낸다', () => {
    const p = fixture();
    try {
        const result = resolveBreakpointTarget({
            gprPath: p.mainGpr,
            gprText: p.mainText,
            localPath: path.join(p.libDir, 'Loop.gpl'),
            line: 72,
        });
        assert.strictEqual(result.kind, 'library-source');
        assert.strictEqual(result.file, 'Loop.gpl');
        assert.strictEqual(result.libraryName, 'Lib_NetServer');
        assert.strictEqual(result.controllerProject, 'Lib_NetServer');
        assert.strictEqual(result.projectName, 'GenAdp');
        assert.deepStrictEqual(breakpointSendTarget(result), { project: 'Lib_NetServer', file: 'Loop.gpl' });
    } finally { p.cleanup(); }
});

test('breakpointTarget: 라이브러리 하위 폴더 source는 라이브러리 기준 상대 경로(역슬래시 표기)를 쓴다', () => {
    const p = fixture();
    try {
        const nested = path.join(p.libDir, 'Sub', 'Deep.gpl');
        fs.mkdirSync(path.dirname(nested), { recursive: true });
        fs.writeFileSync(nested, '', 'utf8');
        fs.writeFileSync(path.join(p.libDir, 'Project.gpr'), [
            'ProjectBegin', 'ProjectName="Lib_NetServer"', 'ProjectSource="Loop.gpl"', 'ProjectSource="Sub\\Deep.gpl"', 'ProjectEnd',
        ].join('\r\n'), 'utf8');
        const result = resolveBreakpointTarget({ gprPath: p.mainGpr, gprText: p.mainText, localPath: nested, line: 5 });
        assert.deepStrictEqual(breakpointSendTarget(result), { project: 'Lib_NetServer', file: 'Sub\\Deep.gpl' });
    } finally { p.cleanup(); }
});

test('breakpointTarget: 직접 source·프로젝트 밖 source의 전송 대상', () => {
    const p = fixture();
    try {
        const direct = resolveBreakpointTarget({ gprPath: p.mainGpr, gprText: p.mainText, localPath: path.join(p.mainDir, 'Main.gpl'), line: 1 });
        assert.deepStrictEqual(breakpointSendTarget(direct), { project: 'GenAdp', file: 'Main.gpl' });
        const outside = resolveBreakpointTarget({ gprPath: p.mainGpr, gprText: p.mainText, localPath: path.join(p.root, 'elsewhere.gpl'), line: 1 });
        assert.strictEqual(breakpointSendTarget(outside), undefined);
        assert.ok(outside.message);
        assert.strictEqual(breakpointSendTarget(undefined), undefined);
    } finally { p.cleanup(); }
});

test('breakpointTarget: listLibraryProjectNames는 루트를 뺀 라이브러리 ProjectName 목록', () => {
    const p = fixture();
    try {
        assert.deepStrictEqual(listLibraryProjectNames(p.mainGpr, p.mainText), ['Lib_NetServer']);
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
