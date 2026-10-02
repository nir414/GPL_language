/**
 * 「오류 상세」 보고서 렌더링 — vscode 무의존 순수 모듈.
 *
 * 종전에는 `gpl.controller.showErrorDetail` 이 Output 에 찍는 보고서와 `gpl.controller.copyError` 가 클립보드에 넣는
 * 텍스트가 **다른 재료**였다. 복사는 트리 항목의 툴팁(쓰레드 행 4~6줄, 에러 항목 1~3줄)만 담아 채팅·이슈에 붙이면
 * 스택·시각·분류·직전 사건이 다 빠졌다(2026-09-21 사용자 지적 "내용이 너무 적다"). 이제 두 경로가 같은 입력을
 * 같은 렌더러로 그린다 — 보이는 것과 복사되는 것이 같다(§1-EA).
 *
 * 재료 수집(1402 `Show Stack`/`Show Thread`, .gpr, 링버퍼)은 접착 계층(`activation/controllerCommands`)이 하고,
 * 여기는 **모은 사실을 마크다운 줄로 옮기기만** 한다. 모르는 값은 "(미확인)" 으로 적고 지어내지 않는다(하드 규칙 3).
 */

import type { ControllerEvent } from './recentEvents';
import { formatControllerEvent } from './recentEvents';
import type { ErrorCodeCategory, ErrorCodeHint } from './responseParser';
import { describeErrorCategory } from './responseParser';

export interface ErrorReportLocation {
    file: string;
    line: number;
    procedure?: string;
}

/** 보고서 재료 — 전부 관측값. 없는 것은 undefined/빈 배열로 두면 렌더러가 "(미확인)" 으로 적는다. */
export interface ErrorReportInput {
    /** ErrorLog 원문 한 줄(`09-21-2026 10:04:49.135, GenAdp, -757, "*Object not instantiated*"`). */
    raw?: string;
    code?: number;
    category: ErrorCodeCategory;
    /** 문서상 그룹 이름(`getGplErrorGroup`). */
    groupTitle?: string;
    hint?: ErrorCodeHint;
    threadName?: string;
    threadState?: string;
    /** 쓰레드의 마지막 STATUS 문구(`-757 *Object not instantiated*` 등). */
    threadStatus?: string;
    project?: string;
    /** `.gpr` 의 ProjectStart 원문. */
    projectStart?: string;
    lastCommand?: string;
    firstSeenAt?: string;
    /** 최상단 프레임 위치(있으면 클릭이 여기로 이동한다). */
    location?: ErrorReportLocation;
    /** `"Init @ LineBuffer.gpl:69"` 형식, 안쪽 → 바깥쪽. */
    stackLines: readonly string[];
    relatedFunctions: readonly string[];
    /** `describeStartProcedureMismatch` 결과(없으면 생략). */
    startMismatch?: string;
    recentEvents: readonly ControllerEvent[];
    extensionVersion: string;
    /** 보고서 생성 시각(ms). 테스트용 주입. */
    now?: number;
    /** 테스트용 시각 포맷터. */
    formatTime?: (ms: number) => string;
}

const NA = '(미확인)';

function defaultStamp(ms: number): string {
    return new Date(ms).toLocaleString();
}

/**
 * 보고서 본문(구분선 없음). Output 에는 `host.report` 가 구분선을 둘러 찍고, 클립보드에는 이 줄들을 `\n` 으로 이어 넣는다.
 * 마크다운이라 채팅·이슈에 그대로 붙는다.
 */
export function renderErrorReport(i: ErrorReportInput): string[] {
    const fmt = i.formatTime ?? defaultStamp;
    const out: string[] = [];
    const title = typeof i.code === 'number'
        ? `## 오류 상세 — ${i.threadName || i.project || 'GPL'} ${i.code}${i.threadStatus ? ` ${stripCode(i.threadStatus, i.code)}` : ''}`
        : `## 오류 상세 — ${i.threadName || i.project || 'GPL'}`;
    out.push(title.trimEnd());
    out.push(`- 원문: ${i.raw?.trim() || '(없음)'}`);
    out.push(`- 코드: ${typeof i.code === 'number' ? i.code : NA}`);
    out.push(`- 분류: ${describeErrorCategory(i.category)}${i.groupTitle ? ` (문서상 ${i.groupTitle})` : ''}`);
    out.push(`- 에러 스레드: ${i.threadName || NA}${i.threadState ? ` (${i.threadState}${i.threadStatus ? ` · ${i.threadStatus}` : ''})` : ''}`);
    if (i.project || i.projectStart) {
        out.push(`- 프로젝트: ${i.project || NA}${i.projectStart ? ` · ProjectStart="${i.projectStart}"` : ''}`);
    }
    out.push(`- 위치: ${i.location ? `${i.location.file}:${i.location.line}${i.location.procedure ? ` (${i.location.procedure})` : ''}` : NA}`);
    out.push(`- 직전 실행 명령: ${i.lastCommand || NA}`);
    out.push(`- 첫 에러 시각: ${i.firstSeenAt || NA}`);
    if (i.hint) {
        out.push(`- 해석: ${i.hint.title} — ${i.hint.meaning}`);
        out.push(`- 권장: ${i.hint.action}`);
    }
    if (i.code === -782) {
        out.push('- -782 후보: 초기화 안 된 필드, 생성자 누락, getter에서 Nothing 반환 경로 점검');
    }
    if (i.startMismatch) {
        out.push(`- ${i.startMismatch}`);
    }

    out.push('');
    out.push('### 호출 경로/프레임 (안쪽 → 바깥쪽)');
    if (i.stackLines.length === 0) {
        out.push('- (스택 정보 없음)');
    } else {
        i.stackLines.forEach((s, idx) => out.push(`- ${idx}: ${s}`));
    }

    out.push('');
    out.push('### 관련 함수');
    if (i.relatedFunctions.length === 0) {
        out.push('- (식별 실패)');
    } else {
        for (const fn of i.relatedFunctions) { out.push(`- ${fn}`); }
    }

    out.push('');
    out.push('### 직전 제어기 사건 (최근 10건)');
    if (i.recentEvents.length === 0) {
        out.push('- (기록 없음)');
    } else {
        for (const ev of i.recentEvents) { out.push(`- ${formatControllerEvent(ev, i.formatTime)}`); }
    }

    out.push('');
    out.push(`_GPL Language Support v${i.extensionVersion} · ${fmt(i.now ?? Date.now())}_`);
    return out;
}

/** 쓰레드 STATUS 문구에서 앞의 코드 숫자를 뗀다 — 제목에 `-757 -757 *…*` 처럼 겹치지 않게. */
function stripCode(status: string, code: number): string {
    return status.replace(new RegExp(`^\\s*${code}\\s*`), '').trim();
}
