// 1402 명령 배치 실행 — 순수 로직(네트워크/MCP 무의존, node:test로 검증).
//
// 배경(GitHub #16): controller_command가 단건만 받아 DataID 30개 조회에 MCP 왕복 30회(호출당 고정 오버헤드 ≈1.5 s → 45 s)가
// 들었다. 제어기 왕복은 13~85 ms이므로 병목은 호출 횟수다. 서버가 배열을 받아 순차 실행하고 결과 배열을 한 번에 돌려주면 N→1.
//
// 설계 원칙:
//  - 반드시 순차(for-await). Promise.all 금지 — 1402는 단일 클라이언트 요청/응답 채널이라 겹치면 응답이 섞인다
//    (consoleClient의 직렬 체인이 있어도 배치 안의 순서 보장은 이 함수의 책임).
//  - runOne이 throw(타임아웃/연결 오류)해도 배치 전체를 죽이지 않고 그 항목에 { ok:false, error }를 기록한다.
//  - stopOnError=true면 첫 실패(ok=false 또는 throw) 항목에서 멈추고 stoppedAt(인덱스)을 기록한다. 기본은 계속.
//  - 안전 게이트(배포 잠금 등)는 runOne(=runCommand→sendGuarded) 안에서 항목별로 적용된다 — 여기서 우회하지 않는다.

/** 배치 크기 상한(MCP 응답 크기·클라이언트 타임아웃 고려). controller_command(commands) 기준. */
export const BATCH_MAX = 50;

/**
 * controller_command 입력 정규화: command(단건) 또는 commands(배치) 중 정확히 하나.
 * @param {{ command?: unknown, commands?: unknown }} input
 * @param {{ max?: number }} [opts]
 * @returns {{ mode: 'single', command: string } | { mode: 'batch', commands: string[] }}
 * @throws {Error} 둘 다/둘 다 없음/빈 항목/개수 초과 — 메시지에 고칠 방법을 적는다.
 */
export function normalizeCommandInput(input, { max = BATCH_MAX } = {}) {
  const hasSingle = input?.command !== undefined && input?.command !== null;
  const hasBatch = input?.commands !== undefined && input?.commands !== null;
  if (hasSingle && hasBatch) {
    throw new Error('command(단건)와 commands(배치)를 동시에 줄 수 없다 — 하나만 지정할 것.');
  }
  if (!hasSingle && !hasBatch) {
    throw new Error('command(단건 문자열) 또는 commands(문자열 배열, 1~' + max + '개) 중 하나가 필요하다.');
  }
  if (hasSingle) {
    const command = String(input.command).trim();
    if (!command) throw new Error('command가 비어 있다.');
    return { mode: 'single', command };
  }
  if (!Array.isArray(input.commands)) {
    throw new Error('commands는 문자열 배열이어야 한다(예: ["pd 2703", "pd 2704"]).');
  }
  if (input.commands.length === 0) throw new Error('commands가 빈 배열이다 — 1개 이상 필요.');
  if (input.commands.length > max) {
    throw new Error(`commands는 최대 ${max}개까지다(받은 개수 ${input.commands.length}). 나눠서 호출할 것.`);
  }
  const commands = input.commands.map((c, i) => {
    if (typeof c !== 'string') throw new Error(`commands[${i}]가 문자열이 아니다.`);
    const t = c.trim();
    if (!t) throw new Error(`commands[${i}]가 비어 있다(공백만).`);
    return t;
  });
  return { mode: 'batch', commands };
}

/**
 * 명령 배열을 **순차** 실행하고 결과 배열을 돌려준다.
 * @param {string[]} commands 1개 이상
 * @param {(command: string, index: number) => Promise<object>} runOne 한 건 실행(보통 runCommand). 반환 객체는
 *        `{ command, status, ok, data, hint? }` 형태를 기대하되 그대로 펼쳐 담는다.
 * @param {{ stopOnError?: boolean }} [opts]
 * @returns {Promise<{ count:number, okCount:number, failCount:number, stoppedAt?:number, skipped?:number,
 *   results: Array<{ index:number, command:string, ok:boolean, status?:object, data?:string, hint?:string, error?:string }> }>}
 */
export async function runBatch(commands, runOne, { stopOnError = false } = {}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('runBatch: commands는 1개 이상의 배열이어야 한다.');
  }
  if (typeof runOne !== 'function') throw new Error('runBatch: runOne 함수가 필요하다.');

  const results = [];
  let okCount = 0;
  let failCount = 0;
  let stoppedAt;
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    let item;
    try {
      const r = await runOne(command, index); // 순차: 다음 항목은 이 응답이 끝난 뒤에만 보낸다(1402 단일 채널).
      item = { index, command, ...(r && typeof r === 'object' ? r : { data: r }) };
      if (item.ok === undefined) item.ok = false;
    } catch (err) {
      item = { index, command, ok: false, error: err?.message ?? String(err) };
    }
    results.push(item);
    if (item.ok) okCount++;
    else failCount++;
    if (!item.ok && stopOnError) {
      stoppedAt = index;
      break;
    }
  }
  const out = { count: commands.length, okCount, failCount, results };
  if (stoppedAt !== undefined) {
    out.stoppedAt = stoppedAt;
    const skipped = commands.length - results.length;
    if (skipped > 0) out.skipped = skipped;
  }
  return out;
}
