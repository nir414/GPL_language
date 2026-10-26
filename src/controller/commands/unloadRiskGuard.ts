/**
 * 명령 전송 직렬 큐에 걸리는 Unload 위험 가드 + 실행 불가 Start 가드 (vscode 무의존).
 *
 * `controllerConnection.sendCommandDetailed` 가 **모든 명령**에 대해 전송 전 `guardBeforeSend`, 응답 뒤
 * `observeAfterResponse` 를 부른다. 그래서 UI(명령 팔레트·트리·FTP Run)·AI(브리지·URI)·배포 파이프라인·디버그 REPL
 * 어느 경로로 들어와도 같은 판정(`unloadRisk.ts`)이 걸린다. 경로마다 다른 것은 "어떻게 확인받는가" 하나다:
 *  - 사람 경로: 보내기 전에 모달(「그래도 Unload」/「취소」)로 확인하고 `confirmUnloadRisk: true` 로 보낸다.
 *  - AI 경로: 모달을 띄우지 않는다(브리지가 멈춘다). 거부(`UnloadRiskError`)를 구조화해 돌려주고, 호출자가 사용자
 *    동의를 받은 뒤 `confirm:true` 로 다시 부른다.
 *  - 확인 수단이 없는 내부 경로(배포의 Unload/Load 동기화 등): 확인 없이는 보내지 않고 사유를 남긴다.
 *
 * 그룹 판정(ProjectStart 유무)은 워크스페이스 `.gpr` 를 읽어야 하므로 확장이 `setProjectKindResolver` 로 주입한다.
 * 이름이 워크스페이스에 없으면(제어기에만 있는 프로젝트) 모름 — 표시를 켜지도, Start 를 막지도 않는다.
 */

import {
    PROJECT_NOT_RUNNABLE,
    UNLOAD_RISK_REFUSAL,
    UnloadRiskAssessment,
    assessUnloadRisk,
    compiledProjectFromResponse,
    markGroupCompile,
    notRunnableStartDetail,
    parseUnloadCommand,
    startTargetOf,
    unloadRiskRefusalDetail,
    unloadTimeoutGuidance,
} from './unloadRisk';
import { readUnloadRiskState, updateUnloadRiskState } from './unloadRiskStore';

/** 워크스페이스 `.gpr` 로 프로젝트 성격을 알려 준다. 모르면 undefined. */
export interface ProjectKindResolver {
    lookup(projectName: string): Promise<{ runnable: boolean } | undefined>;
    /** 실행 가능한 후보 이름(거부 문구에 싣는다). */
    runnableProjects(): Promise<string[]>;
}

let resolver: ProjectKindResolver | undefined;
let logger: ((line: string) => void) | undefined;

export function setProjectKindResolver(r: ProjectKindResolver | undefined): void { resolver = r; }
export function setUnloadRiskLogger(fn: ((line: string) => void) | undefined): void { logger = fn; }

/** 그룹 Compile 뒤 Unload 를 확인 없이 보내려 했다 — 제어기에는 보내지 않았다. */
export class UnloadRiskError extends Error {
    readonly code = UNLOAD_RISK_REFUSAL;
    /** projectCommands.runStatusCommand 가 "보내지 않음"으로 읽는다. */
    readonly sent = false;
    constructor(public readonly assessment: UnloadRiskAssessment) {
        super(unloadRiskRefusalDetail(assessment));
        this.name = 'UnloadRiskError';
    }
}

export function isUnloadRiskError(err: unknown): err is UnloadRiskError {
    return err instanceof UnloadRiskError || (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'UnloadRiskError');
}

/** 실행 불가(ProjectStart 없는) 프로젝트 Start — 제어기에는 보내지 않았다. */
export class NotRunnableStartError extends Error {
    readonly code = PROJECT_NOT_RUNNABLE;
    readonly sent = false;
    constructor(public readonly project: string, public readonly runnableCandidates: string[]) {
        super(notRunnableStartDetail(project, runnableCandidates));
        this.name = 'NotRunnableStartError';
    }
}

