/**
 * deployReplay.js 가 old/new 에 똑같이 먹이는 시나리오 정의.
 *
 * 시나리오 필드(모두 선택)
 *  - desc, project{name,files}, options(DeployOptions 일부 — confirm* 은 'yes'/'no'/'throw'/{answer,delayMs}/함수),
 *    settings({'gpl.controller.x': v}), modal(message,items,env)→답, token(true 면 취소 토큰),
 *    threads([[name,state]]), settleAfterPolls, freeMb, ftpBanner, ftp{perFileMs,failAtFile,failMessage,
 *    pendingDeletes,deleteFailures,remote,skipFiles}
 *  - respond(cmd,n,env): undefined(기본 응답) | string | {raw,meta,delayMs} | Error — 제어기 명령 응답(1402)
 *  - triggers([{name,when(ev,env),do(env,mods)}]): 로그 이벤트에 반응하는 1회성 사건(취소 요청 등 — 순서가 결정적이다)
 *  - timeline([[가상ms, fn(env,mods)]]), preload(env,mods)(배포 모듈 로드 전 — 모듈 export 바꿔치기용), prepare(env,mods), second{options}, after(env,deployService,ctx)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OK = '<STATUS>0,"Success"</STATUS>';
const status = (code, msg, data = '') => `<DATA>${data}</DATA><STATUS>${code},"${msg}"</STATUS>`;
const COMPILE_ERR = status(-746, 'Compile errors', 'Main.gpl:12:(-303): Undefined symbol: foo\nUtil.gpl:3:(-741): Bad declaration');
const row = (n, s, last = '0', msg = '') => `${n}| ${s}| ${last}| "${msg}"| Proj| Main| 1| Main.gpl| 1`;
const resetError = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

/** Project.gpr + 소스 2개. over: {start, sources, libs}. */
function gprFiles(name, over) {
    const o = { start: 'Main', sources: ['Main.gpl', 'Util.gpl'], libs: [], ...(over || {}) };
    const gpr = ['ProjectBegin', `ProjectName="${name}"`, ...(o.start ? [`ProjectStart="${o.start}"`] : []),
        ...o.sources.map(x => `ProjectSource="${x}"`), ...o.libs.map(l => `ProjectLibrary="${l}"`), 'ProjectEnd', ''].join('\n');
    return {
        'Project.gpr': gpr,
        'Main.gpl': 'Module Main\n    Public Sub Main()\n    End Sub\nEnd Module\n',
        'Util.gpl': 'Module Util\n    Public Sub Helper()\n    End Sub\nEnd Module\n',
    };
}

// 트리거 술어
const onOut = (re) => (ev) => ev.k === 'output' && re.test(ev.line);
const onCmd = (cmd, n = 1) => (ev) => ev.k === 'cmd' && ev.cmd === cmd && ev.n === n;
const onResp = (cmd, n = 1) => (ev) => ev.k === 'cmd.resp' && ev.cmd === cmd && ev.n === n;
const onStage = (s) => (ev) => ev.k === 'lock.setStage' && ev.stage === s;
const cancelNow = (env) => { env.token.isCancellationRequested = true; };
const cancelAt = (name, when) => ({ name, when, do: cancelNow });

const SCENARIOS = [];
const add = (s) => SCENARIOS.push(s);
const BASE = { directGpl: true, skipStart: true };

// ───────────── 기본 경로 ─────────────
add({ name: 'success', desc: 'direct /GPL mirror → Stop → Compile → ErrorCheck (skipStart)', options: { ...BASE }, threads: [['Main', 'Running']] });
add({ name: 'success-no-threads', desc: '정지할 쓰레드 없음 + 정체 확인 끔', options: { ...BASE, verifyControllerIdentity: false } });
add({ name: 'success-skipunchanged-classic', desc: 'classic 경로(Unload→Load→Compile) skipUnchanged', options: { skipStart: true, skipUnchanged: true }, threads: [['Main', 'Running']] });
add({
    name: 'success-start',
    desc: '전체 Deploy & Run — Start(-compile -event) + beforeStart + 시작 뒤 감시',
    options: { ...BASE, skipStart: false, startConfirmed: true, startEventMode: true, postStartWatchMs: 1500, beforeStart: 'ok' },
    threads: [['Main', 'Running']],
    respond: (cmd, n, env) => {
        if (/^Start /.test(cmd)) { env.threads = [['Proj', 'Running']]; env.stopRequested = false; }
    },
});
add({
    name: 'start-runtime-error',
    desc: 'Start 뒤 메인 쓰레드가 Error 로 멈춤(runtimeError)',
    options: { ...BASE, skipStart: false, startConfirmed: true, postStartWatchMs: 3000, startEventMode: false },
    respond: (cmd, n, env) => {
        if (/^Start /.test(cmd)) { env.afterStart = true; }
        if (env.afterStart && /^Show Thread/.test(cmd)) { return `<DATA>${row('Proj', 'Error', '-1509', 'Divide by zero')}</DATA>${OK}`; }
        if (env.afterStart && /^ErrorLog/.test(cmd)) { return `<DATA>2026-10-27 -1509 Proj Divide by zero</DATA>${OK}`; }
    },
});
add({
    name: 'start-modal-yes', desc: 'Start 확인 모달 → Start 선택',
    options: { ...BASE, skipStart: false }, modal: () => 'Start',
});
add({
    name: 'start-modal-cancel', desc: 'Start 확인 모달 → 취소',
    options: { ...BASE, skipStart: false }, modal: () => undefined,
});
add({
    name: 'start-setting-off', desc: 'requireStartConfirmation=false 면 모달 없이 Start',
    options: { ...BASE, skipStart: false }, settings: { 'gpl.requireStartConfirmation': false, 'gpl.controller.requireStartConfirmation': false },
});
add({
    name: 'start-preflight-active', desc: 'Start 직전 정지 재확인에서 활성 쓰레드 발견(START 게이트)',
    options: { ...BASE, skipStart: false, startConfirmed: true },
    respond: (cmd, n, env) => {
        if (/^Show Thread/.test(cmd) && env.counts['Compile Proj'] >= 1) { return `<DATA>${row('Main', 'Running')}</DATA>${OK}`; }
    },
});
add({
    name: 'start-before-start-throw', desc: 'beforeStart 가 예외 — 경고하고 계속',
    options: { ...BASE, skipStart: false, startConfirmed: true, beforeStart: 'throw' },
});
add({
    name: 'group-no-start', desc: 'ProjectStart 없는 그룹 프로젝트 → Start -744',
    project: { name: 'Group', files: gprFiles('Group', { start: '' }) },
    options: { ...BASE, skipStart: false, startConfirmed: true },
    respond: (cmd) => (/^Start /.test(cmd) ? status(-744, '*Invalid start procedure*') : undefined),
});
add({
    name: 'group-no-start-skipstart', desc: 'ProjectStart 없는 그룹 — Compile 만(skipStart)',
    project: { name: 'Group', files: gprFiles('Group', { start: '' }) },
    options: { ...BASE },
});
add({
    name: 'start-fail-status', desc: 'Start 가 일반 오류 STATUS',
    options: { ...BASE, skipStart: false, startConfirmed: true },
    respond: (cmd) => (/^Start /.test(cmd) ? status(-1009, 'Start failed') : undefined),
});
add({
    name: 'skip-compile-start-ok', desc: 'Upload & Start(skipCompile) 성공 — Start -compile 이 컴파일',
    options: { ...BASE, skipStart: false, skipCompile: true, startConfirmed: true },
});
add({
    name: 'skip-compile-start-errors', desc: 'Upload & Start — Start -compile 응답에 컴파일 에러',
    options: { ...BASE, skipStart: false, skipCompile: true, startConfirmed: true },
    respond: (cmd) => (/^Start /.test(cmd) ? COMPILE_ERR : undefined),
});
add({
    name: 'skip-compile-classic', desc: 'Upload & Start 를 classic 경로로(Unload/Load 동기화만)',
    options: { skipStart: false, skipCompile: true, startConfirmed: true },
});

