/**
 * 제어기 자원 지표 프로브 — `Show Memory` / `Show Network -tcp` / `Show Network -mbuf` 응답 파서
 * (GitHub #22 제안 8: 사망 가설 1 "TCP 자원 고갈" 검증 수단).
 *
 * 배경: G2400C(16 MB)가 평상시 10~25 connections/s 를 accept 하고 있었고, 사망 직전 추세를
 * 남기려면 세 읽기 전용 명령을 주기적으로 기록해야 한다. 대시보드 폴링에 얹어 시간 흐름 자료가
 * 자동으로 쌓이도록 한다.
 *
 * 설계 메모:
 *   - **실기기 원문 형식은 미확정**(2026-08-26). 아래 파서는 사용자 요약 형식과 Brooks 문서상
 *     `Show Memory` 예시, 그리고 VxWorks 계열 `tcpstatShow`/`netStackDataPoolShow` 형식을 모두
 *     관대하게 받도록 했다(대소문자 무시, 키워드↔숫자 사이 구두점 허용, 항목 순서 무관).
 *     실패하면 null 을 돌려 UI 가 "형식 미확정" 으로 표시하고 raw 를 툴팁으로 보여 준다.
 *   - 키워드와 숫자는 **같은 줄**에서만 짝지운다. 줄을 넘어 짝지우면 VxWorks 형식의
 *     "N connection accepts\n M connections established" 에서 accepts 가 M 을 집는 오류가 난다.
 *   - vscode 무의존(순수 로직) — 테스트: src/test/resourceProbes.test.ts
 *
 * 문서상(Brooks Console Commands > Show Memory): 크기는 MB(2^20), "Segments" 는 단편화로 나뉜
 * 블록 수, `-all` 이면 File Descriptors Free/Used 도 보이며 Free 가 5 이하로 떨어지면 다음 I/O 에서
 * 시스템이 멈출 수 있다고 한다(가설 1 과 직접 관련 — 실기기 검증 항목).
 */

import { parseStatus, NO_STATUS_CODE } from './responseParser';

// ── 프로브 명령 (모두 읽기 전용 — consoleCommandClassifier 의 read-only 목록 'show') ─────
export const PROBE_MEMORY_CMD = 'Show Memory';
export const PROBE_NET_TCP_CMD = 'Show Network -tcp';
export const PROBE_NET_MBUF_CMD = 'Show Network -mbuf';

/** 툴팁/원문 보기용으로 보관하는 raw 응답의 최대 길이(문자). */
export const RAW_KEEP_MAX_CHARS = 4000;

export interface MemoryInfo {
    /** Main Memory Free (MB). */
    freeMb: number | null;
    /** Main Memory Used (MB). */
    usedMb: number | null;
    /**
     * 단편화 지표 Segments. 문서상 Free/Used 각각에 Segments 가 있어 **Used 쪽**(할당 블록 수)을
     * 채택하고, 값이 하나뿐인 형식(사용자 요약 "Segments 49939")이면 그 값을 쓴다.
     */
    segments: number | null;
    /** Free 영역 Segments (형식에 있을 때만). */
    freeSegments: number | null;
    /** File Descriptors Free — 문서상 `Show Memory -all` 응답에만 있음. */
    fileDescriptorsFree: number | null;
    /** File Descriptors Used — 문서상 `Show Memory -all` 응답에만 있음. */
    fileDescriptorsUsed: number | null;
}

export interface TcpInfo {
    /** 누적 accept 수(connections accepted / connection accepts). */
    accepted: number | null;
    /** 누적 established 수. */
    established: number | null;
    /** 누적 closed 수. */
    closed: number | null;
}

export interface MbufInfo {
    /** mbuf 총 개수. */
    total: number | null;
    /** free mbuf 개수. */
    free: number | null;
    /** cluster 총 개수(표 형식이면 모든 크기 합). */
    clusters: number | null;
    /** free cluster 개수(표 형식이면 모든 크기 합). 단조 감소하면 churn 이 자원을 소모하는 신호. */
    clustersFree: number | null;
    /** 공간 확보 실패 횟수(drops / "failed to find space"). */
    drops: number | null;
    /** 공간 대기 횟수(waits / "waited for space"). */
    waits: number | null;
    /** 프로토콜 drain 횟수(drains / "drained protocols for space"). */
    drains: number | null;
}

