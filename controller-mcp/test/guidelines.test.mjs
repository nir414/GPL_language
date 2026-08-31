import test from 'node:test';
import assert from 'node:assert/strict';
import { DOC_COMMENT_GUIDE, SERVER_INSTRUCTIONS } from '../src/guidelines.js';

// initialize 응답의 instructions로 나가는 지침 — 규약의 핵심 항목이 빠지면 AI가 형식을 지킬 근거를 잃는다.
// (실제 전달 경로는 index.js의 McpServer instructions + gpl://guidelines/doc-comment 리소스)

test('문서화 주석 규약: 형식의 핵심 요소가 모두 들어 있다', () => {
  for (const needle of ['# Parameters', '# Returns', '# Examples', '# Remarks']) {
    assert.ok(DOC_COMMENT_GUIDE.includes(needle), `${needle} 누락`);
  }
  // 예시 코드 블록(그대로 베껴 쓸 수 있어야 한다)
  assert.match(DOC_COMMENT_GUIDE, /Public Function Clamp\(/);
  assert.match(DOC_COMMENT_GUIDE, /- `value`: 제한할 값/);
});

test('문서화 주석 규약: 사용 조건과 함정을 명시한다', () => {
  assert.ok(DOC_COMMENT_GUIDE.includes('설명은 항상'), '설명 필수 규칙 누락');
  assert.ok(DOC_COMMENT_GUIDE.includes('빈 줄을 두지 않는다'), '주석-선언 사이 빈 줄 규칙 누락');
  assert.ok(/매개변수를 추가·삭제하면/.test(DOC_COMMENT_GUIDE), '시그니처 변경 시 갱신 규칙 누락');
});

test('문서화 주석 규약: 골격 생성 경로를 알려 준다', () => {
  assert.ok(DOC_COMMENT_GUIDE.includes("'''"), "''' 트리거 누락");
  assert.ok(DOC_COMMENT_GUIDE.includes('gpl.insertDocComment'), '명령 ID 누락');
});

test('중첩 백틱을 이스케이프가 아니라 이중 백틱으로 감싼다(마크다운 깨짐 방지)', () => {
  assert.ok(!DOC_COMMENT_GUIDE.includes('\\`'), '백슬래시로 이스케이프된 백틱이 남아 있다');
  assert.ok(DOC_COMMENT_GUIDE.includes('``- `이름`: 설명``'), '매개변수 항목 형식 설명 누락');
});

test('SERVER_INSTRUCTIONS: 제어기 안전 규칙과 코딩 규약을 함께 담는다', () => {
  assert.ok(SERVER_INSTRUCTIONS.includes('</STATUS>'), 'STATUS 판정 규칙 누락');
  assert.ok(SERVER_INSTRUCTIONS.includes('원시 TCP'), '원시 소켓 금지 규칙 누락');
  assert.ok(SERVER_INSTRUCTIONS.includes(DOC_COMMENT_GUIDE), '문서화 주석 규약이 포함되지 않았다');
  // 세션 내내 컨텍스트에 남는 텍스트 — 비대해지지 않게 상한을 둔다.
  assert.ok(SERVER_INSTRUCTIONS.length < 4000, `instructions가 너무 길다(${SERVER_INSTRUCTIONS.length}자)`);
});