// ───────────── Upload Only ─────────────
add({
    name: 'upload-only', desc: 'Upload Only direct mirror — 원격 전용 파일 삭제 보류',
    options: { directGpl: true, uploadOnly: true }, ftp: { pendingDeletes: [{ remotePath: '/GPL/Proj/Old.gpl', relativePath: 'Old.gpl' }] },
});
add({ name: 'upload-only-classic', desc: 'Upload Only classic(uploadProject)', options: { uploadOnly: true } });
add({
    name: 'upload-only-fail', desc: 'Upload Only — FTP 실패', options: { directGpl: true, uploadOnly: true },
    ftp: { failAtFile: 1, failMessage: 'scripted 550 failure' },
});
add({
    name: 'upload-only-console-lost',
    desc: 'Upload Only — 명령 콘솔 확인 실패(CONTROLLER_CHECK), 확인 콜백 없음',
    options: { directGpl: true, uploadOnly: true },
    respond: (cmd) => (/^Show Thread/.test(cmd) ? new Error('connect ECONNREFUSED 192.168.0.1:1402') : undefined),
});
add({
    name: 'upload-only-console-lost-proceed', desc: 'Upload Only — 콘솔 확인 실패, 「그래도 진행」',
    options: { directGpl: true, uploadOnly: true, confirmUnverifiedController: 'yes' },
    respond: (cmd) => (/^Show Thread/.test(cmd) ? new Error('connect ECONNREFUSED 192.168.0.1:1402') : undefined),
});
add({
    name: 'upload-only-cancel-before-success', desc: 'Upload Only — 증적 뒤 취소',
    options: { directGpl: true, uploadOnly: true }, token: true,
    triggers: [cancelAt('after-provenance', onOut(/증적:/))],
});

// ───────────── 정체 확인 ─────────────
add({ name: 'identity-other-device', desc: 'FTP 배너가 PA 제어기가 아님 → CONTROLLER_CHECK', options: { ...BASE }, ftpBanner: '220 ProFTPD Server ready.' });
add({ name: 'identity-other-device-proceed', desc: '배너 불일치 + 「그래도 진행」', options: { ...BASE, confirmUnverifiedController: 'yes' }, ftpBanner: '220 ProFTPD Server ready.' });
add({ name: 'identity-other-device-no', desc: '배너 불일치 + 진행 거부', options: { ...BASE, confirmUnverifiedController: 'no' }, ftpBanner: '220 ProFTPD Server ready.' });
add({ name: 'identity-other-device-throw', desc: '배너 불일치 + 확인 콜백 예외', options: { ...BASE, confirmUnverifiedController: 'throw' }, ftpBanner: '220 ProFTPD Server ready.' });
add({
    name: 'identity-console-lost-full', desc: '전체 Deploy — Show Memory 실패 뒤 콘솔 확인도 실패',
    options: { ...BASE },
    respond: (cmd) => (/^(Show Memory|Show Thread)/.test(cmd) ? new Error('read ECONNRESET') : undefined),
});