export interface ResourceSnapshot {
    memory: MemoryInfo | null;
    tcp: TcpInfo | null;
    mbuf: MbufInfo | null;
    /** 원문(STATUS 포함, RAW_KEEP_MAX_CHARS 로 절단). 파싱 실패 시 UI 툴팁/원문 보기용. */
    raw: { memory?: string; tcp?: string; mbuf?: string };
    /** 각 명령의 STATUS 코드. undefined = 응답 없음(트랜스포트 실패), NO_STATUS_CODE = STATUS 누락. */
    status: { memory?: number; tcp?: number; mbuf?: number };
    /** 샘플 시각(ms epoch). */
    sampledAt: number;
}

export interface ResourceRates {
    /** 초당 accept 증가율. null = 계산 불가(샘플 없음/카운터 리셋). */
    acceptedPerSec: number | null;
    /** 초당 closed 증가율. */
    closedPerSec: number | null;
    /** 두 샘플 사이 경과 ms. */
    elapsedMs: number;
    /** 누적 카운터가 줄었음(재부팅/랩어라운드 의심). 이때 per-sec 값은 null. */
    counterReset: boolean;
}

// ── 공통 헬퍼 ─────────────────────────────────────────────────────

/** <DATA>...</DATA> 본문을 추출. 없으면 STATUS 태그만 제거한 원문 반환. */
export function extractDataPayload(raw: string): string {
    const m = raw.match(/<DATA>([\s\S]*?)<\/DATA>/i);
    if (m) {
        return m[1];
    }
    return raw.replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '');
}

/** 패턴 목록을 순서대로 시도해 첫 캡처 그룹의 숫자를 돌려준다. 하나도 안 맞으면 null. */
function pickNumber(text: string, patterns: RegExp[]): number | null {
    for (const re of patterns) {
        const m = re.exec(text);
        if (m && m[1] !== undefined) {
            const n = Number(m[1]);
            if (Number.isFinite(n)) {
                return n;
            }
        }
    }
    return null;
}

/** 키워드 뒤 같은 줄에서 구두점(:, =, 쉼표, 괄호 등)을 건너뛰고 숫자를 잡는 패턴. */
function after(keyword: string, decimal = false): RegExp {
    return new RegExp(`\\b(?:${keyword})\\b[^\\w\\r\\n]{0,8}(${decimal ? '\\d+(?:\\.\\d+)?' : '\\d+'})`, 'i');
}

/**
 * 숫자 뒤 공백만 두고 키워드가 오는 패턴("10 connection accepts" 류의 최종 폴백).
 * 구두점은 허용하지 않는다 — "accepted 7, established" 에서 established 가 7 을 집는 오류 방지.
 */
function before(keyword: string): RegExp {
    // [ \t]+ : 같은 줄 안에서만. \s+ 를 쓰면 CR/LF 를 넘어 앞 줄 끝의 숫자를 집는다
    // (실기기 `Show Network -tcp` 표: "connections accepted 13213\r\n connections established 13212" 에서
    //  established 가 13213 을 잡던 오류 — 2026-08-26 실기기 원문 픽스처로 확인).
    return new RegExp(`(\\d+)[ \\t]+(?:${keyword})\\b`, 'i');
}

/**
 * "<라벨> (주석)   <숫자>" 형식 — BSD netstat -s 표(실기기 `Show Network -tcp`)처럼 라벨과 숫자 사이에
 * 괄호 주석이 끼는 줄. 라벨 뒤 같은 줄에서 숫자가 아닌 문자를 건너뛰고 첫 숫자를 잡는다.
 */
function labelThenNumber(label: string): RegExp {
    return new RegExp(`\\b(?:${label})\\b[^\\d\\r\\n]*?(\\d+)`, 'i');
}

function allNull(obj: object): boolean {
    return Object.values(obj).every(v => v === null || v === undefined);
}

