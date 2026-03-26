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
        
        // Basic keywords
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
            item.sortText = '1_' + keyword;
            items.push(item);
        }

        // GPL-specific snippets
        items.push(...this.getGPLSnippets());

        return items;
    }

    private getGPLSnippets(): vscode.CompletionItem[] {
        const snippets: vscode.CompletionItem[] = [];

        // Try-Catch template
        const tryCatch = new vscode.CompletionItem('try_catch', vscode.CompletionItemKind.Snippet);
        tryCatch.insertText = new vscode.SnippetString(
            'Try\\n\\t${1:code}\\nCatch ex As Exception\\n\\t${2:error handling}\\nEnd Try'
        );
        tryCatch.documentation = new vscode.MarkdownString('GPL standard exception handling pattern');
        tryCatch.sortText = '0_try_catch';
        snippets.push(tryCatch);

        // Thread.TestAndSet spin lock pattern
        const testAndSet = new vscode.CompletionItem('thread_lock', vscode.CompletionItemKind.Snippet);
        testAndSet.insertText = new vscode.SnippetString(
            'While Thread.TestAndSet(${1:lockVar}, 1) = 1\\n\\tThread.Sleep(0)\\nWend\\nTry\\n\\t${2:critical section}\\nFinally\\n\\t${1:lockVar} = 0\\nEnd Try'
        );
        testAndSet.documentation = new vscode.MarkdownString('Thread synchronization pattern (TestAndSet spin lock)');
        testAndSet.sortText = '0_thread_lock';
        snippets.push(testAndSet);

        // String Mid left extraction pattern
        const midLeft = new vscode.CompletionItem('mid_left', vscode.CompletionItemKind.Snippet);
        midLeft.insertText = new vscode.SnippetString('Mid(${1:str}, 1, ${2:n})');
        midLeft.documentation = new vscode.MarkdownString('Extract first n characters (Left replacement)');
        midLeft.sortText = '0_mid_left';
        snippets.push(midLeft);

        // String Mid right extraction pattern
        const midRight = new vscode.CompletionItem('mid_right', vscode.CompletionItemKind.Snippet);
        midRight.insertText = new vscode.SnippetString('Mid(${1:str}, Len(${1:str}) - ${2:n} + 1)');
        midRight.documentation = new vscode.MarkdownString('Extract last n characters (Right replacement)');
        midRight.sortText = '0_mid_right';
        snippets.push(midRight);

        // InStr pattern (with start index)
        const instr = new vscode.CompletionItem('instr_pattern', vscode.CompletionItemKind.Snippet);
        instr.insertText = new vscode.SnippetString('InStr(1, ${1:source}, ${2:search})');
        instr.documentation = new vscode.MarkdownString('String search (start index recommended)');
        instr.sortText = '0_instr';
        snippets.push(instr);

        // String Nothing check pattern
        const stringCheck = new vscode.CompletionItem('string_null_check', vscode.CompletionItemKind.Snippet);
        stringCheck.insertText = new vscode.SnippetString(
            'If ${1:str} Is Nothing Then\\n\\t${2:handle null}\\nEnd If'
        );
        stringCheck.documentation = new vscode.MarkdownString('String Nothing check (GPL String can be Nothing)');
        stringCheck.sortText = '0_string_check';
        snippets.push(stringCheck);

        // StreamWriter Flush pattern
        const streamFlush = new vscode.CompletionItem('stream_flush', vscode.CompletionItemKind.Snippet);
        streamFlush.insertText = new vscode.SnippetString(
            'Dim ${1:writer} As StreamWriter = Nothing\\nTry\\n\\t${1:writer} = New StreamWriter(${2:path})\\n\\t${1:writer}.WriteLine(${3:data})\\n\\t${1:writer}.Flush()\\nFinally\\n\\tIf ${1:writer} IsNot Nothing Then ${1:writer}.Close()\\nEnd Try'
        );
        streamFlush.documentation = new vscode.MarkdownString('StreamWriter standard pattern (Flush + Close)');
        streamFlush.sortText = '0_stream_flush';
        snippets.push(streamFlush);

        // File I/O read pattern
        const fileRead = new vscode.CompletionItem('file_read', vscode.CompletionItemKind.Snippet);
        fileRead.insertText = new vscode.SnippetString(
            'Dim ${1:reader} As StreamReader = Nothing\\nTry\\n\\t${1:reader} = New StreamReader(${2:path})\\n\\tDim ${3:line} As String\\n\\tWhile Not ${1:reader}.EndOfStream\\n\\t\\t${3:line} = ${1:reader}.ReadLine()\\n\\t\\t${4:process line}\\n\\tWend\\nFinally\\n\\tIf ${1:reader} IsNot Nothing Then ${1:reader}.Close()\\nEnd Try'
        );
        fileRead.documentation = new vscode.MarkdownString('File read standard pattern (StreamReader)');
        fileRead.sortText = '0_file_read';
        snippets.push(fileRead);

        // CInt with error handling
        const cintSafe = new vscode.CompletionItem('cint_safe', vscode.CompletionItemKind.Snippet);
        cintSafe.insertText = new vscode.SnippetString(
            'Try\\n\\t${1:result} = CInt(${2:value})\\nCatch ex As Exception\\n\\t${1:result} = ${3:0}\\nEnd Try'
        );
        cintSafe.documentation = new vscode.MarkdownString('Safe integer conversion (Val replacement)');
        cintSafe.sortText = '0_cint_safe';
        snippets.push(cintSafe);

        // Module template
        const moduleTemplate = new vscode.CompletionItem('module_template', vscode.CompletionItemKind.Snippet);
        moduleTemplate.insertText = new vscode.SnippetString(
            'Module ${1:ModuleName}\\n\\t${2:content}\\nEnd Module'
        );
        moduleTemplate.documentation = new vscode.MarkdownString('Module template');
        moduleTemplate.sortText = '0_module';
        snippets.push(moduleTemplate);

        // Class template
        const classTemplate = new vscode.CompletionItem('class_template', vscode.CompletionItemKind.Snippet);
        classTemplate.insertText = new vscode.SnippetString(
            'Public Class ${1:ClassName}\\n\\t${2:members}\\nEnd Class'
        );
        classTemplate.documentation = new vscode.MarkdownString('Class template');
        classTemplate.sortText = '0_class';
        snippets.push(classTemplate);

        return snippets;
    }
}
