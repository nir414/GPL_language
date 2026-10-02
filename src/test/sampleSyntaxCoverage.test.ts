import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { test } from './harness';
import { GPL_STATEMENT_SNIPPETS, GPL_KEYWORDS } from '../language/gplStatements';
import { GPLParser, GPLSymbolKind } from '../language/gplParser';

/**
 * `samples/syntax-tour` 가 GPL 문법 정본을 빠짐없이 쓰고 있는지 강제한다.
 *
 * 샘플의 목적은 "확장이 다루는 문법을 전부 실제 코드로 한 번씩 써 둔 대조 자료"다.
 * 사람이 관리하면 정본(`language/gplStatements.ts`)에 문이 늘어도 샘플은 그대로 남아
 * 조용히 낡는다 — 그래서 샘플 각 문의 첫 등장 줄 끝에 `' [syntax] <라벨>` 마커를 달고,
 * 이 테스트가 "정본의 라벨 집합 = 샘플의 마커 집합"을 양방향으로 검사한다.
 * 정본에 문을 추가하면 이 테스트가 먼저 깨지므로 샘플을 함께 고치게 된다.
 *
 * 마커를 **줄 끝 주석**으로 두는 것도 규약이다. 선언 바로 위에 두면 문서화 주석 블록에
 * 흡수되어 호버·자동완성에 마커가 그대로 노출된다(`gplParser`의 pendingDoc 규칙).
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLE_DIR = path.join(ROOT, 'samples', 'syntax-tour');
const MARKER_RE = /^\s*'\s*\[syntax\]\s*(.+?)\s*$/;

interface SampleFile {
    name: string;
    text: string;
}

function sampleFiles(): SampleFile[] {
    return fs.readdirSync(SAMPLE_DIR)
        .filter(n => n.toLowerCase().endsWith('.gpl'))
        .sort()
        .map(name => ({ name, text: fs.readFileSync(path.join(SAMPLE_DIR, name), 'utf8') }));
}

/** 줄 끝 `' [syntax] 라벨` 마커를 파일·줄 번호와 함께 모은다. */
function markers(): { label: string; file: string; line: number }[] {
    const out: { label: string; file: string; line: number }[] = [];
    for (const f of sampleFiles()) {
        f.text.split('\n').forEach((line, i) => {
            // 줄 끝 주석만 본다 — 코드가 앞에 있어야 마커다(설명용 주석 줄과 구분).
            const at = line.indexOf("'");
            if (at <= 0) { return; }
            const m = MARKER_RE.exec(line.slice(at));
            if (m) { out.push({ label: m[1], file: f.name, line: i + 1 }); }
        });
    }
    return out;
}

/** 주석을 떼어 낸 코드 본문만 이어 붙인다(주석의 한국어 설명이 낱말 검사에 걸리지 않도록). */
function codeOnly(): string {
    return sampleFiles()
        .map(f => f.text.split('\n').map(line => {
            const at = line.indexOf("'");
            return at < 0 ? line : line.slice(0, at);
        }).join('\n'))
        .join('\n');
}

test('sample: syntax-tour 가 정본의 문(statement)을 빠짐없이 쓴다', () => {
    const marked = new Set(markers().map(m => m.label));
    const missing = GPL_STATEMENT_SNIPPETS.map(s => s.label).filter(l => !marked.has(l));
    assert.deepStrictEqual(
        missing, [],
        `samples/syntax-tour 에 없는 문: ${missing.join(' / ')} — 코드를 추가하고 줄 끝에 "' [syntax] <라벨>" 마커를 단다`
    );
});

test('sample: 마커 라벨이 정본에 실제로 있는 라벨이다', () => {
    const known = new Set(GPL_STATEMENT_SNIPPETS.map(s => s.label));
    const unknown = markers().filter(m => !known.has(m.label));
    assert.deepStrictEqual(
        unknown.map(m => `${m.file}:${m.line} ${m.label}`), [],
        '정본에 없는 라벨의 마커 — 오타이거나 정본에서 없어진 문이다'
    );
});

test('sample: 같은 문의 마커가 두 번 달리지 않는다 (첫 등장 한 곳에만)', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const m of markers()) {
        const where = `${m.file}:${m.line}`;
        const prev = seen.get(m.label);
        if (prev) { dup.push(`${m.label} (${prev}, ${where})`); } else { seen.set(m.label, where); }
    }
    assert.deepStrictEqual(dup, [], '중복 마커');
});

test('sample: 원시 타입·낱말 연산자·상수 키워드를 모두 쓴다', () => {
    const code = codeOnly();
    // 스코프 수식어는 문 스니펫이 이미 커버하므로 타입/연산자/상수만 검사한다.
    const targets = GPL_KEYWORDS.filter(k => k.kind !== 'keyword');
    const missing = targets
        .filter(k => !new RegExp(`\\b${k.name}\\b`, 'i').test(code))
        .map(k => k.name);
    assert.deepStrictEqual(missing, [], `samples/syntax-tour 코드에 없는 키워드: ${missing.join(', ')}`);
});

test('sample: GPL 에 없는 VB 문법을 쓰지 않는다', () => {
    // 2026-09-18 공식 Statement Dictionary 디렉터리 열거로 부재 확인.
    // 예약어 목록(gplReservedWords)에는 보수적으로 들어 있지만 GPL 문법이 아니다.
    const code = codeOnly();
    const notGpl = ['Enum', 'Inherits', 'Implements', 'Wend', 'Structure'];
    const used = notGpl.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(code));
    assert.deepStrictEqual(used, [], `GPL 에 없는 문법이 샘플에 있다: ${used.join(', ')}`);
});

test('sample: Project.gpr 이 모든 .gpl 을 ProjectSource 로 등재한다', () => {
    const gpr = fs.readFileSync(path.join(SAMPLE_DIR, 'Project.gpr'), 'utf8');
    const listed = new Set(
        [...gpr.matchAll(/ProjectSource\s*=\s*"([^"]+)"/gi)].map(m => m[1].replace(/\\/g, '/').toLowerCase())
    );
    const missing = sampleFiles().map(f => f.name).filter(n => !listed.has(n.toLowerCase()));
    assert.deepStrictEqual(missing, [], `Project.gpr 에 빠진 소스: ${missing.join(', ')}`);
});

test('sample: 파서가 샘플의 선언을 모두 읽어 낸다', () => {
    const byKind = new Map<GPLSymbolKind, string[]>();
    for (const f of sampleFiles()) {
        for (const s of GPLParser.parseDocument(f.text, path.join(SAMPLE_DIR, f.name))) {
            const list = byKind.get(s.kind) ?? [];
            list.push(s.name);
            byKind.set(s.kind, list);
        }
    }
    const names = (k: GPLSymbolKind) => (byKind.get(k) ?? []).sort();

    assert.deepStrictEqual(names(GPLSymbolKind.Module), ['Declarations', 'Faults', 'Main', 'Shapes']);
    assert.deepStrictEqual(names(GPLSymbolKind.Class), ['Counter', 'Snapshot']);
    assert.deepStrictEqual(names(GPLSymbolKind.Delegate), ['BinaryOp', 'LogSink']);
    // 오버로드 3형제가 각각 별개 심볼로 잡혀야 문서 병합(§1-DR)을 샘플에서 확인할 수 있다.
    assert.strictEqual(
        (byKind.get(GPLSymbolKind.Function) ?? []).filter(n => n === 'Describe').length, 3,
        'Describe 오버로드 3개가 모두 심볼로 잡혀야 한다'
    );
    assert.ok(names(GPLSymbolKind.Property).includes('Count'), 'Property Count 를 읽지 못했다');
});