// ───────────── 컴파일 ─────────────
add({
    name: 'compile-error-diag', desc: '컴파일 에러 → Problems 진단 + 힌트 + jumpToFirstCompileError',
    options: { ...BASE },
    respond: (cmd) => (/^Compile /.test(cmd) ? COMPILE_ERR : undefined),
    after: async (env, ds, ctx) => {
        ctx.log('jump.ret', { v: await ds.jumpToFirstCompileError(ctx.result.compileErrors, env.projectDir, m => ctx.log('jump.logError', { m })) });
        ctx.log('jump.ret2', { v: await ds.jumpToFirstCompileError(ctx.result.compileErrors, env.projectDir, m => ctx.log('jump.logError', { m }), { preserveFocus: true }) });
    },
});
add({
    name: 'compile-error-jump-off', desc: 'jumpToFirstError 설정 끔',
    options: { ...BASE }, settings: { 'gpl.deploy.jumpToFirstError': false },
    respond: (cmd) => (/^Compile /.test(cmd) ? COMPILE_ERR : undefined),
    after: async (env, ds, ctx) => { ctx.log('jump.ret', { v: await ds.jumpToFirstCompileError(ctx.result.compileErrors, env.projectDir, () => { }) }); },
});
add({
    name: 'compile-error-multi-candidate', desc: 'classic · 폴더명≠gpr명 — 후보 여러 개 순회(모두 실패)',
    project: { name: 'FolderX', files: gprFiles('GprName') }, options: { skipStart: true },
    respond: (cmd) => (/^Compile /.test(cmd) ? COMPILE_ERR : undefined),
});
add({
    name: 'compile-second-candidate-ok', desc: 'classic · 첫 후보 실패, 둘째 후보 성공',
    project: { name: 'FolderX', files: gprFiles('GprName') }, options: { skipStart: true },
    respond: (cmd) => (cmd === 'Compile GprName' ? status(-503, 'Project not found') : undefined),
});
add({
    name: 'compile-direct-508', desc: 'direct 모드에서 -508 — Save to Flash 안내',
    options: { ...BASE }, respond: (cmd) => (/^Compile /.test(cmd) ? status(-508, 'Project not found') : undefined),
});
add({
    name: 'compile-direct-745', desc: 'direct 모드에서 -745 already loaded', options: { ...BASE },
    respond: (cmd) => (/^Compile /.test(cmd) ? status(-745, 'Project already loaded') : undefined),
});
add({
    name: 'compile-classic-745', desc: 'classic · Compile -745 → Unload → Load → Compile 성공', options: { skipStart: true },
    respond: (cmd, n) => (/^Compile /.test(cmd) && n === 1 ? status(-745, 'Project already loaded') : undefined),
});
add({
    name: 'compile-classic-745-reload-fail', desc: 'classic · -745 복구 중 재컴파일도 실패', options: { skipStart: true },
    respond: (cmd, n) => (/^Compile /.test(cmd) ? (n === 1 ? status(-745, 'Project already loaded') : COMPILE_ERR) : undefined),
});
add({
    name: 'compile-classic-508', desc: 'classic · Compile -508 → Load → Compile 성공(Pre-check warning)', options: { skipStart: true },
    respond: (cmd, n) => (/^Compile /.test(cmd) && n === 1 ? status(-508, 'Project not found') : undefined),
});
add({
    name: 'compile-classic-508-fail', desc: 'classic · -508 복구 중 Load 실패', options: { skipStart: true },
    respond: (cmd, n) => {
        if (/^Compile /.test(cmd)) { return status(-508, 'Project not found'); }
        if (/^Load /.test(cmd) && n >= 2) { return status(-599, 'Load failed'); }
    },
});
add({
    name: 'classic-unload-750', desc: 'classic · Unload -750(쓰레드 실행 중) → 동기화 중단', options: { skipStart: true },
    respond: (cmd) => (/^Unload /.test(cmd) ? status(-750, 'Invalid when thread active') : undefined),
});
add({
    name: 'classic-unload-fail-continue', desc: 'classic · Unload 일반 실패는 경고 후 계속', options: { skipStart: true },
    respond: (cmd) => (/^Unload /.test(cmd) ? status(-700, 'Unload failed') : undefined),
});
add({
    name: 'classic-load-fail', desc: 'classic · Load 실패', options: { skipStart: true },
    respond: (cmd) => (/^Load /.test(cmd) ? status(-599, 'Load failed') : undefined),
});
add({
    name: 'classic-remote-list-fail', desc: 'classic · 원격 경로 목록 확인 불가', options: { skipStart: true },
    ftp: { remote: { '/GPL': new Error('550 list failed'), '/flash/projects': new Error('550 list failed') } },
});
add({
    name: 'classic-name-space-folder', desc: 'classic · 폴더명에 공백', project: { name: 'My Folder', files: gprFiles('MyName') }, options: { skipStart: true },
});
add({
    name: 'compile-transient-retry', desc: 'Compile 첫 응답이 일시적 -742 → 재시도 성공', options: { ...BASE },
    respond: (cmd, n) => (/^Compile /.test(cmd) && n === 1 ? status(-742, 'Transient') : undefined),
});
add({
    name: 'compile-no-status', desc: 'Compile 응답에 STATUS 없음', options: { ...BASE },
    respond: (cmd) => (/^Compile /.test(cmd) ? { raw: '<DATA>partial output', meta: { responseComplete: false, statusTagReceived: false } } : undefined),
});
add({
    name: 'compile-abort-alive', desc: 'Compile 중 ECONNRESET → COMPILE_ABORTED, 생존 확인 응답함', options: { ...BASE },
    respond: (cmd, n) => (/^Compile /.test(cmd) ? Object.assign(resetError(), { delayMs: 2500 }) : undefined),
});
add({
    name: 'compile-abort-dead', desc: 'Compile 중 ECONNRESET, 생존 확인도 무응답', options: { ...BASE },
    respond: (cmd, n, env) => {
        if (/^Compile /.test(cmd)) { env.dead = true; return resetError(); }
        if (env.dead && /^Show Thread/.test(cmd)) { return new Error('connect ECONNREFUSED'); }
    },
});
add({
    name: 'compile-abort-multi-candidate', desc: 'classic 다중 후보에서 첫 Compile 이 끊김 — 다음 후보로 안 감',
    project: { name: 'FolderX', files: gprFiles('GprName') }, options: { skipStart: true },
    respond: (cmd) => (/^Compile /.test(cmd) ? resetError() : undefined),
});
add({
    name: 'compile-warning-status', desc: 'Compile 성공 + non-blocking STATUS', options: { ...BASE },
    respond: (cmd) => (/^Compile /.test(cmd) ? status(-1901, 'warning') : undefined),
});

