// procedureLocals.js — 정지 위치를 품은 프로시저의 지역 이름(매개변수·Dim)을 **로컬 소스**에서 뽑는다.
//
// 왜: `debug_snapshot({listLocals:true})` 는 `Show Variable <thread> <frame>`(변수명 생략)으로 지역 전체를 덤프하려 했지만,
// GPL 4.2K5 실측(2026-11-13, G2400C 192.168.0.1)에서 Paused·Error 쓰레드 모두 `-505 *Unexpected end of file*` 였다
// (문서상으로는 이름 생략 = 그 레벨 변수 전체). 그래서 이름 목록은 소스에서 만들고 값은 `Show Variable -eval` 로 하나씩 읽는다
// — 확장의 디버그 어댑터가 Variables 창을 채우는 방식(소스 심볼 + 개별 평가)과 같은 원리다.

const HEADER_RE = /^\s*(?:(?:Public|Private|Friend|Protected|Shared|Overrides|Overridable|Overloads|ReadOnly|WriteOnly)\s+)*(Sub|Function|Property)\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/i;
const END_RE = /^\s*End\s+(Sub|Function|Property)\b/i;
const DIM_RE = /^\s*(?:Dim|Static)\s+(.+)$/i;
const SET_ACCESSOR_RE = /^\s*Set\s*\(([^)]*)\)/i;
const IDENT_RE = /^\s*(?:(?:ByVal|ByRef|Optional)\s+)*([A-Za-z_]\w*)/i;

/** 줄에서 문자열 밖 `'` 주석을 지운다. */
function stripComment(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    else if (ch === "'" && !inStr) return line.slice(0, i);
  }
  return line;
}

/** 괄호·문자열 밖 콤마로 나눈다(`Dim a(3) As Integer, b As String = "x,y"`). */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    if (!inStr) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function namesFromList(text) {
  const names = [];
  for (const part of splitTopLevel(text ?? '')) {
    const m = IDENT_RE.exec(part);
    if (m) names.push(m[1]);
  }
  return names;
}

/** `start` 줄에서 시작하는 논리 줄 — 줄 끝 ` _`(줄 이음)을 따라 다음 물리 줄을 붙인다. 주석은 이미 지운 줄을 받는다. */
function joinContinuation(lines, start) {
  let text = lines[start] ?? '';
  for (let i = start + 1; /\s_\s*$/.test(text) && i < lines.length; i++) {
    text = text.replace(/\s_\s*$/, ' ') + lines[i];
  }
  return text;
}

/**
 * `line1`(1 기준) 을 품은 프로시저의 지역 이름. 프로시저 밖이거나 찾지 못하면 null.
 * @returns {{procedure:string, kind:string, headerLine:number, names:string[]}|null}
 */
export function localNamesAt(sourceText, line1, { max = 40 } = {}) {
  const lines = String(sourceText ?? '').split(/\r?\n/).map(stripComment);
  const at = line1 - 1;
  if (!Number.isInteger(at) || at < 0 || at >= lines.length) return null;
  let header = -1;
  for (let i = at; i >= 0; i--) {
    if (i < at && END_RE.test(lines[i])) return null;
    if (HEADER_RE.test(lines[i]) && !/^\s*End\b/i.test(lines[i])) { header = i; break; }
  }
  if (header < 0) return null;
  // 머리 줄이 ` _` 로 이어지면 논리 줄로 합쳐서 읽는다 — 첫 물리 줄에 닫는 괄호가 없으면 매개변수가 통째로 빠졌다.
  const hm = HEADER_RE.exec(joinContinuation(lines, header));
  let end = lines.length;
  for (let i = header + 1; i < lines.length; i++) {
    if (END_RE.test(lines[i])) { end = i; break; }
  }
  if (at > end) return null;
  const names = [...namesFromList(hm[3])];
  for (let i = header + 1; i < end; i++) {
    const set = SET_ACCESSOR_RE.exec(lines[i]);
    if (set && i <= at) names.push(...namesFromList(set[1]));
    const dim = DIM_RE.exec(joinContinuation(lines, i));
    if (dim) names.push(...namesFromList(dim[1]));
  }
  const seen = new Set();
  const unique = names.filter((n) => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { procedure: hm[2], kind: hm[1], headerLine: header + 1, names: unique.slice(0, max) };
}

/**
 * `from`~`to-1`(1 기준) 줄이 모두 빈 줄·주석뿐인가 — run_to_line 이 빈 줄/주석 줄을 요청하면 제어기는 다음 실행 줄(`to`)에 선다.
 * 소스가 없거나 범위가 이상하면 false(판단 보류).
 */
export function onlyNonCodeBetween(sourceText, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) return false;
  const lines = String(sourceText ?? '').split(/\r?\n/);
  if (to - 1 > lines.length) return false;
  for (let i = from - 1; i < to - 1; i++) {
    const code = stripComment(lines[i] ?? '').trim();
    // `Rem` 줄도 주석이다 — callSiteLineOf·확장의 isBlankOrComment 와 같은 기준.
    if (code !== '' && !/^rem(\s|$)/i.test(code)) return false;
  }
  return true;
}

