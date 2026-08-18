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
      return '프로퍼티/메서드 참조는 인자 유무와 무관하게 -eval이 평가하지 못한다(GPL 4.2K5 실측, ai-handoff §1-U). ' +
        '유사 표현으로 재시도하지 말 것. 대안: ① 백킹 필드(m_*)를 직접 읽기 ② 부모 객체명만 평가해 필드 덤프에서 읽기 ' +
        '③ 소스 정적 분석으로 값 유도.';
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
