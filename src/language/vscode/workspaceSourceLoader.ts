import * as vscode from 'vscode';
import * as path from 'path';
import { GPLParser } from '../gplParser';
import { SymbolIndex } from '../symbols/symbolIndex';
import { SymbolProjectScope } from '../../project/symbols/symbolProjectScope';
import { PROJECT_EXCLUDE_GLOB, findWorkspaceGprPaths } from '../../project/projectFileScope';
import { collectProjectSourcePaths } from '../../project/projectSources';
import { normalizePathKey } from '../../util/pathKey';

const INDEX_EXCLUDE_GLOB = PROJECT_EXCLUDE_GLOB;

export interface FileReferences {
    filePath: string;
    usages: { line: number; character: number }[];
}

export interface ReferenceSearchResult {
    references: FileReferences[];
    unreadable: string[];
}

/** 워크스페이스 탐색·문서 버퍼·디스크 디코딩과 묶음 인덱싱을 맡는다. */
export class WorkspaceSourceLoader {
    constructor(
        private readonly index: SymbolIndex,
        private readonly projectScope: SymbolProjectScope,
        private readonly log: (message: string) => void,
    ) {}

    /**
     * 워처가 알린 파일들을 디스크에서 읽어 **한 묶음**으로 갱신한다 — SVN update 처럼 수백 개가 한꺼번에
     * 바뀌어도 이름 인덱스는 끝에 한 번만 다시 만든다(§1-DX). 에디터에 열린 문서는 그 버퍼를 쓴다(미저장 편집분이 최신).
     */
    public async updateFilesFromDisk(uris: readonly vscode.Uri[]): Promise<void> {
        if (uris.length === 0) {
            return;
        }
        const openDocs = this.openFileDocuments();
        const updated: string[] = [];
        try {
            for (const uri of uris) {
                if (uri.scheme !== 'file') {
                    continue;
                }
                try {
                    if (await this.updateSourceFile(uri, openDocs) !== undefined) {
                        updated.push(uri.fsPath);
                    }
                } catch (error) {
                    this.log(`[SymbolCache] Error loading ${uri.fsPath}: ${error}`);
                }
            }
        } finally {
            if (updated.length > 0) {
                this.index.rebuildNameIndex();
            }
        }
        if (updated.length === 1) {
            this.log(`[SymbolCache] Updated ${path.basename(updated[0])} (watcher)`);
        } else if (updated.length > 1) {
            this.log(`[SymbolCache] Updated ${updated.length} files (watcher batch)`);
        }
    }