/** 위치 응답의 파일을 로컬 경로로 — 세션 대상 폴더, 그 형제(`<lib>/<file>`), 형제 `<project>/<file>` 순. */
export function localSourceCandidates(targetDir, project, file) {
  if (!targetDir || !file) return [];
  const sep = targetDir.includes('\\') ? '\\' : '/';
  const parent = targetDir.replace(/[\\/]+[^\\/]+[\\/]*$/, '');
  const f = String(file).replace(/[\\/]+/g, sep);
  const out = [`${targetDir}${sep}${f}`, `${parent}${sep}${f}`];
  if (project) out.push(`${parent}${sep}${project}${sep}${f}`);
  return out;
}

/**
 * 호출자 프레임의 호출 줄 — `Show Stack` 은 frame ≥ 1 에 "돌아가 실행할 다음 문장" 줄을 준다(2026-11-13 실측:
 * 호출 7 → 10(빈 줄·주석 건너뜀), If 안 12 → 13 End If, For 안 16 → 17 Next, 식 안 20 → 21). 보고 줄 위로 빈 줄·주석을
 * 건너뛴 첫 코드 줄(연속 줄이면 논리 줄 첫 줄). 확장 `debug/execution/sourceTargets.callSiteLine` 과 같은 규칙.
 */
export function callSiteLineOf(sourceText, reportedLine) {
  const lines = String(sourceText ?? '').split(/\r?\n/);
  if (!Number.isInteger(reportedLine) || reportedLine <= 1 || reportedLine - 1 > lines.length) return undefined;
  const code = (i) => stripComment(lines[i - 1] ?? '').trim();
  let l = reportedLine - 1;
  while (l >= 1 && (code(l) === '' || /^rem(\s|$)/i.test(code(l)))) l--;
  if (l < 1) return undefined;
  while (l > 1 && /\s_$/.test(code(l - 1))) l--;
  return l;
}

/** `Show Stack` 원문 → [{frame, procedure, file, line}]. */
export function parseStackFrames(stackText) {
  const out = [];
  for (const raw of String(stackText ?? '').split(/\r?\n/)) {
    const cells = raw.split(',').map((c) => c.trim());
    const frame = Number(cells[0]);
    const line = Number(cells[5]);
    if (cells.length >= 6 && Number.isInteger(frame) && cells[4] && Number.isInteger(line)) {
      out.push({ frame, procedure: cells[2], file: cells[4], line });
    }
  }
  return out;
}

/** `Show Stack` 원문에서 frame 번호의 {file, line}. 형식 실측: `0, syntax_tour, Main, 1, Main.gpl, 25, 0.047`. */
export function frameLocation(stackText, frame = 0) {
  for (const raw of String(stackText ?? '').split(/\r?\n/)) {
    const cells = raw.split(',').map((c) => c.trim());
    if (cells.length >= 6 && Number(cells[0]) === frame) {
      const line = Number(cells[5]);
      if (cells[4] && Number.isInteger(line)) return { procedure: cells[2], file: cells[4], line };
    }
  }
  return null;
}
