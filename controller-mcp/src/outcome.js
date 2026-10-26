// 전송 결과 분류와 도달성 판정 — 순수 로직(네트워크/MCP 무의존, node:test로 검증).
//
// 배경(2026-08-31 실측): `Unload GPL_Code` 가 15 s(GPL_TIMEOUT_MS 기본값) 안에 응답하지 않았고, 그 뒤 약 2.5분간
// 1402 새 연결이 ECONNREFUSED 되다가 **재부팅 없이** 정상 복귀했다(복귀 직후 ErrorLog/Show Thread/Show Memory 모두
// STATUS 0). 그런데 종전 구현은
//   ① 타임아웃을 던져 도구 결과를 `ERROR (...)` 한 줄로 만들었고(→ AI 가 "Unload 실패"로 읽음),
//   ② `ECONNREFUSED` 하나로 '제어기 소프트웨어 다운/재시작 중'을 단정했다.
// 그래서 관측 하나가 "제어기 장애 + 전원 재투입 권고"까지 승격됐다.
//
// 이 모듈의 원칙:
//  - **'실패'와 '결과 미확정'을 구분한다.** 우리가 아는 것은 "정해진 시간 안에 완료 응답을 받지 못했다"뿐이다.
//    sendOutcome: 'not-sent'(전송되지 않음이 확실) / 'unknown'(보냈을 수 있으나 결과 미확인).
//  - **관측(observations)과 추론(assessment)과 확신도(confidence)를 분리한다.** 판정 문장 하나에 섞지 않는다.
//  - **controllerHealth 는 이 모듈만으로 'healthy' 가 되지 않는다.** 살아 있음의 증거는 명령의 `<STATUS>` 응답이고,
//    TCP connect 성공이나 ICMP 응답은 그 증거가 아니다(ai-handoff §0 하드 규칙 2의 취지).
//  - **제어기 다운·전원 재투입 같은 강한 권고를 만들지 않는다.** 여러 독립 증거를 종합해야 하는 판단이다.
//
// 확장 쪽 대응 구현: src/controller/connection/reachability.ts (assessReachability) · src/controller/commands/commandPolicy.ts
// (TRAITS_BY_KIND) · src/controller/connection/connectionHealth.ts (recovering). 목록/근거를 함께 유지할 것.

/** 제어기에 아무것도 보내지 않았음이 확실 — 원인을 해소한 뒤 같은 명령을 다시 보내도 안전하다. */
export const SEND_OUTCOME_NOT_SENT = 'not-sent';
/** 보냈을 수 있으나 완료 응답을 받지 못했다 — 결과 미확정. 상태를 관측하기 전에는 단정 금지. */
export const SEND_OUTCOME_UNKNOWN = 'unknown';

/** 오류에 전송 결과 태그를 붙여 만든다. */
export function taggedError(message, outcome, extra = {}) {
  const err = new Error(message);
  err.sendOutcome = outcome;
  Object.assign(err, extra);
  return err;
}

const NOT_SENT_ERRNO_RE = /^(ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN|ENOTFOUND)$/;

/**
 * 오류 → 전송 결과. 태그(taggedError)가 있으면 그것을 쓰고, 없으면 errno/문구로 추정한다.
 * 연결 자체가 안 됐으면(refused/unreachable) 명령은 전송되지 않았다. 타임아웃·리셋은 도달해 실행됐을 수 있다.
 */
export function sendOutcomeOf(err) {
  if (err?.sendOutcome) return err.sendOutcome;
  const code = typeof err?.code === 'string' ? err.code : '';
  const msg = String(err?.message ?? err ?? '');
  if (NOT_SENT_ERRNO_RE.test(code)) return SEND_OUTCOME_NOT_SENT;
  if (/\b(ECONNREFUSED|EHOSTUNREACH|ENETUNREACH)\b/.test(msg)) return SEND_OUTCOME_NOT_SENT;
  return SEND_OUTCOME_UNKNOWN;
}

/**
 * 채널 교란 가능 명령 — 실행 과정에서 1402 명령 채널이 일시적으로 못 쓰게 될 수 있다.
 * 확장 commandPolicy.ts 의 TRAITS_BY_KIND(mayDisruptChannel: unload/load/compile/start)와 같은 목록으로 유지할 것.
 * Stop 은 넣지 않는다 — 2026-08-31 자료에서 STATUS 0 을 돌려주고 직후 Show Thread 도 정상이었다(근거 없음).
 */
