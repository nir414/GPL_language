import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { breakpointSendTarget, listLibraryProjectNames, listNestedLibraryRefs, resolveBreakpointTarget } from '../../../project/remote/breakpointTarget';
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

// 2026-11-13 실측(G2400C 4.2K5, captures/nesttest)을 그대로 옮긴 배치: 제어기가 아는 라이브러리 이름은 ProjectName 이 아니라
// ProjectLibrary 값(= /GPL 바로 아래 폴더 이름)이고, 중첩 값(NLib\Core\Log)은 Set Break 로 지정할 방법이 없다.
function siblingFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-bp-sibling-'));
    const projects = path.join(root, 'projects');
    const w = (rel: string, lines: string[]): string => {
        const full = path.join(projects, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, lines.join('\r\n'), 'utf8');
        return full;
    };
    const appText = [
        'ProjectBegin', 'ProjectName="FApp"', 'ProjectStart="Main"',
        'ProjectLibrary="FDir"', 'ProjectLibrary="TLib"', 'ProjectLibrary="NLib\\Core\\Log"',
        'ProjectSource="Main.gpl"', 'ProjectEnd',
    ].join('\r\n');
    const appGpr = w('FApp/Project.gpr', [appText]);
    w('FApp/Main.gpl', ['Module Main', 'End Module']);
    w('FDir/Project.gpr', ['ProjectBegin', 'ProjectName="FName"', 'ProjectSource="F.gpl"', 'ProjectEnd']);
    const fFile = w('FDir/F.gpl', ['Module FMOD', 'End Module']);
    w('TLib/Project.gpr', ['ProjectBegin', 'ProjectName="TLib"', 'ProjectSource="Core\\Log\\Logger.gpl"', 'ProjectEnd']);
    const tFile = w('TLib/Core/Log/Logger.gpl', ['Module TLOG', 'End Module']);
    w('NLib/Core/Log/Project.gpr', ['ProjectBegin', 'ProjectName="Log"', 'ProjectSource="Logger.gpl"', 'ProjectEnd']);
    const nFile = w('NLib/Core/Log/Logger.gpl', ['Module NLOG', 'End Module']);
    return { appGpr, appText, fFile, tFile, nFile, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
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

test('breakpointTarget: 형제 라이브러리는 ProjectName 이 아니라 폴더 이름(ProjectLibrary 값)으로 보낸다 — FDir/FName 실측', () => {
    const p = siblingFixture();
    try {
        const result = resolveBreakpointTarget({ gprPath: p.appGpr, gprText: p.appText, localPath: p.fFile, line: 4 });
        assert.strictEqual(result.kind, 'library-source');
        assert.strictEqual(result.projectName, 'FApp');
        assert.strictEqual(result.controllerProject, 'FDir');
        assert.deepStrictEqual(breakpointSendTarget(result), { project: 'FDir', file: 'F.gpl' });
    } finally { p.cleanup(); }
});

test('breakpointTarget: 라이브러리 .gpr 하나 + 하위 폴더 소스는 ProjectSource 표기(역슬래시)로 보낸다 — TLib 실측', () => {
    const p = siblingFixture();
    try {
        const result = resolveBreakpointTarget({ gprPath: p.appGpr, gprText: p.appText, localPath: p.tFile, line: 4 });
        assert.deepStrictEqual(breakpointSendTarget(result), { project: 'TLib', file: 'Core\\Log\\Logger.gpl' });
    } finally { p.cleanup(); }
});

test('breakpointTarget: 중첩 라이브러리 소스는 보내지 않고 사유·해법을 알린다(형제 중첩·메인 폴더 안 중첩 모두)', () => {
    const p = siblingFixture();
    try {
        const result = resolveBreakpointTarget({ gprPath: p.appGpr, gprText: p.appText, localPath: p.nFile, line: 4 });
        assert.strictEqual(result.kind, 'library-source');
        assert.strictEqual(result.nestedLibraryRef, 'NLib\\Core\\Log');
        assert.strictEqual(result.file, undefined);
        assert.strictEqual(breakpointSendTarget(result), undefined);
        assert.ok(result.message?.includes('ProjectLibrary="NLib\\Core\\Log"'));
        assert.ok(result.message?.includes('ProjectLibrary="NLib"'));
    } finally { p.cleanup(); }
    // 메인 폴더 안 라이브러리(GenAdp\Lib_Net\Server)도 값이 여러 조각이라 지정 불가 — 2026-08-31 실측(표기 12종 -508)과 같은 결론.
    const q = fixture();
    try {
        const result = resolveBreakpointTarget({ gprPath: q.mainGpr, gprText: q.mainText, localPath: path.join(q.libDir, 'Loop.gpl'), line: 72 });
        assert.strictEqual(result.kind, 'library-source');
        assert.strictEqual(result.projectName, 'GenAdp');
        assert.strictEqual(result.nestedLibraryRef, 'GenAdp\\Lib_Net\\Server');
        assert.strictEqual(breakpointSendTarget(result), undefined);
    } finally { q.cleanup(); }
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

test('breakpointTarget: listLibraryProjectNames 는 낱말 하나인 ProjectLibrary 값, listNestedLibraryRefs 는 중첩 값(/ 구분)', () => {
    const p = siblingFixture();
    try {
        assert.deepStrictEqual(listLibraryProjectNames(p.appGpr, p.appText), ['FDir', 'TLib']);
        assert.deepStrictEqual(listNestedLibraryRefs(p.appGpr, p.appText), ['NLib/Core/Log']);
    } finally { p.cleanup(); }
    const q = fixture();
    try {
        assert.deepStrictEqual(listLibraryProjectNames(q.mainGpr, q.mainText), []);
        assert.deepStrictEqual(listNestedLibraryRefs(q.mainGpr, q.mainText), ['GenAdp/Lib_Net/Server']);
    } finally { q.cleanup(); }
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
