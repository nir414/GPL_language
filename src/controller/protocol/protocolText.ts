/**
 * 응답 파서 공용 텍스트·경로 헬퍼.
 *
 * 책임: 여러 파서가 함께 쓰는 XML 태그 제거(`stripXmlTags`)와 경로 포함 판정(`isPathUnder`).
 * `responseParser.ts` 에서 응답 종류별로 분리했다(2026-10-27) — 함수 본문은 그대로 옮겼고,
 * 기존 import 경로는 `responseParser.ts` 배럴이 유지한다.
 */

import * as path from 'path';

/**
 * XML 태그를 제거한다 — `<DATA>content</DATA>` 같은 인라인 형식 응답 처리용 공통 헬퍼.
 * 닫는 태그는 줄바꿈으로 바꾼다(여는 태그는 지운다): `…|14</DATA><STATUS>0,"Success"</STATUS>` 처럼 닫는 태그 앞에
 * 줄바꿈이 없으면 태그만 지울 때 줄 번호 14 와 STATUS 0 이 붙어 140 으로 읽혔다(2026-11-04 §1-GZ 재현). 이 헬퍼를 쓰는
 * 파서는 모두 줄 단위로 읽으므로 빈 줄이 늘어나는 것은 무해하다.
 */
export function stripXmlTags(text: string): string {
    return text.replace(/<\/[A-Za-z][^>]*>/g, '\n').replace(/<[A-Za-z][^>]*>/g, '');
}

/** filePath가 dirPath 하위(또는 동일)인지 판정. 순수 path 연산. */
export function isPathUnder(filePath: string, dirPath: string): boolean {
    try {
        const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    } catch {
        return false;
    }
}
