/**
 * 그룹 Compile 뒤 Unload 위험 판정의 정본 (vscode 무의존 — 단위 테스트: src/test/unloadRisk.test.ts).
 *
 * 배경(2026-10-22~23 Sample Prep 실측, inbox `unload-guard-request_v1` 외 3건):
 *  - 같은 부팅에서 **ProjectStart 없는 그룹 .gpr(Lib 등)을 Compile 한 뒤** `Unload <project>` 또는 `Unload -all` 을 보내면
 *    응답 없이 타임아웃되고, 그 뒤 명령 콘솔·런타임 콘솔·웹 리스너가 모두 연결을 거부했다(FTP·ICMP 는 살아 있음).
 *    10-22 4회 + 10-23 2회, 6번 중 6번. 여유 메모리(1.8 ~ 7.6 MB)·대상이 그룹인지 앱인지·`-all` 여부와는 무관했고,
 *    10-23 두 건은 제어기 재부팅으로만 복구됐다. 원인은 모른다.
 *  - 사용자 방침(2026-10-23): **막지 말고 경고 + 명시 확인 뒤 보낸다** — 메모리 회수처럼 꼭 필요한 때가 있다.
 *
 * 이 모듈이 정하는 것(모든 경로가 같은 판정을 쓴다 — UI 모달·AI 거부·MCP 직접 접속·타임아웃 안내):
 *  1. 위험 상태: 제어기(IP)별로 "이 부팅에서 그룹 Compile 이 성공했다" 표시 목록(`marks`). 표시가 하나라도 있으면 위험.
 *  2. 표시를 켜는 근거: `Compile <p>` STATUS 0(비차단 포함) + 에러 줄 0, 또는 `Start <p> -compile` 이 STATUS 0 / -744
 *     (*Invalid start procedure* — 컴파일은 끝난 뒤의 거부다). 그리고 `<p>` 가 그룹(ProjectStart 없음)으로 **확인된** 경우만.
 *  3. 표시를 지우는 근거: 재부팅의 증거가 있을 때만 — 표시 뒤에 명령 콘솔 유실이 관측됐고, 재연결 뒤 `/GPL` 목록에
 *     표시된 그룹 폴더가 하나도 없다(재부팅하면 `/GPL` 이 비어 있었다, 10-23 18:10 실측). **확실하지 않으면 지우지 않는다.**
 *  4. 문구: 모달·거부 사유·타임아웃 안내 — 실측 횟수와 "재부팅이 필요했다" 를 한 곳에서 만든다.
 *
 * 파일 계약(확장 `unloadRiskStore.ts` ↔ MCP `controller-mcp/src/unloadRisk.js` 가 같은 파일을 읽고 쓴다):
 *   %TEMP%/gpl-controller/unload-risk-<ip>.json =
 *   { "version": 1, "controllerId": string, "marks": [{ "project", "at", "via" }], "channelLossAt"?: ms,
 *     "updatedAt": ms, "lastClearedAt"?: ms, "lastClearedReason"?: string }
 */

import { classifyPolicyCommand } from './commandPolicy';
import { isControllerNonBlockingStatus, parseCompileErrors, parseStatus } from '../protocol/responseParser';

/** AI 경로 거부 코드 — MCP `refused` 와 브리지 `error` 에 그대로 실린다. */
export const UNLOAD_RISK_REFUSAL = 'unload-after-group-compile';
/** 실행 불가(ProjectStart 없는) 프로젝트를 Start 하려 할 때의 거부 코드. */
export const PROJECT_NOT_RUNNABLE = 'PROJECT_NOT_RUNNABLE';
/** `Start` 가 컴파일 뒤 진입점이 없어 거부한 STATUS (*Invalid start procedure*). */
export const STATUS_INVALID_START_PROCEDURE = -744;

/** 실측 근거 — 문구에 그대로 쓰인다. 새 관측이 생기면 여기만 고친다. */
export const UNLOAD_RISK_EVIDENCE = Object.freeze({
    disrupted: 6,
    observed: 6,
    period: '2026-10-22~23',
});

export const UNLOAD_RISK_STATE_VERSION = 1;

/** "그룹 프로젝트가 이 부팅에서 Compile 됐다" 표시 하나. */
export interface GroupCompileMark {
    /** 제어기 명령 인자로 나간 프로젝트 이름. */
    project: string;
    /** 컴파일 성공을 관측한 시각(ms). */
    at: number;
    /** 어느 경로로 관측했는가(`Compile`·`Start -compile`·`mcp-direct` 등) — 진단용. */
    via: string;
}

