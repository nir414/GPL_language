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
 *  R1 vscode 의존 허용 목록 — activation/·providers/ 밖에서 vscode 를 import 하는 모듈은 명시 목록과 정확히 일치해야 한다.
 *  R2 계층 의존 방향 — 폴더(계층)별로 import 해도 되는 계층만 허용한다(같은 계층은 항상 허용).
 *  R3 런타임 import 순환 없음 — `import type` 은 지워지므로 제외.
 *  R4 테스트 등록 누락 없음 — src/test/*.test.ts 는 모두 index.ts 가 import 한다(수동 등록이라 잊기 쉽다).
 *  R5 package.json ↔ 코드 — 선언된 명령·메뉴/키바인딩/활성화 이벤트가 가리키는 명령은 소스에서 등록돼 있어야 한다.
 *  R6 설정 키 — 코드가 읽는 `gpl.*` 설정 키는 package.json 에 선언돼 있어야 한다(오타 방지).
 *  R7 판정 정본(SSOT) 우회 금지 — "이 판단은 여기서만 한다"고 정한 규칙을 다른 모듈이 손으로 다시 구현하지 않는다.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

type Layer =
    | 'util' | 'language' | 'project' | 'log' | 'controller' | 'debug' | 'views' | 'providers' | 'activation' | 'ai'
    | 'config' | 'symbolCache' | 'extension' | 'test';

/** 계층별로 import 해도 되는 다른 계층(같은 계층은 항상 허용). 근거는 docs/development/architecture.md §계층 규칙. */
const ALLOWED_DEPENDENCIES: Record<Layer, readonly Layer[]> = {
    util: [],
    language: ['util'],
    log: [],
    project: ['language', 'util'],
    config: ['language'],
    controller: ['project', 'util', 'log'],
    symbolCache: ['language', 'project', 'util', 'config'],
    debug: ['controller', 'project', 'language', 'util'],
    views: ['controller', 'util', 'config'],
    providers: ['language', 'project', 'util', 'config', 'symbolCache'],
    ai: [],
    activation: ['controller', 'project', 'language', 'util', 'log', 'views', 'providers', 'debug', 'ai', 'config', 'symbolCache'],
    extension: ['controller', 'project', 'language', 'util', 'log', 'views', 'providers', 'debug', 'ai', 'config', 'symbolCache', 'activation'],
    test: ['util', 'language', 'log', 'project', 'config', 'controller', 'symbolCache', 'debug', 'views', 'providers', 'ai', 'activation'],
};

/** activation/·providers/ 는 VS Code 접착 계층이라 전부 vscode 를 써도 된다. 그 밖은 여기 있는 모듈만. */
const ALWAYS_VSCODE_LAYERS: ReadonlySet<Layer> = new Set<Layer>(['activation', 'providers']);
const VSCODE_ALLOWED_MODULES: ReadonlySet<string> = new Set([
    // 루트
    'extension', 'config', 'symbolCache',
    // controller — 전송/UI 접착. 나머지 controller/ 모듈은 순수(Node 단독 테스트 대상)
    'controller/breakpointMirror', 'controller/breakpointSync', 'controller/controllerConnection', 'controller/debugBridge',
    'controller/deployRecord', 'controller/deployService', 'controller/gprSyncCommand', 'controller/projectPicker',
    'controller/runtimeConsole',
    // debug — DAP 세션과 구성 provider
    'debug/activateDebug', 'debug/gplDebugSession',
    // project — 워크스페이스 검색·명령 래퍼
    'project/projectFileScope', 'project/promoteSourceCommand',
    // views
    'views/connectionStatusBar', 'views/controllerDashboardPanel', 'views/controllerTreeProvider',
    // 단일 파일 계층
    'ai/exportAgentSetup', 'log/liveLogTerminal',
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
/** src 기준 모듈 이름(확장자 없음): `controller/deployService`, 루트는 `config`. */
const moduleOf = (abs: string): string => posix(path.relative(SRC, abs)).replace(/\.ts$/, '');
const layerOf = (mod: string): Layer => (mod.includes('/') ? mod.slice(0, mod.indexOf('/')) : mod) as Layer;

const files = walk(SRC);
const modules = new Set(files.map(moduleOf));
const sources = new Map(files.map(f => [moduleOf(f), fs.readFileSync(f, 'utf8')] as const));

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

test('구조 R1: vscode 를 import 하는 모듈은 접착 계층(activation·providers) 또는 명시 목록과 정확히 일치한다', () => {
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
        what: '수신자(receiver) 해석 컨텍스트 조립 — 문서 파싱 + 프로시저 범위 + 내장 사전 훅',
        pattern: /buildDocumentReceiverLookup\s*\(/,
        ownedBy: ['language/receiverType', 'providers/receiverContext'],
        requires: ['buildDocumentReceiverLookup', 'buildReceiverContext'],
        use: 'providers/receiverContext.buildReceiverContext',
    },
    {
        what: '배열 타입의 요소 타입 벗기기 (`Foo[]` → `Foo`)',
        pattern: /replace\(\s*\/\\\[\\\]\$\//,
        ownedBy: ['language/receiverType'],
        requires: ['elementTypeOf', 'isArrayTypeName'],
        use: 'language/receiverType.elementTypeOf / isArrayTypeName',
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
