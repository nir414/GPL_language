/**
 * 배포 명령 그룹이 공유하는 컨텍스트 — `deploy.ts` 의 `activateDeployCommands` 한 함수(1,488줄)를 형제 모듈로
 * 분할하면서(2026-10-27) 그 클로저가 암묵적으로 붙잡던 상태를 **명시적 객체** 로 옮긴 것이다. 형제 모듈의
 * 함수는 모두 이 객체를 첫 인자로 받는다.
 *
 * - `host`: 확장 허브(로그·트리·상태바·컴파일 검증 상태·세션 대상·배포 잠금).
 * - `quickCompilePendingFiles`: autoOnSave 가 저장 직후 모아 두는 파일 집합. 수동 배포(`runDeploy`)와 자동화의
 *   미저장 처리(`deployAutomation`)가 방금 저장한 파일을 여기서 지워 중복 컴파일을 막는다 — 세 모듈이 함께
 *   쓰는 유일한 가변 집합이라 컨텍스트에 둔다. 디바운스 타이머·진행 중 플래그는 `autoOnSave.ts` 안에만 있다.
 * - `deployOutcomeHistory`·`seenErrorLogEntries`: 결과 보고(`deployReport`·`errorLogNotice`)의 중복 억제 상태.
 *
 * vscode 를 import 하지 않는다 — 타입과 순수 이력 객체만 담는다.
 */

import { DeployOutcomeHistory } from '../../controller/deployment/deployOutcome';
import type { ExtensionHost } from '../host';

export type QuickDeployOpts = {
	skipStop?: boolean; skipUnchanged?: boolean; quick?: boolean; changedFiles?: string[];
	overrideProjectDir?: string; noStopPrompt?: boolean; autoGate?: boolean; skipCompile?: boolean; nonInteractive?: boolean;
	uploadOnly?: boolean;
	/** 여러 프로젝트를 차례로 올리는 묶음의 한 건 — 프로젝트별 성공 토스트를 생략하고 묶음이 끝난 뒤 한 번 요약한다. */
	inBatch?: boolean;
	/** 자동화 호출자가 사용자에게 Start 모션 확인을 이미 받았음. 배포 내부의 중복 확인 모달도 생략한다. */
	startConfirmed?: boolean;
	/**
	 * 같은 키의 배포가 진행 중이면 새로 시작하지 않는다(개선안 §10). 자동화 호출자(MCP)가 넘긴다 —
	 * 브리지 응답 대기가 끊긴 뒤의 재시도가 두 번째 배포를 만드는 것을 막는다.
	 */
	idempotencyKey?: string;
	/** 배포 전처리 호출 단위 덮어쓰기(자동화 인자 `preprocess`) — deployTypes.DeployOptions.preprocessOverride 로 그대로 간다. */
	preprocessOverride?: unknown;
};

export interface DeployContext {
	readonly host: ExtensionHost;
	/** autoOnSave pending 저장 파일 — 다른 경로가 같은 파일을 올리면 여기서 지워 중복 컴파일을 막는다. */
	readonly quickCompilePendingFiles: Set<string>;
	/** 배포 결과 이력 — signature 만 중복 알림 억제에 쓴다(상한 50, 규칙은 controller/deployment/deployOutcome.ts). */
	readonly deployOutcomeHistory: DeployOutcomeHistory;
	/**
	 * 성공 배포 알림에서 이미 본 ErrorLog 항목(제어기 IP별) — 제어기는 ErrorLog 를 지울 때까지 보존하므로 그대로 알리면
	 * 배포마다 같은 경고가 반복된다(2026-10-21 Sample Prep). 매 배포의 ErrorLog 전체로 **대체**하므로 크기는 로그 길이를 넘지 않는다.
	 */
	readonly seenErrorLogEntries: Map<string, Set<string>>;
}

export function createDeployContext(host: ExtensionHost): DeployContext {
	return {
		host,
		quickCompilePendingFiles: new Set<string>(),
		deployOutcomeHistory: new DeployOutcomeHistory(50),
		seenErrorLogEntries: new Map<string, Set<string>>(),
	};
}
