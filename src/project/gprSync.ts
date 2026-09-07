/**
 * Project.gpr ↔ 폴더 소스 파일 동기화 — 순수 로직 (vscode 의존 없음, 단위 테스트 대상).
 *
 * GDE가 저장하는 Project.gpr 형식(실제 파일 관측, 2026-08-28 MergeCode 65파일):
 *
 *   'MM/DD/YYYY, HH:MM:SS AM|PM        ← 첫 줄 주석 타임스탬프(GDE 저장 시각)
 *   ProjectBegin
 *   ProjectName="MergeCode"
 *   ProjectStart="Main"
 *   ProjectSource="__init__IOConfig__.gpl" … (파일당 한 줄, 폴더 기준 상대 경로)
 *   ProjectEnd
 *
 * 경로는 **하위 폴더를 포함할 수 있다** — `ProjectSource="T1\T1.gpl"`, `ProjectSource="T1\T2\T2.gpl"`
 * (2026-08-28 실제 파일 확인, 임의 깊이). 구분자는 GDE 관측 형식인 `\`이고, 비교는 sourceKey가
 * `\`/`/`·대소문자 차이를 무시한다. 폴더 쪽 목록을 만드는 것은 `project/projectSources.ts`.
 *
 * 라이브러리 참조(2026-08-31 실제 파일 확인, GDS가 저장한 MyProject):
 *
 *   ProjectLibrary="MyProject\MyLibrary"   ← 단순 프로젝트명이 아니라 `\` 구분 **경로**
 *
 * 관측된 배치는 **중첩 프로젝트**다 — `projects/MyProject/` 안에 자기 `Project.gpr`를 가진
 * `MyLibrary/`가 들어 있고, 값은 projects 루트 기준 상대 경로였다. 경로 해석(어느 기준인지)은
 * `project/projectSources.ts`의 `resolveProjectLibraryDirs`가 후보를 순서대로 시도해 정한다.
 * 여기서는 **인식과 보존만** 한다 — 라이브러리 줄은 소스 동기화의 추가/제거 대상이 아니다.
 *
 * ASCII/UTF-8, BOM 없음. 줄바꿈은 파일마다 다를 수 있어(LF 관측) 원본을 그대로 유지한다.
 * .gpo(컴파일 산출물 바이너리)는 관측 파일에서 ProjectSource에 포함되지 않았다 → 기본 확장은 .gpl만.
 *
 * 동기화 규칙: 기존 항목의 순서는 건드리지 않고, 폴더에 있지만 목록에 없는 파일은 ProjectEnd 앞에
 * 이름순으로 추가, 목록에 있지만 폴더에 없는 항목은 제거(호출측이 선택 가능). 다른 줄은 보존한다.
 */

export type GprEol = '\r\n' | '\n';

export interface GprSourceEntry {
    /** 0-based 줄 번호 */
    line: number;
    /** ProjectSource="…" 안의 값(원문 그대로) */
    path: string;
}

/** `ProjectLibrary="…"` 한 줄. `path`는 원문 값 그대로(해석은 `project/projectSources.ts`). */
export interface GprLibraryEntry {
    /** 0-based 줄 번호 */
    line: number;
    /** ProjectLibrary="…" 안의 값(원문 그대로) */
    path: string;
}

export interface ParsedGpr {
    eol: GprEol;
    /** 마지막 줄바꿈 뒤 빈 조각 포함 여부(파일 끝 개행 보존용) */
    endsWithNewline: boolean;
    lines: string[];
    projectName?: string;
    projectStart?: string;
    sources: GprSourceEntry[];
    /** `ProjectLibrary` 항목(0..N). 소스와 달리 동기화 대상이 아니다 — 인식만 하고 그대로 보존한다. */
    libraries: GprLibraryEntry[];
    /** `ProjectEnd` 줄 번호, 없으면 -1 */
    projectEndLine: number;
    /** 첫 줄이 GDE 타임스탬프 주석(`'…`)이면 0, 아니면 -1 */
    timestampLine: number;
}

