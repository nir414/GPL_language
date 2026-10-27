/**
 * 로컬 소스가 제어기 컴파일 코드보다 새로운지 판정(GitHub #21) — 컴파일 스냅샷(deployRecord) 대조·세션 중 저장 감지·BP 강등/복원.
 *
 * 판정 근거는 "우리가 올려서 컴파일한 소스의 스냅샷"이지 제어기 상태가 아니다(§0 — 제어기 상태는 <STATUS> 로만). stale 파일의 BP 는
 * 제어기에는 종전대로 설정하되 verified=false 로 강등하고, 재컴파일 기록이 오면 복원한다. 상태바 배지는 `gpl.sourceStale` 이벤트로.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 */

import { Event } from '@vscode/debugadapter';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getCompiledRecord, compareWithLocal, formatCompiledAt } from '../../controller/deployment/deployRecord';
import type { CompiledRecord, SnapshotDiff } from '../../controller/deployment/deployRecord';
import type { DebugSessionIo } from './sessionIo';
import type { SessionSources } from './sessionSources';
import type { SessionBreakpoints } from './sessionBreakpoints';

/**
 * "로컬 소스가 제어기 컴파일 코드보다 새로움" 항목. 근거:
 * - compiled-before-edit: 마지막 Compile 스냅샷(deployRecord)과 파일 내용(sha1)이 다름
 * - saved-in-session: 이 디버그 세션 중 저장됨(스냅샷이 없어도 확정 가능 — 제어기는 attach 전 코드를 실행 중)
 */
export interface StaleSourceEntry {
    /** 프로젝트 폴더 기준 상대 경로('/' 구분) — 이벤트/로그 표기용 */
    relPath: string;
    reason: 'compiled-before-edit' | 'saved-in-session';
    /** 세션 중 저장 시각(ms). 컴파일 기록이 이 시각 이후로 갱신되면(재컴파일) 해제 */
    savedAt?: number;
}

export class SourceStalenessTracker {
    constructor(
        private readonly io: DebugSessionIo,
        private readonly sources: SessionSources,
        private readonly breakpoints: SessionBreakpoints,
    ) {}

    // GitHub #21: 제어기 컴파일 코드보다 새로운 로컬 소스(basename 소문자 → 항목). 이 파일들의 BP 는
    // 제어기에는 종전대로 설정하되 verified=false 로 강등한다 — 제어기는 옛 컴파일 코드의 줄 번호로 BP 를
    // 받아 "성공"을 돌려주지만 실제 코드 줄과 어긋나 절대 걸리지 않을 수 있다.
    staleFiles = new Map<string, StaleSourceEntry>();

    // 판정에 쓴 컴파일 기록의 시각(BP message/이벤트 표기용). 기록 없음 = undefined
    compiledRecordAt: number | undefined;

    private staleNoRecordLogged = false;

