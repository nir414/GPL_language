import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import {
    MAX_MANIFEST_RECORDS,
    SYNC_MANIFEST_MEMENTO_KEY,
    SyncManifestRecord,
    SyncManifestStore,
    hashFileSync,
    isSyncManifestRecord,
    isUnchanged,
    manifestFileKey,
    nextStamp,
    normalizeRemoteDir,
    syncManifestKey,
} from '../controller/syncManifest';

const LOCAL = { size: 100, sha1: 'aaa' };

test('syncManifest: 원격에 없으면 업로드', () => {
    assert.strictEqual(isUnchanged({ size: 100, sha1: 'aaa' }, LOCAL, undefined), false);
});

test('syncManifest: 크기가 다르면 업로드', () => {
    assert.strictEqual(isUnchanged({ size: 100, sha1: 'aaa' }, LOCAL, { size: 101 }), false);
});

test('syncManifest: 크기가 같아도 지문이 없으면 업로드(첫 동기화)', () => {
    assert.strictEqual(isUnchanged(undefined, LOCAL, { size: 100 }), false);
});

test('syncManifest: 크기가 같아도 내용이 바뀌면 업로드 — 핵심 회귀', () => {
    // 종전(크기 비교)은 스킵했던 경우: 같은 길이로 고친 소스.
    assert.strictEqual(isUnchanged({ size: 100, sha1: 'old' }, LOCAL, { size: 100 }), false);
});

test('syncManifest: 크기·지문이 모두 같으면 스킵', () => {
    assert.strictEqual(isUnchanged({ size: 100, sha1: 'aaa' }, LOCAL, { size: 100 }), true);
});

test('syncManifest: 구버전 기록(sha1 없음)은 스킵하지 않는다', () => {
    assert.strictEqual(isUnchanged({ size: 100, sha1: '' }, LOCAL, { size: 100 }), false);
});

test('syncManifest: 로컬 해시를 못 구하면 종전대로 크기 비교로 폴백', () => {
    const unhashable = { size: 100, sha1: '' };
    assert.strictEqual(isUnchanged(undefined, unhashable, { size: 100 }), true);
    assert.strictEqual(isUnchanged(undefined, unhashable, { size: 101 }), false);
});

test('syncManifest: 관측된 원격 mtime이 기록과 다르면 업로드(외부 변경)', () => {
    const stamp = { size: 100, sha1: 'aaa', remoteMtimeMs: 1000 };
    assert.strictEqual(isUnchanged(stamp, LOCAL, { size: 100, modifiedAtMs: 1000 }), true);
    assert.strictEqual(isUnchanged(stamp, LOCAL, { size: 100, modifiedAtMs: 2000 }), false);
    // 한쪽이라도 mtime을 모르면 비교 자체를 생략한다(제어기가 목록에 시각을 안 주는 경우).
    assert.strictEqual(isUnchanged(stamp, LOCAL, { size: 100 }), true);
    assert.strictEqual(isUnchanged({ size: 100, sha1: 'aaa' }, LOCAL, { size: 100, modifiedAtMs: 2000 }), true);
});

test('syncManifest: nextStamp — 업로드 직후에는 원격 mtime을 비워 둔다', () => {
    const stamp = nextStamp(LOCAL, { size: 100, modifiedAtMs: 1000 }, { size: 100, sha1: 'old', remoteMtimeMs: 1000 }, 'uploaded');
    assert.deepStrictEqual(stamp, { size: 100, sha1: 'aaa' });
});

test('syncManifest: nextStamp — 스킵 시 관측한 원격 mtime을 채택한다', () => {
    const adopted = nextStamp(LOCAL, { size: 100, modifiedAtMs: 1000 }, { size: 100, sha1: 'aaa' }, 'skipped');
    assert.deepStrictEqual(adopted, { size: 100, sha1: 'aaa', remoteMtimeMs: 1000 });
    // 관측치가 없으면 기존 기록을 유지한다.
    const kept = nextStamp(LOCAL, { size: 100 }, { size: 100, sha1: 'aaa', remoteMtimeMs: 500 }, 'skipped');
    assert.deepStrictEqual(kept, { size: 100, sha1: 'aaa', remoteMtimeMs: 500 });
});

test('syncManifest: 업로드 → 다음 회차 스킵 → 같은 크기 편집 → 다시 업로드', () => {
    // 실제 미러 흐름의 축약: uploaded 지문 → 관측 → skipped(mtime 채택) → 내용만 변경.
    const afterUpload = nextStamp(LOCAL, undefined, undefined, 'uploaded');
    assert.strictEqual(isUnchanged(afterUpload, LOCAL, { size: 100, modifiedAtMs: 7 }), true);
    const afterSkip = nextStamp(LOCAL, { size: 100, modifiedAtMs: 7 }, afterUpload, 'skipped');
    assert.strictEqual(afterSkip.remoteMtimeMs, 7);
    const edited = { size: 100, sha1: 'bbb' };  // 길이는 그대로, 내용만 변경
    assert.strictEqual(isUnchanged(afterSkip, edited, { size: 100, modifiedAtMs: 7 }), false);
});

