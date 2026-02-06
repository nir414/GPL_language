import * as vscode from 'vscode';
import { SymbolCache } from '../symbolCache';

export class GPLCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private symbolCache: SymbolCache) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const completionItems: vscode.CompletionItem[] = [];
        
        // Get current context (module/class)
        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const moduleMatch = text.match(/Module\s+(\w+)/);
        const classMatch = text.match(/.*Class\s+(\w+)/);
        
        const currentModule = moduleMatch ? moduleMatch[1] : undefined;
        const currentClass = classMatch ? classMatch[1] : undefined;

        // Get symbol completions from cache
        const symbolCompletions = this.symbolCache.getCompletionItems(currentModule, currentClass);
        completionItems.push(...symbolCompletions);

        // Add GPL built-in keywords
        completionItems.push(...this.getGPLKeywords());

        return completionItems;
    }

    private getGPLKeywords(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const keywords = [
            'Module', 'End Module', 'Class', 'End Class',
            'Function', 'End Function', 'Sub', 'End Sub',
            'Public', 'Private', 'Shared', 'Dim', 'Const',
            'If', 'Then', 'Else', 'ElseIf', 'End If',
            'For', 'Next', 'While', 'Wend', 'Do', 'Loop',
            'Select Case', 'Case', 'End Select',
            'Try', 'Catch', 'Finally', 'End Try',
            'As', 'New', 'Nothing', 'True', 'False',
            'And', 'Or', 'Not', 'Xor',
            'Property', 'Get', 'Set', 'End Property',
            'Type', 'End Type', 'Enum', 'End Enum'
        ];

        for (const keyword of keywords) {
            const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
            item.sortText = '1_' + keyword; // Put keywords lower than symbols
            items.push(item);
        }

        return items;
    }
}