    /**
     * 컴파일 스냅샷(deployRecord)과 현재 로컬 소스를 비교해 _staleFiles 를 재구성하고 `gpl.sourceStale` 이벤트를
     * 보낸다(빈 목록 = 해소 → 확장이 상태바 배지를 지운다). 판정 근거는 "우리가 올려서 컴파일한 소스의 스냅샷"이며
     * 제어기 상태가 아니다(§0 — 제어기 상태는 <STATUS> 로만 판정).
     * - 기록 없음: 판정 불가 → 1회 로그, 'compiled-before-edit' 항목은 버리고(세션 중 저장 항목은 유지) 이벤트 전송.
     * - .gpl/.gpo 만 stale 대상. .gpr 변경은 'project-file' 로 로그만(파일 목록/옵션 변경은 BP 줄 번호와 무관).
     * - 세션 중 저장(saved-in-session) 항목은 기록이 그 저장 이후 갱신된 경우(재컴파일)에만 해제한다.
     */
    evaluateSourceStaleness(trigger: string): void {
        const rec = this.io.config && this.io.projectName
            ? getCompiledRecord(this.io.config.ip, this.io.projectName)
            : undefined;
        if (!rec) {
            if (!this.staleNoRecordLogged) {
                this.staleNoRecordLogged = true;
                this.io.log(this.io.projectName
                    ? '[stale] 배포 기록 없음 — 이 워크스페이스에서 Deploy/F5 로 컴파일한 이력이 없어 BP 신뢰성을 판정할 수 없습니다 (GitHub #21)'
                    : '[stale] 프로젝트명 미확정 — BP 신뢰성 판정을 생략합니다 (GitHub #21)');
            }
            this.compiledRecordAt = undefined;
            for (const [key, e] of [...this.staleFiles]) {
                if (e.reason === 'compiled-before-edit') { this.staleFiles.delete(key); }
            }
            this.sendSourceStaleEvent(trigger);
            return;
        }

        // 비교 기준 폴더: 기록의 projectDir 이 이 세션의 프로젝트 폴더 중 하나면 그것, 아니면 첫 프로젝트 폴더
        // (워크스페이스에 사본이 있어도 디버그 대상 폴더로 비교), 둘 다 없으면 기록의 폴더.
        const projectDir = this.sources.projectDirs.find(d => this.sources.isSamePath(d, rec.projectDir))
            ?? this.sources.projectDirs[0]
            ?? rec.projectDir;
        let diff: SnapshotDiff;
        try {
            diff = compareWithLocal(rec, projectDir);
        } catch (err: any) {
            this.io.log(`[stale] 스냅샷 비교 실패(무시): ${err?.message ?? err} — ${projectDir}`);
            return;
        }
        this.compiledRecordAt = rec.compiledAt;

        const isSource = (p: string) => /\.(gpl|gpo)$/i.test(p);
        const next = new Map<string, StaleSourceEntry>();
        for (const rel of diff.stale) {
            if (!isSource(rel)) { continue; }
            next.set(path.posix.basename(rel).toLowerCase(), { relPath: rel, reason: 'compiled-before-edit' });
        }
        // 세션 중 저장 항목 이월 — 기록이 저장 이후 갱신됐으면(재컴파일) 해제
        for (const [key, e] of this.staleFiles) {
            if (e.reason !== 'saved-in-session' || next.has(key)) { continue; }
            if (rec.compiledAt > (e.savedAt ?? 0)) { continue; }
            next.set(key, e);
        }
        this.staleFiles = next;

        const when = formatCompiledAt(rec.compiledAt);
        if (next.size > 0) {
            const list = [...next.values()].map(e => e.relPath).join(', ');
            this.io.log(`[stale] 마지막 Compile(${when}) 이후 변경된 소스 ${next.size}개 (${trigger}): ${list} — 이 파일들의 BP 는 재배포 전까지 신뢰 불가 (GitHub #21)`);
        } else {
            this.io.log(`[stale] 로컬 소스가 마지막 Compile(${when}) 스냅샷과 일치 (${trigger})`);
        }
        const gprChanged = diff.stale.filter(p => /\.gpr$/i.test(p));
        if (gprChanged.length > 0) {
            this.io.log(`[stale] project-file 변경: ${gprChanged.join(', ')} — 파일 목록/옵션이 바뀌었을 수 있습니다(BP 판정에는 미반영)`);
        }
        const composition = [
            ...diff.missing.filter(isSource).map(p => `삭제 ${p}`),
            ...diff.added.filter(isSource).map(p => `추가 ${p}`),
        ];
        if (composition.length > 0) {
            this.io.log(`[stale] 컴파일 이후 파일 구성 변경: ${composition.join(', ')} (추가된 파일은 제어기에 코드가 없어 BP 가 걸리지 않습니다)`);
        }
        this.sendSourceStaleEvent(trigger);
    }

    /** 확장(extension.ts)이 상태바 배지/알림으로 표시하는 커스텀 이벤트. staleFiles 가 비어 있으면 해소. */
    sendSourceStaleEvent(trigger: string): void {
        this.io.sendEvent(new Event('gpl.sourceStale', {
            projectName: this.io.projectName,
            compiledAt: this.compiledRecordAt,
            staleFiles: [...this.staleFiles.values()].map(e => e.relPath),
            trigger,
        }));
    }

    /** stale 파일 BP 의 DAP message(BREAKPOINTS 뷰 툴팁). 기록이 없으면 세션 중 저장 근거로 표기. */
    staleBreakpointMessage(): string {
        const since = this.compiledRecordAt !== undefined
            ? `마지막 Compile ${formatCompiledAt(this.compiledRecordAt)} 이후 수정`
            : '이 디버그 세션 중 저장됨';
        return `소스가 제어기 컴파일 코드보다 새로움(${since}) — Stop + Upload + Run 으로 재배포해야 BP 가 실제 코드 줄에 걸립니다`;
    }

