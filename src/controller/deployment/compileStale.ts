/**
 * "컴파일 검증 필요" 상태 추적 — vscode 무의존 순수 모듈.
 *
 * /GPL 소스는 업로드됐지만 Compile로 검증되지 않은 프로젝트를 담는다. 확장의 `Start`는 `-compile` 을 붙여
 * 컴파일까지 함께 하므로(ai-handoff §0.7 — 스위치 없는 Start 는 옛 바이너리를 실행한다, §1-DN) 옛 바이너리가
 * 도는 문제는 아니다. 다만 소스에 에러가 있으면 Start 단계에서 컴파일이 실패해 실행되지 않으므로 Start 전 안내가 필요하다.
 *
 * set: 업로드 후 Compile 보류(autoOnSave/THREAD_CHECK) · Compile 실패 · Upload Only.
 * clear: Compile 성공 확정(deployRecord.onDidRecordCompiled — 경로 무관: Deploy·F5·MCP·`GPL: Start` 의 `-compile` 성공) ·
 *        FTP Run 의 Compile 성공. Compile 성공은 그 프로젝트가 `ProjectLibrary` 로 끌어온 라이브러리 항목도 함께 해제한다
 *        (`clearCompiled`, 2026-11-03). 제어기 /GPL 에서 폴더가 지워지면(비우기) 그 이름도 해제한다(`clearMany`).
 *
 * 상태는 **제어기(ip)별**이고 Memento 에 영속된다(2026-10-28, §1-GN): 같은 이름의 프로젝트라도 다른 제어기에서는 검증됐을 수
 * 있고, 창을 다시 열어도 "아직 검증 안 됨"은 사실 그대로다. 키·저장 형식은 `deployRecordCore.DeployRecordStore` 와 같은 꼴이다.
 *
 * 로깅과 UI 반영(controllerTree/statusBar)은 호출부(`activation/host.ts`)에 남는다 — 이 모듈은 "무엇이 바뀌었는지"만 돌려준다.
 * 뷰는 대표 1건이 아니라 **현재 제어기의 전체 목록**(`list(ip)`)을 받는다 — Upload Only 로 여러 프로젝트를 올리면 모두 미검증인데
 * 종전에는 마지막 하나만 보였고, 그것을 컴파일하면 배지가 "다른 프로젝트로 바뀐" 것처럼 읽혔다(2026-10-28 사용자 지적).
 */

/** 한 프로젝트의 "컴파일 검증 필요" 사유. 트리·상태바(views)도 이 형을 그대로 받는다(사설 사본 없음, §1-DV). */
export interface CompileStaleInfo {
    /** 제어기 주소(설정 `gpl.controller.ip` 당시 값). 빈 문자열이면 제어기 불명 — 추적은 하되 어느 제어기에도 묶이지 않는다. */
    ip: string;
    projectName: string;
    projectDir?: string;
    /** 최초 set 시각(ms). 같은 프로젝트를 다시 set해도 유지된다 — "얼마나 오래 미검증인가"를 보이기 위함. */
    since: number;
    /** 가장 최근 set 시각(ms) — 며칠 전부터 미검증인 프로젝트를 오늘 다시 올렸을 때 "지금 올린 것"을 보이기 위함. */
    markedAt: number;
    reason: string;
    /**
     * ProjectStart 없는 라이브러리(그룹) 프로젝트인가. 단독으로는 Start 할 수 없고, 단독 Compile 은 같은 부팅의 Unload 에서
     * 명령 콘솔이 끊기는 상태를 만든다(`unloadRisk` — unload-after-group-compile). 그래서 배지가 Quick Compile 로 이끌지 않는다.
     * 이 라이브러리를 `ProjectLibrary` 로 쓰는 실행 프로젝트의 Compile 성공(`clearCompiled`)이 함께 해제한다(2026-11-03 inbox).
     */
    library?: boolean;
}

/** clear 결과 — 지운 항목과, 같은 제어기에 남은 항목(오래된 → 최근 표시 순). */
export interface CompileStaleCleared {
    cleared: CompileStaleInfo;
    remaining: CompileStaleInfo[];
}

/** clearCompiled 결과 — 컴파일한 프로젝트 자신(있었으면)과 그 Compile 에 함께 포함된 라이브러리 항목. */
export interface CompileStaleCompiledRelease {
    projectName: string;
    /** 컴파일한 프로젝트 자신의 항목(없었으면 undefined). */
    main?: CompileStaleInfo;
    /** 같은 Compile 에 포함돼 해제된 라이브러리 항목. */
    libraries: CompileStaleInfo[];
    remaining: CompileStaleInfo[];
}

