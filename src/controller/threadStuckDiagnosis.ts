/**
 * 정지 불가 쓰레드 진단 — "Stop 이 안 먹는다"를 사람이 읽을 근거로 바꾼다 (vscode 무의존, 주입형 IO).
 *
 * ## 왜 이 모듈이 있는가
 *
 * `threadStop.ts` 의 settle 게이트가 실패하면 지금까지는 한 줄만 남았다.
 *
 * ```
 * ✘ Stop -all 후에도 쓰레드가 정지되지 않음: MergeCode(Running)
 * ```
 *
 * 그런데 2026-09-10 실측에서 **`Stop -all`·`Stop <t>`·`Break <t>` 가 전부 `-752`,
 * `Show Stack` 은 `-750`(활성 쓰레드는 스택을 못 읽는다), `Unload` 는 `-750`** 인 상태가 나왔다.
 * GPL 에는 강제 kill 이 없으므로(콘솔 명령 49개 전수에 `Kill` 0건) 남은 길은 **쓰레드를 붙잡고 있는
 * 자원을 밖에서 치워 스스로 빠져나오게 하는 것**뿐이다. 그날 실제로 통한 명령은 이것이었다.
 *
 * ```
 * Execute NetworkManager.comReceiver(0).Close(), MergeCode
 * ```
 *
 * 2026-09-10 문서 대조로 **후보 하나가 문서로 확정됐다**(§1-DM): `StreamReader.Read`/`ReadLine` 은 serial 장치에서
 * 바이트·줄 종결자가 에러로 유실되면 "will continue blocking and **hang your procedure**"라고 GPL Dictionary 가
 * 명시한다. 즉 영구 대기는 제어기 결함이 아니라 **문서화된 동작**이고, 밖에서 스트림을 닫는 것이 정공법이다
 * (`Close` 는 "안 열려 있어도 에러 없음"). 그래서 이 모듈은 그 두 호출을 1순위로 표시하고 근거 URL 을 함께 싣는다.
 * 단, 위 실측 건이 블로킹이었는지 폭주(탈출 조건 없는 루프)였는지는 **끝내 갈리지 않았다**(§1-DI) — 리포트는
 * 그 경고까지 같이 실어 다음 사람이 원인을 단정하지 않게 한다.
 *
 * 여기까지 가는 데 걸린 시간의 대부분은 실행이 아니라 **진단**이었다 — 정지 위치를 여러 번 찍어
 * 안 움직이는지 보고, 그 줄의 소스를 열고, 호출 대상이 프로젝트 전역인지 확인하는 과정. 전부
 * 읽기 전용이고 기계적이라 확장이 대신할 수 있다. 이 모듈이 그 부분을 맡는다.
 *
 * ## 무엇을 하고 무엇을 하지 않는가
 *
 * - **한다**: 정지 위치 반복 샘플링(읽기 전용) · 로컬 소스에서 그 줄 읽기 · 문장에서 수신자 식 추출 ·
 *   복구 후보 명령 조립 · 사람이 읽을 리포트 생성.
 * - **하지 않는다**: 복구 명령 **전송**. `Execute` 는 임의 GPL 문장 실행 경로이고 대상 식별은 정적
 *   분석이라 오식별 가능성이 남는다(오늘도 배열 인덱스가 지역 변수라 소스만으로는 확정 못 했다).
 *   그래서 이 모듈은 후보까지만 만들고, 보낼지는 호출부가 사람에게 묻는다.
 *
 * 단위 테스트: `src/test/threadStuckDiagnosis.test.ts`
 */

import * as fs from 'fs';
import * as path from 'path';
import { ThreadInfo } from './responseParser';
import { ThreadStopIo, probeThreads } from './threadStop';

/**
 * **문서가 "무한 블록"을 명시한** 호출(소문자 메서드 이름 → 리포트에 붙일 근거 한 줄).
 *
 * 이 두 개는 정지 불가 쓰레드의 1순위 용의자다 — GPL Dictionary 가 유실 바이트/유실 종결자 상황에서
 * "will continue blocking and **hang your procedure**"라고 못 박아 두었다. 제어기에 강제 kill 이 없으므로
 * (콘솔 명령 49개 전수에 `Kill` 0건) 이때 남는 길은 스트림을 밖에서 `Close()` 하는 것뿐이고, 그것이
 * 아래 `buildRecoveryCandidates` 가 조립하는 명령이다. `Close` 는 "안 열려 있어도 에러 없음"이라 시도가 안전하다.
 */
