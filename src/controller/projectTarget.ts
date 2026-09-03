/**
 * 자동화(비대화형) 경로의 프로젝트 대상 해석 — vscode 무의존, 단위 테스트 대상.
 *
 * 배경(2026-08-31 사용자 개선안 §15~§22, 실측):
 *  - `gpl.deploy`/`gpl.uploadStart`/`gpl.quickCompile`/`gpl.start` 는 인자가 `vscode.Uri` 가 **아니면**
 *    (= MCP 브리지·URI·다른 확장이 부르는 모든 경우) `projectPicker.pickProjectDir()` 로 가고, 후보가 2개 이상이면
 *    **QuickPick 이 열려 자동화가 그 자리에서 멈췄다.** 사용자가 대신 눌러 주거나 `Main.gpl` 을 열어 줘야 진행됐고,
 *    엉뚱한 프로젝트가 배포되는 일도 있었다. 프로젝트명을 인자로 받는 경로가 아예 없었다.
 *  - 이건 AI 판단 문제가 아니라 **자동화 API 설계 문제**다. 그래서 대상 결정을 여기 한 곳에 모으고,
 *    자동화 경로에서는 UI 를 띄우는 대신 **구조화된 오류**(PROJECT_AMBIGUOUS 등 + 후보 목록)를 돌려준다.
 *
 * 규칙 — 우선순위(개선안 §20):
 *   1. 인자의 `projectDir` / `projectFile` (명시 경로)
 *   2. 인자의 `project` (이름 — .gpr `ProjectName` 또는 폴더명, 대소문자 무시)
 *   3. 세션 대상(`sessionTargetDir`) — 한 세션에서 대상을 고정해 중간에 다른 프로젝트로 튀지 않게 한다(§19)
 *   4. 워크스페이스에 **실행 가능(runnable) 프로젝트가 유일**할 때 그것
 *   5. 설정 `gpl.controller.defaultProject`
 *   6. 후보가 통째로 하나뿐이면 그것(라이브러리여도 — 단일 프로젝트 워크스페이스에서 오류를 내지 않는다)
 *   7. 그 밖에는 PROJECT_AMBIGUOUS
 *
 * **active editor 는 쓰지 않는다.** 어느 탭을 열어 뒀는지는 사람의 UI 상태이지 자동화 작업의 의도가 아니다(§22).
 * 대화형 경로(명령 팔레트·탐색기 우클릭)는 종전대로 `projectPicker.ts` 를 쓴다 — 두 경로를 섞지 않는다.
 *
 * runnable/library 판정은 `.gpr` 의 `ProjectStart` 유무다(§21 — `responseParser.parseGpr().projectStart`).
 * 라이브러리는 목록에서 빼지 않고 **후순위**로만 둔다(직접 지정하면 대상이 된다).
 */

import * as path from 'path';
import {
    normalizeDirKey,
    projectDirFromResource,
    filterDirsByProjectName,
} from './projectPickerCore';

/** 워크스페이스에서 찾은 프로젝트 후보 하나. 확장이 `.gpr` 를 읽어 채운다. */
export interface TargetCandidate {
    /** 프로젝트 폴더 경로. */
    dir: string;
    /** `.gpr` 의 `ProjectName`(없으면 폴더명). 제어기 명령 인자로 그대로 나가는 이름. */
    projectName: string;
    /** `.gpr` 에 `ProjectStart` 가 있으면 실행 가능(메인), 없으면 라이브러리 성격. */
    runnable: boolean;
    /** 다른 프로젝트가 `ProjectLibrary` 로 참조하고 있으면 그 프로젝트명. */
    referencedAsLibraryBy?: string;
}

/** 자동화 호출이 넘기는 대상 지정. 셋 다 생략하면 우선순위 3~7로 결정한다. */
export interface ProjectTargetRequest {
    /** 프로젝트 이름(.gpr `ProjectName` 또는 폴더명). */
    project?: string;
    /** 프로젝트 폴더 경로. */
    projectDir?: string;
    /** `.gpr` 또는 프로젝트 안의 소스 파일 경로. */
    projectFile?: string;
}

export interface ResolveTargetOptions {
    /** 이 세션에서 이미 확정된 대상 폴더(§19). 후보 목록에 남아 있을 때만 쓴다. */
    sessionTargetDir?: string;
    /** 설정 `gpl.controller.defaultProject` — 프로젝트명 또는 폴더명. */
    configuredDefault?: string;
}

export type TargetResolutionVia =
    | 'argument-dir'
    | 'argument-file'
    | 'argument-name'
    | 'session-target'
    | 'sole-runnable'
    | 'configured-default'
    | 'sole-candidate';

/** 오류 응답에 싣는 후보 요약 — 호출자(AI)가 다음에 무엇을 지정할지 바로 알 수 있게. */
export interface TargetCandidateSummary {
    project: string;
    dir: string;
    runnable: boolean;
    referencedAsLibraryBy?: string;
}

