export interface GPLSymbol {
    name: string;
    kind: GPLSymbolKind;
    range: { start: number; end: number };
    line: number;
    filePath: string;
    module?: string;
    className?: string;
    accessModifier?: 'public' | 'private';
    isShared?: boolean;
    parameters?: string[];
    returnType?: string;
}

export enum GPLSymbolKind {
    Module = 'module',
    Class = 'class',
    Function = 'function',
    Sub = 'sub',
    Variable = 'variable',
    Property = 'property',
    Constant = 'constant'
}

export class GPLParser {
    static parseDocument(content: string, filePath: string): GPLSymbol[] {
        const symbols: GPLSymbol[] = [];
        const lines = content.split('\n');
        let currentModule: string | undefined;
        // Classes can be nested. Track a stack so that `End Class` restores the outer class.
        const classStack: string[] = [];
        let currentClass: string | undefined;
        // Track whether we're inside a procedure block (Sub/Function/Property body).
        // We intentionally do NOT index local Dim variables as workspace symbols.
        let blockDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            
            // Skip comments and empty lines
            if (trimmedLine.startsWith("'") || trimmedLine === '') {
                continue;
            }

            // Parse Module
            const moduleMatch = trimmedLine.match(/^Module\s+(\w+)/i);
            if (moduleMatch) {
                currentModule = moduleMatch[1];
                classStack.length = 0;
                currentClass = undefined;
                blockDepth = 0;
                const startIndex = line.indexOf(moduleMatch[1]);
                symbols.push({
                    name: moduleMatch[1],
                    kind: GPLSymbolKind.Module,
                    range: { start: startIndex, end: startIndex + moduleMatch[1].length },
                    line: i,
                    filePath,
                    module: currentModule
                });
                continue;
            }

            // Parse Class
            const classMatch = trimmedLine.match(/^(Public|Private)?\s*Class\s+(\w+)/i);
            if (classMatch) {
                classStack.push(classMatch[2]);
                currentClass = classStack[classStack.length - 1];
                blockDepth = 0;
                const startIndex = line.indexOf(classMatch[2]);
                symbols.push({
                    name: classMatch[2],
                    kind: GPLSymbolKind.Class,
                    range: { start: startIndex, end: startIndex + classMatch[2].length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: classMatch[1] ? (classMatch[1].toLowerCase() as 'public' | 'private') : undefined
                });
                continue;
            }

            // Check for End Class to reset currentClass
            if (trimmedLine.match(/^End\s+Class/i)) {
                if (classStack.length > 0) {
                    classStack.pop();
                }
                currentClass = classStack.length > 0 ? classStack[classStack.length - 1] : undefined;
                blockDepth = 0;
                continue;
            }

            // Check for End Sub/Function/Property to end local-scope block
            if (trimmedLine.match(/^End\s+(Function|Sub|Property)/i)) {
                if (blockDepth > 0) {
                    blockDepth--;
                }
                continue;
            }

            // Check for End Module to reset both
            if (trimmedLine.match(/^End\s+Module/i)) {
                currentModule = undefined;
                classStack.length = 0;
                currentClass = undefined;
                blockDepth = 0;
                continue;
            }

            // Parse Function: token-based parsing to support any keyword order
            const functionMatch = trimmedLine.match(/\bFunction\s+(\w+)\s*\(([^)]*)\)(?:\s+As\s+(\w+))?/i);
            if (functionMatch && trimmedLine.match(/^\s*(Public|Private|Shared|\s)+Function\b/i)) {
                const name = functionMatch[1];
                const params = functionMatch[2] ? functionMatch[2].split(',').map(p => p.trim()) : [];
                const returnType = functionMatch[3];
                const startIndex = line.indexOf(name);
                
                // Token-based keyword extraction (order-independent)
                const upperLine = trimmedLine.toUpperCase();
                const accessModifier = upperLine.includes('PUBLIC') ? 'public' as const :
                                     upperLine.includes('PRIVATE') ? 'private' as const : undefined;
                const isShared = upperLine.includes('SHARED');
                
                symbols.push({
                    name,
                    kind: GPLSymbolKind.Function,
                    range: { start: startIndex, end: startIndex + name.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: accessModifier,
                    isShared: isShared,
                    parameters: params,
                    returnType: returnType
                });
                // Enter function block: skip local Dim declarations inside
                blockDepth++;
                continue;
            }

            // Parse Sub: token-based parsing to support any keyword order
            const subMatch = trimmedLine.match(/\bSub\s+(\w+)\s*\(([^)]*)\)/i);
            if (subMatch && trimmedLine.match(/^\s*(Public|Private|Shared|\s)+Sub\b/i)) {
                const name = subMatch[1];
                const params = subMatch[2] ? subMatch[2].split(',').map(p => p.trim()) : [];
                const startIndex = line.indexOf(name);
                
                // Token-based keyword extraction (order-independent)
                const upperLine = trimmedLine.toUpperCase();
                const accessModifier = upperLine.includes('PUBLIC') ? 'public' as const :
                                     upperLine.includes('PRIVATE') ? 'private' as const : undefined;
                const isShared = upperLine.includes('SHARED');
                
                symbols.push({
                    name,
                    kind: GPLSymbolKind.Sub,
                    range: { start: startIndex, end: startIndex + name.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: accessModifier,
                    isShared: isShared,
                    parameters: params
                });

                // Enter sub block: skip local Dim declarations inside
                blockDepth++;
                continue;
            }

            // Parse Property
            // Supports: Public/Private, Shared, ReadOnly/WriteOnly, optional parameter list `()`, and array return types `As Foo()`.
            const propertyMatch = trimmedLine.match(
                /^(Public|Private)?\s*(Shared\s+)?(?:(ReadOnly|WriteOnly)\s+)?Property\s+(\w+)\s*(\([^)]*\))?\s+As\s+(\w+)\s*(\(\))?/i
            );
            if (propertyMatch) {
                const returnType = propertyMatch[6] + (propertyMatch[7] ? '[]' : '');
                symbols.push({
                    name: propertyMatch[4],
                    kind: GPLSymbolKind.Property,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: propertyMatch[1] ? (propertyMatch[1].toLowerCase() as 'public' | 'private') : undefined,
                    isShared: !!propertyMatch[2],
                    returnType
                });

                // Enter property block (if it has Get/Set); End Property will decrement.
                blockDepth++;
                continue;
            }

            // Parse shared variable with New (e.g., "Public Shared Dim storeA As New XmlStore")
            if (blockDepth > 0) {
                // Local variables inside procedures are not indexed
                continue;
            }
            const sharedNewVariableMatch = trimmedLine.match(/^(Private|Public)\s+Shared\s+Dim\s+(\w+)\s+As\s+New\s+(\w+)/i);
            if (sharedNewVariableMatch) {
                symbols.push({
                    name: sharedNewVariableMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: sharedNewVariableMatch[3]
                });
                continue;
            }

            // Parse shared variable/constant (e.g., "Public Shared Dim echoMode As Boolean")
            const sharedVariableMatch = trimmedLine.match(/^(Private|Public)\s+Shared\s+Dim\s+(Const\s+)?(\w+)\s+As\s+(\w+)/i);
            if (sharedVariableMatch) {
                const isConstant = !!sharedVariableMatch[2];
                symbols.push({
                    name: sharedVariableMatch[3],
                    kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: sharedVariableMatch[4]
                });
                continue;
            }

            // Parse variable with New (e.g., "Dim storeA As New XmlStore")
            // MUST be checked BEFORE regular variable pattern
            const newVariableMatch = trimmedLine.match(/^(Private|Public|Dim)\s+(\w+)\s+As\s+New\s+(\w+)/i);
            if (newVariableMatch) {
                symbols.push({
                    name: newVariableMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: newVariableMatch[3]
                });
                continue;
            }

            // Parse Variable/Constant
            const variableMatch = trimmedLine.match(/^(Private|Public|Dim)\s+(Const\s+)?(\w+)\s+As\s+(\w+)/i);
            if (variableMatch) {
                const isConstant = !!variableMatch[2];
                symbols.push({
                    name: variableMatch[3],
                    kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: variableMatch[4]
                });
                continue;
            }

            // Parse array variable (e.g., "Dim kvs(100) As KeyValue")
            const arrayMatch = trimmedLine.match(/^(Private|Public|Dim)\s+(\w+)\s*\([^)]*\)\s+As\s+(\w+)/i);
            if (arrayMatch) {
                symbols.push({
                    name: arrayMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: arrayMatch[3] + '[]'
                });
                continue;
            }

