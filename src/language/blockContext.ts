import { GPLParser } from '../gplParser';

/**
 * 커서 위치를 감싸는 GPL 블록 구조 분석 (vscode 비의존 순수 모듈).
 *
 * 왜 필요한가:
 * - 문(statement) 스니펫을 아무 데서나 띄우면 소음이 된다. GPL은 선언 위치 제약이
 *   문서상 명시되어 있다 — `Sub/Function`은 Module/Class 안에서만, `Property`는 Class
 *   안에서만, `Dim`은 Class/Module/프로시저 안에서만, 제어 구조는 프로시저 안에서만.
 * - `Exit For`/`Exit While` 같은 문은 해당 블록이 열려 있을 때만 유효하다.
 *
 * folding provider가 쓰는 블록 쌍과 같은 개념이지만, 이쪽은 "커서 시점에 열려 있는
 * 블록 스택"만 계산하면 되므로 별도의 가벼운 스캐너로 둔다.
 */

/** 블록 종류. 여는 문과 닫는 문이 쌍을 이루는 단위. */
export type GplBlockKind =
    | 'module' | 'class'
    | 'sub' | 'function' | 'property' | 'get' | 'set'
    | 'if' | 'select' | 'for' | 'while' | 'do' | 'try';

/**
 * 커서가 놓인 큰 범주.
 * - `file`: Module/Class 밖 (파일 최상위)
 * - `type`: Module/Class 본문 (프로시저 밖)
 * - `procedure`: Sub/Function/Property(및 Get/Set) 본문
 */
export type GplScope = 'file' | 'type' | 'procedure';

export interface GplBlockContext {
    scope: GplScope;
    /** 커서 시점에 열려 있는 블록들 (바깥 → 안쪽). */
    openBlocks: GplBlockKind[];
    /** scope가 'procedure'일 때 감싸는 프로시저 종류. */
    procedureKind?: 'sub' | 'function' | 'property';
    /** Property 안의 Get/Set 접근자 블록 내부인지. */
    accessor?: 'get' | 'set';
}