const CHANNEL_DISRUPTIVE_RE = /^\s*(unload|load|compile|start)\b/i;
/** 상태를 바꾸지 않는 조회 명령 — 결과가 미확정이어도 그냥 다시 물어보면 된다. */
const READ_ONLY_RE = /^\s*(show|errorlog|dir|directory|pd|pdx|type|memory)\b/i;
const CLEARS_STATE_RE = /(^|\s)-clear\b/i;

/** 명령의 채널 특성. */
export function commandTraits(command) {
  const c = String(command ?? '');
  const readOnly = READ_ONLY_RE.test(c) && !CLEARS_STATE_RE.test(c);
  return {
    mutability: readOnly ? 'read-only' : 'state-changing',
    mayDisruptChannel: CHANNEL_DISRUPTIVE_RE.test(c),
  };
}

const TIMEOUT_MESSAGE_RE = /timed out|time.?out|타임아웃/i;

/**
 * 전송 실패의 도구 응답. `ok:false` 지만 **`outcome` 이 'not-sent' 인지 'unknown' 인지가 핵심**이다.
 * 'unknown' 에는 note(실패로 단정 금지)와 recommendedAction(무엇을 관측할지)을 함께 싣는다.
 */
export function commandFailureResult(command, err) {
  const outcome = sendOutcomeOf(err);
  const traits = commandTraits(command);
  const message = String(err?.message ?? err);
  const result = { command, ok: false, status: null, outcome, error: message, traits };

  if (['LOW_MEMORY', 'MEMORY_UNVERIFIED'].includes(err?.code)) {
    return { ...result, error: err.code, detail: message, sent: false, precheck: err.precheck,
      recovery: { action: 'FREE_MEMORY', retryCurrentCommand: false },
      recommendedAction: '메모리 상태와 /GPL 잔존 파일을 검토하고 사용자 동의 후 정리할 것. Unload는 수 분간 명령 채널을 막을 수 있다. 자동 재시도하지 말 것.' };
  }

  if (outcome === SEND_OUTCOME_NOT_SENT) {
    result.reason = 'not-sent';
    result.controllerHealth = 'unaffected-by-this-command';
    result.recommendedAction =
      '제어기에 전송되지 않았다 — 원인(정책 보류·배포 잠금·연결 실패·이름 검증)을 해소한 뒤 같은 명령을 다시 보내도 안전하다.';
    return result;
  }

  result.reason = TIMEOUT_MESSAGE_RE.test(message) ? 'command-timeout' : 'send-result-unconfirmed';
  result.controllerHealth = 'unconfirmed';
  result.causalRelation = 'unconfirmed';
  result.note =
    '이 명령이 실패했다는 뜻이 아니다 — 제어기가 실행했을 수도, 실행 중일 수도, 완료했는데 응답만 유실됐을 수도 있다. '
    + '상태를 관측하기 전에는 결과를 단정하지 말 것.';
  result.recommendedAction = traits.mayDisruptChannel
    ? 'wait-and-probe — 이 부류(Unload/Load/Compile/Start)는 실행 중 1402 명령 채널이 일시적으로 사용 불가가 될 수 있다 '
      + '(실측 2026-08-31: Unload 타임아웃 뒤 약 2.5분간 ECONNREFUSED → 재부팅 없이 정상 복귀). '
      + '수 초~수 분 기다린 뒤 show_threads / controller_status 로 관측할 것. '
      + '그 사이의 연결 거부를 제어기 다운의 증거로 쓰지 말 것이며, 같은 명령을 곧바로 재전송하지 말 것.'
    : 'probe-then-decide — show_threads 등 조회로 실제 상태를 확인한 뒤 판단할 것(같은 명령을 곧바로 재전송하지 말 것).';
  return result;
}

// ── 존재하지 않는 명령 기억 (STATUS -714) ─────────────────────────────────
//
// 배경(2026-08-31 개선안 §4·§5): `Show Project` → -714 → `Show Project -all` → -714 → `Show Threads` → …
// 처럼 **표기만 바꿔 추측 재시도**하는 패턴이 반복됐다. 도구가 이미 "추측으로 다른 표기를 재시도하지 말고
// 레퍼런스를 확인할 것"이라고 응답했는데도 같은 행동이 이어졌다(호출당 고정 오버헤드 ≈1.5 s 가 그대로 낭비).
//
// 처리 원칙 — **이미 없다고 증명된 것만 막는다**:
//   · 같은 명령이 이 세션에서 이미 -714 였으면 **전송하지 않고** 캐시된 결과를 즉시 돌려준다(정보 손실 0).
//   · 같은 동사 계열의 다른 표기는 **그대로 보낸다**. 다만 응답에 이미 -714 였던 형제 명령 목록을 실어
//     "이 계열은 추측이 통하지 않는다"는 사실이 보이게 한다. 존재할 수도 있는 명령을 막지는 않는다.
// (확장이 AI 접근을 목록으로 막지 않는다는 원칙과 같다 — 조건을 알려 주되 길을 닫지 않는다.)

