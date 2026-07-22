import { escapeRegExp, splitParameters } from './language/cursorExpression';

export interface GPLSymbol {
    name: string;
    kind: GPLSymbolKind;
    range: { start: number; end: number };
    line: number;
    filePath: string;
    module?: string;
    className?: string;
    /** 중첩 클래스일 때 감싸는 바깥 클래스 이름 (예: ZeroPlan > StepBatch면 StepBatch의 parent는 ZeroPlan). */
    parentClassName?: string;
    accessModifier?: 'public' | 'private';
    isShared?: boolean;
    /** True when this symbol is declared inside a Sub/Function/Property body (not indexed in workspace cache by default). */
    isLocal?: boolean;
    /** True when this symbol represents a procedure parameter. */
    isParameter?: boolean;
    parameters?: string[];
    /**
     * Leading `'` doc-comment block that appears immediately above the declaration
     * (no blank line in between). Lines are joined with '\n' with the leading quote
     * and one space stripped. Consumed by hover / completion / signature help to
     * describe user-defined Subs, Functions and Properties.
     */
    docComment?: string;
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
            // LRU 갱신: 히트한 키를 delete+set으로 맨 뒤(최신)로 옮겨 recency를 유지한다.
            GPLParser._parseCache.delete(key);
            GPLParser._parseCache.set(key, cached);
            // 캐시된 표준 배열은 보존하고, 호출부 변형으로부터 안전하도록 얕은 복사본을 돌려준다.
            // 주의: 얕은 복사라 심볼 "객체"들은 호출부끼리 공유된다 — 반드시 불변으로 취급할 것.
            return cached.symbols.slice();
        }

        const symbols = GPLParser.parseDocumentUncached(content, filePath, options);

        // LRU 방식으로 캐시 크기를 제한한다(가장 오래 사용되지 않은 키부터 제거).
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
        // 중첩 클래스 지원: End Class에서 바깥 클래스로 복귀하기 위한 스택.
        // (단일 변수만 쓰면 안쪽 End Class가 바깥 문맥까지 지워, 이후 멤버가 모듈 직속으로 오분류된다)
        const classStack: string[] = [];
        // Accumulates the contiguous leading `'` comment block for the *next* declaration.
        let pendingDoc: string[] = [];
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

            const asMatch = cleaned.match(/\bAs\s+(\w+)\s*(\(\s*,*\s*\))?/i);
            let type = asMatch ? asMatch[1] : undefined;
            const typeIsArray = !!(asMatch && asMatch[2]);

            const beforeAs = cleaned.split(/\bAs\b/i)[0].trim();
            if (!beforeAs) {
                if (type && typeIsArray) { type += '[]'; }
                return { type };
            }

            // The identifier is typically the last token before "As".
            const tokens = beforeAs.split(/\s+/).filter(Boolean);
            const last = tokens[tokens.length - 1] || '';
            // 배열 파라미터(`armList() As RobotArm` / `x As Integer()`)는 로컬 배열 Dim과
            // 동일하게 `Type[]`로 기록한다 — 호출부 인자 타입 추론(오버로드 해석)과
            // 멤버 접근의 배열 인식이 일관되도록. (소비처는 [] 접미사를 벗겨 요소 타입을 쓴다.)
            const nameIsArray = /\(.*\)$/.test(last);
            if (type && (typeIsArray || nameIsArray)) { type += '[]'; }
            const name = last.replace(/\(.*\)$/, '').replace(/[^A-Za-z0-9_]/g, '');
            return { name: name || undefined, type };
        };

        for (let li = 0; li < logicalLines.length; li++) {
            const i = logicalLines[li].line;
            const line = logicalLines[li].text;
            const trimmedLine = line.trim();
            
            // Capture the leading `'` doc-comment block; skip blank lines.
            // A contiguous run of comment lines directly above a declaration becomes
            // that symbol's docComment. A blank line breaks the run.
            if (trimmedLine.startsWith("'")) {
                pendingDoc.push(trimmedLine.replace(/^'+[ \t]?/, ''));
                continue;
            }
            if (trimmedLine === '') {
                pendingDoc = [];
                continue;
            }

            // Code line: consume any accumulated doc comment. Resetting here means a
            // comment block only attaches to the declaration that immediately follows it.
            const docComment = pendingDoc.length ? pendingDoc.join('\n') : undefined;
            pendingDoc = [];

            // Parse Module
            const moduleMatch = trimmedLine.match(/^Module\s+(\w+)/i);
            if (moduleMatch) {
                currentModule = moduleMatch[1];
                currentClass = undefined;
                classStack.length = 0;
                blockDepth = 0;
                const startIndex = GPLParser.findNameColumn(line, moduleMatch[1]);
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
                const parentClassName = classStack.length ? classStack[classStack.length - 1] : undefined;
                classStack.push(classMatch[2]);
                currentClass = classMatch[2];
                blockDepth = 0;
                const isXmlRelated = this.isXmlRelatedIdentifier(classMatch[2]);
                const startIndex = GPLParser.findNameColumn(line, classMatch[2]);
                symbols.push({
                    name: classMatch[2],
                    kind: GPLSymbolKind.Class,
                    range: { start: startIndex, end: startIndex + classMatch[2].length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    accessModifier: classMatch[1] ? (classMatch[1].toLowerCase() as 'public' | 'private') : undefined,
                    parentClassName,
                    isXmlRelated: isXmlRelated
                });
                continue;
            }

            // End Class: 스택을 pop해 바깥 클래스 문맥으로 복귀한다 (중첩 클래스 지원).
            if (trimmedLine.match(/^End\s+Class/i)) {
                classStack.pop();
                currentClass = classStack.length ? classStack[classStack.length - 1] : undefined;
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
                classStack.length = 0;
                blockDepth = 0;
                continue;
            }

            // Parse Function: token-based parsing to support any keyword order
            const functionMatch = trimmedLine.match(/\bFunction\s+(\w+)/i);
            if (functionMatch && trimmedLine.match(/^\s*(?:(?:Public|Private|Protected|Friend|Shared|Overrides|Overloads|Overridable|NotOverridable|MustOverride|Shadows|Partial)\b\s+)*Function\b/i)) {
                const name = functionMatch[1];
                // 주석/문자열을 무력화한 코드로 괄호 구간을 정해, 파라미터 텍스트는 원본에서
                // 잘라낸다(문자열 기본값 원문 보존). 종전 `(.*)` 캡처는 괄호/콤마가 든
                // 후행 `' 주석`까지 삼키는 문제가 있었다.
                const header = GPLParser.extractHeaderParts(trimmedLine, (functionMatch.index ?? 0) + functionMatch[0].length);
                // 최상위 콤마 기준 분리 — 공백뿐인 `( )`는 0개, 기본값 속 콤마는 분리하지 않는다.
                const params = splitParameters(header.paramText);
                // 반환 타입의 배열 접미사(`As Integer()`)는 파서의 배열 표기 규칙대로 `Integer[]`로 기록.
                const returnMatch = header.afterParams.match(/^\s*As\s+(\w+)\s*(\(\s*\))?/i);
                const returnType = returnMatch ? returnMatch[1] + (returnMatch[2] ? '[]' : '') : undefined;
                const isXmlRelated = this.isXmlRelatedIdentifier(name);
                const xmlIssues = this.detectXmlFunctionIssues(line, name, i, lines);
                const startIndex = GPLParser.findNameColumn(line, name);
                
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
                    hasXmlIssues: xmlIssues.length > 0 ? xmlIssues : undefined,
                    docComment
                });

                if (includeParameters && params.length > 0) {
                    // 파라미터는 여는 괄호 뒤에서 찾는다 — 프로시저 이름과 같은 이름(대소문자
                    // 무시)의 파라미터가 프로시저 이름 위치로 잡히지 않도록 (findNameColumn 참조).
                    const paramSearchFrom = line.indexOf('(', startIndex + name.length) + 1;
                    for (const p of params) {
                        const { name: pName, type: pType } = extractParamName(p);
                        if (!pName) continue;

                        const pStart = GPLParser.findNameColumn(line, pName, paramSearchFrom);
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
            const subMatch = trimmedLine.match(/\bSub\s+(\w+)/i);
            if (subMatch && trimmedLine.match(/^\s*(?:(?:Public|Private|Protected|Friend|Shared|Overrides|Overloads|Overridable|NotOverridable|MustOverride|Shadows|Partial)\b\s+)*Sub\b/i)) {
                const name = subMatch[1];
                // 주석 안전 괄호 구간에서 파라미터 추출(Function과 동일 — extractHeaderParts 참조).
                const subHeader = GPLParser.extractHeaderParts(trimmedLine, (subMatch.index ?? 0) + subMatch[0].length);
                // 최상위 콤마 기준 분리 — 공백뿐인 `( )`는 0개, 기본값 속 콤마는 분리하지 않는다.
                const params = splitParameters(subHeader.paramText);
                const startIndex = GPLParser.findNameColumn(line, name);
                
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
                    parameters: params,
                    docComment
                });

                if (includeParameters && params.length > 0) {
                    // 파라미터는 여는 괄호 뒤에서 찾는다 — 프로시저 이름과 같은 이름(대소문자
                    // 무시)의 파라미터가 프로시저 이름 위치로 잡히지 않도록 (findNameColumn 참조).
                    const paramSearchFrom = line.indexOf('(', startIndex + name.length) + 1;
                    for (const p of params) {
                        const { name: pName, type: pType } = extractParamName(p);
                        if (!pName) continue;

                        const pStart = GPLParser.findNameColumn(line, pName, paramSearchFrom);
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
            const propertyMatch = trimmedLine.match(/^((?:(?:Public|Private|Protected|Friend|Shared|ReadOnly|WriteOnly|Default|Overrides|Overridable|NotOverridable|MustOverride|Shadows|Overloads)\b\s+)*)Property\s+(\w+)(?:\s*\([^)]*\))?(?:\s+As\s+(\w+)\s*(\(\s*\))?)?/i);
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
                    // 배열 반환(`As Integer()`)은 `Integer[]`로 기록 — Function과 동일 규칙.
                    returnType: propertyMatch[3] ? propertyMatch[3] + (propertyMatch[4] ? '[]' : '') : undefined,
                    docComment
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
                    const startIndex = GPLParser.findNameColumn(line, name);
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
                    const startIndex = GPLParser.findNameColumn(line, name);
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
                    const startIndex = GPLParser.findNameColumn(line, name);
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
                    const startIndex = GPLParser.findNameColumn(line, name);
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

            if (blockDepth > 0) {
                // Local variables inside procedures are not indexed
                continue;
            }

            // Parse Const without Dim/Public/Private (e.g., "Const VariableID As Integer = 1869")
            const constMatch = trimmedLine.match(/^Const\s+(\w+)\s+As\s+(\w+)(?:\s*=\s*(.+))?/i);
            if (constMatch) {
                const name = constMatch[1];
                const startIndex = GPLParser.findNameColumn(line, name);
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
            // ── 클래스/모듈 멤버 변수·상수 선언 ──────────────────────────────
            // GPL은 수식어 순서가 자유롭다: "Public Shared Dim x"와 "Shared Public Dim x"
            // 모두 유효하므로 Sub/Function 매치와 같은 방식으로 수식어 나열을 통째로 허용한다.
            // bare "x As Integer"를 선언으로 오인하지 않도록 수식어 또는 Dim이 최소 하나 필요하다.
            // 공통 접두: ((수식어+ Dim?) | Dim) — 캡처 그룹 1에 수식어 문자열이 들어간다.
            const memberMods = (mods: string) => ({
                accessModifier: /\bPublic\b/i.test(mods) ? 'public' as const :
                    /\bPrivate\b/i.test(mods) ? 'private' as const : undefined,
                isShared: /\bShared\b/i.test(mods)
            });

            // New 포함 형 (e.g., "Public Shared Dim storeA As New XmlStore", "Dim t As New Thread(...)")
            // MUST be checked BEFORE regular variable pattern
            const newVariableMatch = trimmedLine.match(/^((?:(?:Private|Public|Protected|Friend|Shared)\s+)+(?:Dim\s+)?|Dim\s+)(\w+)\s+As\s+New\s+(\w+)/i);
            if (newVariableMatch) {
                symbols.push({
                    name: newVariableMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    ...memberMods(newVariableMatch[1]),
                    returnType: newVariableMatch[3]
                });
                continue;
            }

            // Variable/Constant (e.g., "Public Shared Dim echoMode As Boolean", "Shared Public Dim t As Thread = New Thread(...)")
            const variableMatch = trimmedLine.match(/^((?:(?:Private|Public|Protected|Friend|Shared)\s+)+(?:Dim\s+)?|Dim\s+)(Const\s+)?(\w+)\s+As\s+(\w+)(?:\s*=\s*(.+))?/i);
            if (variableMatch) {
                const isConstant = !!variableMatch[2];
                const varConstValue = isConstant ? variableMatch[5]?.trim() : undefined;
                symbols.push({
                    name: variableMatch[3],
                    kind: isConstant ? GPLSymbolKind.Constant : GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    ...memberMods(variableMatch[1]),
                    returnType: variableMatch[4],
                    value: varConstValue || undefined
                });
                continue;
            }

            // Array variable (e.g., "Dim kvs(100) As KeyValue", "Public Shared steps() As StepBatch")
            const arrayMatch = trimmedLine.match(/^((?:(?:Private|Public|Protected|Friend|Shared)\s+)+(?:Dim\s+)?|Dim\s+)(\w+)\s*\([^)]*\)\s+As\s+(\w+)/i);
            if (arrayMatch) {
                symbols.push({
                    name: arrayMatch[2],
                    kind: GPLSymbolKind.Variable,
                    range: { start: 0, end: line.length },
                    line: i,
                    filePath,
                    module: currentModule,
                    className: currentClass,
                    ...memberMods(arrayMatch[1]),
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

    /**
     * 라인에서 심볼 이름의 컬럼을 대소문자 무시 + 단어 경계로 찾는다.
     * 종전 `line.indexOf(name)`은 부분 문자열에 걸렸다(예: `Function Fun()`에서
     * `Fun`이 `Function` 안에서 먼저 매칭, `Static tic`의 `tic`이 `Static` 안에서 매칭).
     * fromIndex를 주면 그 위치부터 찾는다 — 파라미터는 여는 괄호 뒤부터 찾아
     * 프로시저와 같은 이름(대소문자 무시)이어도 프로시저 이름 위치에 걸리지 않는다.
     */
    private static findNameColumn(line: string, name: string, fromIndex = 0): number {
        const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
        re.lastIndex = Math.max(0, fromIndex);
        const m = re.exec(line);
        return m ? m.index : line.indexOf(name);
    }

    /**
     * 프로시저 헤더에서 파라미터 목록 `(...)` 구간과 그 뒤의 코드(반환 타입 절)를 찾는다.
     *
     * 주석/문자열을 무력화한 코드(stripToCode — 위치 보존)로 괄호 균형을 계산해 구간을
     * 정하고, 파라미터 텍스트는 "원본"에서 잘라낸다(문자열 기본값 `= "a,b"` 등 원문 보존).
     * afterParams는 주석이 제거된 코드이므로 반환 타입 매칭이 후행 주석에 속지 않는다.
     */
    private static extractHeaderParts(line: string, nameEndIndex: number): { paramText?: string; afterParams: string } {
        const code = GPLParser.stripToCode(line);

        // 이름 뒤 첫 비공백 문자가 '('일 때만 파라미터 목록으로 본다.
        let i = nameEndIndex;
        while (i < code.length && (code[i] === ' ' || code[i] === '\t')) {
            i++;
        }
        if (i >= code.length || code[i] !== '(') {
            return { afterParams: code.slice(nameEndIndex) };
        }

        const open = i;
        let depth = 0;
        let close = -1;
        for (let j = open; j < code.length; j++) {
            const ch = code[j];
            if (ch === '(') {
                depth++;
            } else if (ch === ')') {
                depth--;
                if (depth === 0) {
                    close = j;
                    break;
                }
            }
        }

        if (close < 0) {
            // 닫는 괄호가 없는 비정상 라인 — 주석 시작 전(code 길이)까지를 파라미터로 취급.
            return { paramText: line.slice(open + 1, code.length), afterParams: '' };
        }

        return { paramText: line.slice(open + 1, close), afterParams: code.slice(close + 1) };
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