/** clearMany(제어기 쪽 소스가 사라짐·사용자 해제) 결과. */
export interface CompileStaleBulkRelease {
    cleared: CompileStaleInfo[];
    remaining: CompileStaleInfo[];
}

/**
 * `ProjectLibrary` 값 → 그 라이브러리가 제어기에 놓이는 이름 키. 값은 projects 폴더(=/GPL) 기준 상대 경로이고
 * (`libraryUploadPlan` — 문서상 + 실측 표본), 프로젝트는 `/GPL/<ProjectName>` 에 올라가므로(deployTargetStage) 경로 조각을
 * `/` 로 이은 소문자가 항목의 이름 키와 같을 때만 같은 소스다. `MyProject\MyLibrary` 처럼 깊은 값은 `/GPL/MyLibrary` 에 올린
 * 항목과 다른 폴더라 맞추지 않는다. `..`·빈 값은 undefined.
 */
export function libraryReferenceKey(raw: string): string | undefined {
    const parts = raw.trim().split(/[\\/]+/).filter(p => p.length > 0 && p !== '.');
    if (parts.length === 0 || parts.includes('..')) { return undefined; }
    return parts.join('/').toLowerCase();
}

/**
 * 해제 로그 한 줄. 예: `컴파일 검증 필요 상태 해제: App (+ 라이브러리 PaL, Gantry — App Compile 에 포함) (남은 미검증 1개: X)`.
 * 해제한 것이 없으면 undefined(호출부는 로그·UI 를 건너뛴다).
 */
export function describeCompiledRelease(r: CompileStaleCompiledRelease): string | undefined {
    if (!r.main && r.libraries.length === 0) { return undefined; }
    const libs = r.libraries.map(i => i.projectName).join(', ');
    const head = !r.main
        ? `라이브러리 ${libs} — ${r.projectName} Compile 에 포함`
        : r.libraries.length > 0
            ? `${r.main.projectName} (+ 라이브러리 ${libs} — ${r.projectName} Compile 에 포함)`
            : r.main.projectName;
    return `컴파일 검증 필요 상태 해제: ${head}${describeRemaining(r.remaining)}`;
}

/** 남은 항목 꼬리말(` (남은 미검증 n개: A, B)`), 없으면 빈 문자열. */
export function describeRemaining(remaining: readonly CompileStaleInfo[]): string {
    return remaining.length > 0 ? ` (남은 미검증 ${remaining.length}개: ${remaining.map(i => i.projectName).join(', ')})` : '';
}

/** 영속 저장소 — `vscode.Memento` 의 부분 집합(테스트는 메모리 객체로 대신한다). */
export interface CompileStaleMemento {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: any): PromiseLike<void> | void;
}

/** Memento 저장 키. 값은 Record<키, CompileStaleInfo>. */
export const COMPILE_STALE_MEMENTO_KEY = 'gpl.compileStale';

/**
 * 이 상태가 "무슨 뜻이고 왜 문제인가"를 한 문장으로. 트리·상태바 배지 툴팁(`views/statusbar/compileStaleBadge`), Start 전 확인 모달,
 * 자동화 오류(`COMPILE_UNVERIFIED`)가 모두 이 문장을 쓴다 — 각자 조립하던 사본 4벌을 정본 하나로(§1-DV, 구조 테스트 R7 이
 * 사본을 잡는다). 앞뒤 맥락(클릭 안내·선택지·재호출 방법)은 호출부가 붙인다. `formatTime` 은 테스트용 주입.
 */
export function describeCompileStale(info: CompileStaleInfo, formatTime: (ms: number) => string = defaultFormatTime): string {
    const head = `'${info.projectName}' 의 /GPL 소스가 ${formatTime(info.since)} 이후 아직 Compile 로 검증되지 않았습니다(사유: ${info.reason}). `;
    return info.library
        ? head + 'ProjectStart 없는 라이브러리라 단독으로는 검증하지 않습니다 — 이 라이브러리를 ProjectLibrary 로 쓰는 실행 프로젝트를 Compile 하거나 Start 하면 함께 해제됩니다.'
        : head + 'Start 는 `-compile` 로 컴파일까지 하므로 소스에 에러가 있으면 실행되지 않고, 에러 위치는 Problems 에 표시됩니다. 먼저 Quick Compile 로 확인할 수 있습니다.';
}

function defaultFormatTime(ms: number): string {
    return new Date(ms).toLocaleString();
}