/** 존재하지 않는 콘솔 명령 STATUS 코드. */
export const UNKNOWN_COMMAND_STATUS = -714;

/** 비교용 정규화 — 앞뒤 공백 제거, 연속 공백 1칸, 소문자. */
export function normalizeCommandKey(command) {
  return String(command ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 명령의 "계열" — 추측 재시도가 오가는 단위. `show` 계열은 두 번째 낱말까지 보되(`show thread` vs `show memory`),
 * 스위치(`-web`)는 계열에 넣지 않는다. 그 밖에는 첫 낱말.
 */
export function commandFamily(command) {
  const tokens = normalizeCommandKey(command).split(' ').filter((t) => t && !t.startsWith('-'));
  if (tokens.length === 0) return '';
  return tokens[0] === 'show' && tokens[1] ? `show ${tokens[1]}` : tokens[0];
}

export class UnknownCommandMemory {
  constructor() {
    /** @type {Map<string, {command: string, count: number, firstAt: number}>} */
    this._exact = new Map();
    /** @type {Map<string, Set<string>>} */
    this._byFamily = new Map();
  }

  /** STATUS -714 를 받은 명령을 기억한다. */
  note(command) {
    const key = normalizeCommandKey(command);
    if (!key) return;
    const prev = this._exact.get(key);
    this._exact.set(key, prev
      ? { ...prev, count: prev.count + 1 }
      : { command: String(command).trim(), count: 1, firstAt: Date.now() });
    const family = commandFamily(command);
    if (!this._byFamily.has(family)) this._byFamily.set(family, new Set());
    this._byFamily.get(family).add(key);
  }

  /** 이 세션에서 -714 였던 명령 수(진단용). */
  get size() {
    return this._exact.size;
  }

  /**
   * 보내기 전 조회.
   * @returns {{ blocked: true, previous: object, hint: string } | { blocked: false, relatedUnknown: string[] } }
   *   blocked=true 면 전송하지 말고 이 결과를 그대로 돌려준다. relatedUnknown 은 같은 계열에서 이미 -714 였던 표기들.
   */
  check(command) {
    const key = normalizeCommandKey(command);
    const exact = this._exact.get(key);
    if (exact) {
      return {
        blocked: true,
        previous: exact,
        hint: `이 명령은 이 세션에서 이미 STATUS ${UNKNOWN_COMMAND_STATUS}(존재하지 않는 콘솔 명령)였다(${exact.count}회). `
          + '제어기에 다시 보내지 않았다 — 같은 결과가 나온다. 표기를 바꿔 추측하지 말고 '
          + 'docs/reference/console-commands.md 또는 Brooks GPL Dictionary 에서 명령을 확인하거나, '
          + '구조화 도구(show_threads·read_dataids·controller_status)로 목적을 달성할 것.',
      };
    }
    const family = this._byFamily.get(commandFamily(command));
    const relatedUnknown = family
      ? Array.from(family).map((k) => this._exact.get(k)?.command ?? k).filter((c) => normalizeCommandKey(c) !== key)
      : [];
    return { blocked: false, relatedUnknown };
  }

  /** 진단용 — 이 세션에서 -714 였던 명령 전체. */
  list() {
    return Array.from(this._exact.values()).map((e) => ({ command: e.command, count: e.count }));
  }
}

/** blocked 응답을 도구 결과 형태로 — 실제 전송 없이 돌려준다(`sent:false` 로 구분 가능하게). */
export function unknownCommandResult(command, check) {
  return {
    command,
    ok: false,
    sent: false,
    outcome: 'completed',
    status: { code: UNKNOWN_COMMAND_STATUS, message: 'Unknown command (cached — 전송하지 않음)' },
    data: '',
    cached: true,
    previousAttempts: check.previous.count,
    hint: check.hint,
  };
}

// ── 도달성 판정 ────────────────────────────────────────────────────────────

/**
 * 1402 접속 실패의 측정값 → 관측 / 추론 / 확신도. 프로세스를 띄우지 않는다(ping 결과를 인자로 받는다).
 *
 * @param {{ host: string, code?: string, icmpAlive?: boolean|null }} input
 *        code: 오류 errno(ECONNREFUSED/ETIMEDOUT …). icmpAlive: true 응답 / false 무응답 / null 판정 불가.
 * @returns 관측·분류·런타임 상태·권고·사람이 읽는 한 줄.
 */
/**
 * 로컬 PC 에서 `host:port` 로 맺어진 TCP 연결의 소유 프로세스 요약(2026-10-19 Sample Prep ②, §1-EU).
 *
 * 왜: 1402 는 단일 클라이언트다. refused 때 "확장 세션으로 나갔으니 VS Code 점유가 아니다" 라고만 말하면, 다른 창·GDE·
 * 리로드 전 옛 확장 호스트가 ESTABLISHED 로 잡고 있는 경우(17:53 PID 6136 실측)를 배제하는 것처럼 읽힌다.
 * rows 는 OS 조회 결과 `[{pid, process, state, localPort}]`(측정 못 했으면 null 을 넘겨 호출측이 빈 값으로 처리).
 * 이 서버 자신과 살아 있는 확장 인스턴스의 pid 는 "우리 것", 나머지 ESTABLISHED 는 `foreign` 이다.
 */
export function summarizeLocalConnections(rows, { selfPid, extensionPids = [] } = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && Number.isInteger(r.pid)) : [];
  const owners = list.map((r) => ({
    pid: r.pid,
    process: r.process ?? null,
    state: r.state ?? null,
    localPort: r.localPort ?? null,
    owner: r.pid === selfPid ? 'this-mcp' : extensionPids.includes(r.pid) ? 'extension' : 'other',
  }));
  const established = owners.filter((o) => /established/i.test(String(o.state ?? '')));
  const foreign = established.filter((o) => o.owner === 'other');
  const note = foreign.length > 0
    ? `로컬 PID ${foreign.map((f) => `${f.pid}(${f.process ?? '?'})`).join(', ')} 가 이 포트를 ESTABLISHED 로 잡고 있다 — `
      + '명령 콘솔은 단일 클라이언트라 그 연결이 닫혀야 새 연결이 받아들여진다(다른 VS Code 창·GDE·리로드 전 옛 확장 호스트일 수 있다).'
    : null;
  return { measured: Array.isArray(rows), owners, established: established.length, foreign, note };
}

// ── 경로 인터페이스 / 서브넷 겹침 (2026-10-22 Sample Prep 분석 3번 · 2026-10-23 보고) ─────────────
// 확장 src/controller/connection/reachability.ts(splitArpByRoute·findOverlappingSubnets)와 같은 규칙.

/** 제어기 OUI(Precise Automation). */
export const PRECISE_OUI = '00-14-FF';

function ipv4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip ?? '').trim());
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return undefined;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** `address/prefix` 서브넷이 `ip` 를 포함하는가. */
export function subnetContains(address, prefixLength, ip) {
  const a = ipv4ToInt(address);
  const b = ipv4ToInt(ip);
  if (a === undefined || b === undefined || !Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > 32) return false;
  const mask = prefixLength === 32 ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - prefixLength)) >>> 0);
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

