/**
 * 업로드 동기화 매니페스트 — "원격 경로에 어떤 내용을 올려 두었는가"의 지문 기록 (vscode 무의존).
 *
 * 왜: `mirrorProject`/`uploadProject(skipUnchanged)`의 스킵 판정이 **파일 크기 하나**였다. 제어기 FTP는
 * 목록(LIST)/`SIZE`로 크기만 알려 주므로, 로컬에서 같은 길이로 고친 파일(숫자 하나 교체, 상수 값 변경,
 * 주석 한 글자 수정 등 GPL 소스에서 흔한 편집)은 "변경 없음"으로 스킵되어 제어기가 낡은 소스를
 * 컴파일한다(§3 미해결 항목: "미러는 크기 비교라 동일 크기 내용변경은 놓침").
 *
 * 어떻게: 원격 파일의 내용을 직접 해시할 방법이 없으므로(제어기 FTP에 `HASH`/`XMD5` 계열 확장이 있다는
 * 근거 없음, 내려받아 해시하면 업로드와 같은 왕복 비용) **우리가 올린 내용의 SHA-1을 기록**해 두고,
 * 다음 동기화에서 "현재 로컬 내용 == 마지막으로 올린 내용"인지를 본다. 즉 스킵 조건이
 *   ① 원격에 그 파일이 있고 ② 원격 크기 == 로컬 크기 ③ 로컬 SHA-1 == 마지막 업로드 SHA-1
 *   ④ (원격 mtime을 알 수 있으면) 마지막으로 관측한 원격 mtime과 같음
 * 넷 모두일 때로 좁아진다. 매니페스트가 없으면(첫 동기화·확장 업데이트 직후) 스킵하지 않고 올린다 —
 * 판정 불가는 항상 "업로드" 쪽으로 넘어져야 낡은 소스 오컴파일이 생기지 않는다.
 *
 * 한계(문서화): 원격 파일이 우리 밖에서(다른 PC의 확장, GDE, 수동 FTP) 같은 크기로 바뀌고 mtime도
 * 관측되지 않으면 여전히 놓칠 수 있다. 그래서 저장소는 워크스페이스가 아니라 **globalState**에 두어
 * 같은 PC의 다른 워크스페이스와 기록을 공유하고, mtime 관측치를 함께 들고 다닌다.
 *
 * 저장 위치 연결은 `attachSyncManifestStore(context.globalState)` 한 번(extension.ts activate).
 * 단위 테스트: src/test/syncManifest.test.ts.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';

/** 파일 하나의 지문. 마지막으로 원격과 일치한다고 확인된 시점의 로컬 내용 기준. */
export interface SyncStamp {
    /** 그 시점의 로컬 파일 크기(원격 크기와 같아야 스킵 후보). */
    size: number;
    /** 로컬 파일 내용 SHA-1(hex). 빈 문자열이면 해시 실패/생략 → 크기 비교로 폴백. */
    sha1: string;
    /**
     * 마지막으로 관측한 원격 파일 mtime(ms). 업로드 직후에는 새 mtime을 알 수 없어 undefined이고,
     * 다음 목록 조회에서 관측값을 채택한다. 값이 있는데 관측치와 다르면 "원격이 우리 밖에서 바뀜"으로
     * 보고 업로드한다.
     */
    remoteMtimeMs?: number;
}

/** 원격 경로 하나(host + remoteDir)에 대한 기록. key는 `manifestFileKey`로 정규화한 상대 경로. */
export interface SyncManifestRecord {
    host: string;
    remoteDir: string;
    /** 마지막 기록 시각(ms). 보관 개수 제한 시 오래된 것부터 버리는 기준. */
    syncedAt: number;
    files: Record<string, SyncStamp>;
}

/** 파일별 지문 맵(한 원격 경로 기준). */
export type SyncManifestFiles = Record<string, SyncStamp>;

/** Memento 저장 키. 값은 Record<syncManifestKey, SyncManifestRecord>. */
export const SYNC_MANIFEST_MEMENTO_KEY = 'gpl.syncManifests';

/** 보관할 원격 경로 기록 수 상한(초과 시 syncedAt이 오래된 것부터 버린다). */
export const MAX_MANIFEST_RECORDS = 32;

/**
 * 해시 대상 크기 상한. GPL 프로젝트 소스는 수 KB~수백 KB지만, 폴더에 큰 파일이 섞여도 메모리를
 * 통째로 먹지 않도록 상한을 둔다. 초과 파일은 sha1='' → 종전대로 크기 비교로만 판정한다.
 */
export const MAX_HASH_BYTES = 64 * 1024 * 1024;

/** 저장소 키: host + 원격 경로(둘 다 trim·소문자, 경로 구분자 '/' 통일·끝 '/' 제거). */
export function syncManifestKey(host: string, remoteDir: string): string {
    return `${(host ?? '').trim().toLowerCase()}|${normalizeRemoteDir(remoteDir)}`;
}