/** 제어기 주소 정규화(양끝 공백·대소문자 무시). */
function ipKey(ip: string | undefined): string {
    return (ip ?? '').trim().toLowerCase();
}

/** 프로젝트명(공백 제거·소문자) 기준 키. 빈 문자열이면 추적하지 않는다. */
function nameKey(projectName: string): string {
    return projectName.trim().toLowerCase();
}

/** 저장·조회 키: `<ip>|<project>` — deployRecordCore.deployRecordKey 와 같은 꼴. */
export function compileStaleKey(ip: string, projectName: string): string {
    return `${ipKey(ip)}|${nameKey(projectName)}`;
}

function isCompileStaleInfo(v: unknown): v is CompileStaleInfo {
    if (!v || typeof v !== 'object') { return false; }
    const o = v as Record<string, unknown>;
    return typeof o.projectName === 'string' && o.projectName.trim().length > 0
        && typeof o.ip === 'string'
        && typeof o.since === 'number' && typeof o.markedAt === 'number'
        && typeof o.reason === 'string'
        && (o.projectDir === undefined || typeof o.projectDir === 'string')
        && (o.library === undefined || typeof o.library === 'boolean');
}

export class CompileStaleTracker {
    /** 삽입 순서 = 표시(mark) 순서. 재표시는 뺐다 넣어 맨 뒤로 올린다. */
    private readonly _items = new Map<string, CompileStaleInfo>();
    private _memento: CompileStaleMemento | undefined;

    constructor(private readonly _onPersistError?: (err: unknown) => void) { }

    /**
     * 영속 저장소 연결(기존 저장분 로드 — 메모리에 이미 있는 것과 겹치면 더 최근 표시(`markedAt`)를 남긴다).
     * 로드된 항목은 `markedAt` 오름차순으로 넣어 "가장 최근 표시" 순서를 복원한다.
     */
    attach(memento: CompileStaleMemento): void {
        this._memento = memento;
        let stored: unknown;
        try {
            stored = memento.get<unknown>(COMPILE_STALE_MEMENTO_KEY, {});
        } catch (err) {
            this._onPersistError?.(err);
            return;
        }
        if (!stored || typeof stored !== 'object') { return; }
        const loaded = Object.values(stored as Record<string, unknown>).filter(isCompileStaleInfo)
            .sort((a, b) => a.markedAt - b.markedAt);
        const merged = new Map<string, CompileStaleInfo>();
        for (const info of loaded) { merged.set(compileStaleKey(info.ip, info.projectName), info); }
        for (const [key, info] of this._items) {
            const prev = merged.get(key);
            if (!prev || prev.markedAt <= info.markedAt) { merged.delete(key); merged.set(key, info); }
        }
        this._items.clear();
        for (const [key, info] of merged) { this._items.set(key, info); }
    }

    /** 제어기·프로젝트명으로 조회(대소문자·양끝 공백 무시). */
    find(ip: string, projectName: string): CompileStaleInfo | undefined {
        return this._items.get(compileStaleKey(ip, projectName));
    }

    /**
     * "컴파일 검증 필요"로 표시. 이미 있으면 사유·`markedAt` 만 갱신하고 `since`·`projectDir`는 보존한다.
     * 프로젝트명이 비어 있으면 추적하지 않고 undefined를 돌려준다(호출부는 로그·UI를 건너뛴다).
     * `library` 를 모르면(undefined) 이전 값을 잇는다.
     */
    mark(ip: string, projectName: string, reason: string, projectDir?: string, now: number = Date.now(), library?: boolean): CompileStaleInfo | undefined {
        if (!nameKey(projectName)) { return undefined; }
        const key = compileStaleKey(ip, projectName);
        const prev = this._items.get(key);
        const isLibrary = library ?? prev?.library;
        const info: CompileStaleInfo = {
            ip: (ip ?? '').trim(),
            projectName,
            projectDir: projectDir ?? prev?.projectDir,
            since: prev?.since ?? now,
            markedAt: now,
            reason,
            ...(isLibrary !== undefined ? { library: isLibrary } : {}),
        };
        // 다시 표시되면 Map 에서 뺐다 넣어 "가장 최근" 자리로 올린다 — 배지 대표·목록 순서가 마지막으로 손댄 쪽을 가리키게(§1-DY).
        this._items.delete(key);
        this._items.set(key, info);
        this.persist();
        return info;
    }

