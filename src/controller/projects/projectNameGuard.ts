/**
 * 제어기 명령 인자로 쓰이는 프로젝트명·원격 경로의 안전성 검사 (vscode 의존 없음 — 단위 테스트 대상).
 *
 * Brooks 1402 콘솔 명령(Compile / Load / Start / Unload / Show Global …)은 인자를 **공백으로 구분**하고
 * 따옴표 같은 인용(quoting) 문법이 없다(Brooks 문서 Compile·Load·Start: `Compile <project_name>`,
 * `Load <project_path>`, `Start <project_name> [-break] [-bex]`). 따라서 프로젝트명(Project.gpr의
 * ProjectName = 제어기 `/GPL/<name>` 폴더명)이나 Load 경로에 공백이 들어 있으면 제어기는 첫 토큰만
 * 이름으로 읽고 나머지를 옵션으로 해석한다 — "프로젝트 없음" 계열 STATUS로 실패하거나, 운이 나쁘면
 * 이름이 비슷한 **다른 프로젝트**를 대상으로 삼는다.
 *
 * 이 모듈은 그 이름/경로를 명령에 끼워 넣는 모든 진입점(Deploy·Start·FTP Run/Unload·디버그 attach·MCP)이
 * 공유하는 단일 규칙이다. 진입점마다 규칙이 갈라지지 않도록 판정과 안내 문구를 여기서만 만든다.
 */

/**
 * 명령 인자에 올 수 없는 문자: 모든 종류의 공백(space·tab·NBSP·전각 공백 등 유니코드 \s 전체)과
 * 제어 문자(줄바꿈·NUL 등 — 명령 종결자/프레이밍을 깨뜨림). 문자 클래스는 이스케이프로만 적는다
 * (원시 제어 문자를 소스에 넣으면 편집기·diff에서 보이지 않는다).
 */
const UNSAFE_CHAR_CLASS = '[\\s\\u0000-\\u001F\\u007F]';
const UNSAFE_CHAR_RE = new RegExp(UNSAFE_CHAR_CLASS, 'u');
const UNSAFE_CHAR_RE_GLOBAL = new RegExp(UNSAFE_CHAR_CLASS, 'gu');
const UNSAFE_RUN_RE_GLOBAL = new RegExp(`${UNSAFE_CHAR_CLASS}+`, 'gu');

/** 무엇이 문제인지 사람이 읽을 수 있게 — 보이지 않는 문자를 이름으로 드러낸다. */
export function describeUnsafeChar(ch: string): string {
    switch (ch) {
        case ' ': return '공백(space)';
        case '\t': return '탭(tab)';
        case '\n': return '줄바꿈(LF)';
        case '\r': return '줄바꿈(CR)';
        case ' ': return '줄바꿈 없는 공백(NBSP)';
        case '　': return '전각 공백(U+3000)';
        default: {
            const code = ch.codePointAt(0) ?? 0;
            const hex = code.toString(16).toUpperCase().padStart(4, '0');
            return /\s/u.test(ch) ? `공백 문자(U+${hex})` : `제어 문자(U+${hex})`;
        }
    }
}

export interface ProjectNameCheck {
    ok: boolean;
    /** ok=false일 때 — 발견된 문제 문자 설명(중복 제거, 등장 순). */
    problems: string[];
}

function collectProblems(text: string): string[] {
    const found = new Set<string>();
    for (const m of text.matchAll(UNSAFE_CHAR_RE_GLOBAL)) {
        found.add(describeUnsafeChar(m[0]));
    }
    return [...found];
}

/** 프로젝트명(또는 제어기 폴더명) 하나가 1402 명령 인자로 안전한지. 빈 이름도 부적합. */
export function checkProjectName(name: string): ProjectNameCheck {
    if (!name) {
        return { ok: false, problems: ['빈 이름'] };
    }
    const problems = collectProblems(name);
    return { ok: problems.length === 0, problems };
}

/** 이름이 1402 명령 인자로 안전한지 — 짧은 술어형. */
export function isProjectNameSafe(name: string): boolean {
    return !!name && !UNSAFE_CHAR_RE.test(name);
}

/**
 * `Load <path>` 인자로 쓰이는 원격 경로 검사. 경로 구분자 `/`는 허용하고 각 세그먼트를 이름 규칙으로 본다
 * (경로 어느 세그먼트에 공백이 있어도 명령은 그 지점에서 잘린다).
 */
export function checkRemotePath(remotePath: string): ProjectNameCheck {
    if (!remotePath) {
        return { ok: false, problems: ['빈 경로'] };
    }
    const problems = collectProblems(remotePath);
    return { ok: problems.length === 0, problems };
}

/** 문제 문자를 `_`로 바꾼 제안 이름(연속 공백은 하나로). 안내 문구에만 쓰고 자동 변경은 하지 않는다. */
export function suggestSafeProjectName(name: string): string {
    return name.replace(UNSAFE_RUN_RE_GLOBAL, '_').replace(/^_+|_+$/g, '') || 'Project';
}

export type ProjectNameKind =
    | 'project'   // Project.gpr ProjectName (제어기 프로젝트명)
    | 'folder'    // 로컬 프로젝트 폴더명 — ProjectName이 없을 때 이름으로, 클래식 경로에서는 FTP/Load 경로로 쓰임
    | 'remote';   // 제어기 트리에서 고른 원격 폴더명/경로

/**
 * 사용자에게 보일 안내 문구. 왜 안 되는지(공백 구분 명령)와 고치는 방법(이름 변경)을 한 번에 말한다.
 * 호출측은 이 문구를 showErrorMessage / 디버그 오류 응답 / 배포 trace 어디에 넣어도 된다.
 * 이름이 안전하면 빈 문자열.
 */
export function describeProjectNameProblem(name: string, kind: ProjectNameKind, check?: ProjectNameCheck): string {
    const c = check ?? (kind === 'remote' ? checkRemotePath(name) : checkProjectName(name));
    if (c.ok) { return ''; }
    const what = kind === 'project'
        ? `프로젝트명 '${name}'(Project.gpr ProjectName)`
        : kind === 'folder'
            ? `프로젝트 폴더명 '${name}'`
            : `제어기 경로/폴더명 '${name}'`;
    const because = '제어기 콘솔 명령(Compile/Load/Start/Unload)은 인자를 공백으로 구분하고 인용 문법이 없어, '
        + '이 이름을 넣으면 명령이 끊겨 실패하거나 다른 프로젝트를 대상으로 삼을 수 있습니다.';
    const fix = kind === 'remote'
        ? '제어기의 폴더를 공백 없는 이름으로 바꾼 뒤 다시 시도하세요.'
        : `${kind === 'project' ? 'Project.gpr의 ProjectName' : '폴더명'}을 공백 없는 이름(예: '${suggestSafeProjectName(name)}')으로 바꾸고, `
          + '/GPL의 기존 폴더명도 함께 맞춰 주세요.';
    return `${what}에 ${c.problems.join('·')}이(가) 들어 있어 제어기 명령을 보내지 않았습니다. ${because} ${fix}`;
}
