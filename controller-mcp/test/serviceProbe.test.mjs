// controller_status 판정 보강(2026-10-23 Sample Prep 보고) · 경로 인터페이스 ARP(2026-10-22 분석 3번)
// · Compile 소켓 리셋 분류(2026-10-22 22:01 KST 사고) · 확장 경유 Compile 의 세션 로그 줄.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessRouteProbe,
  classifyGplServices,
  classifyReachability,
  recoveryGuidanceAfterDisruptive,
  classifyCompileAbortError,
  livenessFromProbe,
  subnetContains,
  COMPILE_ABORT_HINT,
} from '../src/outcome.js';
import { extensionCommandLogLines, summarizeOperationResult } from '../src/operations.js';

const RTEMS = '220 RTEMS FTP server (Version 1.1-JWJ) ready.';

test('서비스 판정: FTP RTEMS 열림 + 명령·런타임 콘솔 거부 → gpl-runtime-network-down(재부팅 후보)', () => {
  const s = classifyGplServices({ code: 'ECONNREFUSED', ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'refused' });
  assert.equal(s.state, 'gpl-runtime-network-down');
  assert.equal(s.rebootCandidate, true);
  assert.equal(s.confidence, 'medium');
  assert.match(s.recommendedAction, /^ask-user/);
  assert.match(s.recommendedAction, /PC 네트워크 어댑터를 껐다 켜기/);
  const afterUnload = classifyGplServices({
    code: 'ECONNREFUSED', ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'refused',
    priorDisruptive: { command: 'Unload BinderR3', kind: 'timeout', at: 0 },
  });
  assert.equal(afterUnload.confidence, 'high', '이 세션의 Unload 타임아웃 뒤면 확신도 상향');
});

test('서비스 판정: FTP 거부/무응답 → 부팅 중·다른 장치, 다른 배너 → 다른 장치, 런타임 콘솔만 열림 → 세션 점유', () => {
  assert.equal(classifyGplServices({ code: 'ECONNREFUSED', ftp: { state: 'refused' }, runtimeConsole: 'refused' }).state, 'booting-or-other-device');
  assert.equal(classifyGplServices({ code: 'ECONNREFUSED', ftp: { state: 'timeout' }, runtimeConsole: 'timeout' }).state, 'booting-or-other-device');
  const other = classifyGplServices({ code: 'ECONNREFUSED', ftp: { state: 'open', banner: '220 (vsFTPd 3.0.3)' }, runtimeConsole: 'refused' });
  assert.equal(other.state, 'different-device');
  assert.equal(other.rebootCandidate, false);
  assert.equal(classifyGplServices({ code: 'ECONNREFUSED', ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'open' }).state, 'command-console-held');
  assert.equal(classifyGplServices({ code: 'ETIMEDOUT', ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'refused' }), null, '거부가 아니면 가르지 않는다');
});

test('classifyReachability: 서비스 관측이 있으면 상태·권고가 그것으로 바뀐다(종전엔 셋 다 wait-and-retry)', () => {
  const r = classifyReachability({
    host: '192.168.0.1', code: 'ECONNREFUSED', icmpAlive: true,
    services: { ftp: { state: 'open', banner: RTEMS }, runtimeConsole: 'refused' },
  });
  assert.equal(r.assessment.state, 'gpl-runtime-network-down');
  assert.equal(r.assessment.rebootCandidate, true);
  assert.equal(r.assessment.controllerCrashConfirmed, false);
  assert.equal(r.controllerHealth.state, 'unconfirmed', '재부팅 후보여도 런타임 상태를 확정하지 않는다');
  assert.equal(r.observations.ftp.banner, RTEMS);
  assert.equal(r.observations.runtimeConsole, 'refused');
  assert.match(r.recommendedAction, /^ask-user/);
  assert.match(r.verdict, /GPL 런타임의 TCP 서비스가 통째로/);
  // 서비스 관측이 없으면 종전과 같다.
  const plain = classifyReachability({ host: '192.168.0.1', code: 'ECONNREFUSED', icmpAlive: true });
  assert.equal(plain.assessment.state, 'command-channel-unavailable');
  assert.equal(plain.observations.route, 'ambiguous');
  assert.match(plain.recommendedAction, /^wait-and-retry/);
});

