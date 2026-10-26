import * as assert from 'assert';
import { test } from './harness';
import {
    assessGplServices,
    assessReachability,
    describeReachability,
    describeSubnetOverlap,
    findOverlappingSubnets,
    identifyResponder,
    parseRouteProbeJson,
    splitArpByRoute,
    subnetContains,
} from '../controller/connection/reachability';
import type { ArpLookupResult, InterfaceAddress, RouteProbe } from '../controller/connection/reachability';
import { recoveryGuidanceForLoss } from '../controller/connection/connectionHealth';

// 2026-10-22 분석 3번: 사후 스냅샷이 다른 어댑터(이더넷 4 → D8-43-AE 게이트웨이)의 ARP 항목을 응답 장치로 내세웠다.
// 실제 경로는 이더넷 11(192.168.0.124/24 → 00-14-FF 제어기)이었다.
const ARP_TWO: ArpLookupResult = {
    mac: 'D8-43-AE-A9-7F-89',
    entries: [
        { ip: '192.168.0.1', mac: 'D8-43-AE-A9-7F-89', iface: '192.168.2.45' },
        { ip: '192.168.0.1', mac: '00-14-FF-23-19-81', iface: '192.168.0.124' },
    ],
};
const ADDRS: InterfaceAddress[] = [
    { interfaceAlias: '이더넷 4', interfaceIndex: 4, address: '192.168.2.45', prefixLength: 21 },
    { interfaceAlias: '이더넷 11', interfaceIndex: 11, address: '192.168.0.124', prefixLength: 24 },
    { interfaceAlias: 'Loopback Pseudo-Interface 1', interfaceIndex: 1, address: '127.0.0.1', prefixLength: 8 },
    { interfaceAlias: 'Wi-Fi', interfaceIndex: 7, address: '10.0.0.5', prefixLength: 24 },
];
const ROUTE: RouteProbe = { route: { interfaceAlias: '이더넷 11', interfaceIndex: 11, sourceAddress: '192.168.0.124' }, addresses: ADDRS };

test('reachability route: 서브넷 포함 계산(/24·/21·경계)', () => {
    assert.strictEqual(subnetContains('192.168.0.124', 24, '192.168.0.1'), true);
    assert.strictEqual(subnetContains('192.168.2.45', 21, '192.168.0.1'), true, '/21 = 192.168.0.0~7.255');
    assert.strictEqual(subnetContains('192.168.8.1', 21, '192.168.0.1'), false);
    assert.strictEqual(subnetContains('10.0.0.5', 24, '192.168.0.1'), false);
    assert.strictEqual(subnetContains('bad', 24, '192.168.0.1'), false);
});

test('reachability route: 두 어댑터 망이 모두 제어기 IP 를 포함하면 한 줄 경고', () => {
    const overlaps = findOverlappingSubnets('192.168.0.1', ADDRS);
    assert.deepStrictEqual(overlaps.map(a => a.interfaceAlias), ['이더넷 4', '이더넷 11']);
    const warn = describeSubnetOverlap('192.168.0.1', overlaps);
    assert.match(warn ?? '', /이더넷 4\(192\.168\.2\.45\/21\)과 이더넷 11\(192\.168\.0\.124\/24\) 양쪽 망/);
    assert.strictEqual(describeSubnetOverlap('192.168.0.1', overlaps.slice(1)), undefined, '하나뿐이면 경고하지 않는다');
});

test('reachability route: PowerShell JSON 파싱(단일 주소 객체·경로 없음 포함)', () => {
    const p = parseRouteProbeJson('{"route":{"interfaceAlias":"이더넷 11","interfaceIndex":11,"sourceAddress":"192.168.0.124"},"addresses":[{"InterfaceAlias":"이더넷 11","InterfaceIndex":11,"IPAddress":"192.168.0.124","PrefixLength":24}]}');
    assert.strictEqual(p?.route?.sourceAddress, '192.168.0.124');
    assert.strictEqual(p?.addresses.length, 1);
    const single = parseRouteProbeJson('{"route":null,"addresses":{"InterfaceAlias":"Wi-Fi","IPAddress":"10.0.0.5","PrefixLength":24}}');
    assert.strictEqual(single?.route, undefined);
    assert.strictEqual(single?.addresses[0].interfaceAlias, 'Wi-Fi');
    assert.strictEqual(parseRouteProbeJson(''), undefined);
});

test('reachability route: 경로 인터페이스의 ARP 만 응답 장치로, 다른 어댑터 항목은 참고', () => {
    const split = splitArpByRoute(ARP_TWO.entries, ROUTE.route);
    assert.strictEqual(split.matched, true);
    assert.deepStrictEqual(split.routeEntries.map(e => e.mac), ['00-14-FF-23-19-81']);
    assert.deepStrictEqual(split.otherEntries.map(e => e.mac), ['D8-43-AE-A9-7F-89']);
    const who = identifyResponder({ ttl: 255 }, ARP_TWO, ROUTE.route);
    assert.strictEqual(who.kind, 'controller', '경로(이더넷 11)의 MAC 은 Precise — 게이트웨이 항목이 판정을 흐리지 않는다');
    assert.match(who.detail, /^경로 이더넷 11\(192\.168\.0\.124\)/);
    assert.match(who.detail, /참고\(다른 어댑터\): MAC D8-43-AE-A9-7F-89/);
    // 경로를 모르면 종전처럼 두 MAC 을 함께 보고 판정을 보류한다.
    assert.strictEqual(identifyResponder({ ttl: 255 }, ARP_TWO).kind, 'unknown');
});

