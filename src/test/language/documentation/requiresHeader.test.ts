import * as assert from 'assert';
import { test } from '../../harness';
import type { RequiredFile } from '../../../language/analysis/moduleDependencies';
import {
    describeRequiresPlan, LineEdit, planRequiresHeader, planRequiresInsertion, renderRequiresEntries,
} from '../../../language/documentation/requiresHeader';

const req = (fileName: string, modules: string[], items: Array<[string, string[]?]>): RequiredFile =>
    ({
        filePath: `C:\\p\\${fileName}`, fileName, modules,
        items: items.map(([name, members]) => ({ name, members: members ?? [] })),
        firstUse: { line: 0, character: 0 },
    });

/** 편집을 뒤에서부터 적용한 결과 줄. */
function apply(lines: readonly string[], edits: readonly LineEdit[]): string[] {
    const out = [...lines];
    for (const e of [...edits].sort((a, b) => b.startLine - a.startLine)) { out.splice(e.startLine, e.endLine - e.startLine, ...e.lines); }
    return out;
}

const COMPUTED = [
    req('Logger.gpl', ['LOG'], [['Write']]),
    req('MotionSystem.gpl', ['MSY'], [['MotionSystem', ['OpenLines']], ['SetHomePosition']]),
    req('Worker.gpl', ['RWK'], [['RobotWorker', ['ResetSharedState']]]),
];

// Machine.gpl(2026-10-27 사용자 붙여넣기)에서 본 실수 두 가지 — 같은 파일이 두 줄, 괄호 안 설명 — 를 그대로 담은 머리 주석
const MACHINE_HEADER = [
    "'장비 시퀀스(BRM)",
    "'",
    "'Requires:",
    "' - MotionSystem.gpl (Module MSY): MotionSystem(OpenLines, Shutdown)",
    "' - Deck.gpl         (Module BRK): Setting, IsSet(Home 위치 Gantry.HomeX / HomeY)",
    "' - MotionSystem.gpl (Module MSY): SetHomePosition",
    "' - Worker.gpl       (Module RWK): RobotWorker.ResetSharedState",
    "'Used by:",
    "' - Main.gpl (Module BR4_Main): Setup",
    'Module BRM',
];

test('requiresHeader: 줄을 합치고 정렬해 다시 쓰며, 괄호 안 설명은 Notes 로 옮기고 Used by 는 그대로 둔다', () => {
    const plan = planRequiresHeader(MACHINE_HEADER, COMPUTED)!;
    assert.strictEqual(plan.headerLine, 2);
    assert.strictEqual(plan.changed, true);
    assert.deepStrictEqual(plan.added, ['Logger.gpl']);
    assert.deepStrictEqual(plan.removed, ['Deck.gpl']);
    assert.deepStrictEqual(plan.modified, ['MotionSystem.gpl'], 'Worker 의 점 표기는 멤버 목록과 같은 뜻');
    assert.strictEqual(plan.notesMoved, 1);
    assert.strictEqual(describeRequiresPlan(plan), "추가 1 (Logger.gpl) · 제거 1 (Deck.gpl) · 항목 변경 1 (MotionSystem.gpl) · 메모 1줄 → 'Notes:");
    assert.deepStrictEqual(apply(MACHINE_HEADER, plan.edits), [
        "'장비 시퀀스(BRM)",
        "'",
        "'Requires:",
        "' - Logger.gpl       (Module LOG): Write",
        "' - MotionSystem.gpl (Module MSY): MotionSystem(OpenLines), SetHomePosition",
        "' - Worker.gpl       (Module RWK): RobotWorker(ResetSharedState)",
        "'Notes:",
        "' - Deck.gpl: IsSet(Home 위치 Gantry.HomeX / HomeY)",
        "'Used by:",
        "' - Main.gpl (Module BR4_Main): Setup",
        'Module BRM',
    ]);
});

test('requiresHeader: 한 번 갱신한 결과는 다시 계획해도 바뀌지 않는다(멱등)', () => {
    const once = apply(MACHINE_HEADER, planRequiresHeader(MACHINE_HEADER, COMPUTED)!.edits);
    const again = planRequiresHeader(once, COMPUTED)!;
    assert.strictEqual(again.changed, false);
    assert.deepStrictEqual(again.edits, []);
    assert.strictEqual(describeRequiresPlan(again), '정렬·표기만 다름');
});

test('requiresHeader: 기존 Notes 블록에는 없는 메모만 덧붙이고, 이어쓰기 줄은 앞 항목의 메모가 된다', () => {
    const lines = [
        "'Requires:",
        "' - Machine.gpl (Module BRM): Setup(모터 + 스테이션), DevicesText",
        "'   (Setup 은 시작 때 한 번)",
        "'Notes:",
        "' - 손으로 쓴 메모",
        'Module BR4_Main',
    ];
    const plan = planRequiresHeader(lines, [req('Machine.gpl', ['BRM'], [['Setup'], ['DevicesText']])])!;
    assert.strictEqual(plan.notesMoved, 1);
    assert.deepStrictEqual(apply(lines, plan.edits), [
        "'Requires:",
        "' - Machine.gpl (Module BRM): Setup, DevicesText",
        "'Notes:",
        "' - 손으로 쓴 메모",
        "' - Machine.gpl: Setup(모터 + 스테이션) (Setup 은 시작 때 한 번)",
        'Module BR4_Main',
    ]);
});

test('requiresHeader: 의존이 없으면 (none), 블록이 없으면 갱신 대상 아님, 추가는 Module 위', () => {
    assert.deepStrictEqual(renderRequiresEntries([]), ["' - (none)"]);
    const none = ["'Requires:", "' - (none)", 'Module A'];
    assert.strictEqual(planRequiresHeader(none, [])!.changed, false);

    const bare = ["' 설명", 'Module A', 'End Module'];
    assert.strictEqual(planRequiresHeader(bare, COMPUTED), undefined);
    const ins = planRequiresInsertion(bare, [COMPUTED[0]])!;
    assert.deepStrictEqual(apply(bare, [ins]), ["' 설명", "'Requires:", "' - Logger.gpl (Module LOG): Write", 'Module A', 'End Module']);
    assert.strictEqual(planRequiresInsertion(none, COMPUTED), undefined, '이미 있으면 넣지 않는다');
    assert.strictEqual(planRequiresInsertion(["' 주석만"], COMPUTED), undefined);
});
