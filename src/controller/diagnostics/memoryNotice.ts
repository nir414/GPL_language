/**
 * 여유 메모리 경고의 **사람 화면 알림** 규칙 — vscode 무의존 순수 모듈.
 *
 * 배경(2026-10-23 Sample Prep 보고 「여유 메모리 경고 알림이 Compile · Start · 배포마다 새로 쌓임」):
 *  - `checkMemoryBeforeOperation` 이 경고 구간이면 조건 없이 `showWarningMessage` 를 불렀다. 한 번의 Upload & Start 에서도
 *    배포 업로드 전 검사 + `Start -compile` 큐 슬롯 검사로 두 번 떴고, AI 경로의 Compile/Start 도 사람 화면에 알림을 쌓았다.
 *  - 같은 원칙의 선례: 이미 본 ErrorLog 항목은 다시 알리지 않는다(done/2026-10-21 deploy-errorlog-repeat-warning).
 *
 * 규칙(제어기 IP 별 상태):
 *  - 알림은 **나빠질 때만** — 직전 수준이 없음/ok 에서 warning 이 되면 한 번. 같은 warning 이 이어지면 Output 한 줄만.
 *  - 다만 직전 알림 대비 여유 메모리가 `dropMb`(기본 0.5 MB) 이상 더 떨어지면 다시 알린다.
 *  - ok 로 돌아오면 기억을 지운다(다음 경고는 다시 "나빠짐" 이다).
 *  - blocked·unknown 은 이 모듈이 알림을 정하지 않는다 — 종전처럼 작업을 막고 결과(모달·오류)로 보고된다. 수준 기억만 갱신한다.
 *  - 한 작업(scope) 안에서는 알림 최대 1회 — 배포의 업로드 전 검사와 이어지는 Start 큐 검사가 둘 다 띄우지 않게.
 *  - AI 결과 필드(`memoryPrecheck`·`precheckWarnings`)는 이 모듈과 무관하게 매번 남는다 — 줄이는 것은 사람 화면의 알림뿐이다.
 *
 * 지속 상태는 상태 표시줄 한 칸(`$(warning) Free 2.96 MB`)이 맡는다 — 알림 창은 쌓이고 상태 표시줄은 한 칸이다.
 */

import type { MemoryPrecheck } from './memoryGuard';

export type MemoryLevel = MemoryPrecheck['level'];

/** 직전 알림 대비 이만큼(MB) 더 떨어지면 같은 수준이어도 다시 알린다. */
export const MEMORY_TOAST_DROP_MB = 0.5;

export type MemoryNoticeReason =
    /** 없음/ok → warning, 또는 warning → blocked 처럼 나빠짐. */
    | 'worsened'
    /** 같은 warning 이지만 직전 알림 대비 dropMb 이상 감소. */
    | 'dropped'
    /** 같은 수준 반복 — Output 한 줄만. */
    | 'repeat'
    /** 나아짐(blocked → warning 등) — 알림 없음. */
    | 'improved'
    /** 이번 작업 안에서 이미 알렸음. */
    | 'same-operation'
    /** ok — 기억 초기화. */
    | 'ok-reset'
    /** blocked/unknown — 알림은 작업 결과(오류·모달)가 맡는다. */
    | 'handled-elsewhere';

export interface MemoryNoticeDecision {
    /** 사람 화면에 경고 알림(toast)을 띄울지. */
    toast: boolean;
    reason: MemoryNoticeReason;
    /** 상태 표시줄 항목 — null 이면 숨기고, 필드가 없으면(측정 실패) 지금 표시를 그대로 둔다. */
    badge?: { text: string; tooltip: string } | null;
}

interface IpState {
    level: MemoryLevel;
    /** 마지막 알림 때의 여유 메모리(MB). */
    lastToastFreeMb?: number;
}

const SEVERITY: Readonly<Record<'ok' | 'warning' | 'blocked', number>> = { ok: 0, warning: 1, blocked: 2 };

function fmtMb(mb: number | null): string {
    return mb === null || !Number.isFinite(mb) ? '?' : (Math.round(mb * 100) / 100).toFixed(2);
}

/** 알림 본문(짧게) — `여유 메모리 2.96 MB — 경고 구간(4 MB 미만)`. 긴 안내는 상세·Output 쪽(formatMemoryDetail). */
export function formatMemoryToast(check: MemoryPrecheck): string {
    if (check.level === 'warning') { return `여유 메모리 ${fmtMb(check.freeMb)} MB — 경고 구간(${check.warnMb} MB 미만)`; }
    if (check.level === 'blocked') { return `여유 메모리 ${fmtMb(check.freeMb)} MB — 차단 구간(${check.blockMb} MB 미만)`; }
    if (check.level === 'unknown') { return '여유 메모리를 확인하지 못했습니다'; }
    return `여유 메모리 ${fmtMb(check.freeMb)} MB`;
}