function normalizeMac(mac) {
  return String(mac ?? '').trim().toUpperCase().replace(/:/g, '-');
}

/**
 * `Find-NetRoute`·`Get-NetNeighbor`·`Get-NetIPAddress` 묶음 결과 → 경로 관측.
 * @param {string} host
 * @param {{ route?: {interfaceAlias?:string, interfaceIndex?:number, sourceAddress?:string}|null,
 *           neighbors?: Array<{InterfaceAlias?:string, InterfaceIndex?:number, LinkLayerAddress?:string}>,
 *           addresses?: Array<{InterfaceAlias?:string, IPAddress?:string, PrefixLength?:number}> }|null} probe
 * @returns {{ route: 'controller'|'other-device'|'ambiguous', routeInterface: object|null, mac: string|null,
 *             otherAdapterMacs: Array<{mac:string, interfaceAlias:string|null}>, subnetOverlap: string|null } }
 */
export function assessRouteProbe(host, probe) {
  const p = probe && typeof probe === 'object' ? probe : null;
  const route = p?.route && typeof p.route === 'object' ? p.route : null;
  const neighbors = (Array.isArray(p?.neighbors) ? p.neighbors : p?.neighbors ? [p.neighbors] : [])
    .filter((n) => n && n.LinkLayerAddress && !/^0{2}([-:]0{2}){5}$/.test(String(n.LinkLayerAddress)));
  const onRoute = route ? neighbors.filter((n) => (route.interfaceIndex != null && n.InterfaceIndex === route.interfaceIndex)
    || (route.interfaceAlias && n.InterfaceAlias === route.interfaceAlias)) : [];
  const others = route ? neighbors.filter((n) => !onRoute.includes(n)) : neighbors;
  const mac = onRoute.length ? normalizeMac(onRoute[0].LinkLayerAddress) : null;
  const addresses = (Array.isArray(p?.addresses) ? p.addresses : p?.addresses ? [p.addresses] : [])
    .filter((a) => a && typeof a.IPAddress === 'string' && !a.IPAddress.startsWith('127.') && !a.IPAddress.startsWith('169.254.')
      && Number(a.PrefixLength) < 32 && subnetContains(a.IPAddress, Number(a.PrefixLength), host));
  const byIface = new Map();
  for (const a of addresses) if (!byIface.has(a.InterfaceAlias)) byIface.set(a.InterfaceAlias, a);
  const subnetOverlap = byIface.size >= 2
    ? `${host} 이 ${[...byIface.values()].map((a) => `${a.InterfaceAlias}(${a.IPAddress}/${a.PrefixLength})`).join('과 ')} 양쪽 망에 있다 — 한쪽 링크가 끊기면 같은 IP 가 다른 장치로 갈 수 있다.`
    : null;
  return {
    // 경로 인터페이스의 ARP 를 못 보면 종전처럼 'ambiguous'(측정 경로 불명)로 남긴다.
    route: mac ? (mac.startsWith(PRECISE_OUI) ? 'controller' : 'other-device') : 'ambiguous',
    routeInterface: route ? { interfaceAlias: route.interfaceAlias ?? null, interfaceIndex: route.interfaceIndex ?? null, sourceAddress: route.sourceAddress ?? null } : null,
    mac,
    otherAdapterMacs: others.map((n) => ({ mac: normalizeMac(n.LinkLayerAddress), interfaceAlias: n.InterfaceAlias ?? null })),
    subnetOverlap,
  };
}

