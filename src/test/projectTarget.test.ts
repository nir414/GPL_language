import * as assert from 'assert';
import * as path from 'path';
import { test } from './harness';
import {
    resolveProjectTarget,
    isProjectTargetRequest,
    isAutomationInvocation,
    summarizeCandidates,
    describeResolution,
    describeCandidates,
    TargetCandidate,
} from '../controller/projectTarget';

// ── 픽스처 — 사용자 저장소 구조(개선안 §21)를 그대로 옮긴 것 ────────────────
// GPL_Code (ProjectStart="ORCH_Main.MAIN") + Lib_* 4개(라이브러리) + MyProject(별개 runnable)

const ROOT = path.join('c:', 'ws', 'projects');
const D = (...p: string[]): string => path.join(ROOT, ...p);

const MAIN: TargetCandidate = { dir: D('GPL_Code'), projectName: 'GPL_Code', runnable: true };
const LIB_CORE: TargetCandidate = { dir: D('GPL_Code', 'Lib_Core'), projectName: 'Lib_Core', runnable: false, referencedAsLibraryBy: 'GPL_Code' };
const LIB_NET: TargetCandidate = { dir: D('GPL_Code', 'Lib_Net'), projectName: 'Lib_Net', runnable: false, referencedAsLibraryBy: 'GPL_Code' };
const OTHER: TargetCandidate = { dir: D('MyProject'), projectName: 'MyProject', runnable: true };

const ONE_MAIN = [MAIN, LIB_CORE, LIB_NET];
const TWO_MAINS = [MAIN, LIB_CORE, LIB_NET, OTHER];

// ── isProjectTargetRequest ────────────────────────────────────────────────

test('isProjectTargetRequest: 대상 키가 있는 객체만 인정 — Uri·빈 객체·문자열은 아니다', () => {
    assert.strictEqual(isProjectTargetRequest({ project: 'GPL_Code' }), true);
    assert.strictEqual(isProjectTargetRequest({ projectDir: 'c:/x' }), true);
    assert.strictEqual(isProjectTargetRequest({ projectFile: 'c:/x/Main.gpl' }), true);
    // 탐색기 우클릭이 넘기는 Uri 를 대상 지정으로 오인하면 안 된다.
    assert.strictEqual(isProjectTargetRequest({ scheme: 'file', fsPath: 'c:/x', project: 'y' }), false);
    assert.strictEqual(isProjectTargetRequest({}), false);
    assert.strictEqual(isProjectTargetRequest(undefined), false);
    assert.strictEqual(isProjectTargetRequest('GPL_Code'), false);
    assert.strictEqual(isProjectTargetRequest([{ project: 'x' }]), false);
    assert.strictEqual(isProjectTargetRequest({ silent: true }), false);
});

test('isAutomationInvocation: 대상 키가 없어도 자동화 플래그만 있으면 자동화 호출로 본다', () => {
    // 대상 키 없이 플래그만 준 호출이 조용히 QuickPick 으로 가면 원래의 문제가 그대로 남는다.
    assert.strictEqual(isAutomationInvocation({ saveDirty: true }), true);
    assert.strictEqual(isAutomationInvocation({ confirmStart: true }), true);
    assert.strictEqual(isAutomationInvocation({ ignoreCompileStale: false }), true);
    assert.strictEqual(isAutomationInvocation({ project: 'GPL_Code' }), true);
    // 사람용 경로는 그대로 — 인자 없음·Uri·빈 객체·다른 명령의 인자.
    assert.strictEqual(isAutomationInvocation(undefined), false);
    assert.strictEqual(isAutomationInvocation({}), false);
    assert.strictEqual(isAutomationInvocation({ scheme: 'file', fsPath: 'c:/x', saveDirty: true }), false);
    assert.strictEqual(isAutomationInvocation({ silent: true }), false);
    assert.strictEqual(isAutomationInvocation('GPL_Code'), false);
});

// ── 우선순위 1~2: 명시 인자 ───────────────────────────────────────────────

test('resolveProjectTarget: projectDir 이 최우선 — 라이브러리도 직접 지정하면 대상이 된다', () => {
    const r = resolveProjectTarget({ projectDir: D('GPL_Code', 'Lib_Core') }, TWO_MAINS);
    assert.ok(r.ok, describeResolution(r));
    assert.strictEqual(r.dir, LIB_CORE.dir);
    assert.strictEqual(r.projectName, 'Lib_Core');
    assert.strictEqual(r.via, 'argument-dir');
});

