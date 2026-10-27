/**
 * 파일 하나가 **다른 파일의 어떤 선언을 쓰는가** — Requires 헤더 자동 동기화의 계산부(vscode 무의존 순수 모듈).
 *
 * 배경(2026-10-27 Sample Prep 요청): 모듈 머리 주석의 `'Requires:` 목록을 손으로 맞추다 보니 같은 파일이 두 줄로
 * 갈라지거나(Machine.gpl 의 MotionSystem.gpl 2줄) 빠진 항목이 생겼다. 정의 이동·참조 찾기와 **같은 이름 해석 규칙**으로
 * 다시 계산해 목록을 만든다 — 규칙의 정본은 receiverType(수신자 체인)·referenceScope(감싸는 프로시저/컨테이너)다.
 *
 * 판정 원칙은 참조 찾기와 같다: **확정할 수 없으면 뺀다.** 수신자 타입을 모르는 멤버 호출, 같은 이름의 모듈 멤버가
 * 여럿인 한정자 없는 사용, 문자열로 부르는 프로시저는 목록에 넣지 않는다.
 *
 * 단위 테스트: src/test/language/analysis/moduleDependencies.test.ts
 */
import * as path from 'path';
import { GPLParser, GPLSymbol, GPLSymbolKind } from '../syntax/gplParser';
import { isGplReservedWord } from '../syntax/gplReservedWords';
import { normalizePathKey } from '../../util/pathKey';
import {
    enclosingClassName, enclosingModuleName,
    ownedByHolder, ReceiverLookup, ReceiverSegment, resolveReceiverHolder,
} from './receiverType';
import { containerAt } from './referenceScope';

/** 다른 파일의 심볼 조회 — 보통 `SymbolCache`(compilerChecks 의 조회와 같은 모양). */
export interface DependencyLookup {
    findAllByName(name: string): readonly GPLSymbol[];
    isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean;
}

/**
 * 줄 `line` 에서의 수신자 해석 조회를 만든다. 조립(로컬 파싱·프로시저 범위·내장 사전 훅)의 정본은
 * `providers/intellisense/receiverContext.buildReceiverContextFromText` 이고, 호출부가 그것을 넘긴다.
 * `findAllByName` 은 이 모듈이 컴파일 단위로 좁힌 조회다.
 */
export type ReceiverLookupFactory = (line: number, findAllByName: (name: string) => GPLSymbol[]) => ReceiverLookup;

/** 대상 파일에서 쓰는 선언 하나 — 최상위 이름(Class·모듈 멤버)과, 클래스라면 쓰는 멤버들. */
export interface RequiredItem {
    name: string;
    members: string[];
}

/** 의존하는 파일 하나. */
export interface RequiredFile {
    filePath: string;
    /** 헤더에 쓰는 이름(파일명) */
    fileName: string;
    /** 쓰인 선언이 속한 모듈(선언 순) */
    modules: string[];
    /** 대상 파일의 선언 순서 */
    items: RequiredItem[];
}

interface ItemAcc { name: string; line: number; members: Map<string, { name: string; line: number }> }
interface FileAcc { filePath: string; modules: Map<string, { name: string; line: number }>; items: Map<string, ItemAcc> }

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

/** 한 줄(주석·문자열을 지운 코드)에서 `a(0).b.c` 꼴 체인을 모두 뽑는다. 괄호 안의 체인도 따로 뽑힌다. */
export function scanChains(code: string): ReceiverSegment[][] {
    const chains: ReceiverSegment[][] = [];
    for (let i = 0; i < code.length; i++) {
        if (!IDENT_START.test(code[i]) || (i > 0 && IDENT_CHAR.test(code[i - 1]))) { continue; }
        let p = i - 1;
        while (p >= 0 && code[p] === ' ') { p--; }
        const continuation = p >= 0 && code[p] === '.';
        const segs: ReceiverSegment[] = [];
        let j = i;
        for (;;) {
            let end = j;
            while (end < code.length && IDENT_CHAR.test(code[end])) { end++; }
            const seg: ReceiverSegment = { name: code.slice(j, end) };
            j = end;
            if (code[j] === '(') {
                const close = matchParen(code, j);
                if (close < 0) { segs.push(seg); break; }
                seg.args = code.slice(j + 1, close);
                j = close + 1;
            }
            segs.push(seg);
            if (code[j] === '.' && j + 1 < code.length && IDENT_START.test(code[j + 1])) { j++; continue; }
            break;
        }
        if (!continuation) { chains.push(segs); }
        // 체인의 나머지는 건너뛰지 않는다 — 괄호 인자 안의 체인을 같은 루프가 이어서 뽑고,
        // `.` 뒤 세그먼트는 continuation 이라 새 체인으로 세지 않는다.
        i += segs[0].name.length - 1;
    }
    return chains;
}