// ───────────── 활성 쓰레드 / 빠른 컴파일 / autoGate ─────────────
const QUICK = { directGpl: true, skipStart: true, skipStop: true };
add({ name: 'quick-threads-approve', desc: 'Quick Compile · 활성 쓰레드 · 사용자 승인 → Stop 후 진행', options: { ...QUICK, confirmStopOnActive: 'yes' }, threads: [['Main', 'Running']] });
add({ name: 'quick-threads-cancel', desc: 'Quick Compile · 활성 쓰레드 · 사용자 거부 → THREAD_CHECK', options: { ...QUICK, confirmStopOnActive: 'no' }, threads: [['Main', 'Running']] });
add({ name: 'quick-threads-throw', desc: 'Quick Compile · 확인 콜백 예외 → THREAD_CHECK', options: { ...QUICK, confirmStopOnActive: 'throw' }, threads: [['Main', 'Running']] });
add({ name: 'quick-threads-nocallback', desc: 'Quick Compile · 콜백 없음 → THREAD_CHECK', options: { ...QUICK }, threads: [['Main', 'Running']] });
add({
    name: 'quick-threads-approve-slow', desc: 'Quick Compile · 승인 대기 중 업로드 병행(콜백 지연)',
    options: { ...QUICK, confirmStopOnActive: { answer: 'yes', delayMs: 700 } }, threads: [['Main', 'Running']], ftp: { perFileMs: 300 },
});
add({ name: 'quick-settled-threads', desc: 'Quick Compile · 정지 계열 쓰레드만 남음(존재=활성)', options: { ...QUICK, confirmStopOnActive: 'no' }, threads: [['Main', 'Stopped']] });
add({ name: 'quick-clean', desc: 'Quick Compile · 쓰레드 없음', options: { ...QUICK } });
add({
    name: 'quick-probe-null', desc: 'Quick Compile · Show Thread 무응답 → 경고하고 계속',
    options: { ...QUICK }, respond: (cmd) => (/^Show Thread/.test(cmd) ? new Error('timeout') : undefined),
});
add({
    name: 'quick-approve-stop-stuck', desc: 'Quick Compile · 승인했지만 정지 미완료(STOP 실패)',
    options: { ...QUICK, confirmStopOnActive: 'yes' }, threads: [['Main', 'Running']], settleAfterPolls: 9999,
});
const AUTO = { directGpl: true, skipStart: true, skipStop: true, autoGate: true, lockOwner: undefined };
const changed = (env) => [path.join(env.projectDir, 'Main.gpl')];
add({
    name: 'autogate-clean-changed', desc: 'autoOnSave · 쓰레드 없음 · 변경 파일만 업로드 → Compile',
    options: { ...AUTO, changedFiles: ['@Main.gpl'] },
});
add({
    name: 'autogate-threads', desc: 'autoOnSave · 쓰레드 존재 → COMPILE_DEFERRED', options: { ...AUTO, changedFiles: ['@Main.gpl'] }, threads: [['Main', 'Stopped']],
});
add({
    name: 'autogate-active', desc: 'autoOnSave · 활성 쓰레드 → COMPILE_DEFERRED', options: { ...AUTO, changedFiles: ['@Main.gpl'] }, threads: [['Main', 'Running']],
});
add({
    name: 'autogate-probe-null', desc: 'autoOnSave · Show Thread 무응답 → COMPILE_DEFERRED', options: { ...AUTO, changedFiles: ['@Main.gpl'] },
    respond: (cmd) => (/^Show Thread/.test(cmd) ? new Error('timeout') : undefined),
});
add({
    name: 'autogate-no-folder', desc: 'autoOnSave · 원격 폴더 없음 → AUTO_GATE', options: { ...AUTO, changedFiles: ['@Main.gpl'] },
    ftp: { remote: { '/GPL': [] } },
});
add({
    name: 'autogate-probe-fail', desc: 'autoOnSave · /GPL 목록 실패 → UPLOAD 실패', options: { ...AUTO, changedFiles: ['@Main.gpl'] },
    ftp: { remote: { '/GPL': new Error('550 no list') } },
});
add({
    name: 'autogate-mirror', desc: 'autoOnSave(changedFiles 없음) mirror', options: { ...AUTO },
});
add({
    name: 'changed-folder-missing', desc: 'changedFiles + 폴더 없음 → classic 폴백(directGpl 폴백 줄)',
    options: { directGpl: true, skipStart: true, skipStop: true, changedFiles: ['@Main.gpl'] }, ftp: { remote: { '/GPL': [] } },
});
add({
    name: 'direct-create', desc: '최초 배포 — /GPL 폴더 없음 → FTP 생성 안내 + 재부팅 정황 힌트',
    options: { ...BASE }, ftp: { remote: { '/GPL': [] } },
    prepare: (env, mods) => { mods.tree('controller/connection/controllerConnection.js').noteCommandChannelLoss('192.168.0.1', Date.now() - 1000); },
});
add({
    name: 'direct-create-empty-gpl', desc: '/GPL 에 폴더가 하나도 없음(재부팅 정황)', options: { ...BASE },
    ftp: { remote: { '/GPL': [{ name: 'Other', isDirectory: false, size: 1 }] } },
    prepare: (env, mods) => { mods.tree('controller/connection/controllerConnection.js').noteCommandChannelLoss('192.168.0.1', Date.now() - 1000); },
});
add({ name: 'direct-probe-fail', desc: 'direct · /GPL 목록 실패 → /flash 폴백 없이 중단', options: { ...BASE }, ftp: { remote: { '/GPL': new Error('425 Cannot open data connection') } } });

// ───────────── 메모리 ─────────────
add({ name: 'mem-warning', desc: '업로드 전/Compile 직전 메모리 경고(3.2MB)', options: { ...BASE }, freeMb: 3.2 });
add({ name: 'mem-critical-no-callback', desc: '심각(1MB) · 확인 콜백 없음 → 경고만', options: { ...BASE }, freeMb: 1 });
add({ name: 'mem-critical-continue', desc: '심각 · 사용자 계속', options: { ...BASE, confirmMemoryCritical: 'yes' }, freeMb: 1 });
add({ name: 'mem-critical-cancel', desc: '심각 · 사용자 취소 → MEMORY_CHECK', options: { ...BASE, confirmMemoryCritical: 'no' }, freeMb: 1 });
add({ name: 'mem-critical-throw', desc: '심각 · 콜백 예외 → 취소로 취급', options: { ...BASE, confirmMemoryCritical: 'throw' }, freeMb: 1 });
add({ name: 'mem-critical-start-phase', desc: '심각 · skipCompile(start 단계) 사용자 취소', options: { ...BASE, skipStart: false, skipCompile: true, confirmMemoryCritical: 'no', startConfirmed: true }, freeMb: 1 });
add({
    name: 'mem-unknown', desc: 'Show Memory 실패 → unknown 경고', options: { ...BASE },
    respond: (cmd) => (/^Show Memory/.test(cmd) ? new Error('read ECONNRESET') : undefined),
});
add({
    name: 'mem-critical-after-stop', desc: '업로드 전엔 정상, 정지 뒤 심각(두 번째 측정)', options: { ...BASE, confirmMemoryCritical: 'yes' },
    threads: [['Main', 'Running']],
    respond: (cmd, n) => (/^Show Memory/.test(cmd) && n >= 2 ? `<DATA>Main Memory:\nFree: 0.5 Mb\nUsed: 9 Mb</DATA>${OK}` : undefined),
});