/** 상세(상태 표시줄 클릭·Output) — 임계값과 판단 안내. 삭제·Unload 는 자동으로 하지 않는다는 점과 Unload 위험을 여기에 둔다. */
export function formatMemoryDetail(check: MemoryPrecheck): string {
    const lines = [
        `여유 메모리: ${fmtMb(check.freeMb)} MB (수준: ${check.level})`,
        `기준: 경고 ${check.warnMb} MB 미만 · 차단 ${check.blockMb} MB 미만 (설정 gpl.controller.memoryGuard.warnMb / blockMb)`,
    ];
    if (check.level !== 'ok') {
        lines.push(
            '/GPL 잔존 파일과 로드된 프로젝트를 확인하세요(제어기 트리의 /GPL 목록).',
            '삭제·Unload 는 자동으로 하지 않습니다 — 별도 판단이 필요합니다. Unload 뒤에는 수 분간 명령 콘솔이 응답하지 않을 수 있습니다.',
            '공간이 필요하면 /GPL 비우기 → 앱 Unload 순서를 권합니다(그룹 라이브러리는 Compile 직후 Unload 하지 않음).',
        );
    }
    return lines.join('\n');
}

/** 상태 표시줄 항목 — 경고·차단 구간에서만. */
export function memoryBadge(check: MemoryPrecheck): { text: string; tooltip: string } | undefined {
    if (check.level !== 'warning' && check.level !== 'blocked') { return undefined; }
    return {
        text: `$(warning) Free ${fmtMb(check.freeMb)} MB`,
        tooltip: `${formatMemoryDetail(check)}\n\n클릭: 상세 보기`,
    };
}

/**
 * 제어기 IP 별 마지막 수준을 기억해 알림 여부를 정한다. 상태는 메모리에만 있다(세션 한정).
 */
export class MemoryNoticeTracker {
    private readonly byIp = new Map<string, IpState>();
    /** 작업 범위(scope) — 그 안에서 이미 알렸는지. 키 = IP. */
    private readonly scopes = new Map<string, { depth: number; toasted: boolean }>();

    constructor(private readonly dropMb: number = MEMORY_TOAST_DROP_MB) {}

    /** 한 작업(배포 등)의 시작 — 끝날 때 endScope. 중첩되면 바깥 범위를 따른다. */
    beginScope(ip: string): void {
        const s = this.scopes.get(ip);
        if (s) { s.depth++; } else { this.scopes.set(ip, { depth: 1, toasted: false }); }
    }

    endScope(ip: string): void {
        const s = this.scopes.get(ip);
        if (!s) { return; }
        if (--s.depth <= 0) { this.scopes.delete(ip); }
    }

    /** 검사 결과 한 건을 반영하고 알림 여부를 돌려준다. */
    evaluate(ip: string, check: MemoryPrecheck): MemoryNoticeDecision {
        const prev = this.byIp.get(ip);
        const badge = memoryBadge(check) ?? null;

        if (check.level === 'unknown') {
            // 측정 실패는 수준을 바꾸지 않는다(모르는 것을 좋아졌다고도 나빠졌다고도 보지 않는다). 배지는 그대로 둔다.
            return { toast: false, reason: 'handled-elsewhere' };
        }
        if (check.level === 'ok') {
            this.byIp.delete(ip);
            return { toast: false, reason: 'ok-reset', badge: null };
        }
        if (check.level === 'blocked') {
            // 차단 자체(전송 거부·오류 결과)는 종전대로 호출부가 한다. 여기서는 "나빠짐" 알림만 정한다 —
            // AI 경로의 차단은 사람 화면에 아무것도 남기지 않으므로 warning → blocked 전이는 한 번 알린다.
            const worsened = !prev || prev.level !== 'blocked';
            const decision = this.applyScope(ip, worsened ? 'worsened' : 'repeat');
            this.byIp.set(ip, { level: 'blocked', lastToastFreeMb: decision.toast && check.freeMb !== null ? check.freeMb : prev?.lastToastFreeMb });
            return { ...decision, badge };
        }

        // warning
        const prevSeverity = prev && prev.level !== 'unknown' ? SEVERITY[prev.level] : 0;
        let reason: MemoryNoticeReason;
        if (prevSeverity < SEVERITY.warning) {
            reason = 'worsened';
        } else if (prevSeverity > SEVERITY.warning) {
            reason = 'improved';
        } else if (check.freeMb !== null && prev?.lastToastFreeMb !== undefined && prev.lastToastFreeMb - check.freeMb >= this.dropMb - 1e-9) {
            reason = 'dropped';
        } else {
            reason = 'repeat';
        }
        const decision = this.applyScope(ip, reason);
        this.byIp.set(ip, {
            level: 'warning',
            lastToastFreeMb: decision.toast && check.freeMb !== null ? check.freeMb : prev?.lastToastFreeMb,
        });
        return { ...decision, badge };
    }

    /** 알릴 사유면 작업 범위의 "한 번만" 규칙을 적용한다. */
    private applyScope(ip: string, reason: MemoryNoticeReason): { toast: boolean; reason: MemoryNoticeReason } {
        const wants = reason === 'worsened' || reason === 'dropped';
        if (!wants) { return { toast: false, reason }; }
        const scope = this.scopes.get(ip);
        if (scope?.toasted) { return { toast: false, reason: 'same-operation' }; }
        if (scope) { scope.toasted = true; }
        return { toast: true, reason };
    }

    /** 진단용 — 이 IP 의 기억된 수준. */
    levelOf(ip: string): MemoryLevel | undefined {
        return this.byIp.get(ip)?.level;
    }
}
