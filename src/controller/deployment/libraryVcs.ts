/**
 * 라이브러리 폴더의 버전 관리(SVN) 출처 — `svn info`·`svn propget svn:externals`·`svn status -q` 출력을 해석해
 * "이 라이브러리가 어디서 왔고, 고정(pinned)인가 따라가기(following)인가, 로컬 수정이 있는가"를 만든다.
 * 해석은 순수 함수(캡처한 출력 문자열로 시험)이고, svn 실행은 주입한다(`SvnRunner`) — svn 이 없거나 실패하면 `null` 이고 배포는 계속된다.
 *
 * 왜(2026-11-12 Sample Prep 수신함 v2 §2·§3): 공용 라이브러리를 `V2/Lib/<버전>/` 한 곳에 두고 장비마다 `svn:externals` 로 받으면,
 * 고정(`…/PaL@5405`)과 따라가기(`…/PaL`)가 장비 속성이 아니라 운영 상태다. 실측 함정(S2 커밋 안 됨 · S4 고정 external 변경이 조용히 빠짐 ·
 * S6 고정 폴더 안 `svn update` 가 HEAD 로 올림 · S9 폴더 없는 revision 은 경고만)은 모두 로컬 상태만 보고 배포 시점에 잡을 수 있다.
 *
 * 이 모듈은 파일을 고치지 않는다(`svn info`·`propget`·`status` 는 읽기 전용).
 */

import { execFile } from 'child_process';
import * as path from 'path';
import { normalizePathKey } from '../../util/pathKey';

/** svn 한 번 실행의 결과 — 종료 코드가 0 이 아니거나 타임아웃이면 `ok:false`. */
export interface SvnRunResult { ok: boolean; stdout: string }
/** svn 실행기(주입). `args` 는 `svn` 뒤의 인자, `cwd` 는 실행 폴더. */
export type SvnRunner = (args: readonly string[], cwd: string) => Promise<SvnRunResult>;

export type LibraryVcsMode = 'pinned' | 'following' | 'none';

export interface LibraryVcsInfo {
    kind: 'svn';
    /** 작업 사본의 실제 URL(`svn info --show-item url`). */
    url: string;
    /** 작업 사본 revision(`svn info --show-item revision`). */
    revision: number;
    /** 상위 `svn:externals` 가 고정(peg 또는 -r)했으면 pinned, peg 없이 받으면 following, externals 항목이 없으면 none. */
    mode: LibraryVcsMode;
    /** externals 가 고정한 revision(pinned 일 때). */
    peg?: number;
    /** 커밋하지 않은 로컬 변경 파일 수(`svn status -q`, externals·무시 항목 제외). */
    modifiedFiles: number;
    /** `svn status` 가 실패했거나 시간 안에 끝나지 않았다 — `modifiedFiles: 0` 은 "변경 없음"이 아니라 "모름"이다. */
    statusUnknown?: true;
    /** externals 값이 가리키는 URL(해석 가능할 때) — 실제 URL 과 대조해 드리프트를 본다. */
    expectedUrl?: string;
    /** 변경 파일 앞쪽 일부(상한 `MODIFIED_LIST_LIMIT`) — 경고에 파일 목록을 싣는다. */
    modified?: string[];
}

/** 작업 기록에 남기는 모양(수신함 v2 §2): `{kind,url,revision,mode,peg,modifiedFiles}`. */
export type LibraryVcsRecord = Pick<LibraryVcsInfo, 'kind' | 'url' | 'revision' | 'mode' | 'modifiedFiles'> & { peg?: number };

export const MODIFIED_LIST_LIMIT = 20;

export function toVcsRecord(vcs: LibraryVcsInfo): LibraryVcsRecord {
    return {
        kind: 'svn', url: vcs.url, revision: vcs.revision, mode: vcs.mode,
        ...(vcs.peg !== undefined ? { peg: vcs.peg } : {}), modifiedFiles: vcs.modifiedFiles,
    };
}

// ─── 순수 해석 ───────────────────────────────────────────────────────────────

/** `svn info --show-item X` 출력의 첫 줄(공백 제거). 비었으면 undefined. */
export function parseInfoItem(stdout: string): string | undefined {
    const line = stdout.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0);
    return line || undefined;
}

export interface ExternalEntry {
    /** 받는 위치(속성이 걸린 폴더 기준 상대 경로). */
    target: string;
    /** 원문 URL(peg 제외). 상대(`../`·`^/`)일 수 있다. */
    url: string;
    /** 고정 revision(`URL@N` 또는 `-r N`). */
    peg?: number;
}