// 2026-10-22: 이더넷 11(192.168.0.124/24 → 00-14-FF 제어기)이 경로인데 이더넷 4(192.168.2.45/21 → D8-43-AE 게이트웨이)도 같은 IP 를 안다.
const ROUTE_PROBE = {
  route: { interfaceAlias: '이더넷 11', interfaceIndex: 11, sourceAddress: '192.168.0.124' },
  neighbors: [
    { InterfaceAlias: '이더넷 4', InterfaceIndex: 4, LinkLayerAddress: 'D8-43-AE-A9-7F-89' },
    { InterfaceAlias: '이더넷 11', InterfaceIndex: 11, LinkLayerAddress: '00-14-FF-23-19-81' },
  ],
  addresses: [
    { InterfaceAlias: '이더넷 4', IPAddress: '192.168.2.45', PrefixLength: 21 },
    { InterfaceAlias: '이더넷 11', IPAddress: '192.168.0.124', PrefixLength: 24 },
    { InterfaceAlias: 'Loopback', IPAddress: '127.0.0.1', PrefixLength: 8 },
  ],
};

test('경로 판정: 경로 인터페이스의 ARP 만 응답 장치로, 다른 어댑터는 참고, 서브넷 겹침은 한 줄 경고', () => {
  assert.equal(subnetContains('192.168.2.45', 21, '192.168.0.1'), true);
  assert.equal(subnetContains('192.168.8.1', 21, '192.168.0.1'), false);
  const r = assessRouteProbe('192.168.0.1', ROUTE_PROBE);
  assert.equal(r.route, 'controller');
  assert.equal(r.mac, '00-14-FF-23-19-81');
  assert.deepEqual(r.otherAdapterMacs, [{ mac: 'D8-43-AE-A9-7F-89', interfaceAlias: '이더넷 4' }]);
  assert.match(r.subnetOverlap, /이더넷 4\(192\.168\.2\.45\/21\)과 이더넷 11\(192\.168\.0\.124\/24\) 양쪽 망/);
  // 경로가 게이트웨이 쪽이면 다른 장치.
  const gw = assessRouteProbe('192.168.0.1', { ...ROUTE_PROBE, route: { interfaceAlias: '이더넷 4', interfaceIndex: 4, sourceAddress: '192.168.2.45' } });
  assert.equal(gw.route, 'other-device');
  // 경로를 모르면 종전처럼 ambiguous.
  assert.equal(assessRouteProbe('192.168.0.1', { neighbors: ROUTE_PROBE.neighbors }).route, 'ambiguous');
  assert.equal(assessRouteProbe('192.168.0.1', null).route, 'ambiguous');
});

test('classifyReachability: 경로 관측이 응답에 실리고, 경로가 다른 장치면 확신도를 낮춘다', () => {
  const ok = classifyReachability({ host: '192.168.0.1', code: 'ECONNREFUSED', icmpAlive: true, routeProbe: ROUTE_PROBE });
  assert.equal(ok.observations.route, 'controller');
  assert.equal(ok.observations.routeInterface.interfaceAlias, '이더넷 11');
  assert.equal(ok.observations.mac, '00-14-FF-23-19-81');
  assert.match(ok.verdict, /경로 인터페이스: 이더넷 11\(192\.168\.0\.124\), MAC 00-14-FF-23-19-81/);
  assert.equal(ok.assessment.confidence, 'high');
  const gw = classifyReachability({
    host: '192.168.0.1', code: 'ECONNREFUSED', icmpAlive: true,
    routeProbe: { ...ROUTE_PROBE, route: { interfaceAlias: '이더넷 4', interfaceIndex: 4, sourceAddress: '192.168.2.45' } },
  });
  assert.equal(gw.assessment.confidence, 'medium');
});

