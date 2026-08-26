import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatus,
  extractData,
  parseCompileErrors,
  parseThreadList,
  parseThreadDetail,
  normalizeThreadState,
  PAUSED_STATES,
  statusHint,
  isSuccess,
  compactThread,
  summarizeThreads,
  parseShowVariable,
  isTypeToken,
  splitVarLine,
  parseDataIdResponse,
  splitOutsideQuotes,
  parseResourceProbes,
  acceptedRate,
} from '../src/parse.js';

test('parseStatus: success', () => {
  const s = parseStatus('<DATA>ok</DATA><STATUS>0,"Success"</STATUS>');
  assert.equal(s.code, 0);
  assert.equal(s.complete, true);
  assert.equal(isSuccess(s), true);
});

test('parseStatus: compile-error status', () => {
  const s = parseStatus('<STATUS>-742,"*Compilation errors*"</STATUS>');
  assert.equal(s.code, -742);
  assert.equal(isSuccess(s), false);
});

test('parseStatus: missing -> -9999 sentinel', () => {
  const s = parseStatus('no status here');
  assert.equal(s.code, -9999);
  assert.equal(s.complete, false);
  assert.equal(isSuccess(s), false);
});

test('extractData: pulls DATA body', () => {
  assert.equal(extractData('<DATA> hello </DATA><STATUS>0,"Success"</STATUS>'), 'hello');
});

test('parseCompileErrors: separates errors from -742 aggregate', () => {
  const raw = [
    'Compile Project: MergeCode',
    'ProtocolModule.gpl:477:(-730): *Invalid symbol type*',
    'ProtocolModule.gpl:478:(-760): *Invalid assignment*',
    'ProtocolModule.gpl:2934:(-742): *Compilation errors*: 4',
    '<STATUS>-742,"*Compilation errors*"</STATUS>',
  ].join('\n');
  const { errors, aggregate } = parseCompileErrors(raw);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].code, -730);
  assert.equal(errors[0].line, 477);
  assert.equal(errors[1].code, -760);
  assert.ok(aggregate);
  assert.equal(aggregate.count, 4);
});

test('parseThreadDetail: comma format with location', () => {
  const raw = [
    '<DATA>',
    'GPL_Code, Paused',
    '0, ""',
    'GPL_Code, MAIN, 2, Entry_Main.gpl, 6',
    '</DATA><STATUS>0,"Success"</STATUS>',
  ].join('\n');
  const d = parseThreadDetail(raw);
  assert.ok(d);
  assert.equal(d.name, 'GPL_Code');
  assert.equal(d.state, 'Paused');
  assert.equal(d.file, 'Entry_Main.gpl');
  assert.equal(d.fileLine, 6);
  assert.equal(d.process, 'MAIN');
  assert.ok(PAUSED_STATES.has(d.state));
});

test('parseThreadDetail: empty payload -> null', () => {
  assert.equal(parseThreadDetail('<DATA></DATA><STATUS>0,"Success"</STATUS>'), null);
});

test('normalizeThreadState: Stopped is not misread as Stopping', () => {
  assert.equal(normalizeThreadState('Stopped'), 'Stopped');
  assert.equal(normalizeThreadState('Stopping'), 'Stopping');
  assert.equal(normalizeThreadState('paused'), 'Paused');
  assert.equal(normalizeThreadState('Break_pt'), 'Break');
  assert.equal(PAUSED_STATES.has(normalizeThreadState('Running')), false);
});

test('statusHint: known codes get actionable guidance, unknown -> undefined', () => {
  assert.match(statusHint(-780), /프로퍼티\/메서드/);
  assert.match(statusHint(-729), /프레임 스코프/);
  assert.match(statusHint(-714), /console-commands\.md/);
  assert.match(statusHint(-9999), /성공으로 간주하지 말/);
  assert.equal(statusHint(0), undefined);
  assert.equal(statusHint(-12345), undefined);
});

// `Show Thread -web` 9열: name| state| code| "msg"| project| func| procLine| file| fileLine (런북 "GDE 1402 실측 명령 포맷")
const WEB_THREADS = [
  '<DATA>',
  'Name|State|Code|Msg|Project|Func|ProcLine|File|FileLine',
  'OpCommandRunThread1| Paused| 0| ""| MergeCode| RNDRobot.armRetract| 12| RobotModule.gpl| 1597',
  '----|-----|-------',
  'JogCommandRunThread| Running| 0| ""| MergeCode| JogModule.run| 3| JogModule.gpl| 40',
  'IdleThread| Idle| 0| ""| MergeCode| | 0| | 0',
  'ErrThread| Error| -1012| "*Some error*"| MergeCode| M.f| 1| M.gpl| 7',
  '</DATA><STATUS>0,"Success"</STATUS>',
].join('\n');

