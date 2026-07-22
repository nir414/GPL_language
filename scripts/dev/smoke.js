/**
 * 언어 서비스 스모크 하니스 — vscode API를 모의 주입해 컴파일 산출물(out/)의
 * provider(호버/완성)를 실제 .gpl 파일로 구동한다. VS Code 없이 동작 확인용.
 *
 * 사용법 (먼저 npm run compile):
 *   node scripts/dev/smoke.js <파일.gpl>                     # 심볼 요약 + 상수/Sub 호버 배터리
 *   node scripts/dev/smoke.js <파일.gpl> --hover <단어>       # 특정 단어 호버
 *   node scripts/dev/smoke.js <파일.gpl> --member <한정자.>   # 멤버 완성 (예: --member ZeroPlan.)
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const mock = require(path.join(__dirname, 'vscodeMock.js'));
const origLoad = Module._load;
Module._load = function (request) {
    if (request === 'vscode') { return mock; }
    return origLoad.apply(this, arguments);
};
const OUT = path.join(__dirname, '..', '..', 'out');
const { SymbolCache } = require(path.join(OUT, 'symbolCache.js'));
const { GPLHoverProvider } = require(path.join(OUT, 'providers', 'hoverProvider.js'));
const { GPLCompletionProvider } = require(path.join(OUT, 'providers', 'completionProvider.js'));
const { GPLParser } = require(path.join(OUT, 'gplParser.js'));

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('사용법: node scripts/dev/smoke.js <파일.gpl> [--hover 단어] [--member 한정자.]'); process.exit(2); }
const argOf = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };

function makeDoc(txt, fsPath) {
    const ls = txt.split(/\r?\n/);
    return {
        uri: mock.Uri.file(fsPath), languageId: 'gpl', lineCount: ls.length,
        getText: () => txt, lineAt: (i) => ({ text: ls[typeof i === 'number' ? i : i.line] }),
    };
}
const token = { isCancellationRequested: false };
const oneLine = (s) => (s || '').replace(/\s*\n+\s*/g, ' | ').slice(0, 220);

(async () => {
    const text = fs.readFileSync(file, 'utf8');
    const doc = makeDoc(text, path.resolve(file));
    const cache = new SymbolCache();
    cache.updateDocument(doc);
    const hover = new GPLHoverProvider(cache);
    const completion = new GPLCompletionProvider(cache);
    const lines = text.split(/\r?\n/);

    const hoverAt = async (lineIdx, ch, label) => {
        const h = await hover.provideHover(doc, new mock.Position(lineIdx, ch), token);
        console.log(`[hover] ${label} (line ${lineIdx + 1}):`, h ? oneLine(h.contents.value) : '(호버 없음)');
    };
    const hoverWord = async (word) => {
        // 주석 줄은 호버가 정상적으로 억제되므로 코드 줄에서 찾는다.
        const li = lines.findIndex(l => !l.trim().startsWith("'") && new RegExp(`\\b${word}\\b`).test(l));
        if (li < 0) { console.log(`[hover] '${word}' 미발견`); return; }
        await hoverAt(li, lines[li].search(new RegExp(`\\b${word}\\b`)) + 1, word);
    };

    const hoverArg = argOf('--hover');
    const memberArg = argOf('--member');

    if (hoverArg) { await hoverWord(hoverArg); }
    if (memberArg) {
        // 파일 끝 모듈 안에 Probe Sub를 붙여 멤버 완성 컨텍스트를 만든다.
        const probed = text.replace(/End Module\s*$/i, `\tPublic Sub __Probe()\n\t\t${memberArg}\n\tEnd Sub\nEnd Module`);
        const doc2 = makeDoc(probed, path.resolve(file));
        cache.updateDocument(doc2);
        const ls2 = probed.split(/\r?\n/);
        const li = ls2.lastIndexOf(`\t\t${memberArg}`);
        const items = await completion.provideCompletionItems(doc2, new mock.Position(li, ls2[li].length), token, {});
        console.log(`[완성] ${memberArg} →`, items ? `${items.length}개: ${items.map(i => i.label).join(', ')}` : '(한정자 해석 실패 → 전역 폴백)');
        cache.updateDocument(doc); // 원복
    }
    if (!hoverArg && !memberArg) {
        const syms = GPLParser.parseDocument(text, path.resolve(file));
        const counts = {};
        for (const s of syms) { counts[s.kind] = (counts[s.kind] || 0) + 1; }
        console.log(`심볼 ${syms.length}개:`, JSON.stringify(counts));
        const firstConst = syms.find(s => s.kind === 'constant');
        const firstSub = syms.find(s => s.kind === 'sub' || s.kind === 'function');
        if (firstConst) { await hoverWord(firstConst.name); }
        if (firstSub) { await hoverWord(firstSub.name); }
        const nested = syms.filter(s => s.kind === 'class' && s.parentClassName);
        if (nested.length) { console.log('중첩 클래스:', nested.map(s => `${s.parentClassName} > ${s.name}`).join(', ')); }
    }
})().catch(e => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
