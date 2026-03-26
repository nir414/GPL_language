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
        const line = document.lineAt(diagnostic.range.start.line);
        const lineText = line.text;

        // On Error → Try-Catch 변환
        if (message.includes('On Error')) {
            const action = new vscode.CodeAction(
                'Try-Catch로 변환',
                vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];
            action.isPreferred = true;

            const edit = new vscode.WorkspaceEdit();
            const indentation = lineText.match(/^\s*/)?.[0] || '';
            const suggestion = `${indentation}Try\n${indentation}    ' 여기에 코드 작성\n${indentation}Catch ex As Exception\n${indentation}    ' 오류 처리\n${indentation}End Try`;
            edit.replace(document.uri, line.range, suggestion);
            action.edit = edit;

            return action;
        }

        // Left() → Mid() 변환
        if (diagnostic.code === 'use-mid-instead-of-left') {
            const match = lineText.match(/Left\s*\(\s*(\w+)\s*,\s*(\w+|\d+)\s*\)/i);
            if (match) {
                const action = new vscode.CodeAction(
                    'Mid()로 변환',
                    vscode.CodeActionKind.QuickFix
                );
                action.diagnostics = [diagnostic];
                action.isPreferred = true;

                const edit = new vscode.WorkspaceEdit();
                const replacement = lineText.replace(
                    /Left\s*\(\s*(\w+)\s*,\s*(\w+|\d+)\s*\)/i,
                    'Mid($1, 1, $2)'
                );
                edit.replace(document.uri, line.range, replacement);
                action.edit = edit;

                return action;
            }
        }

        // Right() → Mid() 변환
        if (diagnostic.code === 'use-mid-instead-of-right') {
            const match = lineText.match(/Right\s*\(\s*(\w+)\s*,\s*(\w+|\d+)\s*\)/i);
            if (match) {
                const action = new vscode.CodeAction(
                    'Mid()로 변환',
                    vscode.CodeActionKind.QuickFix
                );
                action.diagnostics = [diagnostic];
                action.isPreferred = true;

                const edit = new vscode.WorkspaceEdit();
                const varName = match[1];
                const length = match[2];
                const replacement = lineText.replace(
                    /Right\s*\(\s*\w+\s*,\s*(\w+|\d+)\s*\)/i,
                    `Mid(${varName}, Len(${varName}) - ${length} + 1)`
                );
                edit.replace(document.uri, line.range, replacement);
                action.edit = edit;

                return action;
            }
        }

        // Val() → CInt() 또는 CDbl() 제안
        if (diagnostic.code === 'use-cint-cdbl-instead-of-val') {
            const actions: vscode.CodeAction[] = [];

            // CInt 변환
            const cintAction = new vscode.CodeAction(
                'CInt()로 변환 (정수)',
                vscode.CodeActionKind.QuickFix
            );
            cintAction.diagnostics = [diagnostic];
            const cintEdit = new vscode.WorkspaceEdit();
            const cintReplacement = lineText.replace(/Val\s*\(/i, 'CInt(');
            cintEdit.replace(document.uri, line.range, cintReplacement);
            cintAction.edit = cintEdit;

            // CDbl 변환
            const cdblAction = new vscode.CodeAction(
                'CDbl()로 변환 (실수)',
                vscode.CodeActionKind.QuickFix
            );
            cdblAction.diagnostics = [diagnostic];
            const cdblEdit = new vscode.WorkspaceEdit();
            const cdblReplacement = lineText.replace(/Val\s*\(/i, 'CDbl(');
            cdblEdit.replace(document.uri, line.range, cdblReplacement);
            cdblAction.edit = cdblEdit;

            // Return first action (we can only return one from this method)
            // In practice, VS Code will show both if we add them to the actions array
            return cintAction;
        }

        // Unsupported types → Alternative suggestions
        if (diagnostic.code === 'unsupported-type') {
            const typeMap: { [key: string]: string } = {
                'Long': 'Integer',
                'Int64': 'Integer',
                'Decimal': 'Double',
                'Char': 'String',
                'Date': 'String',
                'Variant': 'Object'
            };

            for (const [oldType, newType] of Object.entries(typeMap)) {
                if (message.includes(oldType)) {
                    const action = new vscode.CodeAction(
                        `${newType}로 변경`,
                        vscode.CodeActionKind.QuickFix
                    );
                    action.diagnostics = [diagnostic];
                    action.isPreferred = true;

                    const edit = new vscode.WorkspaceEdit();
                    const typeRegex = new RegExp(`\\bAs\\s+${oldType}\\b`, 'i');
                    const replacement = lineText.replace(typeRegex, `As ${newType}`);
                    edit.replace(document.uri, line.range, replacement);
                    action.edit = edit;

                    return action;
                }
            }
        }

        return null;
    }
}
