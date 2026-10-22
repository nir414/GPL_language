import * as assert from 'assert';
import { test } from './harness';
import { CompileStaleInfo, describeCompileStale } from '../controller/compileStale';
import {
    COMPILE_STALE_BADGE_COMMAND,
    compileStaleBadgeCommand,
    compileStaleBadgeLabel,
    compileStaleBadgeTooltip,
} from '../views/compileStaleBadge';

// ─── "컴파일 검증 필요" — 설명 문장(정본)과 트리·상태바 공유 배지 규칙 (§1-DV) ───
// 설명 문장은 배지 툴팁·Start 전 확인 모달·자동화 COMPILE_UNVERIFIED 가 함께 쓴다(구조 테스트 R7 이 사본을 잡는다).

const fixedTime = (ms: number) => `T${ms}`;
const info: CompileStaleInfo = {
    projectName: 'GPL_Code',
    projectDir: 'C:/work/GPL_Code',
    since: 1000,
    reason: '쓰레드 동작 중 — Compile 보류',
};

test('compileStale: 설명 문장은 프로젝트·시각·사유와 Start 실패 시 Problems 연동을 말한다', () => {
    const s = describeCompileStale(info, fixedTime);
    assert.ok(s.includes("'GPL_Code'") && s.includes('T1000') && s.includes(info.reason), s);
    assert.ok(/-compile/.test(s) && /Start/.test(s) && /Problems/.test(s) && /표시/.test(s), s);
    assert.ok(!/오지 않습니다/.test(s), s);
});

test('compileStaleBadge: 라벨·툴팁은 정본 문장 위에 클릭 안내만 붙인다', () => {
    assert.strictEqual(compileStaleBadgeLabel(info), '컴파일 검증 필요: GPL_Code');
    const tip = compileStaleBadgeTooltip(info, fixedTime);
    assert.ok(tip.startsWith(describeCompileStale(info, fixedTime)), tip);
    assert.ok(/클릭:.*Quick Compile/.test(tip), tip);
});

test('compileStaleBadge: 폴더를 알면 리소스 인자로 그 프로젝트를 확정하고, 모르면 인자 없이 종전 경로', () => {
    const withDir = compileStaleBadgeCommand(info, dir => ({ fsPath: dir }));
    assert.strictEqual(withDir.command, COMPILE_STALE_BADGE_COMMAND);
    assert.deepStrictEqual(withDir.arguments, [{ fsPath: 'C:/work/GPL_Code' }]);

    const noDir = compileStaleBadgeCommand({ ...info, projectDir: undefined }, dir => ({ fsPath: dir }));
    assert.strictEqual(noDir.command, COMPILE_STALE_BADGE_COMMAND);
    assert.strictEqual(noDir.arguments, undefined);
});