/** 공백 구분 토큰 — 큰따옴표·작은따옴표 안의 공백은 보존하고, 따옴표 밖 `\ ` 는 공백 하나로 본다. */
function tokenize(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quote: string | null = null;
    let started = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) { quote = null; } else { cur += ch; }
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
        if (ch === '\\' && line[i + 1] === ' ') { cur += ' '; i++; started = true; continue; }
        if (/\s/.test(ch)) {
            if (started || cur) { out.push(cur); cur = ''; started = false; }
            continue;
        }
        cur += ch; started = true;
    }
    if (started || cur) { out.push(cur); }
    return out;
}

const URLISH = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\^\/|\.{1,2}\/|\/)/;

/**
 * `svn:externals` 속성 값 해석 — 새 형식(`[-r N] URL[@peg] TARGET`)과 옛 형식(`TARGET [-r N] URL`)을 모두 읽는다.
 * 빈 줄·`#` 주석 줄은 건너뛴다. 모르는 모양의 줄은 무시한다.
 */
export function parseSvnExternals(text: string): ExternalEntry[] {
    const out: ExternalEntry[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) { continue; }
        const tokens = tokenize(line);
        let peg: number | undefined;
        const rest: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const dash = /^-r(\d+)$/.exec(t);
            if (dash) { peg = Number(dash[1]); continue; }
            if (t === '-r' && /^\d+$/.test(tokens[i + 1] ?? '')) { peg = Number(tokens[i + 1]); i++; continue; }
            rest.push(t);
        }
        if (rest.length !== 2) { continue; }
        const [a, b] = rest;
        const [urlRaw, target] = URLISH.test(a) ? [a, b] : [b, a];
        if (!URLISH.test(urlRaw)) { continue; }
        const at = /^(.*)@(\d+)$/.exec(urlRaw);
        if (at) { out.push({ target, url: at[1], peg: peg ?? Number(at[2]) }); } else { out.push({ target, url: urlRaw, ...(peg !== undefined ? { peg } : {}) }); }
    }
    return out;
}

/**
 * externals 의 URL 원문을 절대 URL 로 푼다. 상대 형식은 **속성이 걸린 폴더의 URL** 기준이다(svn book "Externals Definitions").
 * `^/` 는 저장소 루트가 필요하다. 풀 수 없으면 undefined(대조를 건너뛴다).
 */
export function resolveExternalUrl(raw: string, holderUrl: string, repoRootUrl?: string): string | undefined {
    try {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) { return normalizeSvnUrl(raw); }
        if (raw.startsWith('^/')) { return repoRootUrl ? normalizeSvnUrl(`${repoRootUrl.replace(/\/+$/, '')}/${raw.slice(2)}`) : undefined; }
        if (raw.startsWith('//')) { return undefined; }
        return normalizeSvnUrl(new URL(raw, `${holderUrl.replace(/\/+$/, '')}/`).href);
    } catch {
        return undefined;
    }
}

/** URL 비교용 정규화 — `@peg` 접미사·끝 슬래시를 떼고 `new URL` 이 아는 퍼센트 인코딩 표기로 맞춘다. */
export function normalizeSvnUrl(url: string): string {
    const noPeg = url.trim().replace(/@\d+$/, '').replace(/\/+$/, '');
    try { return new URL(noPeg).href.replace(/\/+$/, ''); } catch { return noPeg; }
}

export interface StatusSummary { count: number; files: string[] }

/**
 * `svn status -q` 출력에서 변경 항목을 센다. 첫 두 칸(항목·속성 상태)이 M·A·D·R·C·!·~ 인 줄만 센다 — externals(`X`)·
 * 무시(`I`)·`Performing status on external item` 안내 줄은 센 것이 아니다. 경로는 8번째 칸 뒤.
 */
export function parseStatusQ(stdout: string): StatusSummary {
    const files: string[] = [];
    let count = 0;
    for (const line of stdout.split(/\r?\n/)) {
        if (line.length < 9) { continue; }
        const c0 = line[0];
        const c1 = line[1];
        const changed = 'MADRC!~'.includes(c0) || (c0 === ' ' && (c1 === 'M' || c1 === 'C'));
        if (!changed) { continue; }
        count++;
        if (files.length < MODIFIED_LIST_LIMIT) { files.push(line.slice(8).trim()); }
    }
    return { count, files };
}

/** 라이브러리 이름(폴더 이름)의 버전 표기 — URL 에서 라이브러리 폴더의 바로 위 폴더 이름(`…/Lib/v2/PaL` → `v2`). */
export function versionLabelFromUrl(url: string): string | undefined {
    const parts = normalizeSvnUrl(url).split('/').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : undefined;
}

