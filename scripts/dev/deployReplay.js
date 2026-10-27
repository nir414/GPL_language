/**
 * 배포 파이프라인 old-vs-new 재생(replay) 하니스.
 *
 * 목적: `deployLocked` 단일 함수를 단계 모듈로 쪼갠 리팩터링(2026-10-27)이 동작을 바꾸지 않았음을
 * 문자열·호출 집합 비교가 아니라 **순서 있는 이벤트 로그의 동일성**으로 증명한다. 기준(old)은 분리 직전 커밋의
 * 소스를 임시 디렉터리에 풀어 컴파일한 것이고, 대상(new)은 현재 작업 트리의 `out/` 이다.
 *
 * 구조
 *  - 드라이버(기본): 시나리오마다 old/new 를 각각 **별도 자식 프로세스**로 돌리고(모듈 캐시·전역 상태 격리),
 *    두 이벤트 로그를 순서대로 비교해 첫 차이를 보고한다. 하나라도 다르면 종료 코드 1.
 *  - 자식(--child): vscode 모의 · 가상 시계(setTimeout/Date.now) · 1402 소켓 계층(consoleSocket.sendConsoleCommand) ·
 *    FTP 계층(ftpClient) · 배포 잠금/작업 기록 관찰을 주입하고 `deploy()` 를 시나리오대로 구동한다. 실제 네트워크는
 *    `net.Socket.connect` 를 막아 절대 나가지 않는다.
 *  - 시나리오 정의는 `deployReplayScenarios.js`. 기록 항목: 제어기 명령(+전송 옵션) · FTP 호출 · Output 줄 ·
 *    모달/확인 콜백 · DeployResult(JSON) · 잠금 단계 전이 · 작업 기록 전이 · 타이머 요청(ms) · 진단/vscode 호출 ·
 *    모든 이벤트에 가상 시각(t)을 붙여 대기 시간(타이밍) 차이도 잡는다.
 *
 * 사용법 (먼저 `npm run compile` 로 out/ 을 만든다):
 *   node scripts/dev/deployReplay.js                      # 전체 시나리오 old vs new
 *   node scripts/dev/deployReplay.js success upload-only  # 지정 시나리오만
 *   node scripts/dev/deployReplay.js --list               # 시나리오 목록
 *   node scripts/dev/deployReplay.js --dump <name>        # old/new 로그를 파일로 남기고 경로 출력
 *   node scripts/dev/deployReplay.js --old-rev <sha>      # 기준 커밋 변경(기본 6882714)
 *   node scripts/dev/deployReplay.js --rebuild            # 기준 트리 캐시 다시 빌드
 *   node scripts/dev/deployReplay.js --self-check         # old vs old 비교(하니스 결정성 점검)
 * 기준 트리 캐시: %TEMP%/gpl-deploy-replay/build-<rev> (환경변수 GPL_REPLAY_CACHE 로 변경).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const DEFAULT_OLD_REV = '6882714';
const CACHE_ROOT = process.env.GPL_REPLAY_CACHE || path.join(os.tmpdir(), 'gpl-deploy-replay');
const T0 = 1_760_000_000_000; // 가상 시계 시작(epoch ms)

// ───────────────────────────── 드라이버 ─────────────────────────────

function ensureOldBuild(rev, rebuild) {
    const dir = path.join(CACHE_ROOT, `build-${rev}`);
    const marker = path.join(dir, 'out', 'controller', 'deployment', 'deployService.js');
    if (!rebuild && fs.existsSync(marker)) { return path.join(dir, 'out'); }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const tar = path.join(dir, 'src.tar');
    cp.execFileSync('git', ['archive', '--format=tar', '-o', tar, rev, 'src'], { cwd: REPO, stdio: 'inherit' });
    cp.execFileSync('tar', ['-xf', 'src.tar'], { cwd: dir, stdio: 'inherit' });
    fs.rmSync(tar, { force: true });
    const nm = path.join(REPO, 'node_modules').replace(/\\/g, '/');
    const tsconfig = {
        compilerOptions: {
            target: 'ES2020', module: 'node16', moduleResolution: 'node16', lib: ['ES2020'],
            outDir: './out', rootDir: './src', strict: true, esModuleInterop: true, skipLibCheck: true,
            resolveJsonModule: true, noEmitOnError: false, typeRoots: [`${nm}/@types`],
            baseUrl: '.', paths: { '*': [`${nm}/*`, `${nm}/@types/*`] },
        },
        include: ['src/**/*'], exclude: ['src/test'],
    };
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
    console.log(`[replay] ${rev} 트리를 컴파일합니다(수십 초)…`);
    const r = cp.spawnSync(process.execPath, [path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', dir], { encoding: 'utf8' });
    if (!fs.existsSync(marker)) {
        console.error(r.stdout, r.stderr);
        throw new Error('기준 트리 컴파일 실패');
    }
    if (r.status !== 0) { console.warn('[replay] tsc 경고(산출물은 생성됨):\n' + (r.stdout || '').split('\n').slice(0, 5).join('\n')); }
    return path.join(dir, 'out');
}

function runChildProcess(treeOut, scenario, label) {
    const outFile = path.join(CACHE_ROOT, `log-${label}-${scenario}.json`);
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    fs.rmSync(outFile, { force: true });
    const r = cp.spawnSync(process.execPath, [__filename, '--child', treeOut, scenario, outFile], { encoding: 'utf8', timeout: 120000 });
    if (!fs.existsSync(outFile)) {
        throw new Error(`자식 프로세스 실패(${label}/${scenario}): ${r.stderr || r.stdout}`);
    }
    return { outFile, log: JSON.parse(fs.readFileSync(outFile, 'utf8')), stderr: r.stderr };
}

function canon(ev) {
    // 키 순서가 달라도 같은 내용이면 같게 본다(DeployResult 키 순서는 별도 항목으로 보고).
    return JSON.stringify(ev, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v));
}