function matchParen(code: string, open: number): number {
    let depth = 0;
    for (let k = open; k < code.length; k++) {
        if (code[k] === '(') { depth++; } else if (code[k] === ')') { depth--; if (depth === 0) { return k; } }
    }
    return -1;
}

const isProcedureKind = (k: GPLSymbolKind | string): boolean =>
    k === GPLSymbolKind.Sub || k === GPLSymbolKind.Function || k === GPLSymbolKind.Property;

/** 다른 모듈에서 한정자 없이 보이는가 — Private 이거나, 수식어 없는 모듈 변수(`Dim`)·상수는 보이지 않는다. */
function visibleFromOtherModule(s: GPLSymbol): boolean {
    if (s.accessModifier === 'private') { return false; }
    if (s.accessModifier === 'public') { return true; }
    return isProcedureKind(s.kind) || s.kind === GPLSymbolKind.Class || s.kind === GPLSymbolKind.Delegate;
}

/**
 * 파일 `filePath`(본문 `text`)가 쓰는 다른 파일의 선언을 파일별로 모은다. 순서는 호출부가 정한다(`orderRequiredFiles`).
 * 같은 파일명·모듈의 사본(다른 프로젝트에 복제된 Lib)은 한 항목으로 접는다.
 */
export function collectRequiredFiles(
    text: string,
    filePath: string,
    lookup: DependencyLookup,
    receiverLookupAt: ReceiverLookupFactory,
): RequiredFile[] {
    const selfKey = normalizePathKey(filePath);
    const isSelf = (p: string): boolean => normalizePathKey(p) === selfKey;
    // receiverContext 와 같은 파싱 옵션 — parseDocument 가 내용 기준으로 메모이즈하므로 한 번만 파싱된다
    const fileSymbols = GPLParser.parseDocument(text, filePath, { includeLocals: true, includeParameters: true });
    const ownNonLocal = fileSymbols.filter(s => !s.isLocal && !s.isParameter);
    const ownNames = new Set(ownNonLocal.map(s => s.name.toLowerCase()));
    const ownModules = new Set(ownNonLocal.filter(s => s.kind === GPLSymbolKind.Module).map(s => s.name.toLowerCase()));
    const selfName = path.basename(filePath).toLowerCase();

    /** 같은 컴파일 단위 후보를 우선한다 — 단위 안 후보가 없으면(경계 판정 불가) 그대로 쓴다. */
    const unitMemo = new Map<string, GPLSymbol[]>();
    const unitFind = (name: string): GPLSymbol[] => {
        const memo = unitMemo.get(name.toLowerCase());
        if (memo) { return memo; }
        const all = lookup.findAllByName(name).filter(s => !s.isLocal && !s.isParameter && !isSelf(s.filePath)
            // 경계를 모를 때 다른 프로젝트에 복제된 자기 사본을 의존으로 세지 않는다
            && !(path.basename(s.filePath).toLowerCase() === selfName && ownModules.has((s.module ?? '').toLowerCase())));
        const inUnit = all.filter(s => lookup.isSameCompileUnit(s.filePath, filePath));
        const out = inUnit.length > 0 ? inUnit : all;
        unitMemo.set(name.toLowerCase(), out);
        return out;
    };


    const files = new Map<string, FileAcc>();
    const record = (decl: GPLSymbol, top: GPLSymbol, member?: GPLSymbol): void => {
        const fileName = path.basename(decl.filePath);
        const mod = decl.module ?? top.module;
        const key = `${fileName}|${mod ?? ''}`.toLowerCase();
        let f = files.get(key);
        if (!f) { f = { filePath: decl.filePath, modules: new Map(), items: new Map() }; files.set(key, f); }
        if (mod && !f.modules.has(mod.toLowerCase())) { f.modules.set(mod.toLowerCase(), { name: mod, line: top.line }); }
        let item = f.items.get(top.name.toLowerCase());
        if (!item) { item = { name: top.name, line: top.line, members: new Map() }; f.items.set(top.name.toLowerCase(), item); }
        if (member && !item.members.has(member.name.toLowerCase())) {
            item.members.set(member.name.toLowerCase(), { name: member.name, line: member.line });
        }
    };
    /** 클래스 멤버면 (클래스, 멤버), 모듈 직속이면 (자기) 로 기록한다. */
    const recordDecl = (decl: GPLSymbol): void => {
        const cls = enclosingClassName(decl);
        if (cls) {
            const owner = unitFind(cls).find(s => s.kind === GPLSymbolKind.Class && normalizePathKey(s.filePath) === normalizePathKey(decl.filePath));
            record(decl, owner ?? { ...decl, name: cls, line: decl.line }, decl);
        } else {
            record(decl, decl);
        }
    };

    const lines = text.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
        const code = GPLParser.stripToCode(lines[line]);
        if (!code.trim()) { continue; }
        const lk = receiverLookupAt(line, unitFind);
        for (const segs of scanChains(code)) {
            resolveFirst(segs[0].name, line, lk);
            for (let i = 1; i < segs.length; i++) {
                const holder = resolveReceiverHolder(segs.slice(0, i), lk);
                if (!holder) { break; }
                const owned = ownedByHolder(lk, holder, segs[i].name);
                const decl = owned.find(s => !isSelf(s.filePath));
                if (owned.length > 0 && !decl) { continue; } // 자기 파일의 멤버
                if (decl) { recordDecl(decl); }
            }
        }
    }

    function resolveFirst(name: string, line: number, lk: ReceiverLookup): void {
        if (isGplReservedWord(name) || ownNames.has(name.toLowerCase())) { return; }
        if (lk.findLocal(name)) { return; }
        const cands = unitFind(name);
        const cls = cands.find(s => s.kind === GPLSymbolKind.Class && visibleFromOtherModule(s));
        if (cls) { recordDecl(cls); return; }
        const here = containerAt(fileSymbols, line).module;
        const direct = cands.filter(s => enclosingClassName(s) === undefined && s.kind !== GPLSymbolKind.Module
            && enclosingModuleName(s) !== undefined
            && (visibleFromOtherModule(s) || (!!here && enclosingModuleName(s)!.toLowerCase() === here.toLowerCase())));
        const mods = new Set(direct.map(s => enclosingModuleName(s)!.toLowerCase()));
        if (mods.size === 1) { recordDecl(direct[0]); } // 여러 모듈에 같은 이름이면 확정할 수 없다(참조 찾기의 모호한 한정자 없는 사용과 같은 판정)
    }

    return Array.from(files.values()).map(f => ({
        filePath: f.filePath,
        fileName: path.basename(f.filePath),
        modules: Array.from(f.modules.values()).sort((a, b) => a.line - b.line).map(m => m.name),
        items: Array.from(f.items.values()).sort((a, b) => a.line - b.line).map(it => ({
            name: it.name,
            members: Array.from(it.members.values()).sort((a, b) => a.line - b.line).map(m => m.name),
        })),
    }));
}

/**
 * 의존 파일을 컴파일 순서(호출부가 준 `orderOf` — 보통 Project.gpr 의 ProjectSource 순서)로 늘어놓는다.
 * 순서를 모르는 파일은 뒤에 파일명 순으로 둔다.
 */
export function orderRequiredFiles(files: readonly RequiredFile[], orderOf: (filePath: string) => number | undefined): RequiredFile[] {
    const rank = (f: RequiredFile): number => orderOf(f.filePath) ?? Number.MAX_SAFE_INTEGER;
    return [...files].sort((a, b) => rank(a) - rank(b) || a.fileName.toLowerCase().localeCompare(b.fileName.toLowerCase()));
}
