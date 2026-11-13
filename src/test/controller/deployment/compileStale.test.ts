import * as assert from 'assert';
import { test } from '../../harness';
import {
    COMPILE_STALE_MEMENTO_KEY,
    CompileStaleMemento,
    CompileStaleTracker,
    describeCompileStale,
    describeCompiledRelease,
    libraryReferenceKey,
} from '../../../controller/deployment/compileStale';

const IP = '192.168.0.1';

test('compileStale: mark 한 프로젝트를 대소문자·공백 무시로 찾는다', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'GPL_Code', '업로드 후 Compile 보류', 'C:\proj\GPL_Code');
    assert.strictEqual(t.find(IP, 'gpl_code')?.projectName, 'GPL_Code');
    assert.strictEqual(t.find(' 192.168.0.1 ', '  GPL_CODE  ')?.reason, '업로드 후 Compile 보류');
    assert.strictEqual(t.find(IP, 'Other'), undefined);
});

test('compileStale: 같은 프로젝트를 다시 mark 하면 since·projectDir 은 보존되고 사유·markedAt 만 갱신된다', () => {
    const t = new CompileStaleTracker();
    const first = t.mark(IP, 'GPL_Code', '첫 사유', 'C:\proj\GPL_Code', 1000);
    const again = t.mark(IP, 'gpl_code', '두 번째 사유', undefined, 5000);
    assert.ok(first && again);
    assert.strictEqual(again.since, 1000, '미검증 경과 시간이 리셋되면 배지의 "언제부터"가 거짓이 된다');
    assert.strictEqual(again.markedAt, 5000, '오늘 다시 올린 것은 "지금 올린 것"으로 보여야 한다');
    assert.strictEqual(again.projectDir, 'C:\proj\GPL_Code', 'dir 을 생략한 mark 가 기존 경로를 지우면 안 된다');
    assert.strictEqual(again.reason, '두 번째 사유');
    assert.strictEqual(t.size, 1);
});

test('compileStale: 프로젝트명이 비면 추적하지 않는다 (호출부가 로그·UI를 건너뛰게)', () => {
    const t = new CompileStaleTracker();
    assert.strictEqual(t.mark(IP, '', '사유'), undefined);
    assert.strictEqual(t.mark(IP, '   ', '사유'), undefined);
    assert.strictEqual(t.size, 0);
    assert.strictEqual(t.current(IP), undefined);
});

test('compileStale: clear 는 지운 항목과 같은 제어기에 남은 목록을 함께 돌려준다', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'First', 'a');
    t.mark(IP, 'Second', 'b');
    t.mark(IP, 'Third', 'c');
    const done = t.clear(IP, 'second');
    assert.strictEqual(done?.cleared.projectName, 'Second');
    assert.deepStrictEqual(done?.remaining.map(i => i.projectName), ['First', 'Third'],
        '하나를 지워도 나머지 미검증은 그대로 보여야 한다 — 종전엔 대표 1건만 넘겨 "다른 프로젝트로 바뀐" 것처럼 보였다');
    assert.strictEqual(t.current(IP)?.projectName, 'Third');
    t.clear(IP, 'third');
    const last = t.clear(IP, 'FIRST');
    assert.deepStrictEqual(last?.remaining, [], '마지막을 지우면 배지가 사라진다');
    assert.strictEqual(t.size, 0);
});

test('compileStale: 없는 항목의 clear 는 undefined (같은 Compile 로 두 번 불려도 조용하다)', () => {
    const t = new CompileStaleTracker();
    // 직접 호출과 onDidRecordCompiled 구독이 같은 Compile 성공으로 둘 다 들어오는 경로가 실제로 있다.
    t.mark(IP, 'GPL_Code', 'Compile 실패');
    assert.ok(t.clear(IP, 'GPL_Code'));
    assert.strictEqual(t.clear(IP, 'GPL_Code'), undefined);
    assert.strictEqual(t.clear(IP, 'NeverMarked'), undefined);
});

test('compileStale: current 는 가장 최근에 표시된 항목, list 는 오래된 → 최근 순', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'A', 'a');
    t.mark(IP, 'B', 'b');
    assert.strictEqual(t.current(IP)?.projectName, 'B', '방금 미검증이 된 쪽이 배지에 와야 한다');
    // 다시 표시하면 "가장 최근" 자리로 올라오고, 표시 이름은 마지막에 관측된 표기를 쓴다.
    t.mark(IP, 'a', 'a2');
    assert.strictEqual(t.current(IP)?.projectName, 'a');
    assert.strictEqual(t.current(IP)?.reason, 'a2');
    assert.deepStrictEqual(t.list(IP).map(i => i.projectName), ['B', 'a']);
});