test('resolveProjectTarget: projectDir 이 프로젝트 폴더가 아니면 상위/하위로 추측하지 않고 PROJECT_NOT_FOUND', () => {
    const r = resolveProjectTarget({ projectDir: ROOT }, TWO_MAINS);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, 'PROJECT_NOT_FOUND');
    assert.strictEqual(r.requested, ROOT);
    assert.strictEqual(r.candidates.length, 4, '후보 목록을 함께 줘서 다음에 무엇을 지정할지 알 수 있게 한다');
});

test('resolveProjectTarget: projectFile 은 그 파일을 포함하는 가장 깊은 프로젝트 — 중첩 라이브러리를 정확히 고른다', () => {
    const inLib = resolveProjectTarget({ projectFile: D('GPL_Code', 'Lib_Net', 'TcpServer.gpl') }, TWO_MAINS);
    assert.ok(inLib.ok);
    assert.strictEqual(inLib.dir, LIB_NET.dir);
    assert.strictEqual(inLib.via, 'argument-file');

    const inMain = resolveProjectTarget({ projectFile: D('GPL_Code', 'ORCH_Main.gpl') }, TWO_MAINS);
    assert.ok(inMain.ok);
    assert.strictEqual(inMain.dir, MAIN.dir);
});

test('resolveProjectTarget: .gpr 파일을 주면 그 폴더', () => {
    const r = resolveProjectTarget({ projectFile: D('MyProject', 'Project.gpr') }, TWO_MAINS);
    assert.ok(r.ok);
    assert.strictEqual(r.dir, OTHER.dir);
});

test('resolveProjectTarget: project 이름은 폴더명·ProjectName 둘 다 대소문자 무시로 맞춘다', () => {
    for (const name of ['GPL_Code', 'gpl_code', '  GPL_Code  ']) {
        const r = resolveProjectTarget({ project: name }, TWO_MAINS);
        assert.ok(r.ok, `${name}: ${describeResolution(r)}`);
        assert.strictEqual(r.dir, MAIN.dir);
        assert.strictEqual(r.via, 'argument-name');
    }
});

test('resolveProjectTarget: 폴더명과 ProjectName 이 다른 경우도 이름으로 찾는다', () => {
    const renamed: TargetCandidate[] = [
        { dir: D('code'), projectName: 'GPL_Code', runnable: true },
        OTHER,
    ];
    const r = resolveProjectTarget({ project: 'GPL_Code' }, renamed);
    assert.ok(r.ok);
    assert.strictEqual(r.dir, D('code'));
});

test('resolveProjectTarget: 없는 이름은 PROJECT_NOT_FOUND (엉뚱한 프로젝트로 폴백하지 않는다)', () => {
    const r = resolveProjectTarget({ project: 'NoSuch' }, TWO_MAINS);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, 'PROJECT_NOT_FOUND');
    assert.strictEqual(r.requested, 'NoSuch');
});

test('resolveProjectTarget: 같은 이름 후보가 여럿이면 PROJECT_AMBIGUOUS + 그 후보만 싣는다', () => {
    const dup: TargetCandidate[] = [
        { dir: D('a', 'GPL_Code'), projectName: 'GPL_Code', runnable: true },
        { dir: D('b', 'GPL_Code'), projectName: 'GPL_Code', runnable: true },
        OTHER,
    ];
    const r = resolveProjectTarget({ project: 'GPL_Code' }, dup);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, 'PROJECT_AMBIGUOUS');
    assert.strictEqual(r.candidates.length, 2);
    assert.ok(r.detail.includes('projectDir'), r.detail);
});

// ── 우선순위 3~6: 인자 없는 자동 결정 ─────────────────────────────────────

test('resolveProjectTarget: 세션 대상이 있으면 그것 — 실행 가능 후보가 여럿이어도 튀지 않는다 (§19)', () => {
    const r = resolveProjectTarget(undefined, TWO_MAINS, { sessionTargetDir: OTHER.dir });
    assert.ok(r.ok, describeResolution(r));
    assert.strictEqual(r.dir, OTHER.dir);
    assert.strictEqual(r.via, 'session-target');
});

test('resolveProjectTarget: 세션 대상이 후보에서 사라졌으면 조용히 다음 규칙으로 내려간다', () => {
    const r = resolveProjectTarget(undefined, ONE_MAIN, { sessionTargetDir: D('Deleted') });
    assert.ok(r.ok);
    assert.strictEqual(r.dir, MAIN.dir);
    assert.strictEqual(r.via, 'sole-runnable');
});

