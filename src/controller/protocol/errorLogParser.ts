/**
 * 제어기 ErrorLog 응답 파서와 에러 코드 분류.
 *
 * 책임: ErrorLog 항목 추출·파싱, 에러 코드 그룹/힌트/체인, 코드 오류·환경 오류 분류.
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

/**
 * `ErrorLog` 응답에서 에러 메시지 목록 추출.
 * 활성 에러가 없으면 빈 배열 반환.
 */
export function parseErrorLog(text: string): string[] {
    const clean = text
        .replace(/\0/g, '')           // NUL 바이트 제거
        .replace(/<\/?DATA>/g, '')
        .replace(/<STATUS>[^<]*<\/STATUS>/g, '')
        .trim();

    if (/no\s+(active\s+)?error/i.test(clean)) {
        return [];
    }

    return clean.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

// ─── Error Log Classification ──────────────────────────────

export interface ControllerErrorEntry {
    timestamp: string;
    source: string;
    code: number;
    message: string;
}

/**
 * ErrorLog 한 줄을 구조 파싱한다.
 * 형식: `MM-DD-YYYY HH:MM:SS.mmm, Source, code, "message"`
 */
export function parseControllerErrorEntry(entry: string): ControllerErrorEntry | null {
    const m = entry.match(/^(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\.\d{3}),\s*([^,]+),\s*(-?\d+),\s*"?([^"]*)"?$/);
    if (!m) { return null; }
    return {
        timestamp: m[1],
        source: m[2].trim(),
        code: Number(m[3]),
        message: m[4].trim(),
    };
}

/**
 * 알려진 제어기 시스템 에러 코드.
 * 이 코드들은 GPL 코드 동작과 무관하며 /flash/config 또는 하드웨어 환경 문제다.
 * 출처: Brooks Automation GDE ErrorCode 문서.
 */
const CONTROLLER_SYSTEM_ERROR_CODES: Record<number, string> = {
    [-1521]: 'controller /flash/config *.pac 파일 형식/로드 문제',
    [-1520]: 'controller /flash/config parameter DB 파일 누락 또는 열기 실패',
    [-1519]: 'parameter DB 초기화 실패',
    [-1518]: 'parameter DB 버전 불일치',
};

const CONTROLLER_NON_BLOCKING_STATUS_CODES = new Set<number>([-1521, -1520, -1519, -1518]);

export type ErrorCodeCategory = 'environment' | 'code' | 'unknown';

export interface ErrorCodeHint {
    code: number;
    title: string;
    meaning: string;
    action: string;
    category: ErrorCodeCategory;
}

/**
 * GPL 에러 코드 **그룹** — 공식 문서의 범위 표가 정본이다.
 * https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Error_Code/Error_Intro.htm
 * (2026-09-21 확인. 개별 코드 페이지 `language_errors.htm` 등이 각 범위의 항목을 싣는다.)
 *
 * 종전에는 코드별 힌트 표(-782·-508·-2)에 있는 것만 "코드 오류"로 보고 **나머지 전부를 환경 경고**로 떨어뜨렸다.
 * 그래서 `-757 Object not instantiated`·`-700 Thread execution aborted` 처럼 명백한 GPL 코드 오류가
 * `⚠ 환경 경고` 로 표시됐다(2026-09-21 사용자 지적). 범위 표를 쓰면 코드가 하나 늘 때마다 표를 고칠 필요가 없다.
 *
 * `category` 는 **사람이 어디부터 봐야 하는가**다 — `code` 는 GPL 소스, `environment` 는 제어기 환경,
 * `unknown` 은 문서 그룹만으로는 갈리지 않아(로봇·네트워크·비전) 단정하지 않는 자리다.
 */
export interface GplErrorGroup {
    /** 포함 범위(둘 다 음수, min <= max). */
    min: number;
    max: number;
    /** 문서의 그룹 이름(문서상 표기). */
    title: string;
    category: ErrorCodeCategory;
}