// ───────────── 정지(Stop) 절차 ─────────────
add({
    name: 'stop-752-settles', desc: 'Stop -all 이 -752(정지 진행 중) 후 settle 로 정지', options: { ...BASE }, threads: [['Main', 'Running']],
    respond: (cmd) => (/^Stop -all/.test(cmd) ? status(-752, 'Timeout stopping thread') : undefined),
});
add({
    name: 'stop-stuck', desc: '정지가 끝내 안 됨(settle 타임아웃·재시도·정지 불가 진단)', options: { ...BASE }, threads: [['Main', 'Running']],
    settleAfterPolls: 99999,
    respond: (cmd) => (/^Stop -all/.test(cmd) ? status(-752, 'Timeout stopping thread') : undefined),
});
add({
    name: 'stop-fail-status', desc: 'Stop -all 이 일반 오류 STATUS', options: { ...BASE }, threads: [['Main', 'Running']],
    respond: (cmd) => (/^Stop -all/.test(cmd) ? status(-500, 'Some failure') : undefined),
});
add({
    name: 'stop-no-response', desc: 'Stop -all 무응답', options: { ...BASE }, threads: [['Main', 'Running']],
    respond: (cmd) => (/^Stop -all/.test(cmd) ? new Error('timeout') : undefined),
});
add({
    name: 'stop-fail-upload-ok-gate', desc: '업로드 실패 + Stop 성공 → 경고 줄', options: { ...BASE }, threads: [['Main', 'Running']],
    ftp: { failAtFile: 0, failMessage: 'scripted 550' },
});
add({
    name: 'stop-fail-and-upload-fail', desc: '업로드 실패 + Stop 실패(업로드 실패 우선)', options: { ...BASE }, threads: [['Main', 'Running']],
    ftp: { failAtFile: 0, failMessage: 'scripted 550' }, respond: (cmd) => (/^Stop -all/.test(cmd) ? status(-500, 'Some failure') : undefined),
});
add({
    name: 'stop-slow-settle-upload-slow', desc: '업로드(느림)와 정지 확인의 동시 진행 순서', options: { ...BASE }, threads: [['A', 'Running'], ['B', 'Paused']],
    ftp: { perFileMs: 400 }, settleAfterPolls: 3,
});

// ───────────── 업로드 · 삭제 ─────────────
add({ name: 'upload-fail', desc: 'FTP 업로드 실패', options: { ...BASE }, ftp: { failAtFile: 1, failMessage: 'scripted 550 failure' } });
add({
    name: 'delete-pending', desc: '정지 확인 뒤 원격 전용 파일 삭제(일부 실패)', options: { ...BASE },
    ftp: {
        pendingDeletes: [{ remotePath: '/GPL/Proj/Old1.gpl', relativePath: 'Old1.gpl' }, { remotePath: '/GPL/Proj/Old2.gpl', relativePath: 'Old2.gpl' }],
        deleteFailures: ['/GPL/Proj/Old2.gpl'],
    },
});
add({
    name: 'delete-pending-cancel', desc: '원격 전용 파일 삭제 직전 취소', options: { ...BASE }, token: true,
    ftp: { pendingDeletes: [{ remotePath: '/GPL/Proj/Old1.gpl', relativePath: 'Old1.gpl' }] },
    triggers: [cancelAt('before-delete', onOut(/업로드·정지 확인 모두 완료/))],
});
add({
    name: 'delete-pending-cancel-after', desc: '삭제 뒤 취소', options: { ...BASE }, token: true,
    ftp: { pendingDeletes: [{ remotePath: '/GPL/Proj/Old1.gpl', relativePath: 'Old1.gpl' }] },
    triggers: [cancelAt('after-delete', (ev) => ev.k === 'ftp' && ev.op === 'removeRemoteFiles')],
});
add({ name: 'skip-files', desc: '일부 파일은 스킵(내용 동일)', options: { ...BASE }, ftp: { skipFiles: ['Util.gpl'] } });

// ───────────── Project.gpr / 이름 / 라이브러리 ─────────────
add({ name: 'no-gpr', desc: '.gpr 없음', project: { name: 'NoGpr', files: { 'Main.gpl': 'x' } }, options: { ...BASE } });
add({ name: 'gpr-name-space', desc: '프로젝트명에 공백', project: { name: 'Folder', files: gprFiles('My Proj') }, options: { ...BASE } });
add({
    name: 'gpr-sync-mismatch', desc: 'Project.gpr 소스 목록 ≠ 폴더(gprSyncMismatch)',
    project: { name: 'Proj', files: { ...gprFiles('Proj', { sources: ['Main.gpl', 'Missing.gpl'] }), 'Extra.gpl': 'Module Extra\nEnd Module\n' } },
    options: { ...BASE },
});
add({
    name: 'gpr-libraries', desc: 'ProjectLibrary 안/밖/미해결 안내',
    project: {
        name: 'Proj',
        files: {
            ...gprFiles('Proj', { libs: ['Lib\\Core', '..\\Outside\\Lib', 'Ghost\\Nothing'] }),
            'Lib/Core/Project.gpr': 'ProjectBegin\nProjectName="Core"\nProjectSource="Core.gpl"\nProjectEnd\n',
            'Lib/Core/Core.gpl': 'Module Core\nEnd Module\n',
        },
    },
    options: { ...BASE },
});
add({
    name: 'manifest-block', desc: '다운로드 사본(snapshot manifest)은 쓰기 차단(AUTO_GATE)',
    project: {
        name: 'Proj',
        files: {
            ...gprFiles('Proj'),
            '.gpl-controller-project.json': JSON.stringify({ kind: 'gpl-controller-project', version: 1, mode: 'snapshot', controllerHost: '192.168.0.1', sourceRemotePath: '/GPL/Proj', projectName: 'Proj', downloadedAt: '2026-10-01T00:00:00Z', files: [] }),
        },
    },
    options: { ...BASE },
});
add({
    name: 'manifest-host-mismatch', desc: 'manifest 의 제어기와 현재 대상이 다름',
    project: {
        name: 'Proj',
        files: {
            ...gprFiles('Proj'),
            '.gpl-controller-project.json': JSON.stringify({ kind: 'gpl-controller-project', version: 1, mode: 'live', controllerHost: '10.9.9.9', sourceRemotePath: '/GPL/Proj', projectName: 'Proj', downloadedAt: '2026-10-01T00:00:00Z', files: [] }),
        },
    },
    options: { ...BASE },
});

