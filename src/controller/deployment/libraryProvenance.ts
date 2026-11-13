/**
 * 라이브러리 출처 기록(provenance) — 배포·컴파일 결과와 작업 기록 JSON 에 라이브러리마다 `{name, localPath, vcs, uploaded}` 를 남긴다.
 * `vcs` 는 SVN 출처(`libraryVcs.ts`, 없으면 null), `uploaded` 는 **실제로 올린 파일 집합**(전처리 뒤)의 개수와 해시다.
 * 해시는 PC 쪽에서 업로드 집합으로 계산한다(제어기 계산 불필요) — 정렬한 (상대 이름 + 내용 sha256) 목록을 다시 sha256 한다.
 *
 * 왜(2026-11-12 Sample Prep 수신함 v2 §2): SVN 이 `v2@r5405` 라고 해도 그 뒤 로컬에서 고쳤을 수 있고(커밋했다고 생각했는데 안 된 경우 포함),
 * 장비 WORKLOG 의 `Lib v2 @ r5405 — 컴파일 0 · 여유 메모리` 를 손으로 여러 곳에 적으면 틀리기 쉽다. 배포 기록에서 뽑게 한다.
 *
 * 이전 업로드 기록의 저장(`LibraryProvenanceStore`)은 preflight 가 "원격 `/GPL/<lib>` 의 마지막 업로드 출처 == 이번 로컬 출처"를 가를 때 쓴다.
 * 순수 로직만(vscode 무의존) — Memento 연결은 `deployRecord.ts`.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { toVcsRecord } from './libraryVcs';
import type { LibraryVcsInfo, LibraryVcsRecord } from './libraryVcs';

export interface LibraryProvenance {
    /** `.gpr` 의 ProjectLibrary 값(원문). */
    name: string;
    localPath: string;
    /** 원격 폴더(`/GPL/<값>`) — 이전 업로드 기록의 열쇠. */
    remoteDir?: string;
    /** SVN 출처. svn 이 없거나 작업 사본이 아니면 null. */
    vcs: LibraryVcsRecord | null;
    uploaded: { files: number; sha256: string };
}

/** 업로드 집합 — `ftpClient.getAllFiles` 와 같은 규칙(점으로 시작하는 항목 제외, 재귀, 상대 경로는 `/` 구분). 정렬해 돌려준다. */
export function listUploadSet(dir: string): string[] {
    const out: string[] = [];
    const walk = (cur: string, rel: string): void => {
        for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) { continue; }
            const next = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) { walk(path.join(cur, entry.name), next); } else { out.push(next); }
        }
    };
    walk(dir, '');
    return out.sort();
}

/** (상대 이름 + 내용 sha256) 목록의 해시 — 이름은 소문자 비교(원격 이름 비교 규칙과 같다)로 정렬해 결정적이다. */
export function hashUploadSet(entries: readonly { rel: string; sha256: string }[]): string {
    const lines = entries.map(e => `${e.rel.replace(/\\/g, '/').toLowerCase()}\t${e.sha256}`).sort();
    return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** 폴더의 업로드 집합을 읽어 개수와 해시를 낸다. 못 읽는 파일이 있으면 예외(호출측이 `uploaded` 없이 진행하지 않도록 삼키지 않는다). */
export function summarizeUploadDir(dir: string): { files: number; sha256: string } {
    const rels = listUploadSet(dir);
    const entries = rels.map(rel => ({
        rel,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, ...rel.split('/')))).digest('hex'),
    }));
    return { files: entries.length, sha256: hashUploadSet(entries) };
}

export function buildLibraryProvenance(input: {
    name: string;
    localPath: string;
    remoteDir?: string;
    vcs: LibraryVcsInfo | null;
    uploaded: { files: number; sha256: string };
}): LibraryProvenance {
    return {
        name: input.name,
        localPath: input.localPath,
        ...(input.remoteDir ? { remoteDir: input.remoteDir } : {}),
        vcs: input.vcs ? toVcsRecord(input.vcs) : null,
        uploaded: input.uploaded,
    };
}

/**
 * 한 줄 요약 — `libs PaL v2@r5405(pinned) · Gantry v2@HEAD+3M`.
 * 고정은 `@r<peg>(pinned)`, 따라가기는 `@HEAD`, externals 가 아닌 작업 사본은 `@r<rev>(wc)`, 출처 모름은 `(vcs ?)`. 로컬 변경은 `+<n>M`.
 * 버전 이름은 URL 에서 라이브러리 폴더 바로 위 폴더 이름(`Lib/v2/PaL` → `v2`)이고, 못 구하면 생략한다.
 */
export function describeLibraries(libs: readonly Pick<LibraryProvenance, 'name' | 'vcs'>[]): string {
    if (libs.length === 0) { return ''; }
    const parts = libs.map(l => {
        const v = l.vcs;
        if (!v) { return `${l.name} (vcs ?)`; }
        const segs = v.url.replace(/\/+$/, '').split('/').filter(Boolean);
        const ver = segs.length >= 2 ? segs[segs.length - 2] : '';
        const at = v.mode === 'pinned' ? `r${v.peg ?? v.revision}(pinned)` : v.mode === 'following' ? 'HEAD' : `r${v.revision}(wc)`;
        const dirty = v.modifiedFiles > 0 ? `+${v.modifiedFiles}M` : '';
        return `${l.name} ${ver}@${at}${dirty}`;
    });
    return `libs ${parts.join(' · ')}`;
}

// ─── 이전 업로드 기록(영속은 deployRecord.ts 의 Memento) ──────────────────────

export const LIBRARY_PROVENANCE_MEMENTO_KEY = 'gpl.libraryProvenance';

export interface StoredLibraryProvenance { recordedAt: number; library: LibraryProvenance }

/** 키 — 제어기 ip + 원격 폴더(대소문자 무시). */
export function libraryProvenanceKey(ip: string, remoteDir: string): string {
    return `${ip.trim().toLowerCase()}|${remoteDir.replace(/\/+$/, '').toLowerCase()}`;
}

interface MementoLike { get<T>(key: string, def: T): T; update(key: string, v: any): Thenable<void> }

/** 원격 라이브러리 폴더마다 **마지막으로 올린 출처** — 이 확장이 올린 것만 안다(다른 도구·다른 PC 가 올린 것은 기록이 없다 → 확인 불가). */
export class LibraryProvenanceStore {
    private readonly records = new Map<string, StoredLibraryProvenance>();
    private memento?: MementoLike;
    constructor(private readonly onError?: (err: unknown) => void) { /* no-op */ }

    attach(memento: MementoLike): void {
        this.memento = memento;
        try {
            const saved = memento.get<Record<string, StoredLibraryProvenance>>(LIBRARY_PROVENANCE_MEMENTO_KEY, {});
            for (const [k, v] of Object.entries(saved ?? {})) { if (!this.records.has(k) && v?.library) { this.records.set(k, v); } }
        } catch (err) { this.onError?.(err); }
    }

    record(ip: string, remoteDir: string, library: LibraryProvenance, now = Date.now()): void {
        this.records.set(libraryProvenanceKey(ip, remoteDir), { recordedAt: now, library });
        try {
            void this.memento?.update(LIBRARY_PROVENANCE_MEMENTO_KEY, Object.fromEntries(this.records));
        } catch (err) { this.onError?.(err); }
    }

    get(ip: string, remoteDir: string): StoredLibraryProvenance | undefined {
        return this.records.get(libraryProvenanceKey(ip, remoteDir));
    }
}
