import * as assert from 'assert';
import { test } from '../../harness';
import {
    buildReferenceSearchPlan,
    MAX_SCAN_LINE_LENGTH,
    planFileScan,
    planWorkspaceQueries,
    ReferenceScanSession,
    ReferenceSite,
} from '../../../language/analysis/referenceScan';
import { GPLParser } from '../../../language/syntax/gplParser';
import { resolveReferenceTargetSymbol } from '../../../language/analysis/referenceTarget';
import {
    findReferencesPure,
    makeSymbolIndex,
    receiverLookupFromText,
    SAMPLE_FILES,
} from './referenceFixture';

const UTIL = 'C:\\proj\\Util.gpl';
const PUMP = 'C:\\proj\\Pump.gpl';
const MAIN = 'C:\\proj\\Main.gpl';
const BOX = 'C:\\proj\\Box.gpl';

interface Expected { name: string; locations: string[]; logs: string[] }

/**
 * 고정 표본(SAMPLE_FILES) — 리팩터링 전 `GPLReferenceProvider`(providerHarness vm, 프로젝트 폴백 대역)를 실제로 돌려
 * 얻은 결과(위치 순서·로그 문구 포함)다. 순수 모듈 조립이 이를 그대로 재현해야 한다.
 */
const EXPECTED: Expected[] = [
    {
        name: "Util.Scale decl",
        locations: [
            "Util.gpl:1:16-21",
            "Util.gpl:5:18-23",
            "Main.gpl:6:5-10"
        ],
        logs: [
            "[References] word=\"Scale\" qualifier=N/A defScope=Util access=public file=Util.gpl kind=function line=2 precise=true",
            "[References]   hit Util.gpl:2",
            "[References]   hit Util.gpl:6",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Util.gpl, doc=C:\\proj\\Util.gpl",
            "[References]   exclude Pump.gpl:10 reason=other-module-decl",
            "[References]   hit Main.gpl:7",
            "[References]   exclude Main.gpl:12 reason=shadowed-by-local",
            "[References]   exclude Main.gpl:13 reason=shadowed-by-local",
            "[References]   exclude Main.gpl:13 reason=shadowed-by-local",
            "[References] fallback origin=project dir=C:\\proj scanned=2/3 hits=1 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=2, workspace=0, scopeFallback=1, scopeFallbackRan=true, total=3, excluded=4 (other-module-decl=1, shadowed-by-local=3)"
        ]
    },
    {
        name: "Util.Scale decl noDecl",
        locations: [
            "Util.gpl:5:18-23",
            "Main.gpl:6:5-10"
        ],
        logs: [
            "[References] word=\"Scale\" qualifier=N/A defScope=Util access=public file=Util.gpl kind=function line=2 precise=true",
            "[References]   hit Util.gpl:6",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Util.gpl, doc=C:\\proj\\Util.gpl",
            "[References]   exclude Pump.gpl:10 reason=other-module-decl",
            "[References]   hit Main.gpl:7",
            "[References]   exclude Main.gpl:12 reason=shadowed-by-local",
            "[References]   exclude Main.gpl:13 reason=shadowed-by-local",
            "[References]   exclude Main.gpl:13 reason=shadowed-by-local",
            "[References] fallback origin=project dir=C:\\proj scanned=2/3 hits=1 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=1, workspace=0, scopeFallback=1, scopeFallbackRan=true, total=2, excluded=4 (other-module-decl=1, shadowed-by-local=3)"
        ]
    },
    {
        name: "Pump.Start decl",
        locations: [
            "Pump.gpl:2:11-16",
            "Pump.gpl:5:0-5",
            "Pump.gpl:6:3-8",
            "Main.gpl:4:2-7",
            "Main.gpl:5:2-7"
        ],
        logs: [
            "[References] word=\"Start\" qualifier=N/A defScope=PumpMod.Pump access=public file=Pump.gpl kind=sub line=3 precise=true",
            "[References]   hit Pump.gpl:3",
            "[References]   hit Pump.gpl:6",
            "[References]   hit Pump.gpl:7",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Pump.gpl, doc=C:\\proj\\Pump.gpl",
            "[References]   hit Main.gpl:5",
            "[References]   hit Main.gpl:6",
            "[References] fallback origin=project dir=C:\\proj scanned=2/3 hits=2 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=3, workspace=0, scopeFallback=2, scopeFallbackRan=true, total=5, excluded=0"
        ]
    },
    {
        name: "Pump.Start via receiver q.Start()",
        locations: [
            "Main.gpl:4:2-7",
            "Main.gpl:5:2-7",
            "Pump.gpl:6:3-8",
            "Pump.gpl:2:11-16",
            "Pump.gpl:5:0-5"
        ],
        logs: [
            "[References] usage → sub Start @Pump.gpl:3 precise=true",
            "[References] word=\"Start\" qualifier=q defScope=PumpMod.Pump access=public file=Pump.gpl kind=sub line=3 precise=true",
            "[References]   hit Main.gpl:5",
            "[References]   hit Main.gpl:6",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Pump.gpl, doc=C:\\proj\\Main.gpl",
            "[References]   hit Pump.gpl:7",
            "[References]   hit Pump.gpl:3",
            "[References]   hit Pump.gpl:6",
            "[References] fallback origin=project dir=C:\\proj scanned=2/3 hits=3 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=2, workspace=0, scopeFallback=3, scopeFallbackRan=true, total=5, excluded=0"
        ]
    },
    {
        name: "Util.Scale via qualifier",
        locations: [
            "Main.gpl:6:5-10",
            "Util.gpl:1:16-21",
            "Util.gpl:5:18-23"
        ],
        logs: [
            "[References] usage → function Scale @Util.gpl:2 precise=true",
            "[References] word=\"Scale\" qualifier=Util defScope=Util access=public file=Util.gpl kind=function line=2 precise=true",
            "[References]   hit Main.gpl:7",
            "[References]   exclude Main.gpl:12 reason=shadowed-by-local",
            "[References]   exclude Main.gpl:13 reason=shadowed-by-local",
            "[References]   exclude Main.gpl:13 reason=shadowed-by-local",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Util.gpl, doc=C:\\proj\\Main.gpl",
            "[References]   hit Util.gpl:2",
            "[References]   hit Util.gpl:6",
            "[References]   exclude Pump.gpl:10 reason=other-module-decl",
            "[References] fallback origin=project dir=C:\\proj scanned=2/3 hits=2 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=1, workspace=0, scopeFallback=2, scopeFallbackRan=true, total=3, excluded=4 (shadowed-by-local=3, other-module-decl=1)"
        ]
    },
    {
        name: "local Scale",
        locations: [
            "Main.gpl:6:5-10",
            "Main.gpl:11:4-9",
            "Main.gpl:12:0-5",
            "Main.gpl:12:8-13",
            "Util.gpl:1:16-21",
            "Util.gpl:2:0-5",
            "Util.gpl:5:18-23",
            "Pump.gpl:9:11-16"
        ],
        logs: [
            "[References] word=\"Scale\" qualifier=N/A defScope=N/A access=N/A file=N/A",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Main.gpl, doc=C:\\proj\\Main.gpl",
            "[References] fallback origin=project dir=C:\\proj scanned=2/3 hits=4 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=4, workspace=0, scopeFallback=4, scopeFallbackRan=true, total=8"
        ]
    }
];
const EXPECTED_CTOR: Expected[] = [
    {
        name: "ctor decl",
        locations: [
            "Box.gpl:2:11-14",
            "Box.gpl:6:9-12"
        ],
        logs: [
            "[References] word=\"New\" qualifier=N/A defScope=M.Box access=public file=Box.gpl kind=sub line=3 precise=true",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Box.gpl, doc=C:\\proj\\Box.gpl",
            "[References] fallback origin=project dir=C:\\proj scanned=0/1 hits=0 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=1, workspace=0, scopeFallback=0, scopeFallbackRan=true, total=2"
        ]
    },
    {
        name: "ctor decl noDecl",
        locations: [
            "Box.gpl:6:9-12"
        ],
        logs: [
            "[References] word=\"New\" qualifier=N/A defScope=M.Box access=public file=Box.gpl kind=sub line=3 precise=true",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Box.gpl, doc=C:\\proj\\Box.gpl",
            "[References] fallback origin=project dir=C:\\proj scanned=0/1 hits=0 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=1, workspace=0, scopeFallback=0, scopeFallbackRan=true, total=1"
        ]
    },
    {
        name: "ctor use",
        locations: [
            "Box.gpl:2:11-14",
            "Box.gpl:6:9-12"
        ],
        logs: [
            "[References] word=\"New\" qualifier=N/A defScope=M.Box access=public file=Box.gpl kind=sub line=3 precise=false",
            "[References] workspaceCheck: targetInWorkspace=false, docInWorkspace=false, hasNonDocumentLocations=false, target=C:\\proj\\Box.gpl, doc=C:\\proj\\Box.gpl",
            "[References] fallback origin=project dir=C:\\proj scanned=0/1 hits=0 unreadable=0 elapsed=Xms truncated=false",
            "[References] results: local=1, workspace=0, scopeFallback=0, scopeFallbackRan=true, total=2"
        ]
    }
];

