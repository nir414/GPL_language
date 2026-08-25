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
 * 스레드 상태 문자열 정규화. 확장 responseParser.ts의 normalizeThreadState를 이식.
 * 'Stopped'를 'stopp' 포함 검사보다 먼저 확인한다(Stopping 오판 방지 — 확장에서 검증된 순서).
 */
export function normalizeThreadState(raw) {
  const s = String(raw).toLowerCase();
  if (s.includes('run')) return 'Running';
  if (s.includes('idle')) return 'Idle';
  if (s.includes('error') || s.includes('err')) return 'Error';
  if (s.includes('stopped')) return 'Stopped';
  if (s.includes('stopp') || s.includes('stoping')) return 'Stopping';
  if (s.includes('stop')) return 'Stopped';
  if (s.includes('paus')) return 'Paused';
  if (s.includes('break')) return 'Break';
  return String(raw);
}

/** 위치/변수 확인이 가능한 정지 계열 상태 (확장 AI_PAUSED_STATES와 동일 기준). */
export const PAUSED_STATES = new Set(['Paused', 'Break', 'Error']);

/**
 * `Show Thread <threadname>` 상세 응답(콤마 형식) 파싱. 확장 parseThreadDetail 이식.
 * 예시:
 *   GPL_Code, Paused
 *   0, ""
 *   GPL_Code, MAIN, 2, Entry_Main.gpl, 6
 * @returns {{name,state,statusCode,statusMessage,project,process,procLine,file,fileLine}|null}
 */
export function parseThreadDetail(text) {
  const dataMatch = String(text).match(/<DATA>([\s\S]*?)<\/DATA>/i);
  const payload = (dataMatch ? dataMatch[1] : String(text))
    .replace(/<STATUS>[\s\S]*?<\/STATUS>/gi, '')
    .trim();

  const lines = payload.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const headerParts = lines[0].split(/,\s*/);
  if (headerParts.length < 2) return null;

  let statusCode = 0;
  let statusMessage = '';
  if (lines.length >= 2) {
    const statusMatch = lines[1].match(/^(-?\d+)\s*,\s*"?(.*?)"?$/);
    if (statusMatch) {
      statusCode = parseInt(statusMatch[1], 10) || 0;
      statusMessage = statusMatch[2] || '';
    }
  }

  let project = '';
  let process = '';
  let procLine = 0;
  let file = '';
  let fileLine = 0;
  if (lines.length >= 3) {
    const locParts = lines[2].split(/,\s*/);
    if (locParts.length >= 5) {
      project = locParts[0]?.trim() || '';
      process = locParts[1]?.trim() || '';
      procLine = parseInt(locParts[2], 10) || 0;
      file = locParts[3]?.trim() || '';
      fileLine = parseInt(locParts[4], 10) || 0;
    }
  }

  return {
    name: headerParts[0].trim(),
    state: normalizeThreadState(headerParts[1]?.trim() || ''),
    statusCode,
    statusMessage,
    project,
    process,
    procLine,
    file,
    fileLine,
  };
}

/**
 * 실패 STATUS 코드에 대한 행동 지향 힌트.
 * 목적: AI가 실패 응답을 받은 그 시점에 "무엇을 바꿔 재시도할지"를 알려줘
 * 같은 부류의 재시도 낭비(-780 eval 반복, -714 없는 명령 등)를 끊는다.
 * @returns {string|undefined} 알려진 코드가 아니면 undefined
 */
