/**
 * "이 두 파일은 같은 컴파일 단위인가" — 정의 이동·참조 검색·이름 바꾸기의 **프로젝트 경계** 판정.
 *
 * 배경(2026-09-02): 워크스페이스를 프로젝트 폴더가 아니라 **상위 폴더에서 여는 구조**가 흔하다.
 *
 *   C:\SVN\pa\trunk\develop\07. Others\37. …과제\시뮬레이션\projects\GPL_Code\Project.gpr
 *   C:\SVN\pa\trunk\develop\07. Others\38. …과제\시뮬레이션\projects\GPL_Code\Project.gpr
 *
 * 이때 심볼 인덱스는 워크스페이스의 **모든** `.gpr` 프로젝트를 한 테이블에 담는데, 정의 후보 선택은
 * `scoreFilePath`의 "점수"만 봤다. 점수는 순위일 뿐 경계가 아니어서, 같은 이름(`Main`·`Init`·`MoveTo` …)이
 * 다른 과제 프로젝트에 있으면 **무관한 프로젝트의 정의로 점프**했다. 참조 검색·이름 바꾸기는 그 정의 파일을
 * 기준으로 범위를 잡으므로 오염이 그대로 전파된다.
 *
 * 판정 기준은 GPL의 컴파일 단위 그대로다 — `.gpr` 하나 + 그것이 `ProjectLibrary`로 참조하는 프로젝트(재귀)
 * + 그것을 라이브러리로 참조하는 프로젝트. 규칙 자체는 `projectSources.collectRelatedGprPaths`가 정본이고,
 * 이 모듈은 거기에 **캐시**를 씌워 후보마다 `.gpr`를 다시 읽지 않게 하는 것이 역할이다
 * (정의 후보 선택은 키 입력마다 수십 번 불린다).
 *
 * 판정 불가(워크스페이스에 `.gpr`가 없거나 파일이 어느 프로젝트에도 안 속함)는 **빈 배열**로 돌려주고,
 * 호출측은 그때 좁히지 않는다 — 경계를 모를 때 후보를 지우면 정의를 통째로 놓친다(누락 방지 우선).
 */

import * as fs from 'fs';
import * as path from 'path';
import { isPathUnder, normalizeDirKey } from '../controller/projectPickerCore';
import { collectRelatedGprPaths, findNearestGprOnDisk, pickOwningGprPath } from './projectSources';

/** 파일→소유 `.gpr` 조회 결과가 "없음"임을 캐시에 남기기 위한 표식. */
const NO_OWNER = '';

export class CompileUnitIndex {
    /** 워크스페이스에서 수집한 `.gpr` 경로(심볼 인덱싱과 같은 목록). */
    private gprPaths: string[] = [];
    /** `.gpr` 경로(소문자) → 같은 컴파일 단위인 프로젝트 폴더들(원본 경로). */
    private unitByGpr = new Map<string, string[]>();
    /** 파일 경로(소문자) → 소유 `.gpr` 경로(없으면 `NO_OWNER`). */
    private ownerByFile = new Map<string, string>();
    /** `.gpr` 본문 메모 — 참조자 탐색이 모든 `.gpr`를 읽으므로 단위마다 다시 읽지 않게 한다. */
    private textByGpr = new Map<string, string>();

    /**
     * 워크스페이스 `.gpr` 목록을 갱신한다. 목록이 실제로 바뀌었을 때만 캐시를 버린다
     * (심볼 재인덱싱마다 캐시를 날리면 캐시가 있으나 마나다).
     */
    public setGprPaths(paths: readonly string[]): void {
        const next = [...paths];
        const changed = next.length !== this.gprPaths.length
            || next.some((p, i) => normalizeDirKey(p) !== normalizeDirKey(this.gprPaths[i]));
        this.gprPaths = next;
        if (changed) { this.invalidate(); }
    }

