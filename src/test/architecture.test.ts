import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { test } from './harness';

/**
 * 구조 회귀 테스트(architecture fitness) — 소스 트리를 읽어 계층 규칙을 검사한다.
 *
 * 왜 테스트로 두는가: 계층 규칙(무엇이 vscode 를 import 해도 되는지, 어느 폴더가 어느 폴더를 의존해도 되는지)은
 * 문서(docs/development/architecture.md)에만 적어 두면 다음 변경에서 조용히 무너진다. 여기서 실패하면
 * ① 코드를 규칙에 맞추거나 ② 규칙을 바꾸되 architecture.md 에 이유를 함께 적는다 — 둘 중 하나를 **의식적으로** 고르게 하는 것이 목적.
 *
 * 검사 항목:
 *  R1 vscode 의존 허용 목록 — activation/·providers/·language/vscode/ 밖에서 vscode 를 import 하는 모듈은 명시 목록과 정확히 일치해야 한다.
 *  R2 계층 의존 방향 — 폴더(계층)별로 import 해도 되는 계층만 허용한다(같은 계층은 항상 허용).
 *  R3 런타임 import 순환 없음 — `import type` 은 지워지므로 제외.
 *  R4 테스트 등록 누락 없음 — src/test/ 아래 모든 *.test.ts 는 index.ts 가 import 한다(수동 등록이라 잊기 쉽다).
 *  R5 package.json ↔ 코드 — 선언된 명령·메뉴/키바인딩/활성화 이벤트가 가리키는 명령은 소스에서 등록돼 있어야 한다.
 *  R6 설정 키 — 코드가 읽는 `gpl.*` 설정 키는 package.json 에 선언돼 있어야 한다(오타 방지).
 *  R7 판정 정본(SSOT) 우회 금지 — "이 판단은 여기서만 한다"고 정한 규칙을 다른 모듈이 손으로 다시 구현하지 않는다.
 *  R9 기능 분류(area) — 계층 폴더의 파일은 책임에 맞는 하위 폴더에 두고 계층 루트에 다시 쌓지 않는다. test/ 는 src 폴더를 거울처럼 따른다.
 *  R10 크기 상한 — 1,000줄 넘는 파일·150줄 넘는 이름 있는 함수는 SIZE_DEBT 목록과 architecture.md §7 에 올라 있어야 한다(내려가면 지운다).
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

type Layer =
    | 'util' | 'language' | 'project' | 'log' | 'controller' | 'debug' | 'views' | 'providers' | 'activation'
    | 'config' | 'languageVscode' | 'extension' | 'test';

/** 계층별로 import 해도 되는 다른 계층(같은 계층은 항상 허용). 근거는 docs/development/architecture.md §계층 규칙. */
const ALLOWED_DEPENDENCIES: Record<Layer, readonly Layer[]> = {
    util: [],
    language: ['util'],
    log: [],
    project: ['language', 'util'],
    config: ['language'],
    controller: ['project', 'util', 'log'],
    languageVscode: ['language', 'project', 'util', 'config'],
    debug: ['controller', 'project', 'language', 'util'],
    views: ['controller', 'util', 'config'],
    providers: ['language', 'project', 'util', 'config', 'languageVscode'],
    activation: ['controller', 'project', 'language', 'util', 'log', 'views', 'providers', 'debug', 'config', 'languageVscode'],
    extension: ['controller', 'project', 'language', 'util', 'log', 'views', 'providers', 'debug', 'config', 'languageVscode', 'activation'],
    test: ['util', 'language', 'log', 'project', 'config', 'controller', 'languageVscode', 'debug', 'views', 'providers', 'activation'],
};

/** activation/·providers/·language/vscode/ 는 VS Code 접착 계층이라 전부 vscode 를 써도 된다. 그 밖은 여기 있는 모듈만. */
const ALWAYS_VSCODE_LAYERS: ReadonlySet<Layer> = new Set<Layer>(['activation', 'providers', 'languageVscode']);
const VSCODE_ALLOWED_MODULES: ReadonlySet<string> = new Set([
    // 루트
    'extension', 'config',
    // controller — 전송/UI 접착. 나머지 controller/ 모듈은 순수(Node 단독 테스트 대상)
    'controller/debugging/breakpointMirror', 'controller/debugging/breakpointSync', 'controller/connection/controllerConnection', 'controller/debugging/debugBridge',
    'controller/deployment/deployRecord', 'controller/deployment/deployService', 'controller/projects/gprSyncCommand', 'controller/projects/projectPicker',
    'controller/runtime/runtimeConsole',
    // debug — DAP 세션과 구성 provider
    'debug/session/activateDebug', 'debug/session/gplDebugSession', 'debug/session/attachPreflight',
    // project — 워크스페이스 검색·명령 래퍼
    'project/sources/projectFileScope', 'project/gpr/promoteSourceCommand',
    // views
    'views/statusbar/connectionStatusBar', 'views/dashboard/controllerDashboardPanel', 'views/tree/controllerTreeProvider', 'views/tree/treeItems',
    // 단일 파일 계층
    'controller/automation/exportAgentSetup', 'log/liveLogTerminal',
]);

