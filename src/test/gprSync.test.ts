import * as assert from 'assert';
import { test } from './harness';
import {
    applyGprSync,
    createGprText,
    filterSourceFiles,
    formatGprTimestamp,
    parseGprText,
    planGprSync,
} from '../controller/gprSync';

// 실제 GDE 저장 형식(MergeCode Project.gpr, 2026-06-29) 축약 픽스처 — LF, 첫 줄 타임스탬프 주석.
const FIXTURE = [
    `'06/29/2026, 03:58:19 PM`,
    'ProjectBegin',
    'ProjectName="MergeCode"',
    'ProjectStart="Main"',
    'ProjectSource="__init__IOConfig__.gpl"',
    'ProjectSource="GPL.gpl"',
    'ProjectSource="ErrorFileModule_oldVersion.gpl"',
    'ProjectEnd',
].join('\n') + '\n';

test('gprSync: parse — 이름/시작/소스/ProjectEnd/타임스탬프/EOL 인식', () => {
    const p = parseGprText(FIXTURE);
    assert.strictEqual(p.eol, '\n');
    assert.strictEqual(p.endsWithNewline, true);
    assert.strictEqual(p.projectName, 'MergeCode');
    assert.strictEqual(p.projectStart, 'Main');
    assert.deepStrictEqual(p.sources.map(s => s.path), ['__init__IOConfig__.gpl', 'GPL.gpl', 'ErrorFileModule_oldVersion.gpl']);
    assert.strictEqual(p.projectEndLine, 7);
    assert.strictEqual(p.timestampLine, 0);
});

test('gprSync: filterSourceFiles — 확장자 필터(대소문자 무시)·이름순, .gpo/.gpr 제외', () => {
    const files = filterSourceFiles(['b.GPL', 'Project.gpr', 'GModule.gpo', 'a.gpl', 'notes.txt'], ['.gpl']);
    assert.deepStrictEqual(files, ['a.gpl', 'b.GPL']);
    assert.deepStrictEqual(filterSourceFiles(['x.gpo', 'y.gpl'], ['gpl', 'gpo']), ['x.gpo', 'y.gpl']);
});

test('gprSync: plan — 폴더에만 있는 파일은 추가, 목록에만 있는 항목은 제거, 대소문자 무시', () => {
    const p = parseGprText(FIXTURE);
    const plan = planGprSync(p, ['__INIT__IOConfig__.gpl', 'GPL.gpl', 'NewModule.gpl']);
    assert.deepStrictEqual(plan.toAdd, ['NewModule.gpl']);
    assert.deepStrictEqual(plan.toRemove.map(e => e.path), ['ErrorFileModule_oldVersion.gpl']);
    assert.strictEqual(plan.kept, 2);
});

test('gprSync: apply — ProjectEnd 앞에 추가, 제거 줄 삭제, 타임스탬프 갱신, LF·끝 개행 유지', () => {
    const p = parseGprText(FIXTURE);
    const plan = planGprSync(p, ['__init__IOConfig__.gpl', 'GPL.gpl', 'NewModule.gpl']);
    const now = new Date(2026, 7, 28, 15, 4, 9); // 08/28/2026 03:04:09 PM
    const out = applyGprSync(FIXTURE, { add: plan.toAdd, removeLines: plan.toRemove.map(e => e.line), now });
    assert.strictEqual(out, [
        `'08/28/2026, 03:04:09 PM`,
        'ProjectBegin',
        'ProjectName="MergeCode"',
        'ProjectStart="Main"',
        'ProjectSource="__init__IOConfig__.gpl"',
        'ProjectSource="GPL.gpl"',
        'ProjectSource="NewModule.gpl"',
        'ProjectEnd',
    ].join('\n') + '\n');
    assert.ok(!out.includes('\r\n'));
});

test('gprSync: apply — CRLF 파일은 CRLF 유지, now 미지정이면 타임스탬프 그대로', () => {
    const crlf = FIXTURE.replace(/\n/g, '\r\n');
    const out = applyGprSync(crlf, { add: ['Z.gpl'] });
    assert.ok(out.startsWith(`'06/29/2026, 03:58:19 PM\r\n`));
    assert.ok(out.endsWith('ProjectSource="Z.gpl"\r\nProjectEnd\r\n'));
    assert.strictEqual(out.split('\r\n').length - 1, 9);
});

