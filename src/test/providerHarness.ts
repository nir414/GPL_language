/**
 * 언어 provider 를 Node 단독 러너에서 돌리기 위한 VS Code 경계 대역.
 *
 * 컴파일된 provider(`out/providers/*.js`)를 vm 으로 읽고 `vscode` 와 지정한 모듈만 대역으로 바꾼다.
 * 심볼 인덱스·파서·수신자 해석·오버로드 해석은 실제 구현이 돈다(hoverProvider.test 와 같은 방식을 여러 파일로 일반화).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { SymbolIndex } from '../language/symbols/symbolIndex';

export class Position {
    constructor(public line: number, public character: number) {}
}

export class Range {
    start: Position;
    end: Position;
    constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
        if (typeof a === 'number') {
            this.start = new Position(a, b as number);
            this.end = new Position(c!, d!);
        } else {
            this.start = a;
            this.end = b as Position;
        }
    }
}

export class Location {
    range: Range;
    constructor(public uri: FakeUri, rangeOrPosition: Range | Position) {
        this.range = rangeOrPosition instanceof Range
            ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
    }
}

export interface FakeUri {
    fsPath: string;
    scheme: string;
    toString(): string;
}

export const fileUri = (fsPath: string): FakeUri =>
    ({ fsPath, scheme: 'file', toString: () => `file:///${fsPath.replace(/\\/g, '/')}` });

/** 줄 배열로 만든 TextDocument 대역(provider 가 쓰는 메서드만). */
export function makeDocument(fsPath: string, text: string) {
    const lines = text.split('\n');
    const lineStarts: number[] = [];
    let offset = 0;
    for (const l of lines) { lineStarts.push(offset); offset += l.length + 1; }
    return {
        uri: fileUri(fsPath),
        version: 1,
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] }),
        getText: (range?: Range) => {
            if (!range) { return text; }
            const s = lineStarts[range.start.line] + range.start.character;
            const e = lineStarts[range.end.line] + range.end.character;
            return text.slice(s, e);
        },
        offsetAt: (p: Position) => lineStarts[p.line] + p.character,
        positionAt: (o: number) => {
            let line = 0;
            while (line + 1 < lineStarts.length && lineStarts[line + 1] <= o) { line++; }
            return new Position(line, o - lineStarts[line]);
        },
        getWordRangeAtPosition: (position: Position, pattern: RegExp) => {
            for (const match of lines[position.line].matchAll(new RegExp(pattern.source, 'g'))) {
                if (position.character >= match.index! && position.character <= match.index! + match[0].length) {
                    return new Range(position.line, match.index!, position.line, match.index! + match[0].length);
                }
            }
            return undefined;
        },
    };
}

export type FakeDocument = ReturnType<typeof makeDocument>;

export interface ProviderWorld {
    /** fsPath → 문서 */
    docs: Map<string, FakeDocument>;
    /** SymbolCache 대역(실제 SymbolIndex + 파일 읽기) */
    cache: any;
    /** verbose 로그 */
    logs: string[];
    output: { appendLine(line: string): void };
    /** provider 모듈 로드 — 대역 모듈을 덮어쓸 수 있다(`../project/projectFileScope` 등). */
    load(relativeFromOut: string, stubs?: Record<string, unknown>): any;
    /** 줄의 `marker` 첫 글자(또는 그 안의 offset) 위치 */
    at(fsPath: string, line: number, marker: string, offset?: number): Position;
}

/**
 * 파일 묶음으로 provider 실행 환경을 만든다. 모든 파일은 한 컴파일 단위로 본다.
 */
export function createProviderWorld(files: Record<string, string>): ProviderWorld {
    const docs = new Map<string, FakeDocument>();
    const index = new SymbolIndex({
        narrowCandidates: candidates => candidates,
        scoreFilePath: (candidate, reference) => (candidate === reference ? 100 : 0),
        isSameCompileUnit: () => true,
    });
    for (const [fsPath, text] of Object.entries(files)) {
        docs.set(fsPath, makeDocument(fsPath, text));
        index.updateFileText(fsPath, text);
    }
    index.rebuildNameIndex();

    const cache = new Proxy(index as any, {
        get(target, prop) {
            if (prop === 'readSourceText') {
                return async (uri: FakeUri) => {
                    const d = docs.get(uri.fsPath);
                    if (!d) { throw new Error(`no file ${uri.fsPath}`); }
                    return d.getText();
                };
            }
            if (prop === 'findReferences') { return async () => []; }
            if (prop === 'pruneMissingFiles') { return () => 0; }
            const v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
        },
    });

    const logs: string[] = [];
    const output = { appendLine: (line: string) => { logs.push(line); } };

    const vscode = {
        workspace: {
            getConfiguration: () => ({
                get: (key: string, fallback: unknown) => (key === 'trace.server' ? 'verbose' : fallback),
            }),
            textDocuments: [] as unknown[],
            getWorkspaceFolder: () => undefined,
            openTextDocument: async (uri: FakeUri | string) => {
                const p = typeof uri === 'string' ? uri : uri.fsPath;
                const d = docs.get(p);
                if (!d) { throw new Error(`no file ${p}`); }
                return d;
            },
        },
        debug: {},
        Position,
        Range,
        Location,
        Uri: { file: fileUri },
        MarkdownString: class {
            value = '';
            isTrusted = false;
            appendMarkdown(value: string) { this.value += value; }
            appendCodeblock(value: string) { this.value += `\n${value}\n`; }
        },
        Hover: class { constructor(public contents: any, public range: Range) {} },
    };

    function load(relativeFromOut: string, stubs: Record<string, unknown> = {}): any {
        const loaded = new Map<string, { exports: any }>();
        const loadFile = (filename: string): any => {
            const cached = loaded.get(filename);
            if (cached) { return cached.exports; }
            const module = { exports: {} as any };
            loaded.set(filename, module);
            const realRequire = createRequire(filename);
            vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
                module, exports: module.exports,
                require: (id: string) => {
                    if (id === 'vscode') { return vscode; }
                    if (id in stubs) { return stubs[id]; }
                    const resolved = realRequire.resolve(id);
                    return id.startsWith('.') && resolved.endsWith('.js') ? loadFile(resolved) : realRequire(id);
                },
            }, { filename });
            return module.exports;
        };
        return loadFile(path.resolve(__dirname, '..', relativeFromOut));
    }

    const at = (fsPath: string, line: number, marker: string, offset = 0): Position => {
        const text = docs.get(fsPath)!.lineAt(line).text;
        const idx = text.indexOf(marker);
        if (idx < 0) { throw new Error(`marker "${marker}" not on ${fsPath}:${line}`); }
        return new Position(line, idx + offset);
    };

    return { docs, cache, logs, output, load, at };
}

export const NO_CANCEL = { isCancellationRequested: false };