test('syncManifest: 키 정규화(host·원격 경로·파일 경로)', () => {
    assert.strictEqual(normalizeRemoteDir('/GPL/Demo/'), '/gpl/demo');
    assert.strictEqual(normalizeRemoteDir('\\GPL\\\\Demo'), '/gpl/demo');
    assert.strictEqual(syncManifestKey(' 192.168.0.1 ', '/GPL/Demo/'), '192.168.0.1|/gpl/demo');
    assert.strictEqual(manifestFileKey('sub\\Helper.GPL'), 'sub/helper.gpl');
    assert.strictEqual(manifestFileKey('./Main.gpl'), 'main.gpl');
});

test('syncManifest: hashFileSync — 같은 내용은 같은 해시, 한 글자만 달라도 다른 해시', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-syncmanifest-test-'));
    try {
        const a = path.join(dir, 'a.gpl');
        const b = path.join(dir, 'b.gpl');
        fs.writeFileSync(a, 'Speed = 10\r\n', 'utf8');
        fs.writeFileSync(b, 'Speed = 20\r\n', 'utf8');   // 크기 동일, 내용 다름
        assert.strictEqual(fs.statSync(a).size, fs.statSync(b).size);
        assert.notStrictEqual(hashFileSync(a), hashFileSync(b));
        assert.strictEqual(hashFileSync(a), hashFileSync(a));
        assert.strictEqual(hashFileSync(path.join(dir, 'none.gpl')), '');     // 읽기 실패 → ''
        assert.strictEqual(hashFileSync(a, 128 * 1024 * 1024), '');           // 상한 초과 → ''
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('syncManifest: 저장소 replace/merge/forget', () => {
    const store = new SyncManifestStore();
    store.replace('192.168.0.1', '/GPL/Demo', { 'main.gpl': { size: 1, sha1: 'a' } }, 10);
    store.merge('192.168.0.1', '/gpl/demo/', { 'sub/x.gpl': { size: 2, sha1: 'b' } }, 20);
    assert.deepStrictEqual(store.get('192.168.0.1', '/GPL/Demo'), {
        'main.gpl': { size: 1, sha1: 'a' },
        'sub/x.gpl': { size: 2, sha1: 'b' },
    });
    // replace는 사라진 파일의 지문까지 정리한다.
    store.replace('192.168.0.1', '/GPL/Demo', { 'main.gpl': { size: 3, sha1: 'c' } }, 30);
    assert.deepStrictEqual(store.get('192.168.0.1', '/GPL/Demo'), { 'main.gpl': { size: 3, sha1: 'c' } });
    store.forget('192.168.0.1', '/GPL/Demo');
    assert.deepStrictEqual(store.get('192.168.0.1', '/GPL/Demo'), {});
});

test('syncManifest: 저장소 — Memento 영속화와 재로드', () => {
    const data: Record<string, any> = {};
    const memento = {
        get<T>(key: string, def: T): T { return (key in data ? data[key] : def) as T; },
        update(key: string, value: any) { data[key] = value; },
    };
    const store = new SyncManifestStore();
    store.attach(memento);
    store.replace('192.168.0.1', '/GPL/Demo', { 'main.gpl': { size: 1, sha1: 'a' } }, 10);
    assert.ok(data[SYNC_MANIFEST_MEMENTO_KEY]);

    const reloaded = new SyncManifestStore();
    reloaded.attach(memento);
    assert.deepStrictEqual(reloaded.get('192.168.0.1', '/gpl/demo'), { 'main.gpl': { size: 1, sha1: 'a' } });
});

test('syncManifest: 손상된 저장분은 걸러내고, 저장 실패는 삼킨다', () => {
    assert.strictEqual(isSyncManifestRecord({ host: 'h', remoteDir: '/d', syncedAt: 1, files: {} }), true);
    assert.strictEqual(isSyncManifestRecord({ host: 'h', remoteDir: '/d', syncedAt: 1, files: { a: { size: 1 } } }), false);
    assert.strictEqual(isSyncManifestRecord({ host: 'h', remoteDir: '/d', files: {} }), false);
    assert.strictEqual(isSyncManifestRecord(null), false);

    const errors: unknown[] = [];
    const store = new SyncManifestStore(err => errors.push(err));
    store.attach({
        get<T>(_key: string, _def: T): T { return { bad: { host: 1 }, ok: { host: 'h', remoteDir: '/d', syncedAt: 1, files: {} } } as any; },
        update() { throw new Error('memento down'); },
    });
    assert.strictEqual(store.all().length, 1);
    store.replace('h', '/d', {}, 2);            // 저장 실패해도 throw 하지 않는다
    assert.strictEqual(errors.length, 1);
    assert.deepStrictEqual(store.get('h', '/d'), {});
});

test('syncManifest: 보관 개수 상한을 넘으면 오래된 기록부터 버린다', () => {
    const store = new SyncManifestStore();
    for (let i = 0; i < MAX_MANIFEST_RECORDS + 3; i++) {
        store.replace('192.168.0.1', `/GPL/P${i}`, { 'main.gpl': { size: i, sha1: `h${i}` } }, i + 1);
    }
    assert.strictEqual(store.all().length, MAX_MANIFEST_RECORDS);
    assert.deepStrictEqual(store.get('192.168.0.1', '/GPL/P0'), {});   // 가장 오래된 것부터 사라짐
    const newest: SyncManifestRecord[] = store.all();
    assert.ok(newest.every(r => r.syncedAt > 3));
});
