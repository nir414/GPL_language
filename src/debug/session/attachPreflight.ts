/**
 * Attach 전후의 제어기 준비 절차 — F5 배포(build-only)·Start 전 배포 잠금 대기·전체 정지(attach preflight)·프로젝트 BP 정리.
 *
 * 배포는 `controller/deployment/deployService.deploy` 를 그대로 부르되 디버그 경로의 옵션(directGpl·skipStart·confirmStopOnActive 모달)을
 * 여기서 고정한다. 컴파일 진단과 "GPL Deploy (Debug)" 출력 채널은 세션이 아니라 모듈 공용(세션이 끝나도 Problems 에 남아야 한다).
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 * vscode 모달·출력 채널을 쓰므로 vscode 허용 목록에 있다.
 */

import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import { deploy, jumpToFirstCompileError } from '../../controller/deployment/deployService';
import { getDeployLock, describeDeployLock } from '../../controller/deployment/deployLock';
import { stopAllAndSettle } from '../../controller/threads/threadStop';
import type { ThreadStopIo } from '../../controller/threads/threadStop';
import type { DebugSessionIo } from './sessionIo';
import type { SessionSources } from './sessionSources';
import type { SessionBreakpoints } from './sessionBreakpoints';

// 디버그 경로(Attach 전 배포)의 컴파일 진단은 세션 인스턴스가 아니라 모듈 공용 컬렉션에 둔다.
// 이유: 세션마다 새 컬렉션을 만들면 (a) 종료 시 지워져 Problems에서 사라지고,
//       (b) 재시도 시 옛 컬렉션이 남아 중복 진단이 생긴다. 공용 1개로 두면 deploy() 시작 시
//       clear로 갱신되고, 세션이 끝나도 Problems에 유지되어 코드로 점프할 수 있다.
export let _debugDeployDiagnostics: vscode.DiagnosticCollection | undefined;

export function getDebugDeployDiagnostics(): vscode.DiagnosticCollection {
    if (!_debugDeployDiagnostics) {
        _debugDeployDiagnostics = vscode.languages.createDiagnosticCollection('gpl-debug-deploy');
    }
    return _debugDeployDiagnostics;
}

export let sharedDeployOutput: vscode.OutputChannel | undefined;

export function getDeployOutputChannel(): vscode.OutputChannel {
    if (!sharedDeployOutput) {
        sharedDeployOutput = vscode.window.createOutputChannel('GPL Deploy (Debug)');
    }
    return sharedDeployOutput;
}

export interface IAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    controllerIp?: string;
    controllerPort?: number;
    stopOnEntry?: boolean;
    projectName?: string;
    deployBeforeAttach?: boolean;
    /** false면 Attach 초기화에서 Start를 보내지 않는다(stopOnEntry 여부와 무관). */
    startOnAttach?: boolean;
    projectDir?: string;
    /** 작업공간을 바꾸지 않고 FTP 소스를 여는 세션. */
    remoteSourceSessionId?: string;
    skipUnchangedOnDeploy?: boolean;
    stopAllBeforeAttach?: boolean;
    clearProjectBreakpointsOnAttach?: boolean;
    /** 세션 전부터 있던 중단점은 설정·해제·분리 시에도 그대로 둔다. */
    preserveExistingBreakpoints?: boolean;
    /** true면 디버거 분리(세션 종료) 시 제어기 측 프로그램도 정지한다(Stop -all). 기본 false(실행 유지). */
    stopAllOnDisconnect?: boolean;
    /** `Start -stack <KB>` — 프로시저 스택 크기(문서 기본 4 KB). 1~1024 범위 밖은 무시. */
    startStackSizeKb?: number;
    /** `Start -init` — trace/단일 스텝 중 초기화 문장도 표시(문서: -break/-trace 와 함께 쓴다). */
    startShowInitStatements?: boolean;
    /** `Start -trace` — 실행 문장을 콘솔에 표시. 문서가 성능 저하를 경고하므로 진단용으로만. */
    startTrace?: boolean;
}

export class AttachPreflight {
    constructor(
        private readonly io: DebugSessionIo,
        private readonly sources: SessionSources,
        private readonly breakpoints: SessionBreakpoints,
    ) {}

