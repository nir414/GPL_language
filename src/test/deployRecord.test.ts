import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
// vscode 무의존 검증: deployRecord.ts(vscode import)가 아니라 코어만 import 한다.
import {
    CompiledRecord,
    DeployRecordStore,
    DEPLOY_RECORD_MEMENTO_KEY,
    compareWithLocal,
    deployRecordKey,
    diffSnapshots,
    formatCompiledAt,
    isCompiledRecord,
    snapshotProjectFiles,
} from '../controller/deployRecordCore';

/** 임시 프로젝트 폴더: .gpl/.gpo/.gpr(대상) + .txt/dot 폴더/node_modules(제외 대상). */
function makeProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-deployrecord-test-'));
    const write = (rel: string, content: string) => {
        const full = path.join(dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
    };
    write('Project.gpr', 'ProjectName=Demo\r\n');
    write('Main.gpl', 'Module Main\r\nEnd Module\r\n');
    write('sub/Helper.GPL', "Module Helper\r\nEnd Module\r\n");
    write('sub/Obj.gpo', 'binary-ish');
    write('notes.txt', 'not a source');
    write('.history/Main.gpl', 'stale copy');
    write('node_modules/x/Main.gpl', 'dependency copy');
    return {
        dir,
        write,
        remove(rel: string) { fs.rmSync(path.join(dir, ...rel.split('/'))); },
        touch(rel: string, ms: number) {
            const full = path.join(dir, ...rel.split('/'));
            fs.utimesSync(full, new Date(ms), new Date(ms));
        },
        cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
    };
}

test('deployRecord: snapshotProjectFiles는 .gpl/.gpo/.gpr만 상대경로(/)로 수집하고 .txt·dot·node_modules를 제외한다', () => {
    const p = makeProject();
    try {
        const snap = snapshotProjectFiles(p.dir);
        assert.deepStrictEqual(Object.keys(snap), ['Main.gpl', 'Project.gpr', 'sub/Helper.GPL', 'sub/Obj.gpo'], '정렬된 상대 경로, 원래 대소문자 유지');
        for (const [key, stamp] of Object.entries(snap)) {
            assert.ok(!key.includes('\\'), `구분자는 /: ${key}`);
            assert.ok(!path.isAbsolute(key), `상대 경로: ${key}`);
            assert.strictEqual(typeof stamp.size, 'number');
            assert.strictEqual(typeof stamp.mtimeMs, 'number');
            assert.match(stamp.sha1, /^[0-9a-f]{40}$/, 'sha1 hex 40자');
        }
        assert.strictEqual(snap['Main.gpl'].size, Buffer.byteLength('Module Main\r\nEnd Module\r\n'));
    } finally {
        p.cleanup();
    }
});

test('deployRecord: 내용 변경 → stale, 삭제 → missing, 추가 → added', () => {
    const p = makeProject();
    try {
        const compiled = snapshotProjectFiles(p.dir);
        p.write('Main.gpl', 'Module Main\r\n  Dim x As Integer\r\nEnd Module\r\n');
        p.remove('sub/Obj.gpo');
        p.write('sub/New.gpl', 'Module New\r\nEnd Module\r\n');
        const diff = diffSnapshots(compiled, snapshotProjectFiles(p.dir));
        assert.deepStrictEqual(diff, { stale: ['Main.gpl'], missing: ['sub/Obj.gpo'], added: ['sub/New.gpl'] });
    } finally {
        p.cleanup();
    }
});

test('deployRecord: 변경 없음 → 빈 diff', () => {
    const p = makeProject();
    try {
        const a = snapshotProjectFiles(p.dir);
        const b = snapshotProjectFiles(p.dir);
        assert.deepStrictEqual(diffSnapshots(a, b), { stale: [], missing: [], added: [] });
    } finally {
        p.cleanup();
    }
});

test('deployRecord: 대소문자·구분자만 다른 경로는 같은 파일로 취급한다', () => {
    const stamp = { size: 10, mtimeMs: 1, sha1: 'a'.repeat(40) };
    const compiled = { 'Sub/Helper.gpl': stamp, 'Main.GPL': stamp };
    const current = { 'sub\\helper.GPL': stamp, 'main.gpl': { ...stamp, sha1: 'b'.repeat(40) } };
    const diff = diffSnapshots(compiled, current);
    assert.deepStrictEqual(diff.missing, [], '대소문자/구분자 차이는 missing이 아니다');
    assert.deepStrictEqual(diff.added, [], '대소문자/구분자 차이는 added가 아니다');
    assert.deepStrictEqual(diff.stale, ['Main.GPL'], '내용이 다른 것만 stale, 컴파일본 쪽 표기 사용');
});

