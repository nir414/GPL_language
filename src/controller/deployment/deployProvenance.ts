/**
 * 배포 증적(provenance) — "지금 제어기에 올라가 있는 것이 **내 로컬 소스와 같은가**"를 한 번에 답한다.
 * vscode 무의존 — 단위 테스트: `src/test/deployProvenance.test.ts`.
 *
 * 왜(2026-09-10 사용자 개선안 §12·§13): 배포 성공은 그동안 "Compile 명령이 STATUS 0을 냈다"였다. 그런데
 * 정작 알고 싶은 것은 **방금 고친 파일이 실제로 올라갔는가**이다. 업로드는 변경분만 올리고(스킵 판정),
 * 원격 사본이 여럿일 수 있으며(/GPL vs /flash), 다른 창·GDE·수동 FTP 가 끼어들 수도 있다.
 * 지문 두 벌이 이미 있는데(로컬 스냅샷 `deployRecordCore.snapshotProjectFiles`, 업로드분
 * `syncManifest`) 서로 **대조되지 않아** 결과에 드러나지 않았을 뿐이다. 이 모듈이 그 대조를 한다.
 *
 * 무엇을 증명하고 무엇을 증명하지 못하는가(명확히 해 둘 것):
 *  - 증명: "우리가 마지막으로 올린 내용"의 지문이 지금 로컬 파일의 지문과 같다.
 *  - 미증명: 그 사이 **우리 밖에서** 원격이 바뀌지 않았다는 것. 제어기 FTP 에 내용 해시를 물을 방법이
 *    없어 내려받지 않고는 확인할 수 없다(`syncManifest.ts` 머리말의 한계와 같다). 그래서 결과에
 *    `verifiedBy: 'upload-manifest'` 를 함께 실어 **무엇을 근거로 한 판정인지**를 드러낸다.
 */

import * as crypto from 'crypto';

/** 파일 하나의 지문 — 로컬 스냅샷(FileStamp)과 업로드 기록(SyncStamp)의 공통분모. */
export interface ProvenanceStamp {
    size: number;
    /** 내용 SHA-1(hex). 빈 문자열이면 해시 불가(크기로만 비교). */
    sha1: string;
}

export interface ProvenanceInput {
    /** 로컬 프로젝트 파일 지문. key = projectDir 기준 상대 경로. */
    local: Record<string, ProvenanceStamp>;
    /** 이 원격 경로에 **우리가 마지막으로 올린** 내용의 지문. key 는 대소문자 무시 비교. */
    uploaded: Record<string, ProvenanceStamp>;
}

export interface ProvenanceReport {
    /** 로컬 소스 전체의 지문 한 줄 — 같은 값이면 같은 소스다(§12 localRevision). */
    localRevision: string;
    /** 올린 내용 전체의 지문 — localRevision 과 같으면 "올린 것 == 지금 로컬"이다(§12 uploadedRevision). */
    uploadedRevision: string;
    /** 두 지문이 일치하는가. false 면 아래 목록이 어디가 어긋났는지 말해 준다. */
    inSync: boolean;
    /** 로컬에 있는데 올린 기록이 없는 파일(한 번도 안 올렸거나 기록이 지워짐). */
    notUploaded: string[];
    /** 올린 내용과 지금 로컬 내용이 다른 파일(고쳐 놓고 안 올린 것 — 가장 위험한 경우). */
    changedSinceUpload: string[];
    /** 올린 기록에는 있는데 로컬에 없는 파일(지웠거나 다른 프로젝트의 잔재). */
    staleRemote: string[];
    /** 대조에 쓴 파일 수. */
    fileCount: number;
    /** 이 판정의 근거 — 원격 내용을 직접 해시한 것이 아님을 드러낸다. */
    verifiedBy: 'upload-manifest';
}

