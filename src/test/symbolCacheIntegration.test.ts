import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { test } from './harness';
import { normalizePathKey } from '../util/pathKey';

/** VS Code 경계만 대체하고 실제 인덱스·프로젝트 범위·로더·표현 코드를 함께 실행한다. */
function setup() {
    const files = new Map<string, Buffer>();
    const failures = new Map<string, string>();
    const missing = new Set<string>();
    const encodings = new Map<string, string>();
    const decoded = new Map<string, string>();
    const documents: any[] = [];
    const log: string[] = [];
    const opened: string[] = [];
    const reads: string[] = [];
    let scanError = false;
    let scanFiles: string[] = [];
    let scans = 0;
    let scanGate: Promise<void> | undefined;
    const deferredReads = new Map<string, Array<Promise<Buffer>>>();
    const uri = (file: string) => ({ fsPath: file, scheme: 'file' });
    const document = (file: string, content: string) => ({
        uri: uri(file), languageId: 'vb', content,
        getText() { return this.content; },
    });
    const vscode = {
        Uri: { file: uri },
        workspace: {
            textDocuments: documents,
            getWorkspaceFolder: () => undefined,
            getConfiguration: (_section: string, resource?: { fsPath: string }) => ({
                get: (_key: string, fallback: unknown) => resource ? encodings.get(normalizePathKey(resource.fsPath)) ?? fallback : fallback,
            }),
            findFiles: async () => {
                scans++;
                await scanGate;
                if (scanError) { throw new Error('scan failed'); }
                return scanFiles.map(uri);
            },
            fs: { readFile: async (resource: { fsPath: string }) => {
                reads.push(resource.fsPath);
                const key = normalizePathKey(resource.fsPath);
                const deferred = deferredReads.get(key)?.shift();
                if (deferred) { return deferred; }
                const code = failures.get(key);
                if (code) { throw Object.assign(new Error(code), { code }); }
                const bytes = files.get(key);
                if (!bytes) { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
                return bytes;
            } },
            openTextDocument: async (resource: { fsPath: string }) => {
                opened.push(resource.fsPath);
                return document(resource.fsPath, decoded.get(normalizePathKey(resource.fsPath)) ?? '');
            },
        },
        CompletionItemKind: { Module: 1, Class: 2, Function: 3, Method: 4, Variable: 5, Property: 6, Constant: 7, Text: 8 },
        CompletionItem: class { constructor(public label: string, public kind: number) {} },
        SnippetString: class { constructor(public value: string) {} },
        MarkdownString: class {
            value = '';
            isTrusted = false;
            appendCodeblock(value: string, language: string) { this.value += `\n\x60\x60\x60${language}\n${value}\n\x60\x60\x60\n`; }
            appendMarkdown(value: string) { this.value += value; }
        },
    };
    const adapterRoot = path.resolve(__dirname, '../language/vscode');
    const loaded = new Map<string, { exports: any }>();
    function load(file: string): any {
        const existing = loaded.get(file);
        if (existing) { return existing.exports; }
        const module = { exports: {} as any };
        loaded.set(file, module);
        const localRequire = (id: string): any => {
            if (id === 'vscode') { return vscode; }
            if (id.endsWith('/config')) { return { isTraceOn: () => true }; }
            if (id.endsWith('/projectFileScope')) {
                return { PROJECT_EXCLUDE_GLOB: '**/.history/**', findWorkspaceGprPaths: async () => [] };
            }
            if (id.endsWith('/symbolLocations')) {
                return { isMissingFile: (filePath: string) => missing.has(normalizePathKey(filePath)) };
            }
            if (!id.startsWith('.')) { return require(id); }
            const target = path.resolve(path.dirname(file), `${id}.js`);
            return target.startsWith(adapterRoot + path.sep) ? load(target) : require(target);
        };
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, require: localRequire, Buffer, setImmediate,
        }, { filename: file });
        return module.exports;
    }
    const { SymbolCache } = load(path.join(adapterRoot, 'symbolCache.js'));
    const cache = new SymbolCache({ appendLine: (message: string) => log.push(message) });
    return {
        cache, documents, log, reads, opened, uri, document,
        write: (file: string, text: string) => files.set(normalizePathKey(file), Buffer.from(text)),
        writeBytes: (file: string, bytes: Buffer) => files.set(normalizePathKey(file), bytes),
        deferRead: (file: string) => {
            let finish!: (bytes: Buffer) => void;
            const promise = new Promise<Buffer>(resolve => { finish = resolve; });
            const key = normalizePathKey(file);
            const queue = deferredReads.get(key) ?? [];
            queue.push(promise);
            deferredReads.set(key, queue);
            return (text: string) => finish(Buffer.from(text));
        },
        blockScan: () => {
            let finish!: () => void;
            scanGate = new Promise<void>(resolve => { finish = resolve; });
            return finish;
        },
        scanCount: () => scans,
        fail: (file: string, code: string) => failures.set(normalizePathKey(file), code),
        markMissing: (file: string) => missing.add(normalizePathKey(file)),
        setEncoding: (file: string, encoding: string, text: string) => {
            encodings.set(normalizePathKey(file), encoding);
            decoded.set(normalizePathKey(file), text);
        },
        scan: (paths: string[]) => { scanFiles = paths; },
        failScan: () => { scanError = true; },
        recoverScan: () => { scanError = false; },
    };
}