const UNBOUNDED_BLOCKING_METHODS = new Map<string, string>([
    ['read', 'GPL Dictionary: serial 장치는 읽을 바이트가 없으면 블록하고, 바이트가 에러로 유실되면 '
        + '"will continue blocking and hang your procedure" — 즉 영구 대기입니다. '
        + 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/read_sr.htm'],
    ['readline', 'GPL Dictionary: 줄 종결자(LF/CR)까지 블록하고, 종결자가 유실·손상되면 '
        + '"will continue blocking and hang your procedure" — 즉 영구 대기입니다. '
        + 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/readline_sr.htm'],
]);

/**
 * 블로킹 계열이라도 "줄이 고정 = 블로킹"은 아니라는 경고 — 2026-09-10 실측(§1-DI)에서 끝내 갈리지 않은 부분이다.
 * 좁은 flush 루프는 시간의 대부분이 `Read()` I/O 라 샘플이 그 줄에만 잡힌다. 복구(`Close`)는 양쪽 모두 통하므로
 * 조치는 같지만, 원인을 단정하면 다음 사람이 엉뚱한 곳을 고친다.
 */
const BLOCK_VS_SPIN_CAVEAT = '줄이 고정돼 보여도 블로킹이 아니라 탈출 조건 없는 루프의 I/O 시간일 수 있습니다'
    + '(2026-09-10 실측에서는 구분하지 못했습니다) — 구분하려면 입력원을 끊어 보세요. 복구용 Close 는 두 경우 모두 통합니다.';

/**
 * 대기할 수 있으나 문서가 무한 블록을 명시하지 않은(또는 무한 여부가 미확인인) 호출.
 * 판정을 막지는 않고 리포트 문구만 바꾼다.
 */
const BLOCKING_METHODS = new Set([
    'readchar', 'accept', 'connect', 'receive',
    'send', 'write', 'writeline', 'flush', 'join', 'lock', 'testandset',
    'waitforeom', 'sleep',
]);

/**
 * **문서가 "블록하지 않는다"고 명시한** 호출 — 정지 위치가 여기면 이 줄 자체는 범인이 아니다.
 *
 * `Peek` 를 블로킹 목록에 넣어 두었다가 2026-09-10 문서 대조에서 정정했다(§1-DM): 원문은
 * "does not block, but immediately returns -1 if no bytes are available" 다. 그러니 정지 위치가
 * `While … Peek() <> -1` 줄이면 의심해야 할 것은 블로킹이 아니라 **탈출 조건 없는 루프**다 —
 * 실측(§1-DI)에서 상대가 계속 송신해 이 루프를 빠져나오지 못했다.
 */
const NONBLOCKING_METHODS = new Map<string, string>([
    ['peek', 'GPL Dictionary: Peek 은 "does not block, but immediately returns -1 if no bytes are available" — '
        + '이 호출 자체는 영구 대기하지 않습니다. 위치가 여기 고정이면 탈출 조건 없는 루프를 의심하세요'
        + '(2026-09-10 실측: 상대가 계속 송신해 `While … Peek() <> -1` 을 빠져나오지 못했습니다). '
        + '복구는 입력원 차단 또는 그 스트림 Close(). '
        + 'https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamReader/peek_sr.htm'],
]);

/** 수신자 식으로 오인하기 쉬운 GPL 키워드(소문자). */
const GPL_KEYWORDS = new Set([
    'if', 'while', 'until', 'for', 'elseif', 'else', 'return', 'call', 'then',
    'and', 'or', 'not', 'do', 'loop', 'case', 'select', 'exit', 'goto', 'dim',
    'set', 'print', 'throw', 'new', 'to', 'step', 'each', 'in', 'is',
]);

export interface StuckDiagnosisOptions {
    /** 정지 위치를 몇 번 찍어 볼 것인가(기본 4). 1 이면 이동 여부를 판정하지 않는다. */
    sampleCount?: number;
    /** 샘플 간격(기본 400ms). */
    sampleIntervalMs?: number;
    /** 로그 줄 접두(배포 트레이스는 `'│ '`). 기본 빈 문자열. */
    logPrefix?: string;
    /** 소스 문맥을 앞뒤로 몇 줄 보여 줄 것인가(기본 3). */
    contextLines?: number;
    /**
     * 배열 인덱스가 지역 변수라 확정할 수 없을 때 만들어 볼 인덱스 상한(기본 3 → `0`~`3`).
     * 존재하지 않는 인덱스는 제어기가 `-757 "Object not instantiated"` 로 떨어뜨리므로 무해하다.
     */
    maxArrayIndexProbe?: number;
    /** 리포트를 `io.log` 로도 내보낼 것인가(기본 true). */
    logReport?: boolean;
}

interface ResolvedOptions {
    sampleCount: number;
    sampleIntervalMs: number;
    logPrefix: string;
    contextLines: number;
    maxArrayIndexProbe: number;
    logReport: boolean;
}

function resolveOptions(opts?: StuckDiagnosisOptions): ResolvedOptions {
    return {
        sampleCount: Math.max(1, opts?.sampleCount ?? 4),
        sampleIntervalMs: Math.max(0, opts?.sampleIntervalMs ?? 400),
        logPrefix: opts?.logPrefix ?? '',
        contextLines: Math.max(0, opts?.contextLines ?? 3),
        maxArrayIndexProbe: Math.max(0, opts?.maxArrayIndexProbe ?? 3),
        logReport: opts?.logReport !== false,
    };
}

/**
 * 로컬 소스 조회 — 제어기가 보고한 파일명(`_network_NetManager.gpl`)으로 **로컬** 소스의 줄 배열을
 * 돌려준다. 찾지 못하면 `null`. 경로 해석은 호출부의 몫이다(배포는 `projectDir`, 트리는 워크스페이스).
 */
export type SourceLookup = (file: string) => string[] | null;

/**
 * 디렉터리 목록에서 파일명으로 로컬 소스를 찾는 `SourceLookup` 을 만든다.
 *
 * 제어기는 정지 위치를 **경로 없이 파일명만**(`_network_NetManager.gpl`) 보고하므로 각 디렉터리를
 * 얕게 재귀로 훑는다 — 프로젝트가 수십 개 파일 규모라 비용이 낮고, 라이브러리가 하위 폴더에 있는
 * 중첩 배치(`GPL_Code/` 안)도 함께 잡힌다. 조회 결과는 파일명 단위로 캐시한다.
 */
export function createFileSourceLookup(searchDirs: string[], opts?: { maxDepth?: number }): SourceLookup {
    const maxDepth = Math.max(0, opts?.maxDepth ?? 4);
    const cache = new Map<string, string[] | null>();

    function findIn(dir: string, target: string, depth: number): string | undefined {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return undefined;
        }
        for (const e of entries) {
            if (e.isFile() && e.name.toLowerCase() === target) { return path.join(dir, e.name); }
        }
        if (depth >= maxDepth) { return undefined; }
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') { continue; }
            const hit = findIn(path.join(dir, e.name), target, depth + 1);
            if (hit) { return hit; }
        }
        return undefined;
    }

    return (file: string): string[] | null => {
        const key = path.basename(file).toLowerCase();
        const cached = cache.get(key);
        if (cached !== undefined) { return cached; }
        let lines: string[] | null = null;
        for (const dir of searchDirs) {
            const hit = findIn(dir, key, 0);
            if (!hit) { continue; }
            try {
                lines = fs.readFileSync(hit, 'utf8').split(/\r?\n/);
            } catch {
                lines = null;
            }
            if (lines) { break; }
        }
        cache.set(key, lines);
        return lines;
    };
}

