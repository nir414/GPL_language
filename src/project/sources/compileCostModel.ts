/**
 * 컴파일 메모리 추정 모델 — 선언 구조(`memberScan`)에 실측 단가를 곱해 제어기 `Compile` 이 쓸 메모리를 어림한다.
 * vscode·fs 무의존 순수 모듈. **추정**이다 — 보고·비교용이며 판정(성공/실패)에는 쓰지 않는다.
 *
 * 단가 출처: Sample Prep 제어기 메모리 비용 실측 보고서(2026-11-06, 테스트 제어기 GPL 4.2K5 계열, 변형 소스를 하나씩 Compile 해
 * Free 차이를 잰 값, 같은 프로브 두 번 ±1 %). 그 보고서는 이 단가로 PaL·Gantry·App 을 세어 4.23 MB, 실측 4.20 MB 를 얻었다.
 * 펌웨어가 다르면 값이 달라질 수 있다 — 문서 `docs/gpl-language/memory-costs.md` 와 같은 표다.
 */

import { scanSourceMembers } from './memberScan';
import type { ScannedSource, SourceMember } from './memberScan';

/** 실측 단가(바이트). */
export const COMPILE_COST = {
    /** 문장 평균(단순 문장 66 · 호출 59 · If 117 · 로그 줄 140 — 보고서가 전체 합을 맞춘 평균). */
    statement: 85,
    /** 빈 Sub. */
    procedureHead: 165,
    /** 첫 매개변수(인자 1개 빈 Sub 386 − 165). */
    firstParameter: 221,
    /** 그다음 매개변수 하나((691 − 386) / 3). */
    extraParameter: 102,
    /** Function 이 Sub 보다 더 드는 몫(보고서 요약값 +180 B — `Return` 줄은 문장으로 따로 센다. 이 값으로 Sample Prep 원본 추정 4.09 MB, 실측 4.13 MB). */
    functionExtra: 180,
    /** 지역 `Dim`. */
    localDim: 87,
    /** 모듈·클래스 변수 하나. */
    variable: 78,
    /** `Const … As Integer`(String 은 리터럴 글자 수만큼 더 — 25자 205 B). */
    constant: 150,
    stringConstantBase: 180,
    /** Class 껍데기(필드 1 + 빈 New 430 − 78 − 165). */
    classShell: 187,
    /** Module 껍데기(빈 Sub 하나 있는 Module 354 − 165). */
    moduleShell: 189,
} as const;

function parameterCost(n: number): number {
    return n <= 0 ? 0 : COMPILE_COST.firstParameter + (n - 1) * COMPILE_COST.extraParameter;
}

/** 선언 하나의 추정(자식 선언은 따로 센다 — 클래스는 껍데기만). */
export function estimateMemberCompileBytes(m: SourceMember, constantText = ''): number {
    switch (m.kind) {
        case 'sub':
        case 'function':
        case 'property': {
            const dims = m.locals?.length ?? 0;
            const statements = Math.max(0, (m.statements ?? 0) - dims);
            return COMPILE_COST.procedureHead + parameterCost(m.params ?? 0)
                + (m.kind === 'sub' ? 0 : COMPILE_COST.functionExtra)
                + statements * COMPILE_COST.statement + dims * COMPILE_COST.localDim;
        }
        case 'delegate':
            return COMPILE_COST.procedureHead;
        case 'variable':
            return m.names.length * COMPILE_COST.variable;
        case 'const': {
            const literal = /"((?:[^"]|"")*)"/.exec(constantText);
            return m.names.length * (literal ? COMPILE_COST.stringConstantBase + literal[1].length : COMPILE_COST.constant);
        }
        case 'class':
            return COMPILE_COST.classShell;
    }
}

/** 이미 읽은 구조로 파일 하나를 어림한다. 구조를 못 읽은 파일은 코드 줄 × 문장 평균. */
export function estimateScannedCompileBytes(scan: ScannedSource, text: string): number {
    if (scan.irregular) { return countCodeLines(text) * COMPILE_COST.statement; }
    const raw = text.split(/\r\n|\n|\r/);
    let total = scan.moduleSpans.length * COMPILE_COST.moduleShell;
    for (const m of scan.members) {
        total += estimateMemberCompileBytes(m, m.kind === 'const' ? raw.slice(m.startLine, m.endLine + 1).join(' ') : '');
    }
    return total;
}

/** 소스 텍스트 하나의 컴파일 메모리 추정(바이트). */
export function estimateSourceCompileBytes(text: string): number {
    return estimateScannedCompileBytes(scanSourceMembers(text), text);
}

function countCodeLines(text: string): number {
    return text.split(/\r\n|\n|\r/).filter(l => { const t = l.trim(); return t !== '' && !t.startsWith("'"); }).length;
}
