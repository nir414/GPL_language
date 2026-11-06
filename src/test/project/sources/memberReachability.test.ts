import * as assert from 'assert';
import { test } from '../../harness';
import { scanSourceMembers } from '../../../project/sources/memberScan';
import { computeMemberReachability } from '../../../project/sources/memberReachability';
import type { MemberUnitFile } from '../../../project/sources/memberReachability';
import { blankLineRanges, countLines } from '../../../project/sources/sourceMinify';

const lines = (...l: string[]): string => l.join('\r\n');

test('memberScan: 선언 단위와 물리 줄 범위 — 이어 쓴 시그니처·Property·클래스·최상위 클래스·Delegate·#Region', () => {
    const s = scanSourceMembers(lines(
        'Module LIB',                                   // 0
        '#Region "consts"',                             // 1
        '    Public Const A As Integer = 1, B As Integer = 2 \' 둘', // 2
        '    Public Dim reg As New Registry()',         // 3
        '    Private counter As Integer = 0',           // 4
        '    Public Delegate Sub Handler(ByVal n As Integer)', // 5
        '    Public Function Join(ByVal a As String, _', // 6
        '                         ByVal b As String) As String', // 7
        '        Return a & b',                         // 8
        '    End Function',                             // 9
        '    Public Class Box',                         // 10
        '        Public Shared Pool As New Box()',      // 11
        '        Public Size As Integer',               // 12
        '        Public Sub New()',                     // 13
        '        End Sub',                              // 14
        '        Public ReadOnly Property Area As Integer', // 15
        '            Get',                              // 16
        '                Return Size * Size',           // 17
        '            End Get',                          // 18
        '        End Property',                         // 19
        '    End Class',                                // 20
        'End Module',                                   // 21
        'Public Class Free',                            // 22
        'End Class',                                    // 23
    ));
    assert.strictEqual(s.irregular, undefined);
    assert.deepStrictEqual(s.modules, ['lib']);
    const brief = s.members.map(m => `${m.kind}:${m.names.join('+')}:${m.startLine}-${m.endLine}:${m.removable ? 'r' : 'keep'}${m.shared ? ':shared' : ''}${m.parent === undefined ? '' : `:p${m.parent}`}${m.module ? `@${m.module}` : ''}`);
    assert.deepStrictEqual(brief, [
        'const:a+b:2-2:r@lib',
        'variable:reg:3-3:keep@lib',
        'variable:counter:4-4:r@lib',
        'delegate:handler:5-5:r@lib',
        'function:join:6-9:r@lib',
        'class:box:10-20:r@lib',
        'variable:pool:11-11:keep:shared:p5@lib',
        'variable:size:12-12:r:p5@lib',
        'sub:new:13-14:r:p5@lib',
        'property:area:15-19:r:p5@lib',
        'class:free:22-23:r',
    ]);
});

test('memberScan: 참조 낱말 — 점 앞 낱말을 prefix 로, 문자열 안도 같은 규칙, 숫자 표기·주석은 뺀다', () => {
    const s = scanSourceMembers(lines(
        'Module M',
        '    Public Sub Run()',
        '        x = NUM.Fixed(1E5) + obj.Area + Foo() \' BAR.Skip',
        '        t = New Thread("FLR.Loop", 1)',
        '    End Sub',
        'End Module',
    ));
    const refs = s.members[0].refs;
    assert.ok(refs.undotted.includes('foo') && refs.undotted.includes('num') && refs.undotted.includes('obj'));
    assert.ok(!refs.undotted.includes('e5') && !refs.undotted.includes('bar') && !refs.undotted.includes('skip'));
    assert.deepStrictEqual(refs.dotted.filter(d => ['fixed', 'area', 'loop'].includes(d.name)), [
        { prefix: 'num', name: 'fixed' }, { prefix: 'obj', name: 'area' }, { prefix: 'flr', name: 'loop' },
    ]);
});

test('memberScan: 모르는 문장·짝 없는 블록은 irregular(아무것도 지우지 않음)', () => {
    assert.match(scanSourceMembers(lines('Module M', '    Public Event Changed()', 'End Module')).irregular!, /모르는 선언문/);
    assert.match(scanSourceMembers(lines('Module M', '    Public Sub A()', '        x = 1', 'End Module')).irregular!, /짝 없는 Sub/);
    assert.match(scanSourceMembers(lines('x = 1')).irregular!, /밖의 문장/);
});

function unit(entries: Record<string, { text: string; candidate: boolean }>): Map<string, MemberUnitFile> {
    return new Map(Object.entries(entries).map(([k, v]) => [k, { scan: scanSourceMembers(v.text), candidate: v.candidate }]));
}

const removedNames = (r: ReturnType<typeof computeMemberReachability>): string[] => r.removed.map(m => `${m.container ?? ''}.${m.name}`).sort();

