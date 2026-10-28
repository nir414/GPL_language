/**
 * 제어기 트리 provider 동등성 하니스 — "분할 전(옛 단일 클래스)"과 "분할 후(현재 HEAD)"를 같은 fixture 로
 * 구동해 출력이 완전히 같은지 비교한다. 테스트 스위트에는 넣지 않는다(옛 파일을 git 에서 꺼내 컴파일하므로 느리다).
 *
 * 비교 대상: getChildren() 재귀 전체의 TreeItem(label·description·tooltip·iconPath·contextValue·collapsibleState·
 * command·id·순서), buildSituationSnapshotMarkdown / buildDiagnosticSnapshotMarkdown / buildThreadReportMarkdown 문자열,
 * refreshSystemInfo 로 만든 시스템 정보, 정지 전이 감지(firePauseTransitions / detectPauseTransition).
 *
 * 사용법 (저장소 루트에서):
 *   node scripts/dev/compareTreeProvider.js                 # 기준 커밋 6882714 와 비교
 *   node scripts/dev/compareTreeProvider.js --base <커밋>    # 다른 기준
 *   node scripts/dev/compareTreeProvider.js --keep           # 스테이징(out/.compare-stage)을 지우지 않음
 * 차이가 있으면 fixture 별로 처음 어긋난 줄을 출력하고 종료 코드 1 로 끝난다.
 *
 * 방법: src 를 out/.compare-stage/src 로 복사하고 옛 provider 를 views/tree/oldControllerTreeProvider.ts 로 넣어
 * 한 번에 tsc 컴파일한다(옛 파일의 상대 import 가 그대로 풀린다). vscode 는 scripts/dev/vscodeMock.js 로 대체하고,
 * controllerConnection·ftpClient 는 양쪽이 공유하는 모듈 export 를 fixture 응답으로 바꿔 끼운다. Date 는 고정한다.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const STAGE = path.join(ROOT, 'out', '.compare-stage');
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : '6882714';
const KEEP = args.includes('--keep');

// ── 1. 스테이징 컴파일 ────────────────────────────────────
function stageAndCompile() {
    fs.rmSync(STAGE, { recursive: true, force: true });
    fs.mkdirSync(STAGE, { recursive: true });
    fs.cpSync(path.join(ROOT, 'src'), path.join(STAGE, 'src'), {
        recursive: true,
        filter: (p) => !p.split(path.sep).includes('test'),
    });
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(STAGE, 'package.json'));
    const old = cp.execFileSync('git', ['show', `${BASE}:src/views/tree/controllerTreeProvider.ts`], { cwd: ROOT, maxBuffer: 1 << 26 });
    fs.writeFileSync(path.join(STAGE, 'src', 'views', 'tree', 'oldControllerTreeProvider.ts'), old);
    fs.writeFileSync(path.join(STAGE, 'tsconfig.json'), JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: { rootDir: './src', outDir: './out', sourceMap: false, noEmitOnError: false, noUnusedLocals: false, noUnusedParameters: false },
        include: ['src/**/*'], exclude: [],
    }));
    const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const r = cp.spawnSync(process.execPath, [tsc, '-p', path.join(STAGE, 'tsconfig.json')], { cwd: ROOT, encoding: 'utf8' });
    const errs = (r.stdout || '').split('\n').filter(l => /error TS/.test(l));
    if (errs.length) { console.log('[tsc 경고/오류 ' + errs.length + '건 — emit 은 진행]\n' + errs.slice(0, 5).join('\n')); }
}

// ── 2. 모듈 적재 ──────────────────────────────────────────
const FIXED_NOW = Date.parse('2026-10-27T09:30:00+09:00');
function freezeDate() {
    const Real = Date;
    class FakeDate extends Real {
        constructor(...a) { if (a.length) { super(...a); } else { super(FIXED_NOW); } }
        static now() { return FIXED_NOW; }
    }
    global.Date = FakeDate;
}

const mock = require(path.join(__dirname, 'vscodeMock.js'));
const origLoad = Module._load;
Module._load = function (request) {
    if (request === 'vscode') { return mock; }
    return origLoad.apply(this, arguments);
};

// 현재 fixture 가 stub 에 공급하는 값 (양쪽 provider 가 같은 stub 을 본다)
const env = { cfg: null, responses: {}, probe: null, listDir: null };

