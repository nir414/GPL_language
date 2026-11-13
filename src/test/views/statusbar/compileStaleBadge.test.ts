import * as assert from 'assert';
import { test } from '../../harness';
import { CompileStaleInfo, describeCompileStale } from '../../../controller/deployment/compileStale';
import {
    COMPILE_STALE_BADGE_COMMAND,
    COMPILE_STALE_PICK_COMMAND,
    compileStaleBadgeCommand,
    compileStaleBadgeLabel,
    compileStaleBadgeTooltip,
    compileStaleLatestFirst,
    compileStaleSummaryCommand,
    compileStaleSummaryLabel,
    compileStaleSummaryTooltip,
} from '../../../views/statusbar/compileStaleBadge';

// ─── "컴파일 검증 필요" — 설명 문장(정본)과 트리·상태바 공유 배지 규칙 (§1-DV, 목록 요약은 §1-GN) ───
// 설명 문장은 배지 툴팁·Start 전 확인 모달·자동화 COMPILE_UNVERIFIED 가 함께 쓴다(구조 테스트 R7 이 사본을 잡는다).

const fixedTime = (ms: number) => `T${ms}`;
const info: CompileStaleInfo = {
    ip: '192.168.0.1',
    projectName: 'GPL_Code',
    projectDir: 'C:/work/GPL_Code',
    since: 1000,
    markedAt: 1000,
    reason: '쓰레드 동작 중 — Compile 보류',
};
const toResource = (dir: string) => ({ fsPath: dir });

test('compileStale: 설명 문장은 프로젝트·시각·사유와 Start 실패 시 Problems 연동을 말한다', () => {
    const s = describeCompileStale(info, fixedTime);
    assert.ok(s.includes("'GPL_Code'") && s.includes('T1000') && s.includes(info.reason), s);
    assert.ok(/-compile/.test(s) && /Start/.test(s) && /Problems/.test(s) && /표시/.test(s), s);
    assert.ok(!/오지 않습니다/.test(s), s);
});

test('compileStaleBadge: 라벨·툴팁은 정본 문장 위에 클릭 안내만 붙이고, 다시 표시된 시각은 최초와 다를 때만 덧붙인다', () => {
    assert.strictEqual(compileStaleBadgeLabel(info), '컴파일 검증 필요: GPL_Code');
    const tip = compileStaleBadgeTooltip(info, fixedTime);
    assert.ok(tip.startsWith(describeCompileStale(info, fixedTime)), tip);
    assert.ok(/클릭:.*Quick Compile/.test(tip), tip);
    assert.ok(!/최근 표시/.test(tip), '최초 표시와 같으면 중복 시각을 보이지 않는다');
    const again = compileStaleBadgeTooltip({ ...info, markedAt: 5000 }, fixedTime);
    assert.ok(again.includes('최근 표시: T5000'), again);
});

test('compileStaleBadge: 폴더를 알면 리소스 인자로 그 프로젝트를 확정하고, 모르면 인자 없이 종전 경로', () => {
    const withDir = compileStaleBadgeCommand(info, toResource);
    assert.strictEqual(withDir.command, COMPILE_STALE_BADGE_COMMAND);
    assert.deepStrictEqual(withDir.arguments, [{ fsPath: 'C:/work/GPL_Code' }]);

    const noDir = compileStaleBadgeCommand({ ...info, projectDir: undefined }, toResource);
    assert.strictEqual(noDir.command, COMPILE_STALE_BADGE_COMMAND);
    assert.strictEqual(noDir.arguments, undefined);
});

const older: CompileStaleInfo = { ...info, projectName: 'Lib', projectDir: 'C:/work/Lib', since: 500, markedAt: 500, reason: 'Upload Only 완료 — Compile 미수행' };
const newest: CompileStaleInfo = { ...info, projectName: 'App', projectDir: undefined, since: 2000, markedAt: 2000, reason: 'Upload Only 완료 — Compile 미수행' };

test('compileStaleSummary: 빈 목록은 빈 라벨·명령 없음, 1건은 단일 항목 규칙과 같다', () => {
    assert.strictEqual(compileStaleSummaryLabel([]), '');
    assert.strictEqual(compileStaleSummaryTooltip([], fixedTime), '');
    assert.strictEqual(compileStaleSummaryCommand([], toResource), undefined);
    assert.strictEqual(compileStaleSummaryLabel([info]), compileStaleBadgeLabel(info));
    assert.strictEqual(compileStaleSummaryTooltip([info], fixedTime), compileStaleBadgeTooltip(info, fixedTime));
    assert.deepStrictEqual(compileStaleSummaryCommand([info], toResource), compileStaleBadgeCommand(info, toResource));
});

test('compileStaleSummary: 여럿이면 대표는 가장 최근 표시, 라벨에 "외 n", 툴팁은 전체 목록, 클릭은 선택 창', () => {
    const items = [older, info, newest]; // tracker.list() 순서(오래된 → 최근)
    assert.deepStrictEqual(compileStaleLatestFirst(items).map(i => i.projectName), ['App', 'GPL_Code', 'Lib']);
    assert.strictEqual(compileStaleSummaryLabel(items), '컴파일 검증 필요: App 외 2');
    const tip = compileStaleSummaryTooltip(items, fixedTime);
    assert.ok(tip.startsWith('컴파일 검증 필요 3개'), tip);
    for (const i of items) {
        assert.ok(tip.includes(`- ${i.projectName} — ${i.reason} (T${i.since} 이후)`), tip);
    }
    assert.ok(tip.indexOf('- App') < tip.indexOf('- GPL_Code') && tip.indexOf('- GPL_Code') < tip.indexOf('- Lib'), '최근 표시 순');
    assert.ok(/클릭:.*고릅니다/.test(tip), tip);
    const cmd = compileStaleSummaryCommand(items, toResource);
    assert.strictEqual(cmd?.command, COMPILE_STALE_PICK_COMMAND);
    assert.strictEqual(cmd?.arguments, undefined);
});

test('compileStaleBadge: ProjectStart 없는 라이브러리는 Quick Compile 로 이끌지 않고 선택 창을 연다(그룹 Compile 뒤 Unload 위험, 2026-11-03 inbox)', () => {
    const lib: CompileStaleInfo = { ...older, library: true };
    const cmd = compileStaleBadgeCommand(lib, toResource);
    assert.strictEqual(cmd.command, COMPILE_STALE_PICK_COMMAND);
    assert.strictEqual(cmd.arguments, undefined);
    assert.deepStrictEqual(compileStaleSummaryCommand([lib], toResource), cmd, '1건이어도 같다');
    const tip = compileStaleBadgeTooltip(lib, fixedTime);
    assert.ok(/ProjectLibrary 로 쓰는 실행 프로젝트/.test(tip) && /목록 창/.test(tip), tip);
    assert.ok(!/Quick Compile 로 먼저/.test(tip), tip);
    assert.ok(compileStaleSummaryTooltip([lib, newest], fixedTime).includes('- Lib (라이브러리) —'));
});