function diffLogs(a, b) {
    const diffs = [];
    const n = Math.max(a.events.length, b.events.length);
    for (let i = 0; i < n; i++) {
        const x = a.events[i], y = b.events[i];
        if (x === undefined || y === undefined || canon(x) !== canon(y)) {
            diffs.push({ index: i, old: x, new: y });
            if (diffs.length >= 3) { break; }
        }
    }
    return diffs;
}

function driver(argv) {
    const { SCENARIOS } = require('./deployReplayScenarios.js');
    const flag = (name) => { const i = argv.indexOf(name); if (i < 0) { return undefined; } const v = argv[i + 1]; argv.splice(i, 2); return v; };
    const has = (name) => { const i = argv.indexOf(name); if (i < 0) { return false; } argv.splice(i, 1); return true; };
    if (has('--list')) { for (const s of SCENARIOS) { console.log(`${s.name.padEnd(28)} ${s.desc}`); } return 0; }
    const oldRev = flag('--old-rev') || DEFAULT_OLD_REV;
    const dump = flag('--dump');
    const rebuild = has('--rebuild');
    const selfCheck = has('--self-check');
    const names = dump ? [dump] : (argv.length ? argv : SCENARIOS.map(s => s.name));
    const newOut = path.join(REPO, 'out');
    if (!fs.existsSync(path.join(newOut, 'controller', 'deployment', 'deployService.js'))) {
        console.error('out/ 이 없습니다 — 먼저 npm run compile'); return 2;
    }
    const oldOut = ensureOldBuild(oldRev, rebuild);
    const rightOut = selfCheck ? oldOut : newOut;
    let failed = 0;
    for (const name of names) {
        if (!SCENARIOS.find(s => s.name === name)) { console.error(`알 수 없는 시나리오: ${name}`); failed++; continue; }
        // Windows 에서 임시 파일 rename 이 백신 등으로 EPERM 이 나는 환경 잡음은 하니스 문제이므로 3회까지 다시 돌린다.
        let o, n, diffs, tries = 0;
        do {
            o = runChildProcess(oldOut, name, 'old');
            n = runChildProcess(rightOut, name, 'new');
            diffs = diffLogs(o.log, n.log);
            tries++;
        } while (diffs.length > 0 && tries < 3 && /EPERM|EBUSY/.test(JSON.stringify([o.log.error, n.log.error, diffs])));
        if (tries > 1) { console.log(`  (환경 잡음 EPERM/EBUSY 로 ${tries}회 재시도)`); }
        const kinds = {};
        for (const e of o.log.events) { kinds[e.k] = (kinds[e.k] || 0) + 1; }
        const res = (o.log.events.find(e => e.k === 'result') || {}).json;
        const outcome = res ? (res.success ? 'OK' : (res.failedPhase || 'FAIL')) : 'NO-RESULT';
        const summary = `${outcome.padEnd(16)} events old=${o.log.events.length} new=${n.log.events.length}; cmds=${kinds.cmd || 0} ftp=${(kinds['ftp'] || 0)} out=${kinds.output || 0}`;
        if (diffs.length === 0) {
            console.log(`IDENTICAL  ${name.padEnd(28)} ${summary}`);
        } else {
            failed++;
            console.log(`DIFFERS    ${name.padEnd(28)} ${summary}`);
            for (const d of diffs) {
                console.log(`  @${d.index}\n    old: ${d.old === undefined ? '(없음)' : canon(d.old)}\n    new: ${d.new === undefined ? '(없음)' : canon(d.new)}`);
            }
        }
        if (o.log.error || n.log.error) { console.log(`  harness/deploy error old=${o.log.error || '-'} new=${n.log.error || '-'}`); }
        if (dump) { console.log(`  old: ${o.outFile}\n  new: ${n.outFile}`); }
    }
    console.log(failed === 0 ? '\nALL IDENTICAL' : `\n${failed} scenario(s) DIFFER`);
    return failed === 0 ? 0 : 1;
}

