// 1402 콘솔 응답 파서. 확장의 responseParser 규칙을 이식.
//
// 정상 응답 형식(예):
//   <DATA> ...본문... </DATA><STATUS>0,"Success"</STATUS>
//   <STATUS>-742,"*Compilation errors*"</STATUS>
// 컴파일 에러 라인:
//   ProtocolModule.gpl:478:(-760): *Invalid assignment*
//   ...:2934:(-742): *Compilation errors*: 4   ← 집계줄(개별 에러 아님)

/** <STATUS>code,"message"</STATUS> 추출. 없으면 code -9999(센티넬). */
export function parseStatus(raw) {
  const m = String(raw).match(/<STATUS>\s*(-?\d+)\s*,?\s*"?([^"<]*?)"?\s*<\/STATUS>/);
  if (!m) {
    return { code: -9999, message: 'No STATUS found', complete: false };
  }
  return { code: parseInt(m[1], 10), message: m[2].trim(), complete: true };
}

/** code===0 이면 성공. (-9999/음수는 실패) */
export function isSuccess(status) {
  return status && status.complete === true && status.code === 0;
}

/** <DATA>...</DATA> 본문. 없으면 STATUS를 제외한 텍스트를 best-effort 반환. */
export function extractData(raw) {
  const s = String(raw);
  const m = s.match(/<DATA>([\s\S]*?)<\/DATA>/);
  if (m) return m[1].trim();
  return s.replace(/<STATUS>[\s\S]*$/, '').trim();
}

/**
 * 컴파일 에러 라인 파싱: `file:line:(code): *msg*`
 * 집계줄(code -742, "*Compilation errors*": N)은 aggregate=true로 분리.
 * @returns {{ errors: Array, aggregate: object|null }}
 */
export function parseCompileErrors(raw) {
  const re = /^\s*(.+?\.gp[lo]):(\d+):\((-?\d+)\):\s*\*(.+?)\*\s*(?::\s*(\d+))?\s*$/gim;
  const errors = [];
  let aggregate = null;
  let m;
  while ((m = re.exec(String(raw))) !== null) {
    const entry = {
      file: m[1].trim(),
      line: parseInt(m[2], 10),
      code: parseInt(m[3], 10),
      message: m[4].trim(),
    };
    if (m[5] !== undefined || (entry.code === -742 && /compil/i.test(entry.message))) {
      aggregate = { ...entry, count: m[5] !== undefined ? parseInt(m[5], 10) : undefined };
    } else {
      errors.push(entry);
    }
  }
  return { errors, aggregate };
}

/**
 * `Show Thread -web` 파이프 포맷 또는 일반 포맷의 스레드 목록 파싱(best-effort).
 * 컬럼 수가 부족한 헤더/구분줄/짧은 줄은 건너뛴다.
 * @returns {{ threads: Array<{name:string, raw:string, fields:string[]}>, rawLines:string[] }}
 */
export function parseThreadList(raw) {
  const body = extractData(raw);
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const threads = [];
  for (const line of lines) {
    if (!line.includes('|')) continue; // -web 파이프 포맷만 구조화
    const fields = line.split('|').map((c) => c.trim());
    // 헤더/구분줄 제외: 첫 칸이 비었거나 'Thread'/'Name' 헤더, 대시 구분줄
    const first = fields[0] || '';
    if (!first || /^[-=\s]+$/.test(first) || /^(thread|name)$/i.test(first)) continue;
    if (fields.length < 2) continue;
    threads.push({ name: first, fields, raw: line });
  }
  return { threads, rawLines: lines };
}
