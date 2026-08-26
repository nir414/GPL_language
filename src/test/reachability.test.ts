import * as assert from 'assert';
import { test } from './harness';
import {
    parsePingOutput,
    parseArpOutput,
    classifyTcpError,
    identifyResponder,
    describeReachability,
    normalizeMac,
    vendorHintFor,
} from '../controller/reachability';

// ── ping 출력 샘플 ──────────────────────────────────────────────────────────

const PING_WIN_EN_OK = [
    '',
    'Pinging 192.168.0.1 with 32 bytes of data:',
    'Reply from 192.168.0.1: bytes=32 time<1ms TTL=255',
    '',
    'Ping statistics for 192.168.0.1:',
    '    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),',
    'Approximate round trip times in milli-seconds:',
    '    Minimum = 0ms, Maximum = 0ms, Average = 0ms',
].join('\r\n');

const PING_WIN_KO_OK = [
    '',
    'Ping 192.168.0.1 32바이트 데이터 사용:',
    '192.168.0.1의 응답: 바이트=32 시간<1ms TTL=255',
    '',
    '192.168.0.1에 대한 Ping 통계:',
    '    패킷: 보냄 = 1, 받음 = 1, 손실 = 0 (0% 손실),',
    '왕복 시간(밀리초):',
    '    최소 = 0ms, 최대 = 0ms, 평균 = 0ms',
].join('\r\n');

const PING_WIN_KO_GATEWAY = '192.168.0.1의 응답: 바이트=32 시간=2ms TTL=64\r\n';

const PING_WIN_KO_UNREACHABLE = [
    'Ping 192.168.0.1 32바이트 데이터 사용:',
    '192.168.0.124의 응답: 대상 호스트에 연결할 수 없습니다.',
    '',
    '192.168.0.1에 대한 Ping 통계:',
    '    패킷: 보냄 = 1, 받음 = 1, 손실 = 0 (0% 손실),',
].join('\r\n');

const PING_WIN_EN_TIMEOUT = [
    'Pinging 192.168.0.1 with 32 bytes of data:',
    'Request timed out.',
    '',
    'Ping statistics for 192.168.0.1:',
    '    Packets: Sent = 1, Received = 0, Lost = 1 (100% loss),',
].join('\r\n');

const PING_LINUX_OK = [
    'PING 192.168.0.1 (192.168.0.1) 56(84) bytes of data.',
    '64 bytes from 192.168.0.1: icmp_seq=1 ttl=255 time=0.312 ms',
    '',
    '--- 192.168.0.1 ping statistics ---',
    '1 packets transmitted, 1 received, 0% packet loss, time 0ms',
    'rtt min/avg/max/mdev = 0.312/0.312/0.312/0.000 ms',
].join('\n');

test('parsePingOutput: Windows 영문 응답 → alive, TTL=255, rtt<1ms→1', () => {
    assert.deepStrictEqual(parsePingOutput(PING_WIN_EN_OK), { alive: true, ttl: 255, rttMs: 1 });
});

test('parsePingOutput: Windows 한국어 응답("바이트=32 시간<1ms TTL=255")도 TTL= 로 판정', () => {
    assert.deepStrictEqual(parsePingOutput(PING_WIN_KO_OK), { alive: true, ttl: 255, rttMs: 1 });
});

test('parsePingOutput: 게이트웨이 응답(TTL=64, 시간=2ms)', () => {
    assert.deepStrictEqual(parsePingOutput(PING_WIN_KO_GATEWAY), { alive: true, ttl: 64, rttMs: 2 });
});

test('parsePingOutput: "대상 호스트에 연결할 수 없습니다"는 종료코드 0이어도 alive=false', () => {
    const r = parsePingOutput(PING_WIN_KO_UNREACHABLE);
    assert.strictEqual(r.alive, false);
    assert.strictEqual(r.ttl, undefined);
    assert.strictEqual(r.detail, 'destination-host-unreachable');
});

test('parsePingOutput: "Request timed out." → alive=false, request-timed-out', () => {
    const r = parsePingOutput(PING_WIN_EN_TIMEOUT);
    assert.strictEqual(r.alive, false);
    assert.strictEqual(r.detail, 'request-timed-out');
});

test('parsePingOutput: Linux 출력(ttl=255 time=0.312 ms)', () => {
    assert.deepStrictEqual(parsePingOutput(PING_LINUX_OK), { alive: true, ttl: 255, rttMs: 0.312 });
});

test('parsePingOutput: 빈 출력 → alive=false, detail 없음', () => {
    assert.deepStrictEqual(parsePingOutput(''), { alive: false });
});

// ── arp 출력 샘플 ───────────────────────────────────────────────────────────

const ARP_WIN_EN_SINGLE = [
    '',
    'Interface: 192.168.0.124 --- 0x15',
    '  Internet Address      Physical Address      Type',
    '  192.168.0.1           00-14-ff-23-19-81     dynamic',
].join('\r\n');