interface ImportEdge { from: string; to: string; typeOnly: boolean; spec: string }

function walk(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, acc); } else if (p.endsWith('.ts')) { acc.push(p); }
    }
    return acc;
}

const posix = (p: string): string => p.split(path.sep).join('/');
/** src 기준 모듈 이름(확장자 없음): `controller/deployment/deployService`, 루트는 `config`. */
const moduleOf = (abs: string): string => posix(path.relative(SRC, abs)).replace(/\.ts$/, '');
const layerOf = (mod: string): Layer => mod.startsWith('language/vscode/')
    ? 'languageVscode'
    : (mod.includes('/') ? mod.slice(0, mod.indexOf('/')) : mod) as Layer;

const files = walk(SRC);
const modules = new Set(files.map(moduleOf));
const sources = new Map(files.map(f => [moduleOf(f), fs.readFileSync(f, 'utf8')] as const));

/**
 * 계층별 기능 분류(area) 정본은 architecture.md §2.1. 계층 폴더 바로 아래에는 area 폴더만 두고, 파일은 그 안에 둔다
 * (area 안을 더 나누는 것은 자유 — 중첩 깊이는 제한하지 않는다). 파일 한두 개인 계층(util·ai·log)은 분류하지 않는다.
 */
const LAYER_AREAS: Readonly<Record<string, readonly string[]>> = {
    language: ['syntax', 'dictionary', 'symbols', 'analysis', 'checks', 'documentation', 'xml', 'vscode'],
    project: ['sources', 'gpr', 'remote', 'symbols'],
    controller: ['connection', 'commands', 'protocol', 'runtime', 'deployment', 'files',
        'projects', 'threads', 'debugging', 'automation', 'diagnostics', 'io'],
    debug: ['session', 'execution', 'evaluation'],
    views: ['statusbar', 'tree', 'dashboard'],
    providers: ['navigation', 'structure', 'intellisense', 'diagnostics'],
    activation: ['controller', 'remote', 'deploy', 'debug', 'language', 'ai'],
    // test/ 는 검사 대상 모듈의 폴더를 거울처럼 따른다(test/<계층>/<area>/…). scripts 는 scripts/*.js 의 테스트.
    test: ['util', 'language', 'project', 'controller', 'debug', 'views', 'providers', 'activation', 'scripts'],
};
/** 분류 밖에 남아도 되는 계층 루트 모듈 — 허브와 테스트 러너뿐. */
const LAYER_ROOT_MODULES: ReadonlySet<string> = new Set(['activation/host', 'test/harness', 'test/index', 'test/architecture.test']);

test('구조 R9: 계층의 모듈은 기능별 하위 폴더(area)에 속하고 계층 루트에 다시 쌓이지 않는다', () => {
    const unclassified = [...modules].filter(mod => {
        const parts = mod.split('/');
        const areas = LAYER_AREAS[parts[0]];
        if (!areas || LAYER_ROOT_MODULES.has(mod)) { return false; }
        return parts.length < 3 || !areas.includes(parts[1]);
    });
    assert.deepStrictEqual(unclassified, [],
        `기능 분류가 없는 모듈: ${unclassified.join(', ')} — architecture.md §2.1 과 LAYER_AREAS 를 함께 갱신할 것`);
    // 테스트 폴더는 src 의 폴더를 거울처럼 따른다 — 없는 폴더를 가리키면 오타이거나 대상이 옮겨진 뒤 남은 것.
    const orphanDirs = [...modules]
        .filter(mod => mod.startsWith('test/') && !LAYER_ROOT_MODULES.has(mod) && !mod.startsWith('test/scripts/'))
        .map(mod => path.posix.dirname(mod).slice('test/'.length))
        .filter((dir, i, all) => all.indexOf(dir) === i && !fs.existsSync(path.join(SRC, dir)));
    assert.deepStrictEqual(orphanDirs, [], `src 에 대응 폴더가 없는 테스트 폴더: ${orphanDirs.join(', ')}`);
});

