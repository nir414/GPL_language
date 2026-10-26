/**
 * 제어기 정체 확인 — FTP 쓰기 전 사전 확인(preflight). vscode 무의존 순수 모듈.
 *
 * 배경(2026-10-23 Sample Prep 보고 「FTP 업로드가 제어기 연결·정체 확인 없이 진행된다」):
 *  - 명령 콘솔 채널이 유실(ECONNRESET → ECONNREFUSED)된 상태였고, 4분 전 사후 스냅샷은 같은 IP 가 사무실 게이트웨이
 *    (TTL 64, MAC D8-43-AE)로 응답했다고 기록했는데도 Upload Only 가 FTP 로 116개 파일을 끝까지 올렸다.
 *    업로드 로그 머리의 `Target: 192.168.0.1:1402` 는 확인하지 않았는데도 대상이 확정된 것처럼 읽혔다.
 *  - FTP 를 여는 장치는 제어기만이 아니다. "같은 IP 에 FTP 가 열린다" 는 제어기라는 증거가 아니다.
 *
 * 그래서 모든 FTP 쓰기 경로(Upload Only·Upload & Start·Quick Compile·Deploy·autoOnSave·/GPL 비우기) 앞에서
 * 세 가지 독립 증거를 모은다.
 *   ① 명령 콘솔: 읽기 전용 명령 하나의 `<STATUS>` (제어기 콘솔 프로토콜로 답했다는 것 자체가 정체 증거다).
 *      같은 작업 안에서 이미 STATUS 를 받았으면(배포의 Show Memory 사전 검사 등) **다시 보내지 않는다.**
 *   ② FTP 220 배너가 PA 제어기의 것(`RTEMS FTP server`)인지. 같은 작업 안에서 이미 연 FTP 세션의 배너가 있으면 재사용한다.
 *   ③ (있으면) 도달성 스냅샷의 응답 장치 판정(경로 인터페이스의 ARP OUI 00-14-FF · TTL 255).
 *
 * ③은 과거 관측이다. ①②가 지금 성공하면 그것이 우선한다(스냅샷 뒤에 경로가 바뀌었을 수 있다) — 스냅샷이
 * "제어기 아님" 이었다는 사실은 notes 로만 남긴다. ①②가 실패한 경우에만 ③이 이유 목록에 더해진다.
 *
 * 판정은 기록(`ControllerCheckRecord`)으로 돌려주고 정책은 호출부가 정한다(메커니즘과 정책의 분리):
 * AI 경로는 구조화 거부(`CONTROLLER_UNVERIFIED`, sent:false), 사람의 UI 경로는 「그래도 진행」 모달을 띄울 수 있다.
 */

import type { ProbeFailureKind, ProbeOutcome } from './connectionHealth';
import { parseStatus } from '../protocol/responseParser';
import { CHANNEL_NAMES } from '../protocol/channelNames';
import { PA_FTP_BANNER_RE } from './reachability';

export { PA_FTP_BANNER_RE };

export type FtpBannerVerdict = 'pa-controller' | 'other-device' | 'unreadable';