test('compileStale: 상태는 제어기(ip)별 — 다른 제어기의 같은 이름은 섞이지 않고, 조회·clear 도 그 제어기 것만', () => {
    const t = new CompileStaleTracker();
    t.mark('192.168.0.1', 'App', '제어기1 업로드');
    t.mark('192.168.0.2', 'App', '제어기2 업로드');
    t.mark('192.168.0.2', 'Lib', '제어기2 Lib');
    assert.strictEqual(t.size, 3);
    assert.strictEqual(t.find('192.168.0.1', 'app')?.reason, '제어기1 업로드');
    assert.deepStrictEqual(t.list('192.168.0.2').map(i => i.projectName), ['App', 'Lib']);
    assert.deepStrictEqual(t.list('10.0.0.9'), [], '모르는 제어기면 빈 목록 — 다른 제어기 배지가 따라오지 않는다');
    const done = t.clear('192.168.0.2', 'App');
    assert.deepStrictEqual(done?.remaining.map(i => i.projectName), ['Lib']);
    assert.strictEqual(t.find('192.168.0.1', 'App')?.reason, '제어기1 업로드', '제어기2 의 Compile 성공이 제어기1 의 미검증을 지우면 안 된다');
    assert.deepStrictEqual(t.list().map(i => `${i.ip}|${i.projectName}`), ['192.168.0.1|App', '192.168.0.2|Lib'], 'ip 생략은 전부(상황 스냅샷용)');
});

function memoryMemento(initial: Record<string, unknown> = {}): CompileStaleMemento & { store: Record<string, unknown>; updates: number } {
    const m = {
        store: { ...initial } as Record<string, unknown>,
        updates: 0,
        get<T>(key: string, def: T): T { return (m.store[key] as T) ?? def; },
        update(key: string, value: unknown): void { m.store[key] = value; m.updates++; },
    };
    return m;
}

test('compileStale: Memento 에 영속되고, 다시 attach 하면 최근 표시 순서까지 복원된다', () => {
    const memento = memoryMemento();
    const t = new CompileStaleTracker();
    t.attach(memento);
    t.mark(IP, 'B', 'b', 'C:/proj/B', 2000);
    t.mark(IP, 'A', 'a', undefined, 1000);
    t.mark(IP, 'C', 'c', 'C:/proj/C', 3000);
    t.clear(IP, 'A');
    assert.strictEqual(memento.updates, 4, 'mark·clear 마다 저장');
    const saved = memento.store[COMPILE_STALE_MEMENTO_KEY] as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(saved).sort(), ['192.168.0.1|b', '192.168.0.1|c']);

    // 창을 다시 연 것처럼 새 트래커에 같은 저장소를 붙인다.
    const reopened = new CompileStaleTracker();
    reopened.attach(memento);
    assert.deepStrictEqual(reopened.list(IP).map(i => i.projectName), ['B', 'C'], 'markedAt 오름차순 = 표시 순서');
    assert.strictEqual(reopened.current(IP)?.projectName, 'C');
    assert.strictEqual(reopened.find(IP, 'b')?.projectDir, 'C:/proj/B');
});

test('compileStale: attach 는 깨진 저장분을 버리고, 메모리에 먼저 쌓인 항목은 더 최근 표시가 남는다', () => {
    const memento = memoryMemento({
        [COMPILE_STALE_MEMENTO_KEY]: {
            '192.168.0.1|old': { ip: IP, projectName: 'Old', since: 100, markedAt: 100, reason: '옛 저장분' },
            '192.168.0.1|app': { ip: IP, projectName: 'App', since: 100, markedAt: 100, reason: '저장분' },
            broken: { projectName: 'NoIp', since: 1 },
            junk: 'not-an-object',
        },
    });
    const t = new CompileStaleTracker();
    t.mark(IP, 'App', '메모리 쪽이 더 최근', undefined, 500);
    t.attach(memento);
    assert.deepStrictEqual(t.list(IP).map(i => `${i.projectName}:${i.reason}`), ['Old:옛 저장분', 'App:메모리 쪽이 더 최근']);
    assert.strictEqual(t.size, 2, '형식이 맞지 않는 항목은 들어오지 않는다');
});

test('compileStale: 저장 실패는 콜백으로만 알리고 mark 는 성공한다', () => {
    const errors: unknown[] = [];
    const t = new CompileStaleTracker(err => errors.push(err));
    t.attach({ get: <T>(_k: string, d: T) => d, update: () => { throw new Error('disk full'); } });
    assert.ok(t.mark(IP, 'App', 'r'));
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(t.find(IP, 'App')?.reason, 'r');
});

// ─── 2026-11-03 inbox: 라이브러리 항목 해제·라이브러리 표시·일괄 해제 ───

