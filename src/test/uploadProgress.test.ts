import * as assert from 'assert';
import { test } from './harness';
import { UploadProgressTracker } from '../controller/deployment/uploadProgress';
import type { UploadProgressEvent } from '../controller/deployment/uploadProgress';

// ─── 업로드 진행 집계(tracker) — ftpClient 가 지키는 규약(begin → transferred… → end / 스킵은 end 만) (§1-EE) ───
// 표시(바·툴팁·완료 요약)는 views/uploadProgressBar → uploadProgressBar.test.ts.

test('uploadProgress: tracker — 스킵은 즉시 완료로, 전송 중 바이트는 파일 크기로 자르고 begin 없는 바이트는 무시', () => {
    const events: UploadProgressEvent[] = [];
    const tracker = new UploadProgressTracker([{ size: 100 }, { size: 50 }, { size: 0 }], e => events.push(e));
    assert.strictEqual(tracker.totalBytes, 150);
    assert.strictEqual(tracker.totalFiles, 3);

    tracker.transferred(40);
    assert.strictEqual(events.length, 0, 'begin 전의 바이트(목록 조회 등)는 집계되지 않는다');

    tracker.begin('App/Main.gpl', 100);
    tracker.transferred(40);
    tracker.transferred(500);
    tracker.end('App/Main.gpl', 100, 'uploaded');
    tracker.end('Lib/Util.gpl', 50, 'skipped');
    tracker.begin('Empty.gpl', 0);
    tracker.end('Empty.gpl', 0, 'uploaded');

    const bytes = events.filter(e => e.type === 'bytes');
    assert.deepStrictEqual(bytes.map(e => e.doneBytes), [0, 40, 100, 150], '전송분은 파일 크기를 넘지 않는다');
    assert.strictEqual(bytes[1].file, 'App/Main.gpl');

    const files = events.filter(e => e.type === 'file');
    assert.deepStrictEqual(
        files.map(e => [e.file, e.type === 'file' ? e.action : undefined, e.doneFiles, e.doneBytes]),
        [['App/Main.gpl', 'uploaded', 1, 100], ['Lib/Util.gpl', 'skipped', 2, 150], ['Empty.gpl', 'uploaded', 3, 150]],
    );
    assert.deepStrictEqual(tracker.snapshot(), { doneBytes: 150, totalBytes: 150, doneFiles: 3, totalFiles: 3, file: undefined });
});

test('uploadProgress: tracker — 검증 실패 재전송(0 부터 다시)에서도 완료분은 뒤로 가지 않는다', () => {
    const events: UploadProgressEvent[] = [];
    const tracker = new UploadProgressTracker([{ size: 100 }, { size: 100 }], e => events.push(e));
    tracker.begin('a', 100);
    tracker.transferred(100);
    tracker.end('a', 100, 'uploaded');
    tracker.begin('b', 100);
    tracker.transferred(100);
    tracker.transferred(0);      // 재전송 시작 — 전송 중 파일만 0 으로
    assert.strictEqual(events[events.length - 1].doneBytes, 100, '앞서 끝난 파일의 100 은 유지');
    tracker.transferred(60);
    assert.strictEqual(events[events.length - 1].doneBytes, 160);
});

test('uploadProgress: tracker — 루프 전 스냅샷 크기로 begin/end 하면 끝났을 때 done == total (파일이 그 사이 커져도)', () => {
    const events: UploadProgressEvent[] = [];
    const tracker = new UploadProgressTracker([{ size: 100 }], e => events.push(e));
    tracker.begin('a', 100);
    tracker.transferred(180);    // 실제 파일은 그 사이 180 바이트로 자랐다 — 스냅샷 크기로 잘린다
    tracker.end('a', 100, 'uploaded');
    assert.deepStrictEqual(events.map(e => e.doneBytes), [0, 100, 100]);
    assert.strictEqual(tracker.snapshot().doneBytes, tracker.totalBytes);
});