// ── 명령 콘솔 거부 시 다른 채널로 가르기 (2026-10-23 Sample Prep 보고) ─────────────────────────
// 확장 src/controller/connection/reachability.ts assessGplServices 와 같은 규칙 — 함께 유지할 것.

/** PA 제어기 FTP 220 배너(실측 `220 RTEMS FTP server (Version 1.1-JWJ) ready.`). */
export const PA_FTP_BANNER_RE = /\bRTEMS\s+FTP\s+server\b/i;

/** 실측 조치: PC 어댑터 재연결로 제어기 쪽 명령 콘솔 세션이 풀렸다(2026-10-22 두 번, 재부팅 불필요). */
export const ADAPTER_RECONNECT_GUIDANCE =
  '제어기와 연결된 PC 네트워크 어댑터를 껐다 켜기(물리 링크 재연결) — 제어기 쪽에 남은 명령 콘솔 세션이 이것으로 풀린 실측이 두 번 있다(2026-10-22, 재부팅 불필요).';

/** 채널 교란 명령 뒤 복구 대기 상한(확장 connectionRecoveryWindowMs 기본값과 같다). */
export const RECOVERY_WINDOW_MS = 180_000;

const DISRUPTIVE_RE = /^\s*(unload|compile|load|start)\b/i;

/**
 * 명령 콘솔이 거부됐을 때 FTP 배너·런타임 콘솔 관측으로 상태를 가른다. 거부가 아니거나 관측이 없으면 null.
 * @param {{ code?: string, ftp?: {state: string, banner?: string}|null, runtimeConsole?: string|null,
 *           priorDisruptive?: {command: string, kind?: string, at: number}|null }} input
 */
