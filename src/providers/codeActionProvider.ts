import * as vscode from 'vscode';

export class GPLCodeActionProvider implements vscode.CodeActionProvider {
    
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        const actions: vscode.CodeAction[] = [];

        // VB.NET 호환성 진단에 대한 quick fixes
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === 'GPL VB.NET Compatibility') {
                const action = this.createCompatibilityFix(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }
        }

        return actions;
    }

    private createCompatibilityFix(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const message = diagnostic.message;

        // On Error  → Try-Catch 변환
        if (message.includes('On Error')) {
            const action = new vscode.CodeAction(
                'Try-Catch로 변환',
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];
            action.isPreferred = true;

            const edit = new vscode.WorkspaceEdit();
            const line = document.lineAt(diagnostic.range.start.line);
            const suggestion = `Try\n    ' 여기에 코드 작성\nCatch ex As Exception\n    ' 오류 처리\nEnd Try`;
            edit.replace(document.uri, line.range, suggestion);
            action.edit = edit;

            return action;
        }

        return null;
    }
}