test('parseThreadList: pipe (-web) format → named keys, skips header/divider', () => {
  const { threads } = parseThreadList(WEB_THREADS);
  assert.equal(threads.length, 4);
  assert.deepEqual(threads.map((t) => t.name), ['OpCommandRunThread1', 'JogCommandRunThread', 'IdleThread', 'ErrThread']);
  const t0 = threads[0];
  assert.equal(t0.state, 'Paused');
  assert.equal(t0.project, 'MergeCode');
  assert.equal(t0.procedure, 'RNDRobot.armRetract');
  assert.equal(t0.procLine, 12);
  assert.equal(t0.file, 'RobotModule.gpl');
  assert.equal(t0.line, 1597);
  assert.equal(threads[3].statusCode, -1012);
  assert.equal(threads[3].statusMessage, '*Some error*'); // 따옴표 제거
  assert.ok(Array.isArray(t0.fields) && typeof t0.raw === 'string'); // verbose용 원문 유지
});

test('compactThread: raw/fields/빈 값 제거 — 정지 스레드는 위치 포함', () => {
  const { threads } = parseThreadList(WEB_THREADS);
  assert.deepEqual(compactThread(threads[0]), {
    name: 'OpCommandRunThread1', state: 'Paused', project: 'MergeCode', procedure: 'RNDRobot.armRetract',
    file: 'RobotModule.gpl', line: 1597, procLine: 12,
  });
  assert.deepEqual(compactThread(threads[2]), { name: 'IdleThread', state: 'Idle', project: 'MergeCode' });
  assert.equal(JSON.stringify(compactThread(threads[0])).includes('"raw"'), false);
});

test('summarizeThreads: 상태별 개수 + 정지 스레드 위치', () => {
  const { threads } = parseThreadList(WEB_THREADS);
  const s = summarizeThreads(threads);
  assert.equal(s.total, 4);
  assert.equal(s.paused, 1);
  assert.equal(s.running, 1);
  assert.equal(s.idle, 1);
  assert.equal(s.error, 1);
  assert.deepEqual(s.pausedThreads.map((t) => t.name), ['OpCommandRunThread1', 'ErrThread']);
  assert.equal(s.pausedThreads[0].line, 1597);
});

test('parseShowVariable: 단순값/객체 덤프/배열 헤더/에러 응답', () => {
  const simple = parseShowVariable('<DATA>curHand, Integer, 1</DATA><STATUS>0,"Success"</STATUS>');
  assert.deepEqual(simple, { name: 'curHand', type: 'Integer', value: '1', kind: 'simple', members: [] });
  const obj = parseShowVariable('<DATA>cmd, Object Command\ncmd.m_cmd, String, "get"\ncmd.m_rawArg, String, "7,6"</DATA><STATUS>0,"Success"</STATUS>');
  assert.equal(obj.kind, 'object');
  assert.equal(obj.members.length, 2);
  assert.equal(obj.members[1].value, '"7,6"'); // 값 속 쉼표 보존
  const arr = parseShowVariable('<DATA>buf, Double(,)</DATA><STATUS>0,"Success"</STATUS>');
  assert.equal(arr.kind, 'array');
  assert.equal(parseShowVariable('<DATA></DATA>\n<STATUS>-780,"*Unsupported procedure reference*"</STATUS>'), null);
});

test('parseShowVariable: 시스템 Location 덤프의 2열 멤버(name, value)+주석 값 (GitHub #27 실측)', () => {
  const raw = [
    '<DATA>Robot.Where(1), Object Location',
    'Robot.Where(1).Type, 0 = Cartesian',
    'Robot.Where(1).Config, 1  = Righty',
    'Robot.Where(1).X, 636',
    'Robot.Where(1).RefFrame, Null',
    'Robot.Where(1).ZClearance, 1E+32',
    '</DATA><STATUS>0,"Success"</STATUS>',
  ].join('\n');
  const loc = parseShowVariable(raw);
  assert.equal(loc.kind, 'object');
  assert.equal(loc.type, 'Object Location');
  const by = (leaf) => loc.members.find((m) => m.name.endsWith(`.${leaf}`));
  assert.deepEqual(by('X'), { name: 'Robot.Where(1).X', type: '', value: '636' });
  assert.equal(by('Type').value, '0 = Cartesian');
  assert.equal(by('RefFrame').value, 'null');
  assert.equal(isTypeToken('Object Location'), true);
  assert.equal(isTypeToken('636'), false);
  assert.deepEqual(splitVarLine('arr(0,1), Double(,), 30.5', 3), ['arr(0,1)', 'Double(,)', '30.5']);
});