export function classifyGplServices({ code, ftp, runtimeConsole, priorDisruptive = null }) {
  if (code !== 'ECONNREFUSED' || !ftp) return null;
  const banner = ftp.banner ? String(ftp.banner).split(/\r?\n/)[0].trim() : null;
  const afterDisruptive = !!priorDisruptive && DISRUPTIVE_RE.test(String(priorDisruptive.command ?? ''));
  if (ftp.state !== 'open') {
    return {
      state: 'booting-or-other-device', rebootCandidate: false, confidence: 'medium', ftpBanner: null,
      summary: `FTP 도 ${ftp.state} — 제어기가 부팅 중이거나 이 IP 가 다른 장치일 수 있다.`,
      recommendedAction: 'wait-and-retry — 잠시 뒤 controller_status 로 다시 관측하고, 계속 같으면 사용자에게 제어기 전원·네트워크(경로 인터페이스)를 확인할 것.',
    };
  }
  if (!banner) {
    return {
      state: 'inconclusive', rebootCandidate: false, confidence: 'low', ftpBanner: null,
      summary: 'FTP 는 열렸으나 220 배너를 읽지 못했다 — 상대 장치를 가를 수 없다.',
      recommendedAction: 'wait-and-retry — 잠시 뒤 다시 관측할 것.',
    };
  }
  if (!PA_FTP_BANNER_RE.test(banner)) {
    return {
      state: 'different-device', rebootCandidate: false, confidence: 'high', ftpBanner: banner,
      summary: `FTP 배너가 PA 제어기의 것이 아니다("${banner}") — 같은 IP 의 다른 장치가 응답하고 있다.`,
      recommendedAction: 'ask-user — 경로 인터페이스와 ARP MAC(제어기 00-14-FF)을 확인하게 할 것. 직결 NIC 의 IP·링크 상태를 먼저 볼 일이다.',
    };
  }
  if (runtimeConsole === 'open') {
    return {
      state: 'command-console-held', rebootCandidate: false, confidence: 'medium', ftpBanner: banner,
      summary: 'FTP(RTEMS)와 런타임 콘솔은 열리는데 명령 콘솔만 거부 — 제어기 쪽 명령 콘솔 세션이 아직 잡혀 있을 수 있다(단일 세션).',
      recommendedAction: `wait-and-retry — 채널 교란 명령 뒤라면 수 분 기다린 뒤 다시 관측. 3분이 지나도 같으면 사용자에게 안내: ${ADAPTER_RECONNECT_GUIDANCE}`,
    };
  }
  return {
    state: 'gpl-runtime-network-down', rebootCandidate: true, confidence: afterDisruptive ? 'high' : 'medium', ftpBanner: banner,
    summary: 'FTP 는 PA 제어기(RTEMS 배너)로 살아 있고 명령·런타임 콘솔이 모두 거부 — GPL 런타임의 TCP 서비스가 통째로 내려간 상태로 보인다(재부팅 필요 후보).'
      + (afterDisruptive ? ` 이 세션에서 ${priorDisruptive.command} 가 응답 없이 끝난(${priorDisruptive.kind ?? '?'}) 뒤다.` : ''),
    recommendedAction: `ask-user — 단명 연결 재시도로 기다리지 말 것. 사용자에게 먼저 ${ADAPTER_RECONNECT_GUIDANCE} 그래도 거부되면 재부팅이 필요할 수 있다 — 전원 재투입은 사용자가 판단한다.`,
  };
}

/**
 * 채널 교란 명령(Unload/Compile …)이 응답 없이 끝난 지 복구 창(180 s)이 지났는데도 거부되면 실측 조치를 붙인다.
 * 아니면 null.
 */
export function recoveryGuidanceAfterDisruptive({ code, priorDisruptive, now = Date.now(), windowMs = RECOVERY_WINDOW_MS }) {
  if (code !== 'ECONNREFUSED' || !priorDisruptive || !DISRUPTIVE_RE.test(String(priorDisruptive.command ?? ''))) return null;
  const elapsed = now - priorDisruptive.at;
  if (!(elapsed > windowMs)) return null;
  return `${priorDisruptive.command} 가 응답 없이 끝난 지 ${Math.round(elapsed / 1000)} s — 복구 대기 창(${Math.round(windowMs / 1000)} s)이 지나도 명령 콘솔이 거부된다. `
    + `제어기 쪽 명령 콘솔 세션이 아직 잡혀 있을 수 있다. 사용자에게 안내: ${ADAPTER_RECONNECT_GUIDANCE}`;
}