/** 배너 원문의 첫 줄(앞뒤 공백 제거, 최대 160자). 없으면 빈 문자열. */
export function normalizeFtpBanner(banner: string | undefined | null): string {
    const first = String(banner ?? '').split(/\r?\n/).find(line => line.trim().length > 0) ?? '';
    const line = first.trim();
    return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

/** 220 배너 → PA 제어기 여부. 배너를 읽지 못했으면 'unreadable'(판정 불가 — 제어기라고 추정하지 않는다). */
export function classifyFtpBanner(banner: string | undefined | null): FtpBannerVerdict {
    const line = normalizeFtpBanner(banner);
    if (!line) { return 'unreadable'; }
    return PA_FTP_BANNER_RE.test(line) ? 'pa-controller' : 'other-device';
}

// ── 관측 ────────────────────────────────────────────────────────────────

/** 명령 콘솔 관측 한 건. */
export interface ConsoleObservation {
    state: 'ok' | 'lost';
    /** STATUS 를 받은(또는 실패한) 명령. */
    command: string;
    statusCode?: number;
    failureKind?: ProbeFailureKind;
    detail?: string;
    /** 관측 시각(epoch ms). */
    at: number;
    /** 'probe' = 이번 확인에서 보냄 / 'same-operation' = 같은 작업 안에서 이미 받은 STATUS 를 재사용(왕복 0). */
    via: 'probe' | 'same-operation';
}

/** FTP 배너 관측 한 건. */
export interface FtpObservation {
    banner?: string;
    error?: string;
    at: number;
    via: 'probe' | 'same-operation';
}

/** 도달성 스냅샷에서 가져온 응답 장치 판정(있을 때만). */
export interface ReachabilityEvidence {
    mac?: string;
    responder: 'controller' | 'other-device' | 'unknown';
    at: number;
    /** 그 판정이 본 경로 인터페이스(있으면). */
    interfaceAlias?: string;
}

/**
 * 작업 기록(`result.controllerCheck`)에 남기는 확인 결과 — 나중에 "그때 진짜 제어기에 올라갔나" 를 operation 파일만으로 판정한다.
 * 필드는 추가만 한다(읽는 쪽은 모르는 필드를 무시한다 — architecture.md §3.3).
 */
export interface ControllerCheckRecord {
    commandConsole: 'ok' | 'lost' | 'skipped';
    /** 사람이 읽는 근거(`Show Memory STATUS 0 (같은 작업)` / `Show Thread -web — refused …`). */
    commandConsoleDetail: string;
    /** 220 배너 첫 줄(읽지 못했으면 null). */
    ftpBanner: string | null;
    ftpBannerVerdict: FtpBannerVerdict | 'not-checked';
    mac?: string;
    /** mac 의 출처(도달성 스냅샷 시각). */
    macSource?: string;
    /** 확인 시각(ISO). */
    checkedAt: string;
    /** 모든 확인을 통과했는가. */
    verified: boolean;
    /** 통과하지 못한 이유(사람이 읽는 문장). verified 면 빈 배열. */
    reasons: string[];
    /** 판정에 쓰지 않은 참고 관측(오래된 스냅샷 등). */
    notes?: string[];
    /** 사람이 「그래도 진행」을 골랐다. */
    overridden?: boolean;
    /** 설정(`gpl.controller.verifyControllerIdentity: false`)으로 확인을 껐다. */
    disabled?: boolean;
}

export interface IdentityDecisionInput {
    /** undefined = 확인하지 않음(skipped). */
    console?: ConsoleObservation;
    /** undefined = 아직 확인하지 않음(not-checked — 명령 콘솔 단계에서 먼저 막힌 경우). */
    ftp?: FtpObservation;
    reachability?: ReachabilityEvidence;
    now: number;
    formatTime?: (ms: number) => string;
}

function clock(ms: number): string {
    const d = new Date(ms);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 명령 콘솔 관측 → 기록용 한 줄. */
export function describeConsoleObservation(obs: ConsoleObservation | undefined, formatTime: (ms: number) => string = clock): string {
    if (!obs) { return '확인 생략'; }
    if (obs.state === 'ok') {
        const via = obs.via === 'same-operation' ? ', 같은 작업' : '';
        return `${obs.command.trim().replace(/\s+/g, ' ')} STATUS ${obs.statusCode ?? 0} (${formatTime(obs.at)}${via})`;
    }
    return `${obs.command.trim().replace(/\s+/g, ' ')} — 응답 없음(${obs.failureKind ?? 'other'}${obs.detail ? `: ${obs.detail}` : ''})`;
}

/**
 * 세 관측 → 확인 결과. 이유 문장은 관측만 적는다("제어기가 죽었다" 같은 판단은 쓰지 않는다).
 */
export function decideControllerIdentity(input: IdentityDecisionInput): ControllerCheckRecord {
    const formatTime = input.formatTime ?? clock;
    const reasons: string[] = [];
    const notes: string[] = [];
    const consoleName = CHANNEL_NAMES.command;

    const c = input.console;
    if (c && c.state === 'lost') {
        reasons.push(`${consoleName}이 응답하지 않습니다(${c.failureKind ?? 'other'}${c.detail ? ` — ${c.detail}` : ''}) — 상대가 제어기인지 확인하지 못했습니다.`);
    }

    const bannerLine = input.ftp ? normalizeFtpBanner(input.ftp.banner) : '';
    const bannerVerdict: ControllerCheckRecord['ftpBannerVerdict'] = input.ftp ? classifyFtpBanner(input.ftp.banner) : 'not-checked';
    if (input.ftp) {
        if (bannerVerdict === 'other-device') {
            reasons.push(`FTP 220 배너가 PA 제어기(RTEMS FTP server)의 것이 아닙니다: "${bannerLine}" — 같은 IP 의 다른 장치일 수 있습니다.`);
        } else if (bannerVerdict === 'unreadable') {
            reasons.push(input.ftp.error
                ? `FTP 접속에 실패해 220 배너를 읽지 못했습니다(${input.ftp.error}).`
                : 'FTP 220 배너를 읽지 못했습니다 — 상대가 제어기인지 확인하지 못했습니다.');
        }
    }

    const fresh = c?.state === 'ok' && bannerVerdict === 'pa-controller';
    const r = input.reachability;
    if (r && r.responder === 'other-device') {
        const where = `도달성 스냅샷(${formatTime(r.at)}${r.interfaceAlias ? `, ${r.interfaceAlias}` : ''})`;
        if (fresh) {
            notes.push(`${where}은 응답 장치를 제어기가 아닌 것으로 봤지만(${r.mac ?? 'MAC 불명'}) 이번 확인(${consoleName} STATUS·RTEMS 배너)이 우선합니다.`);
        } else {
            reasons.push(`${where}: 응답 장치가 제어기가 아닌 것으로 관측됨(${r.mac ?? 'MAC 불명'}).`);
        }
    }

    return {
        commandConsole: c ? c.state : 'skipped',
        commandConsoleDetail: describeConsoleObservation(c, formatTime),
        ftpBanner: bannerLine || null,
        ftpBannerVerdict: bannerVerdict,
        ...(r?.mac ? { mac: r.mac, macSource: `도달성 스냅샷 ${formatTime(r.at)}` } : {}),
        checkedAt: new Date(input.now).toISOString(),
        verified: reasons.length === 0,
        reasons,
        ...(notes.length ? { notes } : {}),
    };
}

/** 확인을 끈 경우의 기록 — 작업 기록에 "확인하지 않았다" 가 남아야 나중에 판정할 수 있다. */
export function disabledControllerCheck(now: number): ControllerCheckRecord {
    return {
        commandConsole: 'skipped',
        commandConsoleDetail: '확인 꺼짐(gpl.controller.verifyControllerIdentity)',
        ftpBanner: null,
        ftpBannerVerdict: 'not-checked',
        checkedAt: new Date(now).toISOString(),
        verified: true,
        reasons: [],
        disabled: true,
    };
}

/**
 * 배포 로그 머리의 `Target:` 값 — 확인 결과를 그대로 쓴다.
 * 예: `192.168.0.1 — 명령 콘솔 Show Memory STATUS 0 (19:57:00, 같은 작업), FTP 220 RTEMS FTP server (Version 1.1-JWJ) ready., MAC 00-14-FF-…`
 */
export function formatControllerCheckTarget(ip: string, rec: ControllerCheckRecord): string {
    if (rec.disabled) { return `${ip} — 제어기 확인 꺼짐(설정)`; }
    const parts = [`${CHANNEL_NAMES.command} ${rec.commandConsoleDetail}`];
    if (rec.ftpBannerVerdict === 'not-checked') {
        parts.push('FTP 미확인');
    } else {
        parts.push(rec.ftpBanner ? `FTP ${rec.ftpBanner}` : 'FTP 배너 없음');
    }
    if (rec.mac) { parts.push(`MAC ${rec.mac}`); }
    const tail = rec.verified ? '' : rec.overridden ? ' — 제어기 미확인(사용자가 진행 선택)' : ' — 제어기 미확인';
    return `${ip} — ${parts.join(', ')}${tail}`;
}

// ── 관측 절차(주입형 IO) ───────────────────────────────────────────────

/** 정체 확인 절차의 IO — 호출부가 전송 수단만 주입한다(architecture.md §3.1). */
export interface IdentityPreflightIo {
    /** `sinceMs` 이후 이 제어기에서 받은 마지막 `<STATUS>`(없으면 undefined). */
    recentConsoleStatus(sinceMs: number): { at: number; command: string; statusCode: number } | undefined;
    /** 읽기 전용 명령 하나를 보낸다(예외를 내지 않는다 — 실패는 ProbeOutcome 으로). */
    probeConsole(): Promise<{ command: string; outcome: ProbeOutcome }>;
    /** `sinceMs` 이후 이 제어기 FTP 세션에서 받은 220 배너(없으면 undefined). */
    recentFtpBanner(sinceMs: number): { banner: string; at: number } | undefined;
    /** FTP 21 에 접속해 220 배너만 읽고 닫는다(로그인·명령 없음). 실패하면 예외. */
    readFtpBanner(): Promise<string>;
    now(): number;
}

/** 명령 콘솔 확인 — 같은 작업 안에서 이미 STATUS 를 받았으면 왕복 없이 그것을 쓴다. */
export async function observeCommandConsole(io: IdentityPreflightIo, sinceMs: number): Promise<ConsoleObservation> {
    const recent = io.recentConsoleStatus(sinceMs);
    if (recent) {
        return { state: 'ok', command: recent.command, statusCode: recent.statusCode, at: recent.at, via: 'same-operation' };
    }
    const { command, outcome } = await io.probeConsole();
    const at = io.now();
    if (outcome.ok) {
        return { state: 'ok', command, statusCode: parseStatus(outcome.raw).code, at, via: 'probe' };
    }
    return { state: 'lost', command, failureKind: outcome.kind, detail: outcome.detail, at, via: 'probe' };
}

/** FTP 배너 확인 — 같은 작업 안에서 이미 연 FTP 세션의 배너가 있으면 새 접속 없이 쓴다. */
export async function observeFtpBanner(io: IdentityPreflightIo, sinceMs: number): Promise<FtpObservation> {
    const recent = io.recentFtpBanner(sinceMs);
    if (recent) {
        return { banner: recent.banner, at: recent.at, via: 'same-operation' };
    }
    try {
        const banner = await io.readFtpBanner();
        return { banner, at: io.now(), via: 'probe' };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message, at: io.now(), via: 'probe' };
    }
}

// ── 재부팅 정황 ─────────────────────────────────────────────────────────

/** 채널 유실 뒤 이 시간 안에 `/GPL/<프로젝트>` 가 없으면 재부팅 정황으로 본다. */
export const REBOOT_HINT_WINDOW_MS = 30 * 60_000;

/**
 * `/GPL/<프로젝트>` 가 없고 직전에 명령 콘솔 채널 유실이 있었으면 "재부팅된 것으로 보임" 한 줄.
 * 재부팅하면 `/GPL` 은 비워진다(2026-10-22·23 실측) — 다른 프로젝트·라이브러리도 다시 올려야 한다.
 * 정황일 뿐 확정이 아니므로 "보입니다" 로 쓴다.
 */
export function rebootSuspicionHint(input: {
    folderMissing: boolean;
    projectName: string;
    lastChannelLossAt?: number;
    /** `/GPL` 에 폴더가 하나도 없었는가(알면). */
    gplEmpty?: boolean;
    now: number;
    windowMs?: number;
    formatTime?: (ms: number) => string;
}): string | undefined {
    if (!input.folderMissing || input.lastChannelLossAt === undefined) { return undefined; }
    const elapsed = input.now - input.lastChannelLossAt;
    if (elapsed < 0 || elapsed > (input.windowMs ?? REBOOT_HINT_WINDOW_MS)) { return undefined; }
    const formatTime = input.formatTime ?? clock;
    const minutes = Math.max(0, Math.round(elapsed / 60_000));
    const empty = input.gplEmpty ? ' /GPL 이 비어 있고' : '';
    return `직전(${formatTime(input.lastChannelLossAt)}, 약 ${minutes}분 전)에 ${CHANNEL_NAMES.command} 채널 유실 기록이 있고${empty} /GPL/${input.projectName} 가 없습니다 — `
        + '제어기가 재부팅된 것으로 보입니다. 다른 프로젝트(라이브러리 포함)도 다시 올려야 할 수 있습니다.';
}