// ───────────────────────────── 자식(재생) ─────────────────────────────

async function child(treeOut, scenarioName, outFile) {
    const Module = require('module');
    const net = require('net');
    const { SCENARIOS, gprFiles } = require('./deployReplayScenarios.js');
    const scenario = SCENARIOS.find(s => s.name === scenarioName);
    const events = [];
    let now = T0;
    const triggers = (scenario.triggers ?? []).map(t => ({ ...t, fired: false }));
    const mods = {};
    const log = (k, data) => {
        const ev = { t: now - T0, k, ...data };
        events.push(ev);
        if (k === 'output') { const m = /\(pid 4242, (\S+)\)/.exec(ev.line || ''); if (m) { mods.lastOperationId = m[1]; } }
        for (const t of triggers) {
            if (!t.fired && t.when(ev, env)) { t.fired = true; events.push({ t: now - T0, k: 'trigger', name: t.name }); t.do(env, mods); }
        }
    };

    // 작업 디렉터리 — 시나리오별 고정 경로라 old/new 로그의 경로가 같다.
    const runRoot = path.join(CACHE_ROOT, 'run', scenarioName);
    fs.rmSync(runRoot, { recursive: true, force: true });
    for (const d of ['tmp', 'ops', 'proj']) { fs.mkdirSync(path.join(runRoot, d), { recursive: true }); }
    process.env.TEMP = process.env.TMP = process.env.TMPDIR = path.join(runRoot, 'tmp');
    process.env.GPL_LOCK_DIR = path.join(runRoot, 'ops');

    Object.defineProperty(process, 'pid', { value: 4242 }); // 작업 id 에 pid 가 들어가므로 고정
    // 네트워크 차단 — 실제 제어기에는 어떤 경로로도 접속하지 않는다.
    net.Socket.prototype.connect = function () { throw new Error('REPLAY_NETWORK_BLOCKED'); };

    // ── 가상 시계 ──
    const RealDate = Date;
    const realSetImmediate = setImmediate;
    const timers = new Map();
    let timerSeq = 0;
    class VDate extends RealDate {
        constructor(...a) { if (a.length) { super(...a); } else { super(now); } }
        static now() { return now; }
    }
    global.Date = VDate;
    const mkTimer = (fn, ms, args, repeat) => {
        const id = ++timerSeq;
        const delay = Math.max(0, Number.isFinite(+ms) ? Math.floor(+ms) : 0);
        const rec = { id, fn, args, due: now + delay, delay, repeat, seq: id };
        timers.set(id, rec);
        const handle = { _id: id, ref() { return handle; }, unref() { return handle; }, hasRef() { return true; }, refresh() { return handle; }, [Symbol.toPrimitive]() { return id; } };
        return { handle, rec };
    };
    global.setTimeout = (fn, ms, ...args) => { log('timer', { ms: Math.max(0, Math.floor(+ms || 0)) }); return mkTimer(fn, ms, args, false).handle; };
    global.setInterval = (fn, ms, ...args) => { log('interval', { ms: Math.floor(+ms || 0) }); return mkTimer(fn, ms, args, true).handle; };
    const clear = (h) => { const id = h && typeof h === 'object' ? h._id : h; timers.delete(id); };
    global.clearTimeout = clear; global.clearInterval = clear;
    const sleep = (ms) => new Promise(resolve => global.setTimeout(resolve, ms));

    const fireNextTimer = () => {
        let best;
        for (const t of timers.values()) { if (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq)) { best = t; } }
        if (!best) { return false; }
        if (best.due > now) { now = best.due; }
        if (best.repeat) { best.due = now + Math.max(1, best.delay); best.seq = ++timerSeq; } else { timers.delete(best.id); }
        best.fn(...best.args);
        return true;
    };
    const settle = async (promise, label) => {
        let done = false, value, error;
        promise.then(v => { done = true; value = v; }, e => { done = true; error = e; });
        let idleLoops = 0, steps = 0;
        while (!done) {
            await new Promise(r => realSetImmediate(r));
            if (done) { break; }
            if (++steps > 200000) { throw new Error(`REPLAY_STEP_LIMIT(${label})`); }
            if (!fireNextTimer()) {
                if (++idleLoops > 400) { throw new Error(`REPLAY_DEADLOCK(${label}) — 대기 중인 타이머 없음`); }
                await new Promise(r => realSetTimeoutShim(r, 2));
            } else { idleLoops = 0; }
        }
        if (error) { throw error; }
        return value;
    };
    const realSetTimeoutShim = (fn, ms) => require('timers').setTimeout(fn, ms);

    // ── 시나리오 환경 ──
    const projName = scenario.project?.name ?? 'Proj';
    const projectDir = path.join(runRoot, 'proj', projName);
    const files = scenario.project?.files ?? gprFiles(projName);
    for (const [rel, text] of Object.entries(files)) {
        const p = path.join(projectDir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    }
    const env = {
        log, sleep, projectDir, projectName: projName, runRoot,
        counts: Object.create(null),
        state: {},
        token: scenario.token ? { isCancellationRequested: false } : undefined,
        now: () => now - T0,
        threads: (scenario.threads ?? []).map(r => r.slice()),
    };
    const settings = { ...(scenario.settings ?? {}) };
    const modal = scenario.modal ?? (() => undefined);

    // ── vscode 모의 ──
    const vscode = buildVscode(env, settings, modal, log);
    const origLoad = Module._load;
    Module._load = function (request) {
        if (request === 'vscode') { return vscode; }
        return origLoad.apply(this, arguments);
    };
    const reqTree = (rel) => require(path.join(treeOut, rel));

    // ── 계층별 가짜(seam) ──
    const consoleSocket = reqTree('controller/connection/consoleSocket.js');
    const ftpClient = reqTree('controller/files/ftpClient.js');
    const reachability = reqTree('controller/connection/reachability.js');
    const deployLock = reqTree('controller/deployment/deployLock.js');
    const deployRecord = reqTree('controller/deployment/deployRecord.js');
    const operationStore = reqTree('controller/automation/operationStore.js');
    const syncManifest = reqTree('controller/files/syncManifest.js');

    installController(consoleSocket, env, scenario, log, sleep);
    installFtp(ftpClient, syncManifest, env, scenario, log, sleep);
    reachability.probeTcpBanner = async (host, port) => {
        log('tcpBanner', { host, port });
        return { state: 'open', banner: scenario.ftpBanner ?? '220 RTEMS FTP server (Version 1.0) ready.' };
    };
    installObservers(deployLock, deployRecord, operationStore, env, log);

    Object.assign(mods, { deployLock, operationStore, tree: reqTree, ftpClient, syncManifest });
    if (scenario.preload) { scenario.preload(env, mods); }
    const deployService = reqTree('controller/deployment/deployService.js');
    mods.deployService = deployService;
    deployService.onDidUploadProgress(e => {
        const { progress, summary, ...rest } = e;
        log('uploadEvent', { ...rest, ...(progress ? { progress } : {}), ...(summary ? { summary } : {}) });
    });

    // 시간 기반 외부 사건(취소 요청·잠금 해제 등)
    for (const [atMs, fn] of scenario.timeline ?? []) {
        mkTimer(() => { log('timeline', { at: atMs }); fn(env, mods); }, atMs, [], false);
    }
    // 시나리오 사전 준비(예: 다른 창이 잠금을 쥐고 있음)
    if (scenario.prepare) { scenario.prepare(env, mods); }

    const options = materializeOptions(scenario.options ?? {}, env, log, sleep, projectDir);
    const output = vscode.window.createOutputChannel('GPL Deploy');
    output.__deploy = true;
    const diag = vscode.languages.createDiagnosticCollection('gpl-deploy');

    let result, error, result2;
    try {
        const first = deployService.deploy(options, output, diag, env.token);
        let second;
        if (scenario.second) {
            const o2 = materializeOptions(scenario.second.options ?? {}, env, log, sleep, projectDir);
            second = deployService.deploy(o2, output, diag, undefined);
        }
        [result, result2] = await settle(Promise.all([first, second]), 'deploy');
    } catch (e) {
        error = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e);
    }
    if (result) {
        log('result', { json: JSON.parse(JSON.stringify(result)) });
        log('resultKeys', { keys: Object.keys(result) });
    }
    if (result2) { log('result2', { json: JSON.parse(JSON.stringify(result2)) }); }
    if (scenario.after) { try { await settle(Promise.resolve(scenario.after(env, deployService, { vscode, log, result, diag, output })), 'after'); } catch (e) { error = `after: ${e}`; } }
    // 작업 기록 파일(최종 상태)
    const opsDir = process.env.GPL_LOCK_DIR;
    for (const f of fs.existsSync(opsDir) ? fs.readdirSync(opsDir).sort() : []) {
        const p = path.join(opsDir, f);
        if (fs.statSync(p).isFile() && /\.json$/.test(f)) {
            let json; try { json = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { json = '(parse error)'; }
            log('opFile', { name: f, json });
        }
    }
    fs.writeFileSync(outFile, JSON.stringify({ scenario: scenarioName, treeOut, error, events }, null, 1));
    process.exit(0);
}