const find = (list: Expected[], name: string): Expected => list.find(e => e.name === name)!;

/** `marker` 첫 글자에서 `offset` 만큼 들어간 위치. */
const charOf = (files: Record<string, string>, file: string, line: number, marker: string, offset = 1): number =>
    files[file].split('\n')[line].indexOf(marker) + offset;

const QUERIES: Array<[string, string, number, string, boolean]> = [
    ['Util.Scale decl', UTIL, 1, 'Scale', true],
    ['Util.Scale decl noDecl', UTIL, 1, 'Scale', false],
    ['Pump.Start decl', PUMP, 2, 'Start', true],
    ['Pump.Start via receiver q.Start()', MAIN, 5, 'Start', true],
    ['Util.Scale via qualifier', MAIN, 6, 'Scale', true],
    ['local Scale', MAIN, 12, 'Scale', true],
];

for (const [name, file, line, marker, includeDeclaration] of QUERIES) {
    test(`참조 스캔(고정 표본): ${name} — 원본 provider 와 위치·순서·로그가 같다`, () => {
        const got = findReferencesPure(SAMPLE_FILES, file, line, charOf(SAMPLE_FILES, file, line, marker), includeDeclaration);
        const want = find(EXPECTED, name);
        assert.deepStrictEqual(got.locations, want.locations);
        assert.deepStrictEqual(got.logs, want.logs);
    });
}

