/**
 * 선언(멤버) 단위 미사용 판정 — 컴파일 단위 전체의 선언 그래프에서 출발점으로부터 이름으로 닿지 않는 선언을 고른다.
 * vscode·fs 무의존 순수 모듈. 선언 구조는 `memberScan.ts`.
 *
 * 이름 해석(문서상, 보수적으로 넓게):
 * - 수식 없는 낱말 `n` — 모듈 직속 선언 `n`(문서상 이름이 유일하면 모듈 이름 생략 가능, modules.htm), 클래스 이름 `n`,
 *   클래스 멤버 `n`(클래스 안에서는 자기 멤버를 수식 없이 부른다, user_classes.htm). 단, 참조하는 쪽의 모듈이 `n` 을 모듈 직속으로
 *   선언했으면 그 모듈의 것만 가리킨다(블록 우선, scope_names.htm) — 클래스 멤버 쪽은 이 가림을 쓰지 않는다.
 * - 점 뒤 낱말 `p.n` — 클래스 멤버 `n`(객체 형을 모르므로 이름이 같은 모든 클래스의 멤버), 그리고 `p` 가 모듈 이름이면 그 모듈의 `n`.
 * - 클래스 멤버는 그 클래스가 닿았을 때만 닿는다. 클래스가 닿으면 생성자 `Sub New` 는 함께 닿는다(New 로 암묵 호출).
 * - 늘 남김: 출발점 파일의 모든 선언, 지울 수 없는 선언(부작용 있는 초기화), `Sub Init`(모듈 초기화 때 자동 호출 — 문서상 modules.htm,
 *   클래스 안 `Init` 까지 불린 실측 §1-EY 계열), keep 목록. 오버로드는 이름 단위라 하나가 닿으면 모두 남는다.
 */

import type { MemberRefs, ScannedSource, SourceMember } from './memberScan';

export interface MemberUnitFile {
    scan: ScannedSource;
    /** 이 파일의 선언을 지울 수 있는가(배포가 올리는 라이브러리 파일). false 면 모든 선언이 출발점이다. */
    candidate: boolean;
}

export interface RemovedMember {
    fileKey: string;
    /** 선언 종류. `local` 은 남는 프로시저 안의 안 쓰는 지역 Dim, `module` 은 선언이 모두 지워진 껍데기 Module. */
    kind: SourceMember['kind'] | 'local' | 'module';
    name: string;
    /** 둘러싼 클래스 또는 모듈 이름(원래 대소문자를 모르면 소문자). */
    container?: string;
    startLine: number;
    endLine: number;
}

export interface MemberShakeResult {
    /** 지울 선언(바깥 선언이 지워지면 안쪽은 따로 싣지 않는다). */
    removed: RemovedMember[];
    /** 파일 키 → 빈 줄로 바꿀 물리 줄 범위(끝 포함). */
    ranges: Map<string, [number, number][]>;
    /** 분석한 선언 수와 그중 닿은 수(지울 수 있는 파일만). */
    candidateMembers: number;
    reachableCandidateMembers: number;
}

interface Node {
    fileKey: string;
    member: SourceMember;
    parent?: Node;
    root: boolean;
    reachable: boolean;
}

const SEP = '\u0001';

function matchesKeep(node: Node, keep: readonly string[]): boolean {
    const container = node.parent ? node.parent.member.names[0] : node.member.module;
    return keep.some(entry => {
        const parts = entry.toLowerCase().split('.');
        const name = parts[parts.length - 1];
        if (!node.member.names.includes(name)) { return false; }
        return parts.length === 1 || parts[parts.length - 2] === container;
    });
}

function buildNodes(files: ReadonlyMap<string, MemberUnitFile>, keep: readonly string[]): Node[] {
    const nodes: Node[] = [];
    for (const [fileKey, file] of files) {
        if (file.scan.irregular) {
            // 불규칙 파일은 이름 없는 출발점 하나 — 파일 전체의 참조를 그대로 센다.
            nodes.push({
                fileKey, root: true, reachable: false,
                member: { kind: 'class', names: [], displayName: '', startLine: 0, endLine: 0, removable: false, refs: file.scan.allRefs },
            });
            continue;
        }
        const local: Node[] = [];
        for (const member of file.scan.members) {
            const node: Node = { fileKey, member, root: false, reachable: false };
            node.parent = member.parent === undefined ? undefined : local[member.parent];
            // 지울 수 없는 선언: 모듈 직속·Shared 는 출발점(초기화가 객체 없이 돈다), 클래스 인스턴스 필드는 클래스가 닿을 때만(referenced).
            node.root = !file.candidate || (!member.removable && (!node.parent || !!member.shared))
                || (member.kind === 'sub' && member.names.includes('init'))
                || matchesKeep(node, keep);
            local.push(node);
        }
        nodes.push(...local);
    }
    return nodes;
}

