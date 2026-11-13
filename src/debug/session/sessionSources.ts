/**
 * 디버그 세션의 소스 지도 — 컴파일 단위 폴더 확정·basename ↔ 로컬 경로 해석·원격 소스 세션·프로시저 범위.
 *
 * 제어기는 파일을 basename 으로 보고하므로(`Show Stack`·BP 명령) 어느 로컬 파일인지는 여기서 정한다:
 * `.gpr` 로 확정한 프로젝트 폴더(`projectDirs`, ProjectLibrary 포함)와 `ProjectSource` 절대 경로가 기준이고,
 * 동명 소스 경합은 `pickSourceCandidate` 로 가린다. 원격 소스 세션(FTP 사본 디버깅)이면 그 세션의 identity 안에서만 푼다.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 * vscode 에는 의존하지 않는다 — 워크스페이스 폴더·활성 파일은 `SessionSourcesHost` 가 준다.
 */

import { Source } from '@vscode/debugadapter';
import * as path from 'path';
import * as fs from 'fs';
import { findProjectDirs } from '../../controller/deployment/deployService';
import { gprPathInDir, resolveGprSourcePaths, resolveProjectLibraryDirs, walkTree } from '../../project/sources/projectSources';
import { chooseCompileUnitGprs, GprIdentity, readGprIdentity, readGprIdentityInDir } from '../../project/sources/compileUnitTarget';
import type { RemoteDebugProject, RemoteSourceFile, RemoteSourceSession } from '../../controller/files/remoteSourceSession';
import { parseThreadList, SHOW_THREAD_LIST_CMD, parseGpr, selectProjectFromCandidates, pickSourceCandidate } from '../../controller/protocol/responseParser';
import { GPLParser, GPLSymbolKind } from '../../language/syntax/gplParser';
import { buildProcedureRanges, resolveBreakpointLine, ProcedureRange } from '../execution/sourceTargets';
import type { DebugSessionIo } from './sessionIo';
import type { IAttachRequestArguments } from './attachPreflight';

export interface SessionSourcesHost extends DebugSessionIo {
    /** 워크스페이스 폴더 경로들(없으면 빈 배열). */
    workspaceFolderPaths(): string[];
    /** 활성 편집기의 file 경로('' = 없음/파일 아님). 프로젝트 자동 감지의 신호. */
    activeFilePath(): string;
    /** 소스 집합이 바뀜 — 'all' 은 소스맵 재구축(전역 조회 메모까지), 'symbols' 는 원격 소스가 새로 내려옴(심볼 색인만). */
    onSourceSetChanged(scope: 'all' | 'symbols'): void;
}

export class SessionSources {
    constructor(private readonly host: SessionSourcesHost) {}

    // Workspace source file cache: basename → 후보 전체 경로들(동명 파일 전부 보존).
    // 기존에는 경로 1개만 저장해 스캔 순서상 마지막 파일이 조용히 이겼고, 워크스페이스에
    // 프로젝트 사본/백업 폴더가 있으면 정지 시 엉뚱한 폴더의 파일이 열렸다.
    sourceFileMap = new Map<string, string[]>();

    /**
     * 소스맵을 컴파일 단위(`_projectDirs`)로 좁혔는데 못 찾은 파일이 나와 워크스페이스 전체로
     * 넓혔는가. 한 번 넓히면 세션(정확히는 다음 `_updateProjectDirs`)까지 유지한다 — 재구축마다
     * 좁혔다 넓혔다 하면 같은 스캔을 반복한다.
     */
    private sourceMapWidened = false;

    // 디버그 대상 프로젝트의 폴더(Project.gpr 위치들) — 동명 소스 경합 시 우선 선택 기준.
    projectDirs: string[] = [];

    /** 대상 프로젝트 .gpr 의 ProjectSource 절대 경로 — 동명 소스 경합 판정의 1순위 기준. */
    private projectSourcePaths: string[] = [];

    /** BP target 판정의 루트가 되는 메인 프로젝트 `.gpr`(라이브러리 `.gpr` 제외). */
    mainProjectGprs: string[] = [];

    /** ProjectLibrary 폴백 해석에 쓰는 워크스페이스 `.gpr` 목록. */
    knownGprPaths: string[] = [];