const CTOR_FILES: Record<string, string> = {
    [BOX]: [
        'Module M',
        'Public Class Box',
        'Public Sub New()',
        'End Sub',
        'End Class',
        'Public Sub T()',
        'Dim b As New Box()',
        'End Sub',
        'End Module',
    ].join('\n'),
};

for (const [name, line, includeDeclaration] of [
    ['ctor decl', 2, true], ['ctor decl noDecl', 2, false], ['ctor use', 6, true],
] as Array<[string, number, boolean]>) {
    test(`참조 스캔(생성자 표본): ${name} — 원본 provider 와 같다`, () => {
        const got = findReferencesPure(CTOR_FILES, BOX, line, charOf(CTOR_FILES, BOX, line, 'New'), includeDeclaration);
        const want = find(EXPECTED_CTOR, name);
        assert.deepStrictEqual(got.locations, want.locations);
        assert.deepStrictEqual(got.logs, want.logs);
    });
}

test('참조 스캔(고정 표본): 주석·일반 문자열 출현은 어떤 질의에서도 빠지고 로컬 `Scale` 은 모듈 함수 참조가 아니다', () => {
    for (const [name, file, line, marker, incl] of QUERIES) {
        const got = findReferencesPure(SAMPLE_FILES, file, line, charOf(SAMPLE_FILES, file, line, marker), incl);
        // Util 6(주석)·7(문자열 "Scale text")·Main 7("p.Start")·8(주석) 은 한 번도 나오지 않는다.
        for (const excluded of ['Util.gpl:6:', 'Util.gpl:7:', 'Main.gpl:7:', 'Main.gpl:8:']) {
            assert.ok(!got.locations.some(l => l.startsWith(excluded)), `${name}: ${excluded} 이 섞였다`);
        }
    }
    const scale = findReferencesPure(SAMPLE_FILES, UTIL, 1, charOf(SAMPLE_FILES, UTIL, 1, 'Scale'), true).locations;
    assert.ok(!scale.some(l => l.startsWith('Main.gpl:11:') || l.startsWith('Main.gpl:12:')), '로컬 Scale 이 섞였다');
    assert.ok(!scale.some(l => l.startsWith('Pump.gpl:9:')), '다른 모듈의 동명 선언이 섞였다');
});