    /**
     * Run build-only deploy before attach.
     */
    async runDeployBeforeAttach(args: IAttachRequestArguments): Promise<{ ok: boolean; cancelled?: boolean; projectName?: string }> {
        const projectDir = await this.sources.resolveDeployProjectDir(args);
        if (!projectDir) {
            this.io.log('[deploy] 배포할 Project.gpr 폴더를 찾지 못했습니다.');
            return { ok: false };
        }

        const deployDiagnostics = getDebugDeployDiagnostics();
        const deployOutput = getDeployOutputChannel();

        this.io.log(`[deploy] Attach 전 배포 시작: ${projectDir}`);
        const result = await deploy(
            {
                projectDir,
                skipStart: true,
                skipUnchanged: args.skipUnchangedOnDeploy,
                // flash 경유 없이 /GPL/<name>에 직접 미러 동기화한다(변경분만 업로드 + 원격 전용 파일 삭제).
                // /GPL/<name>이 아직 없으면(최초 배포) deploy()가 FTP로 폴더를 생성해 직접 업로드한다.
                directGpl: true,
                // 배포 잠금 owner 라벨(다른 창/MCP 경고 문구에 표시). 잠금 자체는 deploy() 안에서 획득된다.
                lockOwner: 'F5 Deploy',
                // 무조건 Stop -all 하지 않는다: 업로드 뒤 Compile 직전에 Show Thread로 확인하고, 활성 쓰레드가
                // 있을 때만 사용자에게 정지 여부를 모달로 묻는다(Quick Compile과 동일한 게이트, §0.6).
                // 미승인 시 THREAD_CHECK로 중단 — 업로드는 이미 끝났고 Compile만 수행하지 않는다.
                skipStop: true,
                confirmStopOnActive: async (activeDesc: string) => {
                    const pick = await vscode.window.showWarningMessage(
                        '실행 중인 쓰레드가 있습니다. Stop -all로 정지한 후 Compile하고 디버깅을 시작할까요?',
                        {
                            modal: true,
                            detail:
                                `활성 쓰레드: ${activeDesc}\n\n` +
                                '업로드는 완료되었습니다. 정지하지 않으면 Compile과 디버깅을 시작하지 않습니다 ' +
                                '(정지 미완료 상태의 Compile은 제어기 이상을 유발할 수 있습니다).',
                        },
                        'Stop 후 디버그 시작',
                    );
                    return pick === 'Stop 후 디버그 시작';
                },
            },
            deployOutput,
            deployDiagnostics,
            undefined,
            this.io.config,
        );

        if (!result.success) {
            // 배포 잠금을 다른 배포/창/프로세스가 보유 중 — 제어기를 건드리지 않았다. 컨텍스트를 남기고 중단.
            if (result.failedPhase === 'LOCKED') {
                this.io.log(`[deploy] 배포 잠금 보유 중이라 시작하지 않음 — ${result.failedStatusMessage ?? '(보유자 미상)'}`);
                vscode.window.showWarningMessage(`디버그 배포 불가 — ${result.failedStatusMessage ?? '배포가 이미 진행 중입니다'}. 완료 후 다시 시도하세요.`);
                return { ok: false, cancelled: true };
            }
            // 사용자가 쓰레드 정지 확인을 취소한 경우(THREAD_CHECK)는 실패가 아니라 취소로 다룬다.
            // 컴파일 에러 UI(첫 에러 점프 / Problems 패널)를 띄우지 않고 조용히 중단한다.
            if (result.failedPhase === 'THREAD_CHECK') {
                this.io.log('[deploy] 사용자가 쓰레드 정지를 취소하여 디버깅을 시작하지 않습니다.');
                if (result.failedStatusMessage) {
                    this.io.log(`[deploy] ${result.failedStatusMessage}`);
                }
                return { ok: false, cancelled: true };
            }
            this.io.log(`[deploy] 실패: ${result.compileErrors.length}개 컴파일 에러`);
            if (result.failedPhase) {
                this.io.log(`[deploy] 실패 단계: ${result.failedPhase}`);
            }
            if (result.failedCommand) {
                this.io.log(`[deploy] 실패 명령: ${result.failedCommand}`);
            }
            if (typeof result.failedStatusCode === 'number') {
                this.io.log(`[deploy] STATUS: ${result.failedStatusCode} (${result.failedStatusMessage || 'Unknown'})`);
            } else if (result.failedStatusMessage) {
                this.io.log(`[deploy] 사유: ${result.failedStatusMessage}`);
            }
            if (result.attemptedProjectNames && result.attemptedProjectNames.length > 0) {
                this.io.log(`[deploy] 후보 이름 시도 순서: ${result.attemptedProjectNames.join(' -> ')}`);
            }
            if (result.trace.length > 0) {
                this.io.log('[deploy] --- raw trace begin ---');
                for (const line of result.trace) {
                    this.io.log(`[deploy] ${line}`);
                }
                this.io.log('[deploy] --- raw trace end ---');
            }
            for (const err of result.compileErrors) {
                this.io.log(`[deploy]   ${err.file}:${err.line} (${err.code}): ${err.message}`);
            }
            if (result.errorLog.length > 0) {
                for (const el of result.errorLog) {
                    this.io.log(`[deploy]   ${el}`);
                }
            }

            // Problems 패널로 점프했으면 출력 패널을 띄우지 않는다 — 종전에는 곧바로 show 해서
            // 에러 줄로 보내 놓고도 패널이 출력으로 되돌아갔다(§1-DH).
            const jumpedToError = await jumpToFirstCompileError(result.compileErrors, projectDir,
                msg => this.io.log(`[deploy] ${msg}`));

            if (!jumpedToError) {
                deployOutput.show(true);
            }
            return { ok: false };
        }

        let detectedProjectName: string | undefined;
        if (!this.io.projectName && result.projectName) {
            detectedProjectName = result.projectName;
            this.io.log(`[deploy] 프로젝트 설정: ${detectedProjectName}`);
        }

        this.io.log(`[deploy] 성공: ${result.projectName}`);
        return { ok: true, projectName: detectedProjectName };
    }

