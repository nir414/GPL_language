/**
 * Unload 위험 상태의 파일 저장소 — 판정은 `unloadRisk.ts`(정본), 여기는 읽기/쓰기만 한다(vscode 무의존).
 *
 * 왜 파일인가: 위험 상태는 "제어기의 이번 부팅"에 속한다. VS Code 창을 다시 열어도, 다른 창이나 MCP 서버(별도 node
 * 프로세스, 확장 없이 직접 접속하는 경우 포함)가 Unload 를 보내도 같은 상태를 봐야 한다. 배포 잠금과 같은 폴더
 * (`%TEMP%/gpl-controller/`)에 `unload-risk-<ip>.json` 으로 둔다. 파일 계약은 `unloadRisk.ts` 머리말,
 * MCP 쪽 구현은 `controller-mcp/src/unloadRisk.js` — 둘을 함께 바꿀 것.
 *
 * 쓰기는 임시 파일 + rename(원자적). 읽기 실패·깨진 파일은 "표시 없음"으로 본다 — 위험 상태를 모르는 것이 보내지
 * 못하는 것보다 나은 이유: 이 표시는 차단이 아니라 확인 요청이고, 파일이 깨졌다고 모든 Unload 를 묻게 하면
 * 사람이 표시의 의미를 신뢰하지 않게 된다.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEPLOY_LOCK_DIR_NAME } from '../deployment/deployLock';
import { UnloadRiskState, emptyUnloadRiskState, normalizeUnloadRiskState } from './unloadRisk';

export const UNLOAD_RISK_FILE_PREFIX = 'unload-risk-';

export function defaultUnloadRiskDir(): string {
    return path.join(os.tmpdir(), DEPLOY_LOCK_DIR_NAME);
}

/** 제어기 IP 를 파일 이름으로 쓸 수 있게 만든다(IPv4 는 그대로). */
export function unloadRiskFilePath(controllerId: string, dir: string = defaultUnloadRiskDir()): string {
    const safe = String(controllerId ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
    return path.join(dir, `${UNLOAD_RISK_FILE_PREFIX}${safe}.json`);
}

/** 현재 상태. 파일이 없거나 읽지 못하면 undefined(= 표시 없음). */
export function readUnloadRiskState(controllerId: string, dir?: string): UnloadRiskState | undefined {
    try {
        const text = fs.readFileSync(unloadRiskFilePath(controllerId, dir), 'utf8');
        return normalizeUnloadRiskState(JSON.parse(text), controllerId);
    } catch {
        return undefined;
    }
}

export function writeUnloadRiskState(state: UnloadRiskState, dir?: string): void {
    const file = unloadRiskFilePath(state.controllerId, dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    try {
        fs.renameSync(tmp, file);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* noop */ }
        throw err;
    }
}

/** 읽기 → 변환 → 쓰기. 변환이 같은 객체를 돌려주면 쓰지 않는다. 쓰기 실패는 예외 없이 undefined. */
export function updateUnloadRiskState(
    controllerId: string,
    fn: (state: UnloadRiskState) => UnloadRiskState,
    now: number = Date.now(),
    dir?: string,
): UnloadRiskState | undefined {
    const current = readUnloadRiskState(controllerId, dir) ?? emptyUnloadRiskState(controllerId, now);
    const next = fn(current);
    if (next === current) { return current; }
    try {
        writeUnloadRiskState(next, dir);
        return next;
    } catch {
        return undefined;
    }
}
