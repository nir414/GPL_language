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
    /** True when this symbol is declared inside a Sub/Function/Property body (not indexed in workspace cache by default). */
    isLocal?: boolean;
    /** True when this symbol represents a procedure parameter. */
    isParameter?: boolean;
    parameters?: string[];
    returnType?: string;
    value?: string;
    isXmlRelated?: boolean;
    hasXmlIssues?: string[];
}

export interface GPLParseOptions {
    /** Include local Dim/Const/Static declarations inside Sub/Function/Property bodies. Default: false */
    includeLocals?: boolean;
    /** Include procedure parameters as variable symbols. Default: same as includeLocals */
    includeParameters?: boolean;
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
    static parseDocument(content: string, filePath: string, options?: GPLParseOptions): GPLSymbol[] {
        const symbols: GPLSymbol[] = [];
        const lines = content.split('\n');
        let currentModule: string | undefined;
        let currentClass: string | undefined;
        // Track whether we're inside a procedure block (Sub/Function/Property body).
        // We intentionally do NOT index local Dim variables as workspace symbols.
        let blockDepth = 0;

        const includeLocals = !!options?.includeLocals;
        const includeParameters = options?.includeParameters ?? includeLocals;

        const extractParamName = (param: string): { name?: string; type?: string } => {
            // Examples:
            // - "axis As Integer"
            // - "ByRef settings() As AxisZeroSetting"
            // - "Optional speed As Integer = 10"
            // - "robotArmList() As RobotArm"
            const cleaned = param
                .replace(/\b(ByVal|ByRef|Optional|ParamArray)\b/gi, '')
                .trim();

            const asMatch = cleaned.match(/\bAs\s+(\w+)/i);
            const type = asMatch ? asMatch[1] : undefined;

            const beforeAs = cleaned.split(/\bAs\b/i)[0].trim();
            if (!beforeAs) {
                return { type };
            }

            // The identifier is typically the last token before "As".
            const tokens = beforeAs.split(/\s+/).filter(Boolean);
            const last = tokens[tokens.length - 1] || '';
            const name = last.replace(/\(.*\)$/, '').replace(/[^A-Za-z0-9_]/g, '');
            return { name: name || undefined, type };
        };

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
                currentClass = classMatch[2];
                blockDepth = 0;
                const isXmlRelated = this.isXmlRelatedIdentifier(classMatch[2]);
                const startIndex = line.indexOf(classMatch[2]);
                symbols.push({
                    name: classMatch[2],
                    kind: GPLSymbolKind.Class,
                    range: { start: startIndex, end: startIndex + classMatch[2].length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: classMatch[1] ? (classMatch[1].toLowerCase() as 'public' | 'private') : undefined,
                    isXmlRelated: isXmlRelated
                });
                continue;
            }

            // Check for End Class to reset currentClass
            if (trimmedLine.match(/^End\s+Class/i)) {
                currentClass = undefined;
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
                currentClass = undefined;
                blockDepth = 0;
                continue;
            }

            // Parse Function: token-based parsing to support any keyword order
            const functionMatch = trimmedLine.match(/\bFunction\s+(\w+)\s*\(([^)]*)\)(?:\s+As\s+(\w+))?/i);
            if (functionMatch && trimmedLine.match(/^\s*(?:(?:Public|Private|Friend|Shared)\s+)*Function\b/i)) {
                const name = functionMatch[1];
                const params = functionMatch[2] ? functionMatch[2].split(',').map(p => p.trim()) : [];
                const returnType = functionMatch[3];
                const isXmlRelated = this.isXmlRelatedIdentifier(name);
                const xmlIssues = this.detectXmlFunctionIssues(line, name, i, lines);
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
                    returnType: returnType,
                    isXmlRelated: isXmlRelated,
                    hasXmlIssues: xmlIssues.length > 0 ? xmlIssues : undefined
                });

                if (includeParameters && params.length > 0) {
                    for (const p of params) {
                        const { name: pName, type: pType } = extractParamName(p);
                        if (!pName) continue;

                        const re = new RegExp(`\\b${pName.replace(/[.*+?^${}()|[\[\]\\]/g, '\\$&')}\\b`, 'i');
                        const m = re.exec(line);
                        const pStart = m ? m.index : line.indexOf(pName);
                        symbols.push({
                            name: pName,
                            kind: GPLSymbolKind.Variable,
                            range: { start: Math.max(0, pStart), end: Math.max(0, pStart) + pName.length },
                            line: i,
                            filePath,
                            module: currentModule,
                            className: currentClass,
                            returnType: pType,
                            isLocal: true,
                            isParameter: true
                        });
                    }
                }

                // Enter function block: skip local Dim declarations inside
                blockDepth++;
                continue;
            }

            // Parse Sub: token-based parsing to support any keyword order
            const subMatch = trimmedLine.match(/\bSub\s+(\w+)\s*\(([^)]*)\)/i);
            if (subMatch && trimmedLine.match(/^\s*(?:(?:Public|Private|Shared)\b\s+)*Sub\b/i)) {
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

                if (includeParameters && params.length > 0) {
                    for (const p of params) {
                        const { name: pName, type: pType } = extractParamName(p);
                        if (!pName) continue;

                        const re = new RegExp(`\\b${pName.replace(/[.*+?^${}()|[\[\]\\]/g, '\\$&')}\\b`, 'i');
                        const m = re.exec(line);
                        const pStart = m ? m.index : line.indexOf(pName);
                        symbols.push({
                            name: pName,
                            kind: GPLSymbolKind.Variable,
                            range: { start: Math.max(0, pStart), end: Math.max(0, pStart) + pName.length },
                            line: i,
                            filePath,
                            module: currentModule,
                            className: currentClass,
                            returnType: pType,
                            isLocal: true,
                            isParameter: true
                        });
                    }
                }

                // Enter sub block: skip local Dim declarations inside
                blockDepth++;
                continue;
            }

            // Parse Property
            const propertyMatch = trimmedLine.match(/^(Public|Private)?\s*(Shared\s+)?Property\s+(\w+)\s+As\s+(\w+)/i);
            if (propertyMatch) {
                symbols.push({
                    name: propertyMatch[3],
                    kind: GPLSymbolKind.Property,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: propertyMatch[1] ? (propertyMatch[1].toLowerCase() as 'public' | 'private') : undefined,
                    isShared: !!propertyMatch[2],
                    returnType: propertyMatch[4]
                });

                // Enter property block (if it has Get/Set); End Property will decrement.
                blockDepth++;
                continue;
            }

            // When requested, parse local declarations inside procedures.
            if (blockDepth > 0 && includeLocals) {
                // Local Const ("Const X As Integer = 1")
                const localConstMatch = trimmedLine.match(/^Const\s+(\w+)\s+As\s+(\w+)/i);
                if (localConstMatch) {
                    const name = localConstMatch[1];
                    const startIndex = line.indexOf(name);
                    const eqIdx = trimmedLine.indexOf('=');
                    const constValue = eqIdx >= 0 ? trimmedLine.substring(eqIdx + 1).trim() : undefined;
                    symbols.push({
                        name,
                        kind: GPLSymbolKind.Constant,
                        range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                        line: i,
                        filePath,
                        module: currentModule,
                        className: currentClass,
                        returnType: localConstMatch[2],
                        value: constValue,
                        isLocal: true
                    });
                    continue;
                }

                // Local Dim/Static with New ("Dim x As New Foo")
                const localNewVariableMatch = trimmedLine.match(/^(Dim|Static)\s+(\w+)\s+As\s+New\s+(\w+)/i);
                if (localNewVariableMatch) {
                    const name = localNewVariableMatch[2];
                    const startIndex = line.indexOf(name);
                    symbols.push({
                        name,
                        kind: GPLSymbolKind.Variable,
                        range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                        line: i,
                        filePath,
                        module: currentModule,
                        className: currentClass,
                        returnType: localNewVariableMatch[3],
                        isLocal: true
                    });
                    continue;
                }

                // Local Dim/Static variable or Const with As ("Dim x As Integer", "Static x As Integer")
                const localVariableMatch = trimmedLine.match(/^(Dim|Static)\s+(Const\s+)?(\w+)\s*(\([^)]*\))?\s+As\s+(\w+)/i);
                if (localVariableMatch) {
                    const isConstant = !!localVariableMatch[2];
                    const name = localVariableMatch[3];
                    const startIndex = line.indexOf(name);
                    const isArray = !!localVariableMatch[4];
                    const type = localVariableMatch[5] + (isArray ? '[]' : '');
                    symbols.push({
                        name,
                        kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                        range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                        line: i,
                        filePath,
                        module: currentModule,
                        className: currentClass,
                        returnType: type,
                        isLocal: true
                    });
                    continue;
                }

                // Local array form ("Dim xs(10) As Foo")
                const localArrayMatch = trimmedLine.match(/^(Dim|Static)\s+(\w+)\s*\([^)]*\)\s+As\s+(\w+)/i);
                if (localArrayMatch) {
                    const name = localArrayMatch[2];
                    const startIndex = line.indexOf(name);
                    symbols.push({
                        name,
                        kind: GPLSymbolKind.Variable,
                        range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                        line: i,
                        filePath,
                        module: currentModule,
                        className: currentClass,
                        returnType: localArrayMatch[3] + '[]',
                        isLocal: true
                    });
                    continue;
                }
            }

            // Parse shared variable with New (e.g., "Public Shared Dim storeA As New XmlStore")
            if (blockDepth > 0) {
                // Local variables inside procedures are not indexed
                continue;
            }

            // Parse Const without Dim/Public/Private (e.g., "Const VariableID As Integer = 1869")
            const constMatch = trimmedLine.match(/^Const\s+(\w+)\s+As\s+(\w+)/i);
            if (constMatch) {
                const name = constMatch[1];
                const startIndex = line.indexOf(name);
                const eqIdx = trimmedLine.indexOf('=');
                const constValue = eqIdx >= 0 ? trimmedLine.substring(eqIdx + 1).trim() : undefined;
                symbols.push({
                    name,
                    kind: GPLSymbolKind.Constant,
                    range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: constMatch[2],
                    value: constValue
                });
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
                const eqIdx = trimmedLine.indexOf('=');
                const constValue = isConstant && eqIdx >= 0 ? trimmedLine.substring(eqIdx + 1).trim() : undefined;
                symbols.push({
                    name: sharedVariableMatch[3],
                    kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: sharedVariableMatch[4],
                    value: constValue
                });
                continue;
            }

            // Parse variable with New (e.g., "Dim storeA As New XmlStore", "Public Dim t As New Thread(...)")
            // MUST be checked BEFORE regular variable pattern
            const newVariableMatch = trimmedLine.match(/^(?:(Private|Public)\s+Dim|Private|Public|Dim)\s+(\w+)\s+As\s+New\s+(\w+)/i);
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

            // Parse Variable/Constant (e.g., "Public Dim x As Integer", "Private y As String", "Dim z As Double")
            const variableMatch = trimmedLine.match(/^(?:(Private|Public)\s+Dim|Private|Public|Dim)\s+(Const\s+)?(\w+)\s+As\s+(\w+)/i);
            if (variableMatch) {
                const isConstant = !!variableMatch[2];
                const eqIdx = trimmedLine.indexOf('=');
                const constValue = isConstant && eqIdx >= 0 ? trimmedLine.substring(eqIdx + 1).trim() : undefined;
                symbols.push({
                    name: variableMatch[3],
                    kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: variableMatch[4],
                    value: constValue
                });
                continue;
            }

            // Parse array variable (e.g., "Dim kvs(100) As KeyValue", "Public Dim kvs(100) As KeyValue")
            const arrayMatch = trimmedLine.match(/^(?:(Private|Public)\s+Dim|Private|Public|Dim)\s+(\w+)\s*\([^)]*\)\s+As\s+(\w+)/i);
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

    /**
     * XML 관련 식별자인지 확인
     */
    static isXmlRelatedIdentifier(name: string): boolean {
        const xmlPatterns = [
            /xml/i,
            /escape/i,
            /encode/i,
            /decode/i,
            /entity/i,
            /cdata/i
        ];
        
        return xmlPatterns.some(pattern => pattern.test(name));
    }

    /**
     * XML 함수에서 발생할 수 있는 문제들을 감지
     */
    static detectXmlFunctionIssues(line: string, functionName: string, lineIndex: number, allLines: string[]): string[] {
        const issues: string[] = [];
        
        // XML 이스케이프 관련 함수인지 확인
        if (!/escape.*xml|xml.*escape/i.test(functionName)) {
            return issues;
        }
        
        // 함수 본문 분석을 위해 몇 줄 더 읽기
        const functionBody = this.getFunctionBody(lineIndex, allLines);
        
        // O(n²) 성능 패턴 감지 (outStr = outStr & ... 패턴)
        if (/outStr\s*=\s*outStr\s*&/i.test(functionBody)) {
            issues.push('O(n²) 성능 이슈: 문자열 연결 시 StringBuilder 패턴 사용 권장');
        }
        
        // 재인코딩 위험 패턴 감지 (&amp; -> &amp;amp; 가능성)
        if (functionBody.includes('&amp;') && !functionBody.includes('DecodeEntities')) {
            issues.push('재인코딩 위험: 이미 인코딩된 입력에 대한 멱등성 고려 필요');
        }
        
        // 순서 문제 감지 (& 치환이 마지막에 있지 않은 경우)
        const ampPattern = functionBody.indexOf('&amp;');
        const otherEntityPattern = Math.max(
            functionBody.indexOf('&lt;'),
            functionBody.indexOf('&gt;'),
            functionBody.indexOf('&quot;'),
            functionBody.indexOf('&apos;')
        );
        
        if (ampPattern > -1 && otherEntityPattern > -1 && ampPattern > otherEntityPattern) {
            issues.push('엔티티 치환 순서 오류: & 문자를 다른 엔티티보다 먼저 처리해야 함');
        }
        
        // Null 체크 부족
        if (!functionBody.includes('Nothing') && !functionBody.includes('Is Nothing')) {
            issues.push('Null 안전성: Nothing 값에 대한 방어 코드 추가 권장');
        }
        
        return issues;
    }

    /**
     * 함수의 본문을 추출 (간단한 구현)
     */
    static getFunctionBody(startLine: number, lines: string[]): string {
        let body = '';
        let depth = 0;
        
        for (let i = startLine; i < Math.min(startLine + 50, lines.length); i++) {
            const line = lines[i].trim();
            
            if (line.match(/^(Function|Sub)/i)) {
                depth++;
            } else if (line.match(/^End\s+(Function|Sub)/i)) {
                depth--;
                if (depth === 0) break;
            }
            
            body += line + '\n';
        }
        
        return body;
    }
}