export type ProjectTargetError = 'NO_GPL_PROJECT' | 'PROJECT_NOT_FOUND' | 'PROJECT_AMBIGUOUS';

export type ResolveTargetResult =
    | { ok: true; dir: string; projectName: string; via: TargetResolutionVia }
    | {
        ok: false;
        error: ProjectTargetError;
        /** 사람이 읽는 사유 + 다음에 무엇을 하면 되는지. */
        detail: string;
        /** PROJECT_NOT_FOUND 일 때 요청받은 값. */
        requested?: string;
        candidates: TargetCandidateSummary[];
    };

export function summarizeCandidates(candidates: readonly TargetCandidate[]): TargetCandidateSummary[] {
    return candidates.map(c => ({
        project: c.projectName,
        dir: c.dir,
        runnable: c.runnable,
        ...(c.referencedAsLibraryBy ? { referencedAsLibraryBy: c.referencedAsLibraryBy } : {}),
    }));
}

/** 자동화 인자 형태인지 — `vscode.Uri`(탐색기 우클릭)나 undefined 와 구별한다. */
export function isProjectTargetRequest(value: unknown): value is ProjectTargetRequest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { return false; }
    // Uri 는 scheme/fsPath 를 갖는다 — 대상 지정 객체로 오인하지 않는다.
    const v = value as Record<string, unknown>;
    if (typeof v.scheme === 'string' && typeof v.fsPath === 'string') { return false; }
    return typeof v.project === 'string'
        || typeof v.projectDir === 'string'
        || typeof v.projectFile === 'string';
}

/**
 * 자동화 인자에만 쓰이는 플래그들 — 대상 키가 없어도 이것들이 있으면 **자동화 호출**로 본다.
 * (`{ saveDirty: true }` 처럼 대상 없이 플래그만 준 호출이 조용히 QuickPick 으로 가면, 대상 결정이 애매할 때
 * 오류를 받는 대신 UI 에서 멈추는 원래의 문제가 그대로 남는다.)
 */
const AUTOMATION_ONLY_KEYS = ['saveDirty', 'confirmStart', 'ignoreCompileStale', 'nonInteractive'] as const;

/**
 * 이 인자가 자동화(비대화형) 호출인가 — 대상 키(`project`/`projectDir`/`projectFile`) 또는 자동화 플래그가 있으면 true.
 * `vscode.Uri`(탐색기 우클릭)와 인자 없음은 false 이므로 사람용 경로가 그대로 유지된다.
 * 대상 해석에 쓰는 키만 보려면 `isProjectTargetRequest` 를 쓴다.
 */
export function isAutomationInvocation(value: unknown): boolean {
    if (isProjectTargetRequest(value)) { return true; }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { return false; }
    const v = value as Record<string, unknown>;
    if (typeof v.scheme === 'string' && typeof v.fsPath === 'string') { return false; }
    return AUTOMATION_ONLY_KEYS.some(k => v[k] !== undefined);
}

function byDir(candidates: readonly TargetCandidate[]): Map<string, TargetCandidate> {
    return new Map(candidates.map(c => [normalizeDirKey(c.dir), c] as const));
}

function resolved(c: TargetCandidate, via: TargetResolutionVia): ResolveTargetResult {
    return { ok: true, dir: c.dir, projectName: c.projectName, via };
}

const NAME_HINT = '`project`(이름) 또는 `projectDir`/`projectFile`(경로)로 대상을 명시하세요.';

/**
 * 대상 프로젝트를 결정한다. **UI 를 띄우지 않으며 active editor 를 보지 않는다.**
 * 실패는 예외가 아니라 구조화된 결과다 — 호출자가 그대로 응답에 실어 보낼 수 있게.
 */