    /**
     * Start 전 배포 잠금 확인 — 다른 창/프로세스가 업로드/배포 중이면 최대 20초 기다리고, 그래도 잡혀 있으면 false.
     * 업로드 도중 Start는 제어기 이상을 유발할 수 있다(이슈 #17). 이 세션의 F5 배포는 deploy() 종료 시 이미 해제됐다.
     */
    async waitDeployLockForStart(what: string): Promise<boolean> {
        if (!this.io.config) { return true; }
        const lock = getDeployLock(this.io.config.ip);
        const deadline = Date.now() + 20_000;
        let logged = false;
        for (;;) {
            const cur = lock.current();
            if (!cur) { return true; }
            if (!logged) {
                this.io.log(`${what} 대기: 배포 잠금 보유 중 (${describeDeployLock(cur.record)}) — 최대 20초`);
                logged = true;
            }
            if (Date.now() >= deadline) {
                this.io.log(`⚠ ${what} 보류: 배포 잠금이 계속 잡혀 있음 (${describeDeployLock(cur.record)}) — 업로드 도중 Start는 제어기 이상을 유발할 수 있어 보내지 않습니다.`);
                return false;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * 전체 정지 절차(controller/threads/threadStop.ts)에 이 세션의 전송·로그를 물린다.
     *
     * 종전에는 `Stop -all` 을 한 번 보내고 **응답 문자열이 있기만 하면** "완료"로 로그했다 — STATUS 도
     * 정지 완료도 보지 않아 §0.6 위반이었다(2026-09-10 §1-DD 조사). 이제 배포·패널·FTP 와 같은 절차를 쓴다.
     */
    threadStopIo(): ThreadStopIo {
        return {
            send: async (command) => {
                const raw = await this.io.sendCmd(command);
                return raw === null ? null : { raw };
            },
            log: line => this.io.log(line),
            sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        };
    }

    /**
     * Preflight for stable debugging sessions.
     */
    async runAttachPreflight(stopAll: boolean, clearProjectBps: boolean): Promise<void> {
        if (!this.io.isConnected) { return; }

        if (stopAll) {
            // 정지 확인까지 마친 뒤에 BP 정리·attach 로 넘어간다(정지 미완료 상태의 Set Break 는 §0.6 밖이다).
            const outcome = await stopAllAndSettle(this.threadStopIo(), { logPrefix: 'attach preflight: ' });
            this.io.log(outcome.ok
                ? `attach preflight: 전체 정지 확인${outcome.settle?.unconfirmed ? ' (Show Thread 무응답 — 확인 불가로 통과)' : ''}`
                : `attach preflight: 전체 정지 실패(계속 진행) — ${outcome.failure?.message ?? '사유 미상'}`);
        }

        if (clearProjectBps && this.io.projectName) {
            await this.breakpoints.clearBreakpointsForProject(this.io.projectName);
        }
    }
}