/** 비교 키 — 경로 구분자와 대소문자를 흡수한다(`syncManifest.manifestFileKey` 와 같은 규칙). */
export function provenanceKey(relativePath: string): string {
    return (relativePath ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * 지문 묶음 하나를 한 줄로 요약한다. 키 순서·해시를 정렬해 넣으므로 **같은 내용이면 항상 같은 값**이고,
 * 파일 하나만 달라도 값이 달라진다. 해시가 없는 파일(읽기 실패·크기 초과)은 크기로 대신한다.
 */
export function revisionOf(files: Record<string, ProvenanceStamp>): string {
    const lines = Object.entries(files)
        .map(([rel, st]) => `${provenanceKey(rel)}:${st?.sha1 || `size=${st?.size ?? -1}`}`)
        .sort();
    return crypto.createHash('sha1').update(lines.join('\n')).digest('hex');
}

/** 두 지문이 같은 내용인가. 해시가 있으면 해시로, 없으면 크기로 비교한다. */
function sameContent(a: ProvenanceStamp | undefined, b: ProvenanceStamp | undefined): boolean {
    if (!a || !b) { return false; }
    if (a.sha1 && b.sha1) { return a.sha1 === b.sha1; }
    return a.size === b.size;
}

/**
 * 로컬 소스와 "우리가 올린 것"을 대조한다. 목록은 정렬해 돌려주므로 결과가 호출마다 흔들리지 않는다.
 * 업로드 기록이 아예 없으면(첫 배포·확장 재설치) 모든 파일이 `notUploaded` 로 나오고 inSync 는 false 다 —
 * 판정 불가는 "동기화됨" 쪽으로 넘어지지 않아야 한다(낡은 소스 오컴파일을 만들지 않는 쪽으로).
 */
export function compareProvenance(input: ProvenanceInput): ProvenanceReport {
    const local = input.local ?? {};
    const uploaded = input.uploaded ?? {};
    const uploadedByKey = new Map<string, ProvenanceStamp>();
    for (const [rel, st] of Object.entries(uploaded)) { uploadedByKey.set(provenanceKey(rel), st); }
    const localKeys = new Set<string>();

    const notUploaded: string[] = [];
    const changedSinceUpload: string[] = [];
    for (const [rel, st] of Object.entries(local)) {
        const key = provenanceKey(rel);
        localKeys.add(key);
        const up = uploadedByKey.get(key);
        if (!up) { notUploaded.push(rel); continue; }
        if (!sameContent(st, up)) { changedSinceUpload.push(rel); }
    }
    const staleRemote = Object.keys(uploaded).filter(rel => !localKeys.has(provenanceKey(rel)));

    // uploadedRevision 은 **로컬에 있는 파일에 대해 올린 내용**의 지문이다 — 로컬에 없는 원격 잔재까지
    // 넣으면 파일 하나 지운 것만으로 두 지문이 영영 어긋난다(그 사실은 staleRemote 가 따로 말한다).
    const uploadedForLocal: Record<string, ProvenanceStamp> = {};
    for (const rel of Object.keys(local)) {
        const up = uploadedByKey.get(provenanceKey(rel));
        if (up) { uploadedForLocal[rel] = up; }
    }

    const localRevision = revisionOf(local);
    const uploadedRevision = revisionOf(uploadedForLocal);
    return {
        localRevision,
        uploadedRevision,
        inSync: notUploaded.length === 0 && changedSinceUpload.length === 0 && localRevision === uploadedRevision,
        notUploaded: notUploaded.sort(),
        changedSinceUpload: changedSinceUpload.sort(),
        staleRemote: staleRemote.sort(),
        fileCount: Object.keys(local).length,
        verifiedBy: 'upload-manifest',
    };
}

/** 사람이 읽는 한 줄 — 배포 트레이스/로그용. */
export function describeProvenance(r: ProvenanceReport): string {
    if (r.inSync) { return `소스 ${r.fileCount}개 일치 (rev ${r.localRevision.slice(0, 12)})`; }
    const bits: string[] = [];
    if (r.changedSinceUpload.length) { bits.push(`올린 뒤 변경 ${r.changedSinceUpload.length}개`); }
    if (r.notUploaded.length) { bits.push(`미업로드 ${r.notUploaded.length}개`); }
    if (r.staleRemote.length) { bits.push(`원격 잔재 ${r.staleRemote.length}개`); }
    return `소스 ${r.fileCount}개 중 불일치 — ${bits.join(', ') || '지문 불일치'}`;
}