export function isNotRunnableStartError(err: unknown): err is NotRunnableStartError {
    return err instanceof NotRunnableStartError || (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'NotRunnableStartError');
}

/** 지금 이 Unload 명령의 위험 판정(Unload 가 아니면 undefined). UI 의 사전 확인과 가드가 같은 값을 본다. */
export function currentUnloadRisk(command: string, controllerId: string): UnloadRiskAssessment | undefined {
    if (!parseUnloadCommand(command)) { return undefined; }   // Unload 가 아니면 파일을 읽지 않는다(모든 명령이 지나간다)
    return assessUnloadRisk(readUnloadRiskState(controllerId), command);
}

/** 워크스페이스 `.gpr` 기준 프로젝트 성격(주입된 resolver). 모르면 undefined — Start 전 사전 확인에 쓴다. */
export async function lookupProjectKind(project: string): Promise<{ runnable: boolean } | undefined> {
    return lookupKind(project);
}

/** 실행 가능한 후보 이름(모르면 빈 목록). */
export async function runnableProjectNames(): Promise<string[]> {
    try { return await resolver?.runnableProjects() ?? []; } catch { return []; }
}

async function lookupKind(project: string): Promise<{ runnable: boolean } | undefined> {
    if (!resolver) { return undefined; }
    try { return await resolver.lookup(project); } catch { return undefined; }
}

/**
 * 전송 전 가드. 막을 때는 예외(UnloadRiskError / NotRunnableStartError)를 던진다 — 제어기에는 아무것도 보내지 않는다.
 * @param opts.confirmUnloadRisk 사람의 모달 확인 또는 AI 호출자의 `confirm:true`.
 */
export async function guardBeforeSend(command: string, controllerId: string, opts?: { confirmUnloadRisk?: boolean }): Promise<void> {
    const risk = currentUnloadRisk(command, controllerId);
    if (risk?.risky) {
        if (opts?.confirmUnloadRisk === true) {
            logger?.(`[UnloadRisk] ${risk.command}: 그룹 Compile(${risk.groupProjects.join(', ')}) 뒤 Unload — 확인을 받고 보냅니다`);
            return;
        }
        logger?.(`[UnloadRisk] ${risk.command}: 확인 없이 보내지 않음 (그룹 Compile: ${risk.groupProjects.join(', ')})`);
        throw new UnloadRiskError(risk);
    }
    const startTarget = startTargetOf(command);
    if (startTarget) {
        const kind = await lookupKind(startTarget);
        if (kind && kind.runnable === false) {
            const candidates = await runnableProjectNames();
            logger?.(`[UnloadRisk] ${command}: '${startTarget}' 는 ProjectStart 없는 그룹 — Start 를 보내지 않음`);
            throw new NotRunnableStartError(startTarget, candidates);
        }
    }
}

/** 응답 뒤 관측 — 그룹 Compile 성공이면 위험 표시를 켠다. 예외를 내지 않는다. */
export async function observeAfterResponse(command: string, controllerId: string, raw: string, now: number = Date.now()): Promise<void> {
    try {
        const project = compiledProjectFromResponse(command, raw);
        if (!project) { return; }
        const kind = await lookupKind(project);
        if (!kind || kind.runnable) { return; }
        const via = /^\s*start\b/i.test(command) ? 'Start -compile' : 'Compile';
        updateUnloadRiskState(controllerId, s => markGroupCompile(s, { project, at: now, via }), now);
        logger?.(`[UnloadRisk] 그룹 프로젝트 ${project} Compile 확인(${via}) — 이 부팅의 Unload 는 확인을 거칩니다. `
            + '라이브러리는 업로드만 하고 앱 Compile 로 검증하는 흐름을 권장합니다.');
    } catch { /* 관측 실패는 전송 결과에 영향을 주지 않는다 */ }
}

/** Unload 가 위험 상태에서 응답 없이 끝났을 때의 안내(아니면 undefined). */
export function unloadFailureGuidance(command: string, controllerId: string): string | undefined {
    const risk = currentUnloadRisk(command, controllerId);
    return risk?.risky ? unloadTimeoutGuidance(risk) : undefined;
}