// ── 계획·단계 ────────────────────────────────────────────────────────────────────────────

function planFor(files: Record<string, string>, file: string, line: number, marker: string, word: string, qualifier?: string) {
    const symbols = makeSymbolIndex(files);
    const text = files[file];
    const lineText = text.split('\n')[line];
    const wordStart = lineText.indexOf(marker);
    const lines = text.split('\n');
    const { defSymbol, defPrecise } = resolveReferenceTargetSymbol(symbols, {
        word, qualifier, documentText: text, documentFsPath: file, line, lineText,
        wordStart, wordEnd: wordStart + word.length,
    }, () => {
        const docSymbols = GPLParser.parseDocument(
            text, file, { includeLocals: true, includeParameters: true });
        return { docSymbols, lookup: receiverLookupFromText(lines, file, line, n => symbols.findAllByName(n), docSymbols) };
    }, () => undefined);
    return { symbols, plan: buildReferenceSearchPlan(symbols, { word, qualifier, defSymbol, defPrecise, documentText: text, documentFsPath: file }) };
}

test('검색 계획: 모듈 함수(Util.Scale) — 모듈 한정 + 한정자 없는 전역 이름 검색, 출현 판정 대상 확정', () => {
    const { plan } = planFor(SAMPLE_FILES, UTIL, 1, 'Scale', 'Scale');
    assert.strictEqual(plan.targetModule, 'Util');
    assert.strictEqual(plan.targetClass, undefined);
    assert.strictEqual(plan.targetFilePath, UTIL);
    assert.strictEqual(plan.shouldRestrictUnqualifiedToDefFile, false);
    assert.strictEqual(plan.shouldAlsoSearchModuleQualified, true);
    assert.strictEqual(plan.isCallableTarget, true);
    assert.ok(plan.scopeTarget, 'scopeTarget');
    assert.strictEqual(plan.overloadFilterOn, false);
    assert.deepStrictEqual(planFileScan(plan, 'local', true), [
        { pattern: '\\bUtil\\s*\\.\\s*Scale\\b' },
        { pattern: '\\bScale\\b', unqualifiedOnly: false },
    ]);
    assert.deepStrictEqual(planFileScan(plan, 'fallback', false), [
        { pattern: '\\bUtil\\s*\\.\\s*Scale\\b' },
        { pattern: '\\bScale\\b', unqualifiedOnly: false },
    ]);
    assert.deepStrictEqual(planWorkspaceQueries(plan), planFileScan(plan, 'fallback', false));
});

const ANY_QUALIFIER = '\\b\\w+(?:\\s*\\([^\\r\\n()]*\\))*(?:\\s*\\.\\s*\\b\\w+(?:\\s*\\([^\\r\\n()]*\\))*)*\\s*\\.\\s*Start\\b';

test('검색 계획: 클래스 멤버(Pump.Start) — 단계 순서가 local 과 fallback 에서 다르다(결과 순서가 달라진다)', () => {
    const { plan } = planFor(SAMPLE_FILES, PUMP, 2, 'Start', 'Start');
    assert.strictEqual(plan.targetClass, 'Pump');
    assert.strictEqual(plan.isClassMember, true);
    assert.strictEqual(plan.shouldRestrictUnqualifiedToDefFile, true);
    const classQualified = { pattern: '\\bPump\\s*\\.\\s*Start\\b' };
    const unqualifiedInDefFile = { pattern: '\\bStart\\b', unqualifiedOnly: true };
    const anyQualifier = { pattern: ANY_QUALIFIER };
    assert.deepStrictEqual(planFileScan(plan, 'local', true), [classQualified, unqualifiedInDefFile, anyQualifier]);
    assert.deepStrictEqual(planFileScan(plan, 'local', false), [classQualified, anyQualifier]);
    assert.deepStrictEqual(planFileScan(plan, 'fallback', true), [classQualified, anyQualifier, unqualifiedInDefFile]);
    assert.deepStrictEqual(planFileScan(plan, 'fallback', false), [classQualified, anyQualifier]);
    assert.deepStrictEqual(planWorkspaceQueries(plan), [classQualified, anyQualifier, unqualifiedInDefFile]);
});

