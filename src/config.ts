import * as vscode from 'vscode';

/** package.json의 version을 단일 소스로 사용 */
export const EXTENSION_VERSION: string = require('../package.json').version;

export type TraceServerLevel = 'off' | 'messages' | 'verbose';

type WorkspaceConfigHost = Pick<typeof vscode.workspace, 'getConfiguration'>;

/**
 * GPL 파일 여부 판별 (확장자 기반).
 * languageId는 'vb'로 열릴 수 있으므로 사용하지 않는다.
 */
export function isGplFile(document: vscode.TextDocument): boolean {
    const fsPath = document.uri.fsPath.toLowerCase();
    return document.uri.scheme === 'file' && (fsPath.endsWith('.gpl') || fsPath.endsWith('.gpo'));
}

/**
 * GPL 파일 여부 판별 (타입 가드 버전, nullable 허용).
 */
export function isGplDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
    if (!document) return false;
    return isGplFile(document);
}

export function getTraceServerLevel(workspace: WorkspaceConfigHost): TraceServerLevel {
    // Configuration key is declared in package.json as: gpl.trace.server
    const raw: unknown = workspace.getConfiguration('gpl').get('trace.server', 'off');
    const rawString = typeof raw === 'string' ? raw : 'off';

    if (rawString === 'messages' || rawString === 'verbose' || rawString === 'off') {
        return rawString;
    }

    return 'off';
}

export function isTraceOn(workspace: WorkspaceConfigHost): boolean {
    return getTraceServerLevel(workspace) !== 'off';
}

export function isTraceVerbose(workspace: WorkspaceConfigHost): boolean {
    return getTraceServerLevel(workspace) === 'verbose';
}
