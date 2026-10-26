import * as assert from 'assert';
import { test } from './harness';
import { MemoryBadgeOwner, MemoryNoticeTracker, formatMemoryDetail, formatMemoryToast, memoryBadge } from '../controller/diagnostics/memoryNotice';
import type { MemoryPrecheck } from '../controller/diagnostics/memoryGuard';

// 2026-10-23 Sample Prep 보고: 경고 구간(2.5~4 MB)에서 Compile·Start·배포마다 같은 경고 알림이 새로 쌓였다.
const IP = '192.168.0.1';
function check(freeMb: number | null, level?: MemoryPrecheck['level']): MemoryPrecheck {
    const lv = level ?? (freeMb === null ? 'unknown' : freeMb < 2.5 ? 'blocked' : freeMb < 4 ? 'warning' : 'ok');
    return { freeMb, warnMb: 4, blockMb: 2.5, level: lv, message: `여유 메모리 ${freeMb} MB (경고 4 MB / 차단 2.5 MB).` };
}

test('memoryNotice: ok → warning 에서 한 번 알리고, 같은 warning 반복은 알리지 않는다', () => {
    const t = new MemoryNoticeTracker();
    assert.strictEqual(t.evaluate(IP, check(6)).toast, false);
    const first = t.evaluate(IP, check(2.958));
    assert.deepStrictEqual({ toast: first.toast, reason: first.reason }, { toast: true, reason: 'worsened' });
    const again = t.evaluate(IP, check(2.95));
    assert.deepStrictEqual({ toast: again.toast, reason: again.reason }, { toast: false, reason: 'repeat' });
    assert.strictEqual(again.badge?.text, '$(warning) Free 2.95 MB', '지속 상태는 상태 표시줄이 숫자만 갱신한다');
});

test('memoryNotice: 직전 알림 대비 0.5 MB 이상 더 떨어지면 다시 알린다', () => {
    const t = new MemoryNoticeTracker();
    assert.strictEqual(t.evaluate(IP, check(3.6)).toast, true);
    assert.strictEqual(t.evaluate(IP, check(3.2)).toast, false, '0.4 MB 감소는 반복');
    const drop = t.evaluate(IP, check(3.1));
    assert.deepStrictEqual({ toast: drop.toast, reason: drop.reason }, { toast: true, reason: 'dropped' });
    assert.strictEqual(t.evaluate(IP, check(2.9)).toast, false, '기준은 마지막 알림(3.1) — 0.2 MB 감소');
});

test('memoryNotice: warning → blocked 는 나빠짐으로 한 번 알리고, ok 로 돌아오면 기억을 지운다', () => {
    const t = new MemoryNoticeTracker();
    t.evaluate(IP, check(3));
    const blocked = t.evaluate(IP, check(2.3));
    assert.deepStrictEqual({ toast: blocked.toast, reason: blocked.reason }, { toast: true, reason: 'worsened' });
    assert.strictEqual(t.evaluate(IP, check(2.2)).toast, false, '같은 차단 반복은 알리지 않는다(차단 자체는 호출부가 매번 한다)');
    const better = t.evaluate(IP, check(3));
    assert.deepStrictEqual({ toast: better.toast, reason: better.reason }, { toast: false, reason: 'improved' });
    const ok = t.evaluate(IP, check(5));
    assert.strictEqual(ok.reason, 'ok-reset');
    assert.strictEqual(ok.badge, null, 'ok 면 상태 표시줄 항목을 숨긴다');
    assert.strictEqual(t.levelOf(IP), undefined);
    assert.strictEqual(t.evaluate(IP, check(3.5)).toast, true, 'ok 뒤의 경고는 다시 나빠짐이다');
});

test('memoryNotice: 측정 실패(unknown)는 수준·배지를 바꾸지 않는다', () => {
    const t = new MemoryNoticeTracker();
    t.evaluate(IP, check(3));
    const u = t.evaluate(IP, check(null));
    assert.strictEqual(u.toast, false);
    assert.strictEqual('badge' in u, false, '배지 필드가 없으면 지금 표시를 유지한다');
    assert.strictEqual(t.levelOf(IP), 'warning');
    assert.strictEqual(t.evaluate(IP, check(3)).toast, false);
});

