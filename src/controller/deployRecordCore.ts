/**
 * 컴파일 스냅샷 기록(deploy record) — 순수 로직 (vscode 무의존).
 *
 * 왜 (GitHub #21): Attach only 디버깅에서 Start 이후 소스를 편집하면 BP는 새 소스의 줄 번호로 설정되지만
 * 제어기는 옛 컴파일 코드를 실행한다. 제어기는 `Set Break`를 성공으로 받아 verified:true 인데 실제로는
 * 절대 걸리지 않는다. "제어기 실행 코드보다 로컬 소스가 새로움"을 판정하려면 마지막으로 컴파일에
 * 성공한 시점의 로컬 소스 상태가 필요하다. 이 모듈은 그 스냅샷(파일별 size/mtime/sha1)을 만들고,
 * 현재 로컬 상태와 비교하는 데이터 기반을 제공한다.
 *
 * 주의: 스냅샷은 제어기 상태가 아니라 "우리가 올려서 컴파일한 소스"의 기록이다. 제어기 상태 판정은
 * 여전히 1402 live `<STATUS>`로만 하며(§0 하드 규칙), 이 비교 결과는 "소스가 컴파일본보다 새로울 수
 * 있다"는 경고의 근거로만 쓴다.
 *
 * vscode 의존 래퍼(EventEmitter/Memento 연결)는 deployRecord.ts. 단위 테스트: src/test/deployRecord.test.ts.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface FileStamp {
    size: number;
    mtimeMs: number;
    /** 파일 내용 SHA-1(hex). 비교의 1차 기준. 빈 문자열이면 size/mtime으로 폴백 비교. */
    sha1: string;
}

export interface CompiledRecord {
    ip: string;
    projectName: string;
    projectDir: string;
    /** 컴파일 성공 판정 시각(ms) */
    compiledAt: number;
    /** key = projectDir 기준 상대 경로('/' 구분, 원래 대소문자). 비교는 대소문자 무시 */
    files: Record<string, FileStamp>;
}

export interface SnapshotDiff {
    /** 같은 경로인데 내용이 다름(sha1 기준, sha1 없으면 size/mtime) — 컴파일본 쪽 경로 표기 */
    stale: string[];
    /** 컴파일 시점엔 있었는데 지금 로컬에 없음 */
    missing: string[];
    /** 컴파일 시점엔 없었는데 지금 로컬에 있음 */
    added: string[];
}

/** Memento 저장 키. 값은 Record<deployRecordKey, CompiledRecord>. */
export const DEPLOY_RECORD_MEMENTO_KEY = 'gpl.deployRecords';

/** 스냅샷 대상 확장자(소문자 비교). 제어기가 컴파일하는 프로젝트 소스 + 프로젝트 파일. */
export const PROJECT_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.gpl', '.gpo', '.gpr']);

/** 탐색에서 제외할 디렉터리 이름(dot 항목은 별도로 항상 제외). */
const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules']);