const TIMESTAMP_RE = /^'\s*\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M\s*$/i;
const SOURCE_RE = /^\s*ProjectSource\s*=\s*["']([^"']*)["']\s*$/i;
const LIBRARY_RE = /^\s*ProjectLibrary\s*=\s*["']([^"']*)["']\s*$/i;

export function parseGprText(text: string): ParsedGpr {
    const eol: GprEol = /\r\n/.test(text) ? '\r\n' : '\n';
    const endsWithNewline = /\r?\n$/.test(text);
    const body = endsWithNewline ? text.replace(/\r?\n$/, '') : text;
    const lines = body.length === 0 ? [] : body.split(/\r?\n/);

    const parsed: ParsedGpr = {
        eol,
        endsWithNewline,
        lines,
        sources: [],
        libraries: [],
        projectEndLine: -1,
        timestampLine: lines.length > 0 && TIMESTAMP_RE.test(lines[0]) ? 0 : -1,
    };

    lines.forEach((raw, i) => {
        const src = SOURCE_RE.exec(raw);
        if (src) {
            parsed.sources.push({ line: i, path: src[1].trim() });
            return;
        }
        const lib = LIBRARY_RE.exec(raw);
        if (lib) {
            parsed.libraries.push({ line: i, path: lib[1].trim() });
            return;
        }
        const name = /^\s*ProjectName\s*=\s*["']([^"']*)["']/i.exec(raw);
        if (name) { parsed.projectName = name[1]; return; }
        const start = /^\s*ProjectStart\s*=\s*["']([^"']*)["']/i.exec(raw);
        if (start) { parsed.projectStart = start[1]; return; }
        if (/^\s*ProjectEnd\s*$/i.test(raw) && parsed.projectEndLine < 0) {
            parsed.projectEndLine = i;
        }
    });
    return parsed;
}

/** GDE 형식 타임스탬프 주석: `'08/28/2026, 03:58:19 PM` */
export function formatGprTimestamp(d: Date): string {
    const p2 = (n: number): string => String(n).padStart(2, '0');
    const h24 = d.getHours();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ampm = h24 < 12 ? 'AM' : 'PM';
    return `'${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()}, ${p2(h12)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${ampm}`;
}

/** 경로 비교 키 — 대소문자·구분자 차이 무시 (Windows 파일 시스템 + GPL 대소문자 무시 관례). */
export function sourceKey(p: string): string {
    return p.trim().replace(/\\/g, '/').toLowerCase();
}