function loadModules() {
    const out = path.join(STAGE, 'out');
    const conn = require(path.join(out, 'controller/connection/controllerConnection.js'));
    conn.getControllerConfig = () => env.cfg;
    conn.getTrafficLogOptions = () => ({ responseBody: true, maxResponseChars: 0 });
    conn.getConnectionStats = () => ({ keepAliveActive: true, connects: 3, reuses: 12, retries: 1 });
    conn.trySendCommand = async (cmd) => (cmd in env.responses ? env.responses[cmd] : null);
    conn.probeControllerCommand = async () => env.probe;
    const ftp = require(path.join(out, 'controller/files/ftpClient.js'));
    ftp.listRemoteDir = async (host, p) => env.listDir(host, p);
    ftp.listRemoteDirs = async () => { throw new Error('unused'); };
    return {
        Old: require(path.join(out, 'views/tree/oldControllerTreeProvider.js')).ControllerTreeProvider,
        New: require(path.join(out, 'views/tree/controllerTreeProvider.js')).ControllerTreeProvider,
        detectPauseTransition: require(path.join(out, 'views/tree/threadPauseTransition.js')).detectPauseTransition,
    };
}

// ── 3. 정규화 ─────────────────────────────────────────────
function norm(x, seen = new WeakSet()) {
    if (x === undefined || typeof x === 'function') { return undefined; }
    if (x === null || typeof x !== 'object') { return x; }
    if (x instanceof Date) { return { __date: x.toISOString() }; }
    if (typeof x.appendMarkdown === 'function') { return { __markdown: x.value }; }
    if (seen.has(x)) { return '[cycle]'; }
    seen.add(x);
    if (Array.isArray(x)) { return x.map(v => norm(v, seen) ?? null); }
    const o = {};
    for (const k of Object.keys(x).sort()) {
        const v = norm(x[k], seen);
        if (v !== undefined) { o[k] = v; }
    }
    seen.delete(x);
    return o;
}

async function dumpTree(provider) {
    const lines = [];
    async function walk(node, depth) {
        const item = provider.getTreeItem(node);
        lines.push(`${'  '.repeat(depth)}${JSON.stringify(norm(item))}`);
        if (node.type === 'info') { return; } // FTP 폴더 펼침은 별도 검사(중첩 목록이 끝없이 이어지지 않게)
        const kids = await provider.getChildren(node);
        for (const k of kids) { await walk(k, depth + 1); }
    }
    const roots = await provider.getChildren();
    for (const r of roots) { await walk(r, 0); }
    return lines.join('\n');
}

