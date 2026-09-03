import * as assert from 'assert';
import { test } from './harness';
import { parseBreakList, BreakpointInfo } from '../controller/responseParser';
import {
    breakpointKey,
    controllerTargets,
    dedupeTargets,
    orphanControllerBreakpoints,
    planReconcile,
} from '../controller/breakpointReconcile';

/** 실기기 `Show Break` 응답 형식 (2026-08-31 G2400C 캡처). */
const SHOW_BREAK_LIVE = '<STATUS>0, "Success"</STATUS>\r\n'
    + '119, GPL_Code, MAIN, 3, Main.gpl, 10, 0\r\n'
    + '120, GPL_Code, MAIN, 29, Main.gpl, 36, 0\r\n'
    + '121, GPL_Code, MAIN, 8, Main.gpl, 15, 0\r\n';

function bp(project: string, file: string, fileLine: number): BreakpointInfo {
    return { number: 0, project, proc: 'MAIN', procLine: 1, file, fileLine, hitCount: 0 };
}

test('breakpointReconcile: 실기기 Show Break 캡처에서 대상 프로젝트 위치만 추출', () => {
    const { targets, untouched } = controllerTargets(parseBreakList(SHOW_BREAK_LIVE), 'GPL_Code');
    assert.deepStrictEqual(targets, [
        { file: 'Main.gpl', line: 10 },
        { file: 'Main.gpl', line: 36 },
        { file: 'Main.gpl', line: 15 },
    ]);
    assert.strictEqual(untouched, 0);
});

test('breakpointReconcile: 다른 프로젝트/프로젝트명 없는 항목은 손대지 않는다', () => {
    const list = [bp('GPL_Code', 'Main.gpl', 10), bp('Other', 'Main.gpl', 20), bp('', 'Main.gpl', 30)];
    const { targets, untouched } = controllerTargets(list, 'gpl_code');
    assert.deepStrictEqual(targets, [{ file: 'Main.gpl', line: 10 }]);
    assert.strictEqual(untouched, 2, '남의 프로젝트와 미확정 항목은 제거 대상에서 빠져야 한다');
});

test('breakpointReconcile: 위치가 없는 항목(fileLine 0)은 제거 대상이 아니다', () => {
    const { targets, untouched } = controllerTargets([bp('GPL_Code', 'Main.gpl', 0)], 'GPL_Code');
    assert.deepStrictEqual(targets, []);
    assert.strictEqual(untouched, 1);
});

test('breakpointReconcile: 에디터에 없는 제어기 BP는 해제, 에디터에만 있는 BP는 설정', () => {
    const controller = [
        { file: 'Main.gpl', line: 10 },
        { file: 'Main.gpl', line: 15 },
        { file: 'Main.gpl', line: 36 },
    ];
    const editor = [
        { file: 'Main.gpl', line: 15 },
        { file: 'Util.gpl', line: 7 },
    ];
    const plan = planReconcile(controller, editor);
    assert.deepStrictEqual(plan.toRemove, [{ file: 'Main.gpl', line: 10 }, { file: 'Main.gpl', line: 36 }]);
    assert.deepStrictEqual(plan.toAdd, [{ file: 'Util.gpl', line: 7 }]);
    assert.deepStrictEqual(plan.kept, [{ file: 'Main.gpl', line: 15 }]);
});

test('breakpointReconcile: 양쪽이 같으면 전송 계획이 비어 있다 (불필요한 1402 왕복 방지)', () => {
    const same = [{ file: 'Main.gpl', line: 10 }, { file: 'Main.gpl', line: 15 }];
    const plan = planReconcile(same, [...same]);
    assert.strictEqual(plan.toAdd.length, 0);
    assert.strictEqual(plan.toRemove.length, 0);
    assert.strictEqual(plan.kept.length, 2);
});

test('breakpointReconcile: 파일명 대소문자가 달라도 같은 위치로 본다', () => {
    const plan = planReconcile([{ file: 'MAIN.GPL', line: 10 }], [{ file: 'main.gpl', line: 10 }]);
    assert.strictEqual(plan.toRemove.length, 0, '대소문자만 다른 항목을 지워 버리면 정상 BP가 사라진다');
    assert.strictEqual(plan.toAdd.length, 0);
    assert.strictEqual(plan.kept.length, 1);
});

test('breakpointReconcile: 에디터가 비어 있으면 대상 프로젝트 BP 전부가 해제 대상', () => {
    const { targets, untouched } = controllerTargets(parseBreakList(SHOW_BREAK_LIVE), 'GPL_Code');
    const plan = planReconcile(targets, [], untouched);
    assert.strictEqual(plan.toRemove.length, 3, 'F9로 모두 지운 상태 = 제어기 잔재 3개를 해제해야 한다');
    assert.strictEqual(plan.toAdd.length, 0);
});

test('breakpointReconcile: 중복 입력은 한 번만 전송한다', () => {
    assert.deepStrictEqual(
        dedupeTargets([{ file: 'Main.gpl', line: 10 }, { file: 'main.gpl', line: 10 }, { file: '', line: 3 }, { file: 'A.gpl', line: 0 }]),
        [{ file: 'Main.gpl', line: 10 }]);
});

test('breakpointReconcile: orphan 판정은 에디터에 대응 점이 없는 제어기 BP만 고른다', () => {
    const list = parseBreakList(SHOW_BREAK_LIVE);
    const orphans = orphanControllerBreakpoints(list, [{ file: 'Main.gpl', line: 15 }]);
    assert.deepStrictEqual(orphans.map(o => o.fileLine), [10, 36]);
});

test('breakpointReconcile: 비교 키는 파일명 대소문자를 무시하고 줄 번호를 구분한다', () => {
    assert.strictEqual(breakpointKey({ file: 'Main.gpl', line: 10 }), breakpointKey({ file: 'MAIN.GPL', line: 10 }));
    assert.notStrictEqual(breakpointKey({ file: 'Main.gpl', line: 10 }), breakpointKey({ file: 'Main.gpl', line: 11 }));
});