    /**
     * launch/attach 인자의 `projectDir` — 사람이 고른(QuickPick) 또는 자동화가 고정한 대상 **폴더**.
     * 있으면 `_updateProjectDirs` 가 이름 일치 `.gpr` 전부가 아니라 이 폴더의 `.gpr` 하나로 컴파일 단위를
     * 확정한다(과제별 동명 프로젝트가 여럿인 워크스페이스 — `project/sources/compileUnitTarget.ts`).
     */
    projectDirHint: string | undefined;

    remoteSourceSession: RemoteSourceSession | undefined;

    remoteProject: RemoteDebugProject | undefined;

    /**
     * `ProjectLibrary` 로 참조된 하위 프로젝트의 폴더(= `_projectDirs` 중 라이브러리 몫).
     * 이 폴더 아래 소스는 제어기가 BP 대상 파일로 찾지 못한다 — `_librarySourceBpHint` 참조.
     */
    libraryDirs: string[] = [];

    // 경합 경고 로그를 베이스네임당 1회로 제한(소스맵 재구축 시 리셋)
    private sourceResolveWarned = new Set<string>();

    /**
     * 확정된 _projectName과 이름이 일치하는 Project.gpr 폴더들을 수집한다.
     * 동명 소스 경합(_pickSourcePath)과 Globals 열거 범위 제한의 기준이 된다.
     *
     * 폴더와 함께 `ProjectSource` 목록도 절대 경로로 풀어 둔다 — 하위 폴더로 나뉜 프로젝트
     * (`ProjectSource="T1\T2\T2.gpl"`)에서 제어기가 주는 basename을 어느 파일로 볼지 판정할 때
     * "컴파일 집합에 들어 있는가"가 폴더 깊이보다 정확한 기준이다.
     *
     * `ProjectLibrary`로 참조된 라이브러리 프로젝트의 폴더·소스도 함께 넣는다 — 문서상 라이브러리
     * 파일은 메인 프로젝트에 논리적으로 포함되어 함께 컴파일되므로, 제어기가 보고하는 파일이
     * 라이브러리 폴더(중첩이든 형제든)에 있을 수 있다. 넣지 않으면 그 파일의 브레이크포인트가
     * basename 표기로만 나가고 스택의 소스 열기도 어긋난다.
     */
    updateProjectDirs(): void {
        this.projectDirs = [];
        this.projectSourcePaths = [];
        this.libraryDirs = [];
        this.mainProjectGprs = [];
        this.knownGprPaths = [];
        // 단위가 다시 확정되므로 "넓힌 상태"를 되돌린다 — 새 대상에서는 다시 좁혀서 시작한다.
        this.sourceMapWidened = false;
        if (this.remoteProject && this.remoteSourceSession) {
            this.mainProjectGprs = [this.remoteProject.gprPath];
            this.projectSourcePaths = [...this.remoteProject.sourcePaths];
            const gprs: string[] = [];
            walkTree(this.remoteSourceSession.cacheRoot, (full, name) => {
                if (/\.gpr$/i.test(name)) { gprs.push(full); }
            });
            this.knownGprPaths = gprs;
            const text = fs.readFileSync(this.remoteProject.gprPath, 'utf8');
            this.libraryDirs = resolveProjectLibraryDirs(this.remoteProject.gprPath, text, { knownGprPaths: gprs }).dirs;
            this.projectDirs = [...new Set([this.remoteProject.projectDir, ...this.libraryDirs])];
            return;
        }
        // launch 의 projectDir(사람이 고른/자동화가 고정한 대상 폴더)이 있으면 그 .gpr 하나로 확정한다 —
        // 과제별 동명 프로젝트가 여럿인 워크스페이스에서 이름 일치만으로는 사본이 섞여, 배포본이 아닌
        // 사본의 같은 줄 번호(전혀 다른 코드)를 예외 위치로 열었다(2026-09-18). 규칙 정본: project/sources/compileUnitTarget.ts.
        const target = readGprIdentityInDir(this.projectDirHint);
        if (!this.host.projectName && !target) { return; }
        // 워크스페이스의 .gpr 는 라이브러리 폴더 폴백 검색(knownGprPaths)에도 쓰므로 항상 모은다.
        const allGprPaths: string[] = [];
        for (const folderPath of this.host.workspaceFolderPaths()) {
            allGprPaths.push(...this.findFiles(folderPath, 'Project.gpr'));
        }
        this.knownGprPaths = allGprPaths;
        const choice = chooseCompileUnitGprs(
            this.host.projectName,
            target,
            () => allGprPaths.map(readGprIdentity).filter((g): g is GprIdentity => !!g),
        );
        if (choice.via === 'target-dir-mismatch' && target) {
            this.host.log(
                `⚠ projectDir(${path.dirname(target.gprPath)}) 의 프로젝트명 "${target.projectName}" 이 디버그 대상 `
                + `"${this.host.projectName}" 과 다릅니다 — 이름이 일치하는 폴더로 소스를 해석합니다.`,
            );
        }

        // 라이브러리 폴더는 메인 프로젝트 폴더 **뒤에** 붙인다 — `_bpFileForms`가 첫 일치 폴더를 기준으로
        // 상대 경로 표기를 만들기 때문에, 메인 프로젝트 기준(`MyLibrary\Project.gpl`)이 먼저 나와야 한다.
        const libraryDirs: string[] = [];
        for (const gprPath of choice.gprPaths) {
            try {
                const text = fs.readFileSync(gprPath, 'utf-8');
                this.mainProjectGprs.push(gprPath);
                this.projectDirs.push(path.dirname(gprPath));
                this.projectSourcePaths.push(...resolveGprSourcePaths(gprPath, text));

                // 참조된 라이브러리 프로젝트는 문서상 메인 프로젝트에 논리적으로 포함되어 함께
                // 컴파일된다 → 제어기가 보고하는 소스도 이 폴더들에서 나올 수 있다.
                const libs = resolveProjectLibraryDirs(gprPath, text, { knownGprPaths: allGprPaths });
                for (const dir of libs.dirs) {
                    libraryDirs.push(dir);
                    const libGpr = gprPathInDir(dir);
                    if (!libGpr) { continue; }
                    try {
                        this.projectSourcePaths.push(...resolveGprSourcePaths(libGpr, fs.readFileSync(libGpr, 'utf-8')));
                    } catch { /* skip */ }
                }
                if (libs.unresolved.length > 0) {
                    this.host.log(`⚠ ProjectLibrary 폴더를 찾지 못했습니다: ${libs.unresolved.join(', ')}`
                        + ' — 그 라이브러리의 소스는 브레이크포인트/스택 매핑에서 빠집니다.');
                }
            } catch { /* skip */ }
        }
        for (const dir of libraryDirs) {
            if (!this.libraryDirs.some(d => d.toLowerCase() === dir.toLowerCase())) {
                this.libraryDirs.push(dir);
            }
            if (!this.projectDirs.some(d => d.toLowerCase() === dir.toLowerCase())) {
                this.projectDirs.push(dir);
            }
        }

        if (this.projectDirs.length > 0) {
            this.host.log(
                `프로젝트 폴더 확정(${choice.via === 'target-dir' ? 'projectDir' : '프로젝트명 일치'}): ${this.projectDirs.join(', ')}`
                + (libraryDirs.length > 0 ? ` (라이브러리 ${libraryDirs.length}개 포함)` : '')
                + ` (소스 ${this.projectSourcePaths.length}개)`,
            );
        }
    }