const GPL_ERROR_GROUPS: readonly GplErrorGroup[] = [
    { min: -299, max: -200, title: 'Standard System Errors', category: 'environment' },
    { min: -499, max: -300, title: 'Hardware Device Related Errors', category: 'environment' },
    { min: -699, max: -500, title: 'Input and Output Errors', category: 'code' },
    { min: -999, max: -700, title: 'Language Related Errors', category: 'code' },
    { min: -1499, max: -1000, title: 'Robot Related Errors', category: 'unknown' },
    { min: -1599, max: -1500, title: 'Configuration Parameter Database, Datalogger, and CPU Monitor Errors', category: 'environment' },
    { min: -1699, max: -1600, title: 'Controller Errors', category: 'environment' },
    { min: -1799, max: -1700, title: 'Network, Socket, and Communication Errors', category: 'unknown' },
    { min: -2999, max: -2000, title: 'GPL 응용 프로그램 전용 범위(사용자 Throw)', category: 'code' },
    { min: -3999, max: -3000, title: 'Servo Related Errors', category: 'environment' },
    { min: -4100, max: -4000, title: 'Vision Related Errors', category: 'unknown' },
];

/** 분류의 사람이 읽는 라벨 — 트리 설명·오류 상세 보고서가 같은 말을 쓰게 하는 정본. */
export function describeErrorCategory(category: ErrorCodeCategory): string {
    return category === 'code' ? '코드 오류'
        : category === 'environment' ? '제어기 환경'
        : '분류 미상';
}

/** 코드가 속한 문서 그룹. 표에 없는 코드(예: 0 이상, 미정의 구간)는 undefined. */
export function getGplErrorGroup(code: number): GplErrorGroup | undefined {
    return GPL_ERROR_GROUPS.find(g => code >= g.min && code <= g.max);
}

