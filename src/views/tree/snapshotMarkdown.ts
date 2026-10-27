/**
 * 제어기 상태 스냅샷의 Markdown 보고서 — 「AI 공유용 상황 복사」(`buildSituationSnapshotMarkdown`)와
 * 「원클릭 진단 스냅샷」(`buildDiagnosticSnapshotMarkdown`). vscode 무의존.
 * controllerTreeProvider.ts 에서 분리했다(2026-10-27, 문구·순서 동일). provider 는 자기 상태를
 * `ControllerStatusSnapshot`(treeSnapshot.ts)으로 옮겨 넘기기만 한다. 쓰레드 표는 `controller/threads/threadReport` 가 정본.
 */
import type { SituationDeploySnapshot } from '../../controller/deployment/deployOutcome';
import { channelName } from '../../controller/protocol/channelNames';
import {
	classifyErrorEntry,
	extractErrorCodeFromEntry,
	findKnownErrorChains,
	getErrorCodeHint,
} from '../../controller/protocol/responseParser';
import { formatRuntimeConsoleStateLabel } from '../../controller/runtime/runtimeConsolePresentation';
import { renderThreadTable, summarizeThreadStates } from '../../controller/threads/threadReport';
import { formatBytes } from '../../util/formatBytes';
import {
	formatRuntimeConsoleStatusDetail,
	getRuntimeConsoleHypothesis,
	isRuntimeConsoleUnstable,
} from './runtimeConsoleTreePresentation';
import { formatDate, formatDateTimeFromTs } from './treeFormat';
import type { ControllerStatusSnapshot } from './treeSnapshot';

export interface SnapshotMarkdownOptions {
	deploySnapshot?: SituationDeploySnapshot;
	/** 보고서의 "시각/생성 시각"(epoch ms). 기본 `Date.now()` — 테스트가 출력을 고정할 때 넣는다. */
	now?: number;
}

