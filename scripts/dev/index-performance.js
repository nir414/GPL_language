/**
 * npm run compile 뒤 node scripts/dev/index-performance.js [프로젝트수=16] [반복=5]
 * 합성 워크스페이스(samples/syntax-tour 사본 N개, 깊게 중첩된 폴더, 모듈·클래스 이름 변경)를 임시 폴더에 만들고
 * SymbolCache.refresh() 경로(탐색 → 파일 읽기 → 파싱 → 인덱스 구성)를 단계별로 측정한다.
 * 이어서 호버·정의 조회 중앙값을 출력한다. VS Code 대기 시간과 렌더링은 포함하지 않는다.
 * 결과 동일성 확인용으로 심볼 목록 SHA-256도 출력한다(최적화 전후 같아야 한다).
 */
const fs = require('fs');
const os = require('os');
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
const { walkTree } = require(path.join(out, 'project/sources/projectSources'));
const { SymbolCache } = require(path.join(out, 'language/vscode/symbolCache'));
const { GPLParser } = require(path.join(out, 'language/syntax/gplParser'));
const { GPLHoverProvider } = require(path.join(out, 'providers/intellisense/hoverProvider'));

const projects = Number(process.argv[2] || 16);
const iterations = Number(process.argv[3] || 5);
const sampleDir = path.resolve(__dirname, '../../samples/syntax-tour');

function buildWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-index-perf-'));
    const sources = fs.readdirSync(sampleDir).filter(n => /\.(gpl|gpr)$/i.test(n))
        .map(n => [n, fs.readFileSync(path.join(sampleDir, n), 'utf8')]);
    const names = new Set();
    for (const [, text] of sources) {
        for (const m of text.matchAll(/^\s*(?:Public\s+|Private\s+)?(?:Module|Class)\s+([A-Za-z_]\w*)/gim)) { names.add(m[1]); }
    }
    let files = 0;
    for (let p = 0; p < projects; p++) {
        // 깊은 한글 경로를 흉내 낸 중첩 폴더
        const dir = path.join(root, `과제${p % 4}`, `시뮬레이션_${p}`, 'GPL_Code', `T${p}`, `T${p}_sub`);
        fs.mkdirSync(dir, { recursive: true });
        for (const [name, text] of sources) {
            let body = text;
            for (const n of names) { body = body.replace(new RegExp(`\b${n}\b`, 'g'), `${n}_${p}`); }
            body = body.replace(/ProjectName="[^"]*"/, `ProjectName="tour_${p}"`);
            fs.writeFileSync(path.join(dir, name.replace(/\.gpl$/i, `_${p}.gpl`).replace(/^(Main|Declarations|Shapes|Faults)_/, '$1_')), body);
            files++;
        }
        // Project.gpr 의 ProjectSource 도 변경된 파일명에 맞춘다.
        const gpr = path.join(dir, 'Project.gpr');
        fs.writeFileSync(gpr, fs.readFileSync(gpr, 'utf8').replace(/ProjectSource="(\w+)\.gpl"/g, `ProjectSource="$1_${p}.gpl"`)
            .replace(/ProjectStart="(\w+)"/, `ProjectStart="$1_${p}"`));
    }
    return { root, files };
}

const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function main() {
    const { root, files: fileCount } = buildWorkspace();
    try {
        const all = [];
        walkTree(root, f => all.push(f));
        mock.workspace.workspaceFolders = [{ uri: mock.Uri.file(root) }];
        mock.workspace.getWorkspaceFolder = () => mock.workspace.workspaceFolders[0];
        mock.workspace.findFiles = async pattern => all
            .filter(f => f.toLowerCase().endsWith(pattern.endsWith('.gpr') ? '.gpr' : '.gpl')).map(f => mock.Uri.file(f));
        let readMs = 0;
        mock.workspace.fs.readFile = async uri => { const t = performance.now(); const b = await fs.promises.readFile(uri.fsPath); readMs += performance.now() - t; return b; };
        const origParse = GPLParser.parseDocument;
        let parseMs = 0;
        GPLParser.parseDocument = function () { const t = performance.now(); try { return origParse.apply(this, arguments); } finally { parseMs += performance.now() - t; } };

        const runs = [];
        let cache;
        for (let i = 0; i < iterations; i++) {
            GPLParser._parseCache.clear();
            readMs = 0; parseMs = 0;
            cache = new SymbolCache();
            const t = performance.now();
            await cache.refresh();
            const total = performance.now() - t;
            runs.push({ total, read: readMs, parse: parseMs, index: total - readMs - parseMs });
        }
        const symbols = cache.getAllSymbols();
        const digest = createHash('sha256').update(JSON.stringify(symbols.map(s =>
            [path.relative(root, s.filePath), s.name, s.kind, s.line, s.endLine, s.container]))).digest('hex').slice(0, 16);

        // 조회: 호출 가능한 심볼마다 정의 조회, 파일별 첫 호출 가능 심볼에 대해 호버
        const callable = symbols.filter(s => s.kind === 'function' || s.kind === 'sub');
        const defTimes = [];
        for (let r = 0; r < 3; r++) {
            for (const s of callable) {
                const t = performance.now();
                cache.findDefinition(s.name, s.filePath);
                defTimes.push(performance.now() - t);
            }
        }
        const hoverTimes = [];
        const perFile = [...new Map(callable.map(s => [s.filePath, s])).values()];
        for (const target of perFile) {
            const text = fs.readFileSync(target.filePath, 'utf8');
            const lines = text.split(/\r?\n/);
            const doc = {
                uri: mock.Uri.file(target.filePath), version: 1, languageId: 'gpl', lineCount: lines.length,
                lineAt: l => ({ text: lines[l] }),
                getText(range) { return range ? lines[range.start.line].slice(range.start.character, range.end.character) : text; },
                getWordRangeAtPosition(pos, pattern) {
                    for (const m of lines[pos.line].matchAll(new RegExp(pattern.source, 'g'))) {
                        if (pos.character >= m.index && pos.character <= m.index + m[0].length) {
                            return new mock.Range(pos.line, m.index, pos.line, m.index + m[0].length);
                        }
                    }
                },
            };
            const col = (lines[target.line] || '').indexOf(target.name);
            if (col < 0) { continue; }
            const provider = new GPLHoverProvider(cache);
            const pos = new mock.Position(target.line, col + 1);
            for (let i = 0; i < 5; i++) {
                const t = performance.now();
                await provider.provideHover(doc, pos, { isCancellationRequested: false });
                hoverTimes.push(performance.now() - t);
            }
        }
        const f = n => +n.toFixed(2);
        console.log(JSON.stringify({ files: fileCount, indexedFiles: cache.listIndexedFiles().length, symbols: symbols.length, digest }));
        console.log('phase (median of ' + iterations + ', ms): ' + JSON.stringify({
            total: f(median(runs.map(r => r.total))), read: f(median(runs.map(r => r.read))),
            parse: f(median(runs.map(r => r.parse))), indexAndOther: f(median(runs.map(r => r.index))) }));
        console.log('lookup median (ms): ' + JSON.stringify({
            findDefinition: +median(defTimes).toFixed(4), hover: +median(hoverTimes).toFixed(3),
            hoverCount: hoverTimes.length }));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
