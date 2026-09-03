/**
 * 제어기 도달성 진단 (vscode 무의존) — GitHub #22 "사후 진단 함정" 대응.
 *
 * 1402 연결 실패의 원인을 ICMP / TCP / ARP 세 축으로 갈라 한국어 판정 문장을 만든다
 * (controller-mcp index.js probeReachability의 4분류 + TTL/MAC 힌트).
 *
 * 함정(#22 댓글 2026-08-25): PC에 제어기 직결 NIC(IP를 제어기 DHCP에서 임대)와 사무실 LAN NIC(게이트웨이·DHCP 서버도
 * 192.168.0.1, MAC D8-43-AE Micro-Star)가 공존한다. 제어기가 죽어 임대를 갱신하지 못하면 직결 NIC가 APIPA로 떨어지고
 * 그 순간부터 192.168.0.1 트래픽은 사무실 게이트웨이로 흘러간다 → ping은 TTL=64로 응답하고 1402는 REFUSED.
 * 이걸 "제어기가 살아 있는데 서비스만 죽었다"로 오판하기 쉽다. 그래서 ping TTL(제어기 255 / 게이트웨이 64)과
 * ARP MAC(00-14-FF = Precise Automation)을 함께 기록하고, 판정 문장에 응답 장치 정체 힌트를 붙인다.
 *
 * 순수 파서(parsePingOutput / parseArpOutput / classifyTcpError / identifyResponder / assessReachability /
 * describeReachability)는 테스트 대상이고, 프로세스를 띄우는 함수(pingHost / arpLookup)와 소켓 함수(tcpProbe)는 얇은 래퍼다.
 *
 * 관측과 추론의 분리 (2026-08-31):
 *  - 종전 판정 문장은 관측과 추론을 한 문장에 섞었다: `'호스트는 살아 있으나 1402 서비스가 닫혀 있다(제어기
 *    소프트웨어 다운/재시작 중).'` — 앞은 관측이지만 괄호 안은 **여러 설명 중 하나**다. 실측 2026-08-31: 채널
 *    교란 가능 명령(Unload) 뒤 약 2.5분간 refused 였다가 재부팅 없이 복귀했다. 즉 refused 하나로는 제어기 런타임
 *    상태를 확정할 수 없다.
 *  - 그래서 assessReachability() 가 `observations`(측정값) / `assessment`(분류 + 확신도 + 다른 설명들) /
 *    `controllerHealth`(런타임 상태 — 이 프로브만으로는 절대 'healthy' 가 되지 않는다. STATUS 응답이 있어야 확정)를
 *    나눠 돌려준다. 사람이 읽는 describeReachability() 도 추론을 "가능한 설명"으로만 적는다.
 *  - 제어기 다운·전원 재투입 같은 강한 권고는 이 모듈이 만들지 않는다 — 여러 독립 증거를 종합하는 판단이다.
 */

import { execFile } from 'child_process';
import * as net from 'net';

export interface PingResult {
    /** true 응답 있음 / false 무응답·도달 불가 / null 판정 불가(ping 미설치 등). */
    alive: boolean | null;
    /** 응답 패킷의 TTL. 제어기(PA 스택) 255, 일반 리눅스 게이트웨이 64, Windows 128. */
    ttl?: number;
    /** 프로세스 실행에 걸린 전체 시간(ms). */
    ms: number;
    /** ping이 보고한 왕복 시간(ms). "<1ms"는 1로 기록. */
    rttMs?: number;
    /** 무응답의 세부: 'destination-host-unreachable' | 'request-timed-out' 등(감지된 경우만). */
    detail?: string;
}

export type TcpProbeResult = 'open' | 'refused' | 'timeout' | 'unreachable' | 'error';

export interface ArpEntry {
    ip: string;
    /** 정규화된 MAC (`XX-XX-XX-XX-XX-XX`, 대문자). */
    mac: string;
    /** Windows: 해당 인터페이스의 IP / Linux: 장치명(eth0 등). 없으면 undefined. */
    iface?: string;
}

export interface ArpLookupResult {
    /** 첫 항목의 MAC(정규화). 항목이 없으면 undefined. */
    mac?: string;
    /** OUI 기반 벤더 힌트(알려진 접두만). */
    vendorHint?: string;
    /** 인터페이스별 전체 항목 — 두 NIC가 같은 IP를 서로 다른 MAC으로 알고 있으면 여기서 드러난다. */
    entries: ArpEntry[];
}