test('deployRecord: 동일 내용 재저장(mtime만 변경)은 stale이 아니다 (sha1 기준)', () => {
    const p = makeProject();
    try {
        const compiled = snapshotProjectFiles(p.dir);
        // 같은 내용을 다시 쓰고 mtime을 확실히 다르게 만든다
        p.write('Main.gpl', 'Module Main\r\nEnd Module\r\n');
        p.touch('Main.gpl', compiled['Main.gpl'].mtimeMs + 60_000);
        const current = snapshotProjectFiles(p.dir);
        assert.notStrictEqual(current['Main.gpl'].mtimeMs, compiled['Main.gpl'].mtimeMs, '전제: mtime이 달라졌다');
        assert.deepStrictEqual(diffSnapshots(compiled, current), { stale: [], missing: [], added: [] });
    } finally {
        p.cleanup();
    }
});

test('deployRecord: sha1이 없는(구버전) 스탬프는 size/mtime으로 폴백 비교한다', () => {
    const old = { size: 10, mtimeMs: 100, sha1: '' };
    assert.deepStrictEqual(diffSnapshots({ 'a.gpl': old }, { 'a.gpl': { size: 10, mtimeMs: 100, sha1: 'x' } }).stale, []);
    assert.deepStrictEqual(diffSnapshots({ 'a.gpl': old }, { 'a.gpl': { size: 10, mtimeMs: 101, sha1: 'x' } }).stale, ['a.gpl']);
    assert.deepStrictEqual(diffSnapshots({ 'a.gpl': old }, { 'a.gpl': { size: 11, mtimeMs: 100, sha1: 'x' } }).stale, ['a.gpl']);
});

test('deployRecord: compareWithLocal은 projectDir 생략 시 rec.projectDir을 쓴다', () => {
    const p = makeProject();
    try {
        const rec: CompiledRecord = {
            ip: '192.168.0.1', projectName: 'Demo', projectDir: p.dir, compiledAt: Date.now(),
            files: snapshotProjectFiles(p.dir),
        };
        assert.deepStrictEqual(compareWithLocal(rec), { stale: [], missing: [], added: [] });
        p.write('sub/Helper.GPL', 'Module Helper\r\n  Dim y\r\nEnd Module\r\n');
        assert.deepStrictEqual(compareWithLocal(rec).stale, ['sub/Helper.GPL']);
        assert.deepStrictEqual(compareWithLocal(rec, p.dir).stale, ['sub/Helper.GPL'], '명시 projectDir도 동일');
    } finally {
        p.cleanup();
    }
});

test('deployRecord: formatCompiledAt은 MM-DD HH:mm:ss (0 패딩)', () => {
    const ms = new Date(2026, 0, 5, 7, 8, 9).getTime(); // 로컬 시각 1월 5일 07:08:09
    assert.strictEqual(formatCompiledAt(ms), '01-05 07:08:09');
});

test('deployRecord: deployRecordKey는 ip/projectName을 trim·소문자로 정규화한다', () => {
    assert.strictEqual(deployRecordKey('192.168.0.1', 'MergeCode'), deployRecordKey(' 192.168.0.1 ', 'mergecode'));
    assert.notStrictEqual(deployRecordKey('192.168.0.1', 'A'), deployRecordKey('192.168.0.2', 'A'));
});

/** vscode.Memento 흉내: get/update 기록 + 실패 주입. */
function fakeMemento(initial: Record<string, any> = {}, opts: { failUpdate?: 'throw' | 'reject' } = {}) {
    const store: Record<string, any> = { ...initial };
    const updates: Array<{ key: string; value: any }> = [];
    return {
        store,
        updates,
        get<T>(key: string, def: T): T { return (key in store ? store[key] : def) as T; },
        update(key: string, value: any): PromiseLike<void> {
            updates.push({ key, value });
            if (opts.failUpdate === 'throw') { throw new Error('update failed (sync)'); }
            if (opts.failUpdate === 'reject') { return Promise.reject(new Error('update failed (async)')); }
            store[key] = value;
            return Promise.resolve();
        },
    };
}

