import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { test } from './harness';

/** 실제 provider를 실행하고 VS Code 진단 컬렉션·설정·타이머만 대체한다. */
function setup() {
    const configuration = new Map<string, boolean>([['diagnostics.tryWithoutCatch', true]]);
    const diagnostics = new Map<string, any[]>();
    const timers = new Map<object, () => void>();
    const uri = { fsPath: 'Main.gpl', toString: () => 'file:///Main.gpl' };
    const document = {
        uri,
        content: 'Public Sub Main()\nTry\nFinally\nEnd Try\nEnd Sub',
        getText() { return this.content; },
    };
    const vscode = {
        workspace: {
            getConfiguration: () => ({ get: (key: string, fallback: boolean) => configuration.get(key) ?? fallback }),
        },
        languages: {
            createDiagnosticCollection: () => ({
                set: (key: typeof uri, value: any[]) => diagnostics.set(key.toString(), value),
                delete: (key: typeof uri) => diagnostics.delete(key.toString()),
                dispose: () => diagnostics.clear(),
            }),
        },
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
        Range: class {
            constructor(public startLine: number, public start: number, public endLine: number, public end: number) {}
        },
        Diagnostic: class {
            constructor(public range: any, public message: string, public severity: number) {}
        },
    };
    const filename = path.resolve(__dirname, '../providers/diagnosticProvider.js');
    const module = { exports: {} as any };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module,
        exports: module.exports,
        require: (id: string) => {
            if (id === 'vscode') { return vscode; }
            if (id === '../config') { return { isGplFile: (doc: typeof document) => /\.gp[lo]$/i.test(doc.uri.fsPath) }; }
            return require(path.resolve(path.dirname(filename), id));
        },
        setTimeout: (callback: () => void) => {
            const timer = {};
            timers.set(timer, callback);
            return timer;
        },
        clearTimeout: (timer: object) => timers.delete(timer),
    }, { filename });
    const provider = new module.exports.GPLDiagnosticProvider();
    return {
        provider, document, configuration, timers,
        current: () => diagnostics.get(uri.toString()) ?? [],
        flush: () => {
            for (const [timer, callback] of [...timers]) {
                timers.delete(timer);
                callback();
            }
        },
    };
}

test('diagnostics: 선택 활성화한 호환성 안내는 Information으로 표시', () => {
    const s = setup();
    s.provider.updateDiagnostics(s.document);
    assert.strictEqual(s.current().length, 1);
    const diagnostic = s.current()[0];
    assert.strictEqual(diagnostic.code, 'try-without-catch');
    assert.strictEqual(diagnostic.source, 'GPL Compatibility');
    assert.strictEqual(diagnostic.severity, 2);
    assert.deepStrictEqual([diagnostic.range.startLine, diagnostic.range.start, diagnostic.range.end], [1, 0, 3]);
    assert.ok(diagnostic.message.includes('GPL 4.2K5'));
    s.provider.dispose();
});

test('diagnostics: default does not claim Catch prevents Finally re-execution', () => {
    const s = setup();
    s.configuration.clear();
    s.provider.updateDiagnostics(s.document);
    assert.strictEqual(s.current().length, 0);
    s.provider.dispose();
});

test('diagnostics: Catch 추가·삭제를 일반 문서 업데이트로 경고에 반영', () => {
    const s = setup();
    s.provider.scheduleDiagnostics(s.document);
    assert.strictEqual(s.timers.size, 1, 'experimental=false에서도 업데이트를 예약한다');
    s.flush();
    assert.strictEqual(s.current().length, 1);
    s.document.content = s.document.content.replace('Finally', 'Catch ex\nFinally');
    s.provider.scheduleDiagnostics(s.document);
    s.flush();
    assert.strictEqual(s.current().length, 0);
    s.document.content = s.document.content.replace('Catch ex\n', '');
    s.provider.scheduleDiagnostics(s.document);
    s.flush();
    assert.strictEqual(s.current().length, 1);
    s.provider.dispose();
});

test('diagnostics: Catch 누락 경고만 끄고 기존 실험 진단은 유지', () => {
    const s = setup();
    s.configuration.set('diagnostics.experimental', true);
    s.document.content += '\nPublic Sub lower()\nEnd Sub';
    s.provider.updateDiagnostics(s.document);
    assert.ok(s.current().some(d => d.code === 'try-without-catch'));
    assert.ok(s.current().some(d => d.code === 'function-name-first-letter-uppercase'));
    s.configuration.set('diagnostics.tryWithoutCatch', false);
    s.provider.updateDiagnostics(s.document);
    assert.ok(!s.current().some(d => d.code === 'try-without-catch'));
    assert.ok(s.current().some(d => d.code === 'function-name-first-letter-uppercase'));
    s.configuration.set('diagnostics.experimental', false);
    s.provider.updateDiagnostics(s.document);
    assert.strictEqual(s.current().length, 0);
    s.provider.dispose();
});

test('diagnostics: 설정 변경 후 재검사로 기존 경고를 제거·복원', () => {
    const s = setup();
    s.provider.updateDiagnostics(s.document);
    s.configuration.set('diagnostics.tryWithoutCatch', false);
    s.provider.scheduleDiagnostics(s.document, 0);
    s.flush();
    assert.strictEqual(s.current().length, 0);
    s.configuration.set('diagnostics.tryWithoutCatch', true);
    s.provider.scheduleDiagnostics(s.document, 0);
    s.flush();
    assert.strictEqual(s.current().length, 1);
    s.provider.dispose();
});

test('diagnostics: 업데이트를 모아서 처리하고 삭제 문서의 예약·경고를 해제', () => {
    const s = setup();
    s.provider.scheduleDiagnostics(s.document);
    s.provider.scheduleDiagnostics(s.document);
    assert.strictEqual(s.timers.size, 1);
    s.flush();
    assert.strictEqual(s.current().length, 1);
    s.provider.scheduleDiagnostics(s.document);
    s.provider.clearDiagnostics(s.document.uri);
    assert.strictEqual(s.timers.size, 0);
    assert.strictEqual(s.current().length, 0);
    s.provider.dispose();
});

test('diagnostics: TypeScript 등 GPL 이외 문서에는 경고하지 않음', () => {
    const s = setup();
    s.document.uri.fsPath = 'extension.ts';
    s.provider.updateDiagnostics(s.document);
    s.provider.scheduleDiagnostics(s.document);
    assert.strictEqual(s.current().length, 0);
    assert.strictEqual(s.timers.size, 0);
    s.provider.dispose();
});

test('diagnostics: 실기 확인 검사는 기본 켜짐 Warning, gpl.diagnostics.compilerChecks=false 로 끈다', () => {
    const s = setup();
    s.configuration.clear();
    s.document.content = [
        'Module M',
        '    Public Class Plain',
        '    End Class',
        '    Public Sub Main()',
        '        Dim p As Plain = New Plain()',
        '    End Sub',
        'End Module',
    ].join('\r\n');
    s.provider.updateDiagnostics(s.document);
    assert.strictEqual(s.current().length, 1);
    const diagnostic = s.current()[0];
    assert.strictEqual(diagnostic.source, 'GPL Compiler Check');
    assert.strictEqual(diagnostic.code, 'new-parens-without-constructor');
    assert.strictEqual(diagnostic.severity, 1);
    assert.deepStrictEqual([diagnostic.range.startLine, diagnostic.range.start, diagnostic.range.end], [4, 34, 36]);
    s.configuration.set('diagnostics.compilerChecks', false);
    s.provider.updateDiagnostics(s.document);
    assert.strictEqual(s.current().length, 0);
    s.provider.dispose();
});
