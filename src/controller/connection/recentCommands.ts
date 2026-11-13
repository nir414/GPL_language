/**
 * 최근 상태 변경 명령 기록(vscode 무의존) — 연결 유실 사후 스냅샷의 "직전에 무엇을 보냈나" 근거.
 *
 * 배경(2026-11-03 사후 스냅샷 30건 재분석): 유실 8건이 `Stop -all`·`Start …`·`Execute …` 를 보낸 뒤 2분 안에 일어났는데,
 * 스냅샷의 "직전 관측" 절은 **응답 없이 끝난 채널 교란 가능 명령**(connectionHealth.DisruptiveOperation)만 다뤄서
 * 이 경우 모두 "(없음 — 교란 가능 명령 직후가 아니었다)"로 찍혔다. 정상 응답(STATUS 0)을 받은 명령도 시간 관계로는
 * 원인 해석에 필요하다 — 이 모듈은 그것을 **관측으로만** 남긴다(인과를 확정하지 않는다).
 *
 * 기록 대상은 읽기 전용이 아닌 명령이다(분류는 호출자가 consoleCommandClassifier 로 한다). 폴링(`Show …`·`ErrorLog`)은
 * 넣지 않는다 — 수천 줄 가운데 몇 줄을 찾는 일이 이 모듈의 존재 이유다.
 */

export interface RecentCommandRecord {
    /** 보낸 명령 원문(`Stop -all`). */
    command: string;
    /** 송신 완료(응답 또는 실패) 시각(epoch ms). */
    at: number;
    /** `status`: `<STATUS>` 를 받음(코드 포함) / `no-status`: 응답은 왔지만 STATUS 없음 / `failed`: 실패(종류). */
    outcome: 'status' | 'no-status' | 'failed';
    statusCode?: number;
    /** outcome='failed' 일 때 실패 종류(`timeout`·`refused` …). */
    failure?: string;
}

export const RECENT_COMMAND_CAPACITY = 30;

/** 유실 의심 시각 이전 이만큼의 명령을 "직전" 으로 본다 — 실측 사례의 최대 간격이 약 2분이라 넉넉히 5분. */
export const PRECEDING_COMMAND_WINDOW_MS = 5 * 60_000;

export class RecentCommandLog {
    private readonly items: RecentCommandRecord[] = [];

    constructor(private readonly capacity = RECENT_COMMAND_CAPACITY) {}

    add(record: RecentCommandRecord): void {
        this.items.push(record);
        if (this.items.length > this.capacity) { this.items.splice(0, this.items.length - this.capacity); }
    }

    list(): readonly RecentCommandRecord[] {
        return this.items.slice();
    }

    clear(): void {
        this.items.length = 0;
    }
}

/** `until` 이전 `windowMs` 안의 기록(오래된 순). `until` 뒤의 것(유실 처리 중 보낸 명령)은 넣지 않는다. */
export function commandsBefore(records: readonly RecentCommandRecord[], until: number, windowMs = PRECEDING_COMMAND_WINDOW_MS): RecentCommandRecord[] {
    return records.filter(r => r.at <= until && r.at >= until - windowMs);
}

/** 한 줄 표기 — `Stop -all → STATUS 0 (13 s 전)`. `ref` 는 기준 시각(유실 의심 시각). */
export function describeRecentCommand(record: RecentCommandRecord, ref: number): string {
    const result = record.outcome === 'status' ? `STATUS ${record.statusCode ?? '?'}`
        : record.outcome === 'no-status' ? 'STATUS 없음'
            : `실패(${record.failure ?? 'unknown'})`;
    const ago = Math.max(0, Math.round((ref - record.at) / 1000));
    return `${record.command} → ${result} (${ago} s 전)`;
}