// ───────────── ErrorCheck ─────────────
add({
    name: 'errorlog-entries', desc: 'ErrorLog 에 항목', options: { ...BASE },
    respond: (cmd) => (/^ErrorLog/.test(cmd) ? `<DATA>2026-10-27 -1509 Proj Divide by zero\n2026-10-27 -200 No memory</DATA>${OK}` : undefined),
});
add({ name: 'errorlog-fail', desc: 'ErrorLog 읽기 실패(non-fatal)', options: { ...BASE }, respond: (cmd) => (/^ErrorLog/.test(cmd) ? new Error('timeout') : undefined) });

// ───────────── 잠금 · 대기열 · 멱등 ─────────────
/** 다른 프로세스(살아 있는 부모 pid)가 쥔 배포 잠금을 파일로 만든다. */
function foreignLock(env, mods, stage = 'COMPILE') {
    const lock = mods.deployLock.getDeployLock('192.168.0.1');
    fs.mkdirSync(path.dirname(lock.filePath), { recursive: true });
    fs.writeFileSync(lock.filePath, JSON.stringify({
        version: mods.deployLock.DEPLOY_LOCK_VERSION ?? 2, owner: 'Other Window Deploy', stage, since: Date.now(), heartbeat: Date.now(),
        pid: process.ppid, host: require('os').hostname(), operationId: 'deploy-foreign-1',
    }));
    env.foreignLockFile = lock.filePath;
}
const releaseForeign = (env) => { try { fs.unlinkSync(env.foreignLockFile); } catch { /* noop */ } };
add({
    name: 'lock-held-then-free', desc: '다른 창이 잠금 보유 → [Queue] 대기 → 해제 뒤 진행(LOCKED 대기)', options: { ...BASE },
    prepare: (env, mods) => foreignLock(env, mods), timeline: [[900, releaseForeign]],
});
add({
    name: 'lock-held-quiet', desc: 'autoGate(quiet) — 대기 줄 없음', options: { ...BASE, autoGate: true, skipStop: true },
    prepare: (env, mods) => foreignLock(env, mods), timeline: [[600, releaseForeign]],
});
add({
    name: 'lock-held-cancel', desc: '잠금 대기 중 취소 → CANCELLED(대기 중)', options: { ...BASE }, token: true,
    prepare: (env, mods) => foreignLock(env, mods, 'UPLOAD'),
    timeline: [[500, (env) => { env.token.isCancellationRequested = true; }]],
});
add({
    name: 'cancel-queued', desc: '시작 전 이미 취소됨', options: { ...BASE }, token: true, prepare: (env) => { env.token.isCancellationRequested = true; },
});
add({
    name: 'queue-two-deploys', desc: '같은 제어기 배포 두 건 — 뒤 요청은 QUEUED 후 순차', options: { ...BASE }, threads: [['Main', 'Running']],
    second: { options: { ...BASE, uploadOnly: true } },
});
add({
    name: 'idempotency-in-progress', desc: '같은 idempotencyKey 진행 중 → IN_PROGRESS', options: { ...BASE, idempotencyKey: 'KEY-1' },
    prepare: (env, mods) => { env.keep = mods.operationStore.beginOperation({ type: 'DEPLOY', controllerId: '192.168.0.1', idempotencyKey: 'KEY-1', phase: 'COMPILE' }); env.keep.start && env.keep.start('COMPILE'); },
});
add({
    name: 'op-meta', desc: '작업 메타(operationType·lockOwner·requestId·extensionInstanceId)', options: { ...BASE, operationType: 'CUSTOM', lockOwner: 'Custom Owner', requestId: 'req-7', extensionInstanceId: 'ext-instance-0001', idempotencyKey: 'KEY-2' },
});