function toNum(s: string | undefined): number | null {
    if (s === undefined) {
        return null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

// ── Show Memory ───────────────────────────────────────────────────

/**
 * 문서상 형식(구역 헤더 + Free/Used 줄) 과 요약 한 줄 형식을 모두 해석한다.
 *
 *   Main Memory:
 *     Free: 9.2356 Mb, Segments: 14
 *     Used: 2.7490 Mb, Segments: 2166
 *
 *   Free 3.6557 Mb, Used 7.9903 Mb, Segments 49939
 */
export function parseShowMemory(raw: string | null | undefined): MemoryInfo | null {
    if (!raw) {
        return null;
    }
    const text = extractDataPayload(raw);
    const region = sectionOf(text, /main\s+memory/i) ?? text;

    const freeM = after('free', true).exec(region);
    const usedM = after('used', true).exec(region);
    const freeMb = toNum(freeM?.[1]);
    const usedMb = toNum(usedM?.[1]);

    // Segments 는 앵커(Free/Used) 뒤에 오는 것을 그 앵커의 값으로 본다. 하나뿐이면 마지막 앵커 소속.
    let segments: number | null = null;
    let freeSegments: number | null = null;
    const anchors: Array<{ idx: number; kind: 'free' | 'used' }> = [];
    if (freeM) { anchors.push({ idx: freeM.index, kind: 'free' }); }
    if (usedM) { anchors.push({ idx: usedM.index, kind: 'used' }); }
    anchors.sort((a, b) => a.idx - b.idx);
    const segRe = /\bsegments?\b[^\w\r\n]{0,8}(\d+)/gi;
    let sm: RegExpExecArray | null;
    while ((sm = segRe.exec(region)) !== null) {
        const value = toNum(sm[1]);
        let owner: 'free' | 'used' | null = null;
        for (const a of anchors) {
            if (a.idx < sm.index) {
                owner = a.kind;
            }
        }
        if (owner === 'free') {
            freeSegments = value;
        } else {
            // 앵커가 없거나 Used 뒤 → 단편화 지표(Used Segments)로 채택
            segments = value;
        }
    }

    // File Descriptors (Show Memory -all) — 구역이 있을 때만
    let fileDescriptorsFree: number | null = null;
    let fileDescriptorsUsed: number | null = null;
    const fdRegion = sectionOf(text, /file\s+descriptors?/i);
    if (fdRegion) {
        fileDescriptorsFree = pickNumber(fdRegion, [after('free')]);
        fileDescriptorsUsed = pickNumber(fdRegion, [after('used')]);
    }

    const info: MemoryInfo = { freeMb, usedMb, segments, freeSegments, fileDescriptorsFree, fileDescriptorsUsed };
    return allNull(info) ? null : info;
}

/**
 * `헤더:` 줄로 시작하는 구역(다음 헤더 줄 전까지)을 잘라 낸다. 헤더가 없으면 null.
 * 헤더 판정: 줄 전체가 `단어들:` 형태(값 없음). "Free: 9.2 Mb" 같은 키:값 줄은 헤더가 아님.
 */
function sectionOf(text: string, header: RegExp): string | null {
    const lines = text.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (header.test(lines[i])) {
            start = i;
            break;
        }
    }
    if (start < 0) {
        return null;
    }
    const headerLine = /^\s*[A-Za-z][A-Za-z0-9 /_-]*:\s*$/;
    const out: string[] = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
        if (headerLine.test(lines[i])) {
            break;
        }
        out.push(lines[i]);
    }
    // 헤더 줄 자체에 값이 이어지는 한 줄 형식("Main Memory: Free 1.2 Mb ...")도 포함되도록 헤더 줄을 남긴다.
    return out.join('\n');
}

// ── Show Network -tcp ─────────────────────────────────────────────

/**
 * 사용자 요약 형식 "connections accepted 10, established 10, closed 19" 와
 * VxWorks tcpstatShow 형식 "10 connection accepts / 10 connections established (including accepts) /
 * 19 connections closed (including 0 drops)" 를 모두 해석한다. 항목 순서·대소문자 무관.
 */
