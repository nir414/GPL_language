// vscode API 최소 모의 — provider를 샌드박스에서 실행하기 위한 표면만 구현
class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range {
    constructor(a,b,c,d){
        if (typeof a === 'number') { this.start = new Position(a,b); this.end = new Position(c,d); }
        else { this.start = a; this.end = b; }
    }
}
class Hover { constructor(contents, range){ this.contents=contents; this.range=range; } }
class MarkdownString {
    constructor(v){ this.value = v || ''; }
    appendMarkdown(s){ this.value += s; return this; }
    appendCodeblock(c, l){ this.value += '\n```'+(l||'')+'\n'+c+'\n```\n'; return this; }
}
class SnippetString { constructor(v){ this.value = v; } }
class CompletionItem { constructor(label, kind){ this.label=label; this.kind=kind; } }
const CompletionItemKind = new Proxy({}, { get: (t,p) => (typeof p==='string' ? p : undefined) });
class EventEmitter {
    constructor(){ this._ls=[]; }
    get event(){ return (l)=>{ this._ls.push(l); return { dispose(){} }; }; }
    fire(e){ this._ls.forEach(l=>l(e)); }
    dispose(){}
}
const Uri = { file: (p)=>({ fsPath: p, scheme: 'file', toString(){ return 'file://'+p; } }) };
const workspace = {
    getConfiguration: () => ({ get: (_k, d) => d }),
    workspaceFolders: undefined,
    textDocuments: [],
    findFiles: async () => [],
    fs: { readFile: async (uri) => require('fs').readFileSync(uri.fsPath) },
    onDidChangeTextDocument: () => ({ dispose(){} }),
    onDidOpenTextDocument: () => ({ dispose(){} }),
};
const window = { activeTextEditor: undefined, createOutputChannel: () => ({ appendLine(){}, append(){}, dispose(){} }) };
module.exports = {
    Position, Range, Hover, MarkdownString, SnippetString, CompletionItem, CompletionItemKind,
    EventEmitter, Uri, workspace, window,
    debug: { activeDebugSession: undefined },
    languages: {}, commands: {},
    DiagnosticSeverity: {Error:0,Warning:1,Information:2,Hint:3},
    SymbolKind: new Proxy({}, { get:(t,p)=>p }), Location: class {}, DocumentSymbol: class {},
    CancellationTokenSource: class { constructor(){ this.token={isCancellationRequested:false}; } },
};