/** 시나리오 옵션 중 문자열로 적힌 콜백('yes'/'no'/'throw'/{answer,delayMs})을 로그를 남기는 함수로 바꾼다. */
function materializeOptions(spec, env, log, sleep, projectDir) {
    const options = { projectDir, ...spec };
    if (options.changedFiles) { options.changedFiles = options.changedFiles.map(f => (f.startsWith('@') ? path.join(projectDir, f.slice(1)) : f)); }
    const wrap = (name) => {
        const s = spec[name];
        if (s === undefined) { return; }
        options[name] = async (...args) => {
            const a = typeof s === 'function' ? s(env, ...args) : s;
            log('callback', { name, args: args.map(x => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x)) });
            if (a && typeof a === 'object' && a.delayMs) { await sleep(a.delayMs); }
            const ans = a && typeof a === 'object' && 'answer' in a ? a.answer : a;
            if (ans === 'throw') { throw new Error('scripted callback failure'); }
            return ans === 'yes' || ans === true;
        };
    };
    for (const n of ['confirmStopOnActive', 'confirmUnverifiedController', 'confirmMemoryCritical']) { wrap(n); }
    if (spec.beforeStart !== undefined) {
        options.beforeStart = async () => {
            log('callback', { name: 'beforeStart' });
            if (spec.beforeStart === 'throw') { throw new Error('scripted beforeStart failure'); }
        };
    }
    return options;
}