/** 원격 경로 정규화: '\' → '/', 중복 '/' 축약, 끝 '/' 제거, 소문자. */
export function normalizeRemoteDir(remoteDir: string): string {
    return (remoteDir ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();
}

/**
 * 파일 key 정규화: 구분자 '/' 통일 + 소문자.
 * (Windows 로컬과 제어기 FTP 모두 대소문자를 구분하지 않으므로 같은 파일로 취급한다.)
 */
export function manifestFileKey(relativePath: string): string {
    return (relativePath ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * 파일 내용 SHA-1(hex). 읽기 실패나 크기 상한 초과면 빈 문자열을 돌려준다(예외를 던지지 않음) —
 * 호출측은 빈 문자열을 "해시 불가 → 크기 비교로 폴백"으로 다룬다.
 */
export function hashFileSync(file: string, size?: number): string {
    try {
        if (size !== undefined && size > MAX_HASH_BYTES) { return ''; }
        const content = fs.readFileSync(file);
        if (size === undefined && content.length > MAX_HASH_BYTES) { return ''; }
        return crypto.createHash('sha1').update(content).digest('hex');
    } catch {
        return '';
    }
}

/** 원격에서 관측한 값(목록 조회 또는 SIZE). mtime을 알 수 없는 경로에서는 modifiedAtMs 생략. */
export interface RemoteObservation {
    size: number;
    modifiedAtMs?: number;
}

/** 지금 로컬 파일의 상태. sha1이 빈 문자열이면 해시 불가(크기 비교로 폴백). */
export interface LocalObservation {
    size: number;
    sha1: string;
}

/**
 * 업로드를 생략해도 되는가(= 원격 내용이 로컬과 같다고 볼 근거가 있는가).
 * 판정 불가·근거 부족은 모두 false(업로드)로 넘어뜨린다.
 */
export function isUnchanged(
    stamp: SyncStamp | undefined,
    local: LocalObservation,
    remote: RemoteObservation | undefined,
): boolean {
    if (!remote) { return false; }                      // 원격에 없음
    if (remote.size !== local.size) { return false; }   // 크기부터 다름
    // 해시를 못 구한 파일(읽기 실패·상한 초과)은 종전 동작(크기 비교)으로 폴백한다.
    if (!local.sha1) { return true; }
    if (!stamp || !stamp.sha1) { return false; }        // 기록 없음/구버전 기록 → 확신 불가
    if (stamp.sha1 !== local.sha1) { return false; }    // 로컬 내용이 바뀜(크기가 같아도)
    if (stamp.size !== local.size) { return false; }    // 기록 자체가 어긋남(방어)
    // 원격 mtime을 양쪽 다 아는 경우에만 비교한다(제어기가 목록에 mtime을 안 주면 생략).
    if (stamp.remoteMtimeMs !== undefined && remote.modifiedAtMs !== undefined
        && stamp.remoteMtimeMs !== remote.modifiedAtMs) {
        return false;                                   // 우리 밖에서 원격이 바뀜
    }
    return true;
}

/**
 * 이번 동기화 뒤 남길 지문을 만든다.
 * - `skipped`: 원격 mtime을 방금 관측했으므로 채택한다(기록에 없던 경우 포함).
 * - `uploaded`: 새 원격 mtime은 알 수 없다 → undefined로 두고 다음 조회에서 채택한다.
 */
export function nextStamp(
    local: LocalObservation,
    remote: RemoteObservation | undefined,
    previous: SyncStamp | undefined,
    action: 'uploaded' | 'skipped',
): SyncStamp {
    const stamp: SyncStamp = { size: local.size, sha1: local.sha1 };
    if (action === 'skipped') {
        const mtime = remote?.modifiedAtMs ?? previous?.remoteMtimeMs;
        if (mtime !== undefined) { stamp.remoteMtimeMs = mtime; }
    }
    return stamp;
}

/** Memento의 최소 계약(테스트에서 가짜 객체로 대체 가능). deployRecordCore와 같은 형태. */
export interface SyncManifestMemento {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: any): PromiseLike<void> | void;
}

function isSyncStamp(v: any): v is SyncStamp {
    return !!v && typeof v === 'object'
        && typeof v.size === 'number'
        && typeof v.sha1 === 'string'
        && (v.remoteMtimeMs === undefined || typeof v.remoteMtimeMs === 'number');
}

/** 저장분 로드 시 형태 검증 — 손상된/구버전 항목이 런타임 예외를 내지 않도록 걸러낸다. */
export function isSyncManifestRecord(v: any): v is SyncManifestRecord {
    if (!v || typeof v !== 'object') { return false; }
    if (typeof v.host !== 'string' || typeof v.remoteDir !== 'string') { return false; }
    if (typeof v.syncedAt !== 'number' || !Number.isFinite(v.syncedAt)) { return false; }
    if (!v.files || typeof v.files !== 'object' || Array.isArray(v.files)) { return false; }
    return Object.values(v.files).every(isSyncStamp);
}

/**
 * 매니페스트 저장소: 메모리 맵 + (attach 된) Memento 영속화.
 * 저장 실패는 조용히 무시한다(기록 유실일 뿐이고, 기록이 없으면 스킵하지 않아 안전한 쪽으로 넘어진다).
 */
export class SyncManifestStore {
    private readonly _records = new Map<string, SyncManifestRecord>();
    private _memento: SyncManifestMemento | undefined;

    constructor(private readonly _onPersistError?: (err: unknown) => void) { }

    attach(memento: SyncManifestMemento): void {
        this._memento = memento;
        let stored: unknown;
        try {
            stored = memento.get<unknown>(SYNC_MANIFEST_MEMENTO_KEY, {});
        } catch (err) {
            this._onPersistError?.(err);
            return;
        }
        if (!stored || typeof stored !== 'object') { return; }
        for (const value of Object.values(stored as Record<string, unknown>)) {
            if (!isSyncManifestRecord(value)) { continue; }
            const key = syncManifestKey(value.host, value.remoteDir);
            const existing = this._records.get(key);
            if (!existing || existing.syncedAt <= value.syncedAt) {
                this._records.set(key, value);
            }
        }
    }

    /** 그 원격 경로의 파일별 지문(없으면 빈 객체). */
    get(host: string, remoteDir: string): SyncManifestFiles {
        return this._records.get(syncManifestKey(host, remoteDir))?.files ?? {};
    }

    /**
     * 전체 목록 기준 동기화(미러) 결과 기록 — 기존 항목을 **대체**한다.
     * 로컬에서 사라진 파일의 지문도 함께 없애기 위해 병합하지 않는다.
     */
    replace(host: string, remoteDir: string, files: SyncManifestFiles, syncedAt: number): void {
        this.write(host, remoteDir, { ...files }, syncedAt);
    }

    /**
     * 일부 파일만 올린 결과 기록(uploadProject onlyFiles 등) — 기존 항목에 **병합**한다.
     * 이번에 다루지 않은 파일의 지문은 그대로 두어야 다음 미러에서 재사용된다.
     */
    merge(host: string, remoteDir: string, files: SyncManifestFiles, syncedAt: number): void {
        this.write(host, remoteDir, { ...this.get(host, remoteDir), ...files }, syncedAt);
    }

    /** 그 원격 경로의 기록을 버린다(Unload·폴더 삭제 등 원격을 통째로 무효화했을 때). */
    forget(host: string, remoteDir: string): void {
        if (this._records.delete(syncManifestKey(host, remoteDir))) { this.persist(); }
    }

    /** 현재 메모리에 있는 기록 전체(테스트/진단용). */
    all(): SyncManifestRecord[] {
        return [...this._records.values()];
    }

    private write(host: string, remoteDir: string, files: SyncManifestFiles, syncedAt: number): void {
        this._records.set(syncManifestKey(host, remoteDir), { host, remoteDir, syncedAt, files });
        this.prune();
        this.persist();
    }

    /** 오래된 기록부터 버려 MAX_MANIFEST_RECORDS 이하로 유지한다. */
    private prune(): void {
        if (this._records.size <= MAX_MANIFEST_RECORDS) { return; }
        const byOldest = [...this._records.entries()].sort((a, b) => a[1].syncedAt - b[1].syncedAt);
        for (const [key] of byOldest.slice(0, this._records.size - MAX_MANIFEST_RECORDS)) {
            this._records.delete(key);
        }
    }

    private persist(): void {
        const memento = this._memento;
        if (!memento) { return; }
        const data: Record<string, SyncManifestRecord> = {};
        for (const [key, rec] of this._records) {
            data[key] = rec;
        }
        try {
            const result = memento.update(SYNC_MANIFEST_MEMENTO_KEY, data);
            if (result && typeof (result as PromiseLike<void>).then === 'function') {
                (result as PromiseLike<void>).then(undefined, err => this._onPersistError?.(err));
            }
        } catch (err) {
            this._onPersistError?.(err);
        }
    }
}

const _store = new SyncManifestStore(err => {
    // 저장 실패는 기록 유실일 뿐 동기화 정확성을 해치지 않는다(기록이 없으면 업로드 쪽으로 넘어진다).
    console.warn(`[gpl syncManifest] Memento 저장 실패(무시): ${(err as any)?.message ?? err}`);
});

/** 영속 저장소 연결. extension.ts activate에서 `context.globalState`로 한 번 호출한다. */
export function attachSyncManifestStore(memento: SyncManifestMemento): void {
    _store.attach(memento);
}

/** 그 원격 경로의 직전 지문(없으면 빈 객체) — 업로드 전에 읽어 ftpClient에 넘긴다. */
export function getSyncManifest(host: string, remoteDir: string): SyncManifestFiles {
    return _store.get(host, remoteDir);
}

/** 미러(전체 목록) 성공 후 기록. */
export function recordSyncManifest(host: string, remoteDir: string, files: SyncManifestFiles): void {
    _store.replace(host, remoteDir, files, Date.now());
}

/** 일부 파일 업로드 성공 후 기록(기존 지문 유지). */
export function mergeSyncManifest(host: string, remoteDir: string, files: SyncManifestFiles): void {
    _store.merge(host, remoteDir, files, Date.now());
}

/** 원격을 통째로 무효화했을 때(Unload/폴더 삭제) 기록 폐기. */
export function forgetSyncManifest(host: string, remoteDir: string): void {
    _store.forget(host, remoteDir);
}
