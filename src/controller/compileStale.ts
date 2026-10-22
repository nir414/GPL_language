/**
 * "컴파일 검증 필요" 상태 추적 — vscode 무의존 순수 모듈.
 *
 * /GPL 소스는 업로드됐지만 Compile로 검증되지 않은 프로젝트를 담는다. 확장의 `Start`는 `-compile` 을 붙여
 * 컴파일까지 함께 하므로(ai-handoff §0.7 — 스위치 없는 Start 는 옛 바이너리를 실행한다, §1-DN) 옛 바이너리가
 * 도는 문제는 아니다. 다만 소스에 에러가 있으면 Start 단계에서 컴파일이 실패해 실행되지 않으므로 Start 전 안내가 필요하다.
 *
 * set: 업로드 후 Compile 보류(autoOnSave/THREAD_CHECK) · Compile 실패.
 * clear: Compile 성공 확정(deployRecord.onDidRecordCompiled — 경로 무관) · Load→Compile→Start 성공.
 *
 * extension.ts의 activate() 클로저에 있던 Map + 3함수를 옮긴 것이다(테스트 가능하게).
 * 로깅과 UI 반영(controllerTree/statusBar)은 호출부에 남는다 — 이 모듈은 "무엇이 바뀌었는지"만 돌려준다.
 */

/** 한 프로젝트의 "컴파일 검증 필요" 사유. 트리·상태바(views)도 이 형을 그대로 받는다(사설 사본 없음, §1-DV). */
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

/**
 * 이 상태가 "무슨 뜻이고 왜 문제인가"를 한 문장으로. 트리·상태바 배지 툴팁(`views/compileStaleBadge`), Start 전 확인 모달,
 * 자동화 오류(`COMPILE_UNVERIFIED`)가 모두 이 문장을 쓴다 — 각자 조립하던 사본 4벌을 정본 하나로(§1-DV, 구조 테스트 R7 이
 * 사본을 잡는다). 앞뒤 맥락(클릭 안내·선택지·재호출 방법)은 호출부가 붙인다. `formatTime` 은 테스트용 주입.
 */
export function describeCompileStale(info: CompileStaleInfo, formatTime: (ms: number) => string = defaultFormatTime): string {
    return `'${info.projectName}' 의 /GPL 소스가 ${formatTime(info.since)} 이후 아직 Compile 로 검증되지 않았습니다(사유: ${info.reason}). `
        + 'Start 는 `-compile` 로 컴파일까지 하므로 소스에 에러가 있으면 실행되지 않고, 에러 위치는 Problems 에 표시됩니다. 먼저 Quick Compile 로 확인할 수 있습니다.';
}

function defaultFormatTime(ms: number): string {
    return new Date(ms).toLocaleString();
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
        // 다시 표시되면 Map 에서 뺐다 넣어 "가장 최근" 자리로 올린다. 배지 대표는 current()(최근 등록 순)인데
        // host.markCompileStale 은 방금 표시한 항목을 바로 배지에 꽂으므로, 올리지 않으면 뒤이은 다른 프로젝트의
        // clear 한 번에 배지가 옛 항목으로 되돌아간다 — 두 경로가 같은 항목을 가리키게 맞춘다.
        this._items.delete(key);
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

    /**
     * 배지에 표시할 대표 항목 — **가장 최근에 표시(mark)된 것**. 없으면 undefined.
     * 종전에는 가장 먼저 등록된 것이어서, 방금 작업한 프로젝트가 미검증이 돼도 배지는 며칠 묵은 다른
     * 프로젝트를 계속 가리켰다(2026-09-21 사용자 지적). 사람이 마지막으로 손댄 쪽이 지금 필요한 정보다.
     */
    current(): CompileStaleInfo | undefined {
        let latest: CompileStaleInfo | undefined;
        for (const info of this._items.values()) { latest = info; }
        return latest;
    }

    /** 전체 목록(오래된 → 최근 표시 순, 마지막이 current). 상황 스냅샷용. */
    list(): CompileStaleInfo[] {
        return [...this._items.values()];
    }

    get size(): number {
        return this._items.size;
    }
}