const ERROR_CODE_HINTS: Record<number, Omit<ErrorCodeHint, 'code'>> = {
    [-1521]: {
        title: 'Controller 환경 이슈',
        meaning: 'Invalid parameter DB file not loaded (/flash/config *.pac 로드/형식 문제)',
        action: 'GPL 코드 수정보다 제어기 환경(파라미터 DB/펌웨어/파일) 진단을 먼저 수행',
        category: 'environment',
    },
    [-1520]: {
        title: 'Controller 환경 이슈',
        meaning: 'Parameter DB 파일 누락 또는 열기 실패',
        action: '/flash/config DB 파일 존재·권한·무결성 확인 후 재시도',
        category: 'environment',
    },
    [-1519]: {
        title: 'Controller 환경 이슈',
        meaning: 'Parameter DB 초기화 실패',
        action: '제어기 초기화 상태/버전 정합성/스토리지 상태를 점검',
        category: 'environment',
    },
    [-1518]: {
        title: 'Controller 환경 이슈',
        meaning: 'Parameter DB 버전 불일치',
        action: '컨트롤러/DB 버전 매칭 및 배포 환경 정합성 확인',
        category: 'environment',
    },
    [-757]: {
        title: 'Object not instantiated',
        meaning: '객체 블록이 할당되지 않은 상태에서 그 필드/멤버에 접근했다(문서: Language Related Errors)',
        action: 'New 로 생성했는지, 생성 전에 쓰이지 않는지 확인. Start 직후 스택이 `Init` 한 프레임이면 원인은 '
            + '클래스 메서드 이름 `Init` — 모듈 초기화가 시작 프로시저보다 먼저 이름으로 찾아 인스턴스 없이 부른다'
            + '(문서 GPL/modules.htm · 2026-09-21 실기 재현 samples/init-probe). 다른 이름(InitDefaults 등)으로 바꿀 것',
        category: 'code',
    },
    [-782]: {
        title: 'Object value is Nothing',
        meaning: '객체/참조값 초기화 누락 가능성이 큼',
        action: '사용 전 객체 생성/할당 여부, null 경로, 조건 분기 초기화 점검',
        category: 'code',
    },
    [-508]: {
        title: 'File not found',
        meaning: '파일/프로젝트 경로를 찾지 못함',
        action: '경로, FTP 디렉터리 존재, 파일명 대소문자/오탈자, 권한을 확인',
        category: 'code',
    },
    // ── 컴파일러 오류(2026-10-25 실기 컴파일, inbox gpl-overload-return-type-and-new-parens) ──
    // 소스 줄을 보고 고르는 안내는 controller/deployment/compileErrorHints 가 이 action 을 그대로 쓴다.
    [-741]: {
        title: 'Argument mismatch',
        meaning: '인자 개수·형식이 선언과 맞지 않는다. 함수 선언 줄에서 나면 같은 이름의 오버로드끼리 반환형이 다른 경우다(GPL 은 반환형이 다른 오버로드를 받지 않는다)',
        action: '선언 줄이면 같은 이름 오버로드의 반환형이 다른지 확인하고 이름을 나눌 것(인자 수만 다르고 반환형이 같은 오버로드는 된다). 뒤따르는 -733/-773 은 이 오류의 파생일 가능성이 크다',
        category: 'code',
    },
    [-722]: {
        title: 'Unexpected text at end of line',
        meaning: '문장 끝에 해석할 수 없는 글자가 남았다',
        action: '`New X()` 줄이면 클래스 X 에 `Sub New` 가 있는지 확인 — 없으면 괄호 없이 `New X` 로 쓰거나 `Public Sub New()` 를 선언할 것(내장 클래스는 괄호 가능)',
        category: 'code',
    },
    [-733]: {
        title: 'Not a top-level statement',
        meaning: '모듈·클래스 최상위에 올 수 없는 문장이다. 앞선 선언이 깨지면 그 본문 전체가 이렇게 보고된다',
        action: '같은 파일의 앞선 오류(-741 등)부터 고칠 것 — 파생 오류이면 함께 사라진다',
        category: 'code',
    },
    [-773]: {
        title: 'Missing module end',
        meaning: '블록 끝(End …)의 짝이 맞지 않는다. 앞선 선언이 깨지면 그 함수의 `End Function` 이 이렇게 보고된다',
        action: '같은 파일의 앞선 오류(-741 등)부터 고칠 것 — 파생 오류이면 함께 사라진다',
        category: 'code',
    },
    [-737]: {
        title: 'Too many errors',
        meaning: '컴파일러가 파일당 약 20개 오류에서 보고를 끊었다',
        action: '이 파일의 남은 오류와 뒤따르는 파일의 오류는 다음 컴파일에서야 보일 수 있다 — 보이는 오류를 고친 뒤 다시 컴파일할 것',
        category: 'code',
    },
    [-2]: {
        title: 'Command/Runtime failure',
        meaning: '선행 실패의 연쇄로 발생할 수 있는 일반 실패 코드',
        action: '직전 에러(예: -782, -508)부터 역추적해 원인 제거',
        category: 'code',
    },
};

const KNOWN_ERROR_CHAINS: number[][] = [
    [-782, -508, -2],
    [-782, -2],
    [-508, -2],
];

export function isControllerNonBlockingStatus(code: number): boolean {
    return CONTROLLER_NON_BLOCKING_STATUS_CODES.has(code);
}

export function getErrorCodeHint(code: number): ErrorCodeHint | undefined {
    const hint = ERROR_CODE_HINTS[code];
    if (!hint) { return undefined; }
    return { code, ...hint };
}

export function extractErrorCodeFromEntry(entry: string): number | undefined {
    const parsed = parseControllerErrorEntry(entry);
    if (parsed) {
        return parsed.code;
    }

    const statusMatch = entry.match(/STATUS\s*(-?\d+)/i);
    if (statusMatch) {
        return Number(statusMatch[1]);
    }

    const parenMatch = entry.match(/\((-?\d+)\)/);
    if (parenMatch) {
        return Number(parenMatch[1]);
    }

    const rawCode = entry.match(/(^|[^\d-])(-\d{1,5})(?=[^\d]|$)/);
    if (rawCode) {
        return Number(rawCode[2]);
    }

    return undefined;
}

