import * as assert from 'assert';
import { test } from './harness';
import { findTryCatchFindings } from '../language/tryCatch';
import { GPL_STATEMENT_SNIPPETS } from '../language/gplStatements';

test('tryCatch: Catch 없는 Try...Finally는 Try 키워드에 경고 1건', () => {
    const findings = findTryCatchFindings('Public Sub Main()\n\tTry\n\t\tWork()\n\tFinally\n\t\tCleanup()\n\tEnd Try\nEnd Sub');
    assert.strictEqual(findings.length, 1);
    assert.deepStrictEqual([findings[0].line, findings[0].start, findings[0].end], [1, 1, 4]);
    assert.strictEqual(findings[0].code, 'try-without-catch');
    assert.ok(findings[0].message.includes('GPL 4.2K5') && findings[0].message.includes('Continue') && !findings[0].message.includes('Object 정보 유실'));
});

test('tryCatch: Try...Catch와 Try...Catch...Finally는 경고 없음', () => {
    for (const tail of ['', 'Finally\nCleanup()\n']) {
        assert.deepStrictEqual(findTryCatchFindings(`Try\nWork()\nCatch ex\nHandle(ex)\n${tail}End Try`), []);
    }
});

test('tryCatch: Finally 없이 닫은 Try에도 Catch 누락 경고', () => {
    assert.strictEqual(findTryCatchFindings('Try\nWork()\nEnd Try').length, 1);
});

test('tryCatch: 안쪽 Catch가 바깥 Try의 누락을 가리지 않음', () => {
    const findings = findTryCatchFindings('Try\n  Try\n  Catch inner\n  End Try\nFinally\nEnd Try');
    assert.deepStrictEqual(findings.map(f => f.line), [0]);
});

test('tryCatch: 바깥 Catch가 안쪽 Try의 누락을 가리지 않음', () => {
    const findings = findTryCatchFindings('Try\n  Try\n  Finally\n  End Try\nCatch outer\nFinally\nEnd Try');
    assert.deepStrictEqual(findings.map(f => f.line), [1]);
});

test('tryCatch: 중첩 누락은 각각 한 번만 소스 순서로 보고', () => {
    const findings = findTryCatchFindings('Try\n  Try\n  Finally\n  End Try\nFinally\nEnd Try');
    assert.deepStrictEqual(findings.map(f => [f.line, f.start, f.end]), [[0, 0, 3], [1, 2, 5]]);
});

test('tryCatch: 주석·문자열의 Catch는 Catch 블록이 아님', () => {
    const findings = findTryCatchFindings([
        'Try', "' Catch ex", 'Print "Catch ex"', 'Print "it\'s ""Catch"""',
        'Finally', 'End Try',
    ].join('\n'));
    assert.strictEqual(findings.length, 1);
});

test('tryCatch: 주석·문자열·멤버 이름의 Try/Finally/End Try는 무시', () => {
    assert.deepStrictEqual(findTryCatchFindings([
        "' Try", 'Print "Try"', 'Print "Finally"', 'Print "End Try"',
        'obj.Try()', 'obj.Finally()', 'TryAgain()', 'Exit Try', 'End Try', 'Catch ex', 'Finally',
    ].join('\n')), []);
});

test('tryCatch: 대소문자·CRLF·인라인 주석을 허용하고 물리 위치 보존', () => {
    const findings = findTryCatchFindings("\t  tRy ' begin\r\nWork()\r\nFiNaLlY ' cleanup\r\neNd tRy ' end");
    assert.deepStrictEqual(findings.map(f => [f.line, f.start, f.end]), [[0, 3, 6]]);
    assert.deepStrictEqual(findTryCatchFindings("tRy ' begin\r\ncAtCh ex ' handle\r\nfInAlLy\r\neNd tRy"), []);
});

test('tryCatch: 주석이 붙은 줄 연속 Catch와 End Try를 기존 파서 규칙으로 처리', () => {
    assert.deepStrictEqual(findTryCatchFindings("Try\nCatch _ ' continue\n ex\nFinally\nEnd _ ' continue\n Try"), []);
    assert.strictEqual(findTryCatchFindings("Try\nFinally\nEnd _ ' continue\n Try").length, 1);
});

test('tryCatch: 다른 문장의 연속 줄에 나온 Catch는 블록으로 세지 않음', () => {
    assert.strictEqual(findTryCatchFindings('Try\nvalue = other _\n Catch\nFinally\nEnd Try').length, 1);
});

test('tryCatch: 입력 중인 Try에는 경고를 미루고 Finally 입력부터 표시', () => {
    assert.deepStrictEqual(findTryCatchFindings('Try\nWork()\n'), []);
    assert.strictEqual(findTryCatchFindings('Try\nWork()\nFinally\nCleanup()').length, 1);
});

test('tryCatch: 미완성 Try가 다음 프로시저의 Catch/End Try와 연결되지 않음', () => {
    assert.deepStrictEqual(findTryCatchFindings('Public Sub A()\nTry\nEnd Sub\nPublic Sub B()\nCatch ex\nEnd Try\nEnd Sub'), []);
    assert.deepStrictEqual(findTryCatchFindings('Public Sub A()\nTry\nPublic Sub B()\nEnd Try\nEnd Sub'), []);
});

test('tryCatch: Catch를 추가하면 동일 소스의 경고가 사라짐', () => {
    const source = 'Try\nWork()\nFinally\nCleanup()\nEnd Try';
    assert.strictEqual(findTryCatchFindings(source).length, 1);
    assert.deepStrictEqual(findTryCatchFindings(source.replace('Finally', 'Catch ex\nFinally')), []);
});

test('tryCatch: Try 스니펫은 Catch를 포함하고 완성 안내에 GPL 4.2K5 제약 표시', () => {
    const snippets = GPL_STATEMENT_SNIPPETS.filter(s => s.label.startsWith('Try'));
    assert.ok(snippets.length > 0);
    for (const snippet of snippets) {
        assert.ok(snippet.body.some(line => line.startsWith('Catch ')), snippet.label);
        assert.ok(snippet.documentation.includes('GPL 4.2K5'), snippet.label);
    }
    assert.ok(GPL_STATEMENT_SNIPPETS.find(s => s.label === 'Finally')!.documentation.includes('GPL 4.2K5'));
});