            // Parse Type definition
            const typeMatch = trimmedLine.match(/^(Public\s+)?Type\s+(\w+)/i);
            if (typeMatch) {
                symbols.push({
                    name: typeMatch[2],
                    kind: GPLSymbolKind.Class, // Use Class kind for Type definitions
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule
                });
                continue;
            }
        }

        return symbols;
    }

    static findSymbolUsages(content: string, symbolName: string): { line: number; character: number }[] {
        const usages: { line: number; character: number }[] = [];
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip comments
            const commentIndex = line.indexOf("'");
            let searchLine = commentIndex !== -1 ? line.substring(0, commentIndex) : line;
            
            // Find all occurrences in this line
            let startIndex = 0;
            while (true) {
                const index = searchLine.indexOf(symbolName, startIndex);
                if (index === -1) break;
                
                // Skip if it's inside a string literal
                const beforeMatch = searchLine.substring(0, index);
                const doubleQuoteCount = (beforeMatch.match(/"/g) || []).length;
                if (doubleQuoteCount % 2 === 1) {
                    startIndex = index + 1;
                    continue;
                }
                
                // Check word boundaries
                const prevChar = index > 0 ? searchLine[index - 1] : ' ';
                const nextChar = index + symbolName.length < searchLine.length ? searchLine[index + symbolName.length] : ' ';
                
                // Valid if surrounded by non-word characters (space, operators, etc.)
                if (!/[a-zA-Z0-9_]/.test(prevChar) && !/[a-zA-Z0-9_]/.test(nextChar)) {
                    // Additional check for common GPL patterns
                    const context = searchLine.substring(Math.max(0, index - 10), index + symbolName.length + 10).trim();
                    
                    // Include common usage patterns
                    const isValidUsage = (
                        /\bAs\s+New\s+\w+/i.test(context) ||           // "As New XmlStore"
                        /\bAs\s+\w+/i.test(context) ||                 // "As XmlStore"  
                        /\bNew\s+\w+/i.test(context) ||                // "New XmlStore"
                        /\w+\.\w+/.test(context) ||                    // "XmlStore.Method"
                        /^\s*\w+\s*=/.test(context) ||                 // Variable assignment
                        /\(\s*\w+/i.test(context) ||                   // Function call
                        searchLine.trim().startsWith('Public Class') || // Class definition
                        searchLine.trim().startsWith('Private Class')
                    );
                    
                    if (isValidUsage) {
                        usages.push({
                            line: i,
                            character: index
                        });
                    }
                }
                
                startIndex = index + 1;
            }
        }

        return usages;
    }
}