    /** `.gpr` 내용이 바뀌었을 수 있을 때(파일 감시자 등) 호출 — 목록은 유지하고 해석 결과만 버린다. */
    public invalidate(): void {
        this.unitByGpr.clear();
        this.ownerByFile.clear();
        this.textByGpr.clear();
    }

    /** 이 파일을 소유한 `.gpr` 경로 — 워크스페이스 목록 우선, 없으면 디스크에서 위로 탐색. */
    public owningGpr(filePath: string): string | undefined {
        const key = path.resolve(filePath).toLowerCase();
        const cached = this.ownerByFile.get(key);
        if (cached !== undefined) { return cached === NO_OWNER ? undefined : cached; }

        const found = pickOwningGprPath(filePath, this.gprPaths) ?? findNearestGprOnDisk(filePath);
        this.ownerByFile.set(key, found ?? NO_OWNER);
        return found;
    }

    /**
     * 이 파일과 **함께 컴파일되는** 프로젝트 폴더들. 판정 불가면 빈 배열.
     * 첫 원소는 항상 소유 프로젝트 폴더다.
     */
    public unitDirsFor(filePath: string): string[] {
        const gprPath = this.owningGpr(filePath);
        if (!gprPath) { return []; }

        const key = path.resolve(gprPath).toLowerCase();
        const cached = this.unitByGpr.get(key);
        if (cached) { return cached; }

        const text = this.readGpr(gprPath);
        const dirs = collectRelatedGprPaths(gprPath, text, {
            knownGprPaths: this.gprPaths,
            readText: p => this.readGpr(p),
        }).map(g => path.dirname(path.resolve(g)));

        this.unitByGpr.set(key, dirs);
        return dirs;
    }

    /** 후보 파일이 주어진 단위 폴더들 안에 있는가. 단위가 비어 있으면(판정 불가) true — 좁히지 않는다. */
    public isInUnitDirs(candidateFilePath: string, unitDirs: readonly string[]): boolean {
        if (unitDirs.length === 0) { return true; }
        return unitDirs.some(dir => isPathUnder(candidateFilePath, dir));
    }

    /**
     * 두 파일이 같은 컴파일 단위인가. 기준 파일의 단위를 판정할 수 없으면 true
     * (모를 때는 배제하지 않는다).
     */
    public isSameUnit(candidateFilePath: string, referenceFilePath: string): boolean {
        return this.isInUnitDirs(candidateFilePath, this.unitDirsFor(referenceFilePath));
    }

    private readGpr(gprPath: string): string {
        const key = path.resolve(gprPath).toLowerCase();
        const cached = this.textByGpr.get(key);
        if (cached !== undefined) { return cached; }
        let text: string;
        try {
            text = fs.readFileSync(gprPath, 'utf8');
        } catch {
            text = '';
        }
        this.textByGpr.set(key, text);
        return text;
    }
}

/**
 * 후보 목록을 기준 파일의 컴파일 단위 안으로 좁힌다.
 *
 * 단위 안 후보가 **하나라도 있으면** 밖의 후보를 모두 버린다 — GPL은 단일 이름 공간이라
 * 같은 컴파일 단위에서 이름이 풀리면 그것이 정의이고, 다른 프로젝트의 동명 심볼은 정의가 될 수 없다.
 * 단위 안 후보가 하나도 없으면 원본을 그대로 돌려준다(워크스페이스 밖 파일·미등록 파일에서
 * 정의 이동이 아예 안 되는 퇴보를 막는다).
 */
export function narrowToCompileUnit<T>(
    candidates: readonly T[],
    referenceFilePath: string | undefined,
    filePathOf: (candidate: T) => string,
    index: CompileUnitIndex,
): readonly T[] {
    if (!referenceFilePath || candidates.length <= 1) { return candidates; }
    const unitDirs = index.unitDirsFor(referenceFilePath);
    if (unitDirs.length === 0) { return candidates; }
    const inUnit = candidates.filter(c => index.isInUnitDirs(filePathOf(c), unitDirs));
    return inUnit.length > 0 ? inUnit : candidates;
}