const ARP_WIN_KO_TWO_IFACES = [
    '',
    '인터페이스: 192.168.0.124 --- 0x15',
    '  인터넷 주소           물리적 주소           유형',
    '  192.168.0.1           00-14-ff-23-19-81     동적',
    '',
    '인터페이스: 192.168.3.77 --- 0x4',
    '  인터넷 주소           물리적 주소           유형',
    '  192.168.0.1           d8-43-ae-a9-7f-89     동적',
    '  192.168.0.10          aa-bb-cc-dd-ee-ff     동적',
].join('\r\n');

const ARP_WIN_KO_NONE = 'ARP 항목을 찾을 수 없습니다.\r\n';
const ARP_WIN_EN_NONE = 'No ARP Entries Found.\r\n';

const ARP_LINUX_IP_NEIGH = '192.168.0.1 dev eth0 lladdr 00:14:ff:23:19:81 REACHABLE\n';
const ARP_LINUX_ARP_N = [
    'Address                  HWtype  HWaddress           Flags Mask            Iface',
    '192.168.0.1              ether   00:14:ff:23:19:81   C                     eth0',
].join('\n');

test('parseArpOutput: Windows 영문 단일 항목 — MAC 정규화(대문자·하이픈)와 인터페이스 IP', () => {
    assert.deepStrictEqual(parseArpOutput(ARP_WIN_EN_SINGLE, '192.168.0.1'), [
        { ip: '192.168.0.1', mac: '00-14-FF-23-19-81', iface: '192.168.0.124' },
    ]);
});

test('parseArpOutput: Windows 한국어, 두 인터페이스가 같은 IP를 다른 MAC으로 아는 경우 두 항목 모두 반환 (#22 함정)', () => {
    const entries = parseArpOutput(ARP_WIN_KO_TWO_IFACES, '192.168.0.1');
    assert.deepStrictEqual(entries, [
        { ip: '192.168.0.1', mac: '00-14-FF-23-19-81', iface: '192.168.0.124' },
        { ip: '192.168.0.1', mac: 'D8-43-AE-A9-7F-89', iface: '192.168.3.77' },
    ]);
});

test('parseArpOutput: 192.168.0.1 조회가 192.168.0.10 항목에 걸리지 않는다(토큰 경계)', () => {
    const entries = parseArpOutput(ARP_WIN_KO_TWO_IFACES, '192.168.0.10');
    assert.deepStrictEqual(entries, [{ ip: '192.168.0.10', mac: 'AA-BB-CC-DD-EE-FF', iface: '192.168.3.77' }]);
});

test('parseArpOutput: 항목 없음(한국어/영문) → 빈 배열', () => {
    assert.deepStrictEqual(parseArpOutput(ARP_WIN_KO_NONE, '192.168.0.1'), []);
    assert.deepStrictEqual(parseArpOutput(ARP_WIN_EN_NONE, '192.168.0.1'), []);
    assert.deepStrictEqual(parseArpOutput('', '192.168.0.1'), []);
});

test('parseArpOutput: Linux ip neigh / arp -n', () => {
    assert.deepStrictEqual(parseArpOutput(ARP_LINUX_IP_NEIGH, '192.168.0.1'), [
        { ip: '192.168.0.1', mac: '00-14-FF-23-19-81', iface: 'eth0' },
    ]);
    assert.deepStrictEqual(parseArpOutput(ARP_LINUX_ARP_N, '192.168.0.1'), [
        { ip: '192.168.0.1', mac: '00-14-FF-23-19-81', iface: 'eth0' },
    ]);
});

test('normalizeMac / vendorHintFor: 콜론·소문자 입력도 OUI 매칭', () => {
    assert.strictEqual(normalizeMac('00:14:ff:23:19:81'), '00-14-FF-23-19-81');
    assert.strictEqual(vendorHintFor('00:14:ff:23:19:81'), 'Precise Automation');
    assert.strictEqual(vendorHintFor('d8-43-ae-a9-7f-89'), 'Micro-Star(사무실 게이트웨이 의심)');
    assert.strictEqual(vendorHintFor('aa-bb-cc-dd-ee-ff'), undefined);
    assert.strictEqual(vendorHintFor(undefined), undefined);
});

// ── TCP 오류 분류 ───────────────────────────────────────────────────────────

test('classifyTcpError: 코드별 4분류', () => {
    assert.strictEqual(classifyTcpError('ECONNREFUSED'), 'refused');
    assert.strictEqual(classifyTcpError('ETIMEDOUT'), 'timeout');
    assert.strictEqual(classifyTcpError('EHOSTUNREACH'), 'unreachable');
    assert.strictEqual(classifyTcpError('ENETUNREACH'), 'unreachable');
    assert.strictEqual(classifyTcpError('EADDRNOTAVAIL'), 'error');
    assert.strictEqual(classifyTcpError(undefined), 'error');
});

// ── 응답 장치 정체 + 판정 문장 ──────────────────────────────────────────────