function buildVscode(env, settings, modal, log) {
    const base = require('./vscodeMock.js');
    class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
    class Selection { constructor(a, b) { this.anchor = a; this.active = b; } }
    const channel = (name) => ({
        name,
        appendLine: (line) => { if (name === 'GPL Deploy') { log('output', { line }); } },
        append: (text) => { if (name === 'GPL Deploy') { log('output', { text }); } },
        show: (...a) => { if (name === 'GPL Deploy') { log('output.show', { args: a }); } },
        hide() { }, clear() { }, dispose() { }, replace() { },
    });
    const noop = () => undefined;
    const seen = new Set();
    const unknown = (path) => new Proxy(function () { }, {
        get: (t, p) => (p === 'then' ? undefined : p === Symbol.toPrimitive ? () => path : unknown(`${path}.${String(p)}`)),
        apply: () => { log('vscode.unknown', { call: path }); return undefined; },
        construct: () => ({}),
    });
    const config = (section) => ({
        get: (key, def) => { const full = section ? `${section}.${key}` : key; return full in settings ? settings[full] : def; },
        inspect: () => undefined, has: () => false, update: async () => undefined,
    });
    const doc = (p) => ({
        uri: base.Uri.file(p), lineCount: 100,
        lineAt: (i) => ({ text: '', range: new base.Range(i, 0, i, 0), firstNonWhitespaceCharacterIndex: 4 }),
    });
    const mock = {
        ...base,
        Diagnostic, Selection,
        DiagnosticSeverity: base.DiagnosticSeverity,
        TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
        ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
        StatusBarAlignment: { Left: 1, Right: 2 },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        ThemeColor: class { constructor(id) { this.id = id; } },
        Disposable: class { constructor(f) { this.f = f; } dispose() { this.f && this.f(); } static from() { return { dispose() { } }; } },
        workspace: {
            ...base.workspace,
            getConfiguration: (section) => config(section),
            openTextDocument: async (p) => { log('vscode.openTextDocument', { p: String(p) }); return doc(String(p)); },
            onDidChangeConfiguration: () => ({ dispose() { } }),
        },
        window: {
            ...base.window,
            createOutputChannel: (name) => channel(name),
            showWarningMessage: async (message, ...rest) => {
                const items = rest.filter(x => typeof x === 'string');
                const optionsArg = rest.find(x => x && typeof x === 'object');
                const answer = await modal(message, items, env, optionsArg);
                log('modal', { level: 'warning', message, items, modal: !!(optionsArg && optionsArg.modal), answer });
                return answer;
            },
            showInformationMessage: async (message, ...rest) => { log('modal', { level: 'info', message, items: rest.filter(x => typeof x === 'string') }); return undefined; },
            showErrorMessage: async (message, ...rest) => { log('modal', { level: 'error', message, items: rest.filter(x => typeof x === 'string') }); return undefined; },
            showTextDocument: async (d, o) => { log('vscode.showTextDocument', { file: d.uri && d.uri.fsPath, o }); return { selection: null, revealRange: (r, t) => log('vscode.revealRange', { t }) }; },
            withProgress: async (o, task) => task({ report: noop }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: noop }) }),
            createStatusBarItem: () => ({ show: noop, hide: noop, dispose: noop }),
            createTerminal: () => ({ show: noop, sendText: noop, dispose: noop }),
        },
        commands: {
            executeCommand: async (cmd, ...args) => { log('vscode.executeCommand', { cmd, args }); return undefined; },
            registerCommand: () => ({ dispose: noop }),
            getCommands: async () => [],
        },
        languages: {
            ...base.languages,
            createDiagnosticCollection: (name) => ({
                name,
                clear: () => log('diag.clear', {}),
                set: (uri, diags) => log('diag.set', { file: uri.fsPath, diags: (diags || []).map(d => ({ line: d.range.start.line, message: d.message, severity: d.severity, code: d.code, source: d.source })) }),
                delete: (uri) => log('diag.delete', { file: uri.fsPath }),
                dispose: noop,
            }),
        },
        env: { clipboard: { writeText: noop }, openExternal: noop, appName: 'replay' },
        extensions: { getExtension: () => undefined },
    };
    return new Proxy(mock, {
        get(t, p) {
            if (p in t || typeof p !== 'string') { return t[p]; }
            if (!seen.has(p)) { seen.add(p); log('vscode.unknownMember', { name: p }); }
            return unknown(`vscode.${p}`);
        },
    });
}