export interface UnloadRiskState {
    version: number;
    controllerId: string;
    marks: GroupCompileMark[];
    /** 표시 이후 명령 콘솔 유실이 관측된 시각 — 재부팅 판정의 전제다. */
    channelLossAt?: number;
    updatedAt: number;
    lastClearedAt?: number;
    lastClearedReason?: string;
}

export function emptyUnloadRiskState(controllerId: string, now: number): UnloadRiskState {
    return { version: UNLOAD_RISK_STATE_VERSION, controllerId, marks: [], updatedAt: now };
}

/** 파일에서 읽은 값을 검증해 상태로 만든다. 모양이 다르면 undefined(= 표시 없음으로 보지 말고 호출측이 판단). */
export function normalizeUnloadRiskState(raw: unknown, controllerId: string): UnloadRiskState | undefined {
    if (!raw || typeof raw !== 'object') { return undefined; }
    const r = raw as Record<string, unknown>;
    const marks = Array.isArray(r.marks)
        ? r.marks
            .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
            .filter(m => typeof m.project === 'string' && (m.project as string).trim() !== '' && typeof m.at === 'number')
            .map(m => ({ project: String(m.project).trim(), at: Number(m.at), via: typeof m.via === 'string' ? m.via : 'unknown' }))
        : [];
    const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
        version: num(r.version) ?? UNLOAD_RISK_STATE_VERSION,
        controllerId: typeof r.controllerId === 'string' && r.controllerId ? r.controllerId : controllerId,
        marks,
        ...(num(r.channelLossAt) !== undefined ? { channelLossAt: num(r.channelLossAt) } : {}),
        updatedAt: num(r.updatedAt) ?? 0,
        ...(num(r.lastClearedAt) !== undefined ? { lastClearedAt: num(r.lastClearedAt) } : {}),
        ...(typeof r.lastClearedReason === 'string' ? { lastClearedReason: r.lastClearedReason } : {}),
    };
}

// ── 명령 해석 ──────────────────────────────────────────────────────────────

export interface UnloadCommandInfo {
    /** `Unload -all` 인가. */
    all: boolean;
    /** `Unload <project>` 의 대상(없으면 undefined). */
    target?: string;
}

/** `Unload …` 명령이면 범위를, 아니면 undefined. */
export function parseUnloadCommand(command: string): UnloadCommandInfo | undefined {
    const info = classifyPolicyCommand(command);
    if (info.kind !== 'unload') { return undefined; }
    const all = command.trim().split(/\s+/).slice(1).some(t => /^-all$/i.test(t));
    return { all, target: info.target };
}

/** `Start <project> …` 명령의 대상 프로젝트 이름. Start 가 아니면 undefined. */
export function startTargetOf(command: string): string | undefined {
    const info = classifyPolicyCommand(command);
    return info.kind === 'start' ? info.target : undefined;
}

function hasCompileSwitch(command: string): boolean {
    return command.trim().split(/\s+/).slice(1).some(t => /^-compile$/i.test(t));
}

/**
 * 이 응답이 "프로젝트 컴파일 성공"을 증명하면 그 프로젝트 이름을, 아니면 undefined.
 * 그룹인지는 판정하지 않는다 — 호출측이 `.gpr` 의 ProjectStart 로 확인한 뒤 `markGroupCompile` 한다.
 */
export function compiledProjectFromResponse(command: string, raw: string): string | undefined {
    const info = classifyPolicyCommand(command);
    if (!info.target) { return undefined; }
    if (info.kind !== 'compile' && !(info.kind === 'start' && hasCompileSwitch(command))) { return undefined; }
    const status = parseStatus(raw ?? '');
    if (parseCompileErrors(raw ?? '').length > 0) { return undefined; }
    const accepted = status.code === 0 || isControllerNonBlockingStatus(status.code)
        || (info.kind === 'start' && status.code === STATUS_INVALID_START_PROCEDURE);
    return accepted ? info.target : undefined;
}

// ── 상태 전이 ──────────────────────────────────────────────────────────────

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** 그룹 Compile 표시를 더한다(같은 프로젝트면 시각만 갱신). */
export function markGroupCompile(state: UnloadRiskState, mark: GroupCompileMark): UnloadRiskState {
    const others = state.marks.filter(m => !sameName(m.project, mark.project));
    return { ...state, marks: [...others, { ...mark, project: mark.project.trim() }], updatedAt: mark.at };
}

