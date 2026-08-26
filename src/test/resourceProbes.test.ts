import * as assert from 'assert';
import { test } from './harness';
import {
    parseShowMemory,
    parseShowNetworkTcp,
    parseShowNetworkMbuf,
    computeRates,
    buildResourceSnapshot,
    extractDataPayload,
    ResourceHistory,
    ResourceSnapshot,
    RAW_KEEP_MAX_CHARS,
} from '../controller/resourceProbes';
import { NO_STATUS_CODE } from '../controller/responseParser';

const frame = (body: string, status = '0,""') => `<DATA>\r\n${body}\r\n</DATA>\r\n<STATUS>${status}</STATUS>\r\n`;

// ── Show Memory ───────────────────────────────────────────────────

test('parseShowMemory: 문서상 형식(Main Memory / Free·Used 줄 + 각 Segments)', () => {
    const raw = frame('Main Memory:\r\n  Free: 9.2356 Mb, Segments: 14\r\n  Used: 2.7490 Mb, Segments: 2166');
    const m = parseShowMemory(raw);
    assert.ok(m);
    assert.strictEqual(m.freeMb, 9.2356);
    assert.strictEqual(m.usedMb, 2.749);
    assert.strictEqual(m.segments, 2166, 'Used 쪽 Segments 를 단편화 지표로 채택');
    assert.strictEqual(m.freeSegments, 14);
    assert.strictEqual(m.fileDescriptorsFree, null);
});

test('parseShowMemory: 사용자 요약 한 줄 형식(Segments 하나)', () => {
    const m = parseShowMemory('Free 3.6557 Mb, Used 7.9903 Mb, Segments 49939');
    assert.ok(m);
    assert.deepStrictEqual(
        [m.freeMb, m.usedMb, m.segments, m.freeSegments],
        [3.6557, 7.9903, 49939, null],
    );
});

test('parseShowMemory: -all 형식은 Main Memory 구역만 읽고 File Descriptors 를 함께 잡는다', () => {
    const body = [
        'Main Memory:',
        '        Free: 9.2356 Mb, Segments: 14',
        '        Used: 2.7490 Mb, Segments: 2166',
        'System Memory:',
        '        Free: 0.1247 Mb, Segments: 1',
        '        Used: 0.1253 Mb, Segments: 240',
        'Object Cache:',
        '        Free: 0.0789 Mb, Segments: 704',
        'Servo I/O Buffers:',
        '        Used Segments: 2',
        'File Descriptors:',
        '        Free: 39',
        '        Used: 25',
    ].join('\r\n');
    const m = parseShowMemory(frame(body));
    assert.ok(m);
    assert.strictEqual(m.freeMb, 9.2356, 'System Memory 의 Free 0.1247 을 집지 않아야 함');
    assert.strictEqual(m.usedMb, 2.749);
    assert.strictEqual(m.segments, 2166);
    assert.strictEqual(m.fileDescriptorsFree, 39);
    assert.strictEqual(m.fileDescriptorsUsed, 25);
});

test('parseShowMemory: 대소문자·구두점·순서 변형(Used 먼저, 등호 구분)', () => {
    const m = parseShowMemory('used = 7.99 mb ; segments = 100 | FREE = 3.65 MB ; SEGMENTS = 7');
    assert.ok(m);
    assert.strictEqual(m.usedMb, 7.99);
    assert.strictEqual(m.freeMb, 3.65);
    assert.strictEqual(m.segments, 100, 'Used 뒤 Segments');
    assert.strictEqual(m.freeSegments, 7, 'Free 뒤 Segments');
});

test('parseShowMemory: 매칭 실패/빈 입력 → null', () => {
    assert.strictEqual(parseShowMemory(frame('Unknown command')), null);
    assert.strictEqual(parseShowMemory(''), null);
    assert.strictEqual(parseShowMemory(null), null);
    assert.strictEqual(parseShowMemory(frame('')), null);
});

// ── Show Network -tcp ─────────────────────────────────────────────

// ── 실기기 원문 픽스처 (G2400C, GPL 4.2K5, 2026-08-25 Claude 세션 도구 응답에서 채록 — controller-mcp/test/parse.test.mjs 와 동일) ──
const MEMORY_REAL = 'Main Memory:\r\n  Free: 3.6557 Mb, Segments: 35\r\n  Used: 7.9903 Mb, Segments: 49939';
const TCP_REAL = [
    '************ TCP Statistics ************',
    '               connections accepted       13213',
    '            connections established       13212',
    '                connections dropped          13',
    '      conn. closed (includes drops)       13836',
    '     segs where we tried to get rtt       27968',
    '                 times we succeeded       27953',
    '                 keepalive timeouts          12',
    '                 total packets sent       65461',
    ' control (SYN|FIN|RST) packets sent       13206',
    '             total packets received       69044',
].join('\r\n');
const MBUF_REAL = [
    '************ MBUF STATISTICS ************',
    'mbufs:3072    clusters: 512    free: 223',
    'drops:   0       waits:   0  drains:   0',
    '      free:2725          data:292         header:55          socket:0       ',
    '       pcb:0           rtable:0           htable:0           atable:0       ',
    '    soname:0           soopts:0           ftable:0           rights:0       ',
    '    ifaddr:0          control:0          oobdata:0',
].join('\r\n');