export interface ReachabilityInput {
    ip: string;
    tcp1402: TcpProbeResult;
    icmp: PingResult;
    arp: ArpLookupResult;
}

export interface ReachabilityReport extends ReachabilityInput {
    port: number;
    /** 사람이 읽는 한 줄(관측 우선). 기계 판정은 `assessment` 를 볼 것. */
    verdict: string;
    /** 구조화 판정 - 관측 / 분류+확신도 / 런타임 상태(미확정 여부). */
    assessment: ReachabilityAssessment;
}

/** OUI(MAC 상위 3바이트) → 벤더 힌트. #22 실측 두 건만 등재(확장 시 여기에 추가). */
export const KNOWN_OUI: Readonly<Record<string, string>> = {
    '00-14-FF': 'Precise Automation',
    'D8-43-AE': 'Micro-Star(사무실 게이트웨이 의심)',
};

export const PRECISE_OUI = '00-14-FF';
/** PA 제어기 TCP/IP 스택의 ping 응답 TTL(#22 실측 2026-08-25). */
export const CONTROLLER_TTL = 255;

const MAC_RE = /\b((?:[0-9a-f]{2}[-:]){5}[0-9a-f]{2})\b/i;

// ── 순수 파서 ──────────────────────────────────────────────────────────────

/** MAC을 `XX-XX-XX-XX-XX-XX`(대문자, 하이픈)로 정규화. 형식이 아니면 원문 대문자. */
export function normalizeMac(mac: string): string {
    const m = mac.trim().match(MAC_RE);
    return (m ? m[1] : mac.trim()).toUpperCase().replace(/:/g, '-');
}

export function ouiOf(mac: string): string {
    return normalizeMac(mac).slice(0, 8);
}

export function vendorHintFor(mac: string | undefined): string | undefined {
    return mac ? KNOWN_OUI[ouiOf(mac)] : undefined;
}

/**
 * ping 1회 출력 파싱. Windows 영문/한국어, Linux 모두 `TTL=`/`ttl=` 토큰으로 판정한다
 * (Windows ping은 "Destination host unreachable"에도 종료코드 0이라 종료코드를 믿을 수 없다).
 */
export function parsePingOutput(text: string): { alive: boolean; ttl?: number; rttMs?: number; detail?: string } {
    const out = text ?? '';
    const ttlMatch = out.match(/\bTTL[=:]\s*(\d+)/i);
    if (ttlMatch) {
        const ttl = Number(ttlMatch[1]);
        // "time<1ms" / "time=0.312 ms" / "시간<1ms" / "시간=2ms"
        const rtt = out.match(/(?:\btime|시간)\s*[=<]\s*([\d.]+)\s*ms/i);
        return { alive: true, ttl, rttMs: rtt ? Number(rtt[1]) : undefined };
    }
    if (/destination host unreachable|대상 호스트에 연결할 수 없습니다|Destination Net Unreachable|Host Unreachable/i.test(out)) {
        return { alive: false, detail: 'destination-host-unreachable' };
    }
    if (/request timed out|요청 시간이 만료되었습니다|100% packet loss|100% 손실/i.test(out)) {
        return { alive: false, detail: 'request-timed-out' };
    }
    if (/could not find host|호스트 .*찾을 수 없습니다|Name or service not known|unknown host/i.test(out)) {
        return { alive: false, detail: 'unknown-host' };
    }
    return { alive: false };
}

/**
 * `arp -a <host>`(Windows) / `ip neigh show <host>` / `arp -n <host>`(Linux) 출력에서 host의 항목을 모두 뽑는다.
 * Windows는 인터페이스 헤더(`Interface: 192.168.0.124 --- 0x15` / `인터페이스: ...`)마다 항목이 반복될 수 있다.
 */