    /**
     * Build a map of basename(lowercase) → 동명 후보 전체 경로 배열, for all .gpl/.gpo files in workspace.
     */
    buildSourceFileMap(): void {
        this.sourceFileMap.clear();
        this.sourceResolveWarned.clear();
        // 소스 구성이 바뀌면 전역 열거/조회 메모도 무효 — 파일 추가·이동·프로젝트 변경 대응.
        this.host.onSourceSetChanged('all');
        if (this.remoteProject) {
            // 아직 다운로드하지 않은 선언 소스도 매핑한다. FTP 내용은 열기/BP 요청 때 읽는다.
            for (const file of this.projectSourcePaths) {
                const key = path.basename(file).toLowerCase();
                const candidates = this.sourceFileMap.get(key) ?? [];
                if (!candidates.includes(file)) { candidates.push(file); }
                this.sourceFileMap.set(key, candidates);
            }
            return;
        }
        const roots = this.sourceMapRoots();
        if (roots.dirs.length === 0) { return; }

        let truncated = false;
        for (const dir of roots.dirs) {
            truncated = this.scanDir(dir) || truncated;
        }
        this.host.log(`소스 파일 맵: ${this.sourceFileMap.size}개 파일 인덱싱 완료 (${roots.label})`);
        if (truncated) {
            this.host.log(
                '⚠ 소스 탐색이 깊이/개수 상한에 걸렸습니다 — 일부 폴더의 소스는 매핑되지 않습니다. '
                + '프로젝트 상위 폴더 대신 프로젝트(또는 projects) 폴더를 워크스페이스로 여세요.',
            );
        }
    }