test('statusHint: -712/-762/-763 추가', () => {
  assert.match(statusHint(-712), /Me\./);
  assert.match(statusHint(-762), /Angles/);
  assert.match(statusHint(-763), /Cartesian/);
});

// ── DataID(pd) 응답 파싱 (GitHub #16) ──────────────────────────────────────────

test('parseDataIdResponse: 실측 형식(#16 본문) — id/meta/description/values, 설명 속 콤마·괄호 견고', () => {
  const raw = '<DATA>2703, 1, 1, 0, "100% Cartesian accels in (mm or deg)/sec^2" = 1200, 400, 2400</DATA><STATUS>0,"Success"</STATUS>';
  const d = parseDataIdResponse(raw);
  assert.equal(d.id, 2703);
  assert.deepEqual(d.meta, [1, 1, 0]);
  assert.equal(d.description, '100% Cartesian accels in (mm or deg)/sec^2');
  assert.deepEqual(d.values, ['1200', '400', '2400']);
  assert.equal(d.raw, '2703, 1, 1, 0, "100% Cartesian accels in (mm or deg)/sec^2" = 1200, 400, 2400');
  // runCommand의 data(래퍼 없음)도 같은 결과
  assert.deepEqual(parseDataIdResponse('2703, 1, 1, 0, "100% Cartesian accels in (mm or deg)/sec^2" = 1200, 400, 0').values, ['1200', '400', '0']);
});

test('parseDataIdResponse: 문자열 값(따옴표 유지, 내부 콤마/= 보존)·값 없음·음수 meta', () => {
  const s = parseDataIdResponse('1700, -1, 0, 0, "Robot type, name = label" = "PreciseFlex 400, rev B", "x=1"');
  assert.equal(s.id, 1700);
  assert.deepEqual(s.meta, [-1, 0, 0]);
  assert.equal(s.description, 'Robot type, name = label');
  assert.deepEqual(s.values, ['"PreciseFlex 400, rev B"', '"x=1"']);
  const empty = parseDataIdResponse('2704, 0, 0, 0, "Max %speed allowed" = ');
  assert.deepEqual(empty.values, []);
  assert.equal(empty.description, 'Max %speed allowed');
  const noEq = parseDataIdResponse('2704, 0, 0, 0, "Max %speed allowed"');
  assert.deepEqual(noEq.values, []);
});

test('parseDataIdResponse: 값 목록 다중 줄 wrap(콤마 뒤 줄바꿈+들여쓰기) 이어 붙임, CRLF 허용', () => {
  const wrapped = '10123, 0, 0, 0, "Hardstop pos steady tolerance, mcnt" = 0, 0,\r\n     0, 0, 0, 0\r\n';
  const d = parseDataIdResponse(wrapped);
  assert.equal(d.id, 10123);
  assert.equal(d.description, 'Hardstop pos steady tolerance, mcnt');
  assert.deepEqual(d.values, ['0', '0', '0', '0', '0', '0']);
  const trailingComma = parseDataIdResponse('2703, 1, 1, 0, "d" = 1200, 400,\n     ');
  assert.deepEqual(trailingComma.values, ['1200', '400']); // 꼬리 빈 토큰만 제거
});

test('parseDataIdResponse: 파싱 실패(id 없음/빈 본문/에러 응답) → null', () => {
  assert.equal(parseDataIdResponse('<DATA></DATA><STATUS>-505,"*Missing argument*"</STATUS>'), null);
  assert.equal(parseDataIdResponse('*Invalid DataID*'), null);
  assert.equal(parseDataIdResponse(''), null);
});

test('splitOutsideQuotes: 따옴표 안 콤마/괄호, "" 이스케이프, 괄호 깊이', () => {
  assert.deepEqual(splitOutsideQuotes('a, "b, c", (d, e), "f ""g"", h"'), ['a', '"b, c"', '(d, e)', '"f ""g"", h"']); // 토큰은 원문 유지("" 해제는 parseDataIdResponse의 description에서)
  assert.deepEqual(splitOutsideQuotes(''), []);
  assert.deepEqual(splitOutsideQuotes('  1200 ,400,  2400  '), ['1200', '400', '2400']);
});

