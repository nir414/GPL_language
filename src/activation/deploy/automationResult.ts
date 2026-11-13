/**
 * 자동화(비대화형) 호출의 구조화 결과 — 인자 형태(`AutomationTargetArgs`)·실패 결과(`AutomationFailure`)와 그것을
 * 만드는 유일한 지점(`automationFailure`), 그리고 `gpl.automation.target`/`operations` 응답의 순수 조립.
 * `deploy.ts` 에서 분할(2026-10-27). vscode 를 import 하지 않는다(Node 단독 테스트: test/activation/deploy/automationResult.test.ts).
 */

import { AI_BLOCKED_ERROR } from '../../controller/automation/aiCommandPolicy';
import { recoveryFor } from '../../controller/automation/automationRecovery';
import type { RecoveryHint } from '../../controller/automation/automationRecovery';
import { PROJECT_NOT_RUNNABLE } from '../../controller/commands/unloadRisk';
import type { DeployResult } from '../../controller/deployment/deployService';
import type { ProjectTargetRequest, TargetCandidate, TargetCandidateSummary } from '../../controller/projects/projectTarget';
import { normalizeDirKey } from '../../util/pathKey';

export interface AutomationTargetArgs extends ProjectTargetRequest {
	/** true면 대상 폴더의 미저장 편집분을 저장하고 계속한다. 기본은 UNSAVED_FILES 오류(사람 편집분을 몰래 저장하지 않는다). */
	saveDirty?: boolean;
	/** Start 계열 — 모션 확인을 사용자에게 이미 받았음을 호출자가 단언한다(확인 모달을 대신한다, 하드 규칙 9). */
	confirmStart?: boolean;
	/** Start 계열 — "컴파일 검증 필요" 상태여도 그대로 Start 한다. */
	ignoreCompileStale?: boolean;
	/**
	 * 같은 키의 배포가 진행 중이면 새로 시작하지 않고 그 작업을 가리켜 돌려준다(개선안 §10).
	 * 브리지 응답이 끊긴 뒤 호출자가 같은 요청을 다시 보내도 중복 배포가 되지 않게 하는 장치다.
	 */
	idempotencyKey?: string;
	/**
	 * 배포 전처리 호출 단위 덮어쓰기 — `{ stripComments?, trimWhitespace?, excludeUnreachableLibraryFiles?, keepFiles? }` 또는 `false`(끔).
	 * 설정 `gpl.deploy.preprocess` 위에 얹는다(controller/deployment/deployPreprocess.resolvePreprocessOptions).
	 */
	preprocess?: unknown;
}

export type AutomationErrorCode =
	| 'NO_GPL_PROJECT' | 'PROJECT_NOT_FOUND' | 'PROJECT_AMBIGUOUS'
	| 'UNSAVED_FILES' | 'INTERACTIVE_UI_REQUIRED' | 'COMPILE_UNVERIFIED'
	/** Start 경로인데 대상이 실행 불가(ProjectStart 없는 그룹) — 정지·업로드·컴파일 전에 거부. */
	| typeof PROJECT_NOT_RUNNABLE
	/** FTP 쓰기 전 제어기 정체 확인 실패 — 아무것도 올리지 않았다(controller/connection/controllerIdentity.ts). */
	| 'CONTROLLER_UNVERIFIED'
	/** AI/자동화 경로에서 실행할 수 없는 명령(controller/automation/aiCommandPolicy.ts). */
	| typeof AI_BLOCKED_ERROR;

export interface AutomationFailure {
	ok: false;
	error: AutomationErrorCode;
	detail: string;
	candidates?: TargetCandidateSummary[];
	candidateCount?: number;
	files?: string[];
	/** 제어기에 아무것도 보내지 않았음(CONTROLLER_UNVERIFIED 등). */
	sent?: false;
	/** 정체 확인이 통과하지 못한 이유들. */
	reasons?: string[];
	controllerCheck?: DeployResult['controllerCheck'];
	operationId?: string;
	/**
	 * 다음에 무엇을 할지 — 호출자(AI/MCP)가 detail 문장을 해석해 행동을 지어내지 않게 한다(개선안 §15~§17).
	 * 규칙은 `controller/automation/automationRecovery.ts` 가 정본이며 코드마다 하나로 정해져 있다.
	 */
	recovery?: RecoveryHint;
}

export function isAutomationFailure(v: unknown): v is AutomationFailure {
	return typeof v === 'object' && v !== null && (v as AutomationFailure).ok === false && typeof (v as AutomationFailure).error === 'string';
}

/**
 * 자동화 실패를 만드는 유일한 지점 — 복구 지시를 빠뜨리지 않게 한다.
 * (코드마다의 지시는 `automationRecovery.ts` 표에 있고, 표에 없는 코드는 보수적인 기본값으로 떨어진다.)
 */
export function automationFailure(
	error: AutomationErrorCode,
	detail: string,
	extra: Omit<AutomationFailure, 'ok' | 'error' | 'detail' | 'recovery'> = {},
): AutomationFailure {
	return { ok: false, error, detail, ...extra, recovery: recoveryFor(error) };
}

/** `gpl.automation.target` 의 성공 응답 — 현재 세션 대상(없으면 null)·후보 목록·다음 행동 힌트. */
export function describeSessionTargetStatus(candidates: readonly TargetCandidate[], sessionTargetDir: string | undefined): {
	ok: true;
	target: { project: string; dir: string; runnable: boolean } | null;
	candidates: TargetCandidateSummary[];
	hint: string;
} {
	const current = sessionTargetDir
		? candidates.find(c => normalizeDirKey(c.dir) === normalizeDirKey(sessionTargetDir))
		: undefined;
	return {
		ok: true,
		target: current ? { project: current.projectName, dir: current.dir, runnable: current.runnable } : null,
		candidates: candidates.map(c => ({
			project: c.projectName,
			dir: c.dir,
			runnable: c.runnable,
			...(c.referencedAsLibraryBy ? { referencedAsLibraryBy: c.referencedAsLibraryBy } : {}),
		})),
		hint: current
			? '이 대상이 인자 없는 자동화 호출에 쓰입니다. 다른 프로젝트를 쓰려면 그 호출에 project/projectDir 를 직접 주세요.'
			: '고정된 대상이 없습니다 — 자동화 호출은 실행 가능 프로젝트가 유일할 때만 자동 결정되고, 그 밖에는 PROJECT_AMBIGUOUS 를 돌려줍니다.',
	};
}

/** `gpl.automation.operations` 목록 상한 — 기본 20, 1~100 으로 묶는다. */
export function clampOperationListLimit(limit: number | undefined): number {
	return Math.max(1, Math.min(limit ?? 20, 100));
}
