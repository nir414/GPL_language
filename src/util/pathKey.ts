/**
 * 경로 동일성 키 — 파일·폴더 경로를 Map/Set 키나 비교에 쓸 때 거치는 **단일 규칙**(vscode 무의존).
 *
 * 종전에는 `controller/projects/projectPickerCore.ts` 에 있었는데, language(`symbolLocations`)·project(`compileUnit`·
 * `projectSources`)·symbolCache 가 그 하나 때문에 controller 계층을 import 하고 있었다(2026-09-07 §1-DB 로 분리).
 * 어느 계층에도 속하지 않는 순수 헬퍼만 `util/` 에 둔다 — 도메인 규칙은 여기 두지 않는다.
 */
import * as path from 'path';

/**
 * 경로 동일성 키 — 대소문자·구분자·`.`/`..`·끝 슬래시 차이를 무시한다(Windows).
 *
 * **파일·폴더 공용**이다. 같은 파일을 가리키는 표기가 여러 개일 수 있어서
 * (`.gpr`의 `ProjectSource=` 표기 ↔ 디스크 표기, 워크스페이스 검색 ↔ 열린 문서의 URI 등),
 * 경로를 Map/Set 키로 쓸 때는 반드시 이 키를 거친다. 원문 문자열을 그대로 키로 쓰면
 * 같은 파일이 캐시에 여러 항목으로 들어가 정의 이동이 같은 선언을 여러 번 띄운다
 * (2026-09-02 `docs/ai-handoff.md` §1-CQ).
 */
export function normalizePathKey(p: string): string {
    // 절대 경로만 메모한다 — 상대 경로는 cwd 에 따라 결과가 달라진다.
    // 인덱싱·조회가 같은 경로를 수만 번 정규화하므로 path.resolve(문자열 분해) 비용을 한 번만 낸다.
    if (!path.isAbsolute(p)) { return computePathKey(p); }
    let key = pathKeyMemo.get(p);
    if (key === undefined) {
        if (pathKeyMemo.size >= PATH_KEY_MEMO_MAX) { pathKeyMemo.clear(); }
        key = computePathKey(p);
        pathKeyMemo.set(p, key);
    }
    return key;
}

const PATH_KEY_MEMO_MAX = 50_000;
const pathKeyMemo = new Map<string, string>();

function computePathKey(p: string): string {
    return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

/** `normalizePathKey`와 같은 규칙 — 폴더 문맥의 기존 호출부가 쓰는 이름. */
export function normalizeDirKey(p: string): string {
    return normalizePathKey(p);
}

/** filePath가 dirPath 하위(또는 동일)인지 판정. 접두어 비교가 아니라 경로 세그먼트 기준. */
export function isPathUnder(filePath: string, dirPath: string): boolean {
    try {
        if (process.platform === 'win32' && path.isAbsolute(filePath) && path.isAbsolute(dirPath)) {
            // path.relative(resolve(dir), resolve(file)) 와 같은 판정을 접두어 비교로 — 대소문자 무시(Windows).
            // 정규화 키는 메모되므로 호출마다 path.resolve/relative 를 돌리지 않는다.
            const dir = normalizePathKey(dirPath);
            const file = normalizePathKey(filePath);
            if (file === dir) { return true; }
            if (!file.startsWith(dir + path.sep)) { return false; }
            // 종전 판정(`rel.startsWith('..')`)과 같게 첫 세그먼트가 `..` 로 시작하는 이름은 하위로 보지 않는다.
            return !file.startsWith('..', dir.length + 1);
        }
        const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    } catch {
        return false;
    }
}