test('실기기 원문: Show Memory — Free/Used 줄에 Segments 가 각각 (segments=Used 쪽, freeSegments=Free 쪽)', () => {
    const m = parseShowMemory(frame(MEMORY_REAL));
    assert.ok(m);
    assert.strictEqual(m!.freeMb, 3.6557);
    assert.strictEqual(m!.usedMb, 7.9903);
    assert.strictEqual(m!.segments, 49939);
    assert.strictEqual(m!.freeSegments, 35);
});

test('실기기 원문: Show Network -tcp — BSD netstat 표, established 가 앞 줄 accepted 값을 집지 않고 closed 는 괄호 주석 뒤 숫자', () => {
    const t = parseShowNetworkTcp(frame(TCP_REAL));
    assert.deepStrictEqual(t, { accepted: 13213, established: 13212, closed: 13836 });
});

test('실기기 원문: Show Network -mbuf — clusters 줄의 free 는 clustersFree, "free:N data:" 줄의 free 는 mbuf free', () => {
    const m = parseShowNetworkMbuf(frame(MBUF_REAL));
    assert.deepStrictEqual(m, { total: 3072, free: 2725, clusters: 512, clustersFree: 223, drops: 0, waits: 0, drains: 0 });
});

test('parseShowNetworkTcp: 사용자 요약 형식', () => {
    const t = parseShowNetworkTcp(frame('connections accepted 10, established 10, closed 19'));
    assert.deepStrictEqual(t, { accepted: 10, established: 10, closed: 19 });
});

test('parseShowNetworkTcp: VxWorks tcpstatShow 형식(숫자 앞, 괄호 주석 포함)', () => {
    const body = [
        'TCP:',
        '\t1523 packets sent',
        '\t\t1200 data packets (48000 bytes)',
        '\t1601 packets received',
        '\t7 connection requests',
        '\t10 connection accepts',
        '\t17 connections established (including accepts)',
        '\t19 connections closed (including 3 drops)',
        '\t2 embryonic connections dropped',
    ].join('\r\n');
    const t = parseShowNetworkTcp(frame(body));
    assert.deepStrictEqual(t, { accepted: 10, established: 17, closed: 19 });
});

test('parseShowNetworkTcp: 순서·공백·대소문자 변형 + 줄바꿈 분리', () => {
    const t = parseShowNetworkTcp('CLOSED:\t19\r\n  Established = 10\r\nConnections Accepted : 10');
    assert.deepStrictEqual(t, { accepted: 10, established: 10, closed: 19 });
});

test('parseShowNetworkTcp: 일부만 맞으면 나머지는 null, 전혀 없으면 null', () => {
    const partial = parseShowNetworkTcp('connections accepted 42');
    assert.deepStrictEqual(partial, { accepted: 42, established: null, closed: null });
    assert.strictEqual(parseShowNetworkTcp(frame('*** INTERFACE STATISTICS ***')), null);
    assert.strictEqual(parseShowNetworkTcp(undefined), null);
});

// ── Show Network -mbuf ────────────────────────────────────────────

test('parseShowNetworkMbuf: 사용자 요약 형식', () => {
    const m = parseShowNetworkMbuf(frame('mbufs 3072 (free 2778, data 292, header 2) clusters 512, free 223 / drops 0, waits 0, drains 0'));
    assert.deepStrictEqual(m, { total: 3072, free: 2778, clusters: 512, clustersFree: 223, drops: 0, waits: 0, drains: 0 });
});

test('parseShowNetworkMbuf: VxWorks netStackDataPoolShow 형식(type 표 + CLUSTER POOL TABLE 합산)', () => {
    const body = [
        'type        number',
        '---------   ------',
        'FREE    :   2778',
        'DATA    :   292',
        'HEADER  :   2',
        'SOCKET  :   0',
        'TOTAL   :   3072',
        'number of mbufs: 3072',
        'number of times failed to find space: 4',
        'number of times waited for space: 1',
        'number of times drained protocols for space: 2',
        '__________________',
        'CLUSTER POOL TABLE',
        '_______________________________________________________________________________',
        'size     clusters  free      usage',
        '-------------------------------------------------------------------------------',
        '64       256       200       1200',
        '128      128       13        3300',
        '256      64        5         900',
        '512      64        5         120',
        '-------------------------------------------------------------------------------',
    ].join('\r\n');
    const m = parseShowNetworkMbuf(frame(body));
    assert.deepStrictEqual(m, { total: 3072, free: 2778, clusters: 512, clustersFree: 223, drops: 4, waits: 1, drains: 2 });
});

