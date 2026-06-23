import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { test } from './harness';

/**
 * language-configuration.json 의 indentationRules 회귀 테스트.
 *
 * 단일 라인 If(`If x Then stmt`)는 들여쓰기를 늘리면 안 되고,
 * 블록 구분자(Else/ElseIf/Case/Catch/Finally)는 자기 줄은 내어쓰기(dedent)하면서
 * 다음 줄은 들여쓰기(indent)해야 한다. 과거에 Else/ElseIf/Case/Finally/Wend/Enum
 * 처리가 누락되어 If/Else 블록 편집 시 줄바꿈 들여쓰기가 깨졌던 회귀를 잡는다.
 */
function loadIndentPattern(key: 'increaseIndentPattern' | 'decreaseIndentPattern'): RegExp {
    const configPath = path.resolve(__dirname, '../../language-configuration.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const rule = cfg.indentationRules?.[key];
    assert.ok(rule, `language-configuration.json 에 indentationRules.${key} 가 있어야 한다`);
    // VS Code 는 문자열 또는 {pattern, flags} 형태를 모두 허용한다.
    const pattern = typeof rule === 'string' ? rule : rule.pattern;
    const flags = typeof rule === 'string' ? '' : (rule.flags ?? '');
    return new RegExp(pattern, flags);
}

const INCREASE = loadIndentPattern('increaseIndentPattern');
const DECREASE = loadIndentPattern('decreaseIndentPattern');

// [라인, 기대 increase(0/1), 기대 decrease(0/1)]
const CASES: Array<[string, 0 | 1, 0 | 1]> = [
    // 블록 여는 If 는 들여쓰기 증가
    ['If x Then', 1, 0],
    // 단일 라인 If 는 증가/감소 모두 없음 (사용자가 지목한 line 56 유형)
    ['If x Then DoStuff', 0, 0],
    ['If logDirInitialized = 1 Then Exit Sub', 0, 0],
    ['If logFilePath Is Nothing Then Exit Sub', 0, 0],
    ['If dirPath Is Nothing Then dirPath = ""', 0, 0],
    ['If x Then a = 1 Else b = 2', 0, 0],
    // 블록 구분자: 자기 줄 dedent + 다음 줄 indent (Catch 와 동일한 동작)
    ['ElseIf y Then', 1, 1],
    ['Else If y Then', 1, 1],
    ['Else', 1, 1],
    ["Else  ' trailing comment", 1, 1],
    ['Case 5', 1, 1],
    ['Case Else', 1, 1],
    ['Catch ex', 1, 1],
    ['Finally', 1, 1],
    // 일반 블록 여닫기
    ['Try', 1, 0],
    ['End Try', 0, 1],
    ['End If', 0, 1],
    ['Select Case n', 1, 0],
    ['Select setupOrder(i)', 1, 0],
    ['For i = 0 To 9', 1, 0],
    ['Next', 0, 1],
    ['Next i', 0, 1],
    ['Do While x', 1, 0],
    ['Loop', 0, 1],
    ['While x', 1, 0],
    ['Wend', 0, 1],
    ['End While', 0, 1],
    ['With obj', 1, 0],
    ['End With', 0, 1],
    ['Enum Color', 1, 0],
    ['End Enum', 0, 1],
    // 거짓 양성 방지: 식별자가 키워드로 시작해도 매치되면 안 된다
    ['ReturnValue = Constant', 0, 0],
    ['Dim elseValue As Integer', 0, 0],
    ['ElseValue = 3', 0, 0],
    ['CaseInsensitive = 1', 0, 0],
    ['Finalize()', 0, 0],
    ['Enumerate(list)', 0, 0],
];

for (const [line, expInc, expDec] of CASES) {
    test(`indentationRules: "${line}" → inc=${expInc} dec=${expDec}`, () => {
        assert.strictEqual(INCREASE.test(line) ? 1 : 0, expInc, `increaseIndentPattern mismatch for: ${line}`);
        assert.strictEqual(DECREASE.test(line) ? 1 : 0, expDec, `decreaseIndentPattern mismatch for: ${line}`);
    });
}
