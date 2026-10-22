/**
 * 배포 취소 요청 — 작업자가 명시적으로 `Stop -all`을 요청했을 때 진행 중인 호스트 측 업로드/배포도 멈춘다.
 *
 * `Stop -all`은 제어기 쓰레드만 멈추므로 FTP 업로드와 그 뒤 Compile/Start는 별도 취소 신호가 필요하다.
 * VS Code 창과 controller-mcp는 서로 다른 프로세스이므로 배포 잠금과 같은 임시 디렉터리에 operationId별 파일을 둔다.
 * 배포 내부의 안전용 Stop은 이 파일을 만들지 않고, 사용자 진입점만 `requestDeployCancellation`을 호출한다.
 *
 * 파일 계약 — controller-mcp/src/deployCancellation.js와 동일하게 유지:
 *   <root>/cancellations/<operationId>.json
 *   { version, operationId, controllerId, reason, requestedAt, requesterPid }
 */

import * as fs from 'fs';
import * as path from 'path';
import { defaultOperationRootDir, sanitizeOperationId } from './operationStore';

export const DEPLOY_CANCELLATION_VERSION = 1;

export interface DeployCancellationRequest {
	version: number;
	operationId: string;
	controllerId: string;
	reason: string;
	requestedAt: number;
	requesterPid: number;
}

export interface DeployCancellationStatus {
	requested: boolean;
	request?: DeployCancellationRequest;
	/** 파일은 있으나 읽거나 파싱할 수 없음 — 안전상 취소로 취급한다. */
	malformed?: boolean;
}

export interface DeployCancellationEnv {
	dir?: string;
	now?: () => number;
	pid?: number;
}

export function deployCancellationDir(dir = defaultOperationRootDir()): string {
	return path.join(dir, 'cancellations');
}

export function deployCancellationFilePath(operationId: string, dir = defaultOperationRootDir()): string {
	return path.join(deployCancellationDir(dir), `${sanitizeOperationId(operationId)}.json`);
}

/** 정확한 전체 정지 명령만 잡는다. 개별 `Stop <thread>`는 배포 전체 취소가 아니다. */
export function isStopAllCommand(command: string): boolean {
	return /^\s*stop\s+-(?:all|a)\s*$/i.test(command);
}

function writeAtomic(file: string, content: string, pid: number): void {
	const tmp = `${file}.${pid}.tmp`;
	fs.writeFileSync(tmp, content);
	try {
		fs.renameSync(tmp, file);
	} catch {
		try { fs.writeFileSync(file, content); } finally { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
	}
}

export function requestDeployCancellation(
	input: Pick<DeployCancellationRequest, 'operationId' | 'controllerId' | 'reason'>,
	env: DeployCancellationEnv = {},
): DeployCancellationRequest {
	const request: DeployCancellationRequest = {
		version: DEPLOY_CANCELLATION_VERSION,
		operationId: input.operationId,
		controllerId: input.controllerId,
		reason: input.reason,
		requestedAt: (env.now ?? (() => Date.now()))(),
		requesterPid: env.pid ?? process.pid,
	};
	const dir = deployCancellationDir(env.dir);
	fs.mkdirSync(dir, { recursive: true });
	writeAtomic(deployCancellationFilePath(input.operationId, env.dir), JSON.stringify(request), request.requesterPid);
	return request;
}

/** 손상 파일도 "취소 요청 있음"으로 돌려 이후 Compile/Start가 나가는 쪽보다 안전하게 실패시킨다. */
export function readDeployCancellation(operationId: string, env: Pick<DeployCancellationEnv, 'dir'> = {}): DeployCancellationStatus {
	let text: string;
	try {
		text = fs.readFileSync(deployCancellationFilePath(operationId, env.dir), 'utf8');
	} catch (err: any) {
		return err?.code === 'ENOENT'
			? { requested: false }
			: { requested: true, malformed: true };
	}
	try {
		const parsed = JSON.parse(text) as Partial<DeployCancellationRequest>;
		if (parsed?.version !== DEPLOY_CANCELLATION_VERSION || parsed.operationId !== operationId
			|| typeof parsed.controllerId !== 'string' || typeof parsed.reason !== 'string'
			|| typeof parsed.requestedAt !== 'number' || typeof parsed.requesterPid !== 'number') {
			return { requested: true, malformed: true };
		}
		return { requested: true, request: parsed as DeployCancellationRequest };
	} catch {
		return { requested: true, malformed: true };
	}
}

export function isDeployCancellationRequested(operationId: string, env: Pick<DeployCancellationEnv, 'dir'> = {}): boolean {
	return readDeployCancellation(operationId, env).requested;
}

/** operationId는 작업마다 유일하므로 그 작업의 finally에서 자기 파일만 지우면 된다. */
export function clearDeployCancellation(operationId: string, env: Pick<DeployCancellationEnv, 'dir'> = {}): void {
	try { fs.unlinkSync(deployCancellationFilePath(operationId, env.dir)); } catch { /* 이미 없음 */ }
}
