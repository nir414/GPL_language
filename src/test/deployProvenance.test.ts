import * as assert from 'assert';
import { test } from './harness';
import {
    compareProvenance,
    describeProvenance,
    provenanceKey,
    revisionOf,
} from '../controller/deployProvenance';
import type { ProvenanceStamp } from '../controller/deployProvenance';

const stamp = (sha1: string, size = 100): ProvenanceStamp => ({ sha1, size });

test('deployProvenance: 같은 내용이면 같은 revision, 파일 하나만 달라도 달라진다', () => {
    const a = { 'Main.gpl': stamp('aaa'), 'Lib.gpl': stamp('bbb') };
    // 키 순서가 달라도 같은 값이어야 한다(정렬해 계산하므로).
    const b = { 'Lib.gpl': stamp('bbb'), 'Main.gpl': stamp('aaa') };
    assert.strictEqual(revisionOf(a), revisionOf(b));
    assert.notStrictEqual(revisionOf(a), revisionOf({ ...a, 'Main.gpl': stamp('ccc') }));
    // 파일이 하나 늘면 달라진다.
    assert.notStrictEqual(revisionOf(a), revisionOf({ ...a, 'New.gpl': stamp('ddd') }));
    // 해시가 없으면 크기로 대신한다 — 크기가 다르면 revision 도 다르다.
    assert.notStrictEqual(revisionOf({ 'X.gpl': stamp('', 10) }), revisionOf({ 'X.gpl': stamp('', 11) }));
});

test('deployProvenance: 올린 내용과 로컬이 같으면 inSync', () => {
    const files = { 'Main.gpl': stamp('aaa'), 'Project.gpr': stamp('bbb') };
    const r = compareProvenance({ local: files, uploaded: { ...files } });
    assert.strictEqual(r.inSync, true);
    assert.strictEqual(r.localRevision, r.uploadedRevision);
    assert.deepStrictEqual(r.notUploaded, []);
    assert.deepStrictEqual(r.changedSinceUpload, []);
    assert.strictEqual(r.fileCount, 2);
    assert.strictEqual(r.verifiedBy, 'upload-manifest');
});

test('deployProvenance: 고쳐 놓고 올리지 않은 파일을 집어낸다(가장 위험한 경우)', () => {
    const r = compareProvenance({
        local: { 'Main.gpl': stamp('NEW'), 'Lib.gpl': stamp('same') },
        uploaded: { 'Main.gpl': stamp('OLD'), 'Lib.gpl': stamp('same') },
    });
    assert.strictEqual(r.inSync, false);
    assert.deepStrictEqual(r.changedSinceUpload, ['Main.gpl']);
    assert.deepStrictEqual(r.notUploaded, []);
    assert.match(describeProvenance(r), /올린 뒤 변경 1개/);
});

test('deployProvenance: 업로드 기록이 없으면 동기화됨으로 넘어지지 않는다', () => {
    const r = compareProvenance({ local: { 'Main.gpl': stamp('aaa') }, uploaded: {} });
    assert.strictEqual(r.inSync, false, '판정 불가는 "올려야 함" 쪽으로 넘어져야 한다');
    assert.deepStrictEqual(r.notUploaded, ['Main.gpl']);
});

test('deployProvenance: 원격 잔재는 따로 알리고 revision 판정을 흔들지 않는다', () => {
    const r = compareProvenance({
        local: { 'Main.gpl': stamp('aaa') },
        uploaded: { 'Main.gpl': stamp('aaa'), 'Deleted.gpl': stamp('zzz') },
    });
    assert.strictEqual(r.inSync, true, '로컬에서 지운 파일 때문에 두 지문이 영영 어긋나면 안 된다');
    assert.deepStrictEqual(r.staleRemote, ['Deleted.gpl']);
});

test('deployProvenance: 경로 구분자·대소문자 차이를 흡수한다', () => {
    assert.strictEqual(provenanceKey('sub\\A.gpl'), 'sub/a.gpl');
    assert.strictEqual(provenanceKey('./Sub/A.gpl'), 'sub/a.gpl');
    const r = compareProvenance({
        local: { 'Sub\\Main.gpl': stamp('aaa') },
        uploaded: { 'sub/main.gpl': stamp('aaa') },
    });
    assert.strictEqual(r.inSync, true);
});

test('deployProvenance: 해시가 없는 파일은 크기로 비교한다', () => {
    const same = compareProvenance({ local: { 'X.gpl': stamp('', 42) }, uploaded: { 'X.gpl': stamp('', 42) } });
    assert.strictEqual(same.inSync, true);
    const diff = compareProvenance({ local: { 'X.gpl': stamp('', 42) }, uploaded: { 'X.gpl': stamp('', 43) } });
    assert.deepStrictEqual(diff.changedSinceUpload, ['X.gpl']);
});