    /** 해제. 해당 항목이 없었으면 undefined(호출부는 로그·UI를 건너뛴다 — 같은 Compile로 여러 번 불려도 조용하다). */
    clear(ip: string, projectName: string): CompileStaleCleared | undefined {
        const key = compileStaleKey(ip, projectName);
        const cleared = this._items.get(key);
        if (!cleared) { return undefined; }
        this._items.delete(key);
        this.persist();
        return { cleared, remaining: this.list(ip) };
    }

    /**
     * Compile 성공 해제 — 컴파일한 프로젝트와, 그 Compile 에 함께 포함된 라이브러리(`ProjectLibrary` 값, 전이 포함)의 항목을 지운다.
     * 제어기는 `/GPL/<값>` 의 **현재 내용**을 함께 컴파일했으므로 어느 로컬 사본에서 올렸는지와 무관하게 이름 기준 해제가 맞다
     * (2026-11-03 inbox — PaL·Gantry 를 Upload Only 한 뒤 App 이 Compile 에 성공해도 두 항목이 남았다). 값 대조는 `libraryReferenceKey`.
     */
    clearCompiled(ip: string, projectName: string, libraryValues: readonly string[] = []): CompileStaleCompiledRelease {
        const mainKey = compileStaleKey(ip, projectName);
        const main = this._items.get(mainKey);
        if (main) { this._items.delete(mainKey); }
        const wanted = new Set(libraryValues.map(libraryReferenceKey).filter((k): k is string => k !== undefined));
        const libraries: CompileStaleInfo[] = [];
        const ipWanted = ipKey(ip);
        for (const [key, info] of this._items) {
            if (ipKey(info.ip) === ipWanted && wanted.has(nameKey(info.projectName))) {
                libraries.push(info);
                this._items.delete(key);
            }
        }
        if (main || libraries.length > 0) { this.persist(); }
        return { projectName, main, libraries, remaining: this.list(ip) };
    }

    /**
     * 라이브러리 여부를 나중에 채운다(필드가 생기기 전에 저장된 항목 — 활성화 때 `.gpr` 을 읽어 보충). 순서·시각은 그대로다.
     * 바뀐 것이 없으면 false.
     */
    setLibrary(ip: string, projectName: string, library: boolean): boolean {
        const key = compileStaleKey(ip, projectName);
        const info = this._items.get(key);
        if (!info || info.library === library) { return false; }
        this._items.set(key, { ...info, library });
        this.persist();
        return true;
    }

    /** 이름 여럿을 한 번에 해제(제어기 /GPL 에서 폴더가 지워짐·사용자가 목록에서 지움). 없던 이름은 건너뛴다. */
    clearMany(ip: string, projectNames: readonly string[]): CompileStaleBulkRelease {
        const cleared: CompileStaleInfo[] = [];
        for (const name of projectNames) {
            const key = compileStaleKey(ip, name);
            const info = this._items.get(key);
            if (!info) { continue; }
            cleared.push(info);
            this._items.delete(key);
        }
        if (cleared.length > 0) { this.persist(); }
        return { cleared, remaining: this.list(ip) };
    }

    /**
     * 그 제어기의 대표 항목 — **가장 최근에 표시(mark)된 것**. 없으면 undefined.
     * 종전에는 가장 먼저 등록된 것이어서, 방금 작업한 프로젝트가 미검증이 돼도 배지는 며칠 묵은 다른
     * 프로젝트를 계속 가리켰다(2026-09-21 사용자 지적). 사람이 마지막으로 손댄 쪽이 지금 필요한 정보다.
     */
    current(ip: string): CompileStaleInfo | undefined {
        const items = this.list(ip);
        return items.length > 0 ? items[items.length - 1] : undefined;
    }

    /** 목록(오래된 → 최근 표시 순, 마지막이 current). `ip` 를 주면 그 제어기 것만, 생략하면 전부(상황 스냅샷용). */
    list(ip?: string): CompileStaleInfo[] {
        const all = [...this._items.values()];
        if (ip === undefined) { return all; }
        const wanted = ipKey(ip);
        return all.filter(i => ipKey(i.ip) === wanted);
    }

    get size(): number {
        return this._items.size;
    }

    private persist(): void {
        const memento = this._memento;
        if (!memento) { return; }
        const data: Record<string, CompileStaleInfo> = {};
        for (const [key, info] of this._items) { data[key] = info; }
        try {
            const result = memento.update(COMPILE_STALE_MEMENTO_KEY, data);
            if (result && typeof (result as PromiseLike<void>).then === 'function') {
                (result as PromiseLike<void>).then(undefined, err => this._onPersistError?.(err));
            }
        } catch (err) {
            this._onPersistError?.(err);
        }
    }
}