export function classifyReachability({ host, code, icmpAlive, localConnections = null, routeProbe = null, services = null, priorDisruptive = null, now = Date.now() }) {
  const local = localConnections && typeof localConnections === 'object' ? localConnections : null;
  const routeObs = routeProbe ? assessRouteProbe(host, routeProbe) : null;
  const observations = {
    icmp: icmpAlive === true ? 'reachable' : icmpAlive === false ? 'unreachable' : 'unknown',
    tcp1402: code === 'ECONNREFUSED' ? 'refused' : code === 'ETIMEDOUT' ? 'timeout' : (code ?? 'error'),
    // 경로 인터페이스의 ARP 를 봤으면 그 MAC 으로, 못 봤으면 'ambiguous' — 멀티 NIC 환경에서 같은 IP가 다른 장치일 수 있다(#22 함정).
    route: routeObs ? routeObs.route : 'ambiguous',
    ...(routeObs ? {
      routeInterface: routeObs.routeInterface,
      mac: routeObs.mac,
      otherAdapterMacs: routeObs.otherAdapterMacs,
      ...(routeObs.subnetOverlap ? { subnetOverlap: routeObs.subnetOverlap } : {}),
    } : {}),
    // 명령 콘솔 거부 시 함께 본 FTP(배너)·런타임 콘솔(접속만) — 핸드셰이크만 했다.
    ...(services ? { ftp: services.ftp ?? null, runtimeConsole: services.runtimeConsole ?? null } : {}),
    // 이 PC 에서 같은 제어기 포트로 맺어진 연결(§1-EU). measured:false 면 조회하지 못한 것이지 "없다" 가 아니다.
    localConnections: local
      ? { measured: local.measured !== false, established: local.established, owners: local.owners, foreignOwners: local.foreign }
      : { measured: false, established: 0, owners: [], foreignOwners: [] },
  };

  let state;
  let confidence;
  let alternativeExplanations;
  if (code === 'ECONNREFUSED') {
    state = 'command-channel-unavailable';
    // "지금 새 연결을 만들 수 없다"는 관측 자체는 확실하다(원인이 미확정일 뿐).
    confidence = 'high';
    alternativeExplanations = [
      '채널 교란 가능 명령(Unload/Load/Compile/Start) 뒤의 일시적 사용 불가 — 실측 2026-08-31: 약 2.5분 뒤 재부팅 없이 복귀',
      '제어기 소프트웨어 재시작/부팅 중(1402 서비스 미기동)',
      '제어기 DHCP 임대 상실로 같은 IP의 다른 장치(사무실 게이트웨이)가 RST 를 돌려주는 경우',
    ];
  } else if (icmpAlive === true) {
    state = 'command-channel-unresponsive';
    confidence = 'medium';
    alternativeExplanations = ['부팅 중(ICMP 스택만 기동)', '1402 소켓 점유로 accept 지연', '경로/방화벽이 SYN 을 버림'];
  } else if (icmpAlive === false) {
    state = 'host-unreachable';
    confidence = 'medium';
    alternativeExplanations = ['전원 차단', '네트워크/케이블 단절', '재부팅 초기 단계', 'NIC 가 APIPA 로 떨어져 경로 상실'];
  } else {
    state = 'inconclusive';
    confidence = 'low';
    alternativeExplanations = ['ping 을 실행할 수 없어 호스트 도달성을 측정하지 못함'];
  }

  // 다른 로컬 프로세스가 포트를 잡고 있으면 그것이 1순위 후보다 — 추론 목록 맨 앞과 판정 문장에 넣는다(§1-EU).
  if (local?.note) {
    alternativeExplanations = [local.note, ...alternativeExplanations];
  }
  if (routeObs?.subnetOverlap) {
    alternativeExplanations = [...alternativeExplanations, routeObs.subnetOverlap];
  }
  // 측정 경로가 다른 장치면 판정 자체가 무효일 수 있다(확장 assessReachability 와 같은 규칙).
  if (routeObs && routeObs.route === 'other-device') {
    confidence = confidence === 'high' ? 'medium' : 'low';
    alternativeExplanations = [...alternativeExplanations, `경로 인터페이스(${routeObs.routeInterface?.interfaceAlias ?? '?'})의 ARP MAC ${routeObs.mac} 이 제어기(${PRECISE_OUI})가 아니다 — 판정 자체가 무효일 수 있다`];
  }

  // 명령 콘솔 거부 → FTP·런타임 콘솔로 가른 상태(2026-10-23). 가르면 그것이 판정 상태가 된다.
  const svc = classifyGplServices({ code, ftp: services?.ftp ?? null, runtimeConsole: services?.runtimeConsole ?? null, priorDisruptive });
  if (svc) {
    alternativeExplanations = [svc.summary, ...alternativeExplanations];
    if (svc.state !== 'inconclusive') {
      state = svc.state;
      confidence = svc.confidence;
    }
  }
  const guidance = recoveryGuidanceAfterDisruptive({ code, priorDisruptive, now });

  const localNote = local?.note ? ` ${local.note}` : '';
  const routeNote = routeObs?.routeInterface?.interfaceAlias
    ? ` 경로 인터페이스: ${routeObs.routeInterface.interfaceAlias}${routeObs.routeInterface.sourceAddress ? `(${routeObs.routeInterface.sourceAddress})` : ''}${routeObs.mac ? `, MAC ${routeObs.mac}` : ''}.`
    : '';
  const baseVerdict = state === 'command-channel-unavailable'
    ? `${host}:1402 새 연결이 거부됨(refused) — 지금 명령 채널을 열 수 없다는 관측이다. 제어기 런타임 상태는 이것만으로 확정할 수 없다.${localNote}`
    : state === 'command-channel-unresponsive'
      ? 'ICMP는 응답하나 1402 TCP가 실패 — 부팅 중(서비스 미기동)·소켓 점유·경로 차단 가능. 런타임 상태 미확정.'
      : state === 'host-unreachable'
        ? 'ICMP·TCP 모두 무응답 — 호스트에 도달하지 못했다는 관측. 전원·네트워크·재부팅 초기 단계 중 어느 것인지는 구분되지 않는다.'
        : svc && svc.state === state
          ? `${host}:1402 새 연결이 거부됨(refused). ${svc.summary}${localNote}`
          : 'ICMP 판정 불가(ping 미지원) — TCP 실패만 확인됨.';
  const verdict = `${baseVerdict}${routeNote}${guidance ? ` ${guidance}` : ''}`;

  return {
    observations,
    assessment: {
      state, confidence, alternativeExplanations, controllerCrashConfirmed: false,
      ...(svc ? { services: svc, rebootCandidate: svc.rebootCandidate } : {}),
    },
    controllerHealth: state === 'host-unreachable'
      ? { state: 'unreachable', reason: 'ICMP·TCP 모두 무응답 — 호스트에 도달하지 못했다. 런타임 상태는 측정 불가.' }
      : { state: 'unconfirmed', reason: '1402 도달성만으로는 GPL 런타임 상태를 판정할 수 없다 — 살아 있음의 증거는 명령의 <STATUS> 응답이다.' },
    recommendedAction: svc && svc.state !== 'inconclusive'
      ? svc.recommendedAction
      : guidance
        ? `ask-user — ${guidance}`
        : state === 'command-channel-unavailable'
          ? 'wait-and-retry — 수 초~수 분 뒤 controller_status 를 다시 호출해 볼 것. 전원 재투입·재부팅을 권고하기 전에 사용자에게 실제 제어기 상태를 확인할 것.'
          : 'ask-user — 사용자에게 제어기 전원·네트워크 상태를 확인할 것. 이 서버의 관측만으로는 원인을 확정할 수 없다.',
    verdict,
  };
}

