// MCP 서버가 클라이언트(AI)에게 연결 시점에 건네는 사용 지침.
//
// initialize 응답의 `instructions` 필드로 나가므로, 도구 설명과 달리 **호출 전에** 읽힌다.
// 그래서 "도구를 어떻게 쓰나"가 아니라 "이 저장소에서 GPL 코드를 만질 때 지켜야 할 것"처럼
// 작업 시작 전에 알아야 할 규약을 담는다. 도구별 상세는 각 도구 description에 둔다.
//
// 길이 주의: 이 텍스트는 세션 내내 컨텍스트에 남는다. 규약과 근거만 남기고 예시는 최소로.

/**
 * GPL 소스를 새로 쓰거나 고칠 때의 문서화 주석 규약.
 * 확장(nir414.gpl-language-support)이 이 형식을 호버·자동완성·시그니처 도움말에 구조로 표시한다.
 * 형식 정의의 단일 출처는 확장의 src/language/docComment.ts.
 */
export const DOC_COMMENT_GUIDE = `## GPL 코드를 쓰거나 고칠 때 — 문서화 주석(Documentation Comment)

Public Sub/Function/Property를 새로 만들거나 시그니처를 바꾸면, 선언 **바로 위**에 \`'\` 주석으로
문서화 주석을 남긴다. VS Code 확장이 이 형식을 인식해 호버·자동완성·시그니처 도움말에 구조로 표시한다.

\`\`\`gpl
' 값을 지정된 범위로 제한합니다.
'
' # Parameters
' - \`value\`: 제한할 값
' - \`min\`: 최솟값
' - \`max\`: 최댓값
'
' # Returns
' 범위가 적용된 값
'
' # Examples
' \`\`\`
' result = Clamp(120, 0, 100)
' \`\`\`
Public Function Clamp(value As Number, min As Number, max As Number) As Number
\`\`\`

- **설명은 항상**, \`# Parameters\`는 매개변수가 있을 때, \`# Returns\`는 반환값이 있을 때만 쓴다.
  \`# Examples\`는 사용법 설명이 실제로 도움이 될 때만(선택).
- 매개변수 항목은 \`\`- \`이름\`: 설명\`\` 형식이고, 이름은 시그니처와 정확히 같아야 한다(대소문자 무시).
- 주석과 선언 사이에 **빈 줄을 두지 않는다** — 빈 줄이 있으면 그 선언에 붙지 않는다.
- 머리글은 \`# Parameters\` / \`# Returns\` / \`# Examples\` / \`# Remarks\`(한국어 \`# 매개변수\`·\`# 반환\`·
  \`# 예제\`·\`# 비고\`도 인식). 표에 없는 머리글(\`# Errors\` 등)을 써도 순서를 지켜 그대로 표시된다.
- 매개변수를 추가·삭제하면 문서화 주석도 함께 고친다(설명만 있고 항목이 빠진 주석은 오해를 만든다).
- 골격은 손으로 쓰지 않아도 된다: 편집기에서 선언 위에 \`'''\`를 입력하거나,
  \`extension_command('gpl.insertDocComment', { uri, line })\`로 만든다. 이미 주석이 있으면
  **빠진 항목만** 덧붙고 기존 설명은 보존된다.
- 기존 코드의 머리글 없는 평범한 주석은 그대로 두어도 된다(종전과 같이 표시된다). 손대는 김에
  형식을 맞추는 것은 좋지만, 무관한 파일을 일괄 변환하지는 않는다.`;

/** 서버가 무엇이고 무엇을 하지 말아야 하는지 — 도구 호출 전에 알아야 할 최소 규칙. */
const SERVER_OVERVIEW = `Brooks/Precise Automation PA 제어기(GPL)를 1402 ASCII 콘솔로 조작하는 서버다.

- 제어기와의 통신은 **이 서버의 도구로만** 한다. PowerShell/Node/Python으로 원시 TCP 소켓을 직접 열지 않는다
  (명령 직렬화 큐도 모션 안전 게이트도 없어 사고로 이어진다).
- 명령의 성공/실패는 응답의 \`<STATUS>\`를 \`</STATUS>\`까지 읽고 판정한다 — 로그 파일·침묵 같은 간접 신호로 추정하지 않는다.
- \`start_project\`·\`continue_thread\`·\`step_thread\`·\`set_variable\`은 모션을 유발할 수 있다. 실기 연결로 보이면 실행 전에 사용자 확인을 받는다.
- Start는 제어기가 자체 컴파일을 수행하므로 \`compile_project\` 직후 \`start_project\`를 연속으로 보내지 않는다.`;

/** initialize 응답의 instructions 본문. */
export const SERVER_INSTRUCTIONS = `${SERVER_OVERVIEW}\n\n${DOC_COMMENT_GUIDE}`;