// ───────────── 취소 지점별 ─────────────
const CANCEL_POINTS = [
    ['after-memory', onResp('Show Memory', 1)],
    ['at-identity-list', (ev) => ev.k === 'ftp' && ev.op === 'listRemoteDir'],
    ['before-upload', onOut(/━━ \[1\/3\] UPLOAD/)],
    ['mid-upload', (ev) => ev.k === 'uploadEvent' && ev.progress && ev.progress.doneFiles === 2],
    ['at-stop', onCmd('Stop -all', 1)],
    ['at-settle', onResp('Show Thread  -web', 1)],
    ['after-gate', onOut(/업로드·정지 확인 모두 완료/)],
    ['at-compile-stage', onStage('COMPILE')],
    ['mid-compile', onCmd('Compile Proj', 1)],
    ['after-compile', onOut(/컴파일 스냅샷 기록/)],
    ['at-errorcheck', onStage('ERROR_CHECK')],
    ['mid-errorlog', onCmd('ErrorLog', 1)],
    ['after-errorlog', onOut(/ErrorLog empty/)],
];
for (const [label, when] of CANCEL_POINTS) {
    add({
        name: `cancel-${label}`, desc: `취소 요청 @ ${label} (전체 Deploy · direct)`, options: { ...BASE }, token: true,
        threads: [['Main', 'Running']], ftp: { perFileMs: 50 }, triggers: [cancelAt(label, when)],
    });
}
add({
    name: 'cancel-mid-upload-slow', desc: '느린 업로드 중 가상 시간 취소(타임라인)', options: { ...BASE }, token: true,
    threads: [['Main', 'Running']], ftp: { perFileMs: 400 }, timeline: [[500, (env) => { env.token.isCancellationRequested = true; }]],
});
add({
    name: 'cancel-mid-compile-slow', desc: '긴 Compile 응답 대기 중 취소(타임라인)', options: { ...BASE }, token: true,
    respond: (cmd) => (/^Compile /.test(cmd) ? { raw: status(0, 'Success'), delayMs: 3000 } : undefined),
    timeline: [[1200, (env) => { env.token.isCancellationRequested = true; }]],
});
add({
    name: 'cancel-file-mid-compile', desc: '프로세스 간 취소 파일(deployCancellation)로 Compile 중 취소', options: { ...BASE },
    triggers: [{
        name: 'cancel-file', when: onCmd('Compile Proj', 1),
        do: (env, mods) => {
            const opId = mods.lastOperationId || 'deploy-1760000000000-4242-1';
            mods.tree('controller/deployment/deployCancellation.js').requestDeployCancellation({ operationId: opId, controllerId: '192.168.0.1', reason: '다른 창에서 취소' });
        },
    }],
});
add({
    name: 'cancel-classic-unload', desc: 'classic · Unload 응답 후 취소', options: { skipStart: true }, token: true, triggers: [cancelAt('unload', onCmd('Unload Proj', 1))],
});
add({
    name: 'cancel-classic-load', desc: 'classic · Load 응답 후 취소', options: { skipStart: true }, token: true, triggers: [cancelAt('load', (ev) => ev.k === 'cmd' && /^Load /.test(ev.cmd))],
});
add({
    name: 'cancel-classic-reload-compile', desc: 'classic · -745 복구 재Compile 후 취소', options: { skipStart: true }, token: true,
    respond: (cmd, n) => (/^Compile /.test(cmd) && n === 1 ? status(-745, 'Project already loaded') : undefined),
    triggers: [cancelAt('recompile', onCmd('Compile Proj', 2))],
});
const START_BASE = { ...BASE, skipStart: false, startConfirmed: false, postStartWatchMs: 1000, beforeStart: 'ok' };
const START_POINTS = [
    ['start-stage', onStage('START')],
    ['preflight-settle', (ev) => ev.k === 'cmd.resp' && ev.cmd === 'Show Thread  -web' && ev.n >= 3],
    ['before-start-hook', (ev) => ev.k === 'callback' && ev.name === 'beforeStart'],
    ['at-modal', (ev) => ev.k === 'modal'],
    ['after-start', (ev) => ev.k === 'cmd' && /^Start /.test(ev.cmd)],
    ['during-watch', onOut(/Start 뒤 메인 쓰레드 감시/)],
];
for (const [label, when] of START_POINTS) {
    add({
        name: `cancel-${label}`, desc: `취소 요청 @ ${label} (Start 경로)`, options: { ...START_BASE }, token: true, modal: () => 'Start',
        respond: (cmd, n, env) => { if (/^Start /.test(cmd)) { env.threads = [['Proj', 'Running']]; env.stopRequested = false; } },
        triggers: [cancelAt(label, when)],
    });
}

