/**
 * 제어기 시계를 PC 에 맞추기 — `gpl.controller.syncClock` 명령과 연결 시 자동 동기화(설정).
 *
 * 절차·판정은 controller/diagnostics/controllerClock.ts(순수)가 정본이고, 여기서는 명령 콘솔 직렬 큐
 * (`sendCommandDetailed` — 명령 정책 포함)를 IO 로 주입하고 결과를 Output/알림으로 옮긴다.
 * 시계 설정은 상태를 바꾸지만 모션은 일으키지 않는다.
 */

import * as vscode from 'vscode';
import { sendCommandDetailed } from '../controller/connection/controllerConnection';
import { onControllerSessionChange } from '../controller/connection/connectionSession';
import {
	ClockIo,
	ClockSyncResult,
	describeClockSync,
	exceedsClockThreshold,
	formatClockOffset,
	readControllerClock,
	syncControllerClock,
} from '../controller/diagnostics/controllerClock';
import type { ExtensionHost } from './host';

/** `date` 응답 대기 상한(ms) — 실측 왕복 수십 ms 인 조회라 짧게 둔다. */
const CLOCK_COMMAND_TIMEOUT_MS = 5000;
/** 연결 직후 다른 시작 트래픽(중단점 동기화 등)이 큐를 비울 때까지 기다리는 시간(ms) — 왕복 측정이 오염되지 않게. */
const SYNC_ON_CONNECT_DELAY_MS = 2000;
const DEFAULT_THRESHOLD_SEC = 2;

function createClockIo(): ClockIo {
	return {
		send: async (command: string) => (await sendCommandDetailed(command, undefined, { timeoutMs: CLOCK_COMMAND_TIMEOUT_MS })).raw,
		now: () => Date.now(),
		sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms))),
	};
}

function readThresholdSec(): number {
	const v = vscode.workspace.getConfiguration('gpl.controller').get<number>('syncClockThresholdSec', DEFAULT_THRESHOLD_SEC);
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_THRESHOLD_SEC;
}

/** 사람용 한 줄 결과(알림). */
function summarize(result: ClockSyncResult): string {
	const before = result.before?.ok ? formatClockOffset(result.before.offsetMs) : undefined;
	if (result.ok && result.dryRun) {
		return `제어기 시계 오프셋 ${before} — 보낼 명령: ${result.plan?.command}`;
	}
	if (result.ok) {
		return `제어기 시계를 PC(${result.pcTimeZone})에 맞췄습니다 — 동기화 전 ${before}, 남은 오차 ${formatClockOffset(result.residualMs ?? 0)}`;
	}
	switch (result.stage) {
		case 'read-before':
			return `제어기 시각을 읽지 못해 시계를 맞추지 않았습니다: ${result.detail}`;
		case 'set':
			return result.outcome === 'unknown'
				? `시계 설정 명령의 결과를 확인하지 못했습니다(이미 적용됐을 수 있음): ${result.detail}`
				: `제어기가 시계 설정을 거부했습니다: ${result.detail}`;
		default:
			return `시계 설정은 STATUS 0 으로 끝났지만 확인 읽기에 실패했습니다: ${result.detail}`;
	}
}

export function activateClockSync(host: ExtensionHost): void {
	const { context } = host;
	let inFlight: Promise<ClockSyncResult> | undefined;

	/** 동시에 두 번 돌지 않게 — 진행 중이면 그 결과를 함께 기다린다. */
	function runSync(dryRun: boolean): Promise<ClockSyncResult> {
		if (dryRun) { return syncControllerClock(createClockIo(), { dryRun: true }); }   // 읽기만 — 공유하지 않는다
		if (!inFlight) {
			inFlight = syncControllerClock(createClockIo(), { dryRun }).finally(() => { inFlight = undefined; });
		}
		return inFlight;
	}

	function logResult(prefix: string, result: ClockSyncResult): void {
		for (const line of describeClockSync(result)) { host.log(`[Clock]${prefix} ${line}`); }
	}

	// 인자 없음(팔레트) = 대화형: 진행 알림 + 결과 알림. 인자 객체(MCP·URI) = 비대화형: 결과 객체만 돌려준다.
	//   args: { dryRun?: boolean } — dryRun 이면 현재 오프셋과 보낼 값만(설정 안 함).
	context.subscriptions.push(
		vscode.commands.registerCommand('gpl.controller.syncClock', async (args?: unknown) => {
			const nonInteractive = !!args && typeof args === 'object';
			const dryRun = nonInteractive && (args as { dryRun?: unknown }).dryRun === true;
			if (nonInteractive) {
				const result = await runSync(dryRun);
				logResult(dryRun ? ' (미리보기)' : ' (agent)', result);
				return result;
			}
			const result = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: '제어기 시계를 PC에 맞추는 중…' },
				() => runSync(false),
			);
			logResult('', result);
			const message = summarize(result);
			if (result.ok) {
				void vscode.window.showInformationMessage(message);
			} else {
				void vscode.window.showWarningMessage(message, '출력 보기').then(pick => {
					if (pick === '출력 보기') { host.outputChannel.show(true); }
				});
			}
			return result;
		}),
	);

	// 연결 시 자동 동기화(설정, 기본 꺼짐) — |오프셋| 이 임계값을 넘을 때만 맞춘다. 실패해도 연결에는 영향이 없고 로그만 남긴다.
	context.subscriptions.push(onControllerSessionChange(change => {
		if (!change.connected) { return; }
		if (!vscode.workspace.getConfiguration('gpl.controller').get<boolean>('syncClockOnConnect', false)) { return; }
		setTimeout(() => { void syncOnConnect(); }, SYNC_ON_CONNECT_DELAY_MS);
	}));

	async function syncOnConnect(): Promise<void> {
		if (!host.isControllerConnected || inFlight) { return; }
		try {
			const thresholdSec = readThresholdSec();
			const reading = await readControllerClock(createClockIo());
			if (!reading.ok) {
				host.log(`[Clock] 연결 시 시계 확인 실패(동기화 생략): ${reading.detail}`);
				return;
			}
			const offset = formatClockOffset(reading.offsetMs);
			if (!exceedsClockThreshold(reading.offsetMs, thresholdSec)) {
				host.log(`[Clock] 연결 시 시계 확인: 오프셋 ${offset} — 임계값 ${thresholdSec} s 이내라 맞추지 않습니다.`);
				return;
			}
			host.log(`[Clock] 연결 시 시계 확인: 오프셋 ${offset} — 임계값 ${thresholdSec} s 를 넘어 PC 시각으로 맞춥니다.`);
			logResult(' (연결 시)', await runSync(false));
		} catch (err: any) {
			host.log(`[Clock] 연결 시 자동 동기화 오류(무시): ${err?.message ?? err}`);
		}
	}
}