const ARP_PRECISE = { mac: '00-14-FF-23-19-81', entries: [{ ip: '192.168.0.1', mac: '00-14-FF-23-19-81', iface: '192.168.0.124' }] };
const ARP_GATEWAY = { mac: 'D8-43-AE-A9-7F-89', entries: [{ ip: '192.168.0.1', mac: 'D8-43-AE-A9-7F-89', iface: '192.168.3.77' }] };
const ARP_NONE = { mac: undefined, entries: [] as { ip: string; mac: string; iface?: string }[] };

test('identifyResponder: TTL=255 + Precise MAC → controller', () => {
    const r = identifyResponder({ ttl: 255 }, ARP_PRECISE);
    assert.strictEqual(r.kind, 'controller');
    assert.ok(r.detail.includes('TTL=255') && r.detail.includes('Precise Automation'));
});

test('identifyResponder: TTL=64 + Micro-Star MAC → other-device (사무실 게이트웨이)', () => {
    const r = identifyResponder({ ttl: 64 }, ARP_GATEWAY);
    assert.strictEqual(r.kind, 'other-device');
    assert.ok(r.detail.includes('Micro-Star'));
});

test('identifyResponder: MAC 없이 TTL만 — 255면 controller, 64면 other-device, 둘 다 없으면 unknown', () => {
    assert.strictEqual(identifyResponder({ ttl: 255 }, ARP_NONE).kind, 'controller');
    assert.strictEqual(identifyResponder({ ttl: 64 }, ARP_NONE).kind, 'other-device');
    assert.strictEqual(identifyResponder({}, ARP_NONE).kind, 'unknown');
});

test('identifyResponder: 두 인터페이스 MAC 상이 → unknown + 경로 확인 힌트', () => {
    const r = identifyResponder({ ttl: 64 }, { mac: '00-14-FF-23-19-81', entries: [...ARP_PRECISE.entries, ...ARP_GATEWAY.entries] });
    assert.strictEqual(r.kind, 'unknown');
    assert.ok(r.detail.includes('인터페이스별 MAC이 서로 다름'));
});

test('describeReachability: REFUSED + 제어기 정체 → "서비스 닫힘" 판정, 함정 경고 없음', () => {
    const v = describeReachability({ ip: '192.168.0.1', tcp1402: 'refused', icmp: { alive: true, ttl: 255, ms: 5 }, arp: ARP_PRECISE });
    assert.ok(v.includes('1402 서비스가 닫혀 있다'), v);
    assert.ok(!v.includes('무효일 수 있다'), v);
    assert.ok(v.includes('[응답 장치: 제어기'), v);
});

test('describeReachability: REFUSED + TTL=64/Micro-Star → 판정 무효 가능 경고 + arp/TTL 확인 안내 (#22 사후 진단 함정)', () => {
    const v = describeReachability({ ip: '192.168.0.1', tcp1402: 'refused', icmp: { alive: true, ttl: 64, ms: 5 }, arp: ARP_GATEWAY });
    assert.ok(v.includes('1402 서비스가 닫혀 있다'), v);
    assert.ok(v.includes('무효일 수 있다'), v);
    assert.ok(v.includes('arp -a 192.168.0.1') && v.includes('TTL'), v);
    assert.ok(v.includes('[응답 장치: 제어기 아님'), v);
});

test('describeReachability: ICMP만 응답(TCP timeout) → 부팅 중/소켓 점유 판정', () => {
    const v = describeReachability({ ip: '192.168.0.1', tcp1402: 'timeout', icmp: { alive: true, ttl: 255, ms: 5 }, arp: ARP_PRECISE });
    assert.ok(v.startsWith('ICMP는 응답하나 1402 TCP가 실패(timeout)'), v);
});

test('describeReachability: 전부 무응답 → 전원/네트워크 판정에 ping 세부 포함', () => {
    const v = describeReachability({ ip: '192.168.0.1', tcp1402: 'unreachable', icmp: { alive: false, ms: 1000, detail: 'destination-host-unreachable' }, arp: ARP_NONE });
    assert.ok(v.startsWith('ICMP·TCP 모두 무응답(unreachable, ping: destination-host-unreachable)'), v);
});

test('describeReachability: ping 판정 불가(null) → TCP 실패만 확인', () => {
    const v = describeReachability({ ip: '192.168.0.1', tcp1402: 'error', icmp: { alive: null, ms: 1 }, arp: ARP_NONE });
    assert.ok(v.startsWith('ICMP 판정 불가(ping 미지원)'), v);
});

test('describeReachability: OPEN인데 응답 장치가 게이트웨이 → 도달 가능 판정에도 경고', () => {
    const v = describeReachability({ ip: '192.168.0.1', tcp1402: 'open', icmp: { alive: true, ttl: 64, ms: 2 }, arp: ARP_GATEWAY });
    assert.ok(v.includes('도달 가능'), v);
    assert.ok(v.includes('무효일 수 있다'), v);
});
