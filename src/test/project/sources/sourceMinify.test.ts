import * as assert from 'assert';
import { test } from '../../harness';
import { countLines, minifyGplBuffer, minifyGplLine, minifyGplText } from '../../../project/sources/sourceMinify';

const STRIP = { stripComments: true, trimWhitespace: false };
const TRIM = { stripComments: false, trimWhitespace: true };
const BOTH = { stripComments: true, trimWhitespace: true };

test('sourceMinify: 주석 줄은 빈 줄, 줄 끝 주석은 지우고 그 앞 공백도 함께', () => {
    assert.strictEqual(minifyGplLine("    ' 설명 주석", STRIP), '');
    assert.strictEqual(minifyGplLine("    x = 1   ' 끝 주석", STRIP), '    x = 1');
    assert.strictEqual(minifyGplLine('    x = 1   ', STRIP), '    x = 1   ', '주석이 없으면 공백은 trimWhitespace 몫');
});

test("sourceMinify: 문자열 안 ' 와 \"\" 이스케이프는 주석으로 보지 않는다", () => {
    assert.strictEqual(minifyGplLine(`s = "it's" ' 주석`, STRIP), `s = "it's"`);
    assert.strictEqual(minifyGplLine(`s = "a ""quoted' text""" & t ' c`, STRIP), `s = "a ""quoted' text""" & t`);
    assert.strictEqual(minifyGplLine(`New Thread("FLR.RecorderLoop", 1) ' 진입점`, STRIP), `New Thread("FLR.RecorderLoop", 1)`);
});

test('sourceMinify: # 줄(#Region)은 stripComments 에서만 빈 줄', () => {
    assert.strictEqual(minifyGplLine('#Region "Init"', STRIP), '');
    assert.strictEqual(minifyGplLine('  #End Region', STRIP), '');
    assert.strictEqual(minifyGplLine('  #End Region', TRIM), '#End Region');
});

test('sourceMinify: trimWhitespace 는 앞뒤 공백·탭만, 줄 연속 ` _` 는 그대로', () => {
    assert.strictEqual(minifyGplLine('\t  x = Foo(a, _  ', TRIM), 'x = Foo(a, _');
    assert.strictEqual(minifyGplLine('        b)', TRIM), 'b)');
    assert.strictEqual(minifyGplLine('x = Foo(a, _ \' 첫 인자', BOTH), 'x = Foo(a, _');
});

test('sourceMinify: 줄 수와 줄바꿈 문자(CRLF/LF/CR 혼재)를 그대로 지킨다', () => {
    const src = "Module A\r\n    ' c1\r\n    Public Sub F() ' c2\n    End Sub\r' c3\r\nEnd Module\r\n";
    const out = minifyGplText(src, BOTH);
    assert.strictEqual(out, 'Module A\r\n\r\nPublic Sub F()\nEnd Sub\r\r\nEnd Module\r\n');
    assert.strictEqual(countLines(out), countLines(src));
    assert.strictEqual(minifyGplText(src, { stripComments: false, trimWhitespace: false }), src, '모두 꺼지면 그대로');
});

test('sourceMinify: 바이트 단위 — UTF-8 BOM·한글(UTF-8)·CP949 바이트를 깨지 않는다', () => {
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('s = "한글 \'따옴표\'" \' 주석 한글\r\nx = 1\r\n', 'utf8')]);
    const out = minifyGplBuffer(utf8, STRIP);
    assert.deepStrictEqual([...out.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 보존');
    assert.strictEqual(out.subarray(3).toString('utf8'), 's = "한글 \'따옴표\'"\r\nx = 1\r\n');

    // CP949 "가"(0xB0 0xA1)·"나"(0xB3 0xAA) — 둘째 바이트가 ASCII 구분자와 겹치지 않는다.
    const cp949 = Buffer.from([0x73, 0x20, 0x3d, 0x20, 0x22, 0xb0, 0xa1, 0x22, 0x20, 0x27, 0xb3, 0xaa, 0x0d, 0x0a]);
    const cpOut = minifyGplBuffer(cp949, STRIP);
    assert.deepStrictEqual([...cpOut], [0x73, 0x20, 0x3d, 0x20, 0x22, 0xb0, 0xa1, 0x22, 0x0d, 0x0a]);
});
