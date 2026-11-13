/**
 * ProjectLibrary 소스의 위치 표기 — `show_threads`·`run_to_line`·`step_thread` 가 돌려주는 위치는
 * `file:"PaL/Data_Store.gpl", project:"App"` 이지만, 제어기 `Set Break` 는 **라이브러리 프로젝트 이름 + 라이브러리 안 파일**
 * (`Set Break PaL "Data_Store.gpl"1382`)만 받는다(`Set Break App "PaL/Data_Store.gpl"…` 은 -508, 2026-11-05 실측).
 * 받은 위치를 그대로 다시 넣을 수 있게 이 모듈이 두 표기를 오간다(순수 함수 — 라이브러리 목록은 호출자가 준다).
 *
 * 2026-11-13 실측(G2400C 4.2K5, captures/nesttest)으로 확인한 규칙:
 * - 위치 표기는 `<ProjectLibrary 값>/<ProjectSource 표기>` 다 — `TLib/Core\Log\Logger.gpl`, 중첩이면 `NLib\Core\Log/Logger.gpl`.
 * - "라이브러리 프로젝트 이름" = `ProjectLibrary` 값 = `/GPL` 바로 아래 폴더 이름(`.gpr` 의 ProjectName 이 아니다).
 * - 파일은 `ProjectSource` 표기 그대로 **역슬래시**여야 한다(`Set Break TLib "Core/Log/Logger.gpl"` 은 -508).
 * - 중첩 라이브러리(`NLib\Core\Log`)는 `Set Break` 로 지정할 방법이 없다(24종 표기 모두 -508/-205) — 보내지 않고 알린다.
 */

/** 경로 구분자를 `/` 로 통일하고 앞뒤 공백·앞의 `./` 를 뗀다. 대소문자는 보존한다. */
export function normalizeSourceFile(file) {
  return String(file ?? '').trim().replace(/[\\/]+/g, '/').replace(/^\.\//, '');
}

/**
 * `<lib>/<file>` 표기를 `{ project: <lib>, file }` 로 푼다 — 첫 구간이 **주어진 라이브러리 목록**에 있을 때만(대소문자 무시).
 * 라이브러리가 아니면(메인 프로젝트의 하위 폴더 등) `null` 이라 호출자는 입력을 그대로 쓴다. 파일 부분의 구분자는 제어기가
 * 받는 역슬래시로 바꾼다.
 * @param {string} file
 * @param {readonly string[]} libraries 제어기가 아는 라이브러리 이름(ProjectLibrary 값이 낱말 하나인 것)
 * @returns {{ project: string, file: string } | null}
 */
export function splitLibraryQualifiedFile(file, libraries) {
  const normalized = normalizeSourceFile(file);
  const slash = normalized.indexOf('/');
  if (slash <= 0 || slash === normalized.length - 1) return null;
  const head = normalized.slice(0, slash);
  const lib = (libraries ?? []).find((name) => String(name).toLowerCase() === head.toLowerCase());
  if (!lib) return null;
  return { project: lib, file: normalized.slice(slash + 1).replace(/\//g, '\\') };
}

/**
 * 위치가 **중첩 라이브러리**(`ProjectLibrary="Lib\Core\Log"`)의 소스인가 — 그 값(`/` 구분)으로 시작하면 그 값을 돌려준다.
 * 가장 긴 접두어를 고른다(`Lib/Core` 그룹과 `Lib/Core/Log` 리프가 함께 있을 때 리프).
 * @param {string} file
 * @param {readonly string[]} nestedRefs 중첩 ProjectLibrary 값들(`Lib/Core/Log` 꼴)
 * @returns {string | null}
 */
export function nestedLibraryOf(file, nestedRefs) {
  const normalized = normalizeSourceFile(file).toLowerCase();
  let best = null;
  for (const ref of nestedRefs ?? []) {
    const key = normalizeSourceFile(ref).toLowerCase();
    if (key && normalized.startsWith(`${key}/`) && (!best || key.length > normalizeSourceFile(best).length)) best = ref;
  }
  return best;
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