function fakeResponse(raw, over) {
    return {
        raw,
        meta: {
            responseComplete: true, bytesReceived: raw.length, lastChunkAt: '', idleTimeoutMs: 300,
            statusTagReceived: /<\/STATUS>/i.test(raw), dataTagClosed: /<\/DATA>/i.test(raw), extraIdleApplied: false,
            durationMs: 0, socketReused: false, socketKept: false, ...(over || {}),
        },
    };
}

function installController(consoleSocket, env, scenario, log, sleep) {
    consoleSocket.sendConsoleCommand = async (command, endpoint, options) => {
        const n = (env.counts[command] = (env.counts[command] || 0) + 1);
        log('cmd', {
            cmd: command, n, ip: endpoint.ip, port: endpoint.port,
            opts: {
                timeoutMs: options.timeoutMs, idleMs: options.idleMs, minResponseBytes: options.minResponseBytes,
                extraIdleMsOnIncomplete: options.extraIdleMsOnIncomplete, waitForStatusClose: options.waitForStatusClose,
            },
        });
        let out = scenario.respond ? scenario.respond(command, n, env) : undefined;
        if (out === undefined) { out = defaultRespond(command, n, env, scenario); }
        if (out && typeof out === 'object' && out.delayMs) { await sleep(out.delayMs); }
        if (out instanceof Error || (out && out.error)) {
            const err = out instanceof Error ? out : new Error(out.error);
            log('cmd.reject', { cmd: command, n, message: err.message });
            throw err;
        }
        const raw = typeof out === 'string' ? out : out.raw;
        const resp = fakeResponse(raw, typeof out === 'object' ? out.meta : undefined);
        log('cmd.resp', { cmd: command, n, raw, meta: resp.meta });
        return resp;
    };
}