export function isProjectSourceFile(fileName: string): boolean {
    return PROJECT_SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/**
 * projectDir 아래 .gpl/.gpo/.gpr 파일을 재귀 수집해 파일별 FileStamp를 만든다(동기 fs).
 * - dot 항목(.git/.history/.vscode 등)과 node_modules는 제외 — ftpClient.getAllFiles의 업로드 제외 규칙과 대칭.
 * - 심볼릭 링크는 순환 방지를 위해 건너뛴다.
 * - key는 '/' 구분 상대 경로(원래 대소문자), 정렬된 순서로 삽입해 결정적인 결과를 만든다.
 * - 개별 파일의 stat/read 실패(탐색 중 삭제 등)는 건너뛰고, 루트 자체를 읽을 수 없으면 예외를 던진다(호출측이 처리).
 */
export function snapshotProjectFiles(projectDir: string): Record<string, FileStamp> {
    const root = path.resolve(projectDir);
    const collected: Array<{ rel: string; stamp: FileStamp }> = [];

    const walk = (dir: string): void => {
        // 루트의 readdir 실패는 그대로 전파(폴더 없음 등은 호출측이 알아야 한다), 하위는 건너뛴다.
        const entries = dir === root
            ? fs.readdirSync(dir, { withFileTypes: true })
            : safeReaddir(dir);
        for (const entry of entries) {
            if (entry.name.startsWith('.')) { continue; }
            if (entry.isSymbolicLink()) { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (EXCLUDED_DIR_NAMES.has(entry.name.toLowerCase())) { continue; }
                walk(full);
                continue;
            }
            if (!entry.isFile() || !isProjectSourceFile(entry.name)) { continue; }
            const stamp = safeStamp(full);
            if (!stamp) { continue; }
            collected.push({ rel: toSnapshotKey(path.relative(root, full)), stamp });
        }
    };
    walk(root);

    collected.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    const files: Record<string, FileStamp> = {};
    for (const { rel, stamp } of collected) {
        files[rel] = stamp;
    }
    return files;
}

function safeReaddir(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function safeStamp(file: string): FileStamp | undefined {
    try {
        const st = fs.statSync(file);
        const content = fs.readFileSync(file);
        return {
            size: st.size,
            mtimeMs: st.mtimeMs,
            sha1: crypto.createHash('sha1').update(content).digest('hex'),
        };
    } catch {
        return undefined;
    }
}

/** 스냅샷 key 정규화: 구분자 '/' 통일(대소문자는 유지 — 표시용). */
export function toSnapshotKey(relPath: string): string {
    return relPath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** 비교용 key: '/' 통일 + 소문자(Windows·제어기 FTP 모두 대소문자 구분 없이 같은 파일로 취급). */
function foldKey(key: string): string {
    return toSnapshotKey(key).toLowerCase();
}

function stampsDiffer(a: FileStamp, b: FileStamp): boolean {
    if (a.sha1 && b.sha1) {
        return a.sha1 !== b.sha1;
    }
    // sha1이 한쪽에라도 없으면(구버전 레코드 등) size/mtime으로 폴백
    return a.size !== b.size || a.mtimeMs !== b.mtimeMs;
}

/**
 * 컴파일 시점 스냅샷과 현재 스냅샷을 비교한다. 경로 비교는 대소문자·구분자 무시.
 * 결과 배열은 정렬되어 있으며, stale/missing은 컴파일본 쪽 경로 표기, added는 현재 쪽 경로 표기를 쓴다.
 */
export function diffSnapshots(
    compiled: Record<string, FileStamp>,
    current: Record<string, FileStamp>,
): SnapshotDiff {
    const currentByFold = new Map<string, { key: string; stamp: FileStamp }>();
    for (const [key, stamp] of Object.entries(current ?? {})) {
        const fold = foldKey(key);
        if (!currentByFold.has(fold)) {
            currentByFold.set(fold, { key, stamp });
        }
    }

    const stale: string[] = [];
    const missing: string[] = [];
    const seenFold = new Set<string>();
    for (const [key, stamp] of Object.entries(compiled ?? {})) {
        const fold = foldKey(key);
        if (seenFold.has(fold)) { continue; }
        seenFold.add(fold);
        const cur = currentByFold.get(fold);
        if (!cur) {
            missing.push(key);
        } else if (stampsDiffer(stamp, cur.stamp)) {
            stale.push(key);
        }
    }

    const added: string[] = [];
    for (const [fold, cur] of currentByFold) {
        if (!seenFold.has(fold)) {
            added.push(cur.key);
        }
    }

    const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    stale.sort(byText);
    missing.sort(byText);
    added.sort(byText);
    return { stale, missing, added };
}

/** 레코드의 스냅샷을 현재 로컬 디스크(projectDir 생략 시 rec.projectDir)와 비교한다. */
export function compareWithLocal(rec: CompiledRecord, projectDir?: string): SnapshotDiff {
    const dir = projectDir ?? rec.projectDir;
    return diffSnapshots(rec.files, snapshotProjectFiles(dir));
}

/** 'MM-DD HH:mm:ss' (로컬 시각). 트리/툴팁/로그에 컴파일 시각을 짧게 표기할 때 쓴다. */
export function formatCompiledAt(ms: number): string {
    const d = new Date(ms);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** 저장소 키: ip + projectName (둘 다 trim·소문자 — 제어기는 프로젝트명 대소문자를 구분하지 않는다). */
export function deployRecordKey(ip: string, projectName: string): string {
    return `${(ip ?? '').trim().toLowerCase()}|${(projectName ?? '').trim().toLowerCase()}`;
}

/** vscode.Memento의 최소 계약(테스트에서 가짜 객체로 대체 가능). */
export interface DeployRecordMemento {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: any): PromiseLike<void> | void;
}

function isFileStamp(v: any): v is FileStamp {
    return !!v && typeof v === 'object'
        && typeof v.size === 'number'
        && typeof v.mtimeMs === 'number'
        && typeof v.sha1 === 'string';
}

/** 저장분 로드 시 형태 검증 — 손상된/구버전 항목이 런타임 예외를 내지 않도록 걸러낸다. */
export function isCompiledRecord(v: any): v is CompiledRecord {
    if (!v || typeof v !== 'object') { return false; }
    if (typeof v.ip !== 'string' || typeof v.projectName !== 'string' || typeof v.projectDir !== 'string') { return false; }
    if (typeof v.compiledAt !== 'number' || !Number.isFinite(v.compiledAt)) { return false; }
    if (!v.files || typeof v.files !== 'object' || Array.isArray(v.files)) { return false; }
    return Object.values(v.files).every(isFileStamp);
}

/**
 * 컴파일 레코드 저장소: 메모리 맵 + (attach 된) Memento 영속화.
 * - attach 시 기존 저장분을 로드해 메모리와 합친다(메모리에 더 새로운 레코드가 있으면 그것을 유지).
 * - record 시 메모리에 넣고 Memento에 전체를 다시 쓴다. 저장 실패는 조용히 무시한다(절대 throw 하지 않음).
 */
export class DeployRecordStore {
    private readonly _records = new Map<string, CompiledRecord>();
    private _memento: DeployRecordMemento | undefined;

    constructor(private readonly _onPersistError?: (err: unknown) => void) { }

    attach(memento: DeployRecordMemento): void {
        this._memento = memento;
        let stored: unknown;
        try {
            stored = memento.get<unknown>(DEPLOY_RECORD_MEMENTO_KEY, {});
        } catch (err) {
            this._onPersistError?.(err);
            return;
        }
        if (!stored || typeof stored !== 'object') { return; }
        for (const value of Object.values(stored as Record<string, unknown>)) {
            if (!isCompiledRecord(value)) { continue; }
            const key = deployRecordKey(value.ip, value.projectName);
            const existing = this._records.get(key);
            if (!existing || existing.compiledAt <= value.compiledAt) {
                this._records.set(key, value);
            }
        }
    }

    record(rec: CompiledRecord): void {
        this._records.set(deployRecordKey(rec.ip, rec.projectName), rec);
        this.persist();
    }

    get(ip: string, projectName: string): CompiledRecord | undefined {
        return this._records.get(deployRecordKey(ip, projectName));
    }

    /** 현재 메모리에 있는 레코드 전체(테스트/진단용). */
    all(): CompiledRecord[] {
        return [...this._records.values()];
    }

    private persist(): void {
        const memento = this._memento;
        if (!memento) { return; }
        const data: Record<string, CompiledRecord> = {};
        for (const [key, rec] of this._records) {
            data[key] = rec;
        }
        try {
            const result = memento.update(DEPLOY_RECORD_MEMENTO_KEY, data);
            if (result && typeof (result as PromiseLike<void>).then === 'function') {
                (result as PromiseLike<void>).then(undefined, err => this._onPersistError?.(err));
            }
        } catch (err) {
            this._onPersistError?.(err);
        }
    }
}
