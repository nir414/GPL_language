import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import { GPLParser, GPLSymbol } from '../../../language/syntax/gplParser';
import { checkPackageDependencies, GprFix, parseLayerRules, projectNameMismatch } from '../../../project/gpr/dependencyCheck';
import { buildPackageInputs, findCompileRootGpr } from '../../../project/gpr/dependencyModel';
import { computeFileDependencies } from '../../../providers/diagnostics/requiresHeaderPlan';
import { isPathUnder } from '../../../util/pathKey';

// BinderR4(2026-10-27) 구조를 줄인 것 — 루트가 하위 패키지 소스를 평탄하게 나열하고(ProjectStart 있음),
// 리프 패키지는 루트 기준 경로 ProjectLibrary 로 의존을 선언하고, 그룹 .gpr 은 ProjectLibrary 만 가진다.

function makeProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-depcheck-'));
    for (const [rel, text] of Object.entries(files)) {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text, 'utf8');
    }
    return root;
}

function cleanup(root: string): void {
    // fs.rmSync 는 경로에 비ASCII 가 있으면 Node 가 죽는 사례가 있어 쓰지 않는다.
    const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); fs.rmdirSync(full); } else { fs.unlinkSync(full); }
        }
    };
    try { walk(root); fs.rmdirSync(root); } catch { /* noop */ }
}

const gpr = (name: string, lines: string[]): string => ['ProjectBegin', `ProjectName="${name}"`, ...lines, 'ProjectEnd'].join('\r\n') + '\r\n';
const lib = (p: string): string => `ProjectLibrary="${p}"`;
const src = (p: string): string => `ProjectSource="${p}"`;
const mod = (...lines: string[]): string => lines.join('\n');

const FILES: Record<string, string> = {
    'Project.gpr': gpr('Root', [
        'ProjectStart="APP.MAIN"',
        "' Dependencies: App -> Lib.",
        src('Lib\\Core\\Text\\Str.gpl'), src('Lib\\Core\\Clock\\Clock.gpl'), src('Lib\\Core\\Log\\Log.gpl'),
        src('Lib\\Other\\Other.gpl'), src('Lib\\Dev\\Dev.gpl'), src('App\\Main.gpl'),
    ]),
    'Lib/Core/Project.gpr': gpr('Lib_Core', [lib('Lib\\Core\\Text'), lib('Lib\\Core\\Clock'), lib('Lib\\Core\\Log')]),
    'Lib/Core/Text/Project.gpr': gpr('Lib_Text', [src('Str.gpl')]),
    'Lib/Core/Clock/Project.gpr': gpr('Lib_Clock', [src('Clock.gpl')]),
    'Lib/Core/Log/Project.gpr': gpr('Lib_Log', [lib('Lib\\Core\\Text'), src('Log.gpl')]),
    'Lib/Other/Project.gpr': gpr('Lib_Other', [src('Other.gpl')]),
    'Lib/Dev/Project.gpr': gpr('Lib_Dev', [lib('Lib\\Core\\Log'), lib('Lib\\Other'), lib('Lib\\Missing'), src('Dev.gpl')]),
    'Lib/Core/Text/Str.gpl': mod('Module STR', '    Public Function Trim(s As String) As String', '        Return s', '    End Function', 'End Module'),
    'Lib/Core/Clock/Clock.gpl': mod('Module CLK', '    Public Function Ticks() As Integer', '        Return 0', '    End Function', 'End Module'),
    'Lib/Core/Log/Log.gpl': mod('Module LOG', '    Public Sub Write(m As String)', '        m = STR.Trim(m) & CStr(CLK.Ticks())', '    End Sub', 'End Module'),
    'Lib/Other/Other.gpl': mod('Module OTH', '    Public Sub Z()', '    End Sub', 'End Module'),
    'Lib/Dev/Dev.gpl': mod(
        'Module DEV',
        '    Public Delegate Sub DoneSub(ByVal ticks As Integer)',
        '    Public Sub Run()',
        '        LOG.Write(STR.Trim("a"))',
        '        APP.Foo()',
        '        EXT.Go()',
        '    End Sub',
        'End Module',
    ),
    'Lib/Dev/Extra.gpl': mod('Module EXT', '    Public Sub Go()', '    End Sub', 'End Module'),
    'App/Main.gpl': mod('Module APP', '    Public Sub Foo()', '    End Sub', '    Public Sub MAIN()', '        DEV.Run()', '    End Sub', 'End Module'),
};

