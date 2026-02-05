import * as vscode from 'vscode';

export type TraceServerLevel = 'off' | 'messages' | 'verbose';

type WorkspaceConfigHost = Pick<typeof vscode.workspace, 'getConfiguration'>;

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