export function buildSituationSnapshotMarkdown(snapshot: ControllerStatusSnapshot, options?: SnapshotMarkdownOptions): string {
	const { config } = snapshot;

	const expected = snapshot.expectedProjectName || '(미설정)';
	const expectedFolder = snapshot.expectedProjectFolderName || snapshot.expectedProjectName || '(미설정)';
	const runningProjects = [...new Set(snapshot.threads.map(t => t.project).filter(Boolean))];
	const ftpDirs = [
		...snapshot.ftpEntries.filter(e => e.isDirectory).map(e => e.name),
		...snapshot.ftpFlashEntries.filter(e => e.isDirectory).map(e => e.name),
	];

	const lines: string[] = [];
	lines.push('# GPL Controller 상황 스냅샷');
	lines.push('');

	// ── 연결 상태
	const consoleStatus = snapshot.runtimeConsoleStatus;
	lines.push('## 연결');
	lines.push(`- 명령 포트: ${snapshot.connected ? `Connected (${config.ip}:${config.port})` : 'Disconnected'}`);
	lines.push(`- 콘솔 포트: ${formatRuntimeConsoleStateLabel(consoleStatus)} (${config.ip}:${config.consolePort})`);
	lines.push(`- 콘솔 상세: ${formatRuntimeConsoleStatusDetail(consoleStatus)}`);
	if (consoleStatus.lastPayloadAt) {
		lines.push(`- 마지막 payload: ${formatDateTimeFromTs(consoleStatus.lastPayloadAt)} (${consoleStatus.lastPayloadBytes ?? 0} bytes)`);
	}
	lines.push(`- 시각: ${new Date(options?.now ?? Date.now()).toLocaleString('ko-KR')}`);
	lines.push('');

	// ── 최근 배포 결과
	lines.push('## 최근 배포 결과');
	if (!options?.deploySnapshot) {
		lines.push('- 최근 배포 기록 없음');
	} else {
		const d = options.deploySnapshot;
		lines.push(`- 결과: ${d.success ? '성공' : '실패'}`);
		lines.push(`- 모드: ${d.mode}`);
		lines.push(`- 마지막 단계: ${d.lastStage}`);
		lines.push(`- 컴파일 에러 코드: ${d.compileErrorCodes.length > 0 ? d.compileErrorCodes.join(', ') : '(없음)'}`);
		lines.push(`- 제어기 시스템 코드: ${d.controllerSystemCodes.length > 0 ? d.controllerSystemCodes.join(', ') : '(없음)'}`);
		lines.push(`- 요약: ${d.summary}`);
		lines.push(`- 기록 시각: ${new Date(d.updatedAt).toLocaleString('ko-KR')}`);
	}
	lines.push('');

	// ── 프로젝트 컨텍스트
	const hasExpectedRunning = expected !== '(미설정)' && runningProjects.some(p => p.toLowerCase() === expected.toLowerCase());
	const hasExpectedFtp = expectedFolder !== '(미설정)' && ftpDirs.some(p => p.toLowerCase() === expectedFolder.toLowerCase());
	const hasUnexpectedRunning = expected !== '(미설정)' && runningProjects.length > 0 && !hasExpectedRunning;
	const mismatch = (expectedFolder !== '(미설정)' && !hasExpectedFtp) || hasUnexpectedRunning;

	lines.push('## 프로젝트 컨텍스트');
	lines.push(`- 기대 프로젝트: ${expected}${mismatch ? ' ⚠ 불일치' : ''}`);
	lines.push(`- 기대 FTP 폴더: ${expectedFolder}`);
	lines.push(`- 실행 프로젝트: ${runningProjects.length > 0 ? runningProjects.join(', ') : '(없음)'}${hasUnexpectedRunning ? ' ⚠ 다른 프로젝트 실행 중' : expected !== '(미설정)' && !hasExpectedRunning && hasExpectedFtp ? ' (Build Only 가능)' : expected !== '(미설정)' && !hasExpectedRunning ? ' ⚠ 기대 프로젝트 미실행' : ''}`);
	lines.push(`- FTP 프로젝트 폴더: ${ftpDirs.length > 0 ? ftpDirs.join(', ') : '(없음)'}${expectedFolder !== '(미설정)' && !hasExpectedFtp ? ' ⚠ 기대 프로젝트 폴더 없음' : ''}`);
	lines.push('');

	// ── 쓰레드 (표는 「전체 쓰레드 복사」와 같은 렌더러 — controller/threads/threadReport)
	lines.push('## 쓰레드');
	lines.push(`- ${summarizeThreadStates(snapshot.threads)}`);
	const threadTable = renderThreadTable(snapshot.threads);
	if (threadTable.length > 0) {
		lines.push('');
		lines.push(...threadTable);
	}
	lines.push('');

	// ── 브레이크포인트
	lines.push('## 브레이크포인트');
	if (snapshot.breakpoints.length === 0) {
		lines.push('- 없음');
	} else {
		lines.push('');
		lines.push('| 파일:줄 | 프로시저 | hit 횟수 |');
		lines.push('|---------|----------|----------|');
		for (const b of snapshot.breakpoints) {
			lines.push(`| ${b.file}:${b.fileLine} | ${b.proc} | ${b.hitCount} |`);
		}
	}
	lines.push('');

	// ── FTP 파일 상세
	lines.push('## FTP 파일');
	if (snapshot.ftpEntries.length === 0) {
		lines.push('- 파일 없음');
	} else {
		lines.push('');
		lines.push('| 이름 | 유형 | 크기 | 수정일 |');
		lines.push('|------|------|------|--------|');
		for (const e of snapshot.ftpEntries) {
			const type = e.isDirectory ? '폴더' : '파일';
			const size = e.isDirectory ? '-' : formatBytes(e.size);
			const date = e.modifiedAt ? formatDate(e.modifiedAt) : '-';
			lines.push(`| ${e.name} | ${type} | ${size} | ${date} |`);
		}
	}
	if (snapshot.ftpError) {
		lines.push(`- ⚠ FTP 조회 실패: ${snapshot.ftpError}`);
	}
	if (snapshot.lastFtpRefreshAt > 0) {
		lines.push(`- 마지막 FTP 조회: ${formatDateTimeFromTs(snapshot.lastFtpRefreshAt)} (연결 플랩 시 자동 재조회 안 함 — 새로고침으로 갱신)`);
	}
	lines.push('');

	// ── 시스템 정보
	lines.push('## 시스템 정보');
	if (snapshot.sysInfo.length === 0) {
		lines.push('- 조회 안됨');
	} else {
		for (const s of snapshot.sysInfo) {
			lines.push(`- ${s.label}: ${s.value}`);
		}
	}
	lines.push('');

	// ── 에러 로그
	lines.push('## 에러 로그');
	if (snapshot.errors.length === 0) {
		lines.push('- 활성 에러 없음');
	} else {
		for (const e of snapshot.errors) {
			lines.push(`- ${e}`);
		}
	}

	if (snapshot.runtimeErrorContext) {
		lines.push('');
		lines.push('## 오류 스레드 상세');
		const ctx = snapshot.runtimeErrorContext;
		lines.push(`- 스레드: ${ctx.threadId !== undefined ? `${ctx.threadName} (#${ctx.threadId})` : ctx.threadName}`);
		lines.push(`- 상태: ${ctx.statusText || '(미상)'}`);
		lines.push(`- 직전 실행 명령: ${ctx.lastCommand || '(미상)'}`);
		lines.push(`- 최초 발생 시각: ${ctx.firstSeenAt || '(미상)'}`);
		if (ctx.stackFrames && ctx.stackFrames.length > 0) {
			lines.push('- 스택:');
			for (const frame of ctx.stackFrames) {
				lines.push(`  - ${frame}`);
			}
		}
		if (ctx.relatedFunctions && ctx.relatedFunctions.length > 0) {
			lines.push(`- 관련 함수: ${ctx.relatedFunctions.join(', ')}`);
		}
	}

	return lines.join('\n');
}

export function buildDiagnosticSnapshotMarkdown(snapshot: ControllerStatusSnapshot, options?: SnapshotMarkdownOptions): string {
	const { config } = snapshot;
	const runtime = snapshot.runtimeConsoleStatus;
	const deploy = options?.deploySnapshot;

	const codes = snapshot.errors
		.map(e => extractErrorCodeFromEntry(e))
		.filter((code): code is number => typeof code === 'number');
	const codeCounts = new Map<number, number>();
	for (const code of codes) {
		codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
	}
	const topCodes = [...codeCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);
	const chains = findKnownErrorChains(codes);

	const stageMap: Record<string, 'OK' | 'FAIL' | 'SKIP' | 'N/A'> = {
		STOPPING: 'N/A',
		UPLOADING: 'N/A',
		COMPILE: 'N/A',
		RUNNING: 'N/A',
	};
	if (deploy) {
		if (deploy.success) {
			stageMap.STOPPING = deploy.mode === 'Upload Only' ? 'SKIP' : 'OK';
			stageMap.UPLOADING = 'OK';
			stageMap.COMPILE = deploy.mode === 'Upload Only' ? 'SKIP' : 'OK';
			stageMap.RUNNING = deploy.mode === 'Build' || deploy.mode === 'Upload Only' ? 'SKIP' : 'OK';
		} else {
			// 순서(2026-08-25 재배치, 이슈 #17): UPLOAD → STOP/THREAD_CHECK → COMPILE → START.
			// THREAD_CHECK(빠른 컴파일의 Compile 전 쓰레드 게이트)·COMPILE_DEFERRED는 STOP 단계 실패와 동급으로 취급.
			const stage = deploy.lastStage;
			if (stage === 'CANCELLED') {
				stageMap.STOPPING = 'N/A';
				stageMap.UPLOADING = 'N/A';
				stageMap.COMPILE = 'N/A';
				stageMap.RUNNING = 'N/A';
			} else {
			const uploadFailed = stage === 'UPLOAD' || stage === 'LOCKED';
			const stoppedStageFailed = stage === 'STOP' || stage === 'THREAD_CHECK' || stage === 'COMPILE_DEFERRED';
			stageMap.UPLOADING = uploadFailed ? 'FAIL' : 'OK';
			stageMap.STOPPING = uploadFailed ? 'N/A' : (stoppedStageFailed ? 'FAIL' : 'OK');
			stageMap.COMPILE = stage === 'COMPILE' ? 'FAIL' : ((stage === 'START' || stage === 'ERROR_CHECK') ? 'OK' : 'N/A');
			stageMap.RUNNING = deploy.mode === 'Build' || deploy.mode === 'Upload Only'
				? 'SKIP'
				: (deploy.lastStage === 'START' ? 'FAIL' : ((deploy.lastStage === 'ERROR_CHECK' || deploy.lastStage === 'SUCCESS') ? 'OK' : 'N/A'));
			}
		}
	}

	const envErrors = snapshot.errors.filter(e => classifyErrorEntry(e).isControllerSystem).length;
	const codeErrors = snapshot.errors.length - envErrors;
	const threadErrors = snapshot.threads.filter(t => t.state === 'Error').length;
	const runtimeReason = runtime.reason || '미연결';
	const runtimeUnstable = isRuntimeConsoleUnstable(runtime);

	let verdict: '정상' | '간헐' | '실패' = '정상';
	let verdictReason = '이상 징후 없음';
	if (!snapshot.connected) {
		verdict = '실패';
		verdictReason = `${channelName('command')} 미연결`;
	} else if (codeErrors > 0 || threadErrors > 0) {
		verdict = '실패';
		verdictReason = `코드 오류 ${codeErrors}건 / Error thread ${threadErrors}건`;
	} else if (runtimeUnstable) {
		verdict = '간헐';
		verdictReason = `${channelName('runtime')} 불안정 (${runtimeReason}${runtime.detail ? `, ${runtime.detail}` : ''})`;
	} else if (envErrors > 0) {
		verdict = '간헐';
		verdictReason = `환경 경고 ${envErrors}건`;
	}

	const lines: string[] = [];
	lines.push('# GPL 원클릭 진단 스냅샷');
	lines.push('');
	lines.push(`- 생성 시각: ${new Date(options?.now ?? Date.now()).toLocaleString('ko-KR')}`);
	lines.push(`- ${channelName('command')}: ${snapshot.connected ? `Connected (${config.ip}:${config.port})` : 'Disconnected'}`);
	lines.push(`- ${channelName('runtime')}: ${formatRuntimeConsoleStateLabel(runtime)} (${config.ip}:${config.consolePort})`);
	lines.push(`- ${channelName('runtime')} 상세: ${formatRuntimeConsoleStatusDetail(runtime)}`);
	lines.push('');

	lines.push(`## ${channelName('runtime')} 관찰 증거`);
	lines.push(`- 마지막 상태 변경: ${formatDateTimeFromTs(runtime.lastChangedAt)}`);
	lines.push(`- noPayloadStreak: ${runtime.noPayloadStreak}`);
	lines.push(`- pollEmptyStreak: ${runtime.immediateEofStreak}`);
	if (runtime.lastConnectAt) {
		lines.push(`- 마지막 연결 시도: ${formatDateTimeFromTs(runtime.lastConnectAt)}`);
	}
	if (runtime.lastPayloadAt) {
		lines.push(`- 마지막 payload: ${formatDateTimeFromTs(runtime.lastPayloadAt)} (${runtime.lastPayloadBytes ?? 0} bytes)`);
	} else {
		lines.push('- 마지막 payload: 없음');
	}
	if (runtime.lastErrorCode) {
		lines.push(`- 마지막 소켓 오류 코드: ${runtime.lastErrorCode}`);
	}
	if (runtime.reconnectDelayMs) {
		lines.push(`- ${runtime.immediateEofStreak > 0 ? '폴링 대기' : '재연결 대기'}: ${runtime.reconnectDelayMs}ms${runtime.reconnectAttempt ? ` (attempt ${runtime.reconnectAttempt})` : ''}`);
	}
	const runtimeHypothesis = getRuntimeConsoleHypothesis(runtime);
	if (runtimeHypothesis) {
		lines.push(`- 가설: ${runtimeHypothesis}`);
	}
	lines.push('');

	lines.push('## Deploy 단계 판정');
	lines.push(`- STOPPING: ${stageMap.STOPPING}`);
	lines.push(`- UPLOADING: ${stageMap.UPLOADING}`);
	lines.push(`- COMPILE: ${stageMap.COMPILE}`);
	lines.push(`- RUNNING: ${stageMap.RUNNING}`);
	if (deploy) {
		lines.push(`- 최근 배포 요약: ${deploy.summary}`);
		if (deploy.unverifiableReason) {
			lines.push(`- 검증 상태: 코드 수정 효과 검증 불가 (${deploy.unverifiableReason})`);
		}
		if (deploy.comparisonNote) {
			lines.push(`- 비교 판정: ${deploy.comparisonNote}`);
		}
	}
	lines.push('');

	if (deploy?.compileRawSummary && deploy.compileRawSummary.length > 0) {
		lines.push('## COMPILE 원문 로그 요약');
		for (const raw of deploy.compileRawSummary) {
			lines.push(`- ${raw}`);
		}
		lines.push('');
	}

	if (snapshot.runtimeErrorContext) {
		const errCtx = snapshot.runtimeErrorContext;
		lines.push('## Error Thread 상세');
		lines.push(`- 스레드: ${errCtx.threadId !== undefined ? `${errCtx.threadName} (#${errCtx.threadId})` : errCtx.threadName}`);
		lines.push(`- 상태: ${errCtx.statusText || '(미상)'}`);
		lines.push(`- 직전 실행 명령: ${errCtx.lastCommand || '(미상)'}`);
		lines.push(`- 최초 발생 시각: ${errCtx.firstSeenAt || '(미상)'}`);
		if (errCtx.stackFrames && errCtx.stackFrames.length > 0) {
			for (const frame of errCtx.stackFrames) {
				lines.push(`- 프레임: ${frame}`);
			}
		}
		if (errCtx.relatedFunctions && errCtx.relatedFunctions.length > 0) {
			lines.push(`- 관련 함수: ${errCtx.relatedFunctions.join(', ')}`);
		}
		lines.push('');
	}

	lines.push('## 최근 에러 코드 Top N');
	if (topCodes.length === 0) {
		lines.push('- 없음');
	} else {
		for (const [code, count] of topCodes) {
			const hint = getErrorCodeHint(code);
			const meaning = hint ? `${hint.title} — ${hint.meaning}` : '해석 없음';
			lines.push(`- ${code}: ${count}회 · ${meaning}`);
		}
	}
	lines.push('');

	lines.push('## 원인 체인 (추정)');
	if (chains.length === 0) {
		lines.push('- 감지된 대표 체인 없음');
	} else {
		for (const chain of chains) {
			lines.push(`- ${chain}`);
		}
	}
	lines.push('');

	lines.push('## 최종 판정');
	lines.push(`- ${verdict} (${verdictReason})`);
	const judgment = [
		`환경 이슈: ${envErrors > 0 ? '있음' : '없음'}`,
		`코드 이슈: ${(codeErrors > 0 || threadErrors > 0) ? '있음' : '없음'}`,
		`표시/UI 이슈: ${runtimeUnstable ? '가능성 높음' : '낮음'}`,
	].join(' / ');
	lines.push(`- 판정(환경/코드/UI): ${judgment}`);

	return lines.join('\n');
}