export function statusHint(code) {
  switch (code) {
    case -780:
      return '식의 **마지막 요소**가 사용자 프로퍼티/메서드면 -eval이 거부한다(GPL 4.2K5 실측 2026-08-25; 체인 중간의 사용자 Property/Function은 실행됨). ' +
        '유사 표현·CStr()/산술 감싸기(-712)로 재시도하지 말 것. 대안: ① 백킹 필드 m_<이름> 직접 읽기(eval_expression이 자동 재시도, resolvedAs 표시) ' +
        '② 부모 객체명만 평가해 필드 덤프에서 읽기(덤프는 프레임 무관하게 Private 포함) ③ 객체(Location 등)를 돌려주는 프로퍼티/함수는 ' +
        '뒤에 시스템 멤버를 하나 붙이기(`x.loc.Pos`, `x.loc.X`) ④ 소스 정적 분석으로 값 유도.';
    case -712:
      return '콘솔 평가기가 받지 않는 구문 — `Me.` 접두(자동 제거됨), CStr/CInt/CDbl 감싸기, 산술식은 불가. 변수/필드/배열요소 식만 보낼 것.';
    case -762:
      return 'Location 타입 불일치: 이 Location은 Angles(Type 1)라 X/Y/Z/Yaw/Pitch/Roll이 없다. Angle(1..n)을 조회할 것.';
    case -763:
      return 'Location 타입 불일치: 이 Location은 Cartesian(Type 0)이라 Angle(i)가 없다. X/Y/Z/Yaw/Pitch/Roll을 조회할 것.';
    case -729:
      return '그 프레임 스코프에 없는 이름이거나 객체 멤버 점 표기 식이다(-eval은 프레임별 스코프가 엄격히 분리됨). ' +
        '로컬/파라미터는 show_stack으로 정확한 프레임 인덱스를 확인해 그 프레임에서 읽고, ' +
        '객체 멤버는 부모 객체명만 평가해 덤프의 멤버 줄에서 확인할 것. ' +
        '모듈 전역 필드(theMotionLoger.lastStage 형태)와 배열 인덱스(arr(i))는 평가 가능.';
    case -714:
      return '존재하지 않는 콘솔 명령. 추측으로 다른 표기를 재시도하지 말고 ' +
        'docs/reference/console-commands.md 또는 Brooks GPL Dictionary에서 명령을 확인할 것.';
    case -505:
      return '인자 부족. 예: Directory는 경로 인자가 필요하다(`Directory /flash/projects`).';
    case -508:
      return '파일/경로 없음. `/GPL` vs `/flash/projects` 경로 기준과 프로젝트명 대소문자를 확인할 것.';
    case -742:
      return '컴파일 에러 — 응답의 `file:line:(code)` 에러 라인을 읽고 소스를 수정할 것. 이 프로젝트는 실행 불가 상태다.';
    case -745:
      return '이미 로드된 프로젝트일 수 있다. 문맥 없이 치명 실패로 단정하지 말 것.';
    case -9999:
      return 'STATUS 종결자를 받지 못했다(불완전 응답). 성공으로 간주하지 말고 연결/타임아웃을 확인할 것.';
    default:
      return undefined;
  }
}

/**
 * `Show Thread -web` 파이프 포맷 스레드 목록 파싱(best-effort). 열 순서는 확장 responseParser.parseThreadList와 동일:
 *   name| state| code| "msg"| project| func| procLine| file| fileLine
 * 종전엔 fields[]+raw만 줘서 AI가 열 의미를 추측해야 했고 응답이 3중으로 커졌다(GitHub #24) — 이름 있는 키로 매핑하고
 * raw/fields는 verbose 표시용으로만 남긴다(compactThread로 제거).
 * @returns {{ threads: Array<{name,state,statusCode,statusMessage,project,procedure,procLine,file,line,fields,raw}>, rawLines:string[] }}
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
    threads.push({
      name: first,
      state: normalizeThreadState(fields[1] ?? ''),
      statusCode: parseInt(fields[2], 10) || 0,
      statusMessage: (fields[3] ?? '').replace(/^"([\s\S]*)"$/, '$1'),
      project: fields[4] ?? '',
      procedure: fields[5] ?? '',
      procLine: parseInt(fields[6], 10) || 0,
      file: fields[7] ?? '',
      line: parseInt(fields[8], 10) || 0,
      fields,
      raw: line,
    });
  }
  return { threads, rawLines: lines };
}

/** 스레드 한 건을 AI 소비용 최소 필드로 줄인다(빈 값·0·raw·fields 생략). 스레드 15개 기준 ~6.5KB → ~1.2KB. */
export function compactThread(t) {
  const out = { name: t.name, state: t.state };
  if (t.statusCode) out.statusCode = t.statusCode;
  if (t.statusMessage) out.statusMessage = t.statusMessage;
  if (t.project) out.project = t.project;
  if (t.procedure) out.procedure = t.procedure;
  if (t.file) out.file = t.file;
  if (t.line) out.line = t.line;
  if (t.procLine) out.procLine = t.procLine;
  return out;
}