// ───────────── 커버리지 보강(분기 단위) ─────────────
const throwing = (msg) => () => { throw new Error(msg); };
add({
    name: 'idempotency-in-progress-live', desc: '살아 있는 pid 의 같은 idempotencyKey → IN_PROGRESS', options: { ...BASE, idempotencyKey: 'KEY-LIVE' },
    prepare: (env, mods) => {
        const op = mods.operationStore.beginOperation({ type: 'DEPLOY', controllerId: '192.168.0.1', idempotencyKey: 'KEY-LIVE', phase: 'COMPILE' }, { pid: process.ppid });
        op.start('COMPILE');
    },
});
add({
    name: 'locked-result-helper', desc: 'makeLockedResult 순수 함수(공개 API) 결과', options: { uploadOnly: true, directGpl: true },
    after: async (env, ds, ctx) => {
        const holder = { version: 2, owner: 'Other', stage: 'COMPILE', since: Date.now() - 5000, heartbeat: Date.now(), pid: 77, host: 'h', operationId: 'op-x' };
        ctx.log('lockedResult', { a: ds.makeLockedResult(holder, true), b: ds.makeLockedResult({ ...holder, operationId: undefined }) });
    },
});
add({
    name: 'deploy-throws-missing-dir', desc: '프로젝트 폴더가 사라져 deployLocked 가 예외 → 작업 기록 FAILED',
    options: { ...BASE }, prepare: (env) => { fs.rmSync(env.projectDir, { recursive: true, force: true }); },
});
add({
    name: 'cancel-before-send', desc: 'Compile 전송 직전 취소(projectIo.send 가드)', options: { ...BASE }, token: true,
    triggers: [cancelAt('candidates', onOut(/│ Candidates:/))],
});
add({
    name: 'cancel-after-second-memory', desc: '정지 뒤 메모리 재측정 응답 직후 취소', options: { ...BASE, confirmMemoryCritical: 'yes' }, token: true,
    triggers: [cancelAt('mem2', onResp('Show Memory', 2))],
});
const CLASSIC_745 = (extra) => (cmd, n, env) => {
    if (/^Compile /.test(cmd)) { return n === 1 ? status(-745, 'Project already loaded') : (extra && extra.compile2 ? extra.compile2(n) : undefined); }
    if (extra && extra.other) { return extra.other(cmd, n, env); }
};
add({
    name: 'classic-745-unload-fail', desc: 'classic · -745 복구의 Unload 실패 → 다음 후보로 continue', options: { skipStart: true },
    respond: CLASSIC_745({ other: (cmd, n) => (/^Unload /.test(cmd) && n >= 2 ? status(-700, 'Unload failed') : undefined) }),
});
add({
    name: 'classic-745-load-fail', desc: 'classic · -745 복구의 Load 실패 → continue', options: { skipStart: true },
    respond: CLASSIC_745({ other: (cmd, n) => (/^Load /.test(cmd) && n >= 2 ? status(-599, 'Load failed') : undefined) }),
});
add({
    name: 'classic-745-recompile-abort', desc: 'classic · -745 복구 재Compile 이 끊김(ECONNRESET)', options: { skipStart: true },
    respond: CLASSIC_745({ compile2: () => resetError() }),
});
add({
    name: 'cancel-745-unload', desc: 'classic · -745 복구 Unload 응답 직후 취소', options: { skipStart: true }, token: true,
    respond: CLASSIC_745(), triggers: [cancelAt('u2', onCmd('Unload Proj', 2))],
});
add({
    name: 'cancel-745-load', desc: 'classic · -745 복구 Load 응답 직후 취소', options: { skipStart: true }, token: true,
    respond: CLASSIC_745(), triggers: [cancelAt('l2', (ev) => ev.k === 'cmd' && /^Load /.test(ev.cmd) && ev.n === 2)],
});
const CLASSIC_508 = (extra) => (cmd, n, env) => {
    if (/^Compile /.test(cmd)) { return n === 1 ? status(-508, 'Project not found') : (extra && extra.compile2 ? extra.compile2(n) : undefined); }
    if (extra && extra.other) { return extra.other(cmd, n, env); }
};
add({
    name: 'classic-508-recompile-error', desc: 'classic · -508 복구 후 재Compile 이 컴파일 에러', options: { skipStart: true },
    respond: CLASSIC_508({ compile2: () => COMPILE_ERR }),
});
add({
    name: 'classic-508-recompile-abort', desc: 'classic · -508 복구 후 재Compile 이 끊김', options: { skipStart: true },
    respond: CLASSIC_508({ compile2: () => resetError() }),
});
add({
    name: 'cancel-508-load', desc: 'classic · -508 복구 Load 응답 직후 취소', options: { skipStart: true }, token: true,
    respond: CLASSIC_508(), triggers: [cancelAt('l2', (ev) => ev.k === 'cmd' && /^Load /.test(ev.cmd) && ev.n === 2)],
});
add({
    name: 'cancel-508-recompile', desc: 'classic · -508 복구 재Compile 응답 직후 취소', options: { skipStart: true }, token: true,
    respond: CLASSIC_508(), triggers: [cancelAt('c2', onCmd('Compile Proj', 2))],
});
add({
    name: 'cancel-745-recompile-abort', desc: 'classic · -745 복구 재Compile 도중 끊김 + 취소 없음', options: { skipStart: true },
    respond: CLASSIC_745({ compile2: () => Object.assign(resetError(), { delayMs: 800 }) }),
});
add({
    name: 'compile-nonblocking-status', desc: 'Compile 성공 + non-blocking STATUS(-1521)', options: { ...BASE },
    respond: (cmd) => (/^Compile /.test(cmd) ? status(-1521, 'environment warning') : undefined),
});
add({
    name: 'compile-error-hints', desc: '컴파일 에러에 소스 줄 기반 힌트(-741 선언 줄·-722 New X())',
    project: {
        name: 'Proj',
        files: { ...gprFiles('Proj'), 'Main.gpl': 'Module Main\n    Public Sub Main()\n        Dim x As Foo = New Foo()\n    End Sub\n    Public Function Bar(a As Number) As Number\n    End Function\nEnd Module\n' },
    },
    options: { ...BASE },
    respond: (cmd) => (/^Compile /.test(cmd) ? status(-746, 'Compile errors', 'Main.gpl:3:(-722): Unexpected text at end of line\nMain.gpl:5:(-741): Argument mismatch\nUtil.gpl:2:(-737): Too many errors') : undefined),
});
add({
    name: 'library-outside', desc: 'ProjectLibrary 가 폴더 밖에 실제로 존재(폴더 밖 경고)',
    project: {
        name: 'Proj',
        files: {
            ...gprFiles('Proj', { libs: ['..\\Outside\\Lib'] }),
            '../Outside/Lib/Project.gpr': 'ProjectBegin\nProjectName="Lib"\nProjectSource="Lib.gpl"\nProjectEnd\n',
            '../Outside/Lib/Lib.gpl': 'Module Lib\nEnd Module\n',
        },
    },
    options: { ...BASE },
});
add({
    name: 'changed-since-upload', desc: '업로드 직후 로컬 파일이 바뀜 → 증적 경고 줄', options: { ...BASE },
    triggers: [{ name: 'edit', when: (ev) => ev.k === 'uploadEvent' && ev.kind === 'end', do: (env) => fs.appendFileSync(path.join(env.projectDir, 'Main.gpl'), "' edited after upload\n") }],
});
add({
    name: 'snapshot-throws', desc: '컴파일 스냅샷 수집·증적 대조·기록이 모두 예외(무시하고 진행)', options: { ...BASE },
    preload: (env, mods) => { mods.tree('controller/deployment/deployRecordCore.js').snapshotProjectFiles = throwing('snapshot boom'); },
});
add({
    name: 'record-throws', desc: 'recordCompiled 가 예외(무시)', options: { ...BASE },
    preload: (env, mods) => { mods.tree('controller/deployment/deployRecord.js').recordCompiled = throwing('record boom'); },
});
add({
    name: 'gpr-sync-throws', desc: 'Project.gpr 대조 자체가 예외(무시하고 진행)', options: { ...BASE },
    preload: (env, mods) => { mods.tree('project/gpr/gprFolderSync.js').checkGprFolderSync = throwing('sync boom'); },
});
add({
    name: 'upload-event-order-quick-slow', desc: 'Quick Compile 승인 지연 + 느린 업로드 + 삭제 대기(병행 순서)',
    options: { ...QUICK, confirmStopOnActive: { answer: 'yes', delayMs: 350 } }, threads: [['Main', 'Running']],
    ftp: { perFileMs: 200, pendingDeletes: [{ remotePath: '/GPL/Proj/Old.gpl', relativePath: 'Old.gpl' }] },
});

module.exports = { SCENARIOS, gprFiles };