// ── 4. fixture ────────────────────────────────────────────
const CFG = { ip: '192.168.0.50', port: 1402, consolePort: 1403, timeoutMs: 8000, ftpBasePath: '/GPL', ftpFlashProjectsPath: '/flash/projects', preferIPv4: true };
const T = (name, state, extra = {}) => ({ name, state, lastStatus: '0', project: 'Demo', file: '', ...extra });
const idleConsole = { state: 'idle', connected: false, reason: '미연결', noPayloadStreak: 0, immediateEofStreak: 0, lastChangedAt: FIXED_NOW - 5000 };
const connConsole = { state: 'connected', connected: true, reason: '수신 중', noPayloadStreak: 0, immediateEofStreak: 0, lastChangedAt: FIXED_NOW - 60000, lastConnectAt: FIXED_NOW - 61000, lastPayloadAt: FIXED_NOW - 1500, lastPayloadBytes: 2048, connectCount: 2, connectsPerMinute: 1, watchdogKicks: 0 };
const ftpFiles = [
    { name: '.', isDirectory: true, size: 0 }, { name: '..', isDirectory: true, size: 0 },
    { name: 'Demo', isDirectory: true, size: 0, modifiedAt: new Date('2026-10-20T01:02:03Z') },
    { name: 'Other', isDirectory: true, size: 0 },
    { name: 'boot.gpo', isDirectory: false, size: 123456, modifiedAt: new Date('2026-09-01T10:00:00Z') },
    { name: 'tiny.txt', isDirectory: false, size: 12 },
];
const flashFiles = [
    { name: 'Saved', isDirectory: true, size: 0, modifiedAt: new Date('2026-08-01T00:00:00Z') },
    { name: 'a.gpl', isDirectory: false, size: 4096 },
];
const threadsMixed = [
    T('Idle1', 'Idle'), T('Run1', 'Running', { file: 'Main.gpl', fileLine: 12, stackTiming: [1, 2, 3] }),
    T('Pause1', 'Paused', { file: 'Main.gpl', fileLine: 40, lastStatus: '-755', func: 'Foo', procLine: 3 }),
    T('Err1', 'Error', { file: 'Util.gpl', fileLine: 7, lastStatus: '-757', project: 'Other' }),
    T('Brk1', 'Break', { file: 'Main.gpl' }), T('Stop1', 'Stopped'), T('Stopping1', 'Stopping', { project: '' }),
    T('Weird', 'Unknown'), T('Err2', 'Error', { file: 'Main.gpl', fileLine: 99, lastStatus: '-782' }),
];
const errorLines = [
    '09-21-2026 10:04:49.135, GenAdp, -757, "*Object not instantiated*"',
    '09-21-2026 10:04:50.000, SYSTEM, -1521, "*Invalid parameter DB*"',
    '09-21-2026 10:05:00.000, GenAdp, -782, "*Some failure*"',
    '09-21-2026 10:05:01.000, GenAdp, -508, "*File not found*"',
    '09-21-2026 10:05:02.000, GenAdp, -2, "*Command failed*"',
    '09-21-2026 10:06:00.000, GenAdp, -1200, "*Robot problem*"',
    'some raw unstructured error text that is quite long ' + 'x'.repeat(160),
    'STATUS -700 aborted thread',
];
const bpList = [
    { number: 1, project: 'Demo', proc: 'Main', procLine: 5, file: 'Main.gpl', fileLine: 10, hitCount: 3 },
    { number: 2, project: 'Demo', proc: 'Helper', procLine: 2, file: 'Util.gpl', fileLine: 21, hitCount: 0 },
];
const compileStale = { projectName: 'Demo', projectDir: 'C:/proj/Demo', since: FIXED_NOW - 90000, reason: '/GPL 소스만 업로드됨(Compile 미검증)' };
const errCtx = { threadName: 'Err1', threadId: 4, lastCommand: 'Start Demo', firstSeenAt: '10:04:49', statusText: '-757 Object not instantiated', stackFrames: ['Main.gpl:12 Foo', 'Util.gpl:7 Bar'], relatedFunctions: ['Foo', 'Bar'] };
const errCtxMin = { threadName: 'X' };
const ftpMatchKey = `${CFG.ip}|${CFG.ftpBasePath}|${CFG.ftpFlashProjectsPath}`;
const base = { connected: true, ftpCacheKey: ftpMatchKey, runtimeConsoleStatus: connConsole };

