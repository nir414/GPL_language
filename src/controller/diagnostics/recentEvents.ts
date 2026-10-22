/**
 * 제어기 사건 링버퍼 — 「오류 상세 보기」가 보여 주는 "직전 제어기 사건". vscode 무의존 순수 모듈.
 *
 * 종전에는 `host.log` 가 **모든** 줄을 `[main] ` 을 붙여 버퍼에 넣었고, 「오류 상세 보기」가 자기 보고서를
 * 그 `host.log` 로 출력했다. 보고서가 자기 출력을 다시 먹으면서
 *   ① 보고서 안의 `- [main] …` 줄에 `[main] ` 이 한 겹 더 붙어 누를 때마다 `[main] - [main] - …` 로 깊어지고
 *   ② 보고서(약 25줄)가 창(10줄)보다 길어 "직전 로그"는 **늘 직전 보고서 찌꺼기**만 보였다 (§1-EA).
 * 그래서 보고서는 버퍼를 거치지 않는 `host.report` 로 내보내고, 버퍼에는 제어기 사건만 담는다.
 *
 * 판정은 **deny-list** 다 — 새 제어기 태그가 생기면 자동으로 들어오고, 확장 내부 수다만 빠진다.
 * allow-list 로 두면 태그가 하나 늘 때마다 여기도 고쳐야 하고, 빠뜨리면 조용히 빈 섹션이 된다.
 */

/** 한 사건. 같은 문구가 연달아 오면 새 항목을 만들지 않고 `count` 를 올린다(폭주 로그 접기). */
export interface ControllerEvent {
    /** 마지막으로 관측된 시각(ms). 접힌 항목은 가장 나중 시각을 쓴다. */
    at: number;
    text: string;
    count: number;
}

/**
 * 확장 내부 관심사라 제어기 사건이 아닌 로그 태그. 심볼 인덱싱·워크스페이스 해석·브리지 살림살이는
 * 런타임 에러의 앞뒤 맥락이 되지 못하면서 창(10줄)을 통째로 밀어낸다.
 */
const INTERNAL_TAGS = new Set([
    'symbolcache',
    'projectcontext',
    'bridge',
    'ai setup',
    'trace',
    'watcher',
]);

/** 배포 트레이스의 장식 줄(박스/구분선)을 가르는 선행 문자. 내용이 아니라 모양이라 사건이 아니다. */
const BOX_DRAWING = /^[\s\u2500-\u257F]*$|^\s*[\u2500-\u257F]/u;

/** 선행 `[Tag]` 를 뽑는다(없으면 undefined). */
function leadingTag(line: string): string | undefined {
    const m = /^\s*\[([^\]]{1,32})\]/.exec(line);
    return m ? m[1].trim().toLowerCase() : undefined;
}

/**
 * 확장 로그 한 줄이 "제어기에서 일어난 일"인가. 빈 줄·장식 줄·확장 내부 태그는 제외하고 나머지는 통과.
 * 태그가 없는 줄(배포 요약 문장 등)도 통과시킨다 — 제어기 작업의 결과를 말하는 줄이 대부분이다.
 */
export function isControllerEvent(line: string): boolean {
    if (!line.trim()) { return false; }
    if (BOX_DRAWING.test(line)) { return false; }
    const tag = leadingTag(line);
    return !(tag && INTERNAL_TAGS.has(tag));
}

/** 링버퍼 보관 상한 — 초과 시 오래된 것부터 버린다. */
const DEFAULT_MAX = 240;

export class ControllerEventLog {
    private readonly _items: ControllerEvent[] = [];

    constructor(private readonly max: number = DEFAULT_MAX) {}

    /**
     * 사건 한 건 기록. 제어기 사건이 아니면 조용히 버린다(호출부가 판정을 한 번 더 하지 않게).
     * 직전과 같은 문구면 접어서 `count` 만 올린다 — 재시도·폭주 로그가 창을 다 먹지 않게.
     */
    record(line: string, now: number = Date.now()): void {
        if (!isControllerEvent(line)) { return; }
        const text = line.trim();
        const last = this._items[this._items.length - 1];
        if (last && last.text === text) {
            last.count++;
            last.at = now;
            return;
        }
        this._items.push({ at: now, text, count: 1 });
        if (this._items.length > this.max) {
            this._items.splice(0, this._items.length - this.max);
        }
    }

    /** 최근 N건(오래된 → 최근 순). */
    recent(limit: number): ControllerEvent[] {
        return limit <= 0 ? [] : this._items.slice(-limit);
    }

    get size(): number {
        return this._items.length;
    }
}

/** 표시용 한 줄 — `HH:mm:ss  문구` (접힌 항목은 뒤에 `(×N)`). `formatTime` 은 테스트용 주입. */
export function formatControllerEvent(ev: ControllerEvent, formatTime: (ms: number) => string = defaultClock): string {
    const repeat = ev.count > 1 ? ` (×${ev.count})` : '';
    return `${formatTime(ev.at)}  ${ev.text}${repeat}`;
}

function defaultClock(ms: number): string {
    const d = new Date(ms);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
