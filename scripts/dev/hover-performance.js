/**
 * npm run compile 뒤 node scripts/dev/hover-performance.js <workspace> [source.gpl [line word]]
 * 실제 인덱싱·Hover 경로를 실행한다. VS Code 대기 시간과 렌더링은 포함하지 않는다.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { performance } = require('perf_hooks');
const { createHash } = require('crypto');
const mock = require('./vscodeMock');
const originalLoad = Module._load;
Module._load = function (request) {
    return request === 'vscode' ? mock : originalLoad.apply(this, arguments);
};
const out = path.resolve(__dirname, '../../out');
const { walkTree } = require(path.join(out, 'project/projectSources'));
const { SymbolCache } = require(path.join(out, 'language/vscode/symbolCache'));
const { GPLHoverProvider } = require(path.join(out, 'providers/hoverProvider'));

const [rootArg, sourceArg, lineArg, wordArg] = process.argv.slice(2);
if (!rootArg) {
    console.error('Usage: node scripts/dev/hover-performance.js <workspace> [source.gpl [line word]]');
    process.exit(2);
}
const root = path.resolve(rootArg);
const files = [];
const walk = walkTree(root, file => files.push(file));
if (walk.truncated) { throw new Error('Workspace scan truncated'); }
mock.workspace.workspaceFolders = [{ uri: mock.Uri.file(root) }];
mock.workspace.getWorkspaceFolder = () => mock.workspace.workspaceFolders[0];
mock.workspace.findFiles = async pattern => files
    .filter(file => file.toLowerCase().endsWith(pattern.endsWith('.gpr') ? '.gpr' : '.gpl'))
    .map(file => mock.Uri.file(file));
mock.workspace.fs.readFile = uri => fs.promises.readFile(uri.fsPath);

function document(file) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const reads = { lines: 0, fullText: 0 };
    return {
        uri: mock.Uri.file(file), version: 1, languageId: 'gpl', lineCount: lines.length, reads,
        lineAt(line) { reads.lines++; return { text: lines[line] }; },
        getText(range) {
            if (range) { return lines[range.start.line].slice(range.start.character, range.end.character); }
            reads.fullText++;
            return text;
        },
        getWordRangeAtPosition(pos, pattern) {
            for (const match of lines[pos.line].matchAll(new RegExp(pattern.source, 'g'))) {
                if (pos.character >= match.index && pos.character <= match.index + match[0].length) {
                    return new mock.Range(pos.line, match.index, pos.line, match.index + match[0].length);
                }
            }
        },
    };
}

async function main() {
    const cache = new SymbolCache();
    await cache.refresh();
    const symbols = cache.getAllSymbols();
    const callable = symbols.filter(s => s.kind === 'function' || s.kind === 'sub');
    const targets = sourceArg
        ? callable.filter(s => path.resolve(s.filePath).toLowerCase() === path.resolve(sourceArg).toLowerCase())
        : callable;
    // 여러 문서의 첫 요청과 반복 요청을 분리해 측정한다.
    const selected = sourceArg && lineArg && wordArg
        ? [{ filePath: path.resolve(sourceArg), line: Number(lineArg) - 1, name: wordArg }]
        : [...new Map(targets.map(s => [s.filePath, s])).values()].slice(0, 12);
    if (!selected.length) { throw new Error('No hover targets found'); }
    console.log(JSON.stringify({ files: cache.listIndexedFiles().length, symbols: symbols.length }));
    for (const target of selected) {
        const doc = document(target.filePath);
        const provider = new GPLHoverProvider(cache);
        cache.invalidateProjectRelations();
        const column = doc.lineAt(target.line).text.indexOf(target.name);
        if (column < 0) { throw new Error(`Missing word: ${target.name}`); }
        const position = new mock.Position(target.line, column + 1);
        const io = {};
        const originals = {};
        for (const name of ['readdirSync', 'readFileSync', 'statSync']) {
            originals[name] = fs[name];
            fs[name] = function () { io[name] = (io[name] || 0) + 1; return originals[name].apply(this, arguments); };
        }
        const times = [];
        let contents;
        try {
            for (let i = 0; i < 51; i++) {
                const start = performance.now();
                const hover = await provider.provideHover(doc, position, { isCancellationRequested: false });
                times.push(performance.now() - start);
                if (!hover) { throw new Error(`Missing hover: ${target.filePath}:${target.line + 1}`); }
                const value = hover.contents.value;
                if (contents !== undefined && contents !== value) { throw new Error('Unstable hover contents'); }
                contents = value;
            }
        } finally {
            Object.assign(fs, originals);
        }
        const warm = times.slice(1).sort((a, b) => a - b);
        console.log(JSON.stringify({ file: path.relative(root, target.filePath), line: target.line + 1,
            coldMs: +times[0].toFixed(3), medianMs: +warm[25].toFixed(3), p95Ms: +warm[47].toFixed(3),
            reads: doc.reads, io, cardSha256: createHash('sha256').update(contents).digest('hex') }));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