const FIXTURES = [
    ['disconnected', { connected: false }],
    ['disconnected+browse+ftp', { connected: false, ftpBrowseOnly: true, ftpEntries: ftpFiles, ftpFlashEntries: flashFiles, lastFtpRefreshAt: FIXED_NOW - 120000, ftpCacheKey: ftpMatchKey }],
    ['disconnected+browse+ftp-error+empty', { connected: false, ftpBrowseOnly: true, ftpError: 'ECONNREFUSED', ftpFlashEntries: [] }],
    ['disconnected+browse+cache-key-mismatch', { connected: false, ftpBrowseOnly: true, ftpEntries: ftpFiles, ftpCacheKey: 'other|/x|/y' }],
    ['connected-empty (console idle)', { connected: true }],
    ['connected-empty (console connected)', { ...base }],
    ['threads-mixed', { ...base, threads: threadsMixed, expected: ['Demo', 'Demo'] }],
    ['threads-all-running', { ...base, threads: [T('A', 'Running'), T('B', 'Running')] }],
    ['threads-all-stopped', { ...base, threads: [T('A', 'Stopped'), T('B', 'Idle')] }],
    ['threads-only-unknown', { ...base, threads: [T('A', 'Weird')] }],
    ['errors-log', { ...base, errors: errorLines, threads: [T('Err1', 'Error', { file: 'Main.gpl', fileLine: 3 })] }],
    ['errors-chain-only', { ...base, errors: errorLines.slice(2, 5) }],
    ['errors-env-only', { ...base, errors: [errorLines[1]] }],
    ['errors+runtimeErrorContext', { ...base, errors: errorLines, threads: threadsMixed, runtimeErrorContext: errCtx }],
    ['runtimeErrorContext-minimal', { ...base, runtimeErrorContext: errCtxMin }],
    ['runtimeErrorContext-no-id-no-frames', { ...base, runtimeErrorContext: { threadName: 'T', statusText: 'oops', stackFrames: [] } }],
    ['ftp-ok+expected-present', { ...base, ftpEntries: ftpFiles, ftpFlashEntries: flashFiles, lastFtpRefreshAt: FIXED_NOW - 400000, expected: ['Demo', 'Demo'] }],
    ['ftp-ok+build-only-ready', { ...base, ftpEntries: ftpFiles, expected: ['Demo', 'Demo'], threads: [] }],
    ['ftp-ok+expected-missing', { ...base, ftpEntries: ftpFiles, expected: ['Nope', 'Nope'] }],
    ['ftp-ok+unexpected-running', { ...base, ftpEntries: ftpFiles, threads: [T('R', 'Running', { project: 'Other' })], expected: ['Demo', 'Demo'] }],
    ['ftp-ok+folder-differs-from-project', { ...base, ftpEntries: ftpFiles, threads: [T('R', 'Running', { project: 'Demo' })], expected: ['Demo', 'Saved'], ftpFlashEntries: flashFiles }],
    ['ftp-error', { ...base, ftpError: 'ECONNREFUSED', ftpFlashError: '530 Login', lastFtpRefreshAt: FIXED_NOW - 1000 }],
    ['ftp-empty-lists', { ...base, ftpEntries: [], ftpFlashEntries: [] }],
    ['ftp-unsafe-name', { ...base, ftpEntries: [{ name: '../evil', isDirectory: false, size: 1 }], ftpFlashEntries: flashFiles }],
    ['ftp-cache-key-mismatch', { ...base, ftpEntries: ftpFiles, ftpFlashEntries: flashFiles, ftpCacheKey: 'x|/a|/b' }],
    ['compileStale', { ...base, ftpEntries: ftpFiles, compileStale, expected: ['Demo', 'Demo'] }],
    ['compileStale-no-dir', { ...base, compileStale: { projectName: 'Demo', since: FIXED_NOW - 5, reason: 'r' } }],
    ['compileStale+mismatch', { ...base, compileStale, threads: [T('R', 'Running', { project: 'Other' })], expected: ['Demo', 'Demo'] }],
    ['sysinfo-present', { ...base, sysInfo: [{ label: '메모리', value: 'Free: 12.5 MB', tooltip: 'raw mem', iconId: 'database' }, { label: 'CPU', value: '12%', tooltip: 'cpu', iconId: 'pulse' }, { label: 'noicon', value: 'v' }], lastSystemInfoRefreshAt: FIXED_NOW - 30000 }],
    ['sysinfo-present-no-timestamp', { ...base, sysInfo: [{ label: 'CPU', value: '1%' }], lastSystemInfoRefreshAt: 0 }],
    ['sysinfo-absent', { ...base, sysInfo: [], lastSystemInfoRefreshAt: 0 }],
    ['console-reconnecting', { ...base, runtimeConsoleStatus: { ...connConsole, state: 'reconnecting', connected: false, reason: '재연결 대기', detail: 'ECONNRESET', reconnectDelayMs: 4000, reconnectAttempt: 3, lastErrorCode: 'ECONNRESET', noPayloadStreak: 4 } }],
    ['console-connect-failed', { ...base, runtimeConsoleStatus: { ...idleConsole, state: 'connect-failed', reason: '접속 실패', detail: 'ETIMEDOUT', lastErrorCode: 'ETIMEDOUT', connectCount: 9, connectsPerMinute: 4, watchdogKicks: 2 } }],
    ['console-no-payload', { ...base, runtimeConsoleStatus: { ...connConsole, state: 'no-payload', reason: 'payload 없음', noPayloadStreak: 7, lastPayloadAt: undefined, lastPayloadBytes: undefined } }],
    ['console-polling', { ...base, runtimeConsoleStatus: { ...connConsole, state: 'polling', immediateEofStreak: 3, reconnectDelayMs: 2000 } }],
    ['console-connected-no-payload', { ...base, runtimeConsoleStatus: { ...connConsole, state: 'connected-no-payload', noPayloadStreak: 2 } }],
    ['breakpoints-orphan', { ...base, breakpoints: bpList }],
    ['breakpoints-synced', { ...base, breakpoints: bpList, editorBps: [['C:/p/Main.gpl', 10], ['C:/p/Util.gpl', 21]] }],
    ['breakpoints-half-synced', { ...base, breakpoints: bpList, editorBps: [['C:/p/Main.gpl', 10]] }],
    ['layout-salt-bumped', { ...base, salt: 3, threads: threadsMixed }],
    ['kitchen-sink', { ...base, threads: threadsMixed, errors: errorLines, breakpoints: bpList, editorBps: [['C:/p/Main.gpl', 10]], ftpEntries: ftpFiles, ftpFlashEntries: flashFiles, lastFtpRefreshAt: FIXED_NOW - 7000, compileStale, expected: ['Demo', 'Demo'], runtimeErrorContext: errCtx, sysInfo: [{ label: '메모리', value: 'Free: 1 MB', tooltip: 't', iconId: 'database' }], lastSystemInfoRefreshAt: FIXED_NOW - 9000, salt: 1 }],
];