test('SymbolCache 조립: vb로 열린 문서도 갱신하고 file 외 문서는 건너뛴다', () => {
    const s = setup();
    s.cache.updateDocument(s.document('Main.gpl', 'Public Sub Main()\nEnd Sub'));
    const ignored = s.document('Other.gpl', 'Public Sub Ignored()\nEnd Sub');
    ignored.uri.scheme = 'untitled';
    s.cache.updateDocument(ignored);
    assert.strictEqual(s.cache.findDefinition('Main').name, 'Main');
    assert.strictEqual(s.cache.findDefinition('Ignored'), undefined);
});

test('SymbolCache 조립: UTF-8 BOM은 직접 제거하고 다른 인코딩은 VS Code에 맡긴다', async () => {
    const s = setup();
    s.write('Utf8.gpl', '\uFEFFPublic Sub Main()\nEnd Sub');
    assert.strictEqual(await s.cache.readSourceText(s.uri('Utf8.gpl')), 'Public Sub Main()\nEnd Sub');
    assert.strictEqual(s.opened.length, 0);
    s.setEncoding('Legacy.gpl', 'euckr', "' 한글 주석");
    assert.strictEqual(await s.cache.readSourceText(s.uri('Legacy.gpl')), "' 한글 주석");
    assert.deepStrictEqual(s.opened, ['Legacy.gpl']);
});

test('SymbolCache 조립: 워처 묶음은 미저장 버퍼를 우선하고 읽기 실패 뒤에도 진행한다', async () => {
    const s = setup();
    s.write('A.gpl', 'Public Sub Saved()\nEnd Sub');
    s.documents.push(s.document('a.gpl', 'Public Sub Dirty()\nEnd Sub'));
    s.fail('Denied.gpl', 'EACCES');
    s.write('B.gpl', 'Public Sub Other()\nEnd Sub');
    await s.cache.updateFilesFromDisk(['A.gpl', 'Denied.gpl', 'B.gpl'].map(s.uri));
    assert.strictEqual(s.cache.findDefinition('Saved'), undefined);
    assert.strictEqual(s.cache.findDefinition('Dirty').name, 'Dirty');
    assert.strictEqual(s.cache.findDefinition('Other').name, 'Other');
    assert.ok(!s.reads.includes('A.gpl'));
    assert.ok(s.log.some(message => message.includes('2 files (watcher batch)')));
});

test('SymbolCache 조립: 참조 검색은 사용 전용 파일과 미저장 버퍼를 포함한다', async () => {
    const s = setup();
    s.cache.updateDocument(s.document('A.gpl', 'Public Sub Run()\nEnd Sub'));
    s.cache.updateDocument(s.document('B.gpl', 'Run()'));
    s.write('A.gpl', 'Public Sub Run()\nEnd Sub');
    s.write('B.gpl', 'Nothing()');
    s.documents.push(s.document('b.gpl', 'RUN()\n\' Run\nConsole.WriteLine("Run")'));
    const found = await s.cache.findReferences('Run');
    assert.strictEqual(found.length, 2);
    assert.strictEqual(found.find((entry: any) => entry.filePath === 'B.gpl').usages.length, 1);
    assert.strictEqual((await s.cache.findReferences('Run', { isCancellationRequested: true })).length, 0);
});

test('SymbolCache 조립: 읽기 실패 중 삭제가 확인된 파일만 인덱스에서 정리한다', async () => {
    const s = setup();
    s.cache.updateDocument(s.document('Missing.gpl', 'Public Sub Missing()\nEnd Sub'));
    s.cache.updateDocument(s.document('Denied.gpl', 'Public Sub Denied()\nEnd Sub'));
    s.fail('Missing.gpl', 'ENOENT');
    s.fail('Denied.gpl', 'EACCES');
    s.markMissing('Missing.gpl');
    assert.strictEqual((await s.cache.findReferences('Run')).length, 0);
    assert.strictEqual(s.cache.findDefinition('Missing'), undefined);
    assert.strictEqual(s.cache.findDefinition('Denied').name, 'Denied');
});

