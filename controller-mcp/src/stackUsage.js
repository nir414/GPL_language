// stackUsage.js — `Show Thread -stack` 의 쓰레드별 스택 사용량(KB)과 한도 대비 비율.
//
// 형식(미실측 부분 있음): `Show Thread -web -stack` 의 파이프 행 끝에 숫자 3개가 붙는다 — 확장 threadParser.stackTiming 과 같은 열(index 9+).
//   실측 샘플 3줄(2026-10-23 보고): `RWK[0]` 0.168 / 4.000 / 0.500, `TCPLSN:4000` 0.242 / 4.000 / 1.258, MAIN 0.094 / 4.000 / 1.289
//   단독 `Show Thread <name> -stack` 의 수치 줄: `0.172, 4.000, 0.172`.
//   해석: [현재(level), 스택 크기(size), 최대 사용(max)] — 가운데가 크기라는 것은 위 샘플과 보고 문구("최대 3.984 / 4.000 KB",
//   Thread 생성자 stack_size KB)로 추정한 것이고 Brooks 도움말에는 열 이름이 없다(미실측). 그래서 size<=0 이거나 max>size 인
//   행은 비율을 계산하지 않고 raw 만 보존한다.
// 문서상 Thread 생성자 stack_size(KB): https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Thread/new.htm
// -755 Thread stack too small: https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Error_Code/language_errors.htm

export const STACK_WARN_PERCENT = 90;

/**
 * 파이프 필드 배열(parseThreadList 의 fields) 끝의 숫자들 → [level, size, max] 또는 null.
 * 숫자 셀이 3개 미만이면 null(-stack 없이 부른 응답).
 */
export function stackNumbersFromFields(fields, from = 9) {
  const nums = [];
  for (let i = from; i < (fields?.length ?? 0); i++) {
    const cell = String(fields[i] ?? '').trim();
    if (/^-?\d*\.?\d+$/.test(cell)) nums.push(Number(cell));
  }
  return nums.length >= 3 ? nums.slice(0, 3) : null;
}

/** [level,size,max] → { levelKB, sizeKB, maxKB, percent, warn }. 해석 불가면 percent:null·warn:false. */
export function summarizeStack(nums) {
  if (!nums || nums.length < 3) return null;
  const [level, size, max] = nums;
  const valid = size > 0 && max >= 0 && max <= size * 1.0001;
  const percent = valid ? Math.round((max / size) * 1000) / 10 : null;
  return { levelKB: level, sizeKB: size, maxKB: max, percent, warn: percent !== null && percent >= STACK_WARN_PERCENT };
}

/**
 * 쓰레드 목록(parseThreadList 결과, fields 포함) → stack 요약 배열. 사용률 높은 순.
 * @returns {{ threads: Array<{name:string, state:string, levelKB:number, sizeKB:number, maxKB:number, percent:number|null, warn:boolean}>, warnings: string[] }}
 */
export function buildStackReport(threads) {
  const out = [];
  for (const t of threads ?? []) {
    const s = summarizeStack(stackNumbersFromFields(t.fields));
    if (s) out.push({ name: t.name, state: t.state, ...s });
  }
  out.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
  const warnings = out.filter((e) => e.warn).map((e) =>
    `${e.name}: 스택 최대 ${e.maxKB} / ${e.sizeKB} KB (${e.percent}%) — ${STACK_WARN_PERCENT}% 이상이다. `
    + '-755(Thread stack too small) 위험 — New Thread 의 stack_size(KB)를 늘릴 것(문서상 Thread/new.htm).');
  return { threads: out, warnings };
}