export function parseShowNetworkTcp(raw: string | null | undefined): TcpInfo | null {
    if (!raw) {
        return null;
    }
    const text = extractDataPayload(raw);
    const accept = 'accepts?|accepted';
    // 실기기(G2400C, GPL 4.2K5) 원문은 BSD `netstat -s` 표 형식이다(2026-08-25 채록):
    //   "               connections accepted       13213"
    //   "            connections established       13212"
    //   "      conn. closed (includes drops)       13836"
    // 라벨→숫자 패턴(labelThenNumber)을 먼저 두고, 요약/변형 표기는 그 뒤 폴백으로 둔다. 모든 패턴은 같은 줄 안에서만 매칭.
    const info: TcpInfo = {
        // 순서: ① 숫자-앞("19 connections closed (including 3 drops)" — 괄호 안 숫자를 집지 않도록 먼저)
        //       ② 라벨-뒤(실기기 BSD 표 "conn. closed (includes drops)   13836") ③ 요약/변형 폴백.
        accepted: pickNumber(text, [
            new RegExp(`(\\d+)[ \\t]+connections?[ \\t]+(?:${accept})\\b`, 'i'),
            new RegExp(`\\bconnections?[ \\t]+(?:${accept})\\b[^\\d\\r\\n]*?(\\d+)`, 'i'),
            after(accept),
            before(accept),
        ]),
        established: pickNumber(text, [
            /(\d+)[ \t]+connections?[ \t]+established\b/i,
            labelThenNumber('connections?[ \\t]+established'),
            after('established'),
            before('established'),
        ]),
        closed: pickNumber(text, [
            /(\d+)[ \t]+connections?[ \t]+closed\b/i,
            labelThenNumber('conn(?:ections?|\\.)?[ \\t]+closed'),
            after('closed'),
            before('closed'),
        ]),
    };
    return allNull(info) ? null : info;
}

// ── Show Network -mbuf ────────────────────────────────────────────

/**
 * 사용자 요약 형식 "mbufs 3072 (free 2778, data 292, header 2) clusters 512, free 223 / drops 0, waits 0, drains 0"
 * 와 VxWorks netStackDataPoolShow 형식(type/number 표 + CLUSTER POOL TABLE + "number of times ..." 줄)을
 * 모두 해석한다. cluster 표가 여러 크기로 나뉘어 있으면 clusters/free 를 합산한다.
 */
export function parseShowNetworkMbuf(raw: string | null | undefined): MbufInfo | null {
    if (!raw) {
        return null;
    }
    const text = extractDataPayload(raw);

    // "cluster" 키워드 첫 등장 지점에서 mbuf 부분과 cluster 부분을 나눈다(둘 다 "free" 를 쓰므로).
    const clusterIdx = text.search(/\bclusters?\b/i);
    const head = clusterIdx >= 0 ? text.slice(0, clusterIdx) : text;
    const tail = clusterIdx >= 0 ? text.slice(clusterIdx) : '';

    const total = pickNumber(text, [
        after('number\\s+of\\s+mbufs?'),
        after('mbufs?'),
        /(\d+)[ \t]+mbufs?\b/i,
        after('total'),
    ]);
    // mbuf free: 실기기 원문(2026-08-25 채록)은
    //   "mbufs:3072    clusters: 512    free: 223"      ← 이 줄의 free 는 clusters free
    //   "drops:   0       waits:   0  drains:   0"
    //   "      free:2725          data:292         header:55 ..." ← 이 줄의 free 가 mbuf free(타입별 표의 첫 항목)
    // 이므로 "free 뒤 같은 줄에 data 타입이 이어지는" 줄을 mbuf free 로 우선 잡고, 없으면 cluster 앞 구간의 free(요약 형식).
    const free = pickNumber(text, [
        /\bfree\b[^\w\r\n]{0,8}(\d+)[^\r\n]*\bdata\b/i,
    ]) ?? pickNumber(head, [after('free')]);

    let clusters: number | null = null;
    let clustersFree: number | null = null;
    // clusters 키워드가 있는 줄에서 clusters/free 를 먼저 읽는다(실기기 형식·요약 형식 공통).
    const clusterLine = text.split(/\r?\n/).find(l => /\bclusters?\b/i.test(l));
    if (clusterLine) {
        const fromClusters = clusterLine.slice(clusterLine.search(/\bclusters?\b/i));
        clusters = pickNumber(fromClusters, [after('clusters?')]);
        clustersFree = pickNumber(fromClusters, [after('free')]);
    }
    if (tail && (clusters === null || clustersFree === null)) {
        const table = parseClusterTable(tail);
        if (table) {
            clusters = table.clusters;
            clustersFree = table.free;
        } else {
            clusters = pickNumber(tail, [after('clusters?')]);
            clustersFree = pickNumber(tail, [after('free')]);
        }
    }

    const drops = pickNumber(text, [
        after('drops?'),
        before('drops?'),
        after('failed\\s+to\\s+find\\s+space'),
        /(\d+)\s+times?\s+failed\s+to\s+find\s+space/i,
    ]);
    const waits = pickNumber(text, [
        after('waits?'),
        before('waits?'),
        after('waited\\s+for\\s+space'),
        /(\d+)\s+times?\s+waited\s+for\s+space/i,
    ]);
    const drains = pickNumber(text, [
        after('drains?'),
        before('drains?'),
        after('drained\\s+protocols?(?:\\s+for\\s+space)?'),
        /(\d+)\s+times?\s+drained\s+protocols?/i,
    ]);

    const info: MbufInfo = { total, free, clusters, clustersFree, drops, waits, drains };
    return allNull(info) ? null : info;
}

