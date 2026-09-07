/**
 * 배포 결과 보고의 순수 규칙 — activation/deploy.ts `runDeployCore` 의 결과 보고부에서 분리(2026-09-07 §1-DB, 동작 동일).
 *
 * 무엇을 담는가:
 * - `SituationDeploySnapshot`: 트리(상황 요약)·오류 상세가 읽는 "마지막 배포 결과". 종전에는 views/controllerTreeProvider.ts 에
 *   정의돼 있어 생산자(controller/activation)가 views 를 import 했다 — 생산자 쪽으로 옮겨 의존 방향을 views → controller 로 맞췄다.
 * - 결과 서명(`buildDeployOutcomeSignature`)과 이력(`DeployOutcomeHistory`): 같은 결과 패턴이 반복되면 "회귀 아님" 주석을 붙인다.
 * - ErrorLog 분류 로그(`classifyDeployErrorLog`)·COMPILE 원문 로그(`buildCompileRawSectionLines`): Output 채널에 찍을 줄을
 *   그대로 만든다. 호출측은 줄마다 host.log 만 한다 — 문구·순서가 여기서 결정되므로 테스트로 고정할 수 있다.
 * - 실패 문구(`describeDeployFailure`): 4가지 분기(환경 블로커·컴파일 에러·시스템 경고만·미상)의 문구와
 *   "첫 컴파일 에러로 점프할지" 판정.
 *
 * vscode 무의존. deployService 타입은 `import type` 으로만 참조한다(런타임 의존 없음 → Node 단독 테스트 가능).
 */
import type { DeployResult } from './deployService';
import { classifyErrorEntry, extractErrorCodeFromEntry, getErrorCodeHint } from './responseParser';

/** 마지막 배포 결과 요약 — 트리의 "상황" 섹션과 오류 상세 보기가 읽는다. */
export interface SituationDeploySnapshot {
    mode: 'Build' | 'Deploy & Run' | 'Upload & Start';
    success: boolean;
    // 순서(2026-08-25 재배치): UPLOAD → STOP/THREAD_CHECK → COMPILE → START → ERROR_CHECK
    lastStage: 'LOCKED' | 'UPLOAD' | 'STOP' | 'THREAD_CHECK' | 'COMPILE_DEFERRED' | 'COMPILE' | 'START' | 'ERROR_CHECK' | 'SUCCESS';
    compileErrorCodes: number[];
    controllerSystemCodes: number[];
    updatedAt: number;
    summary: string;
    comparisonNote?: string;
    unverifiableReason?: string;
    compileRawSummary?: string[];
}

export type DeployOutcomeMode = SituationDeploySnapshot['mode'];

/** 중복 제거(순서 유지). */
export function uniqueCodes(values: readonly number[]): number[] {
    return [...new Set(values)];
}

/**
 * 결과 패턴 서명 — 성공/실패·단계·명령·STATUS·컴파일 에러 코드 집합·시스템 에러 코드 집합.
 * 같은 서명이 반복되면 "회귀가 아니라 같은 상황이 다시 관측됐다"고 본다(`comparisonNoteFor`).
 */
export function buildDeployOutcomeSignature(result: DeployResult, controllerSystemCodes: readonly number[]): string {
    const compileCodes = uniqueCodes(result.compileErrors.map(e => e.code)).sort((a, b) => a - b);
    const systemCodes = uniqueCodes(controllerSystemCodes).sort((a, b) => a - b);
    const status = typeof result.failedStatusCode === 'number' ? result.failedStatusCode : 'none';
    return [
        result.success ? 'success' : 'fail',
        result.failedPhase ?? 'SUCCESS',
        result.failedCommand ?? '-',
        `status:${status}`,
        `compile:${compileCodes.join(',') || 'none'}`,
        `system:${systemCodes.join(',') || 'none'}`,
    ].join('|');
}