/** 폴더 목록에서 소스로 볼 파일만 고른다(확장자 필터, 대소문자 무시, 이름순). */
export function filterSourceFiles(entries: string[], extensions: readonly string[]): string[] {
    const exts = new Set(extensions.map(e => (e.startsWith('.') ? e : `.${e}`).toLowerCase()));
    return entries
        .filter(name => {
            const dot = name.lastIndexOf('.');
            return dot >= 0 && exts.has(name.slice(dot).toLowerCase());
        })
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export interface GprSyncPlan {
    /** 폴더에 있지만 목록에 없는 파일(추가 대상, 이름순) */
    toAdd: string[];
    /** 목록에 있지만 폴더에 없는 항목(제거 대상) */
    toRemove: GprSourceEntry[];
    /** 양쪽에 모두 있는 항목 수 */
    kept: number;
}

export interface PlanGprSyncOptions {
    /**
     * 항목이 실제로 디스크에 있는지 확인하는 함수(폴더 기준 상대 경로를 받는다).
     *
     * 주면 **목록에 없다 + 디스크에도 없다** 둘을 모두 만족할 때만 제거 대상으로 본다.
     * 목록(`sourceFiles`)은 탐색 제외 규칙·깊이 상한 같은 이유로 실제 파일을 빠뜨릴 수 있으므로,
     * 이 확인이 없으면 멀쩡한 항목(예: 하위 폴더의 `T1\T2\T2.gpl`)을 지우자고 제안하게 된다.
     */
    existsOnDisk?: (relPath: string) => boolean;
}

export function planGprSync(parsed: ParsedGpr, sourceFiles: string[], opts: PlanGprSyncOptions = {}): GprSyncPlan {
    const listed = new Map<string, GprSourceEntry>();
    for (const e of parsed.sources) { listed.set(sourceKey(e.path), e); }
    const onDisk = new Set(sourceFiles.map(sourceKey));

    const toAdd = sourceFiles.filter(f => !listed.has(sourceKey(f)));
    const toRemove = parsed.sources.filter(e => {
        if (onDisk.has(sourceKey(e.path))) { return false; }
        return opts.existsOnDisk ? !opts.existsOnDisk(e.path) : true;
    });
    const kept = parsed.sources.length - toRemove.length;
    return { toAdd, toRemove, kept };
}

export interface ApplyGprSyncOptions {
    add: string[];
    /** 제거할 항목의 줄 번호(parseGprText 기준) */
    removeLines?: number[];
    /**
     * 추가할 `ProjectLibrary` 값 — 소스 줄보다 **앞에** 넣는다(GDE·수작업 파일의 통상 순서).
     * 소스 목록 동기화는 이걸 쓰지 않는다. BP용 소스 승격(`project/sourcePromotion.ts`)처럼
     * 라이브러리 참조를 갈아끼우는 편집이 같은 "다른 줄은 그대로 보존" 규칙을 재사용하기 위한 것이다.
     */
    addLibraries?: string[];
    /** 소스/라이브러리 줄보다 앞에 그대로 넣을 줄(주석 등) — 되돌리기용 원본 기록에 쓴다. */
    prependLines?: string[];
    /** 지정하면 첫 줄 타임스탬프 주석을 갱신(GDE 저장 시각과 같은 의미). 없으면 그대로 둔다. */
    now?: Date;
}

/** 편집 결과 텍스트. 줄바꿈·파일 끝 개행·다른 줄은 원본 유지. */
export function applyGprSync(text: string, opts: ApplyGprSyncOptions): string {
    const parsed = parseGprText(text);
    const remove = new Set(opts.removeLines ?? []);
    const out: string[] = [];

    const insertAt = parsed.projectEndLine >= 0 ? parsed.projectEndLine : parsed.lines.length;
    const addLines = [
        ...(opts.prependLines ?? []),
        ...(opts.addLibraries ?? []).map(l => `ProjectLibrary="${l}"`),
        ...opts.add.map(f => `ProjectSource="${f}"`),
    ];

    parsed.lines.forEach((raw, i) => {
        if (i === insertAt) { out.push(...addLines); }
        if (remove.has(i)) { return; }
        if (i === parsed.timestampLine && opts.now) {
            out.push(formatGprTimestamp(opts.now));
            return;
        }
        out.push(raw);
    });
    if (insertAt >= parsed.lines.length) {
        out.push(...addLines);
        if (parsed.projectEndLine < 0 && parsed.lines.length > 0) { out.push('ProjectEnd'); }
    }

    const eol = parsed.eol;
    const endsWithNewline = parsed.lines.length === 0 ? true : parsed.endsWithNewline;
    return out.join(eol) + (endsWithNewline ? eol : '');
}

export interface CreateGprOptions {
    projectName: string;
    sources: string[];
    projectStart?: string;
    eol?: GprEol;
    now?: Date;
}

/** Project.gpr가 없는 폴더용 새 파일 텍스트(GDE 형식, 파일 끝 개행 포함). */
export function createGprText(opts: CreateGprOptions): string {
    const eol = opts.eol ?? '\r\n';
    const lines = [
        formatGprTimestamp(opts.now ?? new Date()),
        'ProjectBegin',
        `ProjectName="${opts.projectName}"`,
        `ProjectStart="${opts.projectStart ?? 'Main'}"`,
        ...opts.sources.map(f => `ProjectSource="${f}"`),
        'ProjectEnd',
    ];
    return lines.join(eol) + eol;
}
