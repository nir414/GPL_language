/**
 * autoOnSave 의 순수 규칙 — 설정값(`gpl.quickCompile.autoOnSave`) 해석. 타이머·구독·배포 호출은 `autoOnSave.ts` 가
 * 맡는다. `deploy.ts` 에서 분할(2026-10-27). vscode 를 import 하지 않는다(Node 단독 테스트: test/activation/deploy/autoOnSaveRules.test.ts).
 */

/**
 * "auto"(기본): 제어기가 완전 STOP(쓰레드 없음)이고 /GPL/<project>가 존재할 때만 조용히 실행(AUTO_GATE).
 * "on"(구 true): 게이트 없이 항상 시도(활성 쓰레드 시 조용히 중단, /GPL 없으면 classic 폴백) / "off"(구 false): 사용 안 함.
 */
export type AutoOnSaveMode = 'off' | 'on' | 'auto';

/** 구버전 boolean 설정값 호환: true → "on", false → "off". 미설정 시 스키마 기본값 "auto". */
export function parseAutoOnSaveMode(raw: unknown): AutoOnSaveMode {
	if (raw === true || raw === 'on') { return 'on'; }
	if (raw === false || raw === 'off') { return 'off'; }
	return 'auto';
}
