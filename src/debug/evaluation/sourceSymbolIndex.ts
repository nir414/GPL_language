/**
 * 디버그 세션이 로컬 소스를 파싱해 얻는 심볼 색인 — 프로시저 로컬 이름·모듈 전역 목록·클래스 Property(백킹 필드) 색인.
 *
 * 제어기는 변수 목록을 주지 않으므로(Show Variable 은 이름을 알아야 한다) Locals/Globals 패널의 후보 이름은 소스에서 만든다.
 * 소스맵 세대 동안 캐시하고(`invalidate`), 범위는 컴파일 단위 폴더(`SessionSources.projectDirs`)로 제한한다.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 * 순수 모듈(fs + GPLParser) — vscode·제어기 명령 없음.
 */

import * as fs from 'fs';
import { GPLParser, GPLSymbolKind, GPLSymbol } from '../../language/syntax/gplParser';
import type { SessionSources } from '../session/sessionSources';

export interface GlobalVariableDescriptor {
    displayName: string;
    lookupNames: string[];
    /** 선언이 `Private`인 모듈 전역 — 값 쓰기 실패의 원인 설명에 쓴다(열거는 종전대로 한다). */
    isPrivate?: boolean;
}

export class SourceSymbolIndex {
    constructor(private readonly sources: SessionSources) {}

    /** 소스 집합이 바뀌면(소스맵 재구축·원격 소스 새로 받음) 색인을 버린다 — 다음 조회 때 다시 만든다. */
    invalidate(): void {
        this.globalDescriptorsCache = undefined;
        this.propertyIndexCache = undefined;
    }

    // 전역 후보 열거 캐시 — 63파일 read+parse를 variablesRequest마다 반복하지 않는다.
    globalDescriptorsCache: GlobalVariableDescriptor[] | undefined;

    // Property 심볼 색인(이름별·클래스별) — -780 백킹 필드 치환과 가상 Property 자식에 사용(GitHub #26). 소스맵 세대 동안 캐시.
    propertyIndexCache: { byName: Map<string, GPLSymbol[]>; byClass: Map<string, GPLSymbol[]> } | undefined;

    /**
     * GPL 소스를 파싱하여 특정 프로시저 내 로컬 변수/파라미터 이름을 수집한다.
     * @param fileName 제어기가 반환한 파일 basename (e.g. "Entry_Main.gpl")
     * @param line 현재 실행 줄 — process 이름으로 프로시저를 못 찾을 때 이 줄이 속한 프로시저를 선택하는 데 사용
     * @param process 스택 프레임의 프로시저 이름 (e.g. "Module.Method" 또는 "Method")
     */
    getLocalVariableNames(fileName: string, line: number, process: string): string[] {
        const filePath = this.sources.resolveSourcePath(fileName);
        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return [];
        }

        const symbols = GPLParser.parseDocument(content, filePath, {
            includeLocals: true,
            includeParameters: true,
        });

        // process = "Module.Method" → method name만 추출
        const methodName = process?.includes('.')
            ? process.split('.').pop()!
            : (process || '');
        if (!methodName) { return []; }

        // 프로시저 심볼들에서 매칭되는 프로시저의 줄 범위를 구한다
        const procs = symbols.filter(
            s => s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub,
        );
        let start = -1;
        let end = Infinity;
        for (let i = 0; i < procs.length; i++) {
            if (procs[i].name.toLowerCase() === methodName.toLowerCase()) {
                start = procs[i].line;
                end = (i + 1 < procs.length) ? procs[i + 1].line : Infinity;
                break;
            }
        }

        // process 이름이 심볼 이름과 다를 때는 현재 실행 줄이 속한 프로시저를 찾는다.
        if (start < 0 && line > 0) {
            const lineIndex = line - 1; // controller line is 1-based
            for (let i = 0; i < procs.length; i++) {
                const procStart = procs[i].line;
                const procEnd = (i + 1 < procs.length) ? procs[i + 1].line : Infinity;
                if (procStart <= lineIndex && lineIndex < procEnd) {
                    start = procStart;
                    end = procEnd;
                    break;
                }
            }
        }

        if (start < 0) { return []; }