    /** 에디터에 열린 file 스킴 문서를 정규화 경로로 찾을 수 있게 모은다. */
    private openFileDocuments(): Map<string, vscode.TextDocument> {
        const map = new Map<string, vscode.TextDocument>();
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === 'file' && !doc.isClosed) {
                map.set(normalizePathKey(doc.uri.fsPath), doc);
            }
        }
        return map;
    }

    private async readCurrentSource(uri: vscode.Uri, openDocs: ReadonlyMap<string, vscode.TextDocument>): Promise<string> {
        const key = normalizePathKey(uri.fsPath);
        const open = openDocs.get(key);
        if (open && !open.isClosed) { return open.getText(); }
        const text = await this.readSourceText(uri);
        // 읽는 동안 새로 열린 문서와 미저장 편집을 다시 확인한다.
        const current = vscode.workspace.textDocuments.find(document =>
            document.uri.scheme === 'file' && !document.isClosed && normalizePathKey(document.uri.fsPath) === key);
        return current ? current.getText() : text;
    }

    private async updateSourceFile(uri: vscode.Uri, openDocs: ReadonlyMap<string, vscode.TextDocument>): Promise<number | undefined> {
        const revision = this.index.beginFileUpdate(uri.fsPath);
        const text = await this.readCurrentSource(uri, openDocs);
        if (!this.index.isFileUpdateCurrent(uri.fsPath, revision)) { return undefined; }
        return this.index.updateFileText(uri.fsPath, text);
    }

    /**
     * 디스크의 소스를 문자열로 읽는다 — `openTextDocument` 대신. 문서 객체를 만들면 파일 수만큼 문서가
     * 상주하고 `onDidOpenTextDocument` 가 설치된 모든 확장에 발송되며 언어 감지·`gpl` 언어 정규화까지
     * 따라붙는다(2026-09-18 실측: 567개 파일 인덱싱에서 그 비용이 파싱 자체보다 컸다 — §1-DX).
     * 인코딩은 `files.encoding` 이 UTF-8 계열(기본)이면 직접 디코딩(BOM 제거)하고, 그 외로 설정된
     * 리소스만 VS Code 의 디코더를 빌리기 위해 문서로 연다.
     */
    public async readSourceText(uri: vscode.Uri): Promise<string> {
        const encoding = vscode.workspace.getConfiguration('files', uri).get<string>('encoding', 'utf8');
        if (!/^utf-?8(bom)?$/i.test(encoding)) {
            return (await vscode.workspace.openTextDocument(uri)).getText();
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString('utf8');
        return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }

    public async indexWorkspace(): Promise<void> {
        // Prefer Project.gpr-based indexing when available.
        // Many GPL projects are single-folder, and Project.gpr defines the actual compile/reference set.
        // This avoids scanning the entire workspace (which can be huge) when only a handful of sources matter.
        const projectFiles = await this.getProjectSourcesFromGpr();

        const filesToIndex = projectFiles ?? (await vscode.workspace.findFiles(
            '**/*.gpl',
            INDEX_EXCLUDE_GLOB
        ));

        if (projectFiles) {
            this.log(`[SymbolCache] Using Project.gpr sources (${filesToIndex.length} files)`);
        } else {
            this.log(`[SymbolCache] Workspace glob: found ${filesToIndex.length} .gpl files`);
        }

        // 확장 호스트 스레드를 독점하지 않도록 이 개수마다 이벤트 루프에 한 번 양보한다 —
        // 인덱싱 중에도 호버·자동완성·정의 이동 요청이 사이에 처리될 틈을 준다.
        const YIELD_EVERY_FILES = 32;
        const started = Date.now();
        // 에디터에 이미 열린 문서는 그 버퍼를 쓴다 — 미저장 편집분이 디스크보다 최신이다.
        const openDocs = this.openFileDocuments();
        let indexed = 0;
        let failed = 0;
        try {
            for (let i = 0; i < filesToIndex.length; i++) {
                const file = filesToIndex[i];
                const fsPath = file.fsPath;
                // 전역 모듈(.gpo)은 현재 전체 인덱싱에서 제외한다. 열린 문서의 갱신 경로와는 별개다.
                if (fsPath.toLowerCase().endsWith('.gpo')) {
                    continue;
                }
                try {
                    if (await this.updateSourceFile(file, openDocs) !== undefined) {
                        indexed++;
                    }
                } catch (error) {
                    failed++;
                    this.log(`[SymbolCache] Error loading ${fsPath}: ${error}`);
                }
                if ((i + 1) % YIELD_EVERY_FILES === 0) {
                    await new Promise<void>(resolve => setImmediate(resolve));
                }
            }
        } finally {
            // 이름 인덱스는 묶음이 끝난 뒤 한 번만 — 파일마다 만들면 O(n²)(updateFileText 주석).
            this.index.rebuildNameIndex();
        }
        // 파일당 한 줄(수백 줄)이 아니라 요약 한 줄 — verbose 트레이스에서도 출력 채널 부담을 주지 않는다.
        this.log(
            `[SymbolCache] Indexed ${indexed} files in ${Date.now() - started} ms`
            + (failed > 0 ? ` (${failed} failed)` : ''),
        );
    }

    /**
     * 프로젝트(`.gpr`) 단위 소스 목록 — 워크스페이스의 각 `.gpr`마다
     * **`ProjectSource` 목록 ∪ 프로젝트 폴더 재귀 스캔**을 모아 돌려준다.
     * 워크스페이스에 `.gpr`가 하나도 없으면 undefined(호출측이 워크스페이스 glob으로 폴백).
     *
     * `ProjectSource`는 폴더 기준 상대 경로여서 `T1\T2\T2.gpl`처럼 하위 폴더가 임의 깊이로
     * 중첩될 수 있다(2026-08-28 실제 파일 확인 — `project/projectSources.ts` 참고).
     * 폴더 재귀 스캔을 합집합으로 두는 이유는 `.gpr`에 아직 추가하지 않은 새 파일도
     * 정의 이동·참조 검색·자동완성에 잡히게 하려는 것이다(참조 검색 범위와 같은 규칙).
     */
    private async getProjectSourcesFromGpr(): Promise<vscode.Uri[] | undefined> {
        try {
            const gprPaths = await findWorkspaceGprPaths();
            this.projectScope.setGprPaths(gprPaths);
            if (gprPaths.length === 0) {
                return undefined;
            }

            // 정규화 키 → 원본 경로. `.gpr`마다 같은 파일을 다른 표기로 낼 수 있어
            // (`ProjectSource=` 표기 ↔ 디스크 스캔 표기) 문자열 Set으로는 중복이 걸러지지 않는다.
            // 먼저 들어온 표기를 정본으로 남긴다 — 프로젝트 폴더 재귀 스캔(디스크 표기)이 앞선다.
            const sources = new Map<string, string>();
            let truncatedProjects = 0;

            for (const gprPath of gprPaths) {
                try {
                    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(gprPath));
                    const text = Buffer.from(bytes).toString('utf8');
                    const collected = collectProjectSourcePaths(gprPath, text, {
                        extensions: ['.gpl', '.gpo'],
                    });
                    if (collected.truncated) {
                        truncatedProjects++;
                    }
                    for (const full of collected.files) {
                        const key = normalizePathKey(full);
                        if (!sources.has(key)) {
                            sources.set(key, full);
                        }
                    }
                } catch (e) {
                    this.log(`[SymbolCache] Failed to parse .gpr (${gprPath}): ${e}`);
                }
            }

            if (truncatedProjects > 0) {
                this.log(
                    `[SymbolCache] ⚠ 소스 탐색 상한에 걸린 프로젝트 ${truncatedProjects}개 — `
                    + '일부 파일이 인덱스에서 빠졌습니다.'
                );
            }

            if (sources.size === 0) {
                // .gpr는 있지만 소스를 하나도 모으지 못했다 → 워크스페이스 glob으로 폴백.
                return undefined;
            }

            return Array.from(sources.values()).map(p => vscode.Uri.file(p));
        } catch {
            return undefined;
        }
    }

    /**
     * 캐시에 인덱싱된 "모든" 파일에서 심볼 사용처를 찾는다.
     *
     * 종전에는 (a) 해당 이름을 정의한 파일이면서 (b) 에디터에 열린 문서만 스캔해,
     * 사용-전용 파일과 미오픈 파일의 참조를 통째로 놓쳤다. 이제 인덱싱된 파일 전체를
     * 대상으로, 열린 문서가 있으면 그 텍스트(저장 전 편집 반영)를, 없으면 디스크에서
     * 읽어(설정 인코딩) 스캔한다. 스캔 자체는 주석/문자열 안전 + 대소문자 무시 단어 경계인
     * GPLParser.findSymbolUsages를 그대로 사용한다.
     */
    public async findReferences(
        symbolName: string,
        token?: vscode.CancellationToken
    ): Promise<ReferenceSearchResult> {
        const references: { filePath: string; usages: { line: number; character: number }[] }[] = [];
        // 읽기에 실패한 경로 — 루프가 끝난 뒤 "확실히 없는" 것만 인덱스에서 정리한다(자가 치유).
        // 순회 중 Map을 건드리지 않으려고 모았다가 처리한다.
        const unreadable: string[] = [];
        const openDocs = this.openFileDocuments();

        // 키가 아니라 원본 표기(filePath)로 순회한다 — 결과가 URI·표시에 그대로 쓰이므로.
        for (const filePath of this.index.listIndexedFiles()) {
            if (token?.isCancellationRequested) {
                break;
            }

            let text: string;
            try {
                text = await this.readCurrentSource(vscode.Uri.file(filePath), openDocs);
            } catch {
                // 삭제/접근 불가 파일은 건너뛴다. 원인 판정(ENOENT인지)은 pruneMissingFiles에 맡긴다.
                unreadable.push(filePath);
                continue;
            }
            if (token?.isCancellationRequested) { break; }

            const usages = GPLParser.findSymbolUsages(text, symbolName);
            if (usages.length > 0) {
                references.push({ filePath, usages });
            }
        }

        return { references, unreadable };
    }
}
