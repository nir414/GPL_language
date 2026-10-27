/**
 * 성공 배포 알림의 ErrorLog 처리 — 직전 배포 이후 새로 생긴 항목만 알림 대상으로 고르고(제어기 IP별 "이미 본 항목"
 * 상태는 `DeployContext.seenErrorLogEntries`), 알림의 「ErrorLog 지우기」 버튼이 보내는 `ErrorLog -clear` 를 STATUS 로
 * 판정한다(하드 규칙 2). 선별 규칙 자체는 controller/deployment/deployOutcome.ts(순수). `deploy.ts` 에서 분할(2026-10-27).
 */

import * as vscode from 'vscode';
import { sendCommandDetailed } from '../../controller/connection/controllerConnection';
import { errorLogEntryKey, selectErrorLogNotice } from '../../controller/deployment/deployOutcome';
import type { ErrorLogNotice } from '../../controller/deployment/deployOutcome';
import { parseStatus } from '../../controller/protocol/responseParser';
import type { DeployContext } from './deployContext';

export const CLEAR_ERROR_LOG = 'ErrorLog 지우기';

/**
 * 성공 배포의 ErrorLog 알림 선별 — 새 항목만 알림 대상으로, 의도된 동작 코드는 정보로 낮춘다(규칙: deployOutcome.selectErrorLogNotice).
 * 출력 로그(분류 섹션)·결과 스냅샷은 종전대로 전부 남는다.
 */
export function takeErrorLogNotice(ctx: DeployContext, ip: string, errorLog: readonly string[]): ErrorLogNotice {
	const { host, seenErrorLogEntries } = ctx;
	const quietCodes = vscode.workspace.getConfiguration('gpl').get<number[]>('deploy.errorLogQuietCodes', [-1600]);
	const notice = selectErrorLogNotice(errorLog, seenErrorLogEntries.get(ip) ?? new Set(), Array.isArray(quietCodes) ? quietCodes : []);
	seenErrorLogEntries.set(ip, new Set(errorLog.map(errorLogEntryKey)));
	if (notice.repeated > 0 || notice.quiet.length > 0) {
		host.log(`[Deploy] ErrorLog 알림 생략: 이미 본 항목 ${notice.repeated}건, 의도된 동작 코드 ${notice.quiet.length}건 (위 분류 섹션에는 모두 표시)`);
	}
	return notice;
}

/** 알림의 「ErrorLog 지우기」 — 사람이 버튼을 눌렀을 때만 보낸다. 응답 STATUS 로 판정한다(하드 규칙 2). */
export async function clearControllerErrorLog(ctx: DeployContext, ip: string): Promise<void> {
	const { host, seenErrorLogEntries } = ctx;
	try {
		const resp = await sendCommandDetailed('ErrorLog -clear');
		const status = parseStatus(resp.raw);
		if (resp.meta.statusTagReceived && status.code === 0) {
			seenErrorLogEntries.delete(ip);
			vscode.window.showInformationMessage('제어기 ErrorLog 를 지웠습니다.');
			host.controllerTree?.refresh();
		} else {
			vscode.window.showErrorMessage(`ErrorLog 지우기 실패: STATUS ${resp.meta.statusTagReceived ? `${status.code} ${status.message ?? ''}` : '응답 없음'}`.trimEnd());
		}
	} catch (err: any) {
		vscode.window.showErrorMessage(`ErrorLog 지우기 실패: ${err?.message ?? err}`);
	}
}