        // 프로시저 범위 내 isLocal 심볼들을 수집 (중복 제거, 대소문자 무시)
        const seen = new Set<string>();
        const names: string[] = [];
        for (const s of symbols) {
            if (s.isLocal && s.line >= start && s.line < end) {
                const lower = s.name.toLowerCase();
                if (!seen.has(lower)) {
                    seen.add(lower);
                    names.push(s.name);
                }
            }
        }
        return names;
    }

    /**
     * 워크스페이스의 모든 GPL 소스에서 모듈 레벨(비로컬) 전역 변수를 열거한다.
     * Globals 패널은 public/private 여부와 무관하게 현재 프로젝트의 모듈 전역 상태를 보여주는 것이 유용하다.
     * 결과는 소스맵 세대 동안 캐시된다(_buildSourceFileMap에서 무효화) — 정지마다
     * 프로젝트 전체 read+parse를 반복하지 않는다.
     */
    getGlobalVariableDescriptors(): GlobalVariableDescriptor[] {
        if (this.globalDescriptorsCache) { return this.globalDescriptorsCache; }
        const seen = new Set<string>();
        const globals: GlobalVariableDescriptor[] = [];

        for (const [key, candidates] of this.sources.sourceFileMap) {
            const filePath = this.sources.pickSourcePath(key, candidates);
            // 프로젝트 폴더를 알면 그 밖의 소스(다른 프로젝트/사본)는 전역 열거에서 제외 —
            // Globals 패널에 무관한 프로젝트의 전역이 섞이는 것을 막는다.
            if (this.sources.projectDirs.length > 0
                && !this.sources.projectDirs.some(d => this.sources.isPathUnder(filePath, d))) { continue; }
            let content: string;
            try {
                content = fs.readFileSync(filePath, 'utf-8');
            } catch { continue; }

            const symbols = GPLParser.parseDocument(content, filePath, {
                includeLocals: false,
                includeParameters: false,
            });

            for (const s of symbols) {
                // 컴파일타임 Const는 런타임 변수가 아니므로 제외 (`Show Global`이 의미 있는 값을 반환하지 않음).
                if (s.kind === GPLSymbolKind.Variable
                    && !s.isLocal
                    && !s.className) {
                    const displayName = s.module ? `${s.module}.${s.name}` : s.name;
                    const lookupNames = s.module
                        ? [`${s.module}.${s.name}`, s.name]
                        : [s.name];
                    const lower = displayName.toLowerCase();
                    if (!seen.has(lower)) {
                        seen.add(lower);
                        globals.push({
                            displayName,
                            lookupNames,
                            isPrivate: s.accessModifier === 'private',
                        });
                    }
                }
            }
        }

        this.globalDescriptorsCache = globals.sort(
            (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'accent' }),
        );
        return this.globalDescriptorsCache;
    }

    /** 프로젝트 소스의 Property 심볼 색인(이름별·클래스별, 소문자 키). 소스맵 세대 동안 캐시(_buildSourceFileMap에서 무효화). */
    getPropertyIndex(): { byName: Map<string, GPLSymbol[]>; byClass: Map<string, GPLSymbol[]> } {
        if (this.propertyIndexCache) { return this.propertyIndexCache; }
        const byName = new Map<string, GPLSymbol[]>();
        const byClass = new Map<string, GPLSymbol[]>();
        for (const [key, candidates] of this.sources.sourceFileMap) {
            const filePath = this.sources.pickSourcePath(key, candidates);
            if (this.sources.projectDirs.length > 0
                && !this.sources.projectDirs.some(d => this.sources.isPathUnder(filePath, d))) { continue; }
            let content: string;
            try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
            const symbols = GPLParser.parseDocument(content, filePath, { includeLocals: false, includeParameters: false });
            for (const s of symbols) {
                if (s.kind !== GPLSymbolKind.Property) { continue; }
                const n = s.name.toLowerCase();
                byName.set(n, [...(byName.get(n) ?? []), s]);
                if (s.className) {
                    const c = s.className.toLowerCase();
                    byClass.set(c, [...(byClass.get(c) ?? []), s]);
                }
            }
        }
        this.propertyIndexCache = { byName, byClass };
        return this.propertyIndexCache;
    }

    /**
     * Property 식의 백킹 필드 후보. 식의 마지막 요소가 소스에서 Property로 확인될 때만 만든다(인자 있는 프로퍼티는 제외).
     * 순서: ① Get 본문 `Return <식>`(getterReturnExpr) ② 관례 `m_<이름>`(getter가 있는 프로퍼티만).
     * @param className 수신자 클래스가 알려지면(GitHub #32) 그 클래스의 Property만 — 그 클래스에 없으면(상속 등) 빈 배열.
     */
    propertyBackingCandidates(expression: string, className?: string): Array<{
        /** 제어기에 보낼 치환식(부모 식 포함) */ expr: string;
        /** 부모 덤프에서 찾을 멤버 leaf 이름 */ backingLeaf: string;
        /** 표시용 출처 설명 */ via: string;
        parentExpr: string | undefined;
        symbols: GPLSymbol[];
    }> {
        const lastDot = expression.lastIndexOf('.');
        const leaf = lastDot >= 0 ? expression.slice(lastDot + 1) : expression;
        if (!/^[A-Za-z_]\w*$/.test(leaf)) { return []; }
        const indexed = this.getPropertyIndex().byName.get(leaf.toLowerCase()) ?? [];
        const symbols = className
            ? indexed.filter(s => (s.className ?? '').toLowerCase() === className.toLowerCase())
            : indexed;
        if (symbols.length === 0) { return []; }
        const parentExpr = lastDot > 0 ? expression.slice(0, lastDot) : undefined;
        const out: ReturnType<SourceSymbolIndex['propertyBackingCandidates']> = [];
        const seen = new Set<string>();
        const add = (backing: string, via: string) => {
            const key = backing.toLowerCase();
            if (seen.has(key)) { return; }
            seen.add(key);
            out.push({
                expr: parentExpr ? `${parentExpr}.${backing}` : backing,
                backingLeaf: backing.split('.').pop()!.replace(/\(.*$/, ''),
                via,
                parentExpr,
                symbols,
            });
        };
        for (const s of symbols) {
            // 단순 식(식별자·점 체인·인덱스)만 — 산술/함수 감싸기는 콘솔이 -712로 거부해 왕복만 낭비한다
            if (s.getterReturnExpr && /^[A-Za-z_][\w.]*(\([^()]*\))?$/.test(s.getterReturnExpr)) {
                add(s.getterReturnExpr, `${s.getterReturnExpr} (Get 반환식)`);
            }
        }
        if (symbols.some(s => s.hasGetter !== false)) {
            add(`m_${leaf}`, `m_${leaf} (관례)`);
        }
        return out;
    }

    /** `Object RNDRobot` / `Object() RobotArm` 헤더 타입에서 클래스 이름. `null`이나 타입만 있으면 undefined. */
    classNameOfType(type: string | undefined): string | undefined {
        const m = (type ?? '').match(/^object\b[^A-Za-z_]*([A-Za-z_]\w*)\s*$/i);
        const name = m?.[1];
        return name && !/^null$/i.test(name) ? name : undefined;
    }
}
