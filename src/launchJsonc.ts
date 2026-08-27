/**
 * launch.json(JSONC) 읽기/부분 갱신 헬퍼 — GitHub #30.
 *
 * VS Code는 `.vscode/launch.json`을 JSONC(주석·trailing comma 허용)로 다루지만, 확장은 두 곳에서 서로 다른
 * 방식으로 읽고 있었다: `readLaunchControllerInfo()`는 정규식으로 주석을 벗긴 뒤 `JSON.parse`(줄 끝 주석·문자열 안
 * `/*`·trailing comma에 취약), `createOrUpdateLaunchJson()`은 엄격한 `JSON.parse`(주석 한 줄에도 "파싱 실패")였고
 * 갱신은 `JSON.stringify`로 파일 전체를 다시 써 사용자의 주석·`${config:…}` 참조·포맷을 지웠다.
 *
 * 여기서는 VS Code 자체가 설정 파일에 쓰는 `jsonc-parser`로 통일한다.
 *  - 읽기: `parseJsonc` — 주석·trailing comma 허용, 오류는 줄/열로 설명(`describeJsoncErrors`).
 *  - 갱신: `upsertLaunchConfiguration` — `modify`+`applyEdits`로 해당 구성 항목만 편집해 다른 구성·주석·들여쓰기를 보존.
 *    (교체되는 GPL 구성 객체 "안"의 주석은 새 객체로 바뀌므로 유지되지 않는다 — 확장이 관리하는 항목이라 허용.)
 * vscode 무의존 — 테스트 하네스에서 직접 검증한다.
 */

import {
    applyEdits,
    FormattingOptions,
    modify,
    parse,
    ParseError,
    printParseErrorCode,
} from 'jsonc-parser';

export interface JsoncParseResult<T = unknown> {
    value: T | undefined;
    errors: ParseError[];
}

/** JSONC 텍스트를 관대하게 파싱한다(주석·trailing comma 허용). 오류가 있어도 부분 값이 돌아올 수 있으니 errors 를 확인할 것. */
export function parseJsonc<T = unknown>(text: string): JsoncParseResult<T> {
    const errors: ParseError[] = [];
    const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as T | undefined;
    return { value, errors };
}

/** 오프셋 → 1-based 줄/열. */
export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let line = 1;
    let lastBreak = -1;
    for (let i = 0; i < clamped; i++) {
        if (text.charCodeAt(i) === 10 /* \n */) {
            line++;
            lastBreak = i;
        }
    }
    return { line, column: clamped - lastBreak };
}

/** 파싱 오류를 사람이 위치를 바로 찾을 수 있게 설명한다: `2행 3열: InvalidSymbol` (최대 3건). */
export function describeJsoncErrors(text: string, errors: ParseError[]): string {
    return errors.slice(0, 3).map(e => {
        const { line, column } = offsetToLineColumn(text, e.offset);
        return `${line}행 ${column}열: ${printParseErrorCode(e.error)}`;
    }).join('; ') + (errors.length > 3 ? ` (외 ${errors.length - 3}건)` : '');
}

/** 기존 텍스트의 들여쓰기(탭/공백 수)와 줄바꿈을 감지한다. 판단할 줄이 없으면 공백 4칸·LF. */
export function detectFormatting(text: string): FormattingOptions {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const m = /^(?:[ \t]*\r?\n)*?([ \t]+)\S/m.exec(text);
    if (m && m[1].startsWith('\t')) {
        return { insertSpaces: false, tabSize: 4, eol };
    }
    const width = m ? m[1].length : 4;
    return { insertSpaces: true, tabSize: width > 0 ? width : 4, eol };
}

export interface LaunchUpsertResult {
    text: string;
    /** created = 빈/없는 파일에 골격을 새로 만듦, inserted = configurations 끝에 추가, replaced = 같은 name 항목 교체 */
    action: 'created' | 'inserted' | 'replaced';
    /** 최종 위치(configurations 인덱스) */
    index: number;
}

interface LaunchShape {
    version?: unknown;
    configurations?: unknown;
}

/**
 * launch.json 텍스트에서 `configurations` 안의 같은 `name` 항목을 교체하거나 끝에 추가한다. 다른 구성·주석·포맷은 보존.
 * - 텍스트가 비어 있으면 `{ version: "0.2.0", configurations: [config] }` 골격을 만든다.
 * - 파싱 오류가 있으면 예외(메시지에 줄/열) — 호출자가 사용자에게 보여 준다.
 * - 최상위가 객체가 아니거나 `configurations`가 배열이 아니면 배열로 새로 만든다(기존 값은 덮어씀 — 잘못된 파일).
 */
export function upsertLaunchConfiguration(
    text: string,
    config: Record<string, unknown> & { name: string },
    formatting?: FormattingOptions,
): LaunchUpsertResult {
    const fmt = formatting ?? detectFormatting(text);
    if (!text.trim()) {
        const skeleton = { version: '0.2.0', configurations: [config] };
        const json = JSON.stringify(skeleton, null, fmt.insertSpaces === false ? '\t' : (fmt.tabSize ?? 4));
        return { text: json.replace(/\n/g, fmt.eol ?? '\n') + (fmt.eol ?? '\n'), action: 'created', index: 0 };
    }

    const { value, errors } = parseJsonc<LaunchShape>(text);
    if (errors.length > 0) {
        throw new Error(`launch.json 파싱 실패: ${describeJsoncErrors(text, errors)}`);
    }

    let working = text;
    let root: LaunchShape = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        // 최상위가 객체가 아니면 파일을 골격으로 대체한다(주석 보존 불가 — 원래 유효한 launch.json이 아니었음).
        working = '{}';
        root = {};
    }
    if (typeof root.version !== 'string') {
        working = applyEdits(working, modify(working, ['version'], '0.2.0', { formattingOptions: fmt }));
    }
    const configs = Array.isArray(root.configurations) ? (root.configurations as unknown[]) : undefined;
    if (!configs) {
        working = applyEdits(working, modify(working, ['configurations'], [], { formattingOptions: fmt }));
    }

    const idx = (configs ?? []).findIndex(c => !!c && typeof c === 'object' && (c as { name?: unknown }).name === config.name);
    if (idx >= 0) {
        working = applyEdits(working, modify(working, ['configurations', idx], config, { formattingOptions: fmt }));
        return { text: working, action: 'replaced', index: idx };
    }
    working = applyEdits(working, modify(working, ['configurations', -1], config, { formattingOptions: fmt, isArrayInsertion: true }));
    return { text: working, action: 'inserted', index: (configs ?? []).length };
}