test('검색 계획: 정의를 못 정한 이름(로컬 Scale) — 이름 전역 검색 하나, 출현 판정 없음', () => {
    const { plan } = planFor(SAMPLE_FILES, MAIN, 12, 'Scale', 'Scale');
    assert.strictEqual(plan.defSymbol, undefined);
    assert.strictEqual(plan.scopeTarget, undefined);
    assert.deepStrictEqual(planFileScan(plan, 'local', false), [{ pattern: '\\bScale\\b', unqualifiedOnly: false }]);
    assert.deepStrictEqual(planWorkspaceQueries(plan), [{ pattern: '\\bScale\\b', unqualifiedOnly: false }]);
});

test('검색 계획: 생성자 대상은 `New 클래스` 전용 패턴 하나만 모든 경로가 쓴다', () => {
    const { plan } = planFor(CTOR_FILES, BOX, 2, 'New', 'New');
    assert.strictEqual(plan.isConstructorTarget, true);
    assert.strictEqual(plan.constructorPattern, '\\bNew\\s+Box\\b');
    const only = [{ pattern: '\\bNew\\s+Box\\b' }];
    assert.deepStrictEqual(planFileScan(plan, 'local', true), only);
    assert.deepStrictEqual(planFileScan(plan, 'fallback', true), only);
    assert.deepStrictEqual(planWorkspaceQueries(plan), only);
});

// ── 세션 ─────────────────────────────────────────────────────────────────────────────────

function sessionFor(files: Record<string, string>, file: string, line: number, marker: string, word: string, opts: { includeDeclaration?: boolean; isCancelled?: () => boolean } = {}) {
    const { symbols, plan } = planFor(files, file, line, marker, word);
    const logs: string[] = [];
    const session = new ReferenceScanSession(plan, {
        symbols,
        includeDeclaration: opts.includeDeclaration ?? true,
        documentFsPath: file,
        receiverLookupFromText: (lines, fsPath, ln, findAllByName, docSymbols) =>
            receiverLookupFromText(lines, fsPath, ln, findAllByName, docSymbols),
        log: m => logs.push(m),
        isCancelled: opts.isCancelled ?? (() => false),
    });
    return { session, plan, logs };
}

const siteAt = (fsPath: string, line: number, start: number, end: number): ReferenceSite =>
    ({ uriKey: `file:///${fsPath}`, fsPath, startLine: line, startCharacter: start, endLine: line, endCharacter: end });

test('참조 세션: addSite 는 같은 좌표를 한 번만 올리고 hasNonDocumentSites 는 문서 밖 경로만 센다', () => {
    const { session } = sessionFor(SAMPLE_FILES, UTIL, 1, 'Scale', 'Scale');
    assert.strictEqual(session.addSite(siteAt(UTIL, 1, 16, 21)), true);
    assert.strictEqual(session.addSite(siteAt(UTIL, 1, 16, 21)), false);
    assert.strictEqual(session.hasNonDocumentSites(), false);
    assert.strictEqual(session.addSite(siteAt(MAIN, 6, 5, 10)), true);
    assert.strictEqual(session.hasNonDocumentSites(), true);
    assert.strictEqual(session.sites.length, 2);
});

test('참조 세션: inCompileUnit 은 정의 파일이거나 같은 컴파일 단위일 때만 true', () => {
    const { session } = sessionFor(SAMPLE_FILES, UTIL, 1, 'Scale', 'Scale');
    assert.strictEqual(session.inCompileUnit(UTIL), true);
    assert.strictEqual(session.inCompileUnit('C:\\other\\Elsewhere.gpl'), true); // 표본 색인은 모든 파일이 한 단위
});