function importsOf(mod: string): { edges: ImportEdge[]; vscode: boolean; specs: string[] } {
    const src = sources.get(mod)!;
    const specs: Array<{ spec: string; typeOnly: boolean }> = [];
    // import/export … from 'x' (여러 줄 중괄호 포함), import 'x', import('x'), require('x')
    const fromRe = /\b(import|export)\s+(type\s+)?(?:[\w*\s{},$]+?)\s+from\s+['"]([^'"]+)['"]/g;
    const bareRe = /\bimport\s+['"]([^'"]+)['"]/g;
    const dynRe = /\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(src))) { specs.push({ spec: m[3], typeOnly: !!m[2] }); }
    while ((m = bareRe.exec(src))) { specs.push({ spec: m[1], typeOnly: false }); }
    while ((m = dynRe.exec(src))) { specs.push({ spec: m[1], typeOnly: false }); }
    const edges: ImportEdge[] = [];
    let vscode = false;
    for (const s of specs) {
        if (s.spec === 'vscode') { vscode = true; continue; }
        if (!s.spec.startsWith('.')) { continue; }
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(mod), s.spec));
        if (!modules.has(target)) { continue; } // ../package.json 같은 비-ts 대상
        edges.push({ from: mod, to: target, typeOnly: s.typeOnly, spec: s.spec });
    }
    return { edges, vscode, specs: specs.map(s => s.spec) };
}

const graph = new Map([...modules].map(mod => [mod, importsOf(mod)] as const));

test('구조 R1: vscode 를 import 하는 모듈은 접착 계층(activation·providers·language/vscode) 또는 명시 목록과 정확히 일치한다', () => {
    const actual = [...graph].filter(([, g]) => g.vscode).map(([mod]) => mod).filter(mod => !ALWAYS_VSCODE_LAYERS.has(layerOf(mod)));
    const unexpected = actual.filter(mod => !VSCODE_ALLOWED_MODULES.has(mod));
    const stale = [...VSCODE_ALLOWED_MODULES].filter(mod => !actual.includes(mod));
    assert.deepStrictEqual(unexpected, [],
        `목록에 없는 vscode 의존 모듈: ${unexpected.join(', ')} — 순수 계층에 vscode 를 들이려면 architecture.test.ts 목록과 architecture.md 에 이유를 함께 적을 것`);
    assert.deepStrictEqual(stale, [], `이제 vscode 를 쓰지 않는 모듈이 목록에 남아 있다(지울 것): ${stale.join(', ')}`);
    // 테스트는 Node 단독 실행이라 vscode 를 import 하면 이미 깨지지만, 규칙으로도 명시한다.
    assert.deepStrictEqual([...graph].filter(([mod, g]) => layerOf(mod) === 'test' && g.vscode).map(([mod]) => mod), []);
});

test('구조 R2: 계층 의존 방향 — 폴더는 허용된 계층만 import 한다 (language·util 은 어떤 상위 계층도 모른다)', () => {
    const violations: string[] = [];
    for (const [mod, g] of graph) {
        const from = layerOf(mod);
        const allowed = ALLOWED_DEPENDENCIES[from];
        assert.ok(allowed, `계층 규칙에 없는 폴더/모듈: ${mod} — ALLOWED_DEPENDENCIES 와 architecture.md 에 계층을 추가할 것`);
        for (const e of g.edges) {
            const to = layerOf(e.to);
            if (to === from || allowed.includes(to)) { continue; }
            violations.push(`${mod} → ${e.to}${e.typeOnly ? ' (type)' : ''}`);
        }
    }
    assert.deepStrictEqual(violations, [], `계층 규칙 위반:\n  ${violations.join('\n  ')}`);
});

test('구조 R3: 런타임 import 순환이 없다 (import type 은 제외)', () => {
    // Tarjan SCC
    let index = 0;
    const idx = new Map<string, number>(); const low = new Map<string, number>(); const onStack = new Set<string>();
    const stack: string[] = []; const cycles: string[][] = [];
    const strong = (v: string): void => {
        idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
        for (const e of graph.get(v)!.edges) {
            if (e.typeOnly) { continue; }
            const w = e.to;
            if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
            else if (onStack.has(w)) { low.set(v, Math.min(low.get(v)!, idx.get(w)!)); }
        }
        if (low.get(v) === idx.get(v)) {
            const comp: string[] = []; let w: string;
            do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
            if (comp.length > 1) { cycles.push(comp.sort()); }
        }
    };
    for (const mod of graph.keys()) { if (!idx.has(mod)) { strong(mod); } }
    assert.deepStrictEqual(cycles, [], `런타임 순환: ${cycles.map(c => c.join(' ↔ ')).join(' | ')}`);
});

