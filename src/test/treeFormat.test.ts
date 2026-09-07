import * as assert from 'assert';
import { test } from './harness';
import { formatConnectionStats, formatDate, formatDateTimeFromTs, formatSize } from '../views/treeFormat';

test('treeFormat 크기: B / KB / MB 경계와 소수 1자리', () => {
    assert.strictEqual(formatSize(0), '0 B');
    assert.strictEqual(formatSize(1023), '1023 B');
    assert.strictEqual(formatSize(1024), '1.0 KB');
    assert.strictEqual(formatSize(1536), '1.5 KB');
    assert.strictEqual(formatSize(1024 * 1024), '1.0 MB');
    assert.strictEqual(formatSize(5 * 1024 * 1024 + 512 * 1024), '5.5 MB');
});

test('treeFormat 날짜: YYYY-MM-DD HH:mm (로컬 시각, 0 채움)', () => {
    assert.strictEqual(formatDate(new Date(2026, 8, 7, 9, 5)), '2026-09-07 09:05');
    assert.strictEqual(formatDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31 23:59');
});

test('treeFormat 타임스탬프: 없으면 "(없음)", 있으면 ko-KR 로캘 문자열', () => {
    assert.strictEqual(formatDateTimeFromTs(undefined), '(없음)');
    assert.strictEqual(formatDateTimeFromTs(0), '(없음)');
    const s = formatDateTimeFromTs(new Date(2026, 8, 7, 9, 5).getTime());
    assert.ok(s.length > 0 && s !== '(없음)', s);
    assert.ok(s.includes('2026'), s);
});

test('treeFormat 연결 통계: keep-alive 상태 · 연결/재사용 횟수, 재시도는 있을 때만', () => {
    assert.strictEqual(formatConnectionStats(undefined), '');
    assert.strictEqual(
        formatConnectionStats({ connects: 3, reuses: 412, retries: 0, keepAliveActive: true }),
        'keep-alive 유지 중 · 연결 3회 · 재사용 412회',
    );
    assert.strictEqual(
        formatConnectionStats({ connects: 1, reuses: 0, retries: 2, keepAliveActive: false }),
        'keep-alive 대기 · 연결 1회 · 재사용 0회 · 재시도 2회',
    );
});