// ── 자원 프로브 (GitHub #22) ─────────────────────────────────────────────────────
// 실측 원문(2026-08-25, GPL 4.2K5 — Claude 세션의 도구 응답에서 채록)
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
// 이슈 #22 댓글의 요약 표기(순서/공백/콜론이 다른 변형)
const MEMORY_SUMMARY = 'Free 3.6557 Mb, Used 7.9903 Mb, Segments 49939';
const TCP_SUMMARY = 'connections accepted 10, established 10, closed 19';
const MBUF_SUMMARY = 'mbufs 3072 (free 2778, data 292, header 2) clusters 512, free 223 / drops 0, waits 0, drains 0';

test('parseResourceProbes: 실측 원문 — memory/tcp/mbuf 구조화 + raw 동봉', () => {
  const r = parseResourceProbes({ memory: MEMORY_REAL, tcp: TCP_REAL, mbuf: MBUF_REAL });
  assert.deepEqual(r.memory, { freeMb: 3.6557, usedMb: 7.9903, segments: 49939, freeSegments: 35, usedSegments: 49939 });
  assert.deepEqual(r.tcp, { accepted: 13213, established: 13212, dropped: 13, closed: 13836 });
  assert.deepEqual(r.mbuf, { total: 3072, free: 2725, data: 292, header: 55, clusters: 512, clustersFree: 223, drops: 0, waits: 0, drains: 0 });
  assert.equal(r.raw.memory, MEMORY_REAL);
  assert.equal(r.raw.tcp, TCP_REAL);
  assert.equal(r.raw.mbuf, MBUF_REAL);
});

test('parseResourceProbes: 요약 표기 변형(콜론 없음·한 줄·순서 다름)도 같은 값', () => {
  const r = parseResourceProbes({ memory: MEMORY_SUMMARY, tcp: TCP_SUMMARY, mbuf: MBUF_SUMMARY });
  assert.equal(r.memory.freeMb, 3.6557);
  assert.equal(r.memory.usedMb, 7.9903);
  assert.equal(r.memory.segments, 49939);
  assert.equal(r.memory.freeSegments, null); // 한 줄에 Free/Used가 함께 → 어느 쪽인지 단정하지 않음
  assert.equal(r.memory.usedSegments, null);
  assert.deepEqual(r.tcp, { accepted: 10, established: 10, dropped: null, closed: 19 });
  assert.deepEqual(r.mbuf, { total: 3072, free: 2778, data: 292, header: 2, clusters: 512, clustersFree: 223, drops: 0, waits: 0, drains: 0 });
});

test('parseResourceProbes: 대소문자/공백 변형, 천 단위 콤마, 매칭 실패 필드 null, 텍스트 없음은 항목 null', () => {
  const r = parseResourceProbes({
    memory: 'MAIN MEMORY:\n  USED : 8.2325 MB , SEGMENTS : 51691\n  FREE : 3.4135 MB , SEGMENTS : 1062',
    tcp: 'Connections Accepted  3,144\nconnections established 3,100',
    mbuf: null,
  });
  assert.deepEqual(r.memory, { freeMb: 3.4135, usedMb: 8.2325, segments: 51691, freeSegments: 1062, usedSegments: 51691 });
  assert.deepEqual(r.tcp, { accepted: 3144, established: 3100, dropped: null, closed: null });
  assert.equal(r.mbuf, null);
  assert.equal(r.raw.mbuf, null);
  const garbage = parseResourceProbes({ memory: 'Unknown command', tcp: '', mbuf: '   ' });
  assert.deepEqual(garbage.memory, { freeMb: null, usedMb: null, segments: null, freeSegments: null, usedSegments: null });
  assert.equal(garbage.tcp, null);
  assert.equal(garbage.mbuf, null);
});

test('acceptedRate: 첫 호출 null, 증가율(건/초) 계산, 카운터 감소(재부팅)·경과 0 → null', () => {
  assert.equal(acceptedRate(null, { accepted: 100, at: 1000 }), null);
  assert.equal(acceptedRate({ accepted: 100, at: 0 }, { accepted: 250, at: 10_000 }), 15);
  assert.equal(acceptedRate({ accepted: 3144, at: 0 }, { accepted: 3965, at: 180_000 }), 4.56); // #22 표: 3분간 821건
  assert.equal(acceptedRate({ accepted: 9216, at: 0 }, { accepted: 12, at: 60_000 }), null); // 재부팅으로 리셋
  assert.equal(acceptedRate({ accepted: 1, at: 5 }, { accepted: 2, at: 5 }), null);
  assert.equal(acceptedRate({ accepted: null, at: 0 }, { accepted: 2, at: 5 }), null);
});