test('parseShowNetworkMbuf: 대소문자·순서 변형(drains 먼저, 콜론 구분)', () => {
    const m = parseShowNetworkMbuf('Drains: 3  Waits: 2  Drops: 1\r\nMBUFS: 100  Free: 90\r\nClusters: 10  Free: 4');
    assert.deepStrictEqual(m, { total: 100, free: 90, clusters: 10, clustersFree: 4, drops: 1, waits: 2, drains: 3 });
});

test('parseShowNetworkMbuf: 매칭 실패 → null', () => {
    assert.strictEqual(parseShowNetworkMbuf(frame('Invalid switch')), null);
    assert.strictEqual(parseShowNetworkMbuf(''), null);
});

// ── extractDataPayload ────────────────────────────────────────────

test('extractDataPayload: DATA 본문 추출, 없으면 STATUS 만 제거', () => {
    assert.strictEqual(extractDataPayload('<DATA>abc</DATA><STATUS>0,""</STATUS>'), 'abc');
    assert.strictEqual(extractDataPayload('abc<STATUS>0,""</STATUS>'), 'abc');
    assert.strictEqual(extractDataPayload('plain'), 'plain');
});

// ── buildResourceSnapshot ─────────────────────────────────────────

test('buildResourceSnapshot: STATUS 0 은 파싱, STATUS 오류는 파싱 생략 + 코드/raw 보존, null 은 응답 없음', () => {
    const longTail = 'x'.repeat(RAW_KEEP_MAX_CHARS + 500);
    const snap = buildResourceSnapshot({
        memory: frame('Free 3.6557 Mb, Used 7.9903 Mb, Segments 49939'),
        tcp: frame('connections accepted 10, established 10, closed 19' + '\r\n' + longTail),
        mbuf: frame('-mbuf: Unknown switch', '-1234,"Invalid switch"'),
    }, 1000);
    assert.strictEqual(snap.sampledAt, 1000);
    assert.strictEqual(snap.memory?.freeMb, 3.6557);
    assert.strictEqual(snap.tcp?.accepted, 10);
    assert.strictEqual(snap.mbuf, null, 'STATUS -1234 → 파싱하지 않음');
    assert.deepStrictEqual(snap.status, { memory: 0, tcp: 0, mbuf: -1234 });
    assert.ok(snap.raw.mbuf?.includes('Unknown switch'));
    assert.strictEqual(snap.raw.tcp?.length, RAW_KEEP_MAX_CHARS, 'raw 는 절단');

    const none = buildResourceSnapshot({ memory: null, tcp: undefined }, 5);
    assert.deepStrictEqual(none, { memory: null, tcp: null, mbuf: null, raw: {}, status: {}, sampledAt: 5 });
});

test('buildResourceSnapshot: STATUS 누락(조기 완료로 잘림)도 부분 파싱한다', () => {
    const snap = buildResourceSnapshot({ tcp: '<DATA>\r\nconnections accepted 7, established' }, 1);
    assert.strictEqual(snap.status.tcp, NO_STATUS_CODE);
    assert.deepStrictEqual(snap.tcp, { accepted: 7, established: null, closed: null });
});

// ── computeRates ──────────────────────────────────────────────────

function snapAt(t: number, accepted: number | null, closed: number | null): ResourceSnapshot {
    return {
        memory: null,
        tcp: accepted === null && closed === null ? null : { accepted, established: null, closed },
        mbuf: null,
        raw: {},
        status: {},
        sampledAt: t,
    };
}

test('computeRates: accepted/closed 초당 증가율과 경과 ms', () => {
    const r = computeRates(snapAt(0, 100, 50), snapAt(4000, 140, 58));
    assert.ok(r);
    assert.strictEqual(r.acceptedPerSec, 10);
    assert.strictEqual(r.closedPerSec, 2);
    assert.strictEqual(r.elapsedMs, 4000);
    assert.strictEqual(r.counterReset, false);
});