test('resolveProjectTarget: 실행 가능 프로젝트가 유일하면 라이브러리가 몇 개든 그것 (§21)', () => {
    const r = resolveProjectTarget(undefined, ONE_MAIN);
    assert.ok(r.ok, describeResolution(r));
    assert.strictEqual(r.dir, MAIN.dir);
    assert.strictEqual(r.via, 'sole-runnable');
    assert.strictEqual(r.projectName, 'GPL_Code');
});

test('resolveProjectTarget: 실행 가능이 여럿이면 설정 기본값을 쓴다', () => {
    const r = resolveProjectTarget(undefined, TWO_MAINS, { configuredDefault: 'MyProject' });
    assert.ok(r.ok);
    assert.strictEqual(r.dir, OTHER.dir);
    assert.strictEqual(r.via, 'configured-default');
});

test('resolveProjectTarget: 설정 기본값 오타는 무시하고 애매함으로 — 설정 하나로 자동화를 세우지 않는다', () => {
    const r = resolveProjectTarget(undefined, TWO_MAINS, { configuredDefault: 'Typo' });
    assert.ok(!r.ok);
    assert.strictEqual(r.error, 'PROJECT_AMBIGUOUS');
});

test('resolveProjectTarget: 세션 대상이 설정 기본값보다 우선한다', () => {
    const r = resolveProjectTarget(undefined, TWO_MAINS, { sessionTargetDir: MAIN.dir, configuredDefault: 'MyProject' });
    assert.ok(r.ok);
    assert.strictEqual(r.via, 'session-target');
    assert.strictEqual(r.dir, MAIN.dir);
});

test('resolveProjectTarget: 후보가 하나뿐이면 ProjectStart 가 없어도 그것 (단일 프로젝트 워크스페이스)', () => {
    const r = resolveProjectTarget(undefined, [LIB_CORE]);
    assert.ok(r.ok, describeResolution(r));
    assert.strictEqual(r.dir, LIB_CORE.dir);
    assert.strictEqual(r.via, 'sole-candidate');
});

test('resolveProjectTarget: 실행 가능이 여럿이면 PROJECT_AMBIGUOUS — 후보 목록·runnable 표시 포함', () => {
    const r = resolveProjectTarget(undefined, TWO_MAINS);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, 'PROJECT_AMBIGUOUS');
    assert.strictEqual(r.candidates.length, 4);
    assert.strictEqual(r.candidates.filter(c => c.runnable).length, 2);
    assert.ok(r.detail.includes('실행 가능한 후보가 2개'), r.detail);
    assert.ok(r.detail.includes('defaultProject'), r.detail);
});

test('resolveProjectTarget: 실행 가능이 하나도 없고 후보가 여럿이면 그 사실을 문구에 밝힌다', () => {
    const r = resolveProjectTarget(undefined, [LIB_CORE, LIB_NET]);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, 'PROJECT_AMBIGUOUS');
    assert.ok(r.detail.includes('실행 가능한 프로젝트'), r.detail);
});

test('resolveProjectTarget: 후보가 없으면 NO_GPL_PROJECT', () => {
    const r = resolveProjectTarget({ project: 'GPL_Code' }, []);
    assert.ok(!r.ok);
    assert.strictEqual(r.error, 'NO_GPL_PROJECT');
    assert.deepStrictEqual(r.candidates, []);
});

// ── 표시 헬퍼 ──────────────────────────────────────────────────────────────

test('summarizeCandidates / describeCandidates: runnable·라이브러리 참조를 드러낸다', () => {
    const s = summarizeCandidates(ONE_MAIN);
    assert.deepStrictEqual(s[0], { project: 'GPL_Code', dir: MAIN.dir, runnable: true });
    assert.strictEqual(s[1].referencedAsLibraryBy, 'GPL_Code');
    const line = describeCandidates(s);
    assert.ok(line.includes('GPL_Code @ GPL_Code'), line);
    assert.ok(line.includes('Lib_Core(라이브러리·GPL_Code)'), line);
    assert.strictEqual(describeCandidates([]), '(후보 없음)');
});

test('describeResolution: 성공은 이름·경로·경위, 실패는 오류 코드·사유', () => {
    const ok = resolveProjectTarget(undefined, ONE_MAIN);
    assert.ok(describeResolution(ok).startsWith('GPL_Code (sole-runnable) — '), describeResolution(ok));
    const bad = resolveProjectTarget(undefined, TWO_MAINS);
    assert.ok(describeResolution(bad).startsWith('PROJECT_AMBIGUOUS: '), describeResolution(bad));
});
