/**
 * 컴파일 스냅샷 기록(deploy record) — vscode 연결 래퍼.
 *
 * deployService가 Compile 성공을 확정한 시점에 recordCompiled()로 로컬 소스 스냅샷을 남기고,
 * 디버그 세션(Attach only)이 getCompiledRecord()/compareWithLocal()로 "제어기 실행 코드보다 로컬 소스가
 * 새로운가"를 판정한다(GitHub #21). 순수 로직은 deployRecordCore.ts에 있고 여기서는
 * Memento 영속화 연결과 onDidRecordCompiled 이벤트만 담당한다.
 *
 * 사용: extension.ts activate에서 `attachDeployRecordStore(context.workspaceState)`를 한 번 호출한다.
 * attach 전에 recordCompiled가 호출되어도 메모리에는 남으며, attach 시 저장분과 병합된다.
 */

import * as vscode from 'vscode';
import { CompiledRecord, DeployRecordStore } from './deployRecordCore';

export type { FileStamp, CompiledRecord, SnapshotDiff } from './deployRecordCore';
export {
    snapshotProjectFiles,
    diffSnapshots,
    compareWithLocal,
    formatCompiledAt,
    deployRecordKey,
    DEPLOY_RECORD_MEMENTO_KEY,
} from './deployRecordCore';

const _store = new DeployRecordStore(err => {
    // 저장 실패는 기록의 유실일 뿐 배포/디버그 동작에 영향이 없으므로 조용히 콘솔에만 남긴다(never throw).
    console.warn(`[gpl deployRecord] Memento 저장 실패(무시): ${(err as any)?.message ?? err}`);
});
const _onDidRecordCompiled = new vscode.EventEmitter<CompiledRecord>();

/** 컴파일 스냅샷이 새로 기록될 때 발생. 디버그 세션이 "컴파일본 갱신됨"을 반영할 때 구독한다. */
export const onDidRecordCompiled: vscode.Event<CompiledRecord> = _onDidRecordCompiled.event;

/**
 * 영속 저장소 연결(기존 저장분 로드). extension.ts activate에서 `context.workspaceState`로 호출.
 * Memento 키: 'gpl.deployRecords' (값: Record<key, CompiledRecord>).
 */
export function attachDeployRecordStore(
    memento: { get<T>(key: string, def: T): T; update(key: string, v: any): Thenable<void> },
): void {
    _store.attach(memento);
}

/** 컴파일 성공 확정 시 호출. 메모리 + (attach 된) Memento 저장 후 onDidRecordCompiled 발화. */
export function recordCompiled(rec: CompiledRecord): void {
    _store.record(rec);
    _onDidRecordCompiled.fire(rec);
}

/** 키: ip + projectName(대소문자 무시). 없으면 undefined. */
export function getCompiledRecord(ip: string, projectName: string): CompiledRecord | undefined {
    return _store.get(ip, projectName);
}