export function findKnownErrorChains(codes: number[]): string[] {
    if (codes.length < 2) { return []; }

    const found: string[] = [];
    for (const chain of KNOWN_ERROR_CHAINS) {
        let idx = 0;
        for (const code of codes) {
            if (code === chain[idx]) {
                idx++;
                if (idx === chain.length) {
                    found.push(chain.join(' → '));
                    break;
                }
            }
        }
    }
    return found;
}

export interface ErrorEntryClassification {
    /**
     * true = GPL 코드 오류로 **단정하지 않은** 항목 — 제어기 환경·시스템 문제이거나 분류 미상.
     * 트리의 「코드 오류 / 환경 경고」 분리가 이 값을 쓴다. 정확한 분류는 `category` 를 본다.
     */
    isControllerSystem: boolean;
    /** 문서 범위 표 기준 분류(`getGplErrorGroup`). 코드를 못 읽었으면 'unknown'. */
    category: ErrorCodeCategory;
    /** 문서상 그룹 이름(있으면). */
    groupTitle?: string;
    summary: string;
    detail?: string;
    parsedCode?: number;
}

/**
 * ErrorLog 항목을 제어기 시스템 에러 / 기타로 분류한다.
 *
 * - 알려진 시스템 코드(-1521 등): isControllerSystem = true, detail 포함
 * - timestamp+source+code 형식 전반: isControllerSystem = true (제어기 누적 로그)
 * - 구조 없는 raw 텍스트: isControllerSystem = false (코드 관련 가능성)
 */
export function classifyErrorEntry(entry: string): ErrorEntryClassification {
    const parsed = parseControllerErrorEntry(entry);
    if (!parsed) {
        const normalized = entry.replace(/\s+/g, ' ').trim();
        return {
            isControllerSystem: false,
            category: 'unknown',
            summary: normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized,
        };
    }

    const summary = `${parsed.source} (${parsed.code}): ${parsed.message}`;
    const group = getGplErrorGroup(parsed.code);
    const hint = getErrorCodeHint(parsed.code);
    // 분류 우선순위: 코드별 힌트(사람이 손으로 검토한 것) > 문서 범위 표 > 미상.
    const category: ErrorCodeCategory = hint?.category ?? group?.category ?? 'unknown';
    const base = { category, groupTitle: group?.title, parsedCode: parsed.code, summary };

    const knownDetail = CONTROLLER_SYSTEM_ERROR_CODES[parsed.code];
    if (knownDetail) {
        return { ...base, isControllerSystem: true, detail: `${knownDetail} — GPL 코드 오류로 분류하지 않음` };
    }
    if (hint) {
        return { ...base, isControllerSystem: category !== 'code', detail: `${hint.title} — ${hint.meaning}. 권장: ${hint.action}` };
    }
    if (group) {
        // 그룹만 아는 경우 — 문서상 분류임을 밝히고, 코드 오류일 때만 GPL 소스를 먼저 보라고 한다.
        const lead = category === 'code'
            ? 'GPL 코드 오류 — 소스(위치·스택)부터 확인'
            : category === 'environment'
                ? '제어기 환경 문제 — GPL 코드 수정보다 제어기 진단 우선'
                : '문서 그룹만으로는 코드/환경이 갈리지 않음 — 위치와 재현 조건부터 확인';
        return { ...base, isControllerSystem: category !== 'code', detail: `${lead}. 문서상 ${group.title}.` };
    }

    return {
        ...base,
        isControllerSystem: true,
        detail: '제어기 ErrorLog 항목. 현재 실행 결과와 과거 누적 항목을 분리 확인 필요.',
    };
}