test('memoryNotice: 한 작업 범위 안에서는 알림 최대 1회(업로드 전 검사 + Start 큐 검사)', () => {
    const t = new MemoryNoticeTracker();
    t.beginScope(IP);
    assert.strictEqual(t.evaluate(IP, check(3.6)).toast, true);
    const second = t.evaluate(IP, check(2.9)); // 0.7 MB 감소지만 같은 작업
    assert.deepStrictEqual({ toast: second.toast, reason: second.reason }, { toast: false, reason: 'same-operation' });
    t.endScope(IP);
    // 범위 밖의 다음 작업: 기준은 마지막으로 **실제로 알린** 3.6 MB — 0.75 MB 감소라 다시 알린다.
    assert.strictEqual(t.evaluate(IP, check(2.85)).toast, true);
});

test('memoryNotice: 제어기 IP 별로 따로 기억한다', () => {
    const t = new MemoryNoticeTracker();
    assert.strictEqual(t.evaluate('10.0.0.1', check(3)).toast, true);
    assert.strictEqual(t.evaluate('10.0.0.2', check(3)).toast, true);
    assert.strictEqual(t.evaluate('10.0.0.1', check(3)).toast, false);
});

test('memoryNotice: 알림 문구는 짧게, 긴 안내(Unload 위험)는 상세로', () => {
    const c = check(2.958);
    assert.strictEqual(formatMemoryToast(c), '여유 메모리 2.96 MB — 경고 구간(4 MB 미만)');
    assert.doesNotMatch(formatMemoryToast(c), /Unload/);
    assert.match(formatMemoryDetail(c), /Unload 뒤에는 수 분간 명령 콘솔이 응답하지 않을 수 있습니다/);
    assert.match(formatMemoryDetail(c), /경고 4 MB 미만 · 차단 2.5 MB 미만/);
    assert.strictEqual(memoryBadge(check(5)), undefined);
    assert.match(memoryBadge(c)!.tooltip, /클릭: 상세 보기/);
});

// PR #38 리뷰: 관찰자가 IP 를 버려 제어기 A 의 Free 값이 B 연결 뒤에도 남았다.
test('memoryNotice: 배지는 현재 제어기의 값만 보이고 제어기 변경·연결 해제 시 숨긴다', () => {
    const A = '192.168.0.1', B = '192.168.0.2';
    const badge = { text: '$(warning) Free 2.96 MB', tooltip: 't' };
    const owner = new MemoryBadgeOwner();
    assert.deepStrictEqual(owner.observe(A, A, badge), badge);
    assert.strictEqual(owner.ip, A);
    assert.strictEqual(owner.observe(A, A, undefined), undefined, '같은 제어기의 측정 실패는 표시 유지');
    assert.strictEqual(owner.reconcile(A), undefined, '같은 제어기면 유지');
    // 제어기가 B 로 바뀐 뒤 늦게 도착한 A 의 결과 — 표시하지 않고, 남아 있던 A 의 배지는 숨긴다.
    assert.strictEqual(owner.observe(A, B, badge), null);
    assert.strictEqual(owner.ip, undefined);
    assert.strictEqual(owner.observe(A, B, badge), undefined, '이미 숨겼으면 그대로');
    // B 의 측정 실패는 A 의 값을 살리지 않는다.
    owner.observe(A, A, badge);
    assert.strictEqual(owner.observe(B, B, undefined), null);
    // B 의 경고는 B 의 배지로 보인다.
    assert.deepStrictEqual(owner.observe(B, B, badge), badge);
    assert.strictEqual(owner.ip, B);
    assert.strictEqual(owner.reconcile(A), null, '설정이 A 로 바뀌면 B 의 배지를 숨긴다');
    owner.observe(A, A, badge);
    assert.strictEqual(owner.reconcile(undefined), null, '연결 해제면 숨긴다');
    assert.strictEqual(owner.reconcile(undefined), undefined, '숨긴 뒤에는 할 일 없음');
    assert.strictEqual(owner.observe(A, A, null), null, 'ok 복귀는 숨김');
});
