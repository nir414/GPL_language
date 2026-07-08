import { escapeRegExp } from './language/cursorExpression';

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
    /** Initializer value for constants (e.g. "123" from "Const X As Integer = 123"). */
    value?: string;
    returnType?: string;
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
    // ── 파싱 결과 메모이즈 캐시 ──────────────────────────────────────────────
    // parseDocument는 (content, filePath, options)에 대한 순수 함수이므로,
    // 같은 내용/옵션이면 재파싱하지 않고 캐시 결과를 돌려준다.
    // hover/definition 등 핫패스에서 한 요청당 동일 문서를 여러 번 파싱하던
    // 비용(라인별 정규식 전체 재실행)을 제거한다.
    private static readonly _parseCacheMax = 32;
    private static readonly _parseCache = new Map<string, { content: string; symbols: GPLSymbol[] }>();

    static parseDocument(content: string, filePath: string, options?: GPLParseOptions): GPLSymbol[] {
        const includeLocals = !!options?.includeLocals;
        const includeParameters = options?.includeParameters ?? includeLocals;
        const key = `${filePath}::${includeLocals ? 1 : 0}${includeParameters ? 1 : 0}`;

        const cached = GPLParser._parseCache.get(key);
        if (cached && cached.content === content) {
            // 캐시된 표준 배열은 보존하고, 호출부 변형으로부터 안전하도록 얕은 복사본을 돌려준다.
            return cached.symbols.slice();
        }

        const symbols = GPLParser.parseDocumentUncached(content, filePath, options);

        // 단순 FIFO 방식으로 캐시 크기를 제한한다.
        if (GPLParser._parseCache.has(key)) {
            GPLParser._parseCache.delete(key);
        } else if (GPLParser._parseCache.size >= GPLParser._parseCacheMax) {
            const oldest = GPLParser._parseCache.keys().next().value;
            if (oldest !== undefined) {
                GPLParser._parseCache.delete(oldest);
            }
        }
        GPLParser._parseCache.set(key, { content, symbols });
        return symbols.slice();
    }

    private static parseDocumentUncached(content: string, filePath: string, options?: GPLParseOptions): GPLSymbol[] {
        const symbols: GPLSymbol[] = [];
        const lines = content.split('\n');
        // Merge VB line-continuation (`_`) sequences into single logical lines so that
        // multi-line Sub/Function/Property/declaration signatures are parsed correctly.
        // Each logical line keeps the physical line index of its first line so symbol
        // positions stay anchored to where the name actually appears.
        const logicalLines = GPLParser.buildLogicalLines(lines);
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

        for (let li = 0; li < logicalLines.length; li++) {
            const i = logicalLines[li].line;
            const line = logicalLines[li].text;
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
            // Use (.*) instead of ([^)]*) to handle array params like "armList() As RobotArm"
            const functionMatch = trimmedLine.match(/\bFunction\s+(\w+)(?:\s*\((.*)\))?(?:\s+As\s+(\w+))?/i);
            if (functionMatch && trimmedLine.match(/^\s*(?:(?:Public|Private|Protected|Friend|Shared|Overrides|Overloads|Overridable|NotOverridable|MustOverride|Shadows|Partial)\b\s+)*Function\b/i)) {
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

                        const re = new RegExp(`\\b${escapeRegExp(pName)}\\b`, 'i');
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
            // Use (.*) instead of ([^)]*) to handle array params like "armList() As RobotArm"
            const subMatch = trimmedLine.match(/\bSub\s+(\w+)(?:\s*\((.*)\))?/i);
            if (subMatch && trimmedLine.match(/^\s*(?:(?:Public|Private|Protected|Friend|Shared|Overrides|Overloads|Overridable|NotOverridable|MustOverride|Shadows|Partial)\b\s+)*Sub\b/i)) {
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

                        const re = new RegExp(`\\b${escapeRegExp(pName)}\\b`, 'i');
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

            // Parse Property — Sub/Function과 동일하게 수식어 순서를 가리지 않고 매칭한다.
            // (ReadOnly/WriteOnly/Default/Shared/Overrides 등이 Public/Private 뒤, Property 앞에 올 수 있다.
            //  이전 정규식은 ReadOnly/WriteOnly를 빠뜨려 `Public ReadOnly Property ...`를 놓쳤다.)
            const propertyMatch = trimmedLine.match(/^((?:(?:Public|Private|Protected|Friend|Shared|ReadOnly|WriteOnly|Default|Overrides|Overridable|NotOverridable|MustOverride|Shadows|Overloads)\b\s+)*)Property\s+(\w+)(?:\s*\([^)]*\))?(?:\s+As\s+(\w+))?/i);
            if (propertyMatch) {
                const propMods = propertyMatch[1] || '';
                const propAccess = /\bPublic\b/i.test(propMods)
                    ? 'public'
                    : (/\bPrivate\b/i.test(propMods) ? 'private' : undefined);
                symbols.push({
                    name: propertyMatch[2],
                    kind: GPLSymbolKind.Property,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: propAccess as 'public' | 'private' | undefined,
                    isShared: /\bShared\b/i.test(propMods),
                    returnType: propertyMatch[3]
                });

                // Enter property block (if it has Get/Set); End Property will decrement.
                blockDepth++;
                continue;
            }

            // When requested, parse local declarations inside procedures.
            if (blockDepth > 0 && includeLocals) {
                // Local Const ("Const X As Integer = 1")
                const localConstMatch = trimmedLine.match(/^Const\s+(\w+)\s+As\s+(\w+)(?:\s*=\s*(.+))?/i);
                if (localConstMatch) {
                    const name = localConstMatch[1];
                    const startIndex = line.indexOf(name);
                    const localConstValue = localConstMatch[3]?.trim();
                    symbols.push({
                        name,
                        kind: GPLSymbolKind.Constant,
                        range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                        line: i,
                        filePath,
                        module: currentModule,
                        className: currentClass,
                        returnType: localConstMatch[2],
                        value: localConstValue || undefined,
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
                const localVariableMatch = trimmedLine.match(/^(Dim|Static)\s+(Const\s+)?(\w+)\s*(\([^)]*\))?\s+As\s+(\w+)(?:\s*=\s*(.+))?/i);
                if (localVariableMatch) {
                    const isConstant = !!localVariableMatch[2];
                    const name = localVariableMatch[3];
                    const startIndex = line.indexOf(name);
                    const isArray = !!localVariableMatch[4];
                    const type = localVariableMatch[5] + (isArray ? '[]' : '');
                    const dimConstValue = isConstant ? localVariableMatch[6]?.trim() : undefined;
                    symbols.push({
                        name,
                        kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                        range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                        line: i,
                        filePath,
                        module: currentModule,
                        className: currentClass,
                        returnType: type,
                        value: dimConstValue || undefined,
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
            const constMatch = trimmedLine.match(/^Const\s+(\w+)\s+As\s+(\w+)(?:\s*=\s*(.+))?/i);
            if (constMatch) {
                const name = constMatch[1];
                const startIndex = line.indexOf(name);
                const rawValue = constMatch[3]?.trim();
                symbols.push({
                    name,
                    kind: GPLSymbolKind.Constant,
                    range: { start: Math.max(0, startIndex), end: Math.max(0, startIndex) + name.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    returnType: constMatch[2],
                    value: rawValue || undefined
                });
                continue;
            }
            const sharedNewVariableMatch = trimmedLine.match(/^(Private|Public)\s+Shared\s+(?:Dim\s+)?(\w+)\s+As\s+New\s+(\w+)/i);
            if (sharedNewVariableMatch) {
                symbols.push({
                    name: sharedNewVariableMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: sharedNewVariableMatch[1].toLowerCase() as 'public' | 'private',
                    isShared: true,
                    returnType: sharedNewVariableMatch[3]
                });
                continue;
            }

            // Parse shared variable/constant (e.g., "Public Shared Dim echoMode As Boolean", "Public Shared x As Integer")
            const sharedVariableMatch = trimmedLine.match(/^(Private|Public)\s+Shared\s+(?:Dim\s+)?(Const\s+)?(\w+)\s+As\s+(\w+)(?:\s*=\s*(.+))?/i);
            if (sharedVariableMatch) {
                const isConstant = !!sharedVariableMatch[2];
                const sharedConstValue = isConstant ? sharedVariableMatch[5]?.trim() : undefined;
                symbols.push({
                    name: sharedVariableMatch[3],
                    kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: sharedVariableMatch[1].toLowerCase() as 'public' | 'private',
                    isShared: true,
                    returnType: sharedVariableMatch[4],
                    value: sharedConstValue || undefined
                });
                continue;
            }

            // Parse shared array variable without Dim (e.g., "Public Shared steps() As StepBatch")
            const sharedArrayNoDimMatch = trimmedLine.match(/^(Private|Public)\s+Shared\s+(\w+)\s*\([^)]*\)\s+As\s+(\w+)/i);
            if (sharedArrayNoDimMatch) {
                symbols.push({
                    name: sharedArrayNoDimMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: sharedArrayNoDimMatch[1].toLowerCase() as 'public' | 'private',
                    isShared: true,
                    returnType: sharedArrayNoDimMatch[3] + '[]'
                });
                continue;
            }

            // Parse variable with New (e.g., "Dim storeA As New XmlStore", "Public Dim t As New Thread(...)")
            // MUST be checked BEFORE regular variable pattern
            const newVariableMatch = trimmedLine.match(/^(?:(Private|Public)\s+Dim|Private|Public|Dim)\s+(\w+)\s+As\s+New\s+(\w+)/i);
            if (newVariableMatch) {
                const upperLine = trimmedLine.toUpperCase();
                const accessModifier = upperLine.includes('PUBLIC') ? 'public' as const :
                    upperLine.includes('PRIVATE') ? 'private' as const : undefined;
                symbols.push({
                    name: newVariableMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier,
                    returnType: newVariableMatch[3]
                });
                continue;
            }

            // Parse Variable/Constant (e.g., "Public Dim x As Integer", "Private y As String", "Dim z As Double")
            const variableMatch = trimmedLine.match(/^(?:(Private|Public)\s+Dim|Private|Public|Dim)\s+(Const\s+)?(\w+)\s+As\s+(\w+)(?:\s*=\s*(.+))?/i);
            if (variableMatch) {
                const isConstant = !!variableMatch[2];
                const varConstValue = isConstant ? variableMatch[5]?.trim() : undefined;
                const upperLine = trimmedLine.toUpperCase();
                const accessModifier = upperLine.includes('PUBLIC') ? 'public' as const :
                    upperLine.includes('PRIVATE') ? 'private' as const : undefined;
                symbols.push({
                    name: variableMatch[3],
                    kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier,
                    returnType: variableMatch[4],
                    value: varConstValue || undefined
                });
                continue;
            }

            // Parse array variable (e.g., "Dim kvs(100) As KeyValue", "Public Dim kvs(100) As KeyValue")
            const arrayMatch = trimmedLine.match(/^(?:(Private|Public)\s+Dim|Private|Public|Dim)\s+(\w+)\s*\([^)]*\)\s+As\s+(\w+)/i);
            if (arrayMatch) {
                const upperLine = trimmedLine.toUpperCase();
                const accessModifier = upperLine.includes('PUBLIC') ? 'public' as const :
                    upperLine.includes('PRIVATE') ? 'private' as const : undefined;
                symbols.push({
                    name: arrayMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier,
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
        const symbolLower = symbolName.toLowerCase();
        const symbolLen = symbolName.length;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // 문자열 리터럴과 주석을 제거하여 순수 코드 영역만 추출.
            // 기존 indexOf("'") 방식은 "it's" 같은 문자열 내 아포스트로피를 잘못 처리.
            const searchLine = GPLParser.stripToCode(line);
            
            // 대소문자 무시 검색 (GPL/VB는 대소문자 무시 언어)
            const searchLineLower = searchLine.toLowerCase();
            let startIndex = 0;
            while (true) {
                const index = searchLineLower.indexOf(symbolLower, startIndex);
                if (index === -1) break;
                
                // Check word boundaries
                const prevChar = index > 0 ? searchLine[index - 1] : ' ';
                const nextChar = index + symbolLen < searchLine.length ? searchLine[index + symbolLen] : ' ';
                
                // Valid if surrounded by non-word characters
                if (!/[a-zA-Z0-9_]/.test(prevChar) && !/[a-zA-Z0-9_]/.test(nextChar)) {
                    usages.push({
                        line: i,
                        character: index
                    });
                }
                
                startIndex = index + 1;
            }
        }

        return usages;
    }

    /**
     * 코드에서 문자열 리터럴과 인라인 주석을 제거하여 순수 코드 부분만 반환.
     * 문자열은 공백으로, 주석 이후는 제거.
     */
    static stripToCode(line: string): string {
        let result = '';
        let inString = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inString) {
                if (ch === '"') {
                    // VB/GPL: "" 는 이스케이프된 따옴표
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        result += '  '; // 위치 보존
                        i++;
                        continue;
                    }
                    inString = false;
                }
                result += ' '; // 문자열 내부는 공백으로 대체
            } else {
                if (ch === '"') {
                    inString = true;
                    result += ' ';
                } else if (ch === "'") {
                    // 인라인 주석 시작 — 나머지 무시
                    break;
                } else {
                    result += ch;
                }
            }
        }
        return result;
    }

    /**
     * VB/GPL 줄 연속 문자(`_`)로 이어진 물리 줄들을 하나의 논리 줄로 병합한다.
     * 반환 항목은 병합된 텍스트와, 그 논리 줄이 시작된 물리 줄 인덱스(line)를 가진다.
     * 심볼 위치(line/column)는 이름이 실제로 등장하는 첫 물리 줄에 고정된다.
     */
    static buildLogicalLines(lines: string[]): { text: string; line: number }[] {
        const result: { text: string; line: number }[] = [];
        let i = 0;
        while (i < lines.length) {
            const startLine = i;
            let merged = lines[i];
            // 코드 영역이 ` _`(공백+밑줄)로 끝나는 동안 다음 줄을 이어 붙인다.
            while (GPLParser.endsWithLineContinuation(merged) && i + 1 < lines.length) {
                merged = GPLParser.stripTrailingContinuation(merged) + ' ' + lines[i + 1];
                i++;
            }
            result.push({ text: merged, line: startLine });
            i++;
        }
        return result;
    }

    /**
     * 해당 줄이 VB 줄 연속(`_`)으로 끝나는지 판별.
     * 규칙: 문자열/주석을 제외한 코드의 마지막 비공백 문자가 `_`이고,
     * 그 앞이 공백이어야 한다(식별자 끝의 `foo_`를 연속으로 오인하지 않도록).
     */
    static endsWithLineContinuation(rawLine: string): boolean {
        const code = GPLParser.stripToCode(rawLine).replace(/\s+$/, '');
        if (!code.endsWith('_')) {
            return false;
        }
        if (code.length === 1) {
            return true;
        }
        const prev = code[code.length - 2];
        return prev === ' ' || prev === '\t';
    }

    /**
     * 줄 끝의 연속 문자(`_`)와 주변 공백/CR을 제거해 병합 준비를 한다.
     */
    static stripTrailingContinuation(rawLine: string): string {
        return rawLine.replace(/\s+$/, '').replace(/_$/, '').replace(/\s+$/, '');
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
