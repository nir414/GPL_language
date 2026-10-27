/**
 * 모듈 머리 주석의 `'Requires:` 블록 — 읽기·쓰기·갱신 계획(vscode 무의존 순수 모듈).
 *
 * 형식(사용자 저장소에서 쓰던 그대로):
 *
 *     'Requires:
 *     ' - MotionSystem.gpl (Module MSY): MotionSystem(OpenLines, Shutdown), SetHomePosition
 *     ' - Logger.gpl       (Module LOG): Write, WriteEx
 *
 * - 블록은 **확장이 통째로 관리한다.** 항목은 `moduleDependencies.collectRequiredFiles` 의 계산 결과이고,
 *   `(Module …)` 열은 블록 안 가장 긴 파일명에 맞춘다. 의존이 없으면 `' - (none)` 한 줄.
 * - 사람이 단 설명(`Setup(모터 + 스테이션)` 처럼 괄호 안이 멤버 이름 목록이 아닌 것, 형식에 맞지 않는 줄,
 *   들여쓴 이어쓰기 줄)은 갱신할 때 `'Notes:` 블록으로 **옮긴다** — 지우지 않는다. `'Notes:` 는 사람 몫이라
 *   확장이 옮겨 붙이는 것 말고는 손대지 않는다.
 * - `'Requires:` 가 없는 파일은 갱신 대상이 아니다(파일마다 옵트인). 새로 넣는 것은 `planRequiresInsertion`.
 * - `'Used by:` 는 프로젝트마다 달라지는 정보라 다루지 않는다(2026-10-27 결정 — 있으면 그대로 둔다).
 *
 * 단위 테스트: src/test/language/documentation/requiresHeader.test.ts
 */
import type { RequiredFile } from '../analysis/moduleDependencies';

/** 줄 범위 [startLine, endLine) 를 `lines` 로 바꾼다(endLine === startLine 이면 삽입). */
export interface LineEdit {
    startLine: number;
    endLine: number;
    lines: string[];
}

export interface RequiresHeaderPlan {
    /** `'Requires:` 줄(0-기준) — 진단 위치 */
    headerLine: number;
    /** 블록이 계산 결과와 다르거나 옮길 메모가 있다 */
    changed: boolean;
    edits: LineEdit[];
    /** 새로 생긴 의존 파일 */
    added: string[];
    /** 없어진 의존 파일 */
    removed: string[];
    /** 쓰는 선언 목록이 바뀐 파일 */
    modified: string[];
    /** `'Notes:` 로 옮기는 메모 줄 수 */
    notesMoved: number;
}

const HEADER = /^(\s*)'\s*Requires\s*:\s*$/i;
const NOTES_HEADER = /^(\s*)'\s*Notes\s*:\s*$/i;
const ENTRY = /^\s*'\s?-\s+(.*?)\s*$/;
const CONTINUATION = /^\s*'\s{2,}\S/;
const ENTRY_BODY = /^([^\s():]+\.\w+)\s*(?:\(\s*Module\s+([^)]*)\))?\s*:\s*(.*)$/i;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NONE = '(none)';

interface ParsedEntry {
    fileName: string;
    /** 멤버 목록으로 읽힌 항목(이름 → 멤버) */
    items: Map<string, string[]>;
}

interface ParsedBlock {
    headerLine: number;
    indent: string;
    /** 블록 끝(배타) */
    endLine: number;
    entries: ParsedEntry[];
    notes: string[];
}

/** `'Requires:` 블록을 찾는다. 첫 번째 것만 다룬다. */
export function findRequiresBlock(lines: readonly string[]): { headerLine: number; endLine: number } | undefined {
    const b = parseBlock(lines);
    return b && { headerLine: b.headerLine, endLine: b.endLine };
}