test('computeRates: 경과 0 이하·tcp 없음 → null, 카운터 감소 → counterReset + null 값', () => {
    assert.strictEqual(computeRates(snapAt(1000, 1, 1), snapAt(1000, 2, 2)), null);
    assert.strictEqual(computeRates(snapAt(1000, 1, 1), snapAt(500, 2, 2)), null);
    assert.strictEqual(computeRates(null, snapAt(1, 1, 1)), null);
    assert.strictEqual(computeRates(snapAt(0, null, null), snapAt(1000, 2, 2)), null);
    const reset = computeRates(snapAt(0, 5000, 4000), snapAt(2000, 12, 3));
    assert.ok(reset);
    assert.strictEqual(reset.counterReset, true);
    assert.strictEqual(reset.acceptedPerSec, null);
    assert.strictEqual(reset.closedPerSec, null);
    const half = computeRates(snapAt(0, 10, null), snapAt(1000, 12, 3));
    assert.ok(half);
    assert.strictEqual(half.acceptedPerSec, 2);
    assert.strictEqual(half.closedPerSec, null, '한쪽 필드만 없으면 그 값만 null');
});

// ── ResourceHistory ───────────────────────────────────────────────

test('ResourceHistory: rateWindow 이상 벌어진 샘플을 기준으로 증가율을 내고, 첫 샘플은 null', () => {
    const h = new ResourceHistory({ maxPoints: 10, minSpacingMs: 0, rateWindowMs: 5000 });
    assert.strictEqual(h.record(snapAt(0, 0, 0)).rates, null, '기준 없음');
    // 1.5s 간격 폴링 — 5초 미만이면 가장 오래된 샘플(0ms) 기준
    assert.strictEqual(h.record(snapAt(1500, 3, 0)).rates?.acceptedPerSec, 2);
    assert.strictEqual(h.record(snapAt(3000, 6, 0)).rates?.acceptedPerSec, 2);
    // 6000ms: 5초 이상 오래된 샘플 중 가장 새것 = 0ms(1500·3000 은 5초 미만)
    const r = h.record(snapAt(6000, 12, 0)).rates;
    assert.strictEqual(r?.elapsedMs, 6000);
    assert.strictEqual(r?.acceptedPerSec, 2);
    // 7500ms: 기준 = 1500ms(6000ms 만큼 벌어진 것 중 가장 새것)
    const r2 = h.record(snapAt(7500, 24, 0)).rates;
    assert.strictEqual(r2?.elapsedMs, 6000);
    assert.strictEqual(r2?.acceptedPerSec, 3.5);
});

test('ResourceHistory: 점 최소 간격과 링 크기, tcp 없는 샘플도 점으로 남긴다(공백 표시용)', () => {
    const h = new ResourceHistory({ maxPoints: 3, minSpacingMs: 2500, rateWindowMs: 1000 });
    h.record(snapAt(0, 0, 0));
    h.record(snapAt(1000, 2, 0));          // 2.5s 미만 → 점 미추가
    h.record(snapAt(2500, 5, 0));          // 추가 (기준 = 1초 이상 오래된 것 중 최신 = 1000ms → (5-2)/1.5s = 2/s)
    h.record(snapAt(5000, 10, 0));         // 추가
    h.record(snapAt(7500, null, null));    // tcp 없음 → 점 추가(값 null), 링 초과로 첫 점 탈락
    const pts = h.points();
    assert.deepStrictEqual(pts.map(p => p.t), [2500, 5000, 7500]);
    assert.strictEqual(pts[0].acceptedPerSec, 2);
    assert.strictEqual(pts[2].acceptedPerSec, null);
    h.clear();
    assert.deepStrictEqual(h.points(), []);
});

test('ResourceHistory: 카운터 리셋 후 기준을 새로 잡는다', () => {
    const h = new ResourceHistory({ maxPoints: 10, minSpacingMs: 0, rateWindowMs: 1000 });
    h.record(snapAt(0, 1000, 0));
    const reset = h.record(snapAt(2000, 3, 0)).rates;   // 재부팅
    assert.strictEqual(reset?.counterReset, true);
    const after = h.record(snapAt(4000, 7, 0)).rates;   // 기준 = 2000ms 샘플(3)
    assert.strictEqual(after?.counterReset, false);
    assert.strictEqual(after?.acceptedPerSec, 2);
});

test('ResourceHistory: mbuf/memory 값이 점에 실린다', () => {
    const h = new ResourceHistory({ minSpacingMs: 0 });
    const s = snapAt(10, 1, 1);
    s.mbuf = { total: 1, free: 1, clusters: 10, clustersFree: 4, drops: 0, waits: 0, drains: 0 };
    s.memory = { freeMb: 3.5, usedMb: 8, segments: 1, freeSegments: null, fileDescriptorsFree: null, fileDescriptorsUsed: null };
    const { history } = h.record(s);
    assert.deepStrictEqual(history, [{ t: 10, acceptedPerSec: null, clustersFree: 4, freeMb: 3.5 }]);
});