const fixLine = (f: GprFix): number => f.kind === 'insert' ? f.insertLine : f.kind === 'remove' ? f.removeLine : f.replaceLine;

function run(root: string) {
    const rootGpr = findCompileRootGpr(path.join(root, 'Lib', 'Dev', 'Dev.gpl'))!;
    const packages = buildPackageInputs(rootGpr);
    const all: GPLSymbol[] = [];
    const texts = new Map<string, string>();
    for (const rel of Object.keys(FILES).filter(f => f.endsWith('.gpl'))) {
        const full = path.join(root, rel);
        texts.set(full.toLowerCase(), FILES[rel]);
        all.push(...GPLParser.parseDocument(FILES[rel], full));
    }
    const lookup = {
        findAllByName: (n: string) => all.filter(s => s.name.toLowerCase() === n.toLowerCase()),
        isSameCompileUnit: (c: string) => isPathUnder(c, root),
    };
    const result = checkPackageDependencies({
        rootGprPath: rootGpr, packages,
        depsOf: f => { const t = texts.get(f.toLowerCase()); return t ? computeFileDependencies(t, f, lookup) : []; },
    });
    const rel = (p: string) => path.relative(root, p).replace(/\\/g, '/');
    return { rootGpr, packages, result, rel };
}

test('dependencyCheck: 컴파일 루트는 ProjectStart 가 있는 위쪽 .gpr, 패키지는 루트 아래 .gpr 전부', () => {
    const root = makeProject(FILES);
    try {
        const { rootGpr, packages, rel } = run(root);
        assert.strictEqual(rel(rootGpr), 'Project.gpr');
        assert.strictEqual(packages.length, 7);
        const dev = packages.find(p => rel(p.gprPath) === 'Lib/Dev/Project.gpr')!;
        assert.deepStrictEqual(dev.refs.map(r => [r.raw, r.dir ? rel(r.dir) : undefined]),
            [['Lib\\Core\\Log', 'Lib/Core/Log'], ['Lib\\Other', 'Lib/Other'], ['Lib\\Missing', undefined]], '리프의 루트 기준 경로를 푼다');
    } finally { cleanup(root); }
});

test('dependencyCheck: 누락·간접·미사용·미해석 ProjectLibrary 와 ProjectSource 누락을 .gpr 별로 낸다', () => {
    const root = makeProject(FILES);
    try {
        const { result, rel } = run(root);
        const view = result.gprFindings.filter(f => f.code !== 'project-name-mismatch').map(f => `${rel(f.gprPath)} ${f.code}${f.fix ? ` [${f.fix.title} @${fixLine(f.fix) + 1}]` : ''}`).sort();
        assert.deepStrictEqual(view, [
            'Lib/Core/Log/Project.gpr library-missing [ProjectLibrary="Lib\\Core\\Clock" 추가 @4]',
            'Lib/Dev/Project.gpr library-indirect [ProjectLibrary="Lib\\Core\\Text" 추가 @6]',
            'Lib/Dev/Project.gpr library-unresolved',
            'Lib/Dev/Project.gpr library-unused [ProjectLibrary "Lib\\Other" 줄 지우기 @4]',
            'Lib/Dev/Project.gpr source-missing',
            'Lib/Dev/Project.gpr source-missing [ProjectSource="Extra.gpl" 추가 @6]', // 쓰는 소스(Dev.gpl) 앞
            'Project.gpr source-missing [ProjectSource="Lib\\Dev\\Extra.gpl" 추가 @9]',
        ]);
        const outside = result.gprFindings.find(f => f.code === 'source-missing' && !f.fix)!;
        assert.ok(outside.message.includes('Main.gpl') && outside.message.includes('폴더 밖'), '루트에만 있는 App 파일은 라이브러리로 고칠 수 없다');
        assert.ok(!result.gprFindings.some(f => rel(f.gprPath) === 'Lib/Core/Project.gpr' && f.code !== 'project-name-mismatch'),
            '그룹 .gpr 은 참조(와 ProjectName)만 확인');
        assert.ok(!result.gprFindings.some(f => f.message.includes('Clock.gpl') && rel(f.gprPath) === 'Project.gpr'), '평탄한 루트는 나열한 파일로 충분');
    } finally { cleanup(root); }
});