export function resolveProjectTarget(
    request: ProjectTargetRequest | undefined,
    candidates: readonly TargetCandidate[],
    options: ResolveTargetOptions = {},
): ResolveTargetResult {
    const summaries = summarizeCandidates(candidates);
    if (candidates.length === 0) {
        return {
            ok: false,
            error: 'NO_GPL_PROJECT',
            detail: '워크스페이스에서 `.gpr` 프로젝트 파일을 찾지 못했습니다. GPL 프로젝트 폴더가 포함된 워크스페이스를 열어 주세요.',
            candidates: summaries,
        };
    }

    const dirs = candidates.map(c => c.dir);
    const index = byDir(candidates);

    // ── 1. 명시 경로 ───────────────────────────────────────────────────────
    if (request?.projectDir) {
        const hit = projectDirFromResource(request.projectDir, dirs, true);
        const c = hit ? index.get(normalizeDirKey(hit)) : undefined;
        if (c) { return resolved(c, 'argument-dir'); }
        return {
            ok: false,
            error: 'PROJECT_NOT_FOUND',
            detail: `'${request.projectDir}' 는 이 워크스페이스의 GPL 프로젝트 폴더(.gpr 보유)가 아닙니다. 상위 폴더를 지정해도 하위 프로젝트를 임의로 고르지 않습니다 — 프로젝트 폴더 자체를 지정하세요.`,
            requested: request.projectDir,
            candidates: summaries,
        };
    }
    if (request?.projectFile) {
        const hit = projectDirFromResource(request.projectFile, dirs, false);
        const c = hit ? index.get(normalizeDirKey(hit)) : undefined;
        if (c) { return resolved(c, 'argument-file'); }
        return {
            ok: false,
            error: 'PROJECT_NOT_FOUND',
            detail: `'${request.projectFile}' 이 어느 GPL 프로젝트 폴더에도 속하지 않습니다.`,
            requested: request.projectFile,
            candidates: summaries,
        };
    }

    // ── 2. 이름 ────────────────────────────────────────────────────────────
    if (request?.project) {
        const gprNameOf = (dir: string): string | undefined => index.get(normalizeDirKey(dir))?.projectName;
        const matched = filterDirsByProjectName(dirs, request.project, gprNameOf);
        if (matched.length === 1) {
            const c = index.get(normalizeDirKey(matched[0]));
            if (c) { return resolved(c, 'argument-name'); }
        }
        if (matched.length > 1) {
            const matchedSummaries = summarizeCandidates(
                matched.map(d => index.get(normalizeDirKey(d))).filter((c): c is TargetCandidate => !!c),
            );
            return {
                ok: false,
                error: 'PROJECT_AMBIGUOUS',
                detail: `'${request.project}' 이름의 프로젝트가 ${matched.length}개 있습니다(폴더명과 .gpr ProjectName 이 겹치는 경우). \`projectDir\` 로 폴더를 지정하세요.`,
                requested: request.project,
                candidates: matchedSummaries,
            };
        }
        return {
            ok: false,
            error: 'PROJECT_NOT_FOUND',
            detail: `'${request.project}' 이름의 GPL 프로젝트를 워크스페이스에서 찾지 못했습니다(폴더명·.gpr ProjectName 모두 불일치).`,
            requested: request.project,
            candidates: summaries,
        };
    }

    // ── 3. 세션 대상 ───────────────────────────────────────────────────────
    if (options.sessionTargetDir) {
        const c = index.get(normalizeDirKey(options.sessionTargetDir));
        if (c) { return resolved(c, 'session-target'); }
        // 세션 대상이 사라졌으면(폴더 삭제·워크스페이스 변경) 조용히 다음 규칙으로 내려간다.
    }

    // ── 4. 실행 가능 프로젝트가 유일 ───────────────────────────────────────
    const runnables = candidates.filter(c => c.runnable);
    if (runnables.length === 1) { return resolved(runnables[0], 'sole-runnable'); }

    // ── 5. 설정 기본값 ─────────────────────────────────────────────────────
    if (options.configuredDefault) {
        const gprNameOf = (dir: string): string | undefined => index.get(normalizeDirKey(dir))?.projectName;
        const matched = filterDirsByProjectName(dirs, options.configuredDefault, gprNameOf);
        if (matched.length === 1) {
            const c = index.get(normalizeDirKey(matched[0]));
            if (c) { return resolved(c, 'configured-default'); }
        }
        // 기본값이 후보와 맞지 않으면 무시하고 다음 규칙으로 — 설정 오타 하나로 자동화를 세우지 않는다.
    }

    // ── 6. 후보가 하나뿐 ───────────────────────────────────────────────────
    if (candidates.length === 1) { return resolved(candidates[0], 'sole-candidate'); }

    // ── 7. 애매함 ──────────────────────────────────────────────────────────
    const runnableNote = runnables.length === 0
        ? '실행 가능한 프로젝트(.gpr 에 ProjectStart 가 있는 것)가 없습니다.'
        : `실행 가능한 후보가 ${runnables.length}개입니다.`;
    return {
        ok: false,
        error: 'PROJECT_AMBIGUOUS',
        detail: `워크스페이스에 GPL 프로젝트가 ${candidates.length}개 있어 대상을 결정할 수 없습니다. ${runnableNote} ${NAME_HINT} 한 프로젝트로 계속 작업한다면 설정 \`gpl.controller.defaultProject\` 를 두거나 첫 호출에만 대상을 지정하면 이후 같은 대상이 유지됩니다.`,
        candidates: summaries,
    };
}

/** 로그 한 줄: `GPL_Code (argument-name) — c:\\...\\projects\\GPL_Code`. */
export function describeResolution(result: ResolveTargetResult): string {
    return result.ok
        ? `${result.projectName} (${result.via}) — ${result.dir}`
        : `${result.error}: ${result.detail}`;
}

/** 후보 요약 한 줄 — 오류 로그용. */
export function describeCandidates(candidates: readonly TargetCandidateSummary[]): string {
    if (candidates.length === 0) { return '(후보 없음)'; }
    return candidates
        .map(c => `${c.project}${c.runnable ? '' : c.referencedAsLibraryBy ? `(라이브러리·${c.referencedAsLibraryBy})` : '(ProjectStart 없음)'} @ ${path.basename(c.dir)}`)
        .join(', ');
}
