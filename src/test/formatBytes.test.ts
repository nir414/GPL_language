import * as assert from 'assert';
import { test } from './harness';
import { byteUnitFor, formatBytes, formatBytesAs } from '../util/formatBytes';

// ─── 바이트 → 사람이 읽는 크기 — 트리 FTP 목록·업로드 진행 바·완료 요약이 공유하는 정본 (§1-EE, R7) ───
// 종전 views/treeFormat.formatSize 의 기대값(B 정수·KB/MB 소수 1자리)을 그대로 잇고, GB 단계와 음수 클램프를 더했다.

test('formatBytes: B / KB / MB / GB 경계와 소수 1자리', () => {
    assert.strictEqual(formatBytes(0), '0 B');
    assert.strictEqual(formatBytes(1023), '1023 B');
    assert.strictEqual(formatBytes(1024), '1.0 KB');
    assert.strictEqual(formatBytes(1536), '1.5 KB');
    assert.strictEqual(formatBytes(1024 * 1024), '1.0 MB');
    assert.strictEqual(formatBytes(5 * 1024 * 1024 + 512 * 1024), '5.5 MB');
    assert.strictEqual(formatBytes(Math.round(10.7 * 1024 * 1024)), '10.7 MB');
    assert.strictEqual(formatBytes(1.5 * 1024 ** 3), '1.5 GB', '종전 트리 표기는 1536.0 MB — GB 단계 추가');
    assert.strictEqual(formatBytes(3000 * 1024 ** 3), '3000.0 GB', 'GB 에서 멈춘다');
    assert.strictEqual(formatBytes(-5), '0 B', '음수는 0 으로 자른다');
});

test('formatBytes: 단위 선택과 지정 단위 표기(두 값을 같은 단위로 나란히 쓸 때)', () => {
    assert.strictEqual(byteUnitFor(0), 'B');
    assert.strictEqual(byteUnitFor(1023), 'B');
    assert.strictEqual(byteUnitFor(1024), 'KB');
    assert.strictEqual(byteUnitFor(10.7 * 1024 * 1024), 'MB');
    assert.strictEqual(formatBytesAs(48 * 1024, 'MB'), '0.0 MB');
    assert.strictEqual(formatBytesAs(3.2 * 1024 * 1024, 'MB'), '3.2 MB');
    assert.strictEqual(formatBytesAs(512.4, 'B'), '512 B');
});