test('dependencyCheck: 루트 Dependencies 규칙 위반을 사용 위치에 낸다(Delegate 매개변수 이름은 참조가 아니다)', () => {
    const root = makeProject(FILES);
    try {
        const { result, rel } = run(root);
        assert.deepStrictEqual(result.layerFindings.map(f => `${rel(f.filePath)}:${f.line + 1}:${f.character + 1}`), ['Lib/Dev/Dev.gpl:5:9']);
        assert.ok(result.layerFindings[0].message.includes('Lib → App'));
        assert.ok(!result.gprFindings.some(f => f.message.includes('Clock.gpl') && rel(f.gprPath).startsWith('Lib/Dev')),
            '`ByVal ticks` 가 CLK.Ticks 로 풀리지 않는다');
    } finally { cleanup(root); }
});

test('dependencyCheck: ProjectName 은 폴더 이름과 같아야 한다 — 그룹·루트 포함 모든 .gpr, 수정은 ProjectName 쪽', () => {
    const root = makeProject(FILES);
    try {
        const { result, rel } = run(root);
        const names = result.gprFindings.filter(f => f.code === 'project-name-mismatch');
        assert.strictEqual(names.length, 7, '이 픽스처는 BinderR4 처럼 Lib_Text·Lib_Core 등 폴더와 다른 이름을 쓴다');
        const text = names.find(f => rel(f.gprPath) === 'Lib/Core/Text/Project.gpr')!;
        assert.strictEqual(text.severity, 'warning');
        assert.strictEqual(text.line, 1);
        assert.deepStrictEqual(text.fix, { kind: 'replace', replaceLine: 1, text: 'ProjectName="Text"', title: 'ProjectName="Text" 로 바꾸기' });
    } finally { cleanup(root); }

    const at = (dir: string, body: string) => projectNameMismatch({ gprPath: path.join('C:\\p', dir, 'Project.gpr'), text: body });
    assert.strictEqual(at('BinderR4', 'ProjectBegin\r\nProjectName="BinderR4"\r\nProjectEnd'), undefined);
    const caseOnly = at('BinderR4', 'ProjectBegin\r\n  ProjectName="binderr4"\r\nProjectEnd')!;
    assert.ok(caseOnly.message.includes('대소문자가 다릅니다'));
    assert.strictEqual((caseOnly.fix as { text: string }).text, '  ProjectName="BinderR4"', '들여쓰기는 유지');
    const dup = projectNameMismatch({ gprPath: 'C:\\p\\Lib\\Data\\Project.gpr', text: 'ProjectBegin\nProjectName="Lib_Data"\nProjectEnd' },
        ['C:\\p\\Gantry\\Data\\Project.gpr'])!;
    assert.ok(dup.message.includes('Gantry\\Data') && dup.message.includes('겹칩니다'), '고치면 겹치는 폴더 이름을 알린다');
    assert.deepStrictEqual(at('X', 'ProjectBegin\nProjectSource="a.gpl"\nProjectEnd')!.fix,
        { kind: 'insert', insertLine: 1, text: 'ProjectName="X"', title: 'ProjectName="X" 추가' });
});

test('dependencyCheck: 규칙 줄 파싱 — 화살표 오른쪽 / 구분, 세미콜론, 끝 마침표', () => {
    const rules = parseLayerRules("ProjectBegin\r\n' Dependencies: App -> Config/Gantry/Lib; Config -> Gantry/Lib; Gantry -> Lib.\r\nProjectEnd")!;
    assert.strictEqual(rules.line, 1);
    assert.deepStrictEqual([...rules.allowed].map(([k, v]) => `${k}:${[...v].join('/')}`), ['app:config/gantry/lib', 'config:gantry/lib', 'gantry:lib']);
    assert.deepStrictEqual([...rules.groups.values()], ['App', 'Config', 'Gantry', 'Lib']);
    assert.strictEqual(parseLayerRules("' Dependencies are listed below"), undefined);
});