/** 여는 문 패턴. 위에서부터 먼저 맞는 것을 채택하므로 순서가 의미를 가진다. */
const BEGIN_PATTERNS: ReadonlyArray<{ kind: GplBlockKind; re: RegExp }> = [
    { kind: 'module', re: /^Module\b/i },
    { kind: 'class', re: /^(?:(?:Public|Private)\s+)*Class\b/i },
    { kind: 'sub', re: /^(?:(?:Public|Private|Protected|Friend|Shared|Overrides|Overloads|Overridable|NotOverridable|MustOverride|Shadows|Partial|Default)\s+)*Sub\b/i },
    { kind: 'function', re: /^(?:(?:Public|Private|Protected|Friend|Shared|Overrides|Overloads|Overridable|NotOverridable|MustOverride|Shadows|Partial|Default)\s+)*Function\b/i },
    { kind: 'property', re: /^(?:(?:Public|Private|Protected|Friend|Shared|ReadOnly|WriteOnly|Overrides|Overloads|Overridable|NotOverridable|MustOverride|Shadows|Default)\s+)*Property\b/i },
    { kind: 'get', re: /^Get\s*(?:'.*)?$/i },
    // GPL의 Set은 `Set (value As Integer)` 형태로 괄호 절이 필수다(VB.NET과 다름).
    { kind: 'set', re: /^Set\s*\(/i },
    // 블록형 If만 — 한 줄 If(`If x Then Exit Sub`)는 스택을 늘리지 않는다.
    { kind: 'if', re: /^If\b.*\bThen\s*(?:'.*)?$/i },
    // GPL은 `Select match_value`(Case 없음)가 정본, VB.NET식 `Select Case x`도 허용한다.
    { kind: 'select', re: /^Select\b(?:\s+Case\b)?\s+/i },
    { kind: 'for', re: /^For\b/i },
    { kind: 'while', re: /^While\b/i },
    { kind: 'do', re: /^Do\b/i },
    { kind: 'try', re: /^Try\s*(?:'.*)?$/i }
];

/** 닫는 문 패턴. */
const END_PATTERNS: ReadonlyArray<{ kind: GplBlockKind; re: RegExp }> = [
    { kind: 'module', re: /^End\s+Module\b/i },
    { kind: 'class', re: /^End\s+Class\b/i },
    { kind: 'sub', re: /^End\s+Sub\b/i },
    { kind: 'function', re: /^End\s+Function\b/i },
    { kind: 'property', re: /^End\s+Property\b/i },
    { kind: 'get', re: /^End\s+Get\b/i },
    { kind: 'set', re: /^End\s+Set\b/i },
    { kind: 'if', re: /^End\s+If\b/i },
    { kind: 'select', re: /^End\s+Select\b/i },
    { kind: 'while', re: /^End\s+While\b/i },
    { kind: 'try', re: /^End\s+Try\b/i },
    { kind: 'for', re: /^Next\b/i },
    { kind: 'do', re: /^Loop\b/i },
    // Wend는 GPL 정본이 아니지만(문서상 종결어는 `End While`) 이식 코드 관용으로 받아준다.
    { kind: 'while', re: /^Wend\b/i }
];

/** `Delegate Sub/Function`은 선언일 뿐 블록이 아니다 — Sub/Function 패턴보다 먼저 걸러낸다. */
const DELEGATE_RE = /^(?:(?:Public|Private)\s+)*Delegate\b/i;

/**
 * `atLine` 직전까지의 코드를 스캔해 그 위치에서 열려 있는 블록 스택을 계산한다.
 *
 * `atLine` 자신은 아직 입력 중인 줄이므로 포함하지 않는다. 주석 줄은 건너뛰고,
 * 줄 연속(` _`)은 파서와 같은 규칙으로 하나의 논리 줄로 합쳐 판정한다.
 */
export function analyzeBlockContext(
    getLine: (line: number) => string,
    lineCount: number,
    atLine: number
): GplBlockContext {
    const stack: GplBlockKind[] = [];
    const limit = Math.min(atLine, lineCount);

    for (let i = 0; i < limit; i++) {
        let text = getLine(i);

        // 줄 연속(` _`) 병합 — 다만 atLine을 넘어서까지 읽지는 않는다.
        while (i + 1 < limit && GPLParser.endsWithLineContinuation(text)) {
            i++;
            text = GPLParser.stripTrailingContinuation(text) + ' ' + getLine(i).trimStart();
        }

        const trimmed = stripInlineComment(text).trim();
        if (!trimmed) {
            continue;
        }

        // 닫는 문을 먼저 본다: `End Sub`가 Sub 패턴에 걸리는 일은 없지만,
        // `Next`/`Loop`처럼 여는 문과 접두사가 겹치지 않는 것들과 순서를 통일한다.
        const end = END_PATTERNS.find(p => p.re.test(trimmed));
        if (end) {
            popTo(stack, end.kind);
            continue;
        }

        if (DELEGATE_RE.test(trimmed)) {
            continue;
        }

        const begin = BEGIN_PATTERNS.find(p => p.re.test(trimmed));
        if (begin) {
            stack.push(begin.kind);
        }
    }

    return buildContext(stack);
}

/** 열린 블록 스택으로부터 스코프 정보를 만든다. */
function buildContext(stack: GplBlockKind[]): GplBlockContext {
    let scope: GplScope = 'file';
    let procedureKind: GplBlockContext['procedureKind'];
    let accessor: GplBlockContext['accessor'];

    for (const kind of stack) {
        if (kind === 'module' || kind === 'class') {
            if (scope === 'file') {
                scope = 'type';
            }
        } else if (kind === 'get' || kind === 'set') {
            scope = 'procedure';
            accessor = kind;
        } else if (kind === 'sub' || kind === 'function' || kind === 'property') {
            scope = 'procedure';
            procedureKind = kind;
        }
    }

    return { scope, openBlocks: [...stack], procedureKind, accessor };
}

/**
 * 스택에서 `kind`에 해당하는 가장 안쪽 블록까지 걷어낸다.
 *
 * 짝이 맞지 않는 코드(편집 중이라 흔하다)에서 스택이 통째로 비워지지 않도록,
 * 해당 종류가 스택에 없으면 아무것도 하지 않는다.
 */
function popTo(stack: GplBlockKind[], kind: GplBlockKind): void {
    const index = stack.lastIndexOf(kind);
    if (index >= 0) {
        stack.length = index;
    }
}

/**
 * 문자열 리터럴 밖의 `'` 주석을 제거한다. GPL 문자열 이스케이프(`""`)를 인식한다.
 */
function stripInlineComment(lineText: string): string {
    let inString = false;
    for (let i = 0; i < lineText.length; i++) {
        const ch = lineText[i];
        if (inString) {
            if (ch === '"') {
                if (lineText[i + 1] === '"') {
                    i++;
                } else {
                    inString = false;
                }
            }
        } else if (ch === '"') {
            inString = true;
        } else if (ch === "'") {
            return lineText.substring(0, i);
        }
    }
    return lineText;
}
