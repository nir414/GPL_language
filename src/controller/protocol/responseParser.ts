/**
 * Brooks Controller 콘솔 응답 파서 — 배럴.
 *
 * 파서는 응답 종류별 모듈로 분리됐다(2026-10-27). 기존 import 경로(`protocol/responseParser`)와
 * 이름은 이 배럴이 그대로 유지한다. 새 코드는 필요한 모듈을 직접 import 해도 된다.
 *
 *  - statusParser · compileErrorParser · threadParser · stackParser · breakListParser · variableParser
 *  - errorLogParser(ErrorLog 파싱 + 에러 코드 분류) · runtimeConsoleLine(1403 라인 정규화)
 *  - gprParser · projectSelection · sourceCandidates · protocolText(공용 헬퍼, 비공개)
 */

export { NO_STATUS_CODE, parseStatus, isSuccess } from './statusParser';
export type { StatusResult } from './statusParser';
export { parseCompileErrors } from './compileErrorParser';
export type { CompileError } from './compileErrorParser';
export { SHOW_THREAD_LIST_CMD, SHOW_THREAD_LIST_STACK_CMD, parseThreadList, parseThreadDetail } from './threadParser';
export type { ThreadState, ThreadInfo, ThreadDetailInfo } from './threadParser';
export { parseErrorLog, parseControllerErrorEntry, describeErrorCategory, getGplErrorGroup, isControllerNonBlockingStatus, getErrorCodeHint, extractErrorCodeFromEntry, findKnownErrorChains, classifyErrorEntry } from './errorLogParser';
export type { ControllerErrorEntry, ErrorCodeCategory, ErrorCodeHint, GplErrorGroup, ErrorEntryClassification } from './errorLogParser';
export { parseGpr } from './gprParser';
export type { GprInfo } from './gprParser';
export { selectProjectFromCandidates } from './projectSelection';
export type { ProjectCandidate, ProjectSelection } from './projectSelection';
export { pickSourceCandidate } from './sourceCandidates';
export type { SourceCandidatePick } from './sourceCandidates';
export { parseStack } from './stackParser';
export type { StackFrameInfo } from './stackParser';
export { parseBreakList } from './breakListParser';
export type { BreakpointInfo } from './breakListParser';
export { parseVariable } from './variableParser';
export type { VariableInfo } from './variableParser';
export { latin1ToUtf8, isConsoleStatusEventFrame, normalizeConsoleLine } from './runtimeConsoleLine';