function makeRecord(over: Partial<CompiledRecord> = {}): CompiledRecord {
    return {
        ip: '192.168.0.1', projectName: 'Demo', projectDir: 'C:/proj/Demo', compiledAt: 1_700_000_000_000,
        files: { 'Main.gpl': { size: 1, mtimeMs: 1, sha1: 'a'.repeat(40) } },
        ...over,
    };
}

test('deployRecord: store.record/get은 ip+projectName(대소문자 무시)로 조회되고 Memento에 gpl.deployRecords로 저장된다', () => {
    const m = fakeMemento();
    const s = new DeployRecordStore();
    s.attach(m);
    const rec = makeRecord();
    s.record(rec);
    assert.strictEqual(s.get('192.168.0.1', 'demo'), rec, '프로젝트명 대소문자 무시');
    assert.strictEqual(s.get('192.168.0.1', 'DEMO'), rec);
    assert.strictEqual(s.get('192.168.0.2', 'Demo'), undefined, '다른 ip는 별개');
    assert.strictEqual(m.updates.length, 1);
    assert.strictEqual(m.updates[0].key, DEPLOY_RECORD_MEMENTO_KEY);
    assert.deepStrictEqual(Object.values(m.store[DEPLOY_RECORD_MEMENTO_KEY]), [rec]);

    // 같은 키 재기록은 덮어쓴다
    const newer = makeRecord({ compiledAt: rec.compiledAt + 1000 });
    s.record(newer);
    assert.strictEqual(s.get('192.168.0.1', 'Demo'), newer);
    assert.strictEqual(Object.keys(m.store[DEPLOY_RECORD_MEMENTO_KEY]).length, 1);
});

test('deployRecord: attach는 기존 저장분을 로드하고 손상 항목은 건너뛰며, 메모리의 더 새로운 레코드를 유지한다', () => {
    const stored = makeRecord({ projectName: 'Stored', compiledAt: 100 });
    const olderDup = makeRecord({ projectName: 'Mem', compiledAt: 50 });
    const m = fakeMemento({
        [DEPLOY_RECORD_MEMENTO_KEY]: {
            [deployRecordKey(stored.ip, stored.projectName)]: stored,
            [deployRecordKey(olderDup.ip, olderDup.projectName)]: olderDup,
            broken1: { ip: 1, projectName: 'x' },
            broken2: { ...makeRecord(), files: { 'a.gpl': { size: 'big' } } },
            broken3: null,
        },
    });
    const s = new DeployRecordStore();
    const memNewer = makeRecord({ projectName: 'Mem', compiledAt: 200 });
    s.record(memNewer); // attach 전 기록(메모리만)
    s.attach(m);
    assert.deepStrictEqual(s.get('192.168.0.1', 'stored'), stored, '저장분 로드');
    assert.strictEqual(s.get('192.168.0.1', 'Mem'), memNewer, '메모리 쪽이 더 새로우면 유지');
    assert.strictEqual(s.all().length, 2, '손상 항목 3개는 제외');
    assert.strictEqual(isCompiledRecord(stored), true);
    assert.strictEqual(isCompiledRecord({ ...stored, compiledAt: NaN }), false);
});

test('deployRecord: Memento 저장 실패(동기 throw/비동기 reject)는 조용히 무시되고 메모리 기록은 유지된다', async () => {
    const errors: unknown[] = [];
    for (const mode of ['throw', 'reject'] as const) {
        const m = fakeMemento({}, { failUpdate: mode });
        const s = new DeployRecordStore(err => errors.push(err));
        s.attach(m);
        const rec = makeRecord();
        assert.doesNotThrow(() => s.record(rec));
        assert.strictEqual(s.get(rec.ip, rec.projectName), rec);
    }
    await new Promise(r => setTimeout(r, 0)); // reject 콜백 flush
    assert.strictEqual(errors.length, 2, '실패는 콜백으로만 보고');
});

test('deployRecord: attach의 memento.get이 throw 해도 예외 없이 빈 상태로 시작한다', () => {
    const s = new DeployRecordStore();
    assert.doesNotThrow(() => s.attach({ get() { throw new Error('boom'); }, update() { /* noop */ } }));
    assert.strictEqual(s.all().length, 0);
});