    /**
     * 소스맵 스캔 루트 — **컴파일 단위 우선**.
     *
     * 워크스페이스를 프로젝트가 아니라 상위 폴더에서 여는 구조(`…\시뮬레이션`)에서는 무관한
     * 형제 프로젝트의 동명 파일이 소스맵에 함께 들어온다(실측 2026-09-02: `.gpl` 96개 중 basename
     * 충돌 53건 — `MergeCode`/`MergeCode_Beta`, `Main.gpl` 2곳). 제어기가 보고하는 파일은 정의상
     * 이 컴파일 단위 안에 있으므로, 스캔 범위를 `_projectDirs`(메인 + `ProjectLibrary` 재귀)로 좁히면
     * 경합 자체가 사라지고 상위 폴더 워크스페이스에서의 스캔 비용도 줄어든다.
     *
     * 단위를 판정할 수 없으면(프로젝트명과 일치하는 `.gpr` 없음) 워크스페이스 전체로 떨어진다 —
     * 모를 때 좁히면 소스 이동이 아예 안 되는 퇴보가 되므로 **누락 방지를 우선**한다.
     */
    private sourceMapRoots(): { dirs: string[]; label: string } {
        const workspace = this.host.workspaceFolderPaths();
        if (this.sourceMapWidened || this.projectDirs.length === 0) {
            return { dirs: workspace, label: '워크스페이스 전체' };
        }
        // 라이브러리 폴더가 메인 폴더 안에 있으면(이 구조가 그렇다) 중복 스캔이므로 최상위만 남긴다.
        const tops = this.projectDirs.filter(
            (d, i) => !this.projectDirs.some((other, j) => j !== i && this.isPathUnder(d, other)),
        );
        return { dirs: tops, label: `컴파일 단위 ${tops.length}폴더` };
    }

    /** 소스 맵 채우기. 깊이/개수 상한에 걸렸으면 true(호출측이 경고). */
    private scanDir(dir: string): boolean {
        const { truncated } = walkTree(dir, (full, name) => {
            if (!/\.gpl$/i.test(name) && !/\.gpo$/i.test(name)) { return; }
            const key = name.toLowerCase();
            const list = this.sourceFileMap.get(key);
            if (list) { list.push(full); } else { this.sourceFileMap.set(key, [full]); }
        });
        return truncated;
    }

    /**
     * Find files matching a name recursively under a directory.
     * 상한은 walkTree가 관리한다 — 상위 저장소 폴더를 워크스페이스로 열어도 UI가 멈추지 않게.
     */
    private findFiles(dir: string, targetName: string): string[] {
        const results: string[] = [];
        const wanted = targetName.toLowerCase();
        walkTree(dir, (full, name) => {
            if (name.toLowerCase() === wanted) { results.push(full); }
        });
        return results;
    }

