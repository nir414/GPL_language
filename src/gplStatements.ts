import { GplBlockContext, GplBlockKind, GplScope } from './language/blockContext';

/**
 * GPL 문(statement) 스니펫 · 키워드 정본 데이터 (vscode 비의존 순수 모듈).
 *
 * 출처는 공식 GPL Dictionary의 Statement Dictionary / Exception Handling 절이다
 * (각 항목의 `sourceUrl`). VB.NET과 다른 GPL 고유 구문을 그대로 반영한다:
 * - 반복 종결은 `End While`이다 (`Wend`가 아니다).
 * - 다중 분기는 `Select match_value` + `Case`다 (`Select Case`는 관용 표기).
 * - Property의 Set 절은 `Set (value As Integer)`처럼 괄호 절이 **필수**다.
 * - `Catch ex`의 예외 객체는 미리 `Dim ex As New Exception`으로 인스턴스화해야 한다.
 *
 * 스니펫 본문은 `\t`로 들여쓴다 — VS Code가 에디터의 탭/스페이스 설정에 맞춰 변환한다.
 */

const STATEMENT_BASE = 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Statement_Dictionary/';
const EXCEPTION_BASE = 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Exception_Handling/';

export interface GplStatementSnippet {
    /** 완성 목록에 보이는 이름. 키워드로 시작해야 접두사 입력으로 걸러진다. */
    label: string;
    /** 공식 문서의 구문 표기 한 줄. 완성 항목의 detail로 쓴다. */
    detail: string;
    /** 마크다운 설명. 문서와 다른 GPL 고유 규칙을 여기에 적는다. */
    documentation: string;
    /** 스니펫 본문 줄 배열 (`${1:...}` 등 VS Code 스니펫 문법). */
    body: string[];
    /** 제안할 스코프. 문서의 Prerequisites를 그대로 옮긴 것. */
    scopes: GplScope[];
    /** 이 블록이 열려 있을 때만 제안 (`Exit For` 등). */
    requiresOpen?: GplBlockKind;
    /** 이 블록이 이미 열려 있으면 제안하지 않는다 (Get 안에서 다시 Get 등). */
    forbidsOpen?: GplBlockKind;
    sourceUrl?: string;
}

/**
 * 문 스니펫 목록.
 *
 * 순서는 완성 목록 정렬에 쓰이지 않는다(라벨 기준으로 정렬). 읽기 편하도록
 * 제어 구조 → 선언 → 탈출/반환 순으로 묶어 둔다.
 */
