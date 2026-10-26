/** 제어기 소스와 Attach 대상의 연결. 이전 전용 작업공간의 재개 정보도 호환용으로 유지한다. */
import { normalizePathKey } from '../util/pathKey';
export { controllerLibraryCandidates } from './projectSources';

export const CONTROLLER_DEBUG_MARKER = '.gpl-controller-debug.json';
export const PENDING_CONTROLLER_DEBUG_KEY = 'gpl.pendingControllerDebug';
const PENDING_LIFETIME_MS = 10 * 60 * 1000;

export interface ControllerDebugTarget {
    host: string;
    port: number;
    consolePort: number;
    remotePath: string;
    projectName: string;
    projectDir: string;
}

export interface PendingControllerDebug {
    workspaceFile: string;
    requestedAt: number;
    target: ControllerDebugTarget;
    unresolvedLibraries: string[];
}

export function controllerDebugConfiguration(target: ControllerDebugTarget) {
    return {
        type: 'brooks-gpl',
        request: 'attach',
        name: `Controller: ${target.projectName} (${target.host})`,
        controllerIp: target.host,
        controllerPort: target.port,
        projectName: target.projectName,
        projectDir: target.projectDir,
        deployBeforeAttach: false,
        startOnAttach: false,
        stopAllBeforeAttach: false,
        stopOnEntry: false,
        stopAllOnDisconnect: false,
        clearProjectBreakpointsOnAttach: false,
        preserveExistingBreakpoints: true,
    };
}

/** 일회성 요청은 지정한 작업공간에서만, 요청 직후에 이어받는다. 일반적인 재열기는 자동 Attach하지 않는다. */
export function canResumeControllerDebug(pending: PendingControllerDebug, workspaceFile: string, now = Date.now()): boolean {
    return normalizePathKey(pending.workspaceFile) === normalizePathKey(workspaceFile)
        && Number.isFinite(pending.requestedAt)
        && now >= pending.requestedAt && now - pending.requestedAt <= PENDING_LIFETIME_MS;
}
