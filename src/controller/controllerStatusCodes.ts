/**
 * Brooks 컨트롤러 STATUS 코드 상수 및 분류 헬퍼.
 *
 * 펌웨어에 의존하는 매직넘버(-742/-745/-746/-752/-508/-743 등)가 deployService와
 * extension.ts ftpRun에 흩어져 미묘히 다른 규칙으로 중복되어 있었다(검토 P5).
 * 이 모듈을 단일 정본으로 삼아 코드 식별을 일원화한다.
 *
 * 순수 모듈(외부 의존 없음)이라 Node 단독 단위 테스트가 가능하다.
 *
 * NOTE: 복구 "흐름"(Stop→Unload→Load→Compile 재시도)의 통합은 런타임/하드웨어
 * 동작을 바꾸는 고위험 작업이므로 별도 단계에서 다룬다. 이 모듈은 상수/분류만 모은다.
 */

/** 정상 완료. */
export const STATUS_OK = 0;

/** 컨트롤러 일시 사용 불가 / busy (재시도 대상). */
export const STATUS_CONTROLLER_BUSY = -752;

/** Compile 직후 일시적으로 나타날 수 있어 1회 재시도 대상인 STATUS. */
export const TRANSIENT_COMPILE_STATUS_CODES: ReadonlySet<number> = new Set([-742, -746, -752]);

/** 프로젝트가 이미 로드되어 있음 → Unload→Load→Compile 재시도 유도. */
export const STATUS_PROJECT_ALREADY_LOADED = -745;

/** 프로젝트가 로드되어 있지 않음. */
export const STATUS_PROJECT_NOT_LOADED = -508;

/** 프로젝트 경로가 없거나 유효하지 않음. */
export const STATUS_PROJECT_INVALID_PATH = -743;

/** "로드되어 있지 않음/경로 없음" 계열 → Unload 생략, Load→Compile 유도. */
export const PROJECT_NOT_LOADED_STATUS_CODES: ReadonlySet<number> = new Set([
    STATUS_PROJECT_NOT_LOADED,
    STATUS_PROJECT_INVALID_PATH,
]);

/** 컨트롤러 busy 상태인가. */
export function isBusyStatus(code: number): boolean {
    return code === STATUS_CONTROLLER_BUSY;
}

/** Compile 직후 일시적 STATUS(1회 재시도 대상)인가. */
export function isTransientCompileStatus(code: number): boolean {
    return TRANSIENT_COMPILE_STATUS_CODES.has(code);
}

/** 프로젝트가 이미 로드되어 있음 STATUS인가. */
export function isProjectAlreadyLoaded(code: number): boolean {
    return code === STATUS_PROJECT_ALREADY_LOADED;
}

/** 프로젝트가 로드되어 있지 않음/경로 없음 계열 STATUS인가. */
export function isProjectNotLoaded(code: number): boolean {
    return PROJECT_NOT_LOADED_STATUS_CODES.has(code);
}
