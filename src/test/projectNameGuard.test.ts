import * as assert from 'assert';
import { test } from './harness';
import {
    checkProjectName,
    checkRemotePath,
    describeProjectNameProblem,
    isProjectNameSafe,
    suggestSafeProjectName,
} from '../controller/projectNameGuard';

// ── checkProjectName / isProjectNameSafe ─────────────────────────────────

test('projectNameGuard: 공백 없는 일반 이름은 통과한다', () => {
    for (const name of ['MergeCode', 'My_project', 'Test-01', 'a.b', 'ProjectName123', '한글프로젝트']) {
        assert.strictEqual(isProjectNameSafe(name), true, name);
        assert.deepStrictEqual(checkProjectName(name), { ok: true, problems: [] }, name);
    }
});

test('projectNameGuard: 공백이 들어간 이름은 거부하고 어떤 문자인지 말한다', () => {
    const r = checkProjectName('My project');
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.problems, ['공백(space)']);
    assert.strictEqual(isProjectNameSafe('My project'), false);
});

test('projectNameGuard: 탭·NBSP·전각 공백·제어 문자도 공백 구분 명령을 깨뜨리므로 거부한다', () => {
    assert.deepStrictEqual(checkProjectName('A\tB').problems, ['탭(tab)']);
    assert.deepStrictEqual(checkProjectName('A\u00A0B').problems, ['줄바꿈 없는 공백(NBSP)']);
    assert.deepStrictEqual(checkProjectName('A\u3000B').problems, ['전각 공백(U+3000)']);
    assert.deepStrictEqual(checkProjectName('A\nB').problems, ['줄바꿈(LF)']);
    assert.deepStrictEqual(checkProjectName('A\u0000B').problems, ['제어 문자(U+0000)']);
    // 여러 종류가 섞이면 등장 순서대로, 같은 종류는 한 번만
    assert.deepStrictEqual(checkProjectName('A B\tC D').problems, ['공백(space)', '탭(tab)']);
});

test('projectNameGuard: 앞뒤 공백도 거부한다(trim은 호출측 책임 — 명령에 그대로 들어가면 끊김)', () => {
    assert.strictEqual(isProjectNameSafe(' MergeCode'), false);
    assert.strictEqual(isProjectNameSafe('MergeCode '), false);
});

test('projectNameGuard: 빈 이름은 부적합', () => {
    assert.deepStrictEqual(checkProjectName(''), { ok: false, problems: ['빈 이름'] });
    assert.strictEqual(isProjectNameSafe(''), false);
});

// ── checkRemotePath ──────────────────────────────────────────────────────

test('projectNameGuard: Load 경로는 / 구분자를 허용하고 세그먼트 어디의 공백이든 거부한다', () => {
    assert.strictEqual(checkRemotePath('/flash/projects/MergeCode').ok, true);
    assert.strictEqual(checkRemotePath('/GPL/MergeCode').ok, true);
    assert.strictEqual(checkRemotePath('/flash/projects/My project').ok, false);
    assert.strictEqual(checkRemotePath('/flash/my projects/Proj').ok, false);
    assert.deepStrictEqual(checkRemotePath(''), { ok: false, problems: ['빈 경로'] });
});

// ── suggestSafeProjectName ───────────────────────────────────────────────

test('projectNameGuard: 제안 이름은 공백 연속을 _ 하나로 바꾸고 양끝 _는 정리한다', () => {
    assert.strictEqual(suggestSafeProjectName('My project'), 'My_project');
    assert.strictEqual(suggestSafeProjectName('  My   big \t project  '), 'My_big_project');
    assert.strictEqual(suggestSafeProjectName('   '), 'Project');
    assert.strictEqual(suggestSafeProjectName('Already_ok'), 'Already_ok');
});

// ── describeProjectNameProblem ───────────────────────────────────────────

test('projectNameGuard: 안내 문구는 원인(공백 구분 명령)과 해결(이름 변경 예시)을 함께 말한다', () => {
    const msg = describeProjectNameProblem('My project', 'project');
    assert.ok(msg.includes("'My project'"), msg);
    assert.ok(msg.includes('공백(space)'), msg);
    assert.ok(msg.includes('공백으로 구분'), msg);
    assert.ok(msg.includes("'My_project'"), msg);
    assert.ok(msg.includes('ProjectName'), msg);

    const folderMsg = describeProjectNameProblem('My project', 'folder');
    assert.ok(folderMsg.includes('폴더명'), folderMsg);

    const remoteMsg = describeProjectNameProblem('/flash/projects/My project', 'remote');
    assert.ok(remoteMsg.includes('제어기'), remoteMsg);
    assert.ok(!remoteMsg.includes('Project.gpr의 ProjectName'), remoteMsg);
});

test('projectNameGuard: 안전한 이름에는 빈 문구를 돌려준다(호출측이 조건 없이 이어 붙여도 안전)', () => {
    assert.strictEqual(describeProjectNameProblem('MergeCode', 'project'), '');
    assert.strictEqual(describeProjectNameProblem('/GPL/MergeCode', 'remote'), '');
});