/** 스레드 목록 요약: 상태별 개수 + 정지(Paused/Break/Error) 스레드의 위치. 폴링용 controller_status의 본체. */
export function summarizeThreads(threads) {
  const count = (pred) => threads.filter(pred).length;
  return {
    total: threads.length,
    running: count((t) => t.state === 'Running'),
    paused: count((t) => t.state === 'Paused' || t.state === 'Break'),
    error: count((t) => t.state === 'Error'),
    idle: count((t) => t.state === 'Idle'),
    stopped: count((t) => t.state === 'Stopped' || t.state === 'Stopping'),
    pausedThreads: threads.filter((t) => PAUSED_STATES.has(t.state)).map((t) => {
      const o = { name: t.name, state: t.state };
      if (t.file) o.file = t.file;
      if (t.line) o.line = t.line;
      if (t.procedure) o.procedure = t.procedure;
      return o;
    }),
  };
}

// ── Show Variable 응답 파싱(확장 showVariableParser.ts 규칙 이식) ────────────

/** 쉼표 분할 시 괄호 안의 쉼표(`arr(0,1)`, `Double(,)`)는 무시하고, maxParts 이후는 마지막 칸에 합친다. */
export function splitVarLine(line, maxParts) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of line) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0 && parts.length < maxParts - 1) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0 || parts.length > 0) parts.push(current.trim());
  return parts;
}

/**
 * `name, X` 2열 줄의 두 번째 칸이 타입 토큰인지. 시스템 Location 덤프의 멤버 줄은 `name, value` 2열(+주석 값
 * `0 = Cartesian`)로 오므로(실측 2026-08-25, GitHub #27) 2열을 무조건 헤더로 보면 값이 사라진다.
 */
export function isTypeToken(s) {
  const t = String(s).trim();
  if (!t || /^[-+.\d"']/.test(t)) return false;
  if (/^(Integer|Double|Single|Boolean|Byte|Short|Long|String|Decimal|Date|Char)\s*(\([^)]*\))?$/i.test(t)) return true;
  if (/^Object\b/i.test(t)) return true;
  return /^[A-Za-z_]\w*\s*\([^)]*\)\s*\S*$/.test(t);
}

function classifyVarKind(e, hasMembers) {
  if (!e.value && /\([^)]*\)\s*$/.test(e.type)) return 'array';
  const t = e.type.trim();
  const objParen = t.match(/^object\s*\([^)]*\)\s*(\S*)$/i);
  if (objParen) {
    if (hasMembers) return 'object';
    if (/\)\s*$/.test(e.name) || e.name.includes('.')) return /^null$/i.test(objParen[1] ?? '') ? 'simple' : 'object';
    return 'array';
  }
  if (/^object\b/i.test(t)) return 'object';
  return 'simple';
}

/**
 * `Show Variable -eval` 응답 → `{ name, type, value, kind, members }` (없으면 null).
 *  - kind: 'simple' | 'object'(members에 필드 덤프) | 'array'(요소는 `arr(i)`로 개별 조회)
 *  - 2열 멤버 줄(Location 덤프)은 type '' + value, `Null`은 'null'로 통일.
 * AI가 `curHand, Integer, 1` 원문을 재파싱하지 않게 한다(GitHub #24 ③).
 */
export function parseShowVariable(raw) {
  const body = extractData(raw);
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const parseLine = (line) => {
    const parts = splitVarLine(line, 3);
    if (parts.length >= 3) return { name: parts[0], type: parts[1], value: parts[2] };
    if (parts.length === 2) {
      return isTypeToken(parts[1])
        ? { name: parts[0], type: parts[1], value: '' }
        : { name: parts[0], type: '', value: /^null$/i.test(parts[1]) ? 'null' : parts[1] };
    }
    return { name: '', type: '', value: line };
  };
  const [head, ...members] = lines.map(parseLine);
  return { ...head, kind: classifyVarKind(head, members.length > 0), members };
}