test('gprSync: apply — ProjectEnd가 없는 손상 파일은 끝에 추가 후 ProjectEnd 보충', () => {
    const broken = 'ProjectBegin\nProjectName="X"\n';
    const out = applyGprSync(broken, { add: ['A.gpl'] });
    assert.strictEqual(out, 'ProjectBegin\nProjectName="X"\nProjectSource="A.gpl"\nProjectEnd\n');
});

test('gprSync: formatGprTimestamp — 12시간제 0패딩(정오 12 PM, 자정 12 AM)', () => {
    assert.strictEqual(formatGprTimestamp(new Date(2026, 0, 5, 0, 7, 3)), `'01/05/2026, 12:07:03 AM`);
    assert.strictEqual(formatGprTimestamp(new Date(2026, 11, 31, 12, 0, 0)), `'12/31/2026, 12:00:00 PM`);
});

test('gprSync: createGprText — GDE 형식, 기본 CRLF·ProjectStart=Main', () => {
    const now = new Date(2026, 7, 28, 9, 30, 0);
    const out = createGprText({ projectName: 'NewProj', sources: ['Main.gpl', 'Util.gpl'], now });
    assert.strictEqual(out, [
        `'08/28/2026, 09:30:00 AM`,
        'ProjectBegin',
        'ProjectName="NewProj"',
        'ProjectStart="Main"',
        'ProjectSource="Main.gpl"',
        'ProjectSource="Util.gpl"',
        'ProjectEnd',
    ].join('\r\n') + '\r\n');
    // 만든 파일을 다시 파싱하면 동일 정보
    const p = parseGprText(out);
    assert.strictEqual(p.projectName, 'NewProj');
    assert.strictEqual(p.sources.length, 2);
    assert.strictEqual(p.eol, '\r\n');
});

/**
 * ProjectLibrary — 2026-08-31 실제 파일 확인(GDS가 저장한 MyProject).
 * 값이 단순 프로젝트명이 아니라 `\` 구분 경로였다는 점이 핵심이다.
 */
const LIBRARY_FIXTURE = [
    'ProjectBegin',
    'ProjectName="MyProject"',
    'ProjectStart="Main"',
    'ProjectLibrary="MyProject\\MyLibrary"',
    'ProjectSource="MyProject.gpl"',
    'ProjectEnd',
].join('\r\n') + '\r\n';

test('gprSync: parseGprText — ProjectLibrary 를 소스와 구분해 인식한다', () => {
    const p = parseGprText(LIBRARY_FIXTURE);
    assert.deepStrictEqual(p.libraries.map(l => l.path), ['MyProject\\MyLibrary']);
    assert.deepStrictEqual(p.sources.map(s => s.path), ['MyProject.gpl'], '라이브러리 줄이 소스로 새지 않는다');
    assert.strictEqual(p.libraries[0].line, 3);
    // 라이브러리가 없는 .gpr는 빈 배열(호출측이 조건 없이 순회해도 안전)
    assert.deepStrictEqual(parseGprText(FIXTURE).libraries, []);
});

test('gprSync: applyGprSync — ProjectLibrary 줄은 동기화 대상이 아니며 그대로 보존된다', () => {
    const next = applyGprSync(LIBRARY_FIXTURE, { add: ['Extra.gpl'] });
    const p = parseGprText(next);
    assert.deepStrictEqual(p.libraries.map(l => l.path), ['MyProject\\MyLibrary'], '라이브러리 줄 유지');
    assert.deepStrictEqual(p.sources.map(s => s.path), ['MyProject.gpl', 'Extra.gpl']);
    // 추가 항목은 ProjectEnd 앞에 들어가고 라이브러리 줄보다 뒤에 온다
    assert.ok(next.indexOf('ProjectLibrary=') < next.indexOf('ProjectSource="Extra.gpl"'));
});