    /**
     * 세션 중 .gpl/.gpo 저장 감지(디버그 대상 프로젝트 폴더 아래만). 저장 내용이 컴파일 스냅샷과 같으면
     * (무변경 저장·되돌리기) stale 이 아니며 오히려 기존 stale 을 해제한다 — 기록이 있을 때만 판정 가능.
     * 그 외에는 'saved-in-session' 으로 표시하고 그 파일의 BP 를 BreakpointEvent 로 강등한다.
     */
    onSourceSavedInSession(uri: { scheme: string; fsPath: string }): void {
        if (!this.io.isConnected || uri.scheme !== 'file') { return; }
        const fsPath = uri.fsPath;
        if (!/\.(gpl|gpo)$/i.test(fsPath)) { return; }
        const dir = this.sources.projectDirs.find(d => this.sources.isPathUnder(fsPath, d));
        if (!dir) { return; } // 다른 프로젝트/사본 폴더의 파일은 이 세션과 무관
        const relPath = path.relative(dir, fsPath).replace(/\\/g, '/');
        const key = path.basename(fsPath).toLowerCase();

        const rec = this.io.config ? getCompiledRecord(this.io.config.ip, this.io.projectName) : undefined;
        if (rec && this.matchesCompiledSnapshot(rec, relPath, fsPath)) {
            if (this.staleFiles.delete(key)) {
                this.io.log(`[stale] ${relPath} 저장 내용이 컴파일 스냅샷과 일치 — stale 해제, BP 신뢰성 복원 (GitHub #21)`);
                this.breakpoints.emitBreakpointStateForFile(key, true);
                this.sendSourceStaleEvent('saved');
            }
            return;
        }

        const existing = this.staleFiles.get(key);
        const savedAt = Date.now();
        this.staleFiles.set(key, existing
            ? { ...existing, savedAt }
            : { relPath, reason: 'saved-in-session', savedAt });
        if (existing) { return; } // 이미 stale — BP 는 강등돼 있고 배지도 표시 중(중복 이벤트/로그 방지)
        this.io.log(`[stale] 세션 중 저장 감지: ${relPath} — 제어기는 옛 컴파일 코드를 실행 중이므로 이 파일의 BP 는 재배포 전까지 신뢰 불가 (GitHub #21)`);
        this.breakpoints.emitBreakpointStateForFile(key, false, this.staleBreakpointMessage());
        this.sendSourceStaleEvent('saved');
    }

    /** 컴파일 성공 기록이 갱신되면(같은 제어기·프로젝트) stale 을 재평가하고 풀린/새로 생긴 파일의 BP 상태를 갱신한다. */
    onRecordCompiled(rec: CompiledRecord): void {
        if (!this.io.isConnected || !this.io.config) { return; }
        if (rec.ip.trim().toLowerCase() !== this.io.config.ip.trim().toLowerCase()) { return; }
        if (rec.projectName.trim().toLowerCase() !== this.io.projectName.trim().toLowerCase()) { return; }
        // 재컴파일로 프로젝트 구성(.gpr 의 ProjectSource/ProjectLibrary)이 바뀌었을 수 있으므로
        // "제어기가 거부한 파일" 기억을 버린다 — 다음 BP 설정은 폴백까지 다시 시도한다.
        this.breakpoints.bpRejectedFiles.clear();
        const before = new Set(this.staleFiles.keys());
        this.evaluateSourceStaleness('recompiled');
        for (const key of before) {
            if (!this.staleFiles.has(key)) { this.breakpoints.emitBreakpointStateForFile(key, true); }
        }
        const message = this.staleBreakpointMessage();
        for (const key of this.staleFiles.keys()) {
            if (!before.has(key)) { this.breakpoints.emitBreakpointStateForFile(key, false, message); }
        }
    }

    /** 저장된 파일의 sha1 이 기록의 스냅샷과 같은가(경로는 '/'·대소문자 무시 비교). 스탬프/sha1 없으면 false. */
    private matchesCompiledSnapshot(rec: CompiledRecord, relPath: string, fsPath: string): boolean {
        const want = relPath.toLowerCase();
        const stampKey = Object.keys(rec.files).find(k => k.replace(/\\/g, '/').toLowerCase() === want);
        const stamp = stampKey ? rec.files[stampKey] : undefined;
        if (!stamp?.sha1) { return false; }
        try {
            return crypto.createHash('sha1').update(fs.readFileSync(fsPath)).digest('hex') === stamp.sha1;
        } catch {
            return false;
        }
    }
}
