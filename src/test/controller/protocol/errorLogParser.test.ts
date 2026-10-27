import * as assert from 'assert';
import { test } from '../../harness';
import { classifyErrorEntry, getGplErrorGroup } from '../../../controller/protocol/errorLogParser';

// ─── 에러 코드 그룹 — 공식 범위 표(Error_Intro.htm)가 정본 (§1-EA) ───

test('errorGroups: 문서 범위대로 코드를 그룹에 넣는다 (경계 포함)', () => {
    assert.strictEqual(getGplErrorGroup(-757)?.title, 'Language Related Errors');
    assert.strictEqual(getGplErrorGroup(-700)?.title, 'Language Related Errors', '경계값 -700 포함');
    assert.strictEqual(getGplErrorGroup(-999)?.title, 'Language Related Errors', '경계값 -999 포함');
    assert.strictEqual(getGplErrorGroup(-200)?.title, 'Standard System Errors');
    assert.strictEqual(getGplErrorGroup(-1521)?.category, 'environment');
    assert.strictEqual(getGplErrorGroup(-1200)?.category, 'unknown', '로봇 에러는 코드/환경이 갈리지 않는다');
    assert.strictEqual(getGplErrorGroup(0), undefined, '성공/경고 범위는 에러 그룹이 아니다');
    assert.strictEqual(getGplErrorGroup(-5000), undefined, '표에 없는 구간');
});

test('classifyErrorEntry: -757·-700 은 코드 오류다 (종전에는 환경 경고로 떨어졌다)', () => {
    const c = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -757, "*Object not instantiated*"');
    assert.strictEqual(c.category, 'code');
    assert.strictEqual(c.isControllerSystem, false, '환경 경고 칸으로 가면 안 된다');
    assert.strictEqual(c.parsedCode, -757);
    assert.ok(c.detail?.includes('Language Related Errors'), '문서상 그룹을 밝힌다');

    const aborted = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -700, "*Thread execution aborted*"');
    assert.strictEqual(aborted.category, 'code');
    assert.strictEqual(aborted.isControllerSystem, false);
});

test('classifyErrorEntry: 환경 코드는 그대로 환경, 분류 미상은 단정하지 않는다', () => {
    const env = classifyErrorEntry('09-21-2026 10:04:49.135, SYSTEM, -1521, "*Invalid parameter DB*"');
    assert.strictEqual(env.category, 'environment');
    assert.strictEqual(env.isControllerSystem, true);

    const unknown = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -1200, "*Robot problem*"');
    assert.strictEqual(unknown.category, 'unknown');
    assert.strictEqual(unknown.isControllerSystem, true, '미상은 코드 오류로 단정하지 않는다');
    assert.ok(unknown.detail?.includes('갈리지 않음'));
});

test('classifyErrorEntry: 코드별 힌트가 있으면 범위 표보다 우선한다', () => {
    // -508 은 Input and Output Errors 범위지만 손으로 검토한 힌트가 있다.
    const c = classifyErrorEntry('09-21-2026 10:04:49.135, GenAdp, -508, "*File not found*"');
    assert.strictEqual(c.category, 'code');
    assert.ok(c.detail?.includes('File not found'));
});