    /**
     * Resolve a controller filename (basename) to a workspace file path.
     * Uses the pre-built source file map for fast lookup.
     */
    resolveSourcePath(filename: string): string {
        if (this.remoteSourceSession) {
            const source = this.remoteSourceForInput(filename);
            if (source) { return source.localPath; }
            if (!this.sourceResolveWarned.has(filename)) {
                this.sourceResolveWarned.add(filename);
                this.host.log(`원격 소스 해석 실패: "${filename}" — 선택한 프로젝트에서 유일한 소스를 찾지 못했습니다.`);
            }
            // 현재 작업공간의 동명 파일이나 상대 경로로 대체하지 않는다.
            return '';
        }
        // 제어기가 전체 경로(예: /flash/projects/MergeCode/PDBModule.gpl)를 줄 수도 있으므로
        // 항상 베이스네임으로 정규화한 뒤 워크스페이스 소스맵에서 조회한다.
        const base = filename.replace(/^.*[\\/]/, '');
        const lower = base.toLowerCase();

        const cached = this.sourceFileMap.get(lower);
        if (cached?.length) { return this.pickSourcePath(lower, cached); }

        // 미스: attach 이후 추가/이동된 파일일 수 있으므로 소스맵을 1회 재인덱싱 후 재시도.
        this.buildSourceFileMap();
        const rebuilt = this.sourceFileMap.get(lower);
        if (rebuilt?.length) { return this.pickSourcePath(lower, rebuilt); }

        // 컴파일 단위로 좁힌 상태였다면 워크스페이스 전체로 한 번 넓혀 본다 —
        // `.gpr`에 아직 등재되지 않은 파일이나 단위 판정이 어긋난 경우까지 놓치지 않게.
        if (!this.sourceMapWidened && this.projectDirs.length > 0) {
            this.sourceMapWidened = true;
            this.buildSourceFileMap();
            const wide = this.sourceFileMap.get(lower);
            if (wide?.length) {
                this.host.log(
                    `ⓘ "${base}" 는 컴파일 단위(${this.host.projectName}) 밖에서 찾았습니다 — `
                    + '소스맵을 워크스페이스 전체로 넓혔습니다. 엉뚱한 파일이 열리면 .gpr 등재 상태를 확인하세요.',
                );
                return this.pickSourcePath(lower, wide);
            }
        }

        // 그래도 못 찾으면 원본을 그대로 반환하되, 왜 이동이 안 되는지 진단 로그를 남긴다.
        this.host.log(
            `소스 경로 해석 실패: "${filename}" (basename: ${base}) — ` +
            `워크스페이스 소스맵(${this.sourceFileMap.size}개)에서 찾지 못했습니다. ` +
            `해당 .gpl/.gpo 파일이 열린 워크스페이스 폴더에 포함되어 있는지 확인하세요.`,
        );
        return filename;
    }

    /** 원격 파일 identity는 이 Attach에서 고른 .gpr의 선언 집합 안에서만 해석한다. */
    remoteSourceForInput(file: string): RemoteSourceFile | undefined {
        try {
            const source = this.remoteSourceSession?.resolveSource(file);
            return source && this.projectSourcePaths.some(candidate => this.isSamePath(candidate, source.localPath))
                ? source : undefined;
        } catch { return undefined; }
    }

    async ensureRemoteSourcePath(file: string): Promise<string> {
        if (!this.host.isConnected) { throw new Error('디버그 세션이 종료되어 원격 소스 요청을 중단했습니다.'); }
        const source = this.remoteSourceForInput(file);
        if (!source) { throw new Error(`${file}: 선택한 프로젝트의 소스가 아니거나 동명 파일을 구분할 수 없습니다.`); }
        const cached = fs.existsSync(source.localPath);
        const loaded = await this.remoteSourceSession!.ensureSource(source.remotePath);
        if (!this.host.isConnected) { throw new Error('디버그 세션이 종료되어 원격 소스 요청을 중단했습니다.'); }
        if (!loaded || !this.isSamePath(loaded.localPath, source.localPath)) {
            throw new Error(`${file}: 원격 소스를 가져오지 못했습니다.`);
        }
        if (!cached) { this.host.onSourceSetChanged('symbols'); }
        return loaded.localPath;
    }

    dapSource(file: string): Source | undefined {
        if (this.remoteSourceSession) {
            const source = this.remoteSourceForInput(file);
            return source ? new Source(path.posix.basename(source.remotePath), source.uri) : undefined;
        }
        return new Source(file, this.resolveSourcePath(file));
    }

    /** 동명 소스 경합 시 프로젝트 폴더 우선으로 선택하고, 모호하면 베이스네임당 1회 경고를 남긴다. */
    pickSourcePath(key: string, candidates: string[]): string {
        if (this.remoteSourceSession) { return this.remoteSourceForInput(key)?.localPath ?? ''; }
        const pick = pickSourceCandidate(candidates, this.projectDirs, this.projectSourcePaths)!;
        if (pick.ambiguous.length > 0 && !this.sourceResolveWarned.has(key)) {
            this.sourceResolveWarned.add(key);
            this.host.log(
                `⚠ 동명 소스 ${candidates.length}개 경합: "${key}" → ${pick.path} 선택 ` +
                `(제외: ${pick.ambiguous.join(' | ')}). 엉뚱한 파일이 열리면 워크스페이스에서 ` +
                `사본/백업 폴더를 정리하거나 launch.json "projectName"을 확인하세요.`,
            );
        }
        return pick.path;
    }

