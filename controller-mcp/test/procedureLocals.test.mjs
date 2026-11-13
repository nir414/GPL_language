import test from 'node:test';
import assert from 'node:assert/strict';
import { localNamesAt, frameLocation } from '../src/procedureLocals.js';

const SRC = [
  'Module Main',                                                  // 1
  '    Public Function Clamp(ByVal value As Integer, ByVal low As Integer, Optional high As Integer = 9) As Integer', // 2
  '        Dim a(3) As Integer, s As String = "x,y" \' Dim fake', // 3
  '        Static hits As Integer',                                // 4
  '        Return value',                                          // 5
  '    End Function',                                              // 6
  '    Public Class C',                                            // 7
  '        Private v As Integer',                                  // 8
  '        Public Property P As Integer',                          // 9
  '            Get',                                               // 10
  '                Return v',                                      // 11
  '            End Get',                                           // 12
  '            Set (n As Integer)',                                // 13
  '                Dim tmp As Integer',                            // 14
  '                v = n',                                         // 15
  '            End Set',                                           // 16
  '        End Property',                                          // 17
  '    End Class',                                                 // 18
  'End Module',                                                    // 19
].join('\r\n');

test('localNamesAt: 매개변수(ByVal/Optional) + Dim 여러 개(괄호·문자열 속 콤마 무시) + Static, 주석 속 Dim 제외', () => {
  const r = localNamesAt(SRC, 5);
  assert.equal(r.procedure, 'Clamp');
  assert.deepEqual(r.names, ['value', 'low', 'high', 'a', 's', 'hits']);
});

test('localNamesAt: Property Set 절 매개변수와 그 안의 Dim', () => {
  assert.deepEqual(localNamesAt(SRC, 15).names, ['n', 'tmp']);
});

test('localNamesAt: 프로시저 밖(클래스 필드 줄·모듈 끝)은 null', () => {
  assert.equal(localNamesAt(SRC, 8), null);
  assert.equal(localNamesAt(SRC, 19), null);
  assert.equal(localNamesAt(SRC, 99), null);
});

test('frameLocation: Show Stack 실측 형식에서 frame 별 파일·줄', () => {
  const stack = '0, syntax_tour, Clamp, 3, Main.gpl, 180, 0.051\r\n1, syntax_tour, JumpTour, 13, Main.gpl, 149, 0.047';
  assert.deepEqual(frameLocation(stack, 1), { procedure: 'JumpTour', file: 'Main.gpl', line: 149 });
  assert.equal(frameLocation(stack, 2), null);
});

test('onlyNonCodeBetween: 빈 줄·주석만 사이에 있으면 true, 코드가 끼면 false', async () => {
  const { onlyNonCodeBetween } = await import('../src/procedureLocals.js');
  const src = ['a = 1', '', "   ' note", 'b = 2', 'c = 3'].join('\n');
  assert.equal(onlyNonCodeBetween(src, 2, 4), true);
  assert.equal(onlyNonCodeBetween(src, 1, 4), false);
  assert.equal(onlyNonCodeBetween(src, 4, 4), false);
});

test('localSourceCandidates: 대상 폴더 → 형제(<lib>/<file>) → 형제 <project>/<file>', async () => {
  const { localSourceCandidates } = await import('../src/procedureLocals.js');
  assert.deepEqual(localSourceCandidates('C:/w/projects/App', 'PaL', 'Net.gpl'),
    ['C:/w/projects/App/Net.gpl', 'C:/w/projects/Net.gpl', 'C:/w/projects/PaL/Net.gpl']);
  assert.deepEqual(localSourceCandidates('C:\\w\\App', null, 'PaL/Net.gpl'),
    ['C:\\w\\App\\PaL\\Net.gpl', 'C:\\w\\PaL\\Net.gpl']);
  assert.deepEqual(localSourceCandidates(null, 'x', 'y'), []);
});

test('callSiteLineOf / parseStackFrames: 실측 스택(호출 20 → 보고 21, 24 → 25)', async () => {
  const { callSiteLineOf, parseStackFrames } = await import('../src/procedureLocals.js');
  const src = ['Module Main', '  Sub Main()', '    Callee(1)', '', "    ' c", '    i = 1', '  End Sub'].join('\n');
  assert.equal(callSiteLineOf(src, 6), 3);
  assert.equal(callSiteLineOf(src, 1), undefined);
  const frames = parseStackFrames('0, p, Callee, 1, Main.gpl, 3, 0.055\r\n1, p, Twice, 2, Main.gpl, 25, 0.117\r\n2, p, Main, 16, Main.gpl, 21, 0.145');
  assert.deepEqual(frames.map((f) => [f.frame, f.procedure, f.line]), [[0, 'Callee', 3], [1, 'Twice', 25], [2, 'Main', 21]]);
});

test('localNamesAt: 머리 줄·Dim 이 ` _` 로 이어져도 매개변수와 이름을 모두 읽는다', () => {
  const src = ['Module M', '  Sub Foo(a As Integer, _', '          ByVal b As String)', '    Dim c As Integer, _', '        d As Integer', '    c = 1', '  End Sub', 'End Module'].join('\n');
  assert.deepEqual(localNamesAt(src, 6).names, ['a', 'b', 'c', 'd']);
});

test('onlyNonCodeBetween: Rem 줄도 주석으로 본다', async () => {
  const { onlyNonCodeBetween } = await import('../src/procedureLocals.js');
  const src = ['Sub A()', 'Rem note', '  rem', '  x = 1', 'Remove()', '  y = 2'].join('\n');
  assert.equal(onlyNonCodeBetween(src, 2, 4), true);
  assert.equal(onlyNonCodeBetween(src, 5, 6), false);
});
