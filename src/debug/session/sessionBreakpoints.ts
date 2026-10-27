/**
 * 세션이 제어기에 설정한 중단점의 장부와 `Set Break`/`Set Nobreak` 전송 규칙.
 *
 * 소스 BP·프로시저 이름 BP·Step Into Target 임시 BP·조건 메타·DAP id, 그리고 표기 폴백(무공백/문서 표기 × basename/프로젝트
 * 상대 경로)과 -508(ProjectLibrary 소스) 안내, 기존 BP 보존(preserveExistingBreakpoints) 규칙이 여기 있다.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 */

import { BreakpointEvent } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import * as fs from 'fs';
import { ResolvedBreakpointTarget, resolveBreakpointTarget } from '../../project/remote/breakpointTarget';
import { normalizeBreakpointCommandFile } from '../../controller/debugging/breakpointCommand';
import { breakpointKey } from '../../controller/debugging/breakpointReconcile';
import { parseBreakList, isSuccess } from '../../controller/protocol/responseParser';
import type { DebugSessionIo } from './sessionIo';
import type { SessionSources } from './sessionSources';

/**
 * BP 하나에 붙은 조건 메타. 제어기에는 조건 개념이 없으므로 어댑터가 적중 시점에 판정한다.
 * `hits`는 이 세션에서 그 줄이 적중한 횟수(히트 조건 판정용).
 */
export interface BreakpointMeta {
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
    hits: number;
}

/** 프로시저 이름 브레이크포인트 한 개. */
export interface FunctionBreakpointEntry {
    /** 사용자가 입력한 이름(`Class.Proc` 또는 `Proc`) */
    name: string;
    /** 해석된 파일 basename */
    file: string;
    /** 해석된 1-based 줄(첫 실행 문장) */
    line: number;
    id: number;
}

export class SessionBreakpoints {
    constructor(private readonly io: DebugSessionIo, private readonly sources: SessionSources) {}

    // Breakpoint tracking — file basename → set of line numbers
    breakpoints = new Map<string, Set<number>>();

    bpIds = new Map<string, Map<number, number>>();

    // DAP breakpoint id(BreakpointEvent 로 verified 상태를 바꾸려면 id 가 필요) — basename 소문자 → (line → id)
    bpIdCounter = 0;

    // ── 조건부 BP / 히트 조건 / 로그포인트 (클라이언트 측 흉내, 기본 OFF) ──────────────
    // 제어기 `Set Break` 에는 조건·히트 조건·로그 스위치가 없다(공식 문서 확인). 그래서 조건은
    // "적중 → 조건 평가 → 불일치면 자동 Continue" 로 흉내낸다. 자동 재개는 모션을 다시 움직이므로
    // 설정으로 켤 때만 동작한다. 키: basename 소문자 → 줄 번호 → 메타.
    bpMeta = new Map<string, Map<number, BreakpointMeta>>();

    // ── 프로시저 이름 브레이크포인트 ─────────────────────────────────────────────
    // VS Code BREAKPOINTS 뷰의 함수 BP. 파서로 `Class.Proc` → 파일·첫 실행 줄을 찾아 Set Break 로 바꾼다.
    // 소스 BP 와 같은 파일에 있을 수 있으므로 setBreakPointsRequest 의 파일 정리에서 제외해야 한다.
    functionBps: FunctionBreakpointEntry[] = [];

    // Step Into Target 이 심어 둔 임시 BP(정지 후 정리). basename 소문자 → 줄 집합.
    tempBreakpoints = new Map<string, Set<number>>();

    /**
     * 제어기가 `-508 File not found` 로 거부한 BP 대상 파일(basename 소문자). 같은 파일의 다음
     * 줄부터는 표기 폴백(최대 4왕복)을 생략하고 1회만 시도한다 — 어차피 표기 문제가 아니다.
     */
    bpRejectedFiles = new Set<string>();

    /** BP 대상 파일을 프로젝트 기준 상대 경로로 지칭해야 하는 제어기인지(첫 성공에서 학습). */
    private bpPreferProjectRelativeFile = false;

    preserveExistingBreakpoints = false;

    preservedBreakpoints = new Set<string>();

    preservedBreakpointResponse = '';

    /**
     * 브레이크포인트 명령 문자열 생성 — 모든 전송 지점이 이 헬퍼를 사용한다.
     * GDE 패킷 캡처 실측(runbook) 형식: `Set Break <proj> "<file>"<line>` —
     * 닫는 따옴표와 줄번호 사이에 공백이 없다.
     */
    bpCommand(kind: 'Break' | 'Nobreak', project: string, file: string, line: number): string {
        return `Set ${kind} ${project} "${file}"${line}`;
    }