    /** 소스 경로 해석 실패를 예외 없이 흘려보낸다(BP 응답의 source 표기용). */
    safeResolveSourcePath(baseName: string): string | undefined {
        if (this.remoteSourceSession) { return this.remoteSourceForInput(baseName)?.uri; }
        try { return this.resolveSourcePath(baseName); } catch { return undefined; }
    }

    /**
     * filePath가 dirPath 하위 경로인지 검사.
     */
    isPathUnder(filePath: string, dirPath: string): boolean {
        try {
            const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
            return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        } catch {
            return false;
        }
    }

    /** 두 경로가 같은 폴더인가(Windows 대소문자 무시 — path.win32.relative 가 처리). */
    isSamePath(a: string, b: string): boolean {
        try {
            return path.relative(path.resolve(a), path.resolve(b)) === '';
        } catch {
            return false;
        }
    }

    /** basename → 소스 줄 배열(읽기 실패 시 undefined). 파일 시스템 접근만 — 제어기 명령 없음. */
    readSourceLines(baseName: string): string[] | undefined {
        try {
            const filePath = this.resolveSourcePath(baseName);
            return fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
        } catch {
            return undefined;
        }
    }

    /** basename 의 프로시저 범위(파서 + `End Sub` 기준). 소스를 못 읽으면 빈 배열. */
    procedureRangesFor(baseName: string, lines?: string[]): ProcedureRange[] {
        const src = lines ?? this.readSourceLines(baseName);
        if (!src) { return []; }
        let filePath: string;
        try { filePath = this.resolveSourcePath(baseName); } catch { return []; }
        const symbols = GPLParser.parseDocument(src.join('\n'), filePath, {
            includeLocals: false,
            includeParameters: false,
        });
        const procs = symbols
            .filter(s => s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub)
            .map(s => ({ name: s.className ? `${s.className}.${s.name}` : s.name, line: s.line + 1 }));
        return buildProcedureRanges(procs, src.length, src);
    }

    /**
     * 제어기가 실제로 BP를 걸 줄로 보정한다(문서 규칙: 빈 줄·주석이면 다음 실행 문장).
     * 소스를 못 읽으면 요청 줄을 그대로 쓴다(보정은 어디까지나 힌트).
     */
    adjustBreakpointLine(baseName: string, line: number): { line: number; moved: boolean } {
        const src = this.readSourceLines(baseName);
        if (!src) { return { line, moved: false }; }
        const resolved = resolveBreakpointLine(src, line);
        if (resolved === undefined || resolved === line) { return { line, moved: false }; }
        return { line: resolved, moved: true };
    }

    /**
     * 프로시저 이름(`Class.Proc` / `Module.Proc` / `Proc`)으로 정의 위치를 찾는다.
     * 워크스페이스 소스맵을 훑어 Sub/Function 심볼과 이름을 맞춘다(제어기 명령 없음).
     */
    findProcedureDefinitions(name: string): { file: string; line: number; label: string }[] {
        const wanted = name.trim().toLowerCase();
        if (!wanted) { return []; }
        const wantedTail = wanted.includes('.') ? wanted.split('.').pop()! : wanted;
        const out: { file: string; line: number; label: string }[] = [];

        for (const [key, candidates] of this.sourceFileMap) {
            const filePath = this.pickSourcePath(key, candidates);
            if (this.projectDirs.length > 0
                && !this.projectDirs.some(d => this.isPathUnder(filePath, d))) { continue; }
            let content: string;
            try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
            const symbols = GPLParser.parseDocument(content, filePath, {
                includeLocals: false,
                includeParameters: false,
            });
            const lines = content.split(/\r?\n/);
            const procs = symbols
                .filter(s => s.kind === GPLSymbolKind.Function || s.kind === GPLSymbolKind.Sub);
            const ranges = buildProcedureRanges(
                procs.map(s => ({ name: s.name, line: s.line + 1 })),
                lines.length,
                lines,
            );
            for (const s of procs) {
                const qualified = [
                    s.className ? `${s.className}.${s.name}` : undefined,
                    s.module ? `${s.module}.${s.name}` : undefined,
                    s.name,
                ].filter(Boolean).map(v => v!.toLowerCase());
                const matches = qualified.includes(wanted)
                    || (!wanted.includes('.') && s.name.toLowerCase() === wantedTail);
                if (!matches) { continue; }
                const header = s.line + 1;
                const range = ranges.find(r => r.start === header);
                // 헤더 다음 줄부터 첫 실행 문장을 찾는다(헤더 자체는 실행 명령이 아니다).
                const bpLine = resolveBreakpointLine(lines, header + 1, range);
                if (bpLine === undefined) { continue; }
                out.push({
                    file: path.basename(filePath),
                    line: bpLine,
                    label: s.className ? `${s.className}.${s.name}` : s.name,
                });
            }
        }
        return out;
    }