test('참조 세션: constructorDeclarationRange 는 생성자 대상 + includeDeclaration 일 때만', () => {
    const decl = sessionFor(CTOR_FILES, BOX, 2, 'New', 'New').session.constructorDeclarationRange();
    assert.deepStrictEqual(decl, { fsPath: BOX, line: 2, start: 11, end: 14 });
    assert.strictEqual(sessionFor(CTOR_FILES, BOX, 2, 'New', 'New', { includeDeclaration: false }).session.constructorDeclarationRange(), undefined);
    assert.strictEqual(sessionFor(SAMPLE_FILES, UTIL, 1, 'Scale', 'Scale').session.constructorDeclarationRange(), undefined);
});

test('참조 스캔: CR 단독·CRLF·LF 가 섞인 텍스트도 줄 번호와 열을 지킨다', () => {
    const { session } = sessionFor(SAMPLE_FILES, MAIN, 12, 'Scale', 'Scale');
    const text = 'x = Scale\r\n  Scale\ry = Scale\nScale';
    const hits = session.scanSourceText(
        { fsPath: MAIN, uriKey: 'k', text }, /\bScale\b/gi, { unqualifiedOnly: false });
    assert.strictEqual(hits, 4);
    assert.deepStrictEqual(session.sites.map(s => `${s.startLine}:${s.startCharacter}`), ['0:4', '1:2', '2:4', '3:0']);
});

test('참조 스캔: 한 줄이 상한을 넘으면 건너뛰고, 취소되면 줄 단위로 멈춘다', () => {
    const long = 'Scale ' + 'x'.repeat(MAX_SCAN_LINE_LENGTH);
    const a = sessionFor(SAMPLE_FILES, MAIN, 12, 'Scale', 'Scale').session;
    assert.strictEqual(a.scanSourceText({ fsPath: MAIN, uriKey: 'k', text: `${long}\nScale` }, /\bScale\b/gi, {}), 1);
    assert.deepStrictEqual(a.sites.map(s => s.startLine), [1]);

    let calls = 0;
    const b = sessionFor(SAMPLE_FILES, MAIN, 12, 'Scale', 'Scale', { isCancelled: () => ++calls > 1 }).session;
    assert.strictEqual(b.scanSourceText({ fsPath: MAIN, uriKey: 'k', text: 'Scale\nScale\nScale' }, /\bScale\b/gi, {}), 1);
});

test('참조 스캔: unqualifiedOnly 는 점 앞에 붙은 출현을 뺀다', () => {
    const { session } = sessionFor(SAMPLE_FILES, MAIN, 12, 'Scale', 'Scale');
    const text = 'a.Scale()\nScale()\nb . Scale()';
    assert.strictEqual(session.scanSourceText({ fsPath: MAIN, uriKey: 'k', text }, /\bScale\b/gi, { unqualifiedOnly: true }), 1);
    assert.deepStrictEqual(session.sites.map(s => s.startLine), [1]);
});

test('참조 스캔: 함수 본문의 반환값 대입(`Scale = v * 2`)은 정의 파일에서만 참조가 아니다', () => {
    const { session } = sessionFor(SAMPLE_FILES, UTIL, 1, 'Scale', 'Scale');
    const inDef = session.scanSourceText({ fsPath: UTIL, uriKey: 'u', text: SAMPLE_FILES[UTIL] }, /\bScale\b/gi, {});
    assert.ok(!session.sites.some(s => s.fsPath === UTIL && s.startLine === 2), '반환값 대입은 참조가 아니다');
    assert.ok(inDef >= 1);
    // 다른 파일의 같은 모양은 판정 대상(출현 판정)으로 넘어간다 — 여기서는 모듈 밖이라 걸러진다.
    const outside = session.scanSourceText({ fsPath: PUMP, uriKey: 'p', text: 'Scale = 1' }, /\bScale\b/gi, {});
    assert.strictEqual(outside, 0);
});
