/**
 * ProjectLibrary 소스의 위치 표기 — `show_threads`·`run_to_line`·`step_thread` 가 돌려주는 위치는
 * `file:"PaL/Data_Store.gpl", project:"App"` 이지만, 제어기 `Set Break` 는 **라이브러리 프로젝트 이름 + 라이브러리 안 파일**
 * (`Set Break PaL "Data_Store.gpl"1382`)만 받는다(`Set Break App "PaL/Data_Store.gpl"…` 은 -508, 2026-11-05 실측).
 * 받은 위치를 그대로 다시 넣을 수 있게 이 모듈이 두 표기를 오간다(순수 함수 — 라이브러리 목록은 호출자가 준다).
 */

/** 경로 구분자를 `/` 로 통일하고 앞뒤 공백·앞의 `./` 를 뗀다. 대소문자는 보존한다. */
export function normalizeSourceFile(file) {
  return String(file ?? '').trim().replace(/[\\/]+/g, '/').replace(/^\.\//, '');
}

/**
 * `<lib>/<file>` 표기를 `{ project: <lib>, file }` 로 푼다 — 첫 구간이 **주어진 라이브러리 목록**에 있을 때만(대소문자 무시).
 * 라이브러리가 아니면(메인 프로젝트의 하위 폴더 등) `null` 이라 호출자는 입력을 그대로 쓴다.
 * @param {string} file
 * @param {readonly string[]} libraries 이 프로젝트의 ProjectLibrary 프로젝트 이름들
 * @returns {{ project: string, file: string } | null}
 */
export function splitLibraryQualifiedFile(file, libraries) {
  const normalized = normalizeSourceFile(file);
  const slash = normalized.indexOf('/');
  if (slash <= 0 || slash === normalized.length - 1) return null;
  const head = normalized.slice(0, slash);
  const lib = (libraries ?? []).find((name) => String(name).toLowerCase() === head.toLowerCase());
  if (!lib) return null;
  return { project: lib, file: normalized.slice(slash + 1) };
}

/**
 * 요청한 위치와 실제 정지 위치가 **같은 소스 파일**인지 — `Data_Store.gpl`(project:PaL) 과 `PaL/Data_Store.gpl`(project:App)
 * 처럼 표기만 다른 경우를 같게 본다. 줄 번호는 비교하지 않는다. 같은 파일명이어도 프로젝트가 다르면(둘 다 라이브러리
 * 접두어 없이) 다른 파일이고, 폴더가 다른 파일을 basename 만으로 같다고 하지 않는다.
 * @param {{ project?: string, file?: string }} requested
 * @param {{ project?: string, file?: string }} actual
 */
export function sameSourceFile(requested, actual) {
  const fa = normalizeSourceFile(requested?.file).toLowerCase();
  const fb = normalizeSourceFile(actual?.file).toLowerCase();
  if (!fa || !fb) return false;
  const pa = String(requested?.project ?? '').trim().toLowerCase();
  const pb = String(actual?.project ?? '').trim().toLowerCase();
  // 같은 표기 — 프로젝트가 서로 알려져 있으면 같아야 한다.
  if (fa === fb && (!pa || !pb || pa === pb)) return true;
  // 한쪽이 `<프로젝트>/<파일>` 로 쓴 표기와 다른 쪽의 (프로젝트, 파일) 쌍.
  if (pa && `${pa}/${fa}` === fb) return true;
  if (pb && `${pb}/${fb}` === fa) return true;
  return false;
}
