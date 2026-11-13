import * as assert from 'assert';
import { test } from '../../harness';
import { findAllCompilerCheckFindings, findCompilerCheckFindings } from '../../../language/checks/compilerChecks';
import { findFileCheckFindings } from '../../../language/checks/fileChecks';

// ─── 파일·제어기 실기 사실 검사 (inbox 2026-11-06 binder-gpl-facts-catchup #2·#4, try-finally-recheck #1) ───

function lines(...l: string[]): string {
    return l.join('\n');
}

function of(content: string, code: string, options?: { threadEntryWithoutCatch?: boolean }) {
    return findFileCheckFindings(content, 'Main.gpl', options).filter(f => f.code === code);
}

// missing-final-newline

test('fileChecks: 줄바꿈 없이 끝나는 파일은 마지막 줄에 warning + 빠른 수정(LF)', () => {
    const f = of(lines('Module M', 'End Module'), 'missing-final-newline');
    assert.strictEqual(f.length, 1);
    assert.deepStrictEqual([f[0].line, f[0].start, f[0].end], [1, 0, 10]);
    assert.strictEqual(f[0].severity, 'warning');
    assert.ok(f[0].message.includes('-505'));
    assert.strictEqual(f[0].fix?.title, '파일 끝에 줄바꿈 추가');
    assert.strictEqual(f[0].fix?.newText, 'End Module\n');
});

test('fileChecks: CRLF 파일의 빠른 수정은 CRLF, 들여쓴 마지막 줄은 들여쓰기 뒤부터', () => {
    const f = of('Module M\r\n  End Module', 'missing-final-newline');
    assert.strictEqual(f[0].start, 2);
    assert.strictEqual(f[0].fix?.newText, 'End Module\r\n');
});

test('fileChecks: 줄바꿈으로 끝나거나 빈 파일·공백뿐인 끝줄은 알리지 않음', () => {
    for (const text of ['', 'Module M\nEnd Module\n', 'Module M\r\nEnd Module\r\n', 'Module M\nEnd Module\n   ']) {
        assert.deepStrictEqual(of(text, 'missing-final-newline'), [], JSON.stringify(text));
    }
});

test('fileChecks: 주석으로 끝나는 마지막 줄은 information', () => {
    const f = of("Module M\nEnd Module\n' tail", 'missing-final-newline');
    assert.strictEqual(f[0].severity, 'information');
});

// create-directory-device-root

test('fileChecks: File.CreateDirectory 장치 루트 리터럴은 warning(슬래시·대소문자 무관)', () => {
    for (const lit of ['/ROMDISK', '/ROMDISK/', '/flash', '/Flash/', '/GPL']) {
        const f = of(lines('Public Sub A()', `    File.CreateDirectory("${lit}")`, 'End Sub', ''), 'create-directory-device-root');
        assert.strictEqual(f.length, 1, lit);
        assert.strictEqual(f[0].severity, 'warning');
        assert.strictEqual(f[0].line, 1);
        assert.ok(f[0].message.includes('-300'));
    }
});

test('fileChecks: 장치 아래 폴더·변수·연결식 인자는 알리지 않음', () => {
    for (const arg of ['"/ROMDISK/tmp"', '"/flash/data"', 'dir', 'root & "/x"', '"/ROMDISK" & sub', '"/usb"', '"ROMDISK"']) {
        const f = of(lines('Public Sub A()', `    File.CreateDirectory(${arg})`, 'End Sub', ''), 'create-directory-device-root');
        assert.deepStrictEqual(f, [], arg);
    }
});

// thread-entry-without-catch

const THREAD_SRC = (body: string[]) => lines(
    'Module Main',
    '    Public Sub Run()',
    ...body.map(b => '        ' + b),
    '    End Sub',
    '    Public Sub Start()',
    '        Dim t As New Thread("Main.Run", , "RUN_T")',
    '    End Sub',
    'End Module',
    '',
);

test('fileChecks: 진입점 본문에 Catch 가 없으면 Thread 문자열에 information', () => {
    const f = of(THREAD_SRC(['Work()']), 'thread-entry-without-catch');
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].severity, 'information');
    assert.strictEqual(f[0].line, 5);
    assert.ok(f[0].message.includes('Error'));
});

test('fileChecks: 진입점 안 어디든 Catch 가 있으면(루프 안 포함) 알리지 않음', () => {
    assert.deepStrictEqual(of(THREAD_SRC(['Dim ex As New Exception', 'Try', '  Work()', 'Catch ex', '  Log(ex)', 'End Try']), 'thread-entry-without-catch'), []);
    assert.deepStrictEqual(of(THREAD_SRC(['Do', '  Try', '    Work()', '  Catch ex', '  End Try', 'Loop']), 'thread-entry-without-catch'), []);
});

test('fileChecks: Try…Finally 만 있는 진입점은 Catch 없음으로 본다', () => {
    assert.strictEqual(of(THREAD_SRC(['Try', '  Work()', 'Finally', '  Done()', 'End Try']), 'thread-entry-without-catch').length, 1);
});

test('fileChecks: 대상이 같은 파일에서 풀리지 않거나 유일하지 않으면 조용히 넘어감', () => {
    const other = lines('Module Main', '    Public Sub Start()', '        Dim t As New Thread("Other.Run", , "X")', '    End Sub', 'End Module', '');
    assert.deepStrictEqual(of(other, 'thread-entry-without-catch'), []);
    const dyn = lines('Module Main', '    Public Sub Start()', '        Dim t As New Thread(name, , "X")', '    End Sub', 'End Module', '');
    assert.deepStrictEqual(of(dyn, 'thread-entry-without-catch'), []);
});

test('fileChecks: 옵션으로 thread-entry-without-catch 를 끌 수 있다', () => {
    assert.deepStrictEqual(of(THREAD_SRC(['Work()']), 'thread-entry-without-catch', { threadEntryWithoutCatch: false }), []);
});

// 합친 진입점

test('compilerChecks: findCompilerCheckFindings 는 파일 검사를 섞지 않고 findAll 이 합친다(줄 순서)', () => {
    const text = lines('Module M', '    Public Sub A()', '        File.CreateDirectory("/GPL")', '    End Sub', 'End Module');
    assert.deepStrictEqual(findCompilerCheckFindings(text, 'M.gpl').map(f => f.code), []);
    assert.deepStrictEqual(findAllCompilerCheckFindings(text, 'M.gpl').map(f => f.code), ['create-directory-device-root', 'missing-final-newline']);
});