/** 명령 콘솔 유실 관측을 기록한다(표시가 없으면 기록할 이유가 없다 — 그대로 돌려준다). */
export function noteChannelLoss(state: UnloadRiskState, at: number): UnloadRiskState {
    if (state.marks.length === 0) { return state; }
    return { ...state, channelLossAt: at, updatedAt: at };
}

/** 표시를 모두 지운 상태(재부팅 근거 또는 사람의 명시 해제). */
export function clearUnloadRisk(state: UnloadRiskState, at: number, reason: string): UnloadRiskState {
    return {
        version: UNLOAD_RISK_STATE_VERSION,
        controllerId: state.controllerId,
        marks: [],
        updatedAt: at,
        lastClearedAt: at,
        lastClearedReason: reason,
    };
}

// ── 판정 ───────────────────────────────────────────────────────────────────

export interface UnloadRiskAssessment {
    /** 보내기 전에 확인이 필요한가. */
    risky: boolean;
    command: string;
    scope: 'all' | 'project';
    target?: string;
    /** 이 부팅에서 Compile 된 그룹 프로젝트(오래된 순). */
    groupProjects: string[];
    /** 가장 최근 그룹 Compile 시각. */
    lastGroupCompileAt?: number;
}

/**
 * Unload 명령의 위험 판정 — **모든 경로가 이 함수 하나를 쓴다.** Unload 가 아니면 undefined.
 * 대상이 그룹이든 앱이든 같다(10-23 17:51 앱 `Unload BinderR3` 도 같은 증상이었다).
 */
export function assessUnloadRisk(state: UnloadRiskState | undefined, command: string): UnloadRiskAssessment | undefined {
    const unload = parseUnloadCommand(command);
    if (!unload) { return undefined; }
    const marks = [...(state?.marks ?? [])].sort((a, b) => a.at - b.at);
    return {
        risky: marks.length > 0,
        command: command.trim(),
        scope: unload.all ? 'all' : 'project',
        ...(unload.target && !unload.all ? { target: unload.target } : {}),
        groupProjects: marks.map(m => m.project),
        ...(marks.length > 0 ? { lastGroupCompileAt: marks[marks.length - 1].at } : {}),
    };
}

export type RebootJudgementReason =
    | 'no-risk'
    | 'no-channel-loss'
    | 'listing-unavailable'
    | 'group-folder-present'
    | 'gpl-cleared-after-channel-loss';

export interface RebootJudgement {
    /** 재부팅으로 볼 근거가 충분해 표시를 지워도 되는가. */
    rebooted: boolean;
    reason: RebootJudgementReason;
    detail: string;
}

/**
 * 재연결 뒤 관측으로 "제어기가 재부팅됐다"고 볼 수 있는지. **근거가 모자라면 false(표시 유지)** 다.
 * @param remoteNames 재연결 뒤 읽은 `/GPL` 바로 아래 항목 이름. 읽지 못했으면 null.
 */
export function judgeRebootEvidence(state: UnloadRiskState | undefined, remoteNames: readonly string[] | null): RebootJudgement {
    const marks = state?.marks ?? [];
    if (marks.length === 0) {
        return { rebooted: false, reason: 'no-risk', detail: '위험 표시가 없다.' };
    }
    const lastMark = Math.max(...marks.map(m => m.at));
    if (state?.channelLossAt === undefined || state.channelLossAt < lastMark) {
        return { rebooted: false, reason: 'no-channel-loss', detail: '그룹 Compile 뒤 명령 콘솔 유실이 관측되지 않았다 — 재부팅 근거 없음.' };
    }
    if (remoteNames === null) {
        return { rebooted: false, reason: 'listing-unavailable', detail: '/GPL 목록을 읽지 못했다 — 판단 보류(표시 유지).' };
    }
    const present = marks.filter(m => remoteNames.some(n => sameName(n, m.project))).map(m => m.project);
    if (present.length > 0) {
        return { rebooted: false, reason: 'group-folder-present', detail: `/GPL 에 그룹 폴더(${present.join(', ')})가 남아 있다 — 재부팅 근거 없음.` };
    }
    return {
        rebooted: true,
        reason: 'gpl-cleared-after-channel-loss',
        detail: `명령 콘솔 유실 뒤 재연결했고 /GPL 에 그룹 폴더(${marks.map(m => m.project).join(', ')})가 없다 — 재부팅된 것으로 본다.`,
    };
}

// ── 문구 ───────────────────────────────────────────────────────────────────