/** 정지 위치 샘플 1회. */
export interface StuckSample {
    state: string;
    file?: string;
    fileLine?: number;
    /** 목록에서 사라졌으면 true — 진단 도중 멈춘 것이다. */
    gone?: boolean;
}

/** 복구 후보 명령 1건. **전송하지 않는다** — 사람이 확인하고 보낸다. */
export interface RecoveryCandidate {
    command: string;
    reason: string;
}

export interface StuckThreadDiagnosis {
    thread: string;
    project?: string;
    samples: StuckSample[];
    /** 샘플 도중 쓰레드가 사라지거나 정지 상태가 됐다 — 더 볼 것 없다. */
    resolvedDuringSampling: boolean;
    /** 정지 위치가 한 번이라도 바뀌었는가. 샘플이 1개면 undefined. */
    positionMoved?: boolean;
    location?: { file: string; line: number; func?: string };
    /** 정지 위치의 소스 한 줄(주석·들여쓰기 원문 그대로). */
    sourceLine?: string;
    sourceContext: Array<{ line: number; text: string; current: boolean }>;
    /** 그 문장에서 뽑은 수신자 식(`NetworkManager.comReceiver(i)`). */
    receiver?: string;
    /** 그 문장에서 뽑은 메서드 이름(`Read`). */
    method?: string;
    /** 알려진 블로킹 계열 메서드인가(문서가 "블록하지 않는다"고 명시한 호출은 false). */
    blockingMethod: boolean;
    /** 문서가 무한 블록을 명시한 호출인가 — 정지 불가 쓰레드의 1순위 용의자. */
    unboundedBlocking?: boolean;
    /** 그 호출에 대한 문서 근거 한 줄(블로킹·비블로킹 양쪽). 리포트에 그대로 실린다. */
    blockingNote?: string;
    candidates: RecoveryCandidate[];
    /** 사람이 읽을 리포트(줄 배열, 접두 없음). */
    report: string[];
}