export function parseArpOutput(text: string, host: string): ArpEntry[] {
    const entries: ArpEntry[] = [];
    const hostRe = new RegExp(`(^|\\s)${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    let currentIface: string | undefined;
    for (const rawLine of (text ?? '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) { continue; }
        const ifaceHeader = line.match(/^(?:Interface|인터페이스)\s*:\s*(\d+\.\d+\.\d+\.\d+)/i);
        if (ifaceHeader) {
            currentIface = ifaceHeader[1];
            continue;
        }
        if (!hostRe.test(line)) { continue; }
        const mac = line.match(MAC_RE);
        if (!mac) { continue; }
        let iface = currentIface;
        const dev = line.match(/\bdev\s+(\S+)/);
        if (dev) {
            iface = dev[1];
        } else if (/\bether\b/i.test(line)) {
            // `arp -n`: "192.168.0.1  ether  00:14:ff:...  C  eth0" — 마지막 토큰이 장치명
            const tokens = line.split(/\s+/);
            iface = tokens[tokens.length - 1];
        }
        entries.push({ ip: host, mac: normalizeMac(mac[1]), iface });
    }
    return entries;
}

export function classifyTcpError(code: string | undefined): TcpProbeResult {
    switch (code) {
        case 'ECONNREFUSED': return 'refused';
        case 'ETIMEDOUT': return 'timeout';
        case 'EHOSTUNREACH':
        case 'ENETUNREACH':
        case 'EHOSTDOWN':
        case 'ENETDOWN':
            return 'unreachable';
        default: return 'error';
    }
}

export type ResponderKind = 'controller' | 'other-device' | 'unknown';

/**
 * ping TTL과 ARP MAC으로 "누가 응답했는가"를 가른다.
 * - controller: MAC이 Precise(00-14-FF)이거나, MAC 정보 없이 TTL=255.
 * - other-device: MAC이 Precise가 아닌 것으로 확인되거나, TTL이 255가 아닌 값(64=리눅스 게이트웨이, 128=Windows).
 * - unknown: 판단 재료 없음.
 */
export function identifyResponder(icmp: Pick<PingResult, 'ttl'>, arp: Pick<ArpLookupResult, 'mac' | 'entries'>): { kind: ResponderKind; detail: string } {
    const macs = Array.from(new Set((arp.entries ?? []).map(e => e.mac).concat(arp.mac ? [arp.mac] : [])));
    const preciseMacs = macs.filter(m => ouiOf(m) === PRECISE_OUI);
    const otherMacs = macs.filter(m => ouiOf(m) !== PRECISE_OUI);
    const parts: string[] = [];
    if (icmp.ttl !== undefined) { parts.push(`TTL=${icmp.ttl}`); }
    for (const m of macs) {
        const v = vendorHintFor(m);
        parts.push(`MAC ${m}${v ? ` (${v})` : ''}`);
    }
    const detail = parts.join(', ');

    if (macs.length > 1) {
        // 두 NIC(제어기 직결 + 사무실 LAN)가 같은 IP를 다른 MAC으로 알고 있는 상태 — 어느 경로로 나갔는지 불명.
        return { kind: otherMacs.length && !preciseMacs.length ? 'other-device' : 'unknown', detail: `${detail} — 인터페이스별 MAC이 서로 다름(어느 경로가 쓰였는지 확인 필요)` };
    }
    if (preciseMacs.length) {
        return icmp.ttl !== undefined && icmp.ttl !== CONTROLLER_TTL
            ? { kind: 'unknown', detail: `${detail} — MAC은 제어기인데 TTL이 ${CONTROLLER_TTL}이 아님` }
            : { kind: 'controller', detail };
    }
    if (otherMacs.length) { return { kind: 'other-device', detail }; }
    if (icmp.ttl === CONTROLLER_TTL) { return { kind: 'controller', detail }; }
    if (icmp.ttl !== undefined) { return { kind: 'other-device', detail }; }
    return { kind: 'unknown', detail };
}

// -- 구조화 판정 (관측 / 추론 / 확신도) -------------------------------------

/** 1402 명령 채널의 지금 상태 분류 - 제어기 런타임 상태와 별개다. */
export type ChannelAssessment =
    /** 새 연결이 열린다. */
    | 'command-channel-open'
    /** 새 연결이 거부된다(refused) - 지금 채널을 열 수 없다는 관측. 원인은 미확정. */
    | 'command-channel-unavailable'
    /** 연결이 열리지 않고 응답도 없다(timeout) - 부팅 중·소켓 점유·경로 필터링 등. */
    | 'command-channel-unresponsive'
    /** 호스트 자체에 도달하지 못한다(ICMP·TCP 모두 무응답). */
    | 'host-unreachable'
    /** 측정만으로 분류할 수 없다(ping 미지원 등). */
    | 'inconclusive';

/**
 * 제어기 런타임(GPL) 상태. **이 프로브만으로는 'healthy' 가 되지 않는다** - 살아 있음의 증거는 명령의
 * `<STATUS>` 응답이고, TCP connect 성공은 그 증거가 아니다(하드 규칙 2의 취지).
 */
export type ControllerHealthState = 'unconfirmed' | 'unreachable';

export type AssessmentConfidence = 'high' | 'medium' | 'low';

/** 어느 경로로 측정했는지 - multi-NIC 환경에서 같은 IP가 다른 장치일 수 있다(#22 함정). */
export type RouteIdentity = 'controller' | 'other-device' | 'ambiguous' | 'unknown';

export interface ReachabilityAssessment {
    observations: {
        icmp: 'reachable' | 'unreachable' | 'unknown';
        tcp1402: TcpProbeResult;
        /** ping TTL(제어기 255 / 게이트웨이 64). 응답이 없으면 undefined. */
        ttl?: number;
        /** ARP 로 본 MAC 목록(정규화). */
        macs: string[];
        route: RouteIdentity;
    };
    assessment: {
        state: ChannelAssessment;
        confidence: AssessmentConfidence;
        /** 이 관측을 만들 수 있는 다른 설명들 - 하나로 확정하지 않기 위해 함께 싣는다. */
        alternativeExplanations: string[];
    };
    controllerHealth: {
        state: ControllerHealthState;
        reason: string;
    };
}

/**
 * 측정값 -> 구조화 판정. 문장을 만들지 않고 필드만 채운다(MCP 응답·사후 스냅샷·대시보드가 각자 표현).
 * route 가 'other-device'/'ambiguous' 면 확신도를 한 단계 낮춘다 - 다른 장치를 측정했을 수 있다.
 */
export function assessReachability(input: ReachabilityInput): ReachabilityAssessment {
    const { tcp1402, icmp, arp } = input;
    const who = identifyResponder(icmp, arp);
    const macs = Array.from(new Set((arp.entries ?? []).map(e => e.mac).concat(arp.mac ? [arp.mac] : [])));
    const route: RouteIdentity = macs.length > 1
        ? 'ambiguous'
        : who.kind === 'controller' ? 'controller' : who.kind === 'other-device' ? 'other-device' : 'unknown';

    let state: ChannelAssessment;
    let confidence: AssessmentConfidence;
    let alternativeExplanations: string[];
    if (tcp1402 === 'open') {
        state = 'command-channel-open';
        confidence = 'high';
        alternativeExplanations = [];
    } else if (tcp1402 === 'refused') {
        state = 'command-channel-unavailable';
        // "지금 새 연결을 만들 수 없다"는 관측 자체는 확실하다(원인이 미확정일 뿐).
        confidence = 'high';
        alternativeExplanations = [
            '채널 교란 가능 명령(Unload/Load/Compile/Start) 뒤의 일시적 사용 불가 - 실측 2026-08-31: 약 2.5분 뒤 재부팅 없이 복귀',
            '제어기 소프트웨어 재시작/부팅 중(1402 서비스 미기동)',
            '제어기 DHCP 임대 상실로 같은 IP의 다른 장치(사무실 게이트웨이)가 RST 를 돌려주는 경우',
        ];
    } else if (icmp.alive === true) {
        state = 'command-channel-unresponsive';
        confidence = 'medium';
        alternativeExplanations = [
            '부팅 중(ICMP 스택만 기동)',
            '1402 소켓이 다른 클라이언트에 점유되어 accept 가 지연',
            '경로/방화벽이 SYN 을 버림',
        ];
    } else if (icmp.alive === false) {
        state = 'host-unreachable';
        confidence = 'medium';
        alternativeExplanations = ['전원 차단', '네트워크/케이블/스위치 단절', '재부팅 초기 단계(스택 미기동)', 'NIC 가 APIPA 로 떨어져 경로가 사라짐'];
    } else {
        state = 'inconclusive';
        confidence = 'low';
        alternativeExplanations = ['ping 을 실행할 수 없어 호스트 도달성을 측정하지 못함'];
    }

    // 다른 장치를 봤을 가능성이 있으면 확신도를 낮춘다.
    if (route === 'other-device' || route === 'ambiguous') {
        confidence = confidence === 'high' ? 'medium' : 'low';
        alternativeExplanations = [...alternativeExplanations, `측정 경로가 제어기가 아닐 수 있다(${who.detail || 'route 불명'}) - 판정 자체가 무효일 수 있다`];
    }

    const controllerHealth: ReachabilityAssessment['controllerHealth'] = state === 'host-unreachable'
        ? { state: 'unreachable', reason: 'ICMP·TCP 모두 무응답 - 호스트에 도달하지 못했다. 런타임 상태는 측정 불가.' }
        : { state: 'unconfirmed', reason: '1402 도달성만으로는 GPL 런타임 상태를 판정할 수 없다 - 살아 있음의 증거는 명령의 <STATUS> 응답이다.' };

    return {
        observations: {
            icmp: icmp.alive === true ? 'reachable' : icmp.alive === false ? 'unreachable' : 'unknown',
            tcp1402,
            ttl: icmp.ttl,
            macs,
            route,
        },
        assessment: { state, confidence, alternativeExplanations },
        controllerHealth,
    };
}

/**
 * 한국어 판정 문장. 4분류(open / refused / ICMP만 응답 / 전부 무응답 / ICMP 판정 불가) + 응답 장치 정체 힌트.
 * REFUSED·OPEN인데 응답 장치가 제어기가 아닌 것으로 보이면 그 판정을 신뢰하지 말라고 명시한다(#22 함정).
 *
 * **관측을 먼저 쓰고 추론은 "가능한 설명"으로만 적는다** - 제어기 다운/전원 재투입 같은 확정 서술은 쓰지 않는다.
 */
export function describeReachability(input: ReachabilityInput): string {
    const { ip, tcp1402, icmp, arp } = input;
    const who = identifyResponder(icmp, arp);
    const identity = who.detail ? ` [응답 장치: ${who.kind === 'controller' ? '제어기' : who.kind === 'other-device' ? '제어기 아님' : '불명'} — ${who.detail}]` : '';

    let verdict: string;
    if (tcp1402 === 'open') {
        verdict = `${ip}:1402 도달 가능 — TCP 연결이 열린다.`;
    } else if (tcp1402 === 'refused') {
        verdict = `${ip}:1402 새 연결이 거부됨(refused) — 호스트의 TCP 스택은 응답하나 지금 명령 채널을 열 수 없다는 관측이다. `
            + '이것만으로 제어기 런타임 상태는 확정할 수 없다(가능한 설명: 채널 교란 가능 명령 뒤의 일시적 사용 불가 / 소프트웨어 재시작·부팅 중 / 같은 IP의 다른 장치가 응답).';
    } else if (icmp.alive === true) {
        verdict = `ICMP는 응답하나 1402 TCP가 실패(${tcp1402}) — 부팅 중(서비스 미기동)이거나 소켓 점유/경로 차단. 런타임 상태 미확정.`;
    } else if (icmp.alive === false) {
        verdict = `ICMP·TCP 모두 무응답(${tcp1402}${icmp.detail ? `, ping: ${icmp.detail}` : ''}) — 호스트에 도달하지 못했다는 관측. `
            + '전원·네트워크·재부팅 초기 단계 중 어느 것인지는 이 관측만으로 구분되지 않는다.';
    } else {
        verdict = `ICMP 판정 불가(ping 미지원) — TCP 실패(${tcp1402})만 확인됨.`;
    }

    if (who.kind === 'other-device' && (tcp1402 === 'open' || tcp1402 === 'refused' || icmp.alive === true)) {
        verdict += ` 주의: 응답한 장치가 제어기가 아닌 것으로 보인다 — 제어기 DHCP 임대 상실로 ${ip} 트래픽이 사무실 게이트웨이로 흘러간 경우일 수 있어 이 판정(${tcp1402})은 무효일 수 있다. ` +
            `\`arp -a ${ip}\`의 MAC(제어기 ${PRECISE_OUI}=Precise)과 ping TTL(제어기 ${CONTROLLER_TTL} / 게이트웨이 64)을 확인하고, 직결 NIC의 IP가 APIPA(169.254.x)로 떨어졌는지 볼 것.`;
    }
    return verdict + identity;
}

