/**
 * "컴파일 검증 필요" 상태 추적 — vscode 무의존 순수 모듈.
 *
 * /GPL 소스는 업로드됐지만 Compile로 검증되지 않은 프로젝트를 담는다. PA 제어기의 `Start`는 자체적으로
 * Compile을 수행하므로(사용자 실사용 사실, ai-handoff §0.7 — Brooks 문서와 다름) 옛 바이너리가 도는 문제는
 * 아니지만, 소스에 에러가 있으면 Start가 실패하고 Problems 연동도 없다 → Start 전 안내가 필요하다.
 *
 * set: 업로드 후 Compile 보류(autoOnSave/THREAD_CHECK) · Compile 실패.
 * clear: Compile 성공 확정(deployRecord.onDidRecordCompiled — 경로 무관) · Load→Compile→Start 성공.
 *
 * extension.ts의 activate() 클로저에 있던 Map + 3함수를 옮긴 것이다(테스트 가능하게).
 * 로깅과 UI 반영(controllerTree/statusBar)은 호출부에 남는다 — 이 모듈은 "무엇이 바뀌었는지"만 돌려준다.
 */

/** 한 프로젝트의 "컴파일 검증 필요" 사유. views의 CompileStaleState/StatusBarCompileStale와 대입 호환. */
export interface CompileStaleInfo {
    projectName: string;
    projectDir?: string;
    /** 최초 set 시각(ms). 같은 프로젝트를 다시 set해도 유지된다 — "얼마나 오래 미검증인가"를 보이기 위함. */
    since: number;
    reason: string;
}

/** clear 결과 — 지운 항목과, 배지에 대신 표시할 다음 항목(없으면 undefined). */
export interface CompileStaleCleared {
    cleared: CompileStaleInfo;
    next: CompileStaleInfo | undefined;
}

/** 프로젝트명(공백 제거·소문자) 기준 키. 빈 문자열이면 추적하지 않는다. */
function staleKey(projectName: string): string {
    return projectName.trim().toLowerCase();
}

export class CompileStaleTracker {
    private readonly _items = new Map<string, CompileStaleInfo>();

    /** 프로젝트명으로 조회(대소문자·양끝 공백 무시). */
    find(projectName: string): CompileStaleInfo | undefined {
        return this._items.get(staleKey(projectName));
    }

    /**
     * "컴파일 검증 필요"로 표시. 이미 있으면 사유만 갱신하고 `since`·`projectDir`는 보존한다.
     * 프로젝트명이 비어 있으면 추적하지 않고 undefined를 돌려준다(호출부는 로그·UI를 건너뛴다).
     */
    mark(projectName: string, reason: string, projectDir?: string): CompileStaleInfo | undefined {
        const key = staleKey(projectName);
        if (!key) { return undefined; }
        const prev = this._items.get(key);
        const info: CompileStaleInfo = {
            projectName,
            projectDir: projectDir ?? prev?.projectDir,
            since: prev?.since ?? Date.now(),
            reason,
        };
        this._items.set(key, info);
        return info;
    }

    /** 해제. 해당 항목이 없었으면 undefined(호출부는 로그·UI를 건너뛴다 — 같은 Compile로 여러 번 불려도 조용하다). */
    clear(projectName: string): CompileStaleCleared | undefined {
        const key = staleKey(projectName);
        const cleared = this._items.get(key);
        if (!cleared) { return undefined; }
        this._items.delete(key);
        return { cleared, next: this.current() };
    }

    /** 배지에 표시할 대표 항목(가장 먼저 등록된 것). 없으면 undefined. */
    current(): CompileStaleInfo | undefined {
        const first = this._items.values().next();
        return first.done ? undefined : first.value;
    }

    /** 전체 목록(등록 순). 상황 스냅샷용. */
    list(): CompileStaleInfo[] {
        return [...this._items.values()];
    }

    get size(): number {
        return this._items.size;
    }
}
