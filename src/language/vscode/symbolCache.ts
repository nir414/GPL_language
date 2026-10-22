import * as vscode from 'vscode';
import * as path from 'path';
import { isTraceOn } from '../../config';
import type { GPLSymbol } from '../gplParser';
import type { CallContext } from '../overloadResolution';
import { isMissingFile } from '../symbolLocations';
import { SymbolIndex } from '../symbols/symbolIndex';
import { SymbolProjectScope } from '../../project/symbols/symbolProjectScope';
import { WorkspaceSourceLoader, FileReferences } from './workspaceSourceLoader';
import { getCompletionItems, buildSymbolDocumentation, getCompletionItemKind } from './symbolPresentation';

/** 기존 Provider API를 유지하면서 인덱스·프로젝트 경계·VS Code 연동의 수명주기를 조립한다. */
export class SymbolCache {
    private readonly projectScope = new SymbolProjectScope(filePath =>
        vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath);
    private readonly index = new SymbolIndex(this.projectScope);
    private readonly sourceLoader = new WorkspaceSourceLoader(this.index, this.projectScope, message => this.log(message));
    private refreshTask: Promise<void> | undefined;
    private refreshRequested = false;
    public isRefreshing = false;

    constructor(private readonly outputChannel?: vscode.OutputChannel) {}

    private log(message: string) {
        if (!isTraceOn(vscode.workspace)) {
            return;
        }
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    public refresh(): Promise<void> {
        this.refreshRequested = true;
        if (!this.refreshTask) {
            this.isRefreshing = true;
            this.refreshTask = Promise.resolve().then(() => this.refreshWorkspace());
        }
        return this.refreshTask;
    }

    private async refreshWorkspace(): Promise<void> {
        try {
            this.log('[SymbolCache] Starting refresh...');
            do {
                this.refreshRequested = false;
                this.index.clear();
                await this.sourceLoader.indexWorkspace();
            } while (this.refreshRequested);
            this.log(`[SymbolCache] Refresh complete. Total symbols: ${this.getAllSymbols().length}`);
        } finally {
            this.isRefreshing = false;
            this.refreshTask = undefined;
        }
    }

    public updateDocument(document: vscode.TextDocument): void {
        if (document.uri.scheme !== 'file') {
            return;
        }
        // Do not rely on languageId: *.gpl can be opened as 'vb'.
        const fsPath = document.uri.fsPath;
        const count = this.index.updateFileText(fsPath, document.getText());
        if (count === undefined) {
            return;
        }
        this.index.rebuildNameIndex();
        this.log(`[SymbolCache] Updated ${path.basename(fsPath)}: ${count} symbols`);
    }

    public async updateFilesFromDisk(uris: readonly vscode.Uri[]): Promise<void> {
        await this.sourceLoader.updateFilesFromDisk(uris);
    }

    public async readSourceText(uri: vscode.Uri): Promise<string> {
        return this.sourceLoader.readSourceText(uri);
    }

    public removeFile(filePath: string): void {
        if (this.index.removeFile(filePath)) {
            this.log(`[SymbolCache] Removed ${path.basename(filePath)} from cache`);
        }
    }

    public deleteByFsPathPrefix(fsPath: string): void {
        this.index.deleteByFsPathPrefix(fsPath);
    }

    public pruneMissingFiles(filePaths?: readonly string[]): number {
        const removed = this.index.pruneFiles(isMissingFile, filePaths);
        for (const filePath of removed) {
            this.log(`[SymbolCache] Pruned missing file: ${filePath}`);
        }
        return removed.length;
    }

    public invalidateProjectRelations(): void {
        this.projectScope.invalidateProjectRelations();
    }

    public async findReferences(symbolName: string, token?: vscode.CancellationToken): Promise<FileReferences[]> {
        const { references, unreadable } = await this.sourceLoader.findReferences(symbolName, token);
        if (unreadable.length > 0) {
            const pruned = this.pruneMissingFiles(unreadable);
            if (pruned > 0) {
                this.log(`[SymbolCache] 참조 검색 중 사라진 파일 ${pruned}개를 인덱스에서 제거했다`);
            }
        }
        return references;
    }

    public getCompletionItems(): vscode.CompletionItem[] {
        return getCompletionItems(this.index);
    }

    public buildSymbolDocumentation(symbol: GPLSymbol): vscode.MarkdownString {
        return buildSymbolDocumentation(symbol, this.index);
    }

    public getCompletionItemKind(symbolKind: string): vscode.CompletionItemKind {
        return getCompletionItemKind(symbolKind);
    }

    public listIndexedFiles(): string[] {
        return this.index.listIndexedFiles();
    }

    public findDefinition(symbolName: string, currentFilePath?: string, call?: number | CallContext): GPLSymbol | undefined {
        return this.index.findDefinition(symbolName, currentFilePath, call);
    }

    public findDefinitionMatches(symbolName: string, currentFilePath?: string, call?: number | CallContext): GPLSymbol[] {
        return this.index.findDefinitionMatches(symbolName, currentFilePath, call);
    }

    public findMemberInClass(memberName: string, className: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol | undefined {
        return this.index.findMemberInClass(memberName, className, preferredFilePath, call);
    }

    public findMemberInClassMatches(memberName: string, className: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol[] {
        return this.index.findMemberInClassMatches(memberName, className, preferredFilePath, call);
    }

    public findMemberInModule(memberName: string, moduleName: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol | undefined {
        return this.index.findMemberInModule(memberName, moduleName, preferredFilePath, call);
    }

    public findMemberInModuleMatches(memberName: string, moduleName: string, preferredFilePath?: string, call?: number | CallContext): GPLSymbol[] {
        return this.index.findMemberInModuleMatches(memberName, moduleName, preferredFilePath, call);
    }

    public findConstructorInClass(className: string, argCount?: number, preferredFilePath?: string): GPLSymbol | undefined {
        return this.index.findConstructorInClass(className, argCount, preferredFilePath);
    }

    public findMemberCandidatesInClass(memberName: string, className: string): GPLSymbol[] {
        return this.index.findMemberCandidatesInClass(memberName, className);
    }

    public findMemberCandidatesInModule(memberName: string, moduleName: string): GPLSymbol[] {
        return this.index.findMemberCandidatesInModule(memberName, moduleName);
    }

    public isSameCompileUnit(candidateFilePath: string, referenceFilePath: string): boolean {
        return this.index.isSameCompileUnit(candidateFilePath, referenceFilePath);
    }

    public findAllByName(symbolName: string): GPLSymbol[] {
        return this.index.findAllByName(symbolName);
    }

    public findOverloadSiblings(target: GPLSymbol, extra?: readonly GPLSymbol[]): GPLSymbol[] {
        return this.index.findOverloadSiblings(target, extra);
    }

    public getAllSymbols(): GPLSymbol[] {
        return this.index.getAllSymbols();
    }

    public getClassMembers(className: string): GPLSymbol[] {
        return this.index.getClassMembers(className);
    }

    public getModuleMembers(moduleName: string): GPLSymbol[] {
        return this.index.getModuleMembers(moduleName);
    }
}