// ─── 문장 분석 (순수) ─────────────────────────────────────

/**
 * 문자열 리터럴과 주석을 같은 길이의 공백으로 덮는다 — 인덱스를 보존해야 원문에서 잘라낼 수 있다.
 */
function maskLiterals(s: string): string {
    let out = '';
    let inString = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inString) {
            out += c === '"' ? '"' : ' ';
            if (c === '"') { inString = false; }
            continue;
        }
        if (c === '"') {
            inString = true;
            out += c;
            continue;
        }
        if (c === "'") {
            // 주석 이후는 전부 덮는다.
            out += ' '.repeat(s.length - i);
            break;
        }
        out += c;
    }
    return out.length < s.length ? out + ' '.repeat(s.length - out.length) : out;
}

/** `index` 위치의 `)` 와 짝이 되는 `(` 의 인덱스. 못 찾으면 undefined. */
function matchOpenParen(s: string, index: number): number | undefined {
    let depth = 0;
    for (let i = index; i >= 0; i--) {
        if (s[i] === ')') { depth++; }
        else if (s[i] === '(') {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return undefined;
}

/** `dotIndex` 의 `.` 앞에 붙은 수신자 식의 시작 인덱스. 못 찾으면 undefined. */
function scanReceiverStart(s: string, dotIndex: number): number | undefined {
    let i = dotIndex - 1;
    let sawIdentifier = false;
    for (;;) {
        while (i >= 0 && /\s/.test(s[i])) { i--; }
        if (i < 0) { break; }
        if (s[i] === ')') {
            const open = matchOpenParen(s, i);
            if (open === undefined) { return undefined; }
            i = open - 1;
            continue;
        }
        if (!/[A-Za-z0-9_]/.test(s[i])) { break; }
        while (i >= 0 && /[A-Za-z0-9_]/.test(s[i])) { i--; }
        sawIdentifier = true;
        // 점으로 이어지면 계속 거슬러 올라간다 (`A.B(i).C` 의 `A.B(i)`).
        let j = i;
        while (j >= 0 && /\s/.test(s[j])) { j--; }
        if (j >= 0 && s[j] === '.') { i = j - 1; continue; }
        break;
    }
    return sawIdentifier ? i + 1 : undefined;
}

/**
 * 문장에서 **마지막 메서드 호출**의 수신자와 메서드 이름을 뽑는다.
 * `NetworkManager.comReceiver(i).Read()` → `{ receiver: 'NetworkManager.comReceiver(i)', method: 'Read' }`.
 *
 * 마지막 호출을 고르는 이유: 체인의 끝이 실제로 실행 중인 호출이기 때문이다
 * (`a.b(i).Read()` 에서 막히는 것은 `Read`, `b` 가 아니다).
 */
export function extractCallTarget(statement: string): { receiver: string; method: string } | undefined {
    const masked = maskLiterals(statement);
    const re = /\.\s*([A-Za-z_]\w*)\s*\(/g;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) { last = m; }
    if (!last) { return undefined; }

    const start = scanReceiverStart(masked, last.index);
    if (start === undefined) { return undefined; }
    const receiver = statement.slice(start, last.index).trim();
    if (!receiver || GPL_KEYWORDS.has(receiver.toLowerCase())) { return undefined; }
    return { receiver, method: last[1] };
}

/**
 * 수신자 식으로 복구 후보 명령을 만든다.
 *
 * 배열 인덱스가 **지역 변수**면(`comReceiver(i)`) 소스만으로는 어느 원소인지 확정할 수 없다 —
 * 활성 쓰레드는 `Show Stack`/`Show Variable` 을 거부하기 때문이다(`-750`). 그래서 `0`부터
 * `maxArrayIndexProbe` 까지 치환한 후보를 늘어놓는다. 존재하지 않는 원소는 제어기가
 * `-757 "Object not instantiated"` 로 떨어뜨리므로 순서대로 시도해도 무해하다.
 */
export function buildRecoveryCandidates(
    receiver: string,
    project: string,
    opts?: StuckDiagnosisOptions,
): RecoveryCandidate[] {
    const o = resolveOptions(opts);
    const candidates: RecoveryCandidate[] = [];
    const localIndex = receiver.match(/\(\s*([A-Za-z_]\w*)\s*\)\s*$/);

    if (localIndex) {
        for (let i = 0; i <= o.maxArrayIndexProbe; i++) {
            const expr = receiver.slice(0, localIndex.index) + `(${i})`;
            candidates.push({
                command: `Execute ${expr}.Close(), ${project}`,
                reason: i === 0
                    ? `인덱스 \`${localIndex[1]}\` 가 지역 변수라 확정 불가 — 0부터 시도`
                    : `앞 인덱스가 -757(미생성)이면 다음 후보`,
            });
        }
    } else {
        candidates.push({
            command: `Execute ${receiver}.Close(), ${project}`,
            reason: '쓰레드가 붙잡고 있는 자원을 밖에서 닫아 호출이 리턴하게 만든다',
        });
    }
    return candidates;
}

// ─── 진단 (IO 주입) ───────────────────────────────────────

function findThread(threads: ThreadInfo[], name: string): ThreadInfo | undefined {
    const target = name.trim().toLowerCase();
    return threads.find(t => t.name.trim().toLowerCase() === target);
}

function formatSample(s: StuckSample): string {
    if (s.gone) { return '목록에서 사라짐'; }
    const where = s.file && s.fileLine !== undefined ? ` @ ${s.file}:${s.fileLine}` : '';
    return `${s.state}${where}`;
}

/**
 * 정지 불가 쓰레드 하나를 진단한다. **읽기 전용** — `Show Thread  -web` 만 보낸다.
 *
 * `lookupSource` 는 로컬 소스를 읽는 콜백이다(없으면 소스 문맥·복구 후보 없이 샘플 결과만 나온다).
 */
export async function diagnoseStuckThread(
    io: ThreadStopIo,
    threadName: string,
    lookupSource?: SourceLookup,
    opts?: StuckDiagnosisOptions,
): Promise<StuckThreadDiagnosis> {
    const o = resolveOptions(opts);
    const samples: StuckSample[] = [];
    let last: ThreadInfo | undefined;
    let resolvedDuringSampling = false;

    for (let i = 0; i < o.sampleCount; i++) {
        if (io.isCancelled?.()) { break; }
        if (i > 0 && o.sampleIntervalMs > 0) { await io.sleep(o.sampleIntervalMs); }
        const probe = await probeThreads(io);
        if (probe === null) { continue; }
        const info = findThread(probe.threads, threadName);
        if (!info) {
            samples.push({ state: '(없음)', gone: true });
            resolvedDuringSampling = true;
            break;
        }
        last = info;
        samples.push({ state: info.state, file: info.file, fileLine: info.fileLine });
    }

    const located = samples.filter(s => !s.gone && s.fileLine !== undefined);
    const positionMoved = located.length >= 2
        ? located.some(s => s.fileLine !== located[0].fileLine || s.file !== located[0].file)
        : undefined;

    const diagnosis: StuckThreadDiagnosis = {
        thread: threadName,
        project: last?.project,
        samples,
        resolvedDuringSampling,
        positionMoved,
        sourceContext: [],
        blockingMethod: false,
        candidates: [],
        report: [],
    };

    if (last?.file && last.fileLine !== undefined) {
        diagnosis.location = { file: last.file, line: last.fileLine, func: last.func };
        const lines = lookupSource?.(last.file) ?? null;
        if (lines) {
            const idx = last.fileLine - 1; // 제어기 보고는 1-based
            diagnosis.sourceLine = lines[idx];
            const from = Math.max(0, idx - o.contextLines);
            const to = Math.min(lines.length - 1, idx + o.contextLines);
            for (let n = from; n <= to; n++) {
                diagnosis.sourceContext.push({ line: n + 1, text: lines[n] ?? '', current: n === idx });
            }
            const target = diagnosis.sourceLine ? extractCallTarget(diagnosis.sourceLine) : undefined;
            if (target) {
                diagnosis.receiver = target.receiver;
                diagnosis.method = target.method;
                const method = target.method.toLowerCase();
                const unbounded = UNBOUNDED_BLOCKING_METHODS.get(method);
                const nonBlocking = NONBLOCKING_METHODS.get(method);
                diagnosis.unboundedBlocking = unbounded !== undefined;
                diagnosis.blockingMethod = unbounded !== undefined
                    || (nonBlocking === undefined && BLOCKING_METHODS.has(method));
                diagnosis.blockingNote = unbounded ?? nonBlocking;
                const project = last.project || threadName;
                diagnosis.candidates = buildRecoveryCandidates(target.receiver, project, opts);
            }
        }
    }

    diagnosis.report = buildReport(diagnosis);
    if (o.logReport) {
        for (const line of diagnosis.report) { io.log(`${o.logPrefix}${line}`); }
    }
    return diagnosis;
}

/** 진단 결과를 사람이 읽을 줄 배열로 만든다(접두 없음 — 호출부가 붙인다). */
export function buildReport(d: StuckThreadDiagnosis): string[] {
    const out: string[] = [];
    out.push(`── [정지 불가 진단] ${d.thread} ${'─'.repeat(Math.max(0, 34 - d.thread.length))}`);

    if (d.resolvedDuringSampling) {
        out.push('✔ 진단 중 쓰레드가 목록에서 사라졌습니다 — 정지가 뒤늦게 적용된 것으로 보입니다.');
        out.push('  Show Thread 로 한 번 더 확인하세요.');
        return out;
    }

    out.push(`위치 샘플 ${d.samples.length}회: ${d.samples.map(formatSample).join(' · ')}`);
    if (d.positionMoved === true) {
        out.push('→ 위치가 움직입니다. 블로킹이 아니라 빠져나오지 못하는 루프일 수 있습니다.');
    } else if (d.positionMoved === false) {
        out.push('→ 위치가 고정입니다. 다만 루프 시간의 대부분을 차지하는 I/O 호출도 이렇게 보이므로,');
        out.push('  고정 = 블로킹이라고 단정하지 말고 아래 소스로 판단하세요.');
    }

    if (!d.location) {
        out.push('정지 위치를 보고받지 못했습니다(Show Thread 에 파일/줄 없음) — 여기서 더 좁힐 수 없습니다.');
        return out;
    }

    out.push(`정지 위치: ${d.location.file}:${d.location.line}${d.location.func ? ` (${d.location.func})` : ''}`);

    if (d.sourceContext.length === 0) {
        out.push('로컬 소스를 찾지 못해 그 줄을 읽지 못했습니다 — 프로젝트를 열면 소스 문맥까지 나옵니다.');
    } else {
        for (const c of d.sourceContext) {
            out.push(`${c.current ? '▶' : ' '} ${String(c.line).padStart(5)}  ${c.text}`);
        }
    }

    if (!d.receiver) {
        out.push('그 줄에서 호출 대상을 뽑지 못했습니다 — 복구 후보를 만들 수 없습니다.');
        return out;
    }

    const blockingSuffix = d.unboundedBlocking
        ? ' — 문서상 **영구 대기**할 수 있는 호출입니다'
        : d.blockingMethod ? ' — 대기할 수 있는 호출입니다' : '';
    out.push(`호출 대상: ${d.receiver}.${d.method}()${blockingSuffix}`);
    if (d.blockingNote) {
        out.push(`  근거: ${d.blockingNote}`);
    }
    if (d.unboundedBlocking && d.positionMoved === false) {
        out.push(`  주의: ${BLOCK_VS_SPIN_CAVEAT}`);
    }
    out.push('');
    out.push('복구 후보 (자동 전송하지 않습니다 — 확인하고 보내세요):');
    for (const c of d.candidates) {
        out.push(`  > ${c.command}`);
        out.push(`      ${c.reason}`);
    }
    out.push('');
    out.push('주의:');
    out.push('  · 자원을 닫으면 프로젝트가 반쪽 상태가 됩니다 — 정지 후 반드시 새 Start 로 재초기화하세요.');
    out.push('  · `-757 "Object not instantiated"` 는 그 인덱스가 Nothing 이라는 뜻이니 다음 후보로 넘어가세요.');
    out.push('  · `-712 "Invalid syntax"` 면 모듈명까지 붙여 다시 시도하세요(`<Module>.<Class>.<field>`).');
    out.push('  · 실패한 `Execute` 는 `_Cmd_<project>` 쓰레드를 에러로 남기므로 `Stop -all` 로 같이 정리합니다.');
    return out;
}