function hhmm(at: number | undefined): string {
    if (at === undefined) { return '?'; }
    const d = new Date(at);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function groupLabel(a: UnloadRiskAssessment): string {
    return a.groupProjects.length > 0 ? a.groupProjects.join(', ') : '(미상)';
}

const EVIDENCE_LINE = `이 조합은 지금까지 ${UNLOAD_RISK_EVIDENCE.observed}번 중 ${UNLOAD_RISK_EVIDENCE.disrupted}번 명령 콘솔을 끊었고`
    + ` (${UNLOAD_RISK_EVIDENCE.period} 실측), 최근 사례는 제어기 재부팅으로만 복구됐습니다.`;

/** 사람용 모달 — 버튼은 호출측이 「그래도 Unload」/「취소」로 단다. */
export function unloadRiskWarning(a: UnloadRiskAssessment): { message: string; detail: string } {
    return {
        message: `${a.command} — 이 부팅에서 그룹 프로젝트(${groupLabel(a)})를 Compile 한 뒤의 Unload 입니다. ${EVIDENCE_LINE}`,
        detail: [
            `그룹 Compile: ${groupLabel(a)} (마지막 ${hhmm(a.lastGroupCompileAt)})`,
            '원인은 아직 모릅니다 — 여유 메모리·대상이 그룹인지 앱인지·-all 여부와 무관하게 재현됐습니다.',
            '메모리 회수 등으로 꼭 필요할 때만 보내고, 명령 콘솔이 끊기면 제어기 재부팅을 준비하세요.',
            '라이브러리(Lib)는 업로드만 하고 앱 Compile 로 검증하면 이 상태를 피할 수 있습니다.',
            '재부팅이 확인되면 표시는 자동으로 풀립니다(확인되지 않으면 명령 팔레트 「GPL: Unload 위험 표시 해제」).',
        ].join('\n'),
    };
}

/** AI 경로 거부 사유 — 사용자 동의 없이 confirm 을 붙이지 않게 한다. */
export function unloadRiskRefusalDetail(a: UnloadRiskAssessment): string {
    return `${a.command} 를 보내지 않았습니다 — 같은 부팅에서 그룹 프로젝트(ProjectStart 없는 .gpr: ${groupLabel(a)})를 `
        + `Compile 한 뒤의 Unload 입니다. ${EVIDENCE_LINE} `
        + '사용자에게 이 위험을 알리고 **동의를 받은 뒤에만** confirm:true 로 다시 호출하십시오. '
        + '메모리 회수가 목적이면 제어기 재부팅이 더 빠를 수 있습니다.';
}

/** Unload 가 위험 상태에서 타임아웃했을 때 — 일반 복구 대기 안내 대신 바로 알린다. */
export function unloadTimeoutGuidance(a: UnloadRiskAssessment): string {
    return `그룹 프로젝트(${groupLabel(a)}) Compile 뒤의 ${a.command} 가 응답 없이 끝났습니다. `
        + '이 조합은 지금까지 복구에 제어기 재부팅이 필요했습니다 — 채널 복구 대기(최대 180초)를 기다리기보다 '
        + '진행 중 작업과 모션 상태를 확인한 뒤 제어기 재부팅을 고려하세요. 같은 Unload 를 다시 보내지 마세요.';
}

/**
 * 배포의 START 단계 실패가 "실행 불가 프로젝트(-744 *Invalid start procedure*)" 인가. 이 실패는 같은 요청을 되풀이해도
 * 같은 결과이고, 되풀이할 때마다 그룹 Compile 이 또 일어난다 — 재시도 금지 + 실행 가능한 프로젝트 지정으로 안내한다.
 */
export function isNotRunnableStartFailure(failedPhase: string | undefined, statusCode: number | undefined): boolean {
    return failedPhase === 'START' && statusCode === STATUS_INVALID_START_PROCEDURE;
}

/** 실행 불가 프로젝트 Start 거부 사유. */
export function notRunnableStartDetail(project: string, runnableCandidates: readonly string[]): string {
    const list = runnableCandidates.length > 0 ? ` 실행 가능한 후보: ${runnableCandidates.join(', ')}.` : '';
    return `'${project}' 는 .gpr 에 ProjectStart 가 없는 그룹(라이브러리) 프로젝트라 Start 할 수 없습니다 — `
        + `보내면 그룹 Compile 뒤 -744(*Invalid start procedure*)로 끝나고, 그 Compile 이 이 부팅을 Unload 위험 상태로 만듭니다. `
        + `정지·업로드·컴파일 전에 멈췄습니다(제어기에 보내지 않음). 실행 가능한 프로젝트를 지정하십시오.${list}`;
}
