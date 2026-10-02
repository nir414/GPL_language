import * as assert from 'assert';
import { test } from './harness';
import {
    UPLOAD_BAR_WIDTH,
    describeUploadProgress,
    formatBytesPair,
    renderBar,
    renderUploadProgress,
    renderUploadSummary,
} from '../views/uploadProgressBar';

// ─── 상태바 업로드 진행 바 — 표시 규칙의 정본 (§1-EE, R7). 집계는 controller/uploadProgress → uploadProgress.test.ts ───

const MB = 1024 * 1024;

test('uploadProgressBar: done / total 은 total 의 단위로 맞춰 나란히 쓴다', () => {
    assert.strictEqual(formatBytesPair(3.2 * MB, 10.7 * MB), '3.2 MB / 10.7 MB');
    // done 이 KB 급이어도 total 이 MB 면 MB 로 — 단위가 다르면 비율이 한눈에 안 읽힌다.
    assert.strictEqual(formatBytesPair(48 * 1024, 10.7 * MB), '0.0 MB / 10.7 MB');
    assert.strictEqual(formatBytesPair(512, 1000), '512 B / 1000 B');
    assert.strictEqual(formatBytesPair(0, 0), '0 B / 0 B');
});

test('uploadProgressBar: 진행 바 — 0%/50%/100%, 넘침·총량 0 처리', () => {
    assert.strictEqual(renderBar(0, 100, 10), '░░░░░░░░░░');
    assert.strictEqual(renderBar(50, 100, 10), '█████░░░░░');
    assert.strictEqual(renderBar(100, 100, 10), '██████████');
    assert.strictEqual(renderBar(250, 100, 10), '██████████', 'done > total 은 가득 찬 바');
    assert.strictEqual(renderBar(0, 0, 10), '██████████', '올릴 것이 없으면 완료로 보인다');
    assert.strictEqual(renderBar(0, 100, 0), '');
    assert.strictEqual(renderBar(37, 100).length, UPLOAD_BAR_WIDTH, '기본 폭은 상수 하나로 고정');
});

test('uploadProgressBar: 경계 칸은 1/8 부분 블록으로 그려 작은 비율에서도 바가 움직인다', () => {
    // 폭 4 칸 → 한 칸 = 25%. 1/32(3.125%) 는 첫 칸의 1/8 → ▏
    assert.strictEqual(renderBar(1, 32, 4), '▏░░░');
    // 첫 칸의 절반(12.5%) → ▌
    assert.strictEqual(renderBar(1, 8, 4), '▌░░░');
    // 한 칸 가득(25%) 은 부분 블록 없이 █
    assert.strictEqual(renderBar(1, 4, 4), '█░░░');
    // 마지막 칸 직전(96.9%) — 마지막 칸이 부분 블록, 넘치지 않음
    assert.strictEqual(renderBar(31, 32, 4), '███▉');
});

test('uploadProgressBar: 상태바 본문은 바 + 크기만, 파일·개수는 툴팁에 — 전송 중/완료/동일을 이벤트 종류로 구분', () => {
    const text = renderUploadProgress({ doneBytes: 5.35 * MB, totalBytes: 10.7 * MB, doneFiles: 12, totalFiles: 47, file: 'App/Main.gpl' });
    assert.ok(new RegExp(`^[█▏▎▍▌▋▊▉░]{${UPLOAD_BAR_WIDTH}}  5\\.[34] MB / 10\\.7 MB$`).test(text), text);

    const base = { doneBytes: 100, totalBytes: 400, doneFiles: 1, totalFiles: 4, file: 'App/Main.gpl' };
    const sending = describeUploadProgress({ ...base, type: 'bytes' }, 'MergeCode');
    assert.ok(sending.startsWith('MergeCode 업로드 중 — 1/4 파일 · 100 B / 400 B'), sending);
    assert.ok(sending.includes('\n전송 중: App/Main.gpl'), sending);

    const uploaded = describeUploadProgress({ ...base, type: 'file', action: 'uploaded' });
    assert.ok(uploaded.startsWith('업로드 중 — 1/4 파일') && uploaded.includes('\n완료: App/Main.gpl') && !uploaded.includes('전송 중'), uploaded);

    // 스킵만 이어지는 구간에 "전송 중" 이라고 쓰면 거짓 — "동일:" 로.
    const skipped = describeUploadProgress({ ...base, type: 'file', action: 'skipped', file: 'Lib/Util.gpl' });
    assert.ok(skipped.includes('\n동일: Lib/Util.gpl') && !skipped.includes('전송 중'), skipped);

    const done = describeUploadProgress({ doneBytes: 400, totalBytes: 400, doneFiles: 4, totalFiles: 4, file: 'Last.gpl', type: 'file', action: 'uploaded' });
    assert.ok(done.startsWith('업로드 중 — 4/4 파일') && !done.includes('완료:') && !done.includes('전송 중'), done);
});

test('uploadProgressBar: 완료 요약 — 전송이 있으면 크기·전송·동일, 전부 동일이면 "변경 없음"', () => {
    assert.strictEqual(renderUploadSummary({ uploaded: 3, skipped: 44, totalBytes: 10.7 * MB }), '업로드 완료 10.7 MB (3 전송 · 44 동일)');
    assert.strictEqual(renderUploadSummary({ uploaded: 2, skipped: 0, totalBytes: 2048 }), '업로드 완료 2.0 KB (2 전송)');
    assert.strictEqual(renderUploadSummary({ uploaded: 0, skipped: 47, totalBytes: 2048 }), '업로드 완료 — 변경 없음 (47 동일, 2.0 KB)');
    assert.strictEqual(renderUploadSummary({ uploaded: 0, skipped: 0, totalBytes: 0 }), '업로드 완료 0 B (0 전송)');
});