test('reachability route: assess 결과에 경로 인터페이스·다른 어댑터 MAC·서브넷 겹침이 실린다', () => {
    const a = assessReachability({ ip: '192.168.0.1', tcp1402: 'refused', icmp: { alive: true, ttl: 255, ms: 1 }, arp: ARP_TWO, route: ROUTE });
    assert.strictEqual(a.observations.route, 'controller');
    assert.deepStrictEqual(a.observations.macs, ['00-14-FF-23-19-81']);
    assert.strictEqual(a.observations.routeInterface?.interfaceAlias, '이더넷 11');
    assert.deepStrictEqual(a.observations.otherAdapterMacs, [{ mac: 'D8-43-AE-A9-7F-89', iface: '192.168.2.45' }]);
    assert.match(a.observations.subnetOverlap ?? '', /양쪽 망/);
    assert.strictEqual(a.assessment.confidence, 'high', '경로가 제어기로 특정되면 확신도를 낮추지 않는다');
    const v = describeReachability({ ip: '192.168.0.1', tcp1402: 'refused', icmp: { alive: true, ttl: 255, ms: 1 }, arp: ARP_TWO, route: ROUTE });
    assert.match(v, /경로 인터페이스: 이더넷 11\(192\.168\.0\.124\)/);
    assert.match(v, /\[응답 장치: 제어기 — 경로 이더넷 11/);
});

// 2026-10-23 보고: Unload 행 뒤 21 OPEN(RTEMS) + 1402/1403/4000/8000 refused 가 20분 지속 — 전부 wait-and-retry 로 나왔다.
const RTEMS = '220 RTEMS FTP server (Version 1.1-JWJ) ready.';

test('gplServices: FTP RTEMS + 명령·런타임 콘솔 거부 → gpl-runtime-network-down(재부팅 후보)', () => {
    const s = assessGplServices('refused', { ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'refused' });
    assert.strictEqual(s?.state, 'gpl-runtime-network-down');
    assert.strictEqual(s?.rebootCandidate, true);
    assert.strictEqual(s?.confidence, 'medium');
    assert.match(s!.recommendedAction, /PC 네트워크 어댑터를 껐다 켜기/);
    const afterUnload = assessGplServices('refused', { ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'refused' },
        { command: 'Unload BinderR3', kind: 'timeout', at: 0 });
    assert.strictEqual(afterUnload?.confidence, 'high', '이 세션의 Unload 타임아웃 뒤면 확신도가 높다');
    assert.match(afterUnload!.summary, /Unload BinderR3/);
});

test('gplServices: FTP 도 거부 → 부팅 중/다른 장치, 다른 배너 → 다른 장치, 런타임 콘솔만 열림 → 명령 콘솔 세션 점유', () => {
    assert.strictEqual(assessGplServices('refused', { ftp: { state: 'refused' }, runtimeConsole: 'refused' })?.state, 'booting-or-other-device');
    assert.strictEqual(assessGplServices('refused', { ftp: { state: 'timeout' }, runtimeConsole: 'timeout' })?.state, 'booting-or-other-device');
    const other = assessGplServices('refused', { ftp: { state: 'open', banner: '220 (vsFTPd 3.0.3)' }, runtimeConsole: 'refused' });
    assert.strictEqual(other?.state, 'different-device');
    assert.strictEqual(other?.rebootCandidate, false);
    assert.strictEqual(assessGplServices('refused', { ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'open' })?.state, 'command-console-held');
    assert.strictEqual(assessGplServices('refused', { ftp: { state: 'open' }, runtimeConsole: 'refused' })?.state, 'inconclusive');
    assert.strictEqual(assessGplServices('open', { ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'open' }), undefined, '거부가 아니면 가르지 않는다');
});

test('gplServices: assess 결과에 서비스 관측과 판정이 실리고, 판정 요약이 다른 설명 맨 앞에 온다', () => {
    const a = assessReachability({
        ip: '192.168.0.1', tcp1402: 'refused', icmp: { alive: true, ttl: 255, ms: 1 },
        arp: { mac: '00-14-FF-0F-4F-FF', entries: [{ ip: '192.168.0.1', mac: '00-14-FF-0F-4F-FF' }] },
        services: { ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'refused' },
    });
    assert.strictEqual(a.assessment.services?.state, 'gpl-runtime-network-down');
    assert.strictEqual(a.observations.ftp?.banner, RTEMS);
    assert.strictEqual(a.observations.runtimeConsole, 'refused');
    assert.match(a.assessment.alternativeExplanations[0], /GPL 런타임의 TCP 서비스가 통째로/);
    assert.strictEqual(a.controllerHealth.state, 'unconfirmed', '재부팅 후보여도 런타임 상태를 확정하지 않는다');
});

test('connectionHealth: 복구 창이 지나도 거부로 끝난 유실만 PC 어댑터 재연결 안내를 붙인다', () => {
    const expired = { suspectReason: 'recovery-window-expired: Unload Lib(timeout) 뒤 181 s(36회 프로브) 동안 복구되지 않음', lastFailure: { kind: 'refused' as const, detail: 'ECONNREFUSED', at: 0 } };
    const g = recoveryGuidanceForLoss(expired);
    assert.match(g ?? '', /제어기 쪽 명령 콘솔 세션이 아직 잡혀 있을 수 있습니다/);
    assert.match(g ?? '', /물리 링크 재연결/);
    assert.match(g ?? '', /재부팅 불필요/);
    assert.strictEqual(recoveryGuidanceForLoss({ ...expired, lastFailure: { kind: 'timeout', detail: '', at: 0 } }), undefined);
    assert.strictEqual(recoveryGuidanceForLoss({ suspectReason: 'probe: refused — x', lastFailure: { kind: 'refused', detail: '', at: 0 } }), undefined);
});