test('compileStale: clearCompiled — 컴파일한 프로젝트와 ProjectLibrary 값(전이 포함)이 가리키는 같은 제어기 항목을 함께 지운다', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'PaL', 'Upload Only 완료 — Compile 미수행', 'C:/p/PaL', 1000, true);
    t.mark(IP, 'Gantry', 'Upload Only 완료 — Compile 미수행', 'C:/p/Gantry', 2000, true);
    t.mark(IP, 'Other', '무관', undefined, 3000);
    t.mark('192.168.0.2', 'PaL', '다른 제어기', undefined, 4000);
    const r = t.clearCompiled(IP, 'App', ['PaL', ' gantry\\ ', 'Deep\\PaL']);
    assert.strictEqual(r.main, undefined, 'App 은 원래 목록에 없었다');
    assert.deepStrictEqual(r.libraries.map(i => i.projectName), ['PaL', 'Gantry']);
    assert.deepStrictEqual(t.list(IP).map(i => i.projectName), ['Other']);
    assert.ok(t.find('192.168.0.2', 'PaL'), '다른 제어기 항목은 그대로');
    assert.strictEqual(
        describeCompiledRelease(r),
        '컴파일 검증 필요 상태 해제: 라이브러리 PaL, Gantry — App Compile 에 포함 (남은 미검증 1개: Other)',
    );
});

test('compileStale: clearCompiled — 깊은 값(MyProject\\MyLibrary)은 /GPL/MyLibrary 항목과 다른 폴더라 맞추지 않는다', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'MyLibrary', 'Upload Only');
    t.mark(IP, 'App', 'Compile 실패');
    const r = t.clearCompiled(IP, 'app', ['MyProject\\MyLibrary', '..\\MyLibrary']);
    assert.strictEqual(r.main?.projectName, 'App');
    assert.deepStrictEqual(r.libraries, []);
    assert.strictEqual(describeCompiledRelease(r), '컴파일 검증 필요 상태 해제: App (남은 미검증 1개: MyLibrary)');
    assert.strictEqual(libraryReferenceKey('MyProject\\MyLibrary'), 'myproject/mylibrary');
    assert.strictEqual(libraryReferenceKey(' /PaL/ '), 'pal');
    assert.strictEqual(libraryReferenceKey('..\\X'), undefined);
});

test('compileStale: describeCompiledRelease — 자신과 라이브러리를 한 줄로, 아무것도 없으면 undefined', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'App', 'Compile 실패');
    t.mark(IP, 'PaL', 'Upload Only', undefined, Date.now(), true);
    assert.strictEqual(
        describeCompiledRelease(t.clearCompiled(IP, 'App', ['PaL'])),
        '컴파일 검증 필요 상태 해제: App (+ 라이브러리 PaL — App Compile 에 포함)',
    );
    assert.strictEqual(describeCompiledRelease(t.clearCompiled(IP, 'App', ['PaL'])), undefined, '두 번째는 조용하다');
});

test('compileStale: library 플래그 — mark 가 잇고, setLibrary 로 보충하며, 영속 형식 검사를 통과한다', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'PaL', 'a', 'C:/p/PaL', 1000, true);
    assert.strictEqual(t.mark(IP, 'PaL', 'b', undefined, 2000)?.library, true, '모르면 이전 값을 잇는다');
    t.mark(IP, 'Old', 'c', 'C:/p/Old', 3000);
    assert.strictEqual(t.find(IP, 'Old')?.library, undefined);
    assert.strictEqual(t.setLibrary(IP, 'Old', false), true);
    assert.strictEqual(t.setLibrary(IP, 'Old', false), false, '같은 값이면 바꾸지 않는다');
    assert.deepStrictEqual(t.list(IP).map(i => `${i.projectName}:${i.library}`), ['PaL:true', 'Old:false'], '순서는 그대로');

    const store: Record<string, unknown> = {};
    const memento: CompileStaleMemento = { get: <T>(k: string, d: T) => (store[k] as T) ?? d, update: (k, v) => { store[k] = v; } };
    t.attach(memento);
    t.mark(IP, 'X', 'x');
    const reloaded = new CompileStaleTracker();
    reloaded.attach(memento);
    assert.strictEqual(reloaded.find(IP, 'PaL')?.library, true);
});

test('compileStale: clearMany — 있는 이름만 지우고 남은 목록을 돌려준다', () => {
    const t = new CompileStaleTracker();
    t.mark(IP, 'A', 'a');
    t.mark(IP, 'B', 'b');
    const r = t.clearMany(IP, ['a', 'Nope']);
    assert.deepStrictEqual(r.cleared.map(i => i.projectName), ['A']);
    assert.deepStrictEqual(r.remaining.map(i => i.projectName), ['B']);
    assert.deepStrictEqual(t.clearMany(IP, ['Nope']).cleared, []);
});

test('compileStale: describeCompileStale — 라이브러리는 Quick Compile 대신 쓰는 쪽 Compile 로 해제된다고 안내', () => {
    const base = { ip: IP, projectName: 'PaL', since: 0, markedAt: 0, reason: 'Upload Only' };
    const lib = describeCompileStale({ ...base, library: true }, () => 'T');
    assert.ok(lib.includes('ProjectLibrary 로 쓰는 실행 프로젝트'));
    assert.ok(!lib.includes('Quick Compile'));
    assert.ok(describeCompileStale(base, () => 'T').includes('Quick Compile'));
});