test('복구 안내: 교란 명령 뒤 복구 창(180 s)이 지나도 거부면 PC 어댑터 재연결 실측을 안내한다', () => {
  const now = 1_000_000;
  const g = recoveryGuidanceAfterDisruptive({ code: 'ECONNREFUSED', priorDisruptive: { command: 'Unload Lib', kind: 'timeout', at: now - 200_000 }, now });
  assert.match(g, /복구 대기 창\(180 s\)이 지나도/);
  assert.match(g, /물리 링크 재연결/);
  assert.equal(recoveryGuidanceAfterDisruptive({ code: 'ECONNREFUSED', priorDisruptive: { command: 'Unload Lib', kind: 'timeout', at: now - 60_000 }, now }), null, '창 안이면 기다린다');
  assert.equal(recoveryGuidanceAfterDisruptive({ code: 'ETIMEDOUT', priorDisruptive: { command: 'Unload Lib', kind: 'timeout', at: 0 }, now }), null);
  assert.equal(recoveryGuidanceAfterDisruptive({ code: 'ECONNREFUSED', priorDisruptive: null, now }), null);
  const r = classifyReachability({ host: 'h', code: 'ECONNREFUSED', icmpAlive: true, priorDisruptive: { command: 'Unload Lib', kind: 'timeout', at: now - 200_000 }, now });
  assert.match(r.recommendedAction, /^ask-user — Unload Lib/);
});

test('Compile 리셋 분류: ECONNRESET·EPIPE·연결 종료만 compileAborted, 타임아웃·거부는 아님', () => {
  const a = classifyCompileAbortError('Compile BINDER_Probe', { code: 'ECONNRESET', message: 'read ECONNRESET' }, 22010);
  assert.deepEqual(a, { reason: 'ECONNRESET', command: 'Compile BINDER_Probe', elapsedMs: 22010, outputLines: 0, hint: COMPILE_ABORT_HINT });
  assert.equal(classifyCompileAbortError('Compile P', new Error('Connection closed without response: Compile P'), 5).reason, 'ECONNCLOSED');
  assert.equal(classifyCompileAbortError('Compile P', new Error('Command timed out after 60000ms'), 60000), null);
  assert.equal(classifyCompileAbortError('Compile P', { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, 1), null);
  const alive = livenessFromProbe('Show Thread -web', { raw: '<DATA></DATA><STATUS>0,""</STATUS>', at: 0 });
  assert.equal(alive.state, 'responsive');
  const dead = livenessFromProbe('Show Thread -web', { error: new Error('connect ECONNABORTED'), at: 0 });
  assert.equal(dead.state, 'unresponsive');
  assert.match(dead.detail, /ECONNABORTED/);
});

test('세션 로그: 확장이 보낸 Compile 을 줄로 — DeployResult·작업 기록 요약 두 모양 모두', () => {
  const deployResult = {
    compileAborted: { reason: 'ECONNRESET', command: 'Compile BINDER_Probe', elapsedMs: 22010, outputLines: 0 },
    compileAttemptLogs: [
      { command: 'Compile BINDER_Probe', statusCode: -9999, elapsedMs: 22010, raw: 'x' },
    ],
  };
  assert.deepEqual(extensionCommandLogLines(deployResult), ['Compile BINDER_Probe | 22010ms | ABORTED ECONNRESET']);
  const opSummary = { compileCommands: [{ command: 'Compile P', statusCode: 0, elapsedMs: 2600, outcome: 'STATUS 0' }] };
  assert.deepEqual(extensionCommandLogLines(opSummary), ['Compile P | 2600ms | STATUS 0']);
  assert.deepEqual(extensionCommandLogLines({ compileAttemptLogs: [{ command: 'Compile Q', statusCode: -742, responseMeta: { durationMs: 40 } }] }), ['Compile Q | 40ms | STATUS -742']);
  assert.deepEqual(extensionCommandLogLines(null), []);
});

test('작업 요약: compileAborted·controllerHealth·controllerCheck 가 한 줄 요약에 보인다', () => {
  const s = summarizeOperationResult({
    result: {
      success: false, failedPhase: 'COMPILE', compileErrorCount: 0,
      compileAborted: { reason: 'ECONNRESET', elapsedMs: 22010, outputLines: 0 },
      controllerHealth: { state: 'unresponsive' },
      controllerCheck: { verified: true },
    },
  });
  assert.match(s, /compileAborted ECONNRESET \(22\.0 s, 출력 0줄\)/);
  assert.match(s, /controller unresponsive/);
  assert.match(s, /controllerCheck ok/);
  assert.match(summarizeOperationResult({ result: { success: false, controllerCheck: { verified: false, overridden: false } } }), /controllerCheck unverified/);
});