// ── Compile 이 소켓 리셋으로 끊김 (2026-10-22 22:01 KST 사고) ─────────────────────────────
// 확장 src/controller/deployment/compileAbort.ts classifyCompileAbort 와 같은 규칙(전송 실패 쪽).

export const COMPILE_ABORT_HINT = '제어기가 컴파일 중 연결을 끊음 — 명령 콘솔 생존 확인 필요';

/**
 * Compile 전송 실패 → compileAborted. 리셋/끊김(ECONNRESET·EPIPE·ECONNABORTED·연결 종료)만 해당하고
 * 타임아웃·연결 거부(보내지도 못함)는 null.
 */
export function classifyCompileAbortError(command, err, elapsedMs) {
  const code = typeof err?.code === 'string' ? err.code : '';
  const msg = String(err?.message ?? err ?? '');
  const token = /\b(ECONNRESET|EPIPE|ECONNABORTED)\b/.exec(`${code} ${msg}`)?.[1]
    ?? (/closed without response|ECONNCLOSED|socket hang up/i.test(`${code} ${msg}`) ? 'ECONNCLOSED' : null);
  if (!token) return null;
  return { reason: token, command, elapsedMs: Math.max(0, Number(elapsedMs) || 0), outputLines: 0, hint: COMPILE_ABORT_HINT };
}

/** 생존 확인(`Show Thread -web`) 결과 → controllerHealth. raw 에 STATUS 가 있으면 응답함. */
export function livenessFromProbe(probe, { raw = null, error = null, at = Date.now() } = {}) {
  const ok = typeof raw === 'string' && raw.includes('<STATUS>');
  return {
    state: ok ? 'responsive' : 'unresponsive',
    probe,
    detail: ok ? '명령 콘솔이 STATUS 로 응답함' : String(error?.message ?? error ?? 'STATUS 없음'),
    checkedAt: new Date(at).toISOString(),
  };
}
