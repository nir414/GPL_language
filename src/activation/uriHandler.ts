/**
 * 외부 진입점 URI 핸들러 — `vscode://nir414.gpl-language-support/<gpl.command.id>?…` (GitHub #25 B, 2026-08-28 전체 개방).
 * 해석 규칙은 controller/uriDispatch.ts(단위 테스트 대상).
 */

import * as vscode from 'vscode';
import { resolveUriRequest, summarizeUriResult } from '../controller/uriDispatch';
import type { ExtensionHost } from './host';

export function activateUriHandler(host: ExtensionHost): void {
	const { context } = host;

	// ── 외부 진입점: URI 핸들러 (GitHub #25 B → 2026-08-28 이 확장의 모든 명령으로 개방) ──────────
	//   vscode://nir414.gpl-language-support/<gpl.command.id>?args=<JSON>        — 인자 1개(JSON: 객체·배열·원시값)
	//   vscode://nir414.gpl-language-support/<gpl.command.id>?key=value&…        — 평면 인자 → 객체 1개(숫자/불리언 자동 변환)
	//   vscode://nir414.gpl-language-support/command?id=<gpl.command.id>&args=…
	//   별칭(종전 호환): /connect?ip&port[&save=settings] · /disconnect · /getState · /dashboard
	//   터미널/에이전트: code --open-url "vscode://nir414.gpl-language-support/gpl.ai.debug.getState"
	// 접근은 막지 않는다(사용자 결정). 제어기 안전 조건(Step 연타 #28·정지 정착 §0.6·Compile→Start 완충 §0.7)은 명령 계층의 정책
	// (controller/commandPolicy.ts)이 어느 경로에서든 같은 방식으로 충족시키므로 URI 에 별도 허용 목록을 두지 않는다. 다만 이 확장의
	// 명령(`gpl.*`)만 실행한다 — 임의 VS Code 명령의 프록시가 되지 않도록(범위 한정, 제한이 아님). 결과는 URI 로 돌려줄 수 없으므로
	// Output([URI] <id> => …) 과 `gpl.ai.debug.*` 의 [AI Debug] 로그로 확인한다. 해석 규칙은 controller/uriDispatch.ts(단위 테스트 대상).
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri: async (uri: vscode.Uri) => {
				host.log(`[URI] ${uri.scheme}://${uri.authority}${uri.path}${uri.query ? `?${uri.query}` : ''}`);
				const req = resolveUriRequest(uri.path, uri.query);
				if (req.kind === 'invalid') {
					host.log(`[URI] 거부: ${req.reason}`);
					vscode.window.showWarningMessage(`GPL URI: ${req.reason}`);
					return;
				}
				try {
					if (req.kind === 'alias') {
						const q = req.query;
						switch (req.action) {
							case 'connect': {
								const portRaw = q.get('port');
								const result = await host.connection.connectControllerWithArgs({
									ip: q.get('ip') ?? undefined,
									port: portRaw ? Number(portRaw) : undefined,
									save: q.get('save') === 'settings' ? 'settings' : 'session',
									silent: true,
								});
								host.log(`[URI] connect => ${JSON.stringify(result)}`);
								vscode.window.setStatusBarMessage(
									result.ok ? `GPL Controller 연결 성공: ${result.ip}` : `GPL Controller 연결 실패: ${result.ip} (${result.error})`, 5000);
								return;
							}
							case 'disconnect': {
								const result = await vscode.commands.executeCommand('gpl.controller.disconnect', { silent: true });
								host.log(`[URI] disconnect => ${JSON.stringify(result)}`);
								vscode.window.setStatusBarMessage('GPL Controller 연결 해제', 5000);
								return;
							}
							case 'getState':
								// 결과는 registerAiDebugCommand 규약에 따라 Output 에 [AI Debug] 로 기록된다.
								await vscode.commands.executeCommand('gpl.ai.debug.getConnectionState');
								return;
							case 'dashboard':
								await vscode.commands.executeCommand('gpl.controller.showDashboard');
								return;
						}
					}
					// 일반 경로: 이 확장이 등록한 명령이면 그대로 실행한다(인자 형태는 각 명령의 규약 — 런북 Command ID 표 참조).
					const known = await vscode.commands.getCommands(true);
					if (!known.includes(req.commandId)) {
						host.log(`[URI] 알 수 없는 명령 '${req.commandId}' — package.json contributes.commands / 런북 Command ID 표 참조`);
						vscode.window.showWarningMessage(`GPL URI: 알 수 없는 명령 '${req.commandId}'`);
						return;
					}
					const result = req.args === undefined
						? await vscode.commands.executeCommand(req.commandId)
						: await vscode.commands.executeCommand(req.commandId, req.args);
					host.log(`[URI] ${req.commandId} => ${summarizeUriResult(result)}`);
					vscode.window.setStatusBarMessage(`GPL URI: ${req.commandId} 실행`, 4000);
				} catch (err: any) {
					const label = req.kind === 'alias' ? req.action : req.commandId;
					host.log(`[URI] ${label} 실패: ${err?.message ?? err}`);
					vscode.window.setStatusBarMessage(`GPL URI: ${label} 실패 — Output 참조`, 6000);
				}
			},
		})
	);
}