function parseBlock(lines: readonly string[]): ParsedBlock | undefined {
    const headerLine = lines.findIndex(l => HEADER.test(l));
    if (headerLine < 0) { return undefined; }
    const indent = HEADER.exec(lines[headerLine])![1];
    const entries: ParsedEntry[] = [];
    const notes: string[] = [];
    let end = headerLine + 1;
    let lastEntry: { raw: string; noted: boolean } | undefined;
    for (; end < lines.length; end++) {
        const line = lines[end];
        const m = ENTRY.exec(line);
        if (m) {
            const body = m[1];
            lastEntry = { raw: body, noted: false };
            if (body === NONE) { continue; }
            const parsed = parseEntryBody(body);
            if (!parsed) { notes.push(body); lastEntry.noted = true; continue; }
            entries.push(parsed.entry);
            if (parsed.notes.length > 0) {
                notes.push(`${parsed.entry.fileName}: ${parsed.notes.join(', ')}`);
                lastEntry.noted = true;
            }
            continue;
        }
        if (CONTINUATION.test(line) && lastEntry) {
            // 들여쓴 이어쓰기는 사람이 단 설명이다 — 앞 항목에 붙여 메모로 옮긴다.
            const text = line.replace(/^\s*'\s*/, '');
            if (lastEntry.noted) { notes[notes.length - 1] += ` ${text}`; } else { notes.push(`${lastEntry.raw} ${text}`); lastEntry.noted = true; }
            continue;
        }
        break;
    }
    return { headerLine, indent, endLine: end, entries, notes };
}

/** `File.gpl (Module X): A, B(m1, m2), C.D` — 멤버 목록으로 읽히지 않는 항목은 메모로 돌려준다. */
function parseEntryBody(body: string): { entry: ParsedEntry; notes: string[] } | undefined {
    const m = ENTRY_BODY.exec(body);
    if (!m) { return undefined; }
    const items = new Map<string, string[]>();
    const notes: string[] = [];
    const add = (name: string, members: string[]): void => {
        const key = name.toLowerCase();
        const cur = items.get(key) ?? [];
        for (const mem of members) { if (!cur.some(c => c.toLowerCase() === mem.toLowerCase())) { cur.push(mem); } }
        items.set(key, cur);
    };
    for (const raw of splitTopLevel(m[3])) {
        const item = raw.trim();
        if (!item) { continue; }
        const dotted = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(item);
        const call = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(item);
        if (IDENT.test(item)) {
            add(item, []);
        } else if (dotted) {
            add(dotted[1], [dotted[2]]);
        } else if (call && splitTopLevel(call[2]).every(x => IDENT.test(x.trim()))) {
            add(call[1], splitTopLevel(call[2]).map(x => x.trim()));
        } else {
            notes.push(item);
        }
    }
    return { entry: { fileName: m[1], items }, notes };
}

function splitTopLevel(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of text) {
        if (ch === '(') { depth++; } else if (ch === ')') { depth = Math.max(0, depth - 1); }
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim() || out.length > 0) { out.push(cur); }
    return out;
}

const renderItem = (name: string, members: readonly string[]): string =>
    members.length > 0 ? `${name}(${members.join(', ')})` : name;

/** 계산 결과를 블록 본문 줄(머리 줄 제외)로 그린다. */
export function renderRequiresEntries(files: readonly RequiredFile[], indent = ''): string[] {
    if (files.length === 0) { return [`${indent}' - ${NONE}`]; }
    const width = Math.max(...files.map(f => f.fileName.length));
    return files.map(f => {
        const mod = f.modules.length > 0 ? ` (Module ${f.modules.join(', ')})` : '';
        const name = mod ? f.fileName.padEnd(width) : f.fileName;
        return `${indent}' - ${name}${mod}: ${f.items.map(i => renderItem(i.name, i.members)).join(', ')}`;
    });
}

function itemSignature(items: Map<string, string[]> | readonly { name: string; members: readonly string[] }[]): string {
    const pairs = items instanceof Map
        ? Array.from(items.entries()).map(([k, v]) => [k, v.map(x => x.toLowerCase()).sort().join(',')])
        : items.map(i => [i.name.toLowerCase(), i.members.map(x => x.toLowerCase()).sort().join(',')]);
    return pairs.map(p => `${p[0]}(${p[1]})`).sort().join(';');
}

/**
 * 기존 블록을 계산 결과로 바꾸는 계획. `'Requires:` 가 없으면 undefined(갱신 대상 아님).
 * 같은 파일이 여러 줄로 나뉘어 있으면 하나로 합쳐 비교한다.
 */