/** COMPILE 시도별 한 줄 요약 — 스냅샷의 `compileRawSummary`. */
export function summarizeCompileAttempts(result: DeployResult): string[] {
    return result.compileAttemptLogs.map(attempt => {
        const firstLine = attempt.raw.replace(/\r/g, '').split('\n').map(l => l.trim()).find(Boolean) || '(empty)';
        const incompleteMeta = attempt.responseMeta && !attempt.responseMeta.responseComplete
            ? ` / responseComplete=false bytes=${attempt.responseMeta.bytesReceived} idle=${attempt.responseMeta.idleTimeoutMs}ms`
            : '';
        const note = attempt.note ? ` / note=${attempt.note}` : '';
        return `${attempt.command} / STATUS ${attempt.statusCode}${incompleteMeta}${note} / ${firstLine}`;
    });
}

export interface DeploySnapshotFields {
    mode: DeployOutcomeMode;
    success: boolean;
    lastStage: SituationDeploySnapshot['lastStage'];
    summary: string;
    compileErrorCodes: readonly number[];
    controllerSystemCodes: readonly number[];
    comparisonNote?: string;
    unverifiableReason?: string;
    compileRawSummary?: string[];
}

/** 스냅샷 조립 — 코드 목록은 중복 제거, 시각은 주입 가능(테스트). */
export function makeDeploySnapshot(fields: DeploySnapshotFields, now: number = Date.now()): SituationDeploySnapshot {
    return {
        mode: fields.mode,
        success: fields.success,
        lastStage: fields.lastStage,
        compileErrorCodes: uniqueCodes(fields.compileErrorCodes),
        controllerSystemCodes: uniqueCodes(fields.controllerSystemCodes),
        updatedAt: now,
        summary: fields.summary,
        comparisonNote: fields.comparisonNote,
        unverifiableReason: fields.unverifiableReason,
        compileRawSummary: fields.compileRawSummary,
    };
}

export interface DeployOutcomeRecord {
    mode: DeployOutcomeMode;
    signature: string;
    timestamp: number;
    summary: string;
}

/**
 * 세션 안의 배포 결과 이력(메모리 전용). 현재는 signature 만 중복 알림 억제에 쓰이고
 * mode/timestamp/summary 는 진단용 기록이다. 상한을 넘으면 오래된 것부터 버린다(장시간 세션 무한 증가 방지).
 */
export class DeployOutcomeHistory {
    private readonly entries: DeployOutcomeRecord[] = [];

    constructor(private readonly max: number = 50) {}

    /** 같은 서명이 지금까지 몇 번 기록됐는지 — 이번 결과를 `push` 하기 **전에** 묻는다. */
    countSame(signature: string): number {
        return this.entries.filter(h => h.signature === signature).length;
    }

    push(entry: DeployOutcomeRecord): void {
        this.entries.push(entry);
        while (this.entries.length > this.max) {
            this.entries.shift();
        }
    }

    get size(): number {
        return this.entries.length;
    }
}

/** 같은 패턴이 이전에 있었으면 "회귀 아님" 주석(성공 경로는 '결과', 실패 경로는 '실패' 패턴으로 표기). */
export function comparisonNoteFor(sameCount: number, kind: 'result' | 'failure'): string | undefined {
    if (sameCount <= 0) { return undefined; }
    return `회귀 아님: 동일 ${kind === 'failure' ? '실패' : '결과'} 패턴 ${sameCount + 1}회 관측`;
}

export interface ErrorLogClassification {
    /** 제어기 환경·시스템 항목 수(GPL 코드와 무관). */
    sysCount: number;
    /** 코드/배포 에러 항목 수. */
    deployErrCount: number;
    /** Output 채널에 찍을 줄(빈 줄·머리·꼬리 포함). errorLog 가 비면 빈 배열. */
    lines: string[];
}