    /**
     * Detect project name from workspace Project.gpr or Show Thread response.
     */
    async detectProjectName(): Promise<string> {
        const candidates: Array<{
            projectName: string;
            gprPath: string;
            sourceNames: Set<string>;
        }> = [];

        // 1) Collect workspace Project.gpr files
        const folders = this.host.workspaceFolderPaths();
        if (folders) {
            for (const folderPath of folders) {
                const gprFiles = await this.findFiles(folderPath, 'Project.gpr');
                for (const gprPath of gprFiles) {
                    try {
                        const content = fs.readFileSync(gprPath, 'utf-8');
                        const info = parseGpr(content);
                        if (info.projectName) {
                            candidates.push({
                                projectName: info.projectName,
                                gprPath,
                                sourceNames: new Set(
                                    info.sources.map(s => path.basename(s).toLowerCase()),
                                ),
                            });
                        }
                    } catch { /* skip */ }
                }
            }
        }

        // 2) 활성 편집 파일(있으면)을 신호로 프로젝트를 선택한다.
        //    우선순위: 폴더포함+소스일치 → 폴더포함(최심) → 고유 소스명 일치 → 결정적 fallback.
        //    (선택 규칙은 selectProjectFromCandidates로 분리 — 순수 함수/단위 테스트 대상)
        const activePath = this.host.activeFilePath();

        const selection = selectProjectFromCandidates(candidates, activePath);
        if (selection) {
            this.host.log(`프로젝트 감지: ${selection.projectName} — ${selection.reason}`);
            if (selection.ambiguous) {
                this.host.log(
                    '⚠ 프로젝트 자동감지가 모호합니다(여러 프로젝트가 후보). 의도와 다른 프로젝트가 '
                    + '선택될 수 있으니 launch.json의 "projectName"으로 대상을 명시하는 것을 권장합니다.',
                );
            }
            return selection.projectName;
        }

        // 3) Fallback: detect from Show Thread (running thread's project)
        const resp = await this.host.sendCmd(SHOW_THREAD_LIST_CMD);
        if (resp) {
            const threads = parseThreadList(resp);
            for (const t of threads) {
                if (t.project) {
                    this.host.log(`프로젝트 감지: ${t.project} (from running thread)`);
                    return t.project;
                }
            }
        }

        return '';
    }

    /**
     * Choose deploy project directory from args/workspace.
     */
    async resolveDeployProjectDir(args: IAttachRequestArguments): Promise<string | undefined> {
        if (args.projectDir && fs.existsSync(args.projectDir)) {
            return args.projectDir;
        }

        const dirs = await findProjectDirs();
        if (dirs.length === 0) {
            return undefined;
        }
        if (dirs.length === 1) {
            return dirs[0];
        }

        // 1) projectName 우선 매칭
        if (args.projectName) {
            const target = args.projectName.toLowerCase();
            for (const dir of dirs) {
                const byFolder = path.basename(dir).toLowerCase() === target;
                let byGpr = false;
                try {
                    const gprFiles = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.gpr'));
                    for (const gprFile of gprFiles) {
                        const gprText = fs.readFileSync(path.join(dir, gprFile), 'utf-8');
                        if ((parseGpr(gprText).projectName || '').toLowerCase() === target) {
                            byGpr = true;
                            break;
                        }
                    }
                } catch {
                    // ignore parse errors and continue fallback matching
                }
                if (byFolder || byGpr) {
                    return dir;
                }
            }
        }

        // 2) 활성 파일 기준 매칭
        const activePath = this.host.activeFilePath();
        if (activePath) {
            const matched = dirs
                .filter(d => this.isPathUnder(activePath, d))
                .sort((a, b) => b.length - a.length)[0];
            if (matched) {
                return matched;
            }
        }

        // 3) deterministic fallback
        return [...dirs].sort((a, b) => a.localeCompare(b))[0];
    }
}