// ─── 수집(svn 실행은 주입) ───────────────────────────────────────────────────

async function infoItem(run: SvnRunner, item: string, target: string, cwd: string): Promise<string | undefined> {
    const r = await run(['info', '--show-item', item, svnTarget(target)], cwd);
    return r.ok ? parseInfoItem(r.stdout) : undefined;
}

/**
 * svn 대상 인자 — 경로에 `@` 가 있으면 끝에 `@` 를 붙인다. svn 은 대상 끝의 `@<rev>` 를 peg revision 으로 읽어서, `Lib\PaL@2` 같은 폴더는
 * 그대로 넘기면 조회가 실패한다(문서상 Peg and Operative Revisions: 끝에 빈 `@` 를 붙이면 앞의 `@` 는 이름으로 남는다
 * https://svnbook.red-bean.com/en/1.7/svn.advanced.pegrevs.html).
 */
export function svnTarget(target: string): string {
    return target.includes('@') ? `${target}@` : target;
}

/** `libDir` 로 받는 externals 항목을 찾는다 — 상위 폴더 최대 3단계의 속성을 본다. */
async function findExternalFor(run: SvnRunner, libDir: string): Promise<{ entry: ExternalEntry; holderUrl: string; holderDir: string } | undefined> {
    const want = normalizePathKey(libDir);
    let holder = path.dirname(path.resolve(libDir));
    for (let level = 0; level < 3; level++) {
        const prop = await run(['propget', 'svn:externals', svnTarget(holder)], holder);
        if (!prop.ok) { return undefined; }
        const entries = parseSvnExternals(prop.stdout);
        const hit = entries.find(e => normalizePathKey(path.resolve(holder, e.target)) === want);
        if (hit) {
            const holderUrl = await infoItem(run, 'url', holder, holder);
            return holderUrl ? { entry: hit, holderUrl, holderDir: holder } : undefined;
        }
        const up = path.dirname(holder);
        if (up === holder) { return undefined; }
        holder = up;
    }
    return undefined;
}

/**
 * 라이브러리 폴더 하나의 SVN 출처. svn 이 없거나 작업 사본이 아니거나 실행이 실패하면 null — 호출측은 `vcs:null` 로 두고 계속한다.
 * 어떤 단계든 예외는 삼킨다(배포를 막지 않는다).
 */
export async function collectLibraryVcs(libDir: string, run: SvnRunner): Promise<LibraryVcsInfo | null> {
    try {
        const dir = path.resolve(libDir);
        const cwd = path.dirname(dir);
        const url = await infoItem(run, 'url', dir, cwd);
        const revText = url ? await infoItem(run, 'revision', dir, cwd) : undefined;
        const revision = revText !== undefined ? Number.parseInt(revText, 10) : NaN;
        if (!url || !Number.isFinite(revision)) { return null; }

        let mode: LibraryVcsMode = 'none';
        let peg: number | undefined;
        let expectedUrl: string | undefined;
        const ext = await findExternalFor(run, dir);
        if (ext) {
            peg = ext.entry.peg;
            mode = peg !== undefined ? 'pinned' : 'following';
            const root = ext.entry.url.startsWith('^/') ? await infoItem(run, 'repos-root-url', ext.holderDir, ext.holderDir) : undefined;
            expectedUrl = resolveExternalUrl(ext.entry.url, ext.holderUrl, root);
        }

        const status = await run(['status', '-q', svnTarget(dir)], cwd);
        const summary = status.ok ? parseStatusQ(status.stdout) : { count: 0, files: [] };
        return {
            kind: 'svn', url: normalizeSvnUrl(url), revision, mode,
            ...(peg !== undefined ? { peg } : {}),
            modifiedFiles: summary.count,
            ...(status.ok ? {} : { statusUnknown: true as const }),
            ...(expectedUrl ? { expectedUrl } : {}),
            ...(summary.files.length > 0 ? { modified: summary.files } : {}),
        };
    } catch {
        return null;
    }
}

/** 실제 `svn` 실행기 — 대화형 입력 없이(`--non-interactive`), 짧은 타임아웃. svn 이 없으면 `ok:false`. */
export function createSvnRunner(timeoutMs = 4000): SvnRunner {
    return (args, cwd) => new Promise(resolve => {
        try {
            execFile('svn', [...args, '--non-interactive'], { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
                (err, stdout) => resolve({ ok: !err, stdout: typeof stdout === 'string' ? stdout : '' }));
        } catch {
            resolve({ ok: false, stdout: '' });
        }
    });
}
