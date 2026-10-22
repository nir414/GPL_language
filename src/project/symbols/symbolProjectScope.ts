import * as path from 'path';
import type { GPLSymbol } from '../../language/gplParser';
import type { SymbolResolutionContext } from '../../language/symbols/symbolIndex';
import { isPathUnder, normalizePathKey } from '../../util/pathKey';
import { CompileUnitIndex, narrowToCompileUnit } from '../compileUnit';
import { pickOwningGprPath } from '../projectSources';

// scoreFilePath 점수 체계 — 높을수록 우선 (정의 후보가 여럿일 때 경로 근접도로 선택)
const SCORE_SAME_FILE = 1000;
const SCORE_SAME_DIRECTORY = 800;
/** 같은 프로젝트(.gpr 폴더) 하위 — 하위 폴더로 나뉘어 있어도 같은 컴파일 단위다. */
const SCORE_SAME_PROJECT = 650;
/**
 * 같은 컴파일 단위의 **다른** 프로젝트 — `ProjectLibrary`로 참조하는/참조받는 프로젝트.
 * 폴더는 분리돼 있어도 함께 컴파일되므로, 워크스페이스 최상위 폴더가 같을 뿐인 남의 프로젝트보다 앞선다.
 */
const SCORE_RELATED_PROJECT = 600;
const SCORE_SAME_TOP_LEVEL_FOLDER = 500;
const SCORE_UNRELATED = 0;


/** 프로젝트 관계 캐시와 정의 후보의 경로 우선순위를 함께 관리한다. */
export class SymbolProjectScope implements SymbolResolutionContext {
    private gprPaths: string[] = [];
    private readonly compileUnits = new CompileUnitIndex();

    constructor(private readonly workspaceFolderFor: (filePath: string) => string | undefined) {}

    public setGprPaths(paths: readonly string[]): void {
        this.gprPaths = [...paths];
        this.compileUnits.setGprPaths(paths);
    }

    /**
     * 후보를 기준 파일의 컴파일 단위(프로젝트 + ProjectLibrary 관계) 안으로 좁힌다.
     * 단위 안 후보가 없거나 단위를 판정할 수 없으면 원본 그대로 — 모를 때 지우지 않는다.
     */
    public narrowCandidates(candidates: GPLSymbol[], preferredFilePath?: string): GPLSymbol[] {
        const narrowed = narrowToCompileUnit(candidates, preferredFilePath, s => s.filePath, this.compileUnits);
        return narrowed === candidates ? candidates : [...narrowed];
    }

    /**
     * 두 파일이 같은 컴파일 단위인가 — 참조 검색·이름 바꾸기가 결과를 프로젝트 밖으로 흘리지 않게
     * 하는 데 쓴다. 단위를 판정할 수 없으면 true(모를 때 배제하지 않는다).
     */
    public isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean {
        return this.compileUnits.isSameUnit(candidateFilePath, referenceFilePath);
    }

    /** `.gpr` 내용이 바뀌었을 때 컴파일 단위 해석 캐시를 버린다(파일 감시자에서 호출). */
    public invalidateProjectRelations(): void {
        this.compileUnits.invalidate();
    }

    public scoreFilePath(candidateFilePath: string, preferredFilePath: string): number {
        // Higher is better. 경로 비교는 캐시 키와 같은 규칙(normalizePathKey)을 쓴다 —
        // 대소문자뿐 아니라 `.`/`..`·구분자 차이도 같은 파일로 본다.
        const candidateKey = normalizePathKey(candidateFilePath);
        const preferredKey = normalizePathKey(preferredFilePath);
        if (candidateKey === preferredKey) {
            return SCORE_SAME_FILE;
        }

        if (path.dirname(candidateKey) === path.dirname(preferredKey)) {
            return SCORE_SAME_DIRECTORY;
        }

        // 같은 프로젝트(.gpr 폴더) 하위를 워크스페이스 최상위 폴더보다 우선한다 —
        // 프로젝트가 하위 폴더로 나뉘어 있으면(`T1\T2\T2.gpl`) 디렉터리는 달라도 같은 컴파일 단위이고,
        // 반대로 최상위 폴더가 같다는 것만으로는 다른 프로젝트의 동명 파일과 구분되지 않는다.
        const owningGpr = pickOwningGprPath(preferredFilePath, this.gprPaths);
        if (owningGpr && isPathUnder(candidateFilePath, path.dirname(owningGpr))) {
            return SCORE_SAME_PROJECT;
        }

        // 라이브러리 관계로 함께 컴파일되는 프로젝트(형제/중첩 폴더)는 남의 프로젝트보다 앞선다.
        // 이게 없으면 라이브러리의 정의가 SCORE_UNRELATED로 떨어져, 최상위 폴더만 같은
        // 무관한 프로젝트의 동명 심볼(SCORE_SAME_TOP_LEVEL_FOLDER)에게 진다.
        // (`isSameUnit`은 "모르면 true"라 점수 매기기에는 못 쓴다 — 여기선 단위가 확정된 경우에만 준다.)
        const unitDirs = this.compileUnits.unitDirsFor(preferredFilePath);
        if (unitDirs.length > 0 && this.compileUnits.isInUnitDirs(candidateFilePath, unitDirs)) {
            return SCORE_RELATED_PROJECT;
        }

        // Prefer same top-level folder relative to workspace folder
        const workspaceFolder = this.workspaceFolderFor(preferredFilePath);
        if (workspaceFolder) {
            const relPreferred = path.relative(workspaceFolder, preferredFilePath);
            const relCandidate = path.relative(workspaceFolder, candidateFilePath);
            const topPreferred = relPreferred.split(path.sep)[0];
            const topCandidate = relCandidate.split(path.sep)[0];
            if (topPreferred && topPreferred.toLowerCase() === topCandidate.toLowerCase()) {
                return SCORE_SAME_TOP_LEVEL_FOLDER;
            }
        }

        return SCORE_UNRELATED;
    }
}
