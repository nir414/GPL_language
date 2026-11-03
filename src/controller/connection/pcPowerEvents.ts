/**
 * PC 절전/복귀 관측(Windows 이벤트 로그) — "제어기는 멀쩡한데 연결이 끊겼다"의 가장 흔한 원인을 사후에 가른다.
 *
 * 배경(2026-11-03 사후 스냅샷 30건 재분석): 유실 5건이 Windows **최신 대기(Modern Standby) 종료** 시각과 초 단위로
 * 같았고, 스냅샷의 "확장 호스트 이벤트 루프 정지" 길이가 대기 시간(37 s~297 s)과 같았다. PC 가 자는 동안 직결 NIC 가
 * 내려가 깨어나는 순간 1402·1403 이 RST·ENETUNREACH 로 끊긴 것이다 — 제어기와는 무관하다. 그런데 정지 길이만으로는
 * 가를 수 없다(절전 없이도 확장 호스트가 22~71 s 멈춘 사례가 있다, §1-GI) — 그래서 OS 기록을 직접 본다.
 *
 * 읽는 이벤트(System 로그): Kernel-Power 42(절전 진입)·107(절전에서 복귀)·506(최신 대기 진입)·507(최신 대기 종료),
 * Power-Troubleshooter 1(절전에서 복귀). Windows 가 아니거나 조회에 실패하면 빈 목록 — 판단 근거가 없을 뿐 오류가 아니다.
 *
 * 파싱·판정은 순수 함수(테스트 대상)이고, `readPcPowerEvents` 만 프로세스를 띄운다.
 */

import { execFile } from 'child_process';

export type PcPowerEventKind = 'sleep' | 'resume';

export interface PcPowerEvent {
    kind: PcPowerEventKind;
    /** epoch ms */
    at: number;
    /** 출처 표기(`Kernel-Power 507`). */
    source: string;
}

const KIND_BY_EVENT: Readonly<Record<string, PcPowerEventKind>> = {
    'Microsoft-Windows-Kernel-Power|42': 'sleep',
    'Microsoft-Windows-Kernel-Power|506': 'sleep',
    'Microsoft-Windows-Kernel-Power|107': 'resume',
    'Microsoft-Windows-Kernel-Power|507': 'resume',
    'Microsoft-Windows-Power-Troubleshooter|1': 'resume',
};

/** `Provider|Id|epochMs` 줄들을 이벤트로(오래된 순). 모르는 줄은 버린다. */
export function parsePcPowerEvents(stdout: string): PcPowerEvent[] {
    const events: PcPowerEvent[] = [];
    for (const line of stdout.split(/\r?\n/)) {
        const [provider, id, ms] = line.trim().split('|');
        const kind = KIND_BY_EVENT[`${provider}|${id}`];
        const at = Number(ms);
        if (!kind || !Number.isFinite(at)) { continue; }
        events.push({ kind, at, source: `${provider.replace(/^Microsoft-Windows-/, '')} ${id}` });
    }
    return events.sort((a, b) => a.at - b.at);
}

/** 복귀 직후 이 시간 안에 연결 의심이 시작됐으면 절전 복귀가 끊김의 계기로 본다(NIC 재기동·DHCP 대기 포함). */
export const RESUME_MATCH_AFTER_MS = 120_000;
/** 시계·이벤트 기록 순서 오차 — 복귀 기록보다 약간 먼저 의심이 시작된 경우도 받는다. */
export const RESUME_MATCH_BEFORE_MS = 5_000;

export interface PcResumeMatch {
    resumeAt: number;
    resumeSource: string;
    /** 짝이 되는 절전 진입(복귀 직전의 마지막 진입). 기록이 조회 범위 밖이면 undefined. */
    sleepAt?: number;
}

/**
 * 연결 의심 시각 `suspectSince` 가 어떤 복귀 직후였는지. 여러 개면 의심 시각에 가장 가까운(마지막) 복귀를 고른다.
 * 근거가 없으면 undefined — "절전 아님"이 아니라 "절전으로 설명되지 않음"이다.
 */
export function matchPcResume(events: readonly PcPowerEvent[], suspectSince: number): PcResumeMatch | undefined {
    const candidates = events.filter(e => e.kind === 'resume'
        && suspectSince >= e.at - RESUME_MATCH_BEFORE_MS
        && suspectSince <= e.at + RESUME_MATCH_AFTER_MS);
    if (candidates.length === 0) { return undefined; }
    const resume = candidates[candidates.length - 1];
    const sleeps = events.filter(e => e.kind === 'sleep' && e.at <= resume.at);
    const sleepAt = sleeps.length > 0 ? sleeps[sleeps.length - 1].at : undefined;
    return { resumeAt: resume.at, resumeSource: resume.source, ...(sleepAt !== undefined ? { sleepAt } : {}) };
}

/** 사람용 한 줄 — `PC 절전 복귀 14:41:20 (절전 5분 0초)`. `clock` 은 시각 표기 함수(로캘·테스트 주입). */
export function describePcResume(match: PcResumeMatch, clock: (ms: number) => string): string {
    const slept = match.sleepAt !== undefined ? match.resumeAt - match.sleepAt : undefined;
    const duration = slept === undefined ? ''
        : slept >= 60_000 ? ` (절전 ${Math.floor(slept / 60_000)}분 ${Math.round((slept % 60_000) / 1000)}초)`
            : ` (절전 ${Math.round(slept / 1000)}초)`;
    return `PC 절전 복귀 ${clock(match.resumeAt)}${duration}`;
}

/** 조회 범위(분) — 유실 처리 시점 기준 과거. 대기 진입은 몇 시간 전일 수 있지만 복귀 판정에는 최근 것만 필요하다. */
export const PC_POWER_LOOKBACK_MINUTES = 30;

/**
 * Windows 이벤트 로그에서 최근 절전/복귀 기록을 읽는다(Windows PowerShell 5.1, 실측 약 4 s). 실패·비 Windows 면 [].
 * 제어기에는 아무것도 보내지 않는다.
 */
export function readPcPowerEvents(lookbackMinutes = PC_POWER_LOOKBACK_MINUTES, timeoutMs = 10_000): Promise<PcPowerEvent[]> {
    if (process.platform !== 'win32') { return Promise.resolve([]); }
    const minutes = Math.max(1, Math.floor(lookbackMinutes));
    const script = `$s=(Get-Date).AddMinutes(-${minutes}); `
        + "Get-WinEvent -FilterHashtable @("
        + "@{LogName='System';ProviderName='Microsoft-Windows-Kernel-Power';Id=42,107,506,507;StartTime=$s},"
        + "@{LogName='System';ProviderName='Microsoft-Windows-Power-Troubleshooter';Id=1;StartTime=$s}"
        + ") -ErrorAction SilentlyContinue | ForEach-Object { '{0}|{1}|{2}' -f $_.ProviderName,$_.Id,([DateTimeOffset]$_.TimeCreated).ToUnixTimeMilliseconds() }";
    return new Promise(resolve => {
        try {
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
                { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
                (_err, stdout) => resolve(parsePcPowerEvents(String(stdout ?? ''))));
        } catch {
            resolve([]);
        }
    });
}
