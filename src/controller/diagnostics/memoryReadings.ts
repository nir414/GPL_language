/**
 * 제어기 여유 메모리 측정값의 정본(SSOT) — vscode·소켓 무의존 (2026-11-03 「메모리 가져오는 게 2개」 검토).
 *
 * 배경: `Show Memory` 를 보내는 곳(메모리 검사·트리 시스템 정보·대시보드·AI 상태 조회)이 저마다 응답을 따로 들고
 * 따로 해석했다. 트리는 자체 정규식으로 5분 억제된 옛 값을, 상태 표시줄은 마지막 Compile·Start 검사 값을 보여 줘
 * 같은 제어기의 여유 메모리가 두 화면에서 다르게 보였다. 사람 경로의 Start·Compile 은 「심각이면 묻기」 검사 직후
 * 큐 슬롯 검사가 같은 값을 한 번 더 쟀다(Start 1회당 `Show Memory` 2회 — 그 사이에 바뀐 것이 없다).
 *
 * 이 모듈은 측정값 하나를 정본으로 둔다:
 *  - **기록은 전송 경로 한 곳**(controllerConnection 의 내부 송신)이 한다 — 누가 보냈든 `Show Memory` 응답은 여기 쌓인다.
 *  - **해석은 parseShowMemory 하나** — 화면마다 다시 해석하지 않는다.
 *  - **재사용 규칙** — 측정 뒤 상태 변경(상태 변경 명령 송신·FTP 쓰기)이 없고 `maxAgeMs` 안이면 다시 재지 않는다.
 *    상태 변경 뒤의 재측정(Stop 뒤·Compile 뒤·업로드 뒤)은 값이 실제로 달라지므로 그대로 둔다.
 */
import { MemoryInfo, parseShowMemory } from './resourceProbes';
import { parseStatus } from '../protocol/responseParser';

/** 검사가 같은 측정을 다시 쓰는 최대 경과 시간. 모달 확인·런타임 콘솔 준비 정도의 간격을 덮는다. */
export const MEMORY_READING_REUSE_MS = 15_000;

export interface MemoryReading {
    ip: string;
    /** 응답을 받은 시각(ms epoch). */
    at: number;
    info: MemoryInfo;
    /** 원문 응답(`<STATUS>` 포함) — 판정(assessMemory)·툴팁이 쓴다. */
    raw: string;
    /** 보낸 명령 원문(`Show Memory` / `Show Memory -all`). */
    command: string;
}

export interface MemoryStateChange {
    at: number;
    /** 무엇이 바꿨는가(명령 원문 또는 `FTP …`). 로그·진단용. */
    reason: string;
}

/** 보낸 명령이 메모리 측정인가(`Show Memory`, `Show Memory -all`). 공백·대소문자 무관. */
export function isMemoryProbeCommand(command: string): boolean {
    return /^\s*show\s+memory\b/i.test(command);
}

/** 재사용 가능 여부 판정(순수). 측정이 없거나, 상태 변경 뒤의 것이 아니거나, 오래됐으면 재사용하지 않는다. */
export function isReadingReusable(
    reading: MemoryReading | undefined,
    lastChange: MemoryStateChange | undefined,
    now: number,
    maxAgeMs: number = MEMORY_READING_REUSE_MS,
): reading is MemoryReading {
    if (!reading || !(maxAgeMs > 0)) { return false; }
    const age = now - reading.at;
    if (age < 0 || age > maxAgeMs) { return false; }
    // 같은 ms 의 변경도 측정 뒤로 친다 — 순서를 모르면 재측정이 안전하다.
    return !lastChange || lastChange.at < reading.at;
}

export type MemoryReadingListener = (reading: MemoryReading) => void;

/** 제어기별(IP) 최신 측정값과 마지막 상태 변경 시각. */
export class MemoryReadingStore {
    private readonly readings = new Map<string, MemoryReading>();
    private readonly changes = new Map<string, MemoryStateChange>();
    private readonly listeners = new Set<MemoryReadingListener>();

    /**
     * 응답 하나를 기록한다. `<STATUS>0` 으로 끝나고 Free 를 읽을 수 있을 때만 기록하고 구독자에게 알린다
     * (잘린 응답·거부 응답은 측정이 아니다). 기록했으면 그 측정을, 아니면 null 을 돌려준다.
     */
    record(ip: string, raw: string, at: number, command = 'Show Memory'): MemoryReading | null {
        if (!/<\/STATUS>/i.test(raw) || parseStatus(raw).code !== 0) { return null; }
        const info = parseShowMemory(raw);
        if (!info || info.freeMb === null || !Number.isFinite(info.freeMb)) { return null; }
        const reading: MemoryReading = { ip, at, info, raw, command };
        this.readings.set(ip, reading);
        for (const fn of [...this.listeners]) {
            try { fn(reading); } catch { /* 구독자 예외는 무시 */ }
        }
        return reading;
    }

    latest(ip: string): MemoryReading | undefined {
        return this.readings.get(ip);
    }

    /** 메모리를 바꿀 수 있는 일(상태 변경 명령·FTP 쓰기)이 일어났다 — 그 전 측정은 더 이상 재사용하지 않는다. */
    noteChange(ip: string, at: number, reason: string): void {
        const prev = this.changes.get(ip);
        if (!prev || prev.at <= at) { this.changes.set(ip, { at, reason }); }
    }

    lastChange(ip: string): MemoryStateChange | undefined {
        return this.changes.get(ip);
    }

    /** 다시 재지 않고 써도 되는 측정(없으면 undefined). */
    reusable(ip: string, now: number, maxAgeMs: number = MEMORY_READING_REUSE_MS): MemoryReading | undefined {
        const reading = this.readings.get(ip);
        return isReadingReusable(reading, this.changes.get(ip), now, maxAgeMs) ? reading : undefined;
    }

    onDidRecord(fn: MemoryReadingListener): { dispose(): void } {
        this.listeners.add(fn);
        return { dispose: () => { this.listeners.delete(fn); } };
    }

    /** 연결 해제·제어기 변경 때 그 제어기의 값을 지운다(인자 없으면 전부). */
    clear(ip?: string): void {
        if (ip === undefined) { this.readings.clear(); this.changes.clear(); return; }
        this.readings.delete(ip);
        this.changes.delete(ip);
    }
}

/** 확장 전체가 공유하는 저장소 — 전송 경로가 쓰고, 검사·트리·상태 표시줄이 읽는다. */
export const controllerMemoryReadings = new MemoryReadingStore();

/** 트리·상태 표시줄 공용 값 표기: `Free: 0.9653 MB`. */
export function formatMemoryReadingValue(reading: MemoryReading): string {
    return `Free: ${reading.info.freeMb} MB`;
}