const STATUS_OK = '<STATUS>0,"Success"</STATUS>';
function defaultRespond(command, n, env, scenario) {
    const c = command.trim();
    if (/^Show Thread/i.test(c)) {
        const rows = env.threads.map(([name, state]) => `${name}| ${state}| 0| ""| Proj| Main| 1| Main.gpl| 1`).join('\n');
        env.counts['__showThread'] = (env.counts['__showThread'] || 0) + 1;
        if (env.stopRequested && env.threads.length) {
            const after = scenario.settleAfterPolls ?? 1;
            if (env.counts['__showThread'] - (env.stopPollBase || 0) >= after) { env.threads.length = 0; }
        }
        return `<DATA>${rows}</DATA>${STATUS_OK}`;
    }
    if (/^Stop -all/i.test(c)) {
        env.stopRequested = true; env.stopPollBase = env.counts['__showThread'] || 0;
        return `<DATA></DATA>${STATUS_OK}`;
    }
    if (/^Show Memory/i.test(c)) { return `<DATA>Main Memory:\nFree: ${scenario.freeMb ?? 9.5} Mb\nUsed: 1 Mb</DATA>${STATUS_OK}`; }
    if (/^ErrorLog/i.test(c)) { return `<DATA>No active errors</DATA>${STATUS_OK}`; }
    return `<DATA></DATA>${STATUS_OK}`;
}

function listFiles(dir, base = dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { out.push(...listFiles(p, base)); } else { out.push(p); }
    }
    return out;
}

function installFtp(ftp, syncManifest, env, scenario, log, sleep) {
    const rel = (p) => (typeof p === 'string' ? p.replace(/\\/g, '/') : p);
    const spec = scenario.ftp ?? {};
    const mkManifest = (localDir, only) => {
        const m = {};
        for (const f of listFiles(localDir)) {
            if (only && !only.includes(path.resolve(f))) { continue; }
            const size = fs.statSync(f).size;
            m[path.relative(localDir, f).replace(/\\/g, '/').toLowerCase()] = { size, sha1: syncManifest.hashFileSync(f, size) };
        }
        return m;
    };
    const run = async (kind, localDir, options) => {
        const only = options && options.onlyFiles && options.onlyFiles.length ? options.onlyFiles.map(f => path.resolve(f)) : undefined;
        const list = listFiles(localDir).filter(f => !only || only.includes(path.resolve(f)));
        const totalBytes = list.reduce((s, f) => s + fs.statSync(f).size, 0);
        let doneBytes = 0, uploaded = 0, skipped = 0;
        for (let i = 0; i < list.length; i++) {
            if (options && options.isCancelled && options.isCancelled()) { throw new ftp.UploadCancelledError(); }
            if (spec.perFileMs) { await sleep(spec.perFileMs); }
            if (spec.failAtFile !== undefined && i === spec.failAtFile) { throw new Error(spec.failMessage ?? 'scripted FTP failure'); }
            const size = fs.statSync(list[i]).size;
            doneBytes += size;
            const action = spec.skipFiles && spec.skipFiles.includes(path.basename(list[i])) ? 'skipped' : 'uploaded';
            if (action === 'uploaded') { uploaded++; } else { skipped++; }
            options && options.onProgress && options.onProgress({
                type: 'file', action, doneBytes, totalBytes, doneFiles: i + 1, totalFiles: list.length,
                file: path.relative(localDir, list[i]).replace(/\\/g, '/'),
            });
        }
        return { uploaded, skipped, totalBytes, manifest: mkManifest(localDir, only) };
    };
    ftp.listRemoteDir = async (host, remotePath) => {
        env.state.ftpSession = true;
        log('ftp', { op: 'listRemoteDir', host, remotePath });
        const entry = spec.remote && Object.prototype.hasOwnProperty.call(spec.remote, remotePath) ? spec.remote[remotePath]
            : remotePath === '/GPL' ? [{ name: env.projectName, isDirectory: true, size: 0 }] : [{ name: env.projectName, isDirectory: true, size: 0 }];
        if (entry instanceof Error) { throw entry; }
        return entry;
    };
    ftp.getLastFtpBanner = (host) => (env.state.ftpSession ? { banner: scenario.ftpBanner ?? '220 RTEMS FTP server (Version 1.0) ready.', at: Date.now() } : undefined);
    ftp.uploadProject = async (host, localDir, remoteDir, options) => {
        env.state.ftpSession = true;
        log('ftp', {
            op: 'uploadProject', host, localDir, remoteDir, skipUnchanged: options && options.skipUnchanged,
            onlyFiles: options && options.onlyFiles && options.onlyFiles.map(rel),
            manifestFiles: Object.keys((options && options.manifest) || {}).length,
            hasOnProgress: !!(options && options.onProgress), hasIsCancelled: !!(options && options.isCancelled),
        });
        return run('upload', localDir, options);
    };
    ftp.mirrorProject = async (host, localDir, remoteDir, options) => {
        env.state.ftpSession = true;
        log('ftp', {
            op: 'mirrorProject', host, localDir, remoteDir, deferDelete: options && options.deferDelete,
            manifestFiles: Object.keys((options && options.manifest) || {}).length,
            hasOnProgress: !!(options && options.onProgress), hasIsCancelled: !!(options && options.isCancelled),
            hasOnDelete: !!(options && options.onDelete),
        });
        const stats = await run('mirror', localDir, options);
        return { ...stats, pendingDeletes: (spec.pendingDeletes ?? []).map(x => ({ ...x })) };
    };
    ftp.removeRemoteFiles = async (host, files, onDelete) => {
        log('ftp', { op: 'removeRemoteFiles', host, files: files.map(f => f.remotePath) });
        let deleted = 0;
        for (const f of files) {
            if (spec.deleteFailures && spec.deleteFailures.includes(f.remotePath)) { continue; }
            deleted++;
            onDelete && onDelete(f.remotePath);
        }
        return deleted;
    };
}

