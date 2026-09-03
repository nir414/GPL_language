import * as assert from 'assert';
import { test } from './harness';
import { CompileStaleTracker } from '../controller/compileStale';

test('compileStale: mark 한 프로젝트를 대소문자·공백 무시로 찾는다', () => {
    const t = new CompileStaleTracker();
    t.mark('GPL_Code', '업로드 후 Compile 보류', 'C:\proj\GPL_Code');
    assert.strictEqual(t.find('gpl_code')?.projectName, 'GPL_Code');
    assert.strictEqual(t.find('  GPL_CODE  ')?.reason, '업로드 후 Compile 보류');
    assert.strictEqual(t.find('Other'), undefined);
});

test('compileStale: 같은 프로젝트를 다시 mark 하면 since·projectDir 은 보존되고 사유만 갱신된다', () => {
    const t = new CompileStaleTracker();
    const first = t.mark('GPL_Code', '첫 사유', 'C:\proj\GPL_Code');
    const again = t.mark('gpl_code', '두 번째 사유');
    assert.ok(first && again);
    assert.strictEqual(again.since, first.since, '미검증 경과 시간이 리셋되면 배지의 "언제부터"가 거짓이 된다');
    assert.strictEqual(again.projectDir, 'C:\proj\GPL_Code', 'dir 을 생략한 mark 가 기존 경로를 지우면 안 된다');
    assert.strictEqual(again.reason, '두 번째 사유');
    assert.strictEqual(t.size, 1);
});

test('compileStale: 프로젝트명이 비면 추적하지 않는다 (호출부가 로그·UI를 건너뛰게)', () => {
    const t = new CompileStaleTracker();
    assert.strictEqual(t.mark('', '사유'), undefined);
    assert.strictEqual(t.mark('   ', '사유'), undefined);
    assert.strictEqual(t.size, 0);
    assert.strictEqual(t.current(), undefined);
});

test('compileStale: clear 는 지운 항목과 배지에 남길 다음 항목을 함께 돌려준다', () => {
    const t = new CompileStaleTracker();
    t.mark('First', 'a');
    t.mark('Second', 'b');
    const done = t.clear('first');
    assert.strictEqual(done?.cleared.projectName, 'First');
    assert.strictEqual(done?.next?.projectName, 'Second', '남은 항목이 있으면 배지를 그것으로 바꿔야 한다');
    const last = t.clear('SECOND');
    assert.strictEqual(last?.next, undefined, '마지막을 지우면 배지가 사라진다');
    assert.strictEqual(t.size, 0);
});

test('compileStale: 없는 항목의 clear 는 undefined (같은 Compile 로 두 번 불려도 조용하다)', () => {
    const t = new CompileStaleTracker();
    // 직접 호출과 onDidRecordCompiled 구독이 같은 Compile 성공으로 둘 다 들어오는 경로가 실제로 있다.
    t.mark('GPL_Code', 'Compile 실패');
    assert.ok(t.clear('GPL_Code'));
    assert.strictEqual(t.clear('GPL_Code'), undefined);
    assert.strictEqual(t.clear('NeverMarked'), undefined);
});

test('compileStale: current 는 가장 먼저 등록된 항목, list 는 등록 순 전체', () => {
    const t = new CompileStaleTracker();
    t.mark('A', 'a');
    t.mark('B', 'b');
    // 갱신은 등록 순서를 바꾸지 않고, 표시 이름은 마지막에 관측된 표기를 쓴다(종전 동작 유지).
    t.mark('a', 'a2');
    assert.strictEqual(t.current()?.projectName, 'a');
    assert.strictEqual(t.current()?.reason, 'a2');
    assert.deepStrictEqual(t.list().map(i => i.projectName), ['a', 'B']);
});
