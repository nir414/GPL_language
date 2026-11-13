/**
 * 제어기 메모리 실측에 근거한 정보 진단. vscode 무의존 순수 모듈. 진입점은 `compilerChecks.findCompilerCheckFindings` 가 부른다.
 *
 * 근거 — Sample Prep 제어기 메모리 비용 실측 보고서(2026-11-06, GPL 4.2K5 시뮬 제어기, DataID 130 Free 차이):
 *   - 객체의 String 칸은 Nothing 이면 참조 4 B 지만 `""` 를 넣으면 칸마다 +183 B. 같은 리터럴을 넣어도 복사되고 공유되지 않는다.
 *   - Data_Apon 노드에서 빈 문자열을 필요할 때만 넣게 바꿔 노드 1,219 → 285 B, 트리 35개 1.709 → 0.610 MB(APN 4.2.0).
 * 판정은 정적으로 할 수 있는 것만 — 클래스 인스턴스 필드 선언의 `= ""` 초기화(객체를 만들 때마다 실행된다).
 * Shared 필드는 한 벌뿐이라 알리지 않는다.
 */

import { GPLParser, GPLSymbolKind } from '../syntax/gplParser';
import { stripComment } from './logicalLines';
import type { CompilerCheckFinding } from './compilerChecks';

const EMPTY_STRING_INIT = /\bAs\s+String\s*=\s*""\s*$/i;

function checkEmptyStringFieldInit(content: string, filePath: string, out: CompilerCheckFinding[]): void {
    const lines = content.split('\n');
    const seen = new Set<number>();
    for (const sym of GPLParser.parseDocument(content, filePath)) {
        if (sym.kind !== GPLSymbolKind.Variable || !sym.className || sym.isShared || sym.isLocal || seen.has(sym.line)) { continue; }
        const code = stripComment((lines[sym.line] ?? '').replace(/\r$/, '')).replace(/\s+$/, '');
        const m = EMPTY_STRING_INIT.exec(code);
        if (!m) { continue; }
        seen.add(sym.line);
        const eq = code.indexOf('=', m.index);
        out.push({
            line: sym.line,
            start: eq,
            end: code.length,
            code: 'string-field-empty-init',
            severity: 'information',
            message: '클래스 필드를 `""` 로 초기화하면 객체를 만들 때마다 칸마다 약 183 B 를 더 씁니다(Nothing 이면 4 B, GPL 4.2K5 실측 2026-11-06). '
                + '객체를 많이 만드는 클래스라면 Nothing 으로 두고, 바깥에 돌려줄 때만 빈 문자열로 바꾸는 방법이 있습니다(Data_Apon 노드 1,219 → 285 B 사례). '
                + '단 Nothing 인 String 을 ByVal 로 넘기면 -782 가 날 수 있으니 쓰는 곳을 함께 확인하세요.',
        });
    }
}

/** 메모리 관련 정보 진단 모음. */
export function findMemoryCheckFindings(content: string, filePath: string): CompilerCheckFinding[] {
    const out: CompilerCheckFinding[] = [];
    checkEmptyStringFieldInit(content, filePath, out);
    return out;
}
