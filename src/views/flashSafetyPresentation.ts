/** Flash 쓰기 안전 상태의 상태바 표현 정본(vscode 무의존). */

import type { FlashSafetyState } from '../controller/deployment/flashSafety';

export interface FlashSafetyPresentation {
	text: string;
	tooltip: string;
}

export function presentFlashSafety(state: FlashSafetyState, projectName?: string): FlashSafetyPresentation {
	const target = projectName ? ` (${projectName})` : '';
	const common = '이 표시가 사라지기 전에는 제어기 전원을 끄지 마세요.';

	switch (state.phase) {
		case 'writing':
			return {
				text: '$(warning) FLASH 저장 중 — 전원 끄지 마세요',
				tooltip: `Flash 파일을 쓰는 중입니다${target}.\n${common}`,
			};
		case 'syncing':
			return {
				text: '$(sync~spin) FLASH 쓰기 완료 대기 — 전원 끄지 마세요',
				tooltip: `Sync 명령으로 Disk Busy 해제를 기다리는 중입니다${target}.\n${common}`,
			};
		case 'settling':
			return {
				text: `$(clock) FLASH 안정화 ${state.remainingSeconds}초 — 전원 끄지 마세요`,
				tooltip: `Disk Busy 해제 후 안전 대기 중입니다${target}.\n${common}`,
			};
		case 'unknown':
			return {
				text: '$(error) FLASH 안전 상태 미확인 — 전원 끄지 마세요',
				tooltip: `Flash 쓰기 완료를 확인하지 못했습니다${target}.\n${state.detail}\n제어기의 Flash Busy 표시가 사라진 뒤 10초 이상 기다리세요.`,
			};
	}
}