export function planRequiresHeader(lines: readonly string[], files: readonly RequiredFile[]): RequiresHeaderPlan | undefined {
    const block = parseBlock(lines);
    if (!block) { return undefined; }

    const rendered = renderRequiresEntries(files, block.indent);
    const current = lines.slice(block.headerLine + 1, block.endLine).map(l => l.trimEnd());
    const sameText = current.length === rendered.length && current.every((l, i) => l === rendered[i]);

    const existing = new Map<string, Map<string, string[]>>();
    const displayName = new Map<string, string>();
    for (const e of block.entries) {
        const key = e.fileName.toLowerCase();
        displayName.set(key, e.fileName);
        const merged = existing.get(key) ?? new Map<string, string[]>();
        for (const [k, v] of e.items) {
            const cur = merged.get(k) ?? [];
            for (const mem of v) { if (!cur.some(c => c.toLowerCase() === mem.toLowerCase())) { cur.push(mem); } }
            merged.set(k, cur);
        }
        existing.set(key, merged);
    }
    const computed = new Map(files.map(f => [f.fileName.toLowerCase(), f]));
    const added = files.filter(f => !existing.has(f.fileName.toLowerCase())).map(f => f.fileName);
    const removed = Array.from(existing.keys()).filter(k => !computed.has(k)).map(k => displayName.get(k)!);
    const modified = files
        .filter(f => existing.has(f.fileName.toLowerCase())
            && itemSignature(existing.get(f.fileName.toLowerCase())!) !== itemSignature(f.items))
        .map(f => f.fileName);

    // 메모는 표기를 바꿔야만 생긴다(블록 안의 설명을 빼내므로) — 그래서 메모가 있으면 블록 편집도 항상 있다.
    const edits: LineEdit[] = [];
    const notes = block.notes;
    if (!sameText || notes.length > 0) {
        const notesEdit = notes.length > 0 ? planNotes(lines, block, notes) : undefined;
        // 새 Notes 블록은 Requires 바로 뒤라 한 편집으로 합친다(맞닿은 두 편집을 VS Code 가 겹침으로 거부하지 않게).
        const inline = notesEdit && notesEdit.startLine === block.endLine;
        edits.push({ startLine: block.headerLine + 1, endLine: block.endLine, lines: inline ? [...rendered, ...notesEdit.lines] : rendered });
        if (notesEdit && !inline && notesEdit.lines.length > 0) { edits.push(notesEdit); }
    }
    return {
        headerLine: block.headerLine,
        changed: edits.length > 0,
        edits,
        added, removed, modified,
        notesMoved: notes.length,
    };
}

/** 메모를 기존 `'Notes:` 블록 끝에 붙이거나(이미 있는 줄은 건너뛴다), 없으면 Requires 블록 바로 뒤에 새로 만든다. */
function planNotes(lines: readonly string[], block: ParsedBlock, notes: readonly string[]): LineEdit {
    const notesHeader = lines.findIndex(l => NOTES_HEADER.test(l));
    if (notesHeader < 0) {
        return {
            startLine: block.endLine,
            endLine: block.endLine,
            lines: [`${block.indent}'Notes:`, ...notes.map(n => `${block.indent}' - ${n}`)],
        };
    }
    const indent = NOTES_HEADER.exec(lines[notesHeader])![1];
    let end = notesHeader + 1;
    while (end < lines.length && (ENTRY.test(lines[end]) || CONTINUATION.test(lines[end]))) { end++; }
    const have = new Set(lines.slice(notesHeader + 1, end).map(l => (ENTRY.exec(l)?.[1] ?? '').trim()));
    const fresh = notes.filter(n => !have.has(n.trim()));
    return { startLine: end, endLine: end, lines: fresh.map(n => `${indent}' - ${n}`) };
}

/**
 * `'Requires:` 가 없는 파일에 블록을 넣는 계획 — 첫 `Module` 줄 바로 위(모듈 머리 주석의 끝)에 넣는다.
 * 이미 블록이 있거나 Module 선언이 없으면 undefined.
 */
export function planRequiresInsertion(lines: readonly string[], files: readonly RequiredFile[]): LineEdit | undefined {
    if (findRequiresBlock(lines)) { return undefined; }
    const moduleLine = lines.findIndex(l => /^\s*Module\s+[A-Za-z_]/i.test(l));
    if (moduleLine < 0) { return undefined; }
    return { startLine: moduleLine, endLine: moduleLine, lines: ["'Requires:", ...renderRequiresEntries(files)] };
}

/** 진단·알림용 한 줄 요약. */
export function describeRequiresPlan(plan: RequiresHeaderPlan): string {
    const parts: string[] = [];
    const list = (xs: readonly string[]): string => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` 외 ${xs.length - 3}` : '');
    if (plan.added.length > 0) { parts.push(`추가 ${plan.added.length} (${list(plan.added)})`); }
    if (plan.removed.length > 0) { parts.push(`제거 ${plan.removed.length} (${list(plan.removed)})`); }
    if (plan.modified.length > 0) { parts.push(`항목 변경 ${plan.modified.length} (${list(plan.modified)})`); }
    if (plan.notesMoved > 0) { parts.push(`메모 ${plan.notesMoved}줄 → 'Notes:`); }
    return parts.length > 0 ? parts.join(' · ') : '정렬·표기만 다름';
}