test('SymbolCache 조립: refresh는 기존 심볼을 지우고 실패 뒤에도 상태를 해제한다', async () => {
    const s = setup();
    s.cache.updateDocument(s.document('Old.gpl', 'Public Sub Old()\nEnd Sub'));
    s.write('New.gpl', 'Public Sub NewName()\nEnd Sub');
    s.scan(['New.gpl']);
    await s.cache.refresh();
    assert.strictEqual(s.cache.findDefinition('Old'), undefined);
    assert.strictEqual(s.cache.findDefinition('NewName').name, 'NewName');
    assert.strictEqual(s.cache.isRefreshing, false);
    s.failScan();
    await assert.rejects(() => s.cache.refresh(), /scan failed/);
    assert.strictEqual(s.cache.isRefreshing, false);
});

test('SymbolCache 조립: 완성 항목은 중복 이름을 접고 문서·스니펫을 유지한다', () => {
    const s = setup();
    s.cache.updateDocument(s.document('Math.gpl', [
        "' 값을 돌려준다.",
        'Public Function Pick(value As Integer) As Integer', 'End Function',
        'Public Function Pick(value As Integer, other As Integer) As Integer', 'End Function',
    ].join('\n')));
    const items = s.cache.getCompletionItems().filter((item: any) => item.label === 'Pick');
    assert.strictEqual(items.length, 1);
    assert.ok(items[0].documentation.value.includes('Function Pick'));
    assert.ok(items[0].documentation.value.includes('값을 돌려준다.'));
    assert.ok(items[0].insertText.value.startsWith('Pick(${1:'));
    assert.strictEqual(items[0].documentation.isTrusted, false);
});

test('SymbolCache: 참조 검색도 설정된 UTF-16 디코더를 사용한다', async () => {
    const s = setup();
    s.cache.updateDocument(s.document('Legacy.gpl', 'Run()'));
    s.writeBytes('Legacy.gpl', Buffer.from('Run()', 'utf16le'));
    s.setEncoding('Legacy.gpl', 'utf16le', 'Run()');
    const found = await s.cache.findReferences('Run');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].usages.length, 1);
    assert.deepStrictEqual(s.opened, ['Legacy.gpl']);
});

test('SymbolCache: file 외 문서는 실제 파일 참조를 가리지 않는다', async () => {
    const s = setup();
    s.cache.updateDocument(s.document('Main.gpl', 'Run()'));
    s.write('Main.gpl', 'Run()');
    const untitled = s.document('Main.gpl', 'Other()');
    untitled.uri.scheme = 'untitled';
    s.documents.push(untitled);
    assert.strictEqual((await s.cache.findReferences('Run')).length, 1);
});

test('SymbolCache: 늦게 도착한 디스크 읽기는 최신 문서 갱신을 덮어쓰지 않는다', async () => {
    const s = setup();
    const finish = s.deferRead('Main.gpl');
    const pending = s.cache.updateFilesFromDisk([s.uri('Main.gpl')]);
    s.cache.updateDocument(s.document('Main.gpl', 'Public Sub Latest()\nEnd Sub'));
    finish('Public Sub Saved()\nEnd Sub');
    await pending;
    assert.strictEqual(s.cache.findDefinition('Latest')?.name, 'Latest');
    assert.strictEqual(s.cache.findDefinition('Saved'), undefined);
});

test('SymbolCache: 읽기 도중 새로 열린 문서의 미저장 버퍼를 반영한다', async () => {
    const s = setup();
    const finish = s.deferRead('Main.gpl');
    const pending = s.cache.updateFilesFromDisk([s.uri('Main.gpl')]);
    s.documents.push(s.document('Main.gpl', 'Public Sub Dirty()\nEnd Sub'));
    finish('Public Sub Saved()\nEnd Sub');
    await pending;
    assert.strictEqual(s.cache.findDefinition('Dirty')?.name, 'Dirty');
    assert.strictEqual(s.cache.findDefinition('Saved'), undefined);
});

test('SymbolCache: 삭제된 폴더의 진행 중 읽기는 심볼을 되살리지 않는다', async () => {
    const s = setup();
    const finish = s.deferRead('folder/New.gpl');
    const pending = s.cache.updateFilesFromDisk([s.uri('folder/New.gpl')]);
    s.cache.deleteByFsPathPrefix('folder');
    finish('Public Sub Ghost()\nEnd Sub');
    await pending;
    assert.strictEqual(s.cache.findDefinition('Ghost'), undefined);
    assert.strictEqual(s.cache.listIndexedFiles().length, 0);
});

