// AI 가 실행할 수 없는 확장 명령 — 확장 `src/controller/aiCommandPolicy.ts` 의 미러.
//
// 왜 여기에도 두는가: 차단의 정본은 확장(브리지·URI·명령 자체 3중)이지만, MCP 가 먼저 알고 있으면
//  ① 왕복 없이 즉시 거부하고 ② "왜 안 되는지·사람이 어떻게 하는지"를 도구 응답으로 바로 알려 준다.
//  ③ 확장이 꺼져 있어 direct-tcp 로 도는 경우에도 같은 규칙이 유지된다.
// 항목을 늘리거나 고칠 때는 확장 쪽 목록과 함께 갱신할 것(두 파일이 계약이다).
//
// 성격 구분: 이것은 "기다리면 안전해지는" 제어기 타이밍 조건(확장 commandPolicy.ts)이 아니라,
// 되돌릴 수 없는 부작용이 있어 **사람의 판단**이 필요한 명령의 목록이다.

/** @typedef {{ command: string, title: string, reason: string, humanPath: string }} AiBlockedCommand */

/** @type {readonly AiBlockedCommand[]} */
export const AI_BLOCKED_COMMANDS = Object.freeze([
  Object.freeze({
    command: 'gpl.saveToFlash',
    title: 'GPL: Save to Flash',
    reason: '제어기 flash 의 영구 사본(/flash/projects/<project>)을 미러 동기화로 덮어쓰고 로컬에 없는 원격 파일을 삭제한다 — '
      + '되돌릴 수 없고 flash 쓰기 수명을 소모하므로 사람이 판단해 실행할 명령이다.',
    humanPath: '사용자가 명령 팔레트의 "GPL: Save to Flash" 또는 탐색기/제어기 트리 컨텍스트 메뉴에서 직접 실행합니다.',
  }),
]);

/** 도구 응답의 오류 코드. */
export const AI_BLOCKED_ERROR = 'AI_BLOCKED';

/**
 * 명령 ID 가 차단 목록에 있으면 그 항목을 돌려준다(대소문자 무시 — 표기를 바꾼 우회를 막는다).
 * @param {string} command
 * @returns {AiBlockedCommand | undefined}
 */
export function findAiBlockedCommand(command) {
  const key = String(command ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return AI_BLOCKED_COMMANDS.find((c) => c.command.toLowerCase() === key);
}

/**
 * 거부 사유 한 문단 — 왜 막혔는지와 사람이 할 방법.
 * @param {AiBlockedCommand} entry
 */
export function aiBlockedDetail(entry) {
  return `'${entry.command}'(${entry.title})는 AI 가 실행할 수 없습니다. ${entry.reason} `
    + `${entry.humanPath} 필요하면 사용자에게 실행을 요청하세요 — 다른 표기나 우회 경로로 재시도하지 마세요.`;
}

/**
 * 차단 대상이면 도구가 그대로 돌려줄 결과 객체를, 아니면 null.
 * @param {string} command
 */
export function aiBlockedResult(command) {
  const entry = findAiBlockedCommand(command);
  if (!entry) return null;
  return {
    ok: false,
    sent: false,
    error: AI_BLOCKED_ERROR,
    command: entry.command,
    detail: aiBlockedDetail(entry),
    recommendedAction: '이 명령은 재시도하지 않는다. 사용자에게 직접 실행을 요청할 것.',
  };
}