/**
 * "size  clusters  free  usage" 헤더 뒤 숫자 행들을 합산한다(VxWorks CLUSTER POOL TABLE).
 * 헤더가 없거나 숫자 행이 하나도 없으면 null.
 */
function parseClusterTable(text: string): { clusters: number; free: number } | null {
    const lines = text.split(/\r?\n/);
    let headerAt = -1;
    let clusterCol = -1;
    let freeCol = -1;
    for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].trim().split(/\s+/);
        const ci = cols.findIndex(c => /^clusters?$/i.test(c));
        const fi = cols.findIndex(c => /^free$/i.test(c));
        if (ci >= 0 && fi >= 0 && cols.length >= 3) {
            headerAt = i;
            clusterCol = ci;
            freeCol = fi;
            break;
        }
    }
    if (headerAt < 0) {
        return null;
    }
    let clusters = 0;
    let free = 0;
    let rows = 0;
    for (let i = headerAt + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || /^[-_=]+$/.test(line)) {
            continue; // 구분선/빈 줄
        }
        const cols = line.split(/\s+/);
        const c = toNum(cols[clusterCol]);
        const f = toNum(cols[freeCol]);
        if (c === null || f === null || !/^\d/.test(cols[0])) {
            if (rows > 0) {
                break; // 표 끝
            }
            continue;
        }
        clusters += c;
        free += f;
        rows++;
    }
    return rows > 0 ? { clusters, free } : null;
}

// ── 스냅샷 조립 / 증가율 ──────────────────────────────────────────

export interface ProbeResponses {
    memory?: string | null;
    tcp?: string | null;
    mbuf?: string | null;
}

/**
 * 세 명령의 응답(트랜스포트 실패는 null)을 하나의 스냅샷으로 조립한다.
 * STATUS 가 0 이 아닌 응답(예: 미지원 스위치)은 파싱하지 않고 status 코드와 raw 만 남긴다.
 * STATUS 누락(NO_STATUS_CODE — idle 조기 완료로 잘린 경우)은 부분 데이터라도 파싱한다.
 */
export function buildResourceSnapshot(responses: ProbeResponses, sampledAt: number = Date.now()): ResourceSnapshot {
    const snap: ResourceSnapshot = { memory: null, tcp: null, mbuf: null, raw: {}, status: {}, sampledAt };

    const prep = (key: keyof ProbeResponses): string | null => {
        const resp = responses[key];
        if (resp === null || resp === undefined) {
            return null;
        }
        snap.raw[key] = resp.trim().slice(0, RAW_KEEP_MAX_CHARS);
        const code = parseStatus(resp).code;
        snap.status[key] = code;
        return code === 0 || code === NO_STATUS_CODE ? resp : null;
    };

    snap.memory = parseShowMemory(prep('memory'));
    snap.tcp = parseShowNetworkTcp(prep('tcp'));
    snap.mbuf = parseShowNetworkMbuf(prep('mbuf'));
    return snap;
}

/** 두 스냅샷 사이 TCP 카운터 증가율. 계산 불가(샘플/필드 없음, 경과 0 이하)면 null. */
export function computeRates(
    prev: ResourceSnapshot | null | undefined,
    cur: ResourceSnapshot | null | undefined,
): ResourceRates | null {
    if (!prev || !cur || !prev.tcp || !cur.tcp) {
        return null;
    }
    const elapsedMs = cur.sampledAt - prev.sampledAt;
    if (!(elapsedMs > 0)) {
        return null;
    }
    let counterReset = false;
    const perSec = (a: number | null, b: number | null): number | null => {
        if (a === null || b === null) {
            return null;
        }
        if (b < a) {
            counterReset = true;
            return null;
        }
        return ((b - a) * 1000) / elapsedMs;
    };
    const acceptedPerSec = perSec(prev.tcp.accepted, cur.tcp.accepted);
    const closedPerSec = perSec(prev.tcp.closed, cur.tcp.closed);
    return { acceptedPerSec, closedPerSec, elapsedMs, counterReset };
}