/** 출발점과 keep 에서 시작해 참조로 닿는 선언을 고른다. */
export function computeMemberReachability(files: ReadonlyMap<string, MemberUnitFile>, keep: readonly string[] = []): MemberShakeResult {
    const nodes = buildNodes(files, keep);
    const moduleNames = new Set<string>();
    for (const f of files.values()) { for (const m of f.scan.modules) { moduleNames.add(m); } }
    const moduleDecl = new Set<string>();
    for (const n of nodes) {
        if (!n.parent && n.member.module) { for (const name of n.member.names) { moduleDecl.add(n.member.module + SEP + name); } }
    }

    const uGlobal = new Set<string>();
    const uLocal = new Set<string>();
    const uAll = new Set<string>();
    const dottedAll = new Set<string>();
    const dModule = new Set<string>();
    const addRefs = (refs: MemberRefs, contextModule: string | undefined): void => {
        for (const n of refs.undotted) {
            uAll.add(n);
            if (contextModule && moduleDecl.has(contextModule + SEP + n)) { uLocal.add(contextModule + SEP + n); } else { uGlobal.add(n); }
        }
        for (const d of refs.dotted) {
            dottedAll.add(d.name);
            if (moduleNames.has(d.prefix)) { dModule.add(d.prefix + SEP + d.name); }
        }
    };
    const mark = (node: Node): void => {
        for (let n: Node | undefined = node; n && !n.reachable; n = n.parent) {
            n.reachable = true;
            addRefs(n.member.refs, n.member.module);
        }
    };
    const referenced = (node: Node): boolean => {
        const { member } = node;
        if (node.parent) {
            if (!node.parent.reachable) { return false; }
            if (!member.removable || (member.kind === 'sub' && member.names.includes('new'))) { return true; }
            return member.names.some(n => uAll.has(n) || dottedAll.has(n));
        }
        if (member.module) {
            const mod = member.module;
            return member.names.some(n => uGlobal.has(n) || uLocal.has(mod + SEP + n) || dModule.has(mod + SEP + n));
        }
        return member.names.some(n => uAll.has(n) || dottedAll.has(n));
    };

    for (const n of nodes) { if (n.root) { mark(n); } }
    for (let changed = true; changed;) {
        changed = false;
        for (const n of nodes) {
            if (!n.reachable && referenced(n)) { mark(n); changed = true; }
        }
    }
    return collectRemovals(nodes, files);
}

function addRange(result: MemberShakeResult, removed: RemovedMember): void {
    result.removed.push(removed);
    const list = result.ranges.get(removed.fileKey) ?? [];
    list.push([removed.startLine, removed.endLine]);
    result.ranges.set(removed.fileKey, list);
}

/**
 * 지울 범위 모으기 — 닿지 않은 선언(바깥이 지워지면 안쪽은 생략), 남는 프로시저 안의 안 쓰는 지역 Dim(컴파일 87 B/줄 실측),
 * 그리고 선언이 하나도 남지 않은 Module 껍데기(≈190 B 실측). 모두 지울 수 있는 파일만.
 */
function collectRemovals(nodes: readonly Node[], files: ReadonlyMap<string, MemberUnitFile>): MemberShakeResult {
    const result: MemberShakeResult = { removed: [], ranges: new Map(), candidateMembers: 0, reachableCandidateMembers: 0 };
    const liveModules = new Set<string>();
    for (const n of nodes) {
        if (n.reachable && n.member.module) { liveModules.add(n.fileKey + SEP + n.member.module); }
    }
    for (const n of nodes) {
        if (!files.get(n.fileKey)?.candidate || !n.reachable || n.member.names.length === 0) { continue; }
        for (const local of n.member.locals ?? []) {
            if (!local.unused) { continue; }
            addRange(result, {
                fileKey: n.fileKey, kind: 'local', name: local.names.join(','), container: n.member.displayName,
                startLine: local.startLine, endLine: local.endLine,
            });
        }
    }
    for (const [fileKey, file] of files) {
        if (!file.candidate || file.scan.irregular) { continue; }
        for (const span of file.scan.moduleSpans) {
            if (liveModules.has(fileKey + SEP + span.name)) { continue; }
            // 안쪽 선언 범위는 아래에서 따로 싣지 않는다 — 모듈 범위 하나로 덮는다.
            addRange(result, { fileKey, kind: 'module', name: span.name, startLine: span.startLine, endLine: span.endLine });
        }
    }
    const deadModule = (n: Node): boolean => !!n.member.module && !liveModules.has(n.fileKey + SEP + n.member.module);
    for (const n of nodes) {
        if (!files.get(n.fileKey)?.candidate || n.member.names.length === 0) { continue; }
        result.candidateMembers++;
        if (n.reachable) { result.reachableCandidateMembers++; continue; }
        if (n.parent && !n.parent.reachable) { continue; }
        const { member } = n;
        // 껍데기째 지우는 Module 안이면 그 범위가 이미 덮는다(목록에는 선언 이름을 남겨 안내에 쓰게 한다).
        const covered = deadModule(n);
        const removed: RemovedMember = {
            fileKey: n.fileKey,
            kind: member.kind,
            name: member.displayName,
            container: n.parent ? n.parent.member.displayName : member.module,
            startLine: member.startLine,
            endLine: member.endLine,
        };
        if (covered) { result.removed.push(removed); } else { addRange(result, removed); }
    }
    return result;
}
