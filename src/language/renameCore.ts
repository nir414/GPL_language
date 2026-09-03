import { escapeRegExp, isInCommentOrString } from './cursorExpression';

/**
 * Rename(F2) 텍스트 스캔 정본 — vscode 비의존 순수 모듈.
 *
 * GPLRenameProvider(vscode 오케스트레이션)가 사용하는 줄 단위 판정 로직을 모아
 * Node 단독 테스트(test/renameCore.test.ts)로 회귀를 잡을 수 있게 한다.
 */

/** 라인 내 이름 변경 대상 위치 (line은 호출부가 채운다). */
export interface RenameOccurrence {
    /** 식별자 시작 컬럼 */
    character: number;
}

import { GPL_RESERVED_WORDS } from './gplReservedWords';

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Rename의 원본/새 이름으로 쓸 수 없는 GPL(VB계열) 예약어 — 정본(gplReservedWords)의 넓은 집합.
 * 정의 탐색은 `New`/타입명 등을 해석 대상으로 남겨야 하지만(좁은 집합), 이름 변경은
 * 선언 키워드·접근제한자·기본 타입명까지 전부 막아야 코드가 깨지지 않는다.
 */
export const GPL_RENAME_RESERVED = GPL_RESERVED_WORDS;

/** GPL 식별자 형식([A-Za-z_][A-Za-z0-9_]*)인지 검사. */
export function isValidGplIdentifier(name: string): boolean {
    return IDENTIFIER_RE.test(name);
}

/** Rename 예약어인지 검사(대소문자 무시). */
export function isRenameReservedWord(name: string): boolean {
    return GPL_RENAME_RESERVED.has(name.trim().toLowerCase());
}

/**
 * 식별자 위치 앞이 (공백 무시하고) `.`인지 — 즉 멤버 접근의 멤버 자리인지 판별.
 * 로컬 변수 rename에서 `obj.name` 같은 무관한 멤버를 제외하거나,
 * 전역 rename의 섀도잉 필터에서 멤버 접근을 로컬로 오인하지 않기 위해 쓴다.
 */
export function isDotQualifiedAt(lineText: string, character: number): boolean {
    for (let i = character - 1; i >= 0; i--) {
        const ch = lineText[i];
        if (ch === ' ' || ch === '\t') {
            continue;
        }
        return ch === '.';
    }
    return false;
}

/**
 * 한 줄에서 `\bword\b`(대소문자 무시) 발생 위치를 모두 찾는다.
 * 주석(`'` 이후)·문자열("...") 내부는 제외한다.
 *
 * @param opts.skipQualified true면 `.` 뒤에 오는(멤버 자리) 매치를 제외한다.
 *        로컬 변수/모듈 프로시저처럼 점 접근이 불가능한 대상에 사용.
 */
export function findRenameOccurrencesInLine(
    lineText: string,
    word: string,
    opts?: { skipQualified?: boolean }
): RenameOccurrence[] {
    const out: RenameOccurrence[] = [];
    if (!lineText || lineText.indexOf("'") === 0) {
        return out;
    }
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(lineText)) !== null) {
        if (match[0].length === 0) {
            re.lastIndex++;
            continue;
        }
        const col = match.index;
        if (isInCommentOrString(lineText, col)) {
            continue;
        }
        if (opts?.skipQualified && isDotQualifiedAt(lineText, col)) {
            continue;
        }
        out.push({ character: col });
    }
    return out;
}

/**
 * 지정 컬럼이 정확히 그 이름을 가리키는지(단어 경계 포함) 검사.
 * 이름 바꾸기 편집을 내보내기 전 "그 자리가 실제로 옛 이름인가"를 확인하는 데 쓴다.
 */
export function isWordAt(lineText: string, character: number, word: string): boolean {
    if (character < 0 || character + word.length > lineText.length) {
        return false;
    }
    if (lineText.substr(character, word.length).toLowerCase() !== word.toLowerCase()) {
        return false;
    }
    const before = character > 0 ? lineText[character - 1] : '';
    const after = lineText[character + word.length] ?? '';
    return !/\w/.test(before) && !/\w/.test(after);
}

/**
 * 선언 줄에서 이름의 실제 컬럼을 확정한다. 못 찾으면 -1.
 *
 * 심볼 인덱스의 컬럼(hint)을 그대로 믿지 않는다 — 파서가 선언 종류에 따라
 * "줄 전체"를 range로 넣던 시절의 값(start=0)이나 낡은 캐시가 오면 이름 바꾸기가
 * 선언 줄 앞부분을 덮어써 코드를 깨뜨렸다. hint가 실제로 이름을 가리킬 때만 쓰고,
 * 아니면 주석/문자열 밖의 첫 `\bword\b`를 찾는다.
 */
export function resolveDeclarationNameColumn(lineText: string, word: string, hint: number): number {
    if (isWordAt(lineText, hint, word)) {
        return hint;
    }
    return findRenameOccurrencesInLine(lineText, word)[0]?.character ?? -1;
}