function installObservers(deployLock, deployRecord, operationStore, env, log) {
    const realGet = deployLock.getDeployLock;
    deployLock.getDeployLock = (ip) => {
        const lock = realGet(ip);
        return new Proxy(lock, {
            get(t, p) {
                if (p !== 'acquire') { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; }
                return (owner, stage, meta) => {
                    const r = t.acquire(owner, stage, meta);
                    log('lock.acquire', { ip, owner, stage, ok: r.ok, ...(r.ok ? {} : { holderStage: r.holder && r.holder.stage, local: r.local }) });
                    if (!r.ok) { return r; }
                    const h = r.handle;
                    const wrapped = {
                        get record() { return h.record; },
                        get released() { return h.released; },
                        setStage(s) { log('lock.setStage', { stage: s }); h.setStage(s); },
                        heartbeat() { log('lock.heartbeat', {}); h.heartbeat(); },
                        release() { log('lock.release', {}); h.release(); },
                    };
                    return { ...r, handle: wrapped };
                };
            },
        });
    };
    const realRecord = deployRecord.recordCompiled;
    deployRecord.recordCompiled = (rec) => {
        log('recordCompiled', { ip: rec.ip, projectName: rec.projectName, projectDir: rec.projectDir, compiledAt: rec.compiledAt, files: Object.keys(rec.files).sort() });
        return realRecord(rec);
    };
    const proto = operationStore.OperationHandle && operationStore.OperationHandle.prototype;
    if (proto) {
        for (const name of ['start', 'setPhase', 'complete', 'fail', 'cancel', 'describeTarget']) {
            const orig = proto[name];
            if (typeof orig !== 'function') { continue; }
            proto[name] = function (...args) { log('op.' + name, { args: args.map(a => (a && typeof a === 'object' ? JSON.parse(JSON.stringify(a)) : a)) }); return orig.apply(this, args); };
        }
    }
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    if (argv[0] === '--child') {
        child(argv[1], argv[2], argv[3]).catch(e => { console.error(e && e.stack || e); process.exit(3); });
    } else {
        process.exit(driver(argv));
    }
}
module.exports = { fakeResponse, defaultRespond };