test('구조 R4: src/test/*.test.ts 는 모두 index.ts 에 등록돼 있다', () => {
    const indexSrc = sources.get('test/index')!;
    const registered = new Set([...indexSrc.matchAll(/import\s+'\.\/([^']+)'/g)].map(m => m[1]));
    const testFiles = [...modules].filter(m => m.startsWith('test/') && m.endsWith('.test')).map(m => m.slice('test/'.length));
    const missing = testFiles.filter(f => !registered.has(f));
    assert.deepStrictEqual(missing, [], `index.ts 에 import 가 없는 테스트 파일: ${missing.join(', ')}`);
    const dangling = [...registered].filter(r => r !== 'harness' && !modules.has(`test/${r}`));
    assert.deepStrictEqual(dangling, [], `index.ts 가 가리키지만 없는 테스트 파일: ${dangling.join(', ')}`);
});

interface PackageJson {
    activationEvents?: string[];
    contributes?: {
        commands?: Array<{ command: string; title?: string }>;
        menus?: Record<string, Array<{ command?: string; submenu?: string }>>;
        keybindings?: Array<{ command: string }>;
        configuration?: { properties?: Record<string, unknown> } | Array<{ properties?: Record<string, unknown> }>;
    };
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;
const nonTestSources = [...sources].filter(([mod]) => layerOf(mod) !== 'test').map(([, s]) => s);

function registeredCommandIds(): Set<string> {
    const ids = new Set<string>();
    const constants = new Map<string, string>();
    for (const src of nonTestSources) {
        for (const m of src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]+)\s*=\s*['"`](gpl\.[A-Za-z0-9_.]+)['"`]/g)) { constants.set(m[1], m[2]); }
    }
    for (const src of nonTestSources) {
        for (const m of src.matchAll(/\bregister(?:Command|AiDebugCommand|TextEditorCommand)\(\s*['"`](gpl\.[A-Za-z0-9_.]+)['"`]/g)) { ids.add(m[1]); }
        for (const m of src.matchAll(/\bregister(?:Command|TextEditorCommand)\(\s*([A-Z][A-Z0-9_]+)\s*,/g)) {
            const id = constants.get(m[1]);
            if (id) { ids.add(id); }
        }
    }
    return ids;
}

test('구조 R5: package.json 이 선언·참조하는 명령은 모두 소스에서 등록된다', () => {
    const registered = registeredCommandIds();
    assert.ok(registered.size > 50, `등록 명령 수집이 비정상적으로 적다: ${registered.size}`);
    const declared = (pkg.contributes?.commands ?? []).map(c => c.command);
    const undeclaredButDeclared = declared.filter(id => !registered.has(id));
    assert.deepStrictEqual(undeclaredButDeclared, [], `package.json 에 선언됐지만 registerCommand 가 없는 명령(팔레트에서 "command not found"): ${undeclaredButDeclared.join(', ')}`);

    const refs = new Set<string>();
    for (const items of Object.values(pkg.contributes?.menus ?? {})) { for (const it of items) { if (it.command) { refs.add(it.command); } } }
    for (const k of pkg.contributes?.keybindings ?? []) { refs.add(k.command); }
    for (const ev of pkg.activationEvents ?? []) { if (ev.startsWith('onCommand:')) { refs.add(ev.slice('onCommand:'.length)); } }
    const missing = [...refs].filter(id => id.startsWith('gpl.') && !registered.has(id));
    assert.deepStrictEqual(missing, [], `메뉴/키바인딩/activationEvents 가 가리키지만 등록되지 않은 명령: ${missing.join(', ')}`);
});

test('구조 R8: 사용자 대면 명령 제목은 포트 번호가 아니라 채널 이름으로 부른다', () => {
    // 2026-09-22 사용자 결정: `1402`·`1403` 은 번호를 외운 사람에게만 뜻이 통한다.
    // 용어 정본과 표기 규칙은 controller/protocol/channelNames.ts — 번호는 설정 값·엔드포인트·진단 상세에서만 덧붙인다.
    const offenders = (pkg.contributes?.commands ?? [])
        .filter(c => /\b140[23]\b/.test(c.title ?? ''))
        .map(c => `${c.command}: "${c.title}"`);
    assert.deepStrictEqual(offenders, [],
        `명령 제목에 포트 번호가 남아 있다 — 채널 이름(명령 콘솔/런타임 콘솔)으로 쓸 것:\n  ${offenders.join('\n  ')}`);
});

test('구조 R6: 코드가 읽는 gpl.* 설정 키는 package.json 에 선언돼 있다', () => {
    const cfg = pkg.contributes?.configuration;
    const props = Array.isArray(cfg)
        ? Object.assign({}, ...cfg.map(c => c.properties ?? {})) as Record<string, unknown>
        : (cfg?.properties ?? {});
    const declared = new Set(Object.keys(props));
    assert.ok(declared.size > 30, `선언된 설정 키가 비정상적으로 적다: ${declared.size}`);
    for (const key of declared) { assert.ok(key.startsWith('gpl.'), `gpl. 접두가 아닌 설정 키: ${key}`); }

    const used = new Set<string>();
    const re = /getConfiguration\(\s*['"`](gpl(?:\.[A-Za-z0-9_]+)*)['"`]\s*\)\s*\.(?:get|inspect|has)(?:<[^>]*>)?\(\s*['"`]([A-Za-z0-9_.]+)['"`]/g;
    for (const src of nonTestSources) { for (const m of src.matchAll(re)) { used.add(`${m[1]}.${m[2]}`); } }
    assert.ok(used.size > 20, `설정 키 사용 수집이 비정상적으로 적다: ${used.size}`);
    const undeclared = [...used].filter(k => !declared.has(k));
    assert.deepStrictEqual(undeclared, [], `코드가 읽지만 package.json 에 없는 설정 키(오타?): ${undeclared.join(', ')}`);
});

// ─── R7: 판정 정본(SSOT) 우회 금지 ──────────────────────────────────────────────────────
// 계층(R1·R2)은 "어디에 두는가"만 강제한다. 같은 판단을 **여러 곳이 각자 구현**하는 것은 계층을 지켜도
// 일어나고(중복 배제 원칙, DRY 위반), 그 사본들은 시간이 지나며 조금씩 달라진다(구현 편차,
// Implementation Drift). 실제로 완성 provider 는 수신자 타입 해석을 자체 구현으로 들고 있다가
// `Thread.CurrentThread().` 뒤를 해석하지 못했고, 배열 요소 타입 벗기기는 사본이 네 벌이었다.
// 그래서 "이 판단의 정본은 어디"를 표로 두고, 정본 밖에서 같은 판단을 다시 구현한 흔적을 막는다.
//
// 새 정본을 세우면 여기 한 줄을 추가한다 — 규칙을 늘리는 비용이 낮아야 실제로 늘어난다.

interface SsotRule {
    /** 무엇을 판단하는 규칙인가 */
    what: string;
    /** 그 판단을 손으로 다시 구현했을 때 소스에 나타나는 표식 */
    pattern: RegExp;
    /** 이 표식이 있어도 되는 모듈(정본과, 정본을 감싸는 어댑터) */
    ownedBy: readonly string[];
    /** 정본이 실제로 제공해야 하는 export — 이름이 바뀌거나 사라지면 규칙이 낡았다는 뜻이다 */
    requires: readonly string[];
    /** 대신 써야 하는 것 */
    use: string;
}

const SSOT_RULES: readonly SsotRule[] = [
    {
        what: '파일별 심볼의 이름 인덱스 조립 (Provider와 문서 로더에 별도 이름 캐시를 만들지 않는다)',
        pattern: /buildSymbolNameIndex\s*\(/,
        ownedBy: ['language/symbols/symbolNameIndex', 'language/symbols/symbolIndex'],
        requires: ['buildSymbolNameIndex', 'SymbolIndex'],
        use: 'language/symbols/symbolIndex.SymbolIndex.findAllByName / findDefinitionMatches',
    },
    {
        what: '수신자(receiver) 해석 컨텍스트 조립 — 문서 파싱 + 프로시저 범위 + 내장 사전 훅',
        pattern: /buildDocumentReceiverLookup\s*\(/,
        ownedBy: ['language/analysis/receiverType', 'providers/intellisense/receiverContext'],
        requires: ['buildDocumentReceiverLookup', 'buildReceiverContext'],
        use: 'providers/intellisense/receiverContext.buildReceiverContext',
    },
    {
        what: '배열 타입의 요소 타입 벗기기 (`Foo[]` → `Foo`)',
        pattern: /replace\(\s*\/\\\[\\\]\$\//,
        ownedBy: ['language/analysis/receiverType'],
        requires: ['elementTypeOf', 'isArrayTypeName'],
        use: 'language/analysis/receiverType.elementTypeOf / isArrayTypeName',
    },
    {
        what: '호출 인자 타입 추론 (정의 이동·호버·참조 찾기의 오버로드 선택이 같은 규칙을 쓰게)',
        pattern: /inferLiteralArgType\s*\(/,
        ownedBy: ['language/analysis/overloadResolution'],
        requires: ['inferArgumentType', 'buildCallContext', 'rankOverloadMatches'],
        use: 'language/analysis/overloadResolution.buildCallContext / inferArgumentType',
    },
    {
        what: '참조 찾기의 출현 판정 — 다른 모듈의 동명 선언·한정자 불일치·멤버 가림 (provider 가 이름 매치 뒤 손으로 다시 판정하지 않게)',
        pattern: /'(other-module-decl|qualifier-mismatch|shadowed-by-member|shadowed-by-local|ambiguous-unqualified)'/,
        ownedBy: ['language/analysis/referenceScope'],
        requires: ['classifyReferenceOccurrence', 'containerAt', 'declarationAt', 'qualifierAt'],
        use: 'language/analysis/referenceScope.classifyReferenceOccurrence',
    },
    {
        what: '"컴파일 검증 필요" 상태의 설명 문장 (배지 툴팁·Start 확인 모달·자동화 COMPILE_UNVERIFIED 가 공유)',
        pattern: /소스가 아직 Compile ?로 검증되지 않았습니다/,
        ownedBy: ['controller/deployment/compileStale'],
        requires: ['describeCompileStale'],
        use: 'controller/deployment/compileStale.describeCompileStale (배지 라벨·툴팁·클릭은 views/statusbar/compileStaleBadge)',
    },
    {
        what: '쓰레드 목록 표·상태 집계 (「전체 쓰레드 복사」와 상황 스냅샷이 공유 — 보이는 것과 복사되는 것을 같게)',
        pattern: /\|\s*이름\s*\|\s*상태\s*\||state === 'Paused' \|\| \w+\.state === 'Break'/,
        ownedBy: ['controller/threads/threadReport'],
        requires: ['countThreadStates', 'renderThreadTable', 'summarizeThreadStates'],
        use: 'controller/threads/threadReport.renderThreadTable / countThreadStates',
    },
    {
        what: '에러 코드 → 코드/환경 분류 (트리 버킷·오류 상세 보고서·배포 요약이 공유). 공식 범위 표가 근거',
        pattern: /category:\s*'(code|environment)'/,
        ownedBy: ['controller/protocol/errorLogParser'],
        requires: ['getGplErrorGroup', 'describeErrorCategory', 'classifyErrorEntry'],
        use: 'controller/protocol/errorLogParser.classifyErrorEntry (라벨은 describeErrorCategory, 범위는 getGplErrorGroup)',
    },
    {
        what: '바이트 → 사람이 읽는 크기 (트리 FTP 목록·업로드 진행 바·완료 요약이 공유 — B 정수, 그 위는 소수 1자리)',
        pattern: /\.toFixed\(1\)\}\s*(KB|MB|GB)\b/,
        ownedBy: ['util/formatBytes'],
        requires: ['formatBytes', 'formatBytesAs', 'byteUnitFor'],
        use: 'util/formatBytes.formatBytes (같은 단위로 나란히 쓸 때는 formatBytesAs + byteUnitFor)',
    },
    {
        what: '업로드 진행 바·완료 요약 문구 (상태바 본문·툴팁·완료 표시 — 다른 표면이 바를 다시 그리지 않게)',
        pattern: /[█▏▎▍▌▋▊▉░]|업로드 완료 (— 변경 없음|\$\{)/,
        ownedBy: ['views/statusbar/uploadProgressBar'],
        requires: ['renderBar', 'renderUploadProgress', 'renderUploadSummary'],
        use: 'views/statusbar/uploadProgressBar.renderUploadProgress / renderUploadSummary (집계는 controller/deployment/uploadProgress, 보이기·타이밍은 views/statusbar/connectionStatusBar)',
    },
    {
        what: 'Flash 쓰기 전원 차단 금지 상태바 문구 (쓰기·Sync·안정화·미확인 단계가 공유)',
        pattern: /FLASH (저장 중|쓰기 완료 대기|안정화|안전 상태 미확인)/,
        ownedBy: ['views/statusbar/flashSafetyPresentation'],
        requires: ['presentFlashSafety'],
        use: 'views/statusbar/flashSafetyPresentation.presentFlashSafety (절차·시간은 controller/deployment/flashSafety)',
    },
    {
        what: 'GPL 심볼 → VS Code SymbolKind 대응 (개요·워크스페이스 심볼이 공유 — 같은 심볼이 두 곳에서 다른 종류로 보이지 않게)',
        pattern: /vscode\.SymbolKind\.(Module|Class|Method|Function|Property|Field|Constant|Variable)\b/,
        ownedBy: ['providers/structure/symbolKinds'],
        requires: ['toVsCodeSymbolKind'],
        use: 'providers/structure/symbolKinds.toVsCodeSymbolKind (분류·detail·계층은 language/symbols/outlineModel)',
    },
    {
        what: '제어기 연결 세션 상태 (쓰기는 host.setControllerConnected 한 곳, 읽기는 정본 — 뷰의 연결 플래그를 상태 출처로 쓰지 않게)',
        pattern: /setControllerSessionConnected\s*\(|controllerTree\??\.isConnected\b/,
        ownedBy: ['controller/connection/connectionSession', 'activation/host'],
        requires: ['isControllerSessionConnected', 'setControllerSessionConnected', 'onControllerSessionChange', 'effectiveKeepAlive'],
        use: 'host.isControllerConnected / controller/connection/connectionSession.isControllerSessionConnected · onControllerSessionChange',
    },
    {
        what: '그룹 Compile 뒤 Unload 위험 판정·문구 (UI 모달·AI 거부·타임아웃 안내·재부팅 해제가 같은 판정을 쓴다)',
        pattern: /['"`]unload-after-group-compile['"`]|명령 콘솔을 끊었/,
        ownedBy: ['controller/commands/unloadRisk'],
        requires: ['assessUnloadRisk', 'judgeRebootEvidence', 'unloadRiskWarning', 'unloadRiskRefusalDetail', 'unloadTimeoutGuidance'],
        use: 'controller/commands/unloadRisk.assessUnloadRisk / judgeRebootEvidence (전송 가드는 unloadRiskGuard, 저장은 unloadRiskStore)',
    },
    {
        what: '여유 메모리 측정값 (`Show Memory` 응답은 전송 경로가 정본에 기록하고 트리·배지·검사가 같은 값을 읽는다 — 화면마다 따로 해석·보관하지 않게)',
        pattern: /\(\s*['"`]Show Memory['"`]/,
        ownedBy: ['controller/diagnostics/resourceProbes', 'controller/diagnostics/memoryReadings'],
        requires: ['PROBE_MEMORY_CMD', 'parseShowMemory', 'controllerMemoryReadings', 'isReadingReusable'],
        use: 'controller/diagnostics/resourceProbes.PROBE_MEMORY_CMD 로 보내고 controller/diagnostics/memoryReadings.controllerMemoryReadings 를 읽는다',
    },
];

/**
 * 주석을 지운 소스 — 표식 검사가 "설명에 이름을 적은 것"까지 위반으로 세지 않게 한다.
 * 블록 주석과 주석 전용 줄만 지운다(코드 줄의 `https://` 같은 것을 건드리지 않기 위해).
 */
function codeOnly(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(line => !/^\s*(\/\/|\*)/.test(line))
        .join('\n');
}

test('구조 R7: 판정 정본(SSOT)을 우회해 같은 판단을 다시 구현하지 않는다', () => {
    const violations: string[] = [];
    for (const rule of SSOT_RULES) {
        for (const mod of rule.ownedBy) {
            assert.ok(sources.has(mod), `R7 표가 가리키는 정본 모듈이 없다: ${mod} (${rule.what}) — 표를 갱신할 것`);
        }
        // 규칙이 낡지 않았는지: 정본이 대체 수단을 실제로 export 하고 있어야 한다.
        const missing = rule.requires.filter(name => !rule.ownedBy.some(mod =>
            new RegExp(`export\\s+(?:function|const|class)\\s+${name}\\b`).test(sources.get(mod) ?? '')));
        assert.deepStrictEqual(missing, [],
            `정본에서 사라진 export 가 R7 표에 남아 있다: ${missing.join(', ')} (${rule.what}) — 표를 갱신할 것`);

        for (const [mod, src] of sources) {
            if (layerOf(mod) === 'test' || rule.ownedBy.includes(mod)) { continue; }
            if (rule.pattern.test(codeOnly(src))) {
                violations.push(`${mod}: ${rule.what} → 대신 ${rule.use} 를 쓸 것`);
            }
        }
    }
    assert.deepStrictEqual(violations, [], `판정 정본 우회:\n  ${violations.join('\n  ')}`);
});

// ─── R10: 크기 상한은 분해 신호 — 넘는 것은 부채 표에 올라 있어야 한다 (2026-11-04) ──────────────────
// CLAUDE.md 구조 규칙 2(파일 1,000줄·함수 150줄)는 문서에만 있어서 조용히 무너졌다 — 감사 결과 150줄을 넘는 함수
// 32개 중 부채 표(architecture.md §7)에 오른 것은 하나뿐이었다. 그래서 측정을 테스트로 옮기고, 넘는 것은 아래 목록과
// §7 양쪽에 있어야 통과하게 한다. 분해해서 상한 아래로 내려가면 목록에서 지우라고 실패한다(낡은 부채 기록 방지).
// 함수는 이름이 있는 것(선언·메서드·접근자·생성자·이름 있는 변수/속성에 대입한 화살표 함수)만 잰다.

const FILE_LINE_LIMIT = 1000;
const FUNCTION_LINE_LIMIT = 150;

/** 상한을 넘는 파일(`모듈`)·함수(`모듈#이름`) — 정본은 architecture.md §7. 줄 수는 적지 않는다(바뀔 때마다 고치지 않게). */
const SIZE_DEBT: ReadonlySet<string> = new Set([
    // 파일
    'controller/runtime/runtimeConsole',
    'debug/session/gplDebugSession',
    'language/dictionary/gplDictionaryData', // 내장 사전 데이터 표 — 로직이 아니라 분해 대상이 아니다(§7)
    // activation 의 배선 함수 — 클로저 하나에 명령 등록이 몰려 있다(deploy.ts 분할 방식으로 형제 모듈로)
    'activation/ai/aiDebugCommands#activateAiDebugCommands',
    'activation/controller/connection#activateConnection',
    'activation/controller/consoleCommands#activateConsoleCommands',
    'activation/controller/controllerCommands#activateControllerCommands',
    'activation/controller/treeCommands#activateTreeCommands',
    'activation/debug/breakpointCommands#activateBreakpointCommands',
    'activation/debug/debugIntegration#activateDebugIntegration',
    'activation/deploy/deployReport#reportDeploySuccess',
    'activation/deploy/projectContext#activateProjectContext',
    'activation/deploy/runDeploy#runDeploy',
    'activation/deploy/saveToFlashCommand#registerSaveToFlashCommand',
    'activation/language/dependencyCheckCommands#registerDependencyCheck',
    'activation/language/languageFeatures#activateLanguageFeatures',
    'activation/remote/ftpCommands#activateFtpCommands',
    // 제어기·디버그
    'controller/connection/consoleSocket#attempt',
    'controller/deployment/deployCompileStage#runCompilePhase',
    'controller/deployment/deployTargetStage#resolveDeployTarget',
    'controller/deployment/deployUploadStage#runUploadAndStopPhase',
    'controller/runtime/runtimeConsole#connectInternal',
    'debug/evaluation/variableEvaluator#queryVariableStructuredSmart',
    'debug/session/gplDebugSession#_pollThreadStates',
    'debug/session/gplDebugSession#attachRequest',
    'debug/session/gplDebugSession#evaluateRequest',
    'debug/session/gplDebugSession#setBreakPointsRequest',
    'debug/session/gplDebugSession#variablesRequest',
    // 언어·provider·뷰
    'language/syntax/gplParser#parseDocumentUncached',
    'project/gpr/sourcePromotion#planSourcePromotion',
    'providers/intellisense/hoverProvider#provideHover',
    'providers/navigation/definitionProvider#provideDefinition',
    'providers/navigation/referenceProvider#provideReferences',
    'providers/structure/foldingRangeProvider#provideFoldingRanges',
    'views/tree/snapshotMarkdown#buildDiagnosticSnapshotMarkdown',
]);

function measureOversized(): Map<string, number> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts: typeof import('typescript') = require('typescript');
    const over = new Map<string, number>();
    for (const [mod, text] of sources) {
        if (layerOf(mod) === 'test') { continue; }
        const lines = text.split('\n').length;
        if (lines > FILE_LINE_LIMIT) { over.set(mod, lines); }
        const sf = ts.createSourceFile(`${mod}.ts`, text, ts.ScriptTarget.Latest, true);
        const visit = (n: import('typescript').Node): void => {
            let name: string | undefined;
            if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) && n.name && n.body) {
                name = n.name.getText(sf);
            } else if (ts.isConstructorDeclaration(n) && n.body) {
                name = 'constructor';
            } else if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n))
                && (ts.isVariableDeclaration(n.parent) || ts.isPropertyDeclaration(n.parent) || ts.isPropertyAssignment(n.parent))) {
                name = n.parent.name.getText(sf);
            }
            if (name) {
                const start = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
                const end = sf.getLineAndCharacterOfPosition(n.getEnd()).line;
                if (end - start + 1 > FUNCTION_LINE_LIMIT) { over.set(`${mod}#${name}`, end - start + 1); }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }
    return over;
}

test('구조 R10: 1,000줄 넘는 파일·150줄 넘는 함수는 부채 목록과 architecture.md §7 에 올라 있다', () => {
    const over = measureOversized();
    const unlisted = [...over].filter(([k]) => !SIZE_DEBT.has(k)).map(([k, n]) => `${k} (${n}줄)`);
    assert.deepStrictEqual(unlisted, [],
        `크기 상한 초과가 부채 목록에 없다 — 분해하거나(협력자 모듈 + 좁은 io), SIZE_DEBT 와 architecture.md §7 에 이유와 함께 올릴 것:\n  ${unlisted.join('\n  ')}`);
    const stale = [...SIZE_DEBT].filter(k => !over.has(k));
    assert.deepStrictEqual(stale, [], `상한 아래로 내려간 항목이 부채 목록에 남아 있다 — SIZE_DEBT 와 §7 에서 지울 것:\n  ${stale.join('\n  ')}`);

    const doc = fs.readFileSync(path.join(ROOT, 'docs/development/architecture.md'), 'utf8');
    const section7 = doc.slice(doc.indexOf('## 7.'), doc.indexOf('## 8.'));
    const undocumented = [...SIZE_DEBT].filter(k => !section7.includes(k.includes('#') ? k.split('#')[1] : k));
    assert.deepStrictEqual(undocumented, [], `architecture.md §7 에 없는 부채 항목:\n  ${undocumented.join('\n  ')}`);
});