export const GPL_STATEMENT_SNIPPETS: readonly GplStatementSnippet[] = [
    // ── 조건 분기 ────────────────────────────────────────────────
    {
        label: 'If ... Then ... End If',
        detail: 'If condition Then … End If',
        documentation: '조건이 True일 때 블록을 실행한다. 0이 아닌 모든 수치값이 True로 해석된다.',
        body: ['If ${1:condition} Then', '\t$0', 'End If'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'IfThenElse.htm'
    },
    {
        label: 'If ... Then ... Else ... End If',
        detail: 'If condition Then … Else … End If',
        documentation: '조건 분기와 기본 분기를 함께 만든다.',
        body: ['If ${1:condition} Then', '\t$2', 'Else', '\t$0', 'End If'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'IfThenElse.htm'
    },
    {
        label: 'ElseIf ... Then',
        detail: 'ElseIf elseif_condition Then',
        documentation: '앞선 If/ElseIf 조건이 모두 False일 때 검사할 조건을 추가한다.',
        body: ['ElseIf ${1:condition} Then', '\t$0'],
        scopes: ['procedure'],
        requiresOpen: 'if',
        sourceUrl: STATEMENT_BASE + 'ElseElseIf.htm'
    },
    {
        label: 'Else',
        detail: 'Else',
        documentation: '앞선 조건이 모두 False일 때 실행할 블록을 만든다.',
        body: ['Else', '\t$0'],
        scopes: ['procedure'],
        requiresOpen: 'if',
        sourceUrl: STATEMENT_BASE + 'ElseElseIf.htm'
    },
    {
        label: 'Select ... Case ... End Select',
        detail: 'Select match_value / Case test_expression / … / End Select',
        documentation: [
            '하나의 값을 여러 값과 차례로 비교해 첫 일치 블록만 실행한다.',
            '',
            'GPL 정본 표기는 `Select match_value`로, VB.NET처럼 `Case`를 붙이지 않는다.',
            '`match_value`는 수치 또는 String 식이며 한 번만 평가된다.'
        ].join('\n'),
        body: [
            'Select ${1:match_value}',
            '\tCase ${2:test_value}',
            '\t\t$0',
            '\tCase Else',
            '\t\t',
            'End Select'
        ],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'SelectCase.htm'
    },
    {
        label: 'Case ...',
        detail: 'Case test_expression, …, test_expression',
        documentation: 'Case 하나에 비교값을 콤마로 여러 개 나열할 수 있다.',
        body: ['Case ${1:test_value}', '\t$0'],
        scopes: ['procedure'],
        requiresOpen: 'select',
        sourceUrl: STATEMENT_BASE + 'Case.htm'
    },
    {
        label: 'Case Else',
        detail: 'Case Else',
        documentation: '어떤 Case에도 일치하지 않을 때 실행할 블록이다.',
        body: ['Case Else', '\t$0'],
        scopes: ['procedure'],
        requiresOpen: 'select',
        sourceUrl: STATEMENT_BASE + 'Case.htm'
    },

    // ── 반복 ────────────────────────────────────────────────────
    {
        label: 'For ... Next',
        detail: 'For variable = initial_value To final_value … Next variable',
        documentation: [
            '제어 변수를 1씩 늘리며 블록을 반복한다.',
            '',
            '`final_value`는 For 진입 시 한 번만 평가되어 저장되므로, 루프 안에서 상한식을',
            '바꿔도 반복 횟수는 변하지 않는다.'
        ].join('\n'),
        body: ['For ${1:i} = ${2:0} To ${3:count}', '\t$0', 'Next ${1:i}'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'ForNext.htm'
    },
    {
        label: 'For ... Step ... Next',
        detail: 'For variable = initial_value To final_value Step increment … Next variable',
        documentation: '증감량을 지정해 반복한다. 음수 Step이면 종료 조건도 반대로 판정된다.',
        body: ['For ${1:i} = ${2:0} To ${3:count} Step ${4:1}', '\t$0', 'Next ${1:i}'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'ForNext.htm'
    },
    {
        label: 'While ... End While',
        detail: 'While condition … End While',
        documentation: [
            '조건이 True인 동안 블록을 반복한다. 조건은 진입 시점에 먼저 검사하므로',
            '처음부터 False면 한 번도 실행되지 않는다.',
            '',
            'GPL의 종결어는 `End While`이다 — `Wend`는 정본 문법이 아니다.'
        ].join('\n'),
        body: ['While ${1:condition}', '\t$0', 'End While'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'WhileEnd.htm'
    },
    {
        label: 'Do While ... Loop',
        detail: 'Do While condition … Loop',
        documentation: '조건을 먼저 검사하는 반복. 조건이 처음부터 False면 실행되지 않는다.',
        body: ['Do While ${1:condition}', '\t$0', 'Loop'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'DoLoop.htm'
    },
    {
        label: 'Do Until ... Loop',
        detail: 'Do Until condition … Loop',
        documentation: '조건이 True가 될 때까지 반복한다. 조건을 먼저 검사한다.',
        body: ['Do Until ${1:condition}', '\t$0', 'Loop'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'DoLoop.htm'
    },
    {
        label: 'Do ... Loop While',
        detail: 'Do … Loop While condition',
        documentation: '블록을 먼저 실행하고 조건을 검사한다 — 최소 한 번은 실행된다.',
        body: ['Do', '\t$0', 'Loop While ${1:condition}'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'DoLoop.htm'
    },
    {
        label: 'Do ... Loop Until',
        detail: 'Do … Loop Until condition',
        documentation: '블록을 먼저 실행하고 조건이 True가 되면 종료한다 — 최소 한 번은 실행된다.',
        body: ['Do', '\t$0', 'Loop Until ${1:condition}'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'DoLoop.htm'
    },

    // ── 예외 처리 ────────────────────────────────────────────────
    {
        label: 'Try ... Catch ... End Try',
        detail: 'Try … Catch exception_object … End Try',
        documentation: [
            '블록 실행 중의 예외를 잡아 스레드 종료 없이 처리한다.',
            '',
            '`Catch`의 예외 객체는 **미리 인스턴스화되어 있어야** 한다:',
            '',
            '```gpl',
            'Dim ex As New Exception',
            '```',
            '',
            'DataID 307("Break on exception code")이 설정되어 있거나 GDE에서',
            '"Break on exception"으로 시작했다면 Try 구조는 무시된다(디버깅용 동작).'
        ].join('\n'),
        body: ['Try', '\t$0', 'Catch ${1:ex}', '\t', 'End Try'],
        scopes: ['procedure'],
        sourceUrl: EXCEPTION_BASE + 'trycatchfinally.htm'
    },
    {
        label: 'Try ... Catch ... Finally ... End Try',
        detail: 'Try … Catch exception_object … Finally … End Try',
        documentation: [
            '예외 처리와 정리(cleanup) 블록을 함께 만든다. `Finally` 블록은 예외 발생 여부와',
            '무관하게 실행된다.',
            '',
            '`Catch`의 예외 객체는 미리 `Dim ex As New Exception`으로 인스턴스화해야 한다.'
        ].join('\n'),
        body: ['Try', '\t$0', 'Catch ${1:ex}', '\t', 'Finally', '\t', 'End Try'],
        scopes: ['procedure'],
        sourceUrl: EXCEPTION_BASE + 'trycatchfinally.htm'
    },
    {
        label: 'Catch ...',
        detail: 'Catch exception_object',
        documentation: '예외를 받을 Exception 객체를 지정한다. 객체는 미리 `New`로 인스턴스화해야 한다.',
        body: ['Catch ${1:ex}', '\t$0'],
        scopes: ['procedure'],
        requiresOpen: 'try',
        sourceUrl: EXCEPTION_BASE + 'catch_try.htm'
    },
    {
        label: 'Finally',
        detail: 'Finally',
        documentation: '예외 발생 여부와 무관하게 마지막에 실행되는 정리 블록이다.',
        body: ['Finally', '\t$0'],
        scopes: ['procedure'],
        requiresOpen: 'try',
        sourceUrl: EXCEPTION_BASE + 'finally_try.htm'
    },

    // ── 선언 ────────────────────────────────────────────────────
    {
        label: 'Module ... End Module',
        detail: 'Module module_name … End Module',
        documentation: [
            '모듈 정의. 모든 변수·프로시저·클래스는 Module 또는 Class 안에 있어야 한다.',
            '',
            'Module은 파일 최상위에만 선언할 수 있고, 모듈 레벨 변수는 암묵적으로 Shared다.'
        ].join('\n'),
        body: ['Module ${1:ModuleName}', '\t$0', 'End Module'],
        scopes: ['file'],
        sourceUrl: STATEMENT_BASE + 'Module.htm'
    },
    {
        label: 'Class ... End Class',
        detail: '[Public | Private] Class class_name … End Class',
        documentation: [
            '클래스 정의. 파일 최상위, Module 안, 다른 Class 안에 선언할 수 있다.',
            '',
            '접근 수식어를 생략하면 **Private**이 기본이다. `Friend`/`Protected`는 지원되지 않는다.'
        ].join('\n'),
        body: ['Public Class ${1:ClassName}', '\t$0', 'End Class'],
        scopes: ['file', 'type'],
        sourceUrl: STATEMENT_BASE + 'Class.htm'
    },
    {
        label: 'Sub ... End Sub',
        detail: '[Public | Private | Shared] Sub subroutine_name([parameter_list]) … End Sub',
        documentation: [
            '반환값이 없는 프로시저를 정의한다. Module 또는 Class 안에만 선언할 수 있고',
            '프로시저 안에 프로시저를 넣을 수 없다.',
            '',
            '매개변수는 `[ByVal | ByRef] name As type` 형식이며 기본은 ByVal이다.'
        ].join('\n'),
        body: ['Public Sub ${1:Name}(${2})', '\t$0', 'End Sub'],
        scopes: ['type'],
        sourceUrl: STATEMENT_BASE + 'Sub.htm'
    },
    {
        label: 'Function ... End Function',
        detail: '[Public | Private | Shared] Function function_name([parameter_list]) As type … End Function',
        documentation: [
            '반환값이 있는 프로시저를 정의한다. 반환은 `Return value` 또는 함수 이름에 대입한다.',
            '',
            '원시 타입 키워드: `Boolean`, `Byte`, `Double`, `Integer`, `Short`, `Single`.',
            '클래스 이름을 쓰면 객체 변수가 된다.'
        ].join('\n'),
        body: ['Public Function ${1:Name}(${2}) As ${3:Integer}', '\t$0', '\tReturn ${4:0}', 'End Function'],
        scopes: ['type'],
        sourceUrl: STATEMENT_BASE + 'Function.htm'
    },
    {
        label: 'Property (Get/Set) ... End Property',
        detail: '[Public | Private | Shared] Property property_name([parameter_list]) As type … End Property',
        documentation: [
            '읽기·쓰기 Property를 정의한다. Property는 **Class 안에서만** 선언할 수 있다.',
            '',
            'GPL의 `Set` 절은 `Set (value As Integer)`처럼 **괄호 절이 필수**이고, 그 타입은',
            'Property 타입과 정확히 같아야 한다(VB.NET과 다른 점).'
        ].join('\n'),
        body: [
            'Public Property ${1:Name} As ${2:Integer}',
            '\tGet',
            '\t\tReturn ${3:m_value}',
            '\tEnd Get',
            '\tSet (value As ${2:Integer})',
            '\t\t${3:m_value} = value',
            '\tEnd Set',
            'End Property'
        ],
        scopes: ['type'],
        sourceUrl: STATEMENT_BASE + 'Property.htm'
    },
    {
        label: 'Property (ReadOnly) ... End Property',
        detail: 'Public ReadOnly Property property_name As type … End Property',
        documentation: [
            '읽기 전용 Property. `ReadOnly`를 붙이면 `Set` 절을 둘 수 없다.',
            '',
            'Get 블록은 Property와 같은 이름의 변수에 대입하거나 `Return`으로 값을 돌려준다.'
        ].join('\n'),
        body: [
            'Public ReadOnly Property ${1:Name} As ${2:Integer}',
            '\tGet',
            '\t\tReturn $0',
            '\tEnd Get',
            'End Property'
        ],
        scopes: ['type'],
        sourceUrl: STATEMENT_BASE + 'Property.htm'
    },
    {
        label: 'Get ... End Get',
        detail: 'Get … End Get',
        documentation: 'Property 안의 읽기 절. `WriteOnly` Property에는 둘 수 없다.',
        body: ['Get', '\t$0', 'End Get'],
        scopes: ['procedure'],
        requiresOpen: 'property',
        forbidsOpen: 'get',
        sourceUrl: STATEMENT_BASE + 'Get.htm'
    },
    {
        label: 'Set ... End Set',
        detail: 'Set (parameter_name As type) … End Set',
        documentation: [
            'Property 안의 쓰기 절. GPL은 괄호 절이 **필수**이며 타입이 Property 타입과',
            '같아야 한다. `ReadOnly` Property에는 둘 수 없다.'
        ].join('\n'),
        body: ['Set (${1:value} As ${2:Integer})', '\t$0', 'End Set'],
        scopes: ['procedure'],
        requiresOpen: 'property',
        forbidsOpen: 'set',
        sourceUrl: STATEMENT_BASE + 'Set.htm'
    },
    {
        label: 'Dim ... As ...',
        detail: '[Public | Private | Shared] Dim variable_name As type [= init]',
        documentation: [
            '변수를 선언한다. Class·Module·프로시저 안에서만 쓸 수 있고, 프로시저 안에서는',
            '`Public`/`Private`을 붙일 수 없다.',
            '',
            '배열은 `name(dim_1 [, dim_2 …])` 형식으로 최대 4차원까지 선언한다.'
        ].join('\n'),
        body: ['Dim ${1:name} As ${2:Integer}'],
        scopes: ['type', 'procedure'],
        sourceUrl: STATEMENT_BASE + 'Dim.htm'
    },
    {
        label: 'Dim ... As New ...',
        detail: 'Dim variable_name As New type',
        documentation: [
            '객체 변수를 선언하면서 데이터 영역까지 함께 생성한다.',
            '',
            '`Catch`로 받을 Exception 객체나 Location·Profile 같은 내장 클래스 객체는',
            '`New` 없이 쓰면 참조가 Nothing이라 런타임 예외가 된다.'
        ].join('\n'),
        body: ['Dim ${1:name} As New ${2:Location}'],
        scopes: ['type', 'procedure'],
        sourceUrl: STATEMENT_BASE + 'Dim.htm'
    },
    {
        label: 'Dim (array)',
        detail: 'Dim variable_name(dim_1 [, dim_2 …]) As type',
        documentation: '배열 변수를 선언한다. 괄호 안의 값은 각 차원의 **최대 인덱스**이며 최대 4차원이다.',
        body: ['Dim ${1:name}(${2:9}) As ${3:Integer}'],
        scopes: ['type', 'procedure'],
        sourceUrl: STATEMENT_BASE + 'Dim.htm'
    },
    {
        label: 'Const ... As ... = ...',
        detail: '[Public | Private] [Dim] Const variable_name As type = init',
        documentation: [
            '읽기 전용 변수를 선언한다. 타입은 원시 타입 또는 String이어야 하고, 초기값은',
            '상수식(수치/String 상수, 다른 Const, 내장 함수)이어야 한다.',
            '',
            '한 Const 문에는 변수 하나만 선언할 수 있다. 클래스 안의 Const는 암묵적 Shared다.'
        ].join('\n'),
        body: ['Const ${1:NAME} As ${2:Integer} = ${3:0}'],
        scopes: ['type', 'procedure'],
        sourceUrl: STATEMENT_BASE + 'Const.htm'
    },
    {
        label: 'ReDim ...',
        detail: 'ReDim variable_name (dim_1 [, dim_2 …])',
        documentation: [
            '이미 선언된 배열의 상한을 바꾼다. 차원 수는 바꿀 수 없다.',
            '',
            '`Preserve` 없이 실행하면 **기존 내용이 사라진다**.'
        ].join('\n'),
        body: ['ReDim ${1:name}(${2:10})'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'redim.htm'
    },
    {
        label: 'ReDim Preserve ...',
        detail: 'ReDim Preserve variable_name (dim_1 [, dim_2 …])',
        documentation: [
            '기존 내용을 유지하면서 배열 크기를 바꾼다.',
            '',
            '`Preserve`를 쓰면 마지막(가장 오른쪽) 차원 외에는 크기를 바꿀 수 없다.'
        ].join('\n'),
        body: ['ReDim Preserve ${1:name}(${2:10})'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'redim.htm'
    },
    {
        label: 'Delegate Sub ...',
        detail: '[Public | Private] Delegate Sub delegate_name([parameter_list])',
        documentation: [
            'Sub를 간접 호출하기 위한 Delegate 클래스를 정의한다. Module 또는 Class 레벨에',
            '둘 수 있고, 객체 생성 시 `AddressOf` 연산자를 쓴다.'
        ].join('\n'),
        body: ['Public Delegate Sub ${1:Name}(${2})'],
        scopes: ['type'],
        sourceUrl: STATEMENT_BASE + 'Delegate.htm'
    },
    {
        label: 'Delegate Function ...',
        detail: '[Public | Private] Delegate Function delegate_name([parameter_list]) As type',
        documentation: [
            'Function을 간접 호출하기 위한 Delegate 클래스를 정의한다. 연결할 프로시저의',
            '매개변수 개수·타입과 반환 타입이 정확히 일치해야 한다.'
        ].join('\n'),
        body: ['Public Delegate Function ${1:Name}(${2}) As ${3:Integer}'],
        scopes: ['type'],
        sourceUrl: STATEMENT_BASE + 'Delegate.htm'
    },

    // ── 흐름 제어 (한 줄) ─────────────────────────────────────────
    {
        label: 'Return',
        detail: 'Return [value]',
        documentation: '프로시저 실행을 끝내고 호출자로 돌아간다. Function/Property에서는 값을 함께 돌려준다.',
        body: ['Return ${0}'],
        scopes: ['procedure'],
        sourceUrl: STATEMENT_BASE + 'Return.htm'
    },
    {
        label: 'Exit For',
        detail: 'Exit For',
        documentation: '가장 안쪽 For 루프를 빠져나온다.',
        body: ['Exit For'],
        scopes: ['procedure'],
        requiresOpen: 'for',
        sourceUrl: STATEMENT_BASE + 'Exit.htm'
    },
    {
        label: 'Exit While',
        detail: 'Exit While',
        documentation: '가장 안쪽 While 루프를 빠져나온다.',
        body: ['Exit While'],
        scopes: ['procedure'],
        requiresOpen: 'while',
        sourceUrl: STATEMENT_BASE + 'Exit.htm'
    },
    {
        label: 'Exit Do',
        detail: 'Exit Do',
        documentation: '가장 안쪽 Do 루프를 빠져나온다.',
        body: ['Exit Do'],
        scopes: ['procedure'],
        requiresOpen: 'do',
        sourceUrl: STATEMENT_BASE + 'Exit.htm'
    },
    {
        label: 'Exit Select',
        detail: 'Exit Select',
        documentation: '실행 중인 Select 구조를 빠져나온다.',
        body: ['Exit Select'],
        scopes: ['procedure'],
        requiresOpen: 'select',
        sourceUrl: STATEMENT_BASE + 'Exit.htm'
    },
    {
        label: 'Exit Try',
        detail: 'Exit Try',
        documentation: 'Try 구조를 빠져나온다. Finally 블록은 그대로 실행된다.',
        body: ['Exit Try'],
        scopes: ['procedure'],
        requiresOpen: 'try',
        sourceUrl: EXCEPTION_BASE + 'exit_try.htm'
    },
    {
        label: 'Exit Sub',
        detail: 'Exit Sub',
        documentation: 'Sub 실행을 끝내고 호출자로 돌아간다.',
        body: ['Exit Sub'],
        scopes: ['procedure'],
        requiresOpen: 'sub',
        sourceUrl: STATEMENT_BASE + 'Exit.htm'
    },
    {
        label: 'Exit Function',
        detail: 'Exit Function',
        documentation: 'Function 실행을 끝낸다. 반환값은 함수 이름 변수에 대입된 값이다.',
        body: ['Exit Function'],
        scopes: ['procedure'],
        requiresOpen: 'function',
        sourceUrl: STATEMENT_BASE + 'Exit.htm'
    },
    {
        label: 'Exit Property',
        detail: 'Exit Property',
        documentation: 'Property 절 실행을 끝낸다.',
        body: ['Exit Property'],
        scopes: ['procedure'],
        requiresOpen: 'property',
        sourceUrl: STATEMENT_BASE + 'Exit.htm'
    }
];

/** 완성 목록에 올리는 키워드 종류. 항목 아이콘/설명 구분에 쓴다. */
export type GplKeywordKind = 'keyword' | 'type' | 'operator' | 'constant';

export interface GplKeyword {
    name: string;
    kind: GplKeywordKind;
    detail: string;
}

/**
 * GPL 키워드 · 원시 타입 · 낱말 연산자 목록.
 *
 * 문 스니펫이 커버하지 못하는 위치(문 중간, `As` 뒤, 조건식 안 등)에서 쓰인다.
 * 낱말 연산자는 공식 "Arithmetic Expressions" 우선순위 표를 근거로 한다.
 */
export const GPL_KEYWORDS: readonly GplKeyword[] = [
    // 원시 타입 (Sub/Function/Dim 문서의 primitive type keywords)
    { name: 'Boolean', kind: 'type', detail: '원시 타입 — True/False' },
    { name: 'Byte', kind: 'type', detail: '원시 타입 — 8비트 정수' },
    { name: 'Short', kind: 'type', detail: '원시 타입 — 16비트 정수' },
    { name: 'Integer', kind: 'type', detail: '원시 타입 — 32비트 정수' },
    { name: 'Single', kind: 'type', detail: '원시 타입 — 단정도 실수' },
    { name: 'Double', kind: 'type', detail: '원시 타입 — 배정도 실수' },
    { name: 'String', kind: 'type', detail: '문자열 클래스' },

    // 선언 수식어
    { name: 'Public', kind: 'keyword', detail: '외부 접근 허용' },
    { name: 'Private', kind: 'keyword', detail: '정의된 Module/Class 안에서만 접근 (기본값)' },
    { name: 'Shared', kind: 'keyword', detail: '모든 스레드가 공유하는 단일 복사본' },
    { name: 'ReadOnly', kind: 'keyword', detail: 'Property에 Set 절을 두지 않음' },
    { name: 'WriteOnly', kind: 'keyword', detail: 'Property에 Get 절을 두지 않음' },
    { name: 'ByVal', kind: 'keyword', detail: '값 전달 (매개변수 기본값)' },
    { name: 'ByRef', kind: 'keyword', detail: '참조 전달 — 호출자의 값이 바뀐다' },
    { name: 'New', kind: 'keyword', detail: '객체 데이터 영역 생성' },
    { name: 'AddressOf', kind: 'keyword', detail: 'Delegate 객체에 넣을 프로시저 주소' },
    { name: 'Preserve', kind: 'keyword', detail: 'ReDim 시 기존 배열 내용 유지' },
    { name: 'As', kind: 'keyword', detail: '타입 지정' },
    { name: 'To', kind: 'keyword', detail: 'For 루프 상한' },
    { name: 'Step', kind: 'keyword', detail: 'For 루프 증감량' },
    { name: 'Then', kind: 'keyword', detail: 'If 조건 뒤' },

    // 낱말 연산자
    { name: 'And', kind: 'operator', detail: '논리/비트 AND (모든 항 평가)' },
    { name: 'AndAlso', kind: 'operator', detail: '논리 AND (결과가 정해지면 평가 중단)' },
    { name: 'Or', kind: 'operator', detail: '논리/비트 OR (모든 항 평가)' },
    { name: 'OrElse', kind: 'operator', detail: '논리 OR (결과가 정해지면 평가 중단)' },
    { name: 'Xor', kind: 'operator', detail: '논리/비트 XOR' },
    { name: 'Not', kind: 'operator', detail: '논리 NOT — False(0)↔True(-1)' },
    { name: 'Mod', kind: 'operator', detail: '나머지 — `x Mod y`' },
    { name: 'Is', kind: 'operator', detail: '객체 참조 동일성 — `obj Is Nothing`' },

    // 상수
    { name: 'True', kind: 'constant', detail: '참 (-1)' },
    { name: 'False', kind: 'constant', detail: '거짓 (0)' },
    { name: 'Nothing', kind: 'constant', detail: '객체 참조 없음' }
];

/**
 * 현재 블록 컨텍스트에서 제안할 문 스니펫만 골라낸다.
 *
 * - `scopes`에 현재 스코프가 없으면 제외한다 (문서의 Prerequisites를 그대로 반영).
 * - `requiresOpen`이 있으면 해당 블록이 실제로 열려 있을 때만 제안한다.
 *   Get/Set과 Exit Sub/Function/Property는 Property/Sub/Function 블록 안이어야 하므로
 *   `openBlocks`를 그대로 검사한다.
 */
export function getApplicableStatements(
    context: GplBlockContext,
    snippets: readonly GplStatementSnippet[] = GPL_STATEMENT_SNIPPETS
): GplStatementSnippet[] {
    const open = new Set(context.openBlocks);
    return snippets.filter(s => {
        if (!s.scopes.includes(context.scope)) {
            return false;
        }
        if (s.requiresOpen && !open.has(s.requiresOpen)) {
            return false;
        }
        if (s.forbidsOpen && open.has(s.forbidsOpen)) {
            return false;
        }
        return true;
    });
}
