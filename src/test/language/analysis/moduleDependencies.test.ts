import * as assert from 'assert';
import { sep } from 'path';
import { test } from '../../harness';
import { GPLParser, GPLSymbol } from '../../../language/syntax/gplParser';
import { collectRequiredFiles, DependencyLookup, orderRequiredFiles, RequiredFile, scanChains } from '../../../language/analysis/moduleDependencies';
import { buildReceiverContextFromText } from '../../../providers/intellisense/receiverContext';

const src = (...lines: string[]): string => lines.join('\n');
/** 픽스처 경로를 이 OS 의 구분자로 — 제품 코드는 path.basename(플랫폼 기본)을 쓰므로 Linux CI 에서도 같은 결과가 나오게 한다. */
const native = (p: string): string => p.replace(/\\/g, sep);

/** 실제 배선(requiresHeaderPlan)과 같은 수신자 조립으로 계산한다. */
function collect(text: string, filePath: string, lookup: DependencyLookup): RequiredFile[] {
    const lines = text.split('\n');
    return collectRequiredFiles(text, filePath, lookup, (line, find) => buildReceiverContextFromText(lines, filePath, line, find).lookup);
}

/** 파일들을 파싱해 SymbolCache 처럼 이름으로 돌려주는 조회(자기 파일도 인덱스에 들어 있는 실제 상황을 흉내 낸다). */
function lookupOf(files: Record<string, string>, sameUnit: (candidate: string) => boolean = () => true): DependencyLookup {
    const all: GPLSymbol[] = [];
    for (const [file, text] of Object.entries(files)) { all.push(...GPLParser.parseDocument(text, file)); }
    return {
        findAllByName: name => all.filter(s => s.name.toLowerCase() === name.toLowerCase()),
        isSameCompileUnit: candidate => sameUnit(candidate),
    };
}

const LIB = {
    [native('C:\\p\\Lib\\MotionSystem.gpl')]: src(
        'Module MSY',
        '    Public Class MotionSystem',
        '        Public Function OpenLines() As Boolean',
        '        End Function',
        '        Public Sub Shutdown()',
        '        End Sub',
        '        Public Sub Unused()',
        '        End Sub',
        '    End Class',
        '    Public Sub SetHomePosition()',
        '    End Sub',
        'End Module',
    ),
    [native('C:\\p\\Lib\\Logger.gpl')]: src(
        'Module LOG',
        '    Public Sub Write(msg As String)',
        '    End Sub',
        '    Public Sub WriteEx(msg As String)',
        '    End Sub',
        'End Module',
    ),
    [native('C:\\p\\Lib\\Worker.gpl')]: src(
        'Module RWK',
        '    Public Class RobotWorker',
        '        Public Shared Sub ResetSharedState()',
        '        End Sub',
        '    End Class',
        'End Module',
    ),
    [native('C:\\p\\Lib\\DupA.gpl')]: src('Module DPA', '    Public Sub Same()', '    End Sub', 'End Module'),
    [native('C:\\p\\Lib\\DupB.gpl')]: src('Module DPB', '    Public Sub Same()', '    End Sub', 'End Module'),
};

const MACHINE_PATH = native('C:\\p\\App\\Machine.gpl');
const MACHINE = src(
    "'Requires:",
    "' - MotionSystem.gpl (Module MSY): MotionSystem(OpenLines, Shutdown)",
    'Module BRM',
    '    Private m_sys As MotionSystem',
    '    Public Sub Setup()',
    '        Dim w As Integer',
    '        m_sys = New MotionSystem',
    '        If m_sys.OpenLines() Then',
    '            LOG.Write("MSY.Unused " & CStr(w))   \' MSY.Shutdown 은 주석',
    '        End If',
    '        MSY.SetHomePosition()',
    '        RobotWorker.ResetSharedState()',
    '        Same()',
    '        Helper()',
    '    End Sub',
    '    Private Sub Helper()',
    '    End Sub',
    'End Module',
);

test('moduleDependencies: scanChains 는 인자 안의 체인도 따로 뽑고 `.` 뒤는 새 체인으로 세지 않는다', () => {
    const chains = scanChains('x = a(0).b.c(MSY.Foo(1), y) + 1e5').map(c => c.map(s => s.name).join('.'));
    assert.deepStrictEqual(chains, ['x', 'a.b.c', 'MSY.Foo', 'y']);
});

test('moduleDependencies: 한정자·인스턴스 멤버·Shared 멤버·클래스 타입을 파일별로 모은다(주석·문자열·모호한 이름은 제외)', () => {
    const files = collect(MACHINE, MACHINE_PATH, lookupOf({ ...LIB, [MACHINE_PATH]: MACHINE }));
    const view = orderRequiredFiles(files, () => undefined).map(f =>
        `${f.fileName} [${f.modules.join(',')}] ${f.items.map(i => i.members.length ? `${i.name}(${i.members.join(',')})` : i.name).join(', ')}`);
    assert.deepStrictEqual(view, [
        'Logger.gpl [LOG] Write',
        'MotionSystem.gpl [MSY] MotionSystem(OpenLines), SetHomePosition',
        'Worker.gpl [RWK] RobotWorker(ResetSharedState)',
    ]);
});

test('moduleDependencies: 로컬이 가린 이름과 자기 파일 선언은 의존이 아니다', () => {
    const text = src(
        'Module APP',
        '    Public Sub Write()',
        '    End Sub',
        '    Public Sub Run(MotionSystem As Integer)',
        '        Write()',
        '        MotionSystem = 1',
        '    End Sub',
        'End Module',
    );
    const path = native('C:\\p\\App\\App.gpl');
    assert.deepStrictEqual(collect(text, path, lookupOf({ ...LIB, [path]: text })), []);
});

test('moduleDependencies: 같은 컴파일 단위 후보를 우선하고, 다른 프로젝트에 복제된 같은 파일은 한 항목으로 접는다', () => {
    const copy = native('C:\\other\\Lib\\Logger.gpl');
    const text = src('Module APP', '    Public Sub Run()', '        LOG.Write("a")', '    End Sub', 'End Module');
    const path = native('C:\\p\\App\\App.gpl');
    const files = collect(text, path, lookupOf({ ...LIB, [copy]: LIB[native('C:\\p\\Lib\\Logger.gpl')] }, c => c.startsWith(native('C:\\p\\'))));
    assert.deepStrictEqual(files.map(f => f.filePath), [native('C:\\p\\Lib\\Logger.gpl')]);
    const unknownUnit = collect(text, path, lookupOf({ ...LIB, [copy]: LIB[native('C:\\p\\Lib\\Logger.gpl')] }, () => false));
    assert.strictEqual(unknownUnit.length, 1, '경계를 모르면 사본은 같은 파일명·모듈로 접힌다');
});

test('moduleDependencies: 순서를 주면 그 순서, 모르는 파일은 뒤에 파일명 순', () => {
    const files = collect(MACHINE, MACHINE_PATH, lookupOf(LIB));
    const order = new Map([[native('C:\\p\\Lib\\Worker.gpl'), 0], [native('C:\\p\\Lib\\MotionSystem.gpl'), 1]]);
    assert.deepStrictEqual(orderRequiredFiles(files, p => order.get(p)).map(f => f.fileName), ['Worker.gpl', 'MotionSystem.gpl', 'Logger.gpl']);
});
