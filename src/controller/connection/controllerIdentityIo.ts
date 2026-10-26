/**
 * 제어기 정체 확인(controllerIdentity.ts)의 실제 IO — 명령 콘솔 직렬 큐·FTP 배너 기록·도달성 스냅샷을 묶는다.
 * 판정 규칙은 controllerIdentity.ts(순수)가 정본이고, 여기는 전송 수단만 꽂는다(architecture.md §3.1).
 * 배포(deployService)와 /GPL 비우기(트리 명령·AI 명령)가 같은 IO 를 쓴다.
 */

import type { ControllerConfig } from './controllerConnection';
import { getConnectionProbeTimeoutMs, getLastConsoleStatus, probeControllerCommand } from './controllerConnection';
import { getLastFtpBanner } from '../files/ftpClient';
import { SHOW_THREAD_LIST_CMD } from '../protocol/responseParser';
import { getRecentReachability, probeTcpBanner, responderEvidenceOf } from './reachability';
import { decideControllerIdentity, disabledControllerCheck, observeCommandConsole, observeFtpBanner } from './controllerIdentity';
import type { ControllerCheckRecord, IdentityPreflightIo, ReachabilityEvidence } from './controllerIdentity';

/** 정체 확인에 재사용하는 도달성 스냅샷의 최대 나이(ms) — 그보다 오래된 스냅샷은 보지 않는다. */
export const IDENTITY_REACHABILITY_MAX_AGE_MS = 30 * 60_000;
/** 배너만 읽는 FTP 접속의 타임아웃(ms). */
export const IDENTITY_FTP_BANNER_TIMEOUT_MS = 5000;
/** FTP 기본 포트(제어기 고정). */
const FTP_PORT = 21;

/** `cfg` 제어기에 대한 정체 확인 IO. 명령 콘솔 확인은 읽기 전용 `Show Thread -web` 하나다. */
export function createControllerIdentityIo(cfg: ControllerConfig): IdentityPreflightIo {
    return {
        recentConsoleStatus: since => getLastConsoleStatus(cfg.ip, since),
        probeConsole: async () => ({
            command: SHOW_THREAD_LIST_CMD,
            outcome: await probeControllerCommand(SHOW_THREAD_LIST_CMD, cfg, getConnectionProbeTimeoutMs()),
        }),
        recentFtpBanner: since => {
            const b = getLastFtpBanner(cfg.ip);
            return b && b.at >= since ? b : undefined;
        },
        readFtpBanner: async () => {
            const r = await probeTcpBanner(cfg.ip, FTP_PORT, IDENTITY_FTP_BANNER_TIMEOUT_MS);
            if (r.state !== 'open') { throw new Error(`FTP 접속 ${r.state}`); }
            return r.banner ?? '';
        },
        now: Date.now,
    };
}

/** 최근 도달성 스냅샷의 응답 장치 판정(없거나 오래됐으면 undefined). */
export function recentReachabilityEvidence(ip: string): ReachabilityEvidence | undefined {
    const report = getRecentReachability(ip, IDENTITY_REACHABILITY_MAX_AGE_MS);
    return report ? responderEvidenceOf(report) : undefined;
}

/**
 * 명령 콘솔 → FTP 배너 순으로 한 번에 확인한다(/GPL 비우기처럼 단계 사이에 할 일이 없는 경로용).
 * `sinceMs` 이후 이미 받은 STATUS·배너가 있으면 왕복 없이 쓴다. `enabled=false` 면 "확인 꺼짐" 기록만 돌려준다.
 */
export async function verifyControllerForFtpWrite(cfg: ControllerConfig, sinceMs: number, enabled = true): Promise<ControllerCheckRecord> {
    if (!enabled) { return disabledControllerCheck(Date.now()); }
    const io = createControllerIdentityIo(cfg);
    const consoleObservation = await observeCommandConsole(io, sinceMs);
    const ftp = consoleObservation.state === 'ok' ? await observeFtpBanner(io, sinceMs) : undefined;
    return decideControllerIdentity({
        console: consoleObservation,
        ...(ftp ? { ftp } : {}),
        reachability: recentReachabilityEvidence(cfg.ip),
        now: Date.now(),
    });
}