test('memberReachability: 모듈 멤버 — 수식 없는 이름·모듈 수식·자기 모듈 가림, 안 쓰는 것만 지운다', () => {
    const files = unit({
        app: { candidate: false, text: lines('Module App', '    Private Const POLL_MS As Integer = 5', '    Public Sub Main()', '        TXT.Pad(1)', '        Trim2("a")', '        Thread.Sleep(POLL_MS)', '    End Sub', 'End Module') },
        txt: { candidate: true, text: lines(
            'Module TXT',
            '    Public Const POLL_MS As Integer = 10',
            '    Public Function Pad(ByVal n As Integer) As String',
            '        Return Repeat(n)',
            '    End Function',
            '    Private Function Repeat(ByVal n As Integer) As String',
            '        Return ""',
            '    End Function',
            '    Public Function Trim2(ByVal s As String) As String',
            '        Return s',
            '    End Function',
            '    Public Function Unused() As String',
            '        Return Pad(2)',
            '    End Function',
            'End Module') },
    });
    const r = computeMemberReachability(files);
    assert.deepStrictEqual(removedNames(r), ['txt.POLL_MS', 'txt.Unused'], 'POLL_MS 는 App 이 자기 것으로 가려 TXT 것은 안 쓰임');
    assert.deepStrictEqual(r.ranges.get('txt'), [[1, 1], [11, 13]]);
});

test('memberReachability: 클래스 — 이름이 안 나오면 통째로, 닿으면 New 는 남기고 안 쓰는 메서드만', () => {
    const files = unit({
        app: { candidate: false, text: lines('Module App', '    Public Sub Main()', '        Dim b As New BOX.Box', '        b.Grow', '    End Sub', 'End Module') },
        box: { candidate: true, text: lines(
            'Module BOX',
            '    Public Class Box',
            '        Public Size As Integer',
            '        Public Sub New()',
            '            Size = 1',
            '        End Sub',
            '        Public Sub Grow()',
            '            Size = Size + 1',
            '        End Sub',
            '        Public Sub Shrink()',
            '        End Sub',
            '    End Class',
            '    Public Class Ghost',
            '        Public Sub Grow()',
            '        End Sub',
            '    End Class',
            'End Module') },
    });
    assert.deepStrictEqual(removedNames(computeMemberReachability(files)), ['Box.Shrink', 'box.Ghost']);
});

test('memberReachability: 출발점 — Sub Init·부작용 초기화·keep·irregular 파일 참조·오버로드는 남는다', () => {
    const files = unit({
        app: { candidate: false, text: lines('Module App', '    Public Sub Main()', '        LIB.Over(1)', '    End Sub', 'End Module') },
        weird: { candidate: false, text: lines('Module W', '    Public Event E()', '    Public Sub X()', '        LIB.FromWeird()', '    End Sub', 'End Module') },
        lib: { candidate: true, text: lines(
            'Module LIB',
            '    Public Dim reg As Integer = Register()',
            '    Private Function Register() As Integer',
            '        Return 1',
            '    End Function',
            '    Public Sub Init()',
            '        Helper()',
            '    End Sub',
            '    Private Sub Helper()',
            '    End Sub',
            '    Public Sub Over(ByVal a As Integer)',
            '    End Sub',
            '    Public Sub Over(ByVal a As String)',
            '    End Sub',
            '    Public Sub FromWeird()',
            '    End Sub',
            '    Public Sub Pinned()',
            '    End Sub',
            '    Public Sub Dead()',
            '    End Sub',
            'End Module') },
    });
    assert.deepStrictEqual(removedNames(computeMemberReachability(files, ['LIB.Pinned'])), ['lib.Dead']);
});

test('memberReachability: 지운 줄을 빈 줄로 바꿔도 줄 수 그대로, 다시 돌리면 더 지울 것이 없다(닫힌 집합)', () => {
    const libText = lines('Module LIB', '    Public Sub Used()', '        Mid1()', '    End Sub', '    Private Sub Mid1()', '    End Sub', '    Public Sub Dead()', '        Used()', '    End Sub', 'End Module', '');
    const files = unit({
        app: { candidate: false, text: lines('Module App', '    Public Sub Main()', '        LIB.Used', '    End Sub', 'End Module') },
        lib: { candidate: true, text: libText },
    });
    const first = computeMemberReachability(files);
    assert.deepStrictEqual(removedNames(first), ['lib.Dead']);
    const blanked = blankLineRanges(libText, first.ranges.get('lib')!);
    assert.strictEqual(countLines(blanked), countLines(libText));
    assert.strictEqual(blanked.split('\r\n')[6], '');
    files.set('lib', { scan: scanSourceMembers(blanked), candidate: true });
    assert.deepStrictEqual(computeMemberReachability(files).removed, []);
});