// ── 프로세스/소켓 래퍼 ─────────────────────────────────────────────────────

function runTool(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; err: NodeJS.ErrnoException | null }> {
    return new Promise(resolve => {
        try {
            execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
                resolve({ stdout: String(stdout ?? ''), err: err as NodeJS.ErrnoException | null });
            });
        } catch (err) {
            resolve({ stdout: '', err: err as NodeJS.ErrnoException });
        }
    });
}

/**
 * ICMP 1회(best-effort). Windows `ping -n 1 -w 1000 host`, 그 외 `ping -c 1 -W 1 host`.
 * 판정은 종료코드가 아니라 출력의 `TTL=`로 한다. ping 실행 자체가 불가(ENOENT)면 alive:null.
 */
export async function pingHost(host: string, timeoutMs = 2500): Promise<PingResult> {
    const isWin = process.platform === 'win32';
    const args = isWin ? ['-n', '1', '-w', '1000', host] : ['-c', '1', '-W', '1', host];
    const t0 = Date.now();
    const { stdout, err } = await runTool('ping', args, timeoutMs);
    const ms = Date.now() - t0;
    if (err && err.code === 'ENOENT') {
        return { alive: null, ms, detail: 'ping-not-available' };
    }
    const parsed = parsePingOutput(stdout);
    if (!parsed.alive && err && (err as any).killed) {
        return { alive: false, ms, detail: 'ping-timed-out' };
    }
    return { alive: parsed.alive, ttl: parsed.ttl, rttMs: parsed.rttMs, detail: parsed.detail, ms };
}