    /**
     * 공식 문서 표기(따옴표와 줄번호 사이 **공백 있음**): `Set Break My_project "Testfile.gpl" 30`.
     * 실기기(GDE 캡처)는 공백 없는 형식이 동작하는 것이 확인됐지만 `Set Nobreak` 는 캡처 근거가 없어,
     * 무공백 형식이 실패하면 문서 표기로 한 번 더 시도한다(`_sendBpCommandWithFallback`).
     */
    private bpCommandSpaced(kind: 'Break' | 'Nobreak', project: string, file: string, line: number): string {
        return `Set ${kind} ${project} "${file}" ${line}`;
    }

    /**
     * BP 명령에서 파일을 지칭할 후보 표기 — ① 파일명(basename) → ② 프로젝트 기준 상대 경로.
     *
     * 프로젝트가 하위 폴더로 나뉘면(`ProjectSource="T1\T2\T2.gpl"`, 2026-08-28 실제 파일 확인)
     * 제어기가 소스를 파일명으로 아는지 상대 경로로 아는지는 실기기 확인 사항이다(공식 문서 예시는
     * `Set Break My_project "Testfile.gpl" 30` — 평면 프로젝트만 보여 준다). 평면 프로젝트에서는
     * 두 표기가 같으므로 후보가 하나뿐이고, 보내는 명령도 종전과 완전히 동일하다.
     */
    bpFileForms(file: string): string[] {
        if (/[\\/]/.test(file)) { return [normalizeBreakpointCommandFile(file)]; }
        const base = file.replace(/^.*[\\/]/, '');
        if (this.sources.projectDirs.length === 0) { return [base]; }
        const local = this.sources.resolveSourcePath(base);
        const dir = this.sources.projectDirs.find(d => this.sources.isPathUnder(local, d));
        if (!dir) { return [base]; }
        const rel = path.relative(dir, local);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { return [base]; }
        const gprStyle = rel.replace(/\//g, '\\');
        return gprStyle.toLowerCase() === base.toLowerCase() ? [base] : [base, gprStyle];
    }

    /**
     * BP 설정/해제 전송 — 무공백(실측) 형식으로 먼저 보내고, STATUS 실패면 문서 표기(공백)로 재시도한다.
     * 문서상 `Set Nobreak` 는 대상이 없어도 에러가 아니므로, 실패 STATUS 는 형식 거부로 볼 수 있다.
     *
     * 하위 폴더 소스는 파일명 표기가 거부될 수 있어(`_bpFileForms`) 두 표기를 순서대로 시도하고,
     * 성공한 표기를 세션에 기억해 다음부터 먼저 보낸다. 평면 프로젝트는 후보가 하나라 종전과 같다.
     * @returns 성공한 응답 문자열, 모두 실패하면 마지막 응답(또는 null)
     */
    async sendBpCommandWithFallback(
        kind: 'Break' | 'Nobreak',
        project: string,
        file: string,
        line: number,
    ): Promise<string | null> {
        const forms = this.bpFileForms(file);
        if (this.preserveExistingBreakpoints && forms.some(form => this.preservedBreakpoints.has(breakpointKey({ file: form, line })))) {
            this.io.log(`기존 BP 유지: ${file}:${line} — Set ${kind} 전송 생략`);
            // Attach에서 받은 실제 Show Break 응답이다. 기존 BP를 다시 설정/해제하지 않는다.
            return this.preservedBreakpointResponse;
        }
        const ordered = this.bpPreferProjectRelativeFile && forms.length > 1
            ? [...forms].reverse()
            : forms;

        let last: string | null = null;
        for (const form of ordered) {
            const primary = await this.io.sendCmd(this.bpCommand(kind, project, form, line));
            if (primary !== null && (isSuccess(primary) || /Duplicate breakpoint/i.test(primary))) {
                this.noteBpFileForm(form, file);
                return primary;
            }
            const spacedCmd = this.bpCommandSpaced(kind, project, form, line);
            this.io.log(`Set ${kind} 무공백 형식 실패 → 문서 표기로 재시도: ${spacedCmd}`);
            const fallback = await this.io.sendCmd(spacedCmd);
            if (fallback !== null && isSuccess(fallback)) {
                this.io.log(`✔ 문서 표기(${kind}, 공백 있음)가 동작했습니다 — 이 제어기는 문서 형식을 요구합니다.`);
                this.noteBpFileForm(form, file);
                return fallback;
            }
            last = fallback ?? primary;
            if (ordered.length > 1 && form === ordered[0]) {
                this.io.log(`Set ${kind}: 파일 표기 "${form}" 거부 → 다른 표기로 재시도합니다.`);
            }
        }
        return last;
    }

    private noteBpFileForm(usedForm: string, requestedFile: string): void {
        const base = requestedFile.replace(/^.*[\\/]/, '');
        const isRelative = usedForm.toLowerCase() !== base.toLowerCase();
        if (isRelative && !this.bpPreferProjectRelativeFile) {
            this.bpPreferProjectRelativeFile = true;
            this.io.log(
                `✔ 이 제어기는 BP 대상 파일을 프로젝트 기준 상대 경로로 받습니다("${usedForm}") — `
                + '이후 BP 명령은 이 표기를 먼저 씁니다.',
            );
        }
    }

    /** 성공한 파일 표기가 상대 경로였으면 이 세션에서는 그 표기를 먼저 쓴다(명령 왕복 절감). */
    /**
     * BP 대상 파일이 `ProjectLibrary` 로 참조된 하위 프로젝트의 소스면, 사용자가 손 쓸 수 있는
     * 안내 문구를 돌려준다(아니면 undefined).
     *
     * 실측(2026-08-31, 시뮬레이터 192.168.0.1): 제어기는 `Set Break <project> "<file>"<line>` 의
     * 파일을 **그 프로젝트가 직접 선언한 `ProjectSource`** 안에서만 찾는다. `ProjectLibrary` 로
     * 접혀 들어온 소스는 코드로는 실행되고 `Show Thread`·`Show Stack` 에도
     * `GPL_Code\Lib_Net/TcpServer.gpl` 처럼 나오지만 BP 대상 파일로는 잡히지 않아, 어떤 표기를
     * 써도 `-508` 이다(basename·프로젝트 상대·제어기 보고 문자열 그대로·절대경로·라이브러리
     * 프로젝트명 조합 등 12종 확인). 같은 시점에 메인 프로젝트 소스는 STATUS 0 으로 성공했다.
     * 배경과 실험 기록은 `docs/ai-handoff.md` §1-CK(-508 규명)·§1-CT(승격 검증·자동화).
     */
    librarySourceBpHint(file: string): string | undefined {
        if (this.sources.libraryDirs.length === 0) { return undefined; }
        const base = file.replace(/^.*[\\/]/, '');
        const local = this.sources.resolveSourcePath(base);
        const libDir = this.sources.libraryDirs.find(d => this.sources.isPathUnder(local, d));
        if (!libDir) { return undefined; }

        const libName = path.basename(libDir);
        // 메인 프로젝트 폴더 기준 상대 경로 — Project.gpr 에 그대로 적을 수 있는 형태로 보여 준다.
        const isLibrary = (d: string) => this.sources.libraryDirs.some(l => l.toLowerCase() === d.toLowerCase());
        const mainDir = this.sources.projectDirs.find(d => !isLibrary(d) && this.sources.isPathUnder(local, d));
        const rel = mainDir ? path.relative(mainDir, local).replace(/\//g, '\\') : base;
        return `${base} 은 ProjectLibrary 로 참조된 하위 프로젝트(${libName})의 소스입니다. `
            + '제어기는 BP 대상 파일을 그 프로젝트가 직접 선언한 ProjectSource 안에서만 찾으므로, '
            + '라이브러리 경유 소스에는 그대로는 브레이크포인트를 걸 수 없습니다(-508). '
            + `메인 프로젝트 Project.gpr 에 ProjectSource="${rel}" 로 직접 등재하면 걸립니다`
            + '(2026-09-02 실측 확인). 명령 팔레트의 '
            + '"GPL: Promote Source for Breakpoint (중단점용 소스 승격)"(gpl.project.promoteSourceForBreakpoint)이 '
            + '그 편집을 계산해 미리보기로 보여 줍니다 — 대상 파일을 끌어오는 ProjectLibrary 참조를 빼고 '
            + '그 그룹이 제공하던 나머지 라이브러리를 개별 참조로 되살려, 컴파일 집합을 그대로 유지합니다.';
    }

    /** 현재 메인 compile unit의 `.gpr` 원문으로 BP target을 판정한다. */
    resolveBreakpointTarget(localPath: string, line: number): ResolvedBreakpointTarget | undefined {
        let outside: ResolvedBreakpointTarget | undefined;
        for (const gprPath of this.sources.mainProjectGprs) {
            try {
                const result = resolveBreakpointTarget({
                    gprPath,
                    gprText: fs.readFileSync(gprPath, 'utf8'),
                    localPath,
                    line,
                    knownGprPaths: this.sources.knownGprPaths,
                });
                if (result.kind !== 'outside-project') { return result; }
                outside = outside ?? result;
            } catch { /* 다음 동명 프로젝트 후보 확인 */ }
        }
        return outside;
    }

    /**
     * 이 위치에 우리가 설정한 BP 가 있는가 — 소스 BP(`_breakpoints`) · 함수 BP(`_functionBps`) ·
     * Step Into Target 임시 BP(`_tempBreakpoints`) 를 모두 본다. 파일은 basename 대소문자 무시 비교.
     */
    hasBreakpointAt(file: string, line: number): boolean {
        if (!file || line <= 0) { return false; }
        const base = path.basename(file);
        const key = base.toLowerCase();

        for (const [name, lines] of this.breakpoints) {
            if (path.basename(name).toLowerCase() === key && lines.has(line)) { return true; }
        }
        if (this.tempBreakpoints.get(key)?.has(line)) { return true; }
        return this.functionBps.some(f => f.file.toLowerCase() === key && f.line === line);
    }

    /** Step Into Target 이 심어 둔 임시 BP 를 모두 해제한다(같은 줄에 사용자 BP 가 있으면 남긴다). */
    async clearTempBreakpoints(): Promise<void> {
        const proj = this.io.projectName;
        if (!proj || this.tempBreakpoints.size === 0) { return; }
        for (const [fileKey, lines] of this.tempBreakpoints) {
            for (const line of lines) {
                const userLines = [...this.breakpoints.entries()]
                    .find(([file]) => path.basename(file).toLowerCase() === fileKey.toLowerCase())?.[1];
                const isFunctionBp = this.functionBps.some(
                    f => f.file.toLowerCase() === fileKey && f.line === line,
                );
                if (userLines?.has(line) || isFunctionBp) { continue; }
                await this.sendBpCommandWithFallback('Nobreak', proj, fileKey, line);
            }
        }
        this.tempBreakpoints.clear();
    }

    /** 문서 제약: 동시 BP는 최대 32개. 넘으면 제어기가 거부할 수 있으므로 알린다. */
    warnIfBreakpointLimitExceeded(): void {
        let total = this.functionBps.length;
        for (const lines of this.breakpoints.values()) { total += lines.size; }
        if (total > 32) {
            this.io.log(`⚠ 브레이크포인트 ${total}개 — 공식 문서상 동시 상한은 32개입니다. 초과분은 제어기가 거부할 수 있습니다.`);
        }
    }

    /**
     * Clear all controller breakpoints for the specified project.
     */
    async clearBreakpointsForProject(projectName: string): Promise<void> {
        const showResp = await this.io.sendCmd('Show Break');
        if (!showResp) {
            this.io.log('attach preflight: Show Break 실패(브레이크포인트 정리 스킵)');
            return;
        }

        const controllerBps = parseBreakList(showResp).filter(
            b => (b.project || '').toLowerCase() === projectName.toLowerCase(),
        );

        if (controllerBps.length === 0) {
            this.io.log(`attach preflight: ${projectName} 브레이크포인트 없음`);
            return;
        }

        let cleared = 0;
        for (const bp of controllerBps) {
            const file = bp.file || '';
            const line = bp.fileLine || 0;
            if (!file || line <= 0) { continue; }
            const resp = await this.io.sendCmd(this.bpCommand('Nobreak', projectName, file, line));
            if (resp) { cleared++; }
        }

        this.io.log(`attach preflight: ${projectName} 브레이크포인트 ${cleared}/${controllerBps.length} 정리`);
    }

    /**
     * 파일의 BP 들에 BreakpointEvent('changed') 로 verified/message 를 갱신한다. 제어기가 실제로 받아준 줄
     * (_breakpoints)만 대상 — STATUS 실패로 verified=false 였던 BP 를 true 로 올리지 않는다.
     */
    emitBreakpointStateForFile(key: string, verified: boolean, message?: string): void {
        const idMap = this.bpIds.get(key);
        if (!idMap || idMap.size === 0) { return; }
        const acceptedEntry = [...this.breakpoints.entries()]
            .find(([file]) => path.basename(file).toLowerCase() === key);
        const accepted = acceptedEntry?.[1] ?? new Set<number>();
        for (const [line, id] of idMap) {
            if (!accepted.has(line)) { continue; }
            const bp: DebugProtocol.Breakpoint = { id, verified, line };
            if (!verified && message) { bp.message = message; }
            this.io.sendEvent(new BreakpointEvent('changed', bp));
        }
    }
}