/**
 * ErrorLog 를 제어기 시스템 에러 / GPL 배포 에러로 분류해 출력 줄을 만든다(성공·실패 경로 공통).
 * 같은 코드가 연달아 나오면(예: Trj/AutoEx 동시 -1600) 부가 설명(detail/해석/권장)은 코드당 한 번만 붙인다 — 로그 부풀림 방지.
 */
export function classifyDeployErrorLog(errorLog: readonly string[]): ErrorLogClassification {
    let sysCount = 0;
    let deployErrCount = 0;
    const lines: string[] = [];
    if (errorLog.length === 0) { return { sysCount, deployErrCount, lines }; }

    lines.push('');
    lines.push('── [ErrorLog 분류] ──────────────────────────────────────');
    const printedNotes = new Set<string>();
    for (const entry of errorLog) {
        const c = classifyErrorEntry(entry);
        const code = extractErrorCodeFromEntry(entry) ?? c.parsedCode;
        const hint = typeof code === 'number' ? getErrorCodeHint(code) : undefined;
        const noteKey = typeof code === 'number' ? `code:${code}` : `text:${c.summary}`;
        const firstOfCode = !printedNotes.has(noteKey);
        printedNotes.add(noteKey);
        if (c.isControllerSystem) {
            sysCount++;
            lines.push(`[⚠ 환경 경고] ${typeof code === 'number' ? `[${code}] ` : ''}${c.summary}`);
            if (firstOfCode) {
                if (c.detail) { lines.push(`          ${c.detail}`); }
                if (hint) {
                    lines.push(`          해석: ${hint.meaning}`);
                    lines.push(`          권장: ${hint.action}`);
                }
            }
        } else {
            deployErrCount++;
            lines.push(`[✘ 코드/배포 에러] ${typeof code === 'number' ? `[${code}] ` : ''}${c.summary}`);
            if (firstOfCode && hint) {
                lines.push(`          해석: ${hint.meaning}`);
                lines.push(`          권장: ${hint.action}`);
            }
        }
    }
    lines.push('─────────────────────────────────────────────────────────');
    return { sysCount, deployErrCount, lines };
}

/** COMPILE 원문 로그 섹션 줄 — 시도가 없으면 빈 배열. 응답이 미완결이면 responseMeta 4줄을 덧붙인다. */
export function buildCompileRawSectionLines(result: DeployResult): string[] {
    const lines: string[] = [];
    if (result.compileAttemptLogs.length === 0) { return lines; }
    lines.push('');
    lines.push('── [COMPILE 원문 로그] ──────────────────────────────────');
    for (const attempt of result.compileAttemptLogs) {
        lines.push(`[${attempt.command}] STATUS ${attempt.statusCode}`);
        if (attempt.note) {
            lines.push(`  note: ${attempt.note}`);
        }
        if (attempt.responseMeta && (!attempt.responseMeta.responseComplete || !attempt.responseMeta.statusTagReceived || !attempt.responseMeta.dataTagClosed)) {
            lines.push(`  responseComplete=${attempt.responseMeta.responseComplete}`);
            lines.push(`  bytesReceived=${attempt.responseMeta.bytesReceived}`);
            lines.push(`  lastChunkAt=${attempt.responseMeta.lastChunkAt}`);
            lines.push(`  idleTimeoutMs=${attempt.responseMeta.idleTimeoutMs}`);
        }
        lines.push(attempt.raw || '(empty)');
        for (const ce of attempt.errors) {
            lines.push(`  -> ${ce.file}:${ce.line} (${ce.code}) ${ce.message}`);
        }
    }
    if (result.precheckWarnings.length > 0) {
        lines.push('  precheckWarnings:');
        for (const w of result.precheckWarnings) {
            lines.push(`  - ${w}`);
        }
    }
    lines.push('─────────────────────────────────────────────────────────');
    return lines;
}