const DEPLOYS = [
    undefined,
    { mode: 'Build', success: true, lastStage: 'SUCCESS', compileErrorCodes: [], controllerSystemCodes: [], updatedAt: FIXED_NOW - 1000, summary: 'ok' },
    { mode: 'Deploy & Run', success: true, lastStage: 'SUCCESS', compileErrorCodes: [], controllerSystemCodes: [], updatedAt: FIXED_NOW - 1000, summary: 'ok', unverifiableReason: '이전 빌드와 동일', comparisonNote: '동일' },
    { mode: 'Upload Only', success: true, lastStage: 'UPLOAD', compileErrorCodes: [], controllerSystemCodes: [], updatedAt: FIXED_NOW, summary: 's' },
    { mode: 'Upload & Start', success: false, lastStage: 'COMPILE', compileErrorCodes: [-508, -782], controllerSystemCodes: [-1521], updatedAt: FIXED_NOW - 99999, summary: '컴파일 실패', compileRawSummary: ['err a', 'err b'] },
    ...['LOCKED', 'CANCELLED', 'UPLOAD', 'STOP', 'THREAD_CHECK', 'MEMORY_CHECK', 'COMPILE_DEFERRED', 'START', 'ERROR_CHECK', 'SUCCESS'].map(lastStage =>
        ({ mode: lastStage === 'START' ? 'Build' : 'Deploy & Run', success: false, lastStage, compileErrorCodes: [], controllerSystemCodes: [], updatedAt: FIXED_NOW - 1, summary: lastStage })),
    { mode: 'Build', success: false, lastStage: 'START', compileErrorCodes: [], controllerSystemCodes: [], updatedAt: FIXED_NOW, summary: 'b' },
];
const CONSOLE_OVERRIDES = [undefined, { ...connConsole, state: 'reconnecting', connected: false, reason: 'r', detail: 'd', reconnectDelayMs: 1000, reconnectAttempt: 2, lastErrorCode: 'EPIPE' }];

// 새 provider 의 setCompileStale 은 목록을 받는다(2026-10-28 §1-GN). BASE 가 그 이전 커밋이면 옛 쪽엔 단일 항목을 그대로 준다.
const NEW_STALE_AS_LIST = process.env.COMPARE_TREE_OLD_STALE_IS_LIST !== '1';
function apply(p, fx, staleAsList = false) {
    p._connected = !!fx.connected;
    p.ftpBrowseOnly = !!fx.ftpBrowseOnly;
    if (fx.threads) { p.threads = fx.threads.map(t => ({ ...t })); }
    if (fx.errors) { p.errors = [...fx.errors]; }
    if (fx.breakpoints) { p.breakpoints = fx.breakpoints.map(b => ({ ...b })); }
    if (fx.ftpEntries) { p.ftpEntries = fx.ftpEntries; }
    if (fx.ftpFlashEntries) { p.ftpFlashEntries = fx.ftpFlashEntries; }
    if (fx.ftpError !== undefined) { p.ftpError = fx.ftpError; }
    if (fx.ftpFlashError !== undefined) { p.ftpFlashError = fx.ftpFlashError; }
    if (fx.lastFtpRefreshAt) { p.lastFtpRefreshAt = fx.lastFtpRefreshAt; }
    if (fx.ftpCacheKey) { p.ftpCacheKey = fx.ftpCacheKey; }
    if (fx.sysInfo) { p.sysInfo = fx.sysInfo; }
    if (fx.lastSystemInfoRefreshAt) { p.lastSystemInfoRefreshAt = fx.lastSystemInfoRefreshAt; }
    if (fx.runtimeConsoleStatus) { p.runtimeConsoleStatus = fx.runtimeConsoleStatus; }
    if (fx.runtimeErrorContext) { p.setRuntimeErrorContext(fx.runtimeErrorContext); }
    if (fx.compileStale) { p.setCompileStale(staleAsList ? [fx.compileStale] : fx.compileStale); }
    if (fx.expected) { p.setExpectedProjectContext(fx.expected[0], fx.expected[1]); }
    if (fx.salt) { p.sectionLayoutSalt = fx.salt; }
    mock.debug.breakpoints = (fx.editorBps || []).map(([fsPath, line]) => Object.assign(new mock.SourceBreakpoint(), {
        enabled: true, location: { uri: { scheme: 'file', fsPath }, range: { start: { line: line - 1 } } },
    }));
    p.setEditorBreakpointTargetResolver((fsPath, line) => ({ file: path.basename(fsPath), line }));
}