/** TCP connect 1회로 포트 상태를 가른다. 연결되면 즉시 닫는다(제어기에 명령을 보내지 않음). */
export function tcpProbe(host: string, port: number, timeoutMs = 2000): Promise<TcpProbeResult> {
    return new Promise(resolve => {
        const socket = new net.Socket();
        let done = false;
        const finish = (result: TcpProbeResult) => {
            if (done) { return; }
            done = true;
            clearTimeout(timer);
            socket.on('error', () => { /* 폐기 중 에러 무시 */ });
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        socket.once('connect', () => finish('open'));
        socket.once('error', (err: NodeJS.ErrnoException) => finish(classifyTcpError(err.code)));
        const opts: net.TcpSocketConnectOpts = net.isIPv4(host) ? { host, port, family: 4 } : { host, port };
        socket.connect(opts);
    });
}

/** ARP 캐시 조회(best-effort). Windows `arp -a host`, Linux `ip neigh show host` → 실패 시 `arp -n host`. */
export async function arpLookup(host: string, timeoutMs = 2500): Promise<ArpLookupResult> {
    let entries: ArpEntry[] = [];
    if (process.platform === 'win32') {
        const { stdout } = await runTool('arp', ['-a', host], timeoutMs);
        entries = parseArpOutput(stdout, host);
    } else {
        const ipNeigh = await runTool('ip', ['neigh', 'show', host], timeoutMs);
        entries = parseArpOutput(ipNeigh.stdout, host);
        if (!entries.length) {
            const arpN = await runTool('arp', ['-n', host], timeoutMs);
            entries = parseArpOutput(arpN.stdout, host);
        }
    }
    const mac = entries[0]?.mac;
    return { mac, vendorHint: vendorHintFor(mac), entries };
}

/** ICMP·TCP·ARP를 병렬로 조사해 판정 문장까지 만든다 — 연결 유실 사후 스냅샷(#22 제안 4)용 원스톱. */
export async function probeReachability(ip: string, port = 1402, timeoutMs = 2500): Promise<ReachabilityReport> {
    const [icmp, tcp1402, arp] = await Promise.all([
        pingHost(ip, timeoutMs),
        tcpProbe(ip, port, Math.min(timeoutMs, 2000)),
        arpLookup(ip, timeoutMs),
    ]);
    const input: ReachabilityInput = { ip, tcp1402, icmp, arp };
    return { ...input, port, verdict: describeReachability(input), assessment: assessReachability(input) };
}