// ── 관측 이력(링) ────────────────────────────────────────────────

export interface ResourceHistoryPoint {
    /** 샘플 시각(ms epoch). */
    t: number;
    acceptedPerSec: number | null;
    clustersFree: number | null;
    freeMb: number | null;
}

export interface ResourceHistoryOptions {
    /** 보관 최대 점 수(링). */
    maxPoints: number;
    /** 점 사이 최소 간격(ms). 빠른 폴링에서도 maxPoints 가 이 시간 × 점 수 이상을 덮도록 한다. */
    minSpacingMs: number;
    /** 증가율 계산 기준 샘플의 최소 나이(ms). 짧은 폴링 주기의 정수 카운터 양자화 잡음을 줄인다. */
    rateWindowMs: number;
}

/** 기본: 120점 × 2.5s = 최소 5분 이력, 증가율은 5초 이상 벌어진 샘플 기준. */
export const DEFAULT_HISTORY_OPTIONS: ResourceHistoryOptions = {
    maxPoints: 120,
    minSpacingMs: 2500,
    rateWindowMs: 5000,
};

/**
 * 대시보드 패널이 폴링마다 record() 를 호출해 증가율과 시계열을 얻는다.
 * (패널 인스턴스 수명 = 탭 수명. 탭을 닫으면 이력도 사라진다 — 파일 기록은 §3 후속.)
 */
export class ResourceHistory {
    private readonly opts: ResourceHistoryOptions;
    /** 증가율 기준 후보(tcp 가 있는 최근 샘플들). */
    private recent: ResourceSnapshot[] = [];
    private pts: ResourceHistoryPoint[] = [];

    constructor(opts?: Partial<ResourceHistoryOptions>) {
        this.opts = { ...DEFAULT_HISTORY_OPTIONS, ...(opts ?? {}) };
    }

    record(snapshot: ResourceSnapshot): { rates: ResourceRates | null; history: ResourceHistoryPoint[] } {
        const rates = this.rateFor(snapshot);
        if (snapshot.tcp) {
            if (rates?.counterReset) {
                // 재부팅/랩어라운드 — 이전 기준을 버리고 새로 시작
                this.recent = [];
            }
            this.recent.push(snapshot);
            this.pruneRecent(snapshot.sampledAt);
        }

        const last = this.pts[this.pts.length - 1];
        if (!last || snapshot.sampledAt - last.t >= this.opts.minSpacingMs) {
            this.pts.push({
                t: snapshot.sampledAt,
                acceptedPerSec: rates?.acceptedPerSec ?? null,
                clustersFree: snapshot.mbuf?.clustersFree ?? null,
                freeMb: snapshot.memory?.freeMb ?? null,
            });
            if (this.pts.length > this.opts.maxPoints) {
                this.pts.splice(0, this.pts.length - this.opts.maxPoints);
            }
        }
        return { rates, history: this.points() };
    }

    points(): ResourceHistoryPoint[] {
        return this.pts.slice();
    }

    clear(): void {
        this.recent = [];
        this.pts = [];
    }

    /** rateWindowMs 이상 오래된 샘플 중 가장 새것을 기준으로, 없으면 가장 오래된 샘플을 기준으로 증가율 계산. */
    private rateFor(snapshot: ResourceSnapshot): ResourceRates | null {
        if (!snapshot.tcp || this.recent.length === 0) {
            return null;
        }
        let base: ResourceSnapshot | null = null;
        for (const s of this.recent) {
            if (snapshot.sampledAt - s.sampledAt >= this.opts.rateWindowMs) {
                base = s;
            }
        }
        return computeRates(base ?? this.recent[0], snapshot);
    }

    /** 기준 후보를 rateWindowMs 의 2배 이내로 유지(단, 최소 1개는 남긴다). */
    private pruneRecent(now: number): void {
        const limit = this.opts.rateWindowMs * 2;
        while (this.recent.length > 1 && now - this.recent[0].sampledAt > limit) {
            // 다음 것도 window 를 만족하면 첫 것을 버린다(기준이 끊기지 않게).
            if (now - this.recent[1].sampledAt >= this.opts.rateWindowMs) {
                this.recent.shift();
            } else {
                break;
            }
        }
    }
}