// ── 5. 비교 ───────────────────────────────────────────────
let failures = 0, checks = 0;
function compare(label, a, b) {
    checks++;
    if (a === b) { return; }
    failures++;
    const al = String(a).split('\n'), bl = String(b).split('\n');
    let i = 0;
    while (i < Math.max(al.length, bl.length) && al[i] === bl[i]) { i++; }
    console.log(`DIFF ${label} (줄 ${i + 1})\n  old: ${al[i]}\n  new: ${bl[i]}`);
}

async function main() {
    stageAndCompile();
    freezeDate();
    const { Old, New, detectPauseTransition } = loadModules();
    env.cfg = CFG;
    env.listDir = async (host, p) => {
        if (p.endsWith('/Bad')) { throw new Error('boom'); }
        return [{ name: 'inner.gpl', isDirectory: false, size: 99, modifiedAt: new Date('2026-01-02T03:04:05Z') }, { name: 'sub', isDirectory: true, size: 0 }, { name: '..', isDirectory: true, size: 0 }];
    };

    for (const [name, fx] of FIXTURES) {
        const o = new Old(), n = new New();
        apply(o, fx); apply(n, fx, NEW_STALE_AS_LIST);
        compare(`${name} :: tree`, await dumpTree(o), await dumpTree(n));
        compare(`${name} :: threadReport`, o.buildThreadReportMarkdown(), n.buildThreadReportMarkdown());
        for (const [di, deploy] of DEPLOYS.entries()) {
            for (const [ci, rc] of CONSOLE_OVERRIDES.entries()) {
                const extra = { deploySnapshot: deploy, runtimeConsoleStatus: rc };
                compare(`${name} :: situation[deploy#${di},console#${ci}]`, o.buildSituationSnapshotMarkdown(extra), n.buildSituationSnapshotMarkdown(extra));
                compare(`${name} :: diagnostic[deploy#${di},console#${ci}]`, o.buildDiagnosticSnapshotMarkdown(extra), n.buildDiagnosticSnapshotMarkdown(extra));
            }
        }
        compare(`${name} :: situation(no extra)`, o.buildSituationSnapshotMarkdown(), n.buildSituationSnapshotMarkdown());
        compare(`${name} :: diagnostic(no extra)`, o.buildDiagnosticSnapshotMarkdown(), n.buildDiagnosticSnapshotMarkdown());
    }

    // 원격 폴더 펼침(중첩 FTP) — 정상/실패
    for (const bad of [false, true]) {
        const o = new Old(), n = new New();
        const fx = { ...base, ftpEntries: [...ftpFiles, { name: 'Bad', isDirectory: true, size: 0 }], ftpFlashEntries: flashFiles };
        apply(o, fx); apply(n, fx, NEW_STALE_AS_LIST);
        const grab = async (p) => {
            const [, , , , ftp, flash] = await p.getChildren();
            const out = [];
            for (const sec of [ftp, flash]) {
                for (const k of sec.children) {
                    if (bad !== (k.label === 'Bad') && !bad) { /* 모든 폴더를 펼친다 */ }
                    const kids = await p.getChildren(k);
                    out.push(JSON.stringify(norm(p.getTreeItem(k))), ...kids.map(x => JSON.stringify(norm(p.getTreeItem(x)))));
                }
            }
            return out.join('\n');
        };
        compare(`nested-ftp[bad=${bad}]`, await grab(o), await grab(n));
    }

    // 시스템 정보 조회(refreshSystemInfo) — 응답 조합별
    const TEMP_OK = '<STATUS>0</STATUS>';
    const sysScenarios = {
        full: { 'Show Memory': '<DATA>Total: 64.00 MB\nFree: 12.34 MB</DATA><STATUS>0</STATUS>', 'Show Flash Free': '<DATA>Flash disk, 512 MB\nFree: 300 MB</DATA><STATUS>0</STATUS>', 'Show CPU Profile': '<DATA>CPU usage 37.5 %\nmore</DATA><STATUS>0</STATUS>', 'Show Temperature': '<DATA>CPU 0: 41.5 C\nRobot 1:\nAmp 1: 0 C\nAmp 2: 55 C</DATA><STATUS>0</STATUS>' },
        none: {},
        memNoFree: { 'Show Memory': 'just text line\nsecond', 'Show Flash Free': 'Type X, free 5 MB', 'Show CPU Profile': 'no percent here\nline2', 'Show Temperature': TEMP_OK },
        tempBadFormat: { 'Show Memory': '<DATA>Free: 1 MB</DATA><STATUS>0</STATUS>', 'Show Temperature': '<DATA>whatever</DATA><STATUS>0</STATUS>' },
        tempFail: { 'Show Temperature': '<STATUS>-714</STATUS>' },
        flashTypeOnly: { 'Show Flash Free': '<DATA>Flash disk only</DATA><STATUS>0</STATUS>' },
    };
    for (const [sn, resp] of Object.entries(sysScenarios)) {
        env.responses = resp;
        const o = new Old(), n = new New();
        apply(o, base); apply(n, base, NEW_STALE_AS_LIST);
        await o.refreshSystemInfo(); await n.refreshSystemInfo();
        compare(`refreshSystemInfo[${sn}] :: sysInfo`, JSON.stringify(norm(o.sysInfo)), JSON.stringify(norm(n.sysInfo)));
        compare(`refreshSystemInfo[${sn}] :: timestamps`, `${o.lastSystemInfoRefreshAt}|${o.systemInfoCacheKey}`, `${n.lastSystemInfoRefreshAt}|${n.systemInfoCacheKey}`);
        compare(`refreshSystemInfo[${sn}] :: tree`, await dumpTree(o), await dumpTree(n));
        compare(`refreshSystemInfo[${sn}] :: situation`, o.buildSituationSnapshotMarkdown(), n.buildSituationSnapshotMarkdown());
    }
    env.responses = {};

    // 정지 전이 감지 — 옛 firePauseTransitions / 새 provider / 분리 모듈(detectPauseTransition) 3자 비교
    const S = (name, state) => ({ name, state, lastStatus: '0', project: 'p', file: '' });
    const pauseCases = [
        [[], []], [[], [S('a', 'Paused')]], [[S('a', 'Running')], [S('a', 'Paused')]], [[S('a', 'Paused')], [S('a', 'Paused')]],
        [[S('a', 'Paused')], [S('a', 'Break')]], [[S('a', 'Running')], [S('a', 'Error')]], [[S('a', 'Running')], [S('a', 'Break')]],
        [[S('a', 'Running'), S('b', 'Running')], [S('a', 'Paused'), S('b', 'Break')]], [[S('a', 'Running'), S('b', 'Idle')], [S('a', 'Running'), S('b', 'Paused')]],
        [[S('a', 'Stopped')], [S('a', 'Stopped')]], [[S('a', 'Paused')], [S('a', 'Running')]], [[S('a', 'Paused')], []],
        [[S('a', 'Running')], [S('b', 'Paused'), S('a', 'Paused')]], [[S('a', 'Idle')], [S('a', 'Unknown')]],
    ];
    const fired = (P, prev, next) => { const p = new P(); const ev = []; p.onDidThreadPause(e => ev.push(e)); p.firePauseTransitions(prev, next); return JSON.stringify(ev); };
    for (const [i, [prev, next]] of pauseCases.entries()) {
        const a = fired(Old, prev, next), b = fired(New, prev, next);
        const d = detectPauseTransition(prev, next);
        compare(`pauseTransition#${i} old-vs-new provider`, a, b);
        compare(`pauseTransition#${i} old-vs-detectPauseTransition`, a, JSON.stringify(d ? [d] : []));
    }

    console.log(`\n비교 ${checks}건, 차이 ${failures}건 (기준 ${BASE}, fixture ${FIXTURES.length}개 × deploy ${DEPLOYS.length} × console 2)`);
    if (!KEEP) { fs.rmSync(STAGE, { recursive: true, force: true }); }
    process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
