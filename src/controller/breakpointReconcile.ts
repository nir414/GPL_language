/**
 * 에디터 중단점 ↔ 제어기 중단점 수렴 계획 (순수 로직 — vscode 의존 없음).
 *
 * 배경: 제어기의 `Set Break`는 VS Code를 닫아도 제어기 안에 남는 상태다. 에디터의 빨간 점을
 * 단일 원본으로 삼는 §1-AP 방침에서도 두 곳이 어긋날 수 있는 경로가 남아 있었다 —
 * 실시간 동기화가 꺼져 있던 동안의 변경, 다른 창/이전 세션·MCP·GDE가 걸어 둔 BP, 비정상
 * 종료로 정리되지 않은 잔재. 그 상태에서 F9로 점을 지워도 제어기는 계속 브레이크를 건다.
 *
 * 이 모듈은 "제어기에 지금 있는 목록"과 "에디터에 지금 있는 목록"만 받아 어느 것을 지우고
 * 어느 것을 새로 걸어야 하는지 계산한다. 1402 전송·vscode API는 `breakpointSync.ts`가 맡는다.
 */

import { BreakpointInfo } from './responseParser';

/** 제어기 명령 인자와 같은 단위의 중단점 위치 — 파일 베이스네임 + 1-based 줄. */
export interface BreakpointTarget {
    file: string;
    line: number;
}

export interface ReconcilePlan {
    /** 에디터에는 있고 제어기에는 없음 → `Set Break` */
    toAdd: BreakpointTarget[];
    /** 제어기에는 있고 에디터에는 없음 → `Set Nobreak` */
    toRemove: BreakpointTarget[];
    /** 양쪽에 모두 있음 → 전송 불필요 */
    kept: BreakpointTarget[];
    /** 제어기 목록에서 대상 프로젝트가 아니거나 위치를 해석할 수 없어 손대지 않은 항목 수 */
    untouched: number;
}

/** 파일명 대소문자 차이를 흡수한 비교 키 (제어기는 파일명을 원문 그대로 돌려준다). */
export function breakpointKey(target: BreakpointTarget): string {
    return `${target.file.toLowerCase()}:${target.line}`;
}

/** 같은 위치를 가리키는 중복 항목을 제거한다(입력 순서 유지). */
export function dedupeTargets(targets: readonly BreakpointTarget[]): BreakpointTarget[] {
    const seen = new Set<string>();
    const out: BreakpointTarget[] = [];
    for (const t of targets) {
        if (!t.file || t.line <= 0) { continue; }
        const key = breakpointKey(t);
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push({ file: t.file, line: t.line });
    }
    return out;
}

/**
 * `Show Break` 결과에서 **대상 프로젝트의** 위치만 추출한다.
 *
 * 프로젝트명이 빈 항목(레거시 `file.gpl:42` 형식 등)은 어느 프로젝트인지 확정할 수 없으므로
 * 제외한다 — 남의 프로젝트 BP를 지우는 것보다 남겨 두는 쪽이 안전하다.
 */
export function controllerTargets(
    list: readonly BreakpointInfo[],
    projectName: string,
): { targets: BreakpointTarget[]; untouched: number } {
    const wanted = projectName.trim().toLowerCase();
    const mine: BreakpointTarget[] = [];
    let untouched = 0;
    for (const bp of list) {
        const proj = (bp.project || '').trim().toLowerCase();
        if (!proj || proj !== wanted || !bp.file || bp.fileLine <= 0) {
            untouched++;
            continue;
        }
        mine.push({ file: bp.file, line: bp.fileLine });
    }
    const targets = dedupeTargets(mine);
    // 중복으로 걸러진 항목은 "손대지 않음"이 아니라 같은 위치이므로 untouched에 넣지 않는다.
    return { targets, untouched };
}

/** 에디터를 진실로 보고 제어기를 맞추는 계획을 만든다. */
export function planReconcile(
    controller: readonly BreakpointTarget[],
    editor: readonly BreakpointTarget[],
    untouched = 0,
): ReconcilePlan {
    const controllerList = dedupeTargets(controller);
    const editorList = dedupeTargets(editor);
    const controllerKeys = new Set(controllerList.map(breakpointKey));
    const editorKeys = new Set(editorList.map(breakpointKey));

    return {
        toAdd: editorList.filter(t => !controllerKeys.has(breakpointKey(t))),
        toRemove: controllerList.filter(t => !editorKeys.has(breakpointKey(t))),
        kept: editorList.filter(t => controllerKeys.has(breakpointKey(t))),
        untouched,
    };
}

/** 제어기에는 있지만 에디터에 대응하는 빨간 점이 없는 위치 (어긋남 표시용). */
export function orphanControllerBreakpoints(
    list: readonly BreakpointInfo[],
    editor: readonly BreakpointTarget[],
): BreakpointInfo[] {
    const editorKeys = new Set(dedupeTargets(editor).map(breakpointKey));
    return list.filter(bp =>
        !!bp.file && bp.fileLine > 0 && !editorKeys.has(breakpointKey({ file: bp.file, line: bp.fileLine })));
}