test('SymbolCache: 먼저 시작한 읽기가 먼저 끝나도 나중 갱신 요청을 막지 않는다', async () => {
    const s = setup();
    const older = s.deferRead('Main.gpl');
    const first = s.cache.updateFilesFromDisk([s.uri('Main.gpl')]);
    const newer = s.deferRead('Main.gpl');
    const second = s.cache.updateFilesFromDisk([s.uri('Main.gpl')]);
    older('Public Sub Before()\nEnd Sub');
    await first;
    newer('Public Sub Latest()\nEnd Sub');
    await second;
    assert.strictEqual(s.cache.findDefinition('Latest')?.name, 'Latest');
    assert.strictEqual(s.cache.findDefinition('Before'), undefined);
});

test('SymbolCache: 나중 요청이 먼저 끝나면 이전 읽기 결과를 버린다', async () => {
    const s = setup();
    const older = s.deferRead('Main.gpl');
    const first = s.cache.updateFilesFromDisk([s.uri('Main.gpl')]);
    const newer = s.deferRead('Main.gpl');
    const second = s.cache.updateFilesFromDisk([s.uri('Main.gpl')]);
    newer('Public Sub Latest()\nEnd Sub');
    await second;
    older('Public Sub Before()\nEnd Sub');
    await first;
    assert.strictEqual(s.cache.findDefinition('Latest')?.name, 'Latest');
    assert.strictEqual(s.cache.findDefinition('Before'), undefined);
});

test('SymbolCache: 아직 인덱싱되지 않은 파일 삭제도 진행 중 읽기를 무효화한다', async () => {
    const s = setup();
    const finish = s.deferRead('New.gpl');
    const pending = s.cache.updateFilesFromDisk([s.uri('New.gpl')]);
    s.cache.removeFile('New.gpl');
    finish('Public Sub Ghost()\nEnd Sub');
    await pending;
    assert.strictEqual(s.cache.findDefinition('Ghost'), undefined);
    assert.strictEqual(s.cache.listIndexedFiles().length, 0);
});

test('SymbolCache: 같은 경로를 refresh로 다시 읽어도 이전 읽기가 최신 심볼을 덮지 않는다', async () => {
    const s = setup();
    const finish = s.deferRead('Main.gpl');
    const pending = s.cache.updateFilesFromDisk([s.uri('Main.gpl')]);
    s.write('Main.gpl', 'Public Sub Latest()\nEnd Sub');
    s.scan(['Main.gpl']);
    await s.cache.refresh();
    finish('Public Sub Before()\nEnd Sub');
    await pending;
    assert.strictEqual(s.cache.findDefinition('Latest')?.name, 'Latest');
    assert.strictEqual(s.cache.findDefinition('Before'), undefined);
});

test('SymbolCache: 참조 검색 취소가 읽기 중 발생하면 뒤늦은 결과를 반환하지 않는다', async () => {
    const s = setup();
    s.cache.updateDocument(s.document('Main.gpl', 'Run()'));
    const finish = s.deferRead('Main.gpl');
    const token = { isCancellationRequested: false };
    const pending = s.cache.findReferences('Run', token);
    token.isCancellationRequested = true;
    finish('Run()');
    assert.strictEqual((await pending).length, 0);
});

test('SymbolCache: refresh 이전에 시작된 워처 읽기를 새 인덱스에 섞지 않는다', async () => {
    const s = setup();
    const finish = s.deferRead('Old.gpl');
    const pending = s.cache.updateFilesFromDisk([s.uri('Old.gpl')]);
    s.write('New.gpl', 'Public Sub Latest()\nEnd Sub');
    s.scan(['New.gpl']);
    await s.cache.refresh();
    finish('Public Sub Ghost()\nEnd Sub');
    await pending;
    assert.strictEqual(s.cache.findDefinition('Latest')?.name, 'Latest');
    assert.strictEqual(s.cache.findDefinition('Ghost'), undefined);
});

test('SymbolCache: 진행 중 refresh 요청은 직렬 후속 갱신으로 합치고 실패 뒤 재시도한다', async () => {
    const s = setup();
    const unblock = s.blockScan();
    const first = s.cache.refresh();
    await new Promise<void>(resolve => setImmediate(resolve));
    const second = s.cache.refresh();
    const third = s.cache.refresh();
    await new Promise<void>(resolve => setImmediate(resolve));
    const concurrentScans = s.scanCount();
    unblock();
    await Promise.all([first, second, third]);
    assert.strictEqual(concurrentScans, 1);
    assert.strictEqual(s.scanCount(), 2);
    assert.strictEqual(s.cache.isRefreshing, false);
    s.failScan();
    await assert.rejects(() => s.cache.refresh(), /scan failed/);
    s.recoverScan();
    await s.cache.refresh();
    assert.strictEqual(s.cache.isRefreshing, false);
});
