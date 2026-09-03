/**
 * 정의 후보 목록을 "사용자에게 보여줄 위치 목록"으로 다듬는 순수 로직.
 *
 * 정의 이동(F12)은 동점 후보가 여럿이면 하나로 조용히 점프하지 않고 전부 peek 목록으로
 * 돌려준다(`definitionProvider.buildDefinitionResult`). 그 설계 자체는 유지하되, **같은 선언을
 * 가리키는 항목**과 **열 수 없는 파일**은 목록에 오르면 안 된다 —
 *
 *   - 같은 파일이 표기만 다르게 인덱싱되면(대소문자·`.`/`..`) 같은 줄이 여러 번 뜬다.
 *     2026-09-02에 실제로 `LGF.SetPath` 정의가 같은 선언(80줄)으로 3개 떴다.
 *   - 인덱싱 이후 사라진 파일(SVN 전환·탐색기 이동 등 워처가 놓친 변경)의 항목은
 *     VS Code가 미리보기를 못 그려 `LogFile.gpl:81:2` 같은 대체 라벨로만 보인다.
 *
 * 근본 원인(캐시 키 정규화)은 `symbolCache`에서 막고, 여기는 그래도 새는 경우를 위한 안전망이다.
 * 목록 정리 로직은 파일 존재 확인을 주입받아(`exists`) vscode 없이 단위 테스트한다. 실제 확인 규칙
 * (`isMissingFile`)도 여기 함께 두어, 정의 목록과 캐시 정리가 **같은 기준**을 쓰게 한다.
 */

import * as fs from 'fs';
import { normalizePathKey } from '../controller/projectPickerCore';

/**
 * "이 경로에 파일이 확실히 없다" — 정의 목록 필터·캐시 잔류 정리가 공유하는 판정.
 *
 * **`ENOENT`만 '없음'으로 본다.** 권한 오류·네트워크 드라이브 일시 장애(EPERM·EBUSY·ETIMEDOUT…)까지
 * 없음으로 처리하면, 확인에 실패했을 뿐인 파일의 심볼을 지워 정의가 통째로 사라진다.
 * 판단이 서지 않으면 **남기는 쪽**이 안전하다.
 */
export function isMissingFile(filePath: string, stat: (p: string) => unknown = fs.statSync): boolean {
    try {
        stat(filePath);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
    }
}

/** `preferExistingFiles`에 넘기는 기본 probe — 확인 불가는 "있음"으로 본다(위 규칙과 짝). */
export function fileExists(filePath: string): boolean {
    return !isMissingFile(filePath);
}

/** 위치 비교에 필요한 최소 형태 — `GPLSymbol`이 그대로 만족한다. */
export interface SymbolLocationLike {
    filePath: string;
    line: number;
}

/**
 * 같은 위치(정규화 경로 + 줄)를 가리키는 후보를 하나로 합친다. 순서는 유지하고 **첫 항목**을 남긴다
 * (랭킹 결과가 들어오므로 앞쪽이 더 나은 후보다).
 */
export function dedupeSymbolLocations<T extends SymbolLocationLike>(symbols: readonly T[]): T[] {
    if (symbols.length <= 1) {
        return [...symbols];
    }
    const seen = new Set<string>();
    const out: T[] = [];
    for (const s of symbols) {
        const key = `${normalizePathKey(s.filePath)}:${s.line}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push(s);
    }
    return out;
}

/**
 * 후보가 둘 이상일 때, 열 수 있는 파일의 후보만 남긴다.
 *
 * 하나도 존재하지 않으면 **원본 그대로** 돌려준다 — 확인에 실패했을 뿐일 수 있어서
 * (권한·네트워크 드라이브), 그때 목록을 비우면 "정의 없음"이라는 더 나쁜 퇴보가 된다.
 * 후보가 하나뿐이면 확인하지 않는다(불필요한 동기 I/O 회피).
 */
export function preferExistingFiles<T extends SymbolLocationLike>(
    symbols: readonly T[],
    exists: (filePath: string) => boolean,
): T[] {
    if (symbols.length <= 1) {
        return [...symbols];
    }
    const alive = new Map<string, boolean>();
    const isAlive = (filePath: string): boolean => {
        const key = normalizePathKey(filePath);
        let hit = alive.get(key);
        if (hit === undefined) {
            hit = exists(filePath);
            alive.set(key, hit);
        }
        return hit;
    };

    const kept = symbols.filter(s => isAlive(s.filePath));
    return kept.length > 0 ? kept : [...symbols];
}