/** ErrorLog 중 제어기 시스템 항목만(실패 경로의 "배포 원인 아님" 집계용). */
export function controllerSystemErrorEntries(errorLog: readonly string[]): string[] {
    return errorLog.filter(e => classifyErrorEntry(e).isControllerSystem);
}

/** 항목들의 파싱된 에러 코드(숫자만). */
export function parsedErrorCodes(entries: readonly string[]): number[] {
    return entries
        .map(e => classifyErrorEntry(e).parsedCode)
        .filter((code): code is number => typeof code === 'number');
}

export interface DeployFailureDescription {
    /** 사용자 알림·스냅샷 summary 에 그대로 쓰는 문구(comparisonNote·원격 경로 접미 포함). */
    message: string;
    lastStage: SituationDeploySnapshot['lastStage'];
    /** COMPILE 단계 실패 + 시스템 에러 동반 → 코드 수정 효과를 검증할 수 없는 사유. */
    unverifiableReason?: string;
    /** 컴파일 에러 분기 — 호출측이 첫 에러 위치로 점프(jumpToFirstCompileError)한다. */
    jumpToCompileErrors: boolean;
}

/**
 * 실패 문구 결정. 분기 순서가 뜻을 갖는다:
 * ① COMPILE 단계 + 시스템 에러 → 환경 블로커(코드 수정 효과 검증 불가) ② 컴파일 에러 있음 ③ ErrorLog 전체가 시스템 에러 →
 * "GPL 코드 오류 없음" 명시 ④ 그 외 미상. 이어서 comparisonNote·선택된 원격 경로를 접미로 붙인다.
 */
export function describeDeployFailure(
    result: DeployResult,
    sysErrors: readonly string[],
    comparisonNote: string | undefined,
): DeployFailureDescription {
    const phaseLabel = result.failedPhase ? ` (${result.failedPhase} 단계)` : '';
    const sysLabel = sysErrors.length > 0
        ? ` / 제어기 시스템 경고 ${sysErrors.length}건 (배포 원인 아님)`
        : '';
    const envBlocking = (result.failedPhase === 'COMPILE') && sysErrors.length > 0;
    const unverifiableReason = envBlocking ? '제어기 환경 오류가 COMPILE 단계에 존재' : undefined;
    const commandLabel = result.failedCommand ? ` / ${result.failedCommand}` : '';
    const statusLabel = typeof result.failedStatusCode === 'number'
        ? ` / STATUS ${result.failedStatusCode}${result.failedStatusMessage ? ` (${result.failedStatusMessage})` : ''}`
        : '';

    let message: string;
    let jumpToCompileErrors = false;
    if (envBlocking) {
        message = `코드 수정 효과 검증 불가: COMPILE 환경 블로커 감지${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
    } else if (result.compileErrors.length > 0) {
        message = `${result.compileErrors.length}개 컴파일 에러${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
        jumpToCompileErrors = true;
    } else if (sysErrors.length > 0 && result.errorLog.length === sysErrors.length) {
        // 에러 로그 전체가 제어기 시스템 에러인 경우 — GPL 코드 원인 없음을 명시
        const firstSys = classifyErrorEntry(sysErrors[0]);
        message = `${result.failedPhase ?? '단계 미상'} 단계 실패${commandLabel}${statusLabel} — GPL 코드 오류 없음, 제어기 시스템 경고 ${sysErrors.length}건: ${firstSys.summary}`;
    } else {
        message = `알 수 없는 오류${phaseLabel}${commandLabel}${statusLabel}${sysLabel} — COMPILE 원문 로그 확인`;
    }
    if (comparisonNote) {
        message = `${message} / ${comparisonNote}`;
    }
    if (result.selectedRemoteProjectPath) {
        message = `${message} / 경로: ${result.selectedRemoteProjectPath}`;
    }
    return {
        message,
        lastStage: (result.failedPhase ?? 'COMPILE') as SituationDeploySnapshot['lastStage'],
        unverifiableReason,
        jumpToCompileErrors,
    };
}