/**
 * 함수 반환값 대입문(`FunctionName = value`)의 식별자 컬럼을 돌려준다. 아니면 -1.
 *
 * 참조 검색(referenceProvider)은 반환값 대입을 "참조"에서 제외하지만,
 * 이름 변경은 반드시 포함해야 한다 — 빠뜨리면 함수 이름만 바뀌고
 * 본문의 반환 대입이 옛 이름으로 남아 컴파일이 깨진다.
 *
 * 판정: 줄 시작부터 공백만 → 식별자 → 공백 → 단일 `=` (== 등 합성 제외).
 */
export function findReturnAssignmentColumn(lineText: string, word: string): number {
    const re = new RegExp(`^([ \\t]*)(${escapeRegExp(word)})\\b`, 'i');
    const m = re.exec(lineText);
    if (!m) {
        return -1;
    }
    const col = m[1].length;
    let j = col + m[2].length;
    while (j < lineText.length && (lineText[j] === ' ' || lineText[j] === '\t')) {
        j++;
    }
    if (lineText[j] !== '=' || lineText[j + 1] === '=') {
        return -1;
    }
    return col;
}

/** Rename 대상의 종류 — 문자열 리터럴 참조 갱신 규칙 선택용. */
export interface StringLiteralRenameTarget {
    /**
     * 'proc': Sub/Function — 리터럴의 마지막 세그먼트를 바꾼다.
     *   - "Proc"          → 전체가 이름과 일치할 때
     *   - "Mod.Proc"      → 한정자가 containerName과 일치할 때만
     * 'container': Module/Class — "Name.xxx" 형태의 첫 세그먼트를 바꾼다.
     */
    kind: 'proc' | 'container';
    /** proc일 때 소속 모듈/클래스 이름(있으면 한정자 검증에 사용). */
    containerName?: string;
}

/**
 * 한 줄의 문자열 리터럴들에서 이름 변경할 세그먼트 위치를 찾는다.
 *
 * GPL은 프로시저를 문자열로 참조하는 관용구가 있어(예:
 * `New Thread("DataFile.SaveThread")`) 프로시저 이름을 바꾸면 이런 문자열도
 * 함께 바꿔야 런타임(-스레드 생성)이 깨지지 않는다.
 *
 * 정의 이동(definitionProvider.resolveStringLiteralReference)과 같은 기준을 쓴다:
 * F12로 대상에 점프되는 문자열만 F2로 함께 바뀐다.
 *   - 리터럴 전체가 식별자 형태(`Name` 또는 `Qual.Name`...)일 때만 대상.
 *   - proc: 마지막 세그먼트가 word와 일치하고, 한정자가 있으면 containerName과
 *     일치해야 한다(무관한 동명 문자열 오변경 방지). 한정자 없는 단일 식별자
 *     리터럴은 전체가 word일 때만.
 *   - container: 첫 세그먼트가 word와 일치하고 뒤에 `.`이 이어질 때만.
 */
export function findStringLiteralRenameOccurrences(
    lineText: string,
    word: string,
    target: StringLiteralRenameTarget
): RenameOccurrence[] {
    const out: RenameOccurrence[] = [];
    const wordLower = word.toLowerCase();
    const identShaped = /^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*$/;

    // 리터럴 열거: 따옴표 토글, 문자열 밖 `'`부터는 주석
    let strStart = -1;
    for (let i = 0; i < lineText.length; i++) {
        const ch = lineText[i];
        if (ch === '"') {
            if (strStart === -1) {
                strStart = i;
                continue;
            }
            const content = lineText.substring(strStart + 1, i);
            const contentStart = strStart + 1;
            strStart = -1;

            if (!identShaped.test(content.trim())) {
                continue;
            }

            // 세그먼트 분해 (공백 포함 위치 보존)
            const segRe = /[A-Za-z_]\w*/g;
            const segs: Array<{ text: string; idx: number }> = [];
            let sm: RegExpExecArray | null;
            while ((sm = segRe.exec(content)) !== null) {
                segs.push({ text: sm[0], idx: sm.index });
            }
            if (segs.length === 0) {
                continue;
            }

            if (target.kind === 'proc') {
                const last = segs[segs.length - 1];
                if (last.text.toLowerCase() !== wordLower) {
                    continue;
                }
                if (segs.length === 1) {
                    // "Proc" — 전체 일치만 허용 (위 identShaped + last 일치로 충족)
                    out.push({ character: contentStart + last.idx });
                } else if (
                    target.containerName &&
                    segs[segs.length - 2].text.toLowerCase() === target.containerName.toLowerCase()
                ) {
                    // "Mod.Proc" — 한정자가 소속과 일치할 때만
                    out.push({ character: contentStart + last.idx });
                }
            } else {
                // container: "Name.xxx" — 첫 세그먼트 + 뒤에 점이 이어질 때만
                const first = segs[0];
                if (segs.length >= 2 && first.text.toLowerCase() === wordLower) {
                    out.push({ character: contentStart + first.idx });
                }
            }
        } else if (ch === "'" && strStart === -1) {
            break; // 이후 전부 주석
        }
    }
    return out;
}
