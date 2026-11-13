/**
 * 제어기 트리의 섹션별 노드 구성 — 평문 데이터(treeSnapshot)를 받아 SectionNode 트리를 돌려준다. vscode 무의존.
 * controllerTreeProvider.ts 의 buildRoot/buildFtpSection/ftpNodes/buildOnDemandCacheTooltip 을 섹션 단위 함수로
 * 옮겼다(2026-10-27, 라벨·설명·툴팁·아이콘·contextValue·순서·기본 접힘 상태 동일). 섹션의 **순서**는 아래
 * buildConnectedRoot 가 정한다(2026-11-04 재배치 — 순서·기본 접힘은 test/views/tree/treeSectionsLayout.test.ts 가 고정). 컴파일 검증 배지의 리소스 인자(`vscode.Uri`)만 호출부가 `toResource` 로 넣는다.
 */
import type { ConnectionStats } from '../../controller/connection/consoleSocket';
import type { TrafficLogOptions } from '../../controller/connection/controllerConnection';
import { BreakpointTarget, breakpointKey, orphanControllerBreakpoints } from '../../controller/debugging/breakpointReconcile';
import type { CompileStaleInfo } from '../../controller/deployment/compileStale';
import type { FtpEntry } from '../../controller/files/ftpClient';
import { ftpEntryContext } from '../../controller/files/ftpNodeTarget';
import { isSafeRemoteEntryName } from '../../controller/files/remoteSourceSession';
import { channelName } from '../../controller/protocol/channelNames';
import {
	BreakpointInfo,
	ThreadInfo,
	classifyErrorEntry,
	extractErrorCodeFromEntry,
	findKnownErrorChains,
	getErrorCodeHint,
} from '../../controller/protocol/responseParser';
import type { RuntimeConsoleStatusSnapshot } from '../../controller/runtime/runtimeConsole';
import { countThreadStates } from '../../controller/threads/threadReport';
import { formatBytes } from '../../util/formatBytes';
import { compileStaleBadgeCommand, compileStaleBadgeLabel, compileStaleBadgeTooltip, compileStaleLatestFirst } from '../statusbar/compileStaleBadge';
import { FTP_AUTO_REFRESH_MIN_INTERVAL_MS, SYSTEM_INFO_AUTO_REFRESH_MIN_INTERVAL_MS, formatLastRefreshTime } from './refreshThrottle';
import {
	buildRuntimeConsoleTreeDescription,
	buildRuntimeConsoleTreeTooltip,
	getRuntimeConsoleTreeIcon,
} from './runtimeConsoleTreePresentation';
import { threadStateRank } from './threadRowPresentation';
import { formatConnectionStats, formatDate } from './treeFormat';
import { ControllerNode, InfoNode, SectionNode, ThreadNode } from './treeNodes';
import type { ControllerStatusSnapshot, ControllerTreeConfig, RuntimeErrorContext, SystemInfoItem } from './treeSnapshot';

/**
 * 섹션 기본 접힘 상태의 "세대". VS Code 는 TreeItem.id 별로 사용자의 접기/펴기 상태를 워크스페이스에
 * 저장하고, 저장된 상태가 있으면 provider 가 준 collapsibleState 를 무시한다. 그래서 기본값을 바꿔도
 * 기존 사용자에게는 반영되지 않는다 — 이 값을 올리면 섹션 id 가 달라져 저장된 상태가 한 번만
 * 초기화되고(이후 사용자가 접은 것은 평소대로 기억된다), 새 기본값이 적용된다.
 * **기본 접힘 상태를 바꿀 때마다 1 씩 올릴 것.**
 */
export const SECTION_LAYOUT_EPOCH = 3;

/**
 * 온디맨드 캐시 섹션(FTP 목록/시스템 정보) 공용 툴팁 — 연결 플랩 시 자동 재조회하지 않음을 알린다(#22).
 */
export function buildOnDemandCacheTooltip(lastRefreshAt: number, minIntervalMs: number): string {
	const minutes = Math.round(minIntervalMs / 60_000);
	return [
		'연결 플랩(유실 → 재연결) 시 자동 재조회하지 않음 — 새로고침 아이콘으로 갱신하세요.',
		`(마지막 조회가 ${minutes}분 이내이고 캐시가 있으면 재연결 시 캐시를 유지합니다. 배포 후에는 자동 갱신됩니다.)`,
		lastRefreshAt > 0 ? `마지막 조회: ${formatDate(new Date(lastRefreshAt))}` : '아직 조회하지 않음',
	].join('\n');
}

/**
 * 원격 폴더만 펼칠 수 있고, 파일은 현재 창의 읽기 전용 편집기로 연다.
 * `nested`(펼친 폴더 안의 목록)의 폴더는 프로젝트 폴더가 아니므로 별도 context 를 받는다 — 프로젝트 명령(Run·Stop·Unload)은
 * 저장 영역 바로 아래 폴더에만 보인다(controller/files/ftpNodeTarget.ts).
 */
export function ftpNodes(entries: readonly FtpEntry[], basePath: string, controllerHost: string, flash: boolean, nested: boolean): InfoNode[] {
	if (entries.some(entry => entry.name !== '.' && entry.name !== '..' && !isSafeRemoteEntryName(entry.name))) {
		return [new InfoNode('안전하지 않은 FTP 목록 항목을 표시하지 않았습니다.', 'error')];
	}
	return entries.filter(e => e.name !== '.' && e.name !== '..').map(entry => {
		const remotePath = `${basePath}/${entry.name}`;
		const context = ftpEntryContext(entry.isDirectory, flash, nested);
		const description = [!entry.isDirectory ? formatBytes(entry.size) : '', entry.modifiedAt ? formatDate(entry.modifiedAt) : ''].filter(Boolean).join(' · ');
		return new InfoNode(entry.name, entry.isDirectory ? 'folder' : 'file', description || undefined, entry.isDirectory ? undefined : {
				command: 'gpl.controller.openRemoteFile', title: '제어기 파일 열기', arguments: [{ remotePath, controllerHost }],
			}, context, entry.modifiedAt ? formatDate(entry.modifiedAt) : undefined, remotePath, entry.name, controllerHost);
	});
}

/** 미연결 섹션 — 연결 명령 한 줄. */
export function buildDisconnectedSection(): SectionNode {
	const sec = new SectionNode('disconnected', '연결되지 않음', 'debug-disconnect');
	sec.children = [
		new InfoNode('제어기에 연결하기', 'plug', '클릭하여 연결', {
			command: 'gpl.controller.connect',
			title: 'Connect to Controller',
		}),
	];
	return sec;
}

export interface FtpSectionInput {
	id: string;
	title: string;
	icon: string;
	basePath: string;
	entries: readonly FtpEntry[];
	error: string | null;
	/** Flash Projects 영역이면 true(/GPL 이면 false) — 폴더/파일 contextValue 가 달라진다. */
	flash: boolean;
	/** 마지막 FTP 목록 조회 성공 시각(epoch ms, 0=없음) */
	lastFtpRefreshAt: number;
	controllerHost: string;
	/** 캐시가 현재 제어기 설정(IP·경로)의 것인지. 아니면 항목 대신 새로고침 안내를 보인다. */
	cacheMatches: boolean;
}

/** FTP 목록 섹션 노드 생성 — /GPL(ftp)과 Flash Projects(ftpFlash) 공용. */
export function buildFtpSection(input: FtpSectionInput): SectionNode {
	const { entries, error } = input;
	// 설명에 마지막 조회 시각을 붙여 "연결 플랩 뒤 보존된 캐시"가 낡을 수 있음을 드러낸다(#22).
	const lastLabel = input.lastFtpRefreshAt > 0 ? formatLastRefreshTime(input.lastFtpRefreshAt) : undefined;
	const description = error
		? '조회 실패'
		: (lastLabel ? `${entries.length}개 · 마지막 조회 ${lastLabel}` : `${entries.length}개`);
	const sec = new SectionNode(input.id, input.title, input.icon, description,
		buildOnDemandCacheTooltip(input.lastFtpRefreshAt, FTP_AUTO_REFRESH_MIN_INTERVAL_MS));
	sec.remotePath = input.basePath;
	// /GPL 은 배포 대상이라 펼쳐 두고, Flash Projects 는 영구 저장 영역이라 손댈 일이 드물어 접어 둔다.
	sec.collapsed = input.flash;
	if (error) {
		sec.children = [new InfoNode(error, 'error')];
	} else if (entries.length === 0) {
		sec.children = [new InfoNode('파일 없음', 'info')];
	} else {
		sec.children = input.cacheMatches
			? ftpNodes(entries, input.basePath, input.controllerHost, input.flash, false)
			: [new InfoNode('제어기 설정이 바뀌었습니다. FTP 목록을 새로고침하세요.', 'info')];
	}
	return sec;
}

/** 런타임 오류 컨텍스트 섹션(최근 Error 쓰레드의 명령·시각·스택). */
export function buildRuntimeErrorSection(errCtx: RuntimeErrorContext): SectionNode {
	const threadLabel = errCtx.threadId !== undefined
		? `${errCtx.threadName} (#${errCtx.threadId})`
		: errCtx.threadName;
	const runtimeErrSec = new SectionNode(
		'runtimeErrorContext',
		'런타임 오류 컨텍스트',
		'error',
		errCtx.statusText || '최근 오류',
	);
	runtimeErrSec.collapsed = true;
	runtimeErrSec.children = [
		new InfoNode(`오류 스레드: ${threadLabel}`, 'debug-stop', errCtx.statusText || undefined),
		new InfoNode(`직전 명령: ${errCtx.lastCommand || '(없음)'}`, 'terminal', undefined),
		new InfoNode(`최초 발생 시각: ${errCtx.firstSeenAt || '(미확인)'}`, 'history', undefined),
		...(errCtx.stackFrames && errCtx.stackFrames.length > 0
			? errCtx.stackFrames.map((frame, idx) => new InfoNode(`프레임 ${idx + 1}: ${frame}`, 'list-tree'))
			: [new InfoNode('스택 프레임 정보 없음', 'info')]),
	];
	return runtimeErrSec;
}

export interface ProjectContextInput<TResource = unknown> {
	threads: readonly ThreadInfo[];
	ftpEntries: readonly FtpEntry[];
	ftpFlashEntries: readonly FtpEntry[];
	expectedProjectName: string;
	expectedProjectFolderName: string;
	/** "컴파일 검증 필요" 목록 — 현재 제어기 것, 오래된 → 최근 표시 순(정본은 host 의 CompileStaleTracker — 여기는 표시만). */
	compileStale?: readonly CompileStaleInfo[];
	/** 컴파일 검증 배지 클릭 명령의 리소스 인자(접착 계층에서는 `vscode.Uri.file`). */
	toResource: (dir: string) => TResource;
}

/** 프로젝트 상태 섹션 — 기대 프로젝트와 실행/FTP 상태의 불일치 가시화 + 컴파일 검증 필요 배지. */
export function buildProjectContextSection(input: ProjectContextInput): SectionNode {
	const runningProjects = [...new Set(
		input.threads.map(t => (t.project || '').trim()).filter(Boolean),
	)];
	const ftpDirs = [
		...input.ftpEntries.filter(e => e.isDirectory).map(e => e.name),
		...input.ftpFlashEntries.filter(e => e.isDirectory).map(e => e.name),
	];
	const expected = input.expectedProjectName;
	const expectedFolder = input.expectedProjectFolderName || expected;
	const hasExpectedRunning = expected
		? runningProjects.some(p => p.toLowerCase() === expected.toLowerCase())
		: false;
	const hasExpectedFtp = expectedFolder
		? ftpDirs.some(p => p.toLowerCase() === expectedFolder.toLowerCase())
		: false;
	const hasUnexpectedRunning = !!expected && runningProjects.length > 0 && !hasExpectedRunning;
	const missingExpectedFtp = !!expectedFolder && !hasExpectedFtp;
	const buildOnlyReady = !!expected && hasExpectedFtp && runningProjects.length === 0;
	// 최근 표시 순(방금 손댄 프로젝트가 맨 위) — 상태바 요약과 같은 순서(views/statusbar/compileStaleBadge).
	const stale = compileStaleLatestFirst(input.compileStale ?? []);
	const mismatch = missingExpectedFtp || hasUnexpectedRunning || stale.length > 0;
	const contextDescription = stale.length > 1
		? `컴파일 검증 필요 ${stale.length}개`
		: stale.length === 1
			? '컴파일 검증 필요'
			: mismatch
			? '불일치 감지'
			: buildOnlyReady
				? '빌드 전용 상태'
				: '정상';

	const ctxSec = new SectionNode(
		'projectContext',
		mismatch ? '프로젝트 상태 ⚠' : '프로젝트 상태',
		mismatch ? 'warning' : 'pass',
		contextDescription,
	);
	ctxSec.collapsed = false;
	const runSummary = runningProjects.length > 0 ? runningProjects.join(', ') : '(없음)';
	ctxSec.children = [
		new InfoNode(`기대: ${expected || '(미설정)'} / 실행: ${runSummary}`, 'target',
			hasUnexpectedRunning
				? `${expected} 대신 다른 프로젝트가 실행 중`
				: buildOnlyReady
					? 'Build Only 후 미실행 상태일 수 있음'
					: hasExpectedRunning || !expected
						? undefined
						: `${expected} 미실행`),
		new InfoNode(`FTP: ${expectedFolder || '(미설정)'} / 현재: ${ftpDirs.length > 0 ? ftpDirs.join(', ') : '(없음)'}`, 'folder-library',
			hasExpectedFtp || !expectedFolder ? undefined : `${expectedFolder} 폴더 없음`),
	];
	if (stale.length > 0) {
		// /GPL 소스만 올라가고 Compile로 검증되지 않은 상태(이슈 #17 재구성의 부수 상태). Start는 `-compile` 로 컴파일하므로(§0.7)
		// 옛 프로그램이 도는 건 아니지만, 소스 에러가 있으면 Start가 실패해 실행되지 않는다(에러 위치는 §1-EW에서 Problems 연동).
		// 프로젝트마다 한 줄 — Upload Only 로 여러 개를 올리면 전부 보여야 "하나 컴파일하니 다른 프로젝트로 바뀐다"로 읽히지 않는다(§1-GN).
		// 문구·클릭 대상은 상태바 배지와 같은 규칙(views/statusbar/compileStaleBadge) — 폴더를 알면 Uri 인자로 선택 창 없이 그 프로젝트.
		ctxSec.children.unshift(...stale.map(info => new InfoNode(
			compileStaleBadgeLabel(info),
			'warning',
			info.reason,
			compileStaleBadgeCommand(info, input.toResource),
			'compileStaleItem',
			compileStaleBadgeTooltip(info),
		)));
	}
	return ctxSec;
}

export interface ConnectionSectionInput {
	ip: string;
	port: number;
	consolePort: number;
	trafficOptions: TrafficLogOptions;
	connectionStats: ConnectionStats | undefined;
	runtimeConsoleStatus: RuntimeConsoleStatusSnapshot;
}

/** 연결 정보 섹션 (간소화) — 명령 포트·통신 모니터·런타임 콘솔·명령 보내기. */
export function buildConnectionSection(input: ConnectionSectionInput): SectionNode {
	const conn = new SectionNode('connection', input.ip, 'plug', '연결됨');
	conn.collapsed = true;
	const trafficOpts = input.trafficOptions;
	conn.children = [
		new InfoNode(`${channelName('command')}: ${input.ip}:${input.port}`, 'server', formatConnectionStats(input.connectionStats), {
			command: 'gpl.controller.pingPort',
			title: '포트 통신 테스트',
			arguments: ['command', input.ip, input.port],
		}),
		new InfoNode(
			'통신 모니터',
			'radio-tower',
			trafficOpts.responseBody
				? `명령 + 응답 본문${trafficOpts.maxResponseChars > 0 ? ` (≤${trafficOpts.maxResponseChars}자)` : ''}`
				: '명령 + STATUS 요약만',
			{ command: 'gpl.controller.showTraffic', title: 'GPL Traffic 열기' },
			'trafficMonitorItem',
			`확장이 ${channelName('command')}로 보내는 모든 명령(>>>)과 제어기 응답( | 본문 줄, <<< STATUS 요약)을 ` +
			'GPL Traffic 출력 채널에 실시간으로 표시합니다.\n' +
			'클릭: 채널 열기 · 인라인/우클릭: 응답 본문 표시 켜기/끄기, 채널 지우기\n' +
			'설정: gpl.controller.trafficLogResponseBody / trafficLogMaxResponseChars',
		),
		new InfoNode(
			channelName('runtime'),
			getRuntimeConsoleTreeIcon(input.runtimeConsoleStatus),
			buildRuntimeConsoleTreeDescription(input.runtimeConsoleStatus),
			{
				command: 'gpl.console.ensure',
				title: '런타임 콘솔 연결/재연결/로그 보기',
			},
			'runtimeConsoleItem',
			buildRuntimeConsoleTreeTooltip(input.runtimeConsoleStatus, input.ip, input.consolePort),
		),
		new InfoNode(
			'명령 보내기',
			'debug-console',
			'제어기에 명령 입력',
			{
				command: 'gpl.controller.sendCommand',
				title: 'Send Command to Controller',
			},
			'sendCommandItem',
			'클릭하여 임의 제어기 명령(Show Thread, ErrorLog, date 등)을 입력하고 응답을 출력 패널에서 확인합니다.',
		),
	];
	return conn;
}

/** 쓰레드 섹션 — 상태별 집계 설명, 정지/에러 쓰레드를 맨 위로 정렬(원본 배열은 보존). */
export function buildThreadsSection(threads: readonly ThreadInfo[]): SectionNode {
	const { running, paused, idle, errCount } = countThreadStates(threads);

	let threadDesc: string;
	if (threads.length === 0) {
		threadDesc = '없음';
	} else {
		const parts: string[] = [];
		if (running > 0) { parts.push(`실행 ${running}`); }
		if (paused > 0) { parts.push(`일시정지 ${paused}`); }
		if (idle > 0) { parts.push(`대기 ${idle}`); }
		if (errCount > 0) { parts.push(`에러 ${errCount}`); }
		threadDesc = parts.join(' · ') || '모두 정지';
	}

	const threadSec = new SectionNode('threads',
		`쓰레드 (${threads.length})`, 'symbol-event', threadDesc);
	threadSec.collapsed = false;
	// 정지/에러 쓰레드를 맨 위로 끌어올려 한눈에 띄게 한다(원본 배열은 보존).
	const sortedThreads = [...threads].sort(
		(a, b) => threadStateRank(a.state) - threadStateRank(b.state),
	);
	threadSec.children = sortedThreads.length > 0
		? sortedThreads.map(t => new ThreadNode(t))
		: [new InfoNode('쓰레드 없음', 'info')];
	return threadSec;
}

/**
 * 브레이크포인트 섹션 (제어기 기준 — 0개여도 상시 표시해 상태를 보이게 한다, §1-AR).
 * `editorTargets` 는 에디터의 빨간 점(controller/debugging/breakpointSync.editorBreakpointTargets) — 제어기에만 있는 항목을 어긋남으로 표시한다.
 */
export function buildBreakpointsSection(breakpoints: readonly BreakpointInfo[], editorTargets: readonly BreakpointTarget[]): SectionNode {
	const totalHits = breakpoints.reduce((s, b) => s + b.hitCount, 0);
	// 제어기에는 있지만 에디터에 빨간 점이 없는 항목 = 어긋남(§1-CJ). 실행하면 여기서 멈추므로
	// 눈에 보이게 표시한다 — 이 상태가 "F9로 지웠는데 왜 걸리지?"의 정체다.
	const orphanKeys = new Set(
		orphanControllerBreakpoints(breakpoints, editorTargets)
			.map(b => breakpointKey({ file: b.file, line: b.fileLine })));
	const bpSec = new SectionNode('breakpoints',
		`브레이크포인트 (${breakpoints.length})`, 'debug-breakpoint',
		breakpoints.length > 0
			? `${totalHits} hits${orphanKeys.size > 0 ? ` · ⚠ ${orphanKeys.size} 에디터에 없음` : ''}`
			: '없음');
	if (breakpoints.length === 0) {
		bpSec.children = [new InfoNode('제어기에 설정된 브레이크포인트 없음', 'circle-slash')];
	} else {
		bpSec.children = breakpoints.map(bp => {
			const loc = `${bp.file}:${bp.fileLine}`;
			const orphan = orphanKeys.has(breakpointKey({ file: bp.file, line: bp.fileLine }));
			const parts = [bp.proc];
			if (bp.hitCount > 0) { parts.push(`${bp.hitCount} hits`); }
			if (orphan) { parts.push('⚠ 에디터에 없음'); }
			const tooltip = `${bp.project} · ${bp.proc} (procLine ${bp.procLine})\n클릭하면 해당 위치를 엽니다 (배포본 기준 줄 번호)`
				+ (orphan
					? '\n\n⚠ 에디터에 대응하는 중단점이 없습니다 — 제어기에만 남아 있어 실행하면 이 줄에서 멈춥니다.\n'
					+ '우클릭 → "제어기에서 이 중단점 해제" 또는 "GPL: Sync Breakpoints"로 정리하세요.'
					: '');
			return new InfoNode(loc, orphan ? 'debug-breakpoint-unverified' : 'debug-breakpoint-data',
				parts.join(' · '), {
					command: 'gpl.controller.openBreakpointLocation',
					title: '위치 열기',
					arguments: [{ file: bp.file, line: bp.fileLine }],
				}, 'breakpointItem', tooltip);
		});
	}
	bpSec.collapsed = true;
	return bpSec;
}

/** 시스템 정보 섹션 — 조회 전이면 새로고침 안내 한 줄, 조회 후에는 행마다 InfoNode. */
export function buildSystemInfoSection(sysInfo: readonly SystemInfoItem[], lastSystemInfoRefreshAt: number): SectionNode {
	const sysSec = new SectionNode('system', '시스템 정보', 'dashboard',
		sysInfo.length > 0
			? (lastSystemInfoRefreshAt > 0 ? `마지막 조회 ${formatLastRefreshTime(lastSystemInfoRefreshAt)}` : undefined)
			: '조회 안됨',
		buildOnDemandCacheTooltip(lastSystemInfoRefreshAt, SYSTEM_INFO_AUTO_REFRESH_MIN_INTERVAL_MS));
	sysSec.collapsed = false;
	if (sysInfo.length === 0) {
		sysSec.children = [
			new InfoNode('새로고침으로 조회하세요', 'info', undefined, {
				command: 'gpl.controller.refreshSystemInfo',
				title: '시스템 정보 새로고침',
			}),
		];
	} else {
		const toRow = (s: SystemInfoItem) => new InfoNode(s.label, s.iconId || 'info', s.value, undefined, undefined, s.tooltip);
		sysSec.children = sysInfo.filter(s => !s.group).map(toRow);
		const amps = sysInfo.filter(s => s.group === 'ampTemperature');
		if (amps.length > 0) {
			sysSec.children.push(buildAmpTemperatureGroup(amps, toRow));
		}
	}
	return sysSec;
}

/**
 * 앰프 온도 묶음 — 로봇·앰프 수만큼 늘어나는 행을 접힌 하위 노드 하나로 모은다(2026-11-04 사용자 요청: CPU 온도는
 * 그대로 보이고 모터 앰프는 접어 둔다). 접어도 헤더 설명에 최고 온도가 보여 이상 징후는 놓치지 않는다.
 */
function buildAmpTemperatureGroup(amps: readonly SystemInfoItem[], toRow: (s: SystemInfoItem) => InfoNode): SectionNode {
	const known = amps.map(a => a.celsius).filter((c): c is number => typeof c === 'number');
	const description = known.length > 0 ? `최고 ${Math.max(...known).toFixed(1)}°C` : '센서 값 미확인';
	const group = new SectionNode('ampTemps', `앰프 온도 (${amps.length})`, 'flame', description);
	group.collapsed = true;
	group.children = amps.map(toRow);
	return group;
}

/** I/O · 전역변수 섹션 (상호작용 진입점). */
export function buildIoSection(): SectionNode {
	const ioSec = new SectionNode('io', 'I/O · 전역변수', 'symbol-interface', 'I/O 제어판 · 전역변수');
	ioSec.collapsed = true;
	ioSec.children = [
		new InfoNode('디지털 I/O 제어판', 'circuit-board', '상태 확인 · 강제 ON/OFF · 해제', { command: 'gpl.controller.showIoPanel', title: '디지털 I/O 제어판 열기' }, 'ioAction', '모든 설치 신호의 ON/OFF·강제 상태를 한눈에 보고, 확인 후 Set DIO를 실행합니다.'),
		new InfoNode('전역변수 보기/편집', 'symbol-variable', 'Show/Set Global', { command: 'gpl.controller.showGlobal', title: 'Show Global' }, 'ioAction', '전역변수 값을 조회하고 필요 시 수정합니다.'),
	];
	return ioSec;
}

/**
 * 에러 로그 섹션 두 개 — [코드 오류, 환경 경고] 순. ErrorLog 항목을 분류(classifyErrorEntry)해 환경 경고를 분리하고,
 * Error 상태 쓰레드는 코드 오류 섹션에 ThreadNode 로 넣는다.
 */
export function buildErrorSections(errors: readonly string[], threads: readonly ThreadInfo[]): [SectionNode, SectionNode] {
	const classifiedEntries = errors.map(raw => {
		const classified = classifyErrorEntry(raw);
		const code = extractErrorCodeFromEntry(raw) ?? classified.parsedCode;
		const hint = typeof code === 'number' ? getErrorCodeHint(code) : undefined;
		const isEnvironment = classified.isControllerSystem || hint?.category === 'environment';
		return { raw, classified, code, hint, isEnvironment };
	});
	const envErrors = classifiedEntries.filter(e => e.isEnvironment);
	const codeErrors = classifiedEntries.filter(e => !e.isEnvironment);
	const errorThreads = threads.filter(t => t.state === 'Error');
	const chainHints = findKnownErrorChains(
		classifiedEntries
			.map(e => e.code)
			.filter((code): code is number => typeof code === 'number'),
	);

	const codeSec = new SectionNode(
		'errorsCode',
		`코드 오류 (${codeErrors.length + errorThreads.length})`,
		codeErrors.length > 0 || errorThreads.length > 0 ? 'error' : 'pass',
		errorThreads.length > 0 ? `Thread Error ${errorThreads.length}` : (codeErrors.length > 0 ? '확인 필요' : '정상'),
	);
	const codeChildren: ControllerNode[] = [];

	// Error 상태 쓰레드는 쓰레드 섹션과 같은 행(ThreadNode)으로 넣는다 — 종전 InfoNode 는 명령도 메뉴도 없어
	// 클릭·복사·위치 이동이 아무것도 되지 않았다. 같은 행이면 클릭 = 에러 위치, 우클릭 = Show Stack/Continue/Stop,
	// 인라인 복사(툴팁 = 이름·상태·파일:줄)가 그대로 붙는다. 인스턴스는 새로 만든다(같은 객체를 두 곳에 두면 VS Code 가 거부).
	for (const et of errorThreads) {
		codeChildren.push(new ThreadNode(et));
	}

	for (const e of codeErrors) {
		const codeLabel = typeof e.code === 'number' ? `${e.code}` : 'N/A';
		const hintDesc = e.hint
			? `${e.hint.title} — ${e.hint.action}`
			: (e.classified.detail ?? '클릭: 클립보드에 복사');
		const line = typeof e.code === 'number'
			? `[${codeLabel}] ${e.classified.summary}`
			: e.classified.summary;
		codeChildren.push(new InfoNode(
			line,
			'error',
			hintDesc,
			{
				command: 'gpl.controller.showErrorDetail',
				title: '오류 상세 보기',
				// 분류는 버킷이 다시 정하지 않고 판정 결과(classifyErrorEntry)를 그대로 넘긴다 — 같은 판단의 사본 금지(R7).
				arguments: [{ raw: e.raw, code: e.code, category: e.classified.category, groupTitle: e.classified.groupTitle }],
			},
			'errorItem',
			e.hint
				? `${line}\n해석: ${e.hint.meaning}\n권장 조치: ${e.hint.action}`
				: line,
		));
	}

	if (chainHints.length > 0) {
		const chainSec = new SectionNode('errorChains', `에러 체인 (${chainHints.length})`, 'git-commit', '연쇄 오류');
		chainSec.collapsed = true;
		chainSec.children = chainHints.map(chain => new InfoNode(
			`추정 체인: ${chain}`,
			'git-commit',
			'연속 에러 패턴 감지',
			undefined,
			'errorChainItem',
			`추정 원인 체인: ${chain}`,
		));
		codeChildren.push(chainSec);
	}

	if (codeChildren.length === 0) {
		codeChildren.push(new InfoNode('활성 코드 오류 없음', 'pass'));
	}
	codeSec.children = codeChildren;
	// 개수·상태가 헤더에 보이고 Error 쓰레드는 펼쳐 둔 쓰레드 섹션 맨 위에 뜨므로 접어 둔다.
	codeSec.collapsed = true;

	const envSec = new SectionNode(
		'errorsEnv',
		`환경 경고 (${envErrors.length})`,
		envErrors.length > 0 ? 'warning' : 'pass',
		envErrors.length > 0 ? '코드와 분리 진단 권장' : '정상',
	);
	const envChildren: InfoNode[] = [];
	for (const e of envErrors) {
		const prefix = typeof e.code === 'number' ? `[${e.code}] ` : '';
		envChildren.push(new InfoNode(
			`${prefix}${e.classified.summary}`,
			'warning',
			e.hint
				? `${e.hint.title} — ${e.hint.action}`
				: (e.classified.detail ?? '제어기 시스템/환경 경고'),
			{
				command: 'gpl.controller.showErrorDetail',
				title: '오류 상세 보기',
				arguments: [{ raw: e.raw, code: e.code, category: e.classified.category, groupTitle: e.classified.groupTitle }],
			},
			'sysErrorItem',
			e.hint
				? `${e.classified.summary}\n해석: ${e.hint.meaning}\n권장 조치: ${e.hint.action}`
				: `[제어기 시스템] ${e.classified.summary}\n${e.classified.detail ?? ''}`,
		));
	}
	if (envChildren.length === 0) {
		envChildren.push(new InfoNode('활성 환경 경고 없음', 'pass'));
	}
	envSec.children = envChildren;
	envSec.collapsed = true;

	return [codeSec, envSec];
}

// ── Root ────────────────────────────────────────────────

/**
 * 트리 루트를 만드는 데 필요한 것 = 제어기 상태 스냅샷 + 접착 계층이 읽어 주는 값
 * (FTP 캐시 일치 여부·에디터 중단점·통신 모니터 설정·연결 통계·리소스 변환).
 */
export interface TreeRootInput<TResource = unknown> extends ControllerStatusSnapshot {
	/** FTP 캐시가 현재 제어기 설정(IP·경로)의 것인지. 아니면 항목 대신 새로고침 안내를 보인다. */
	ftpCacheMatches: boolean;
	/** 에디터의 빨간 점(controller/debugging/breakpointSync.editorBreakpointTargets). */
	editorBreakpointTargets: readonly BreakpointTarget[];
	trafficOptions: TrafficLogOptions;
	connectionStats: ConnectionStats | undefined;
	/** 컴파일 검증 배지 클릭 명령의 리소스 인자(접착 계층에서는 `vscode.Uri.file`). */
	toResource: (dir: string) => TResource;
}

type FtpSnapshot = Pick<ControllerStatusSnapshot, 'ftpEntries' | 'ftpError' | 'ftpFlashEntries' | 'ftpFlashError' | 'lastFtpRefreshAt'>;

/** /GPL · Flash Projects 두 섹션. 제목·아이콘은 연결 전후가 다르다(호출부가 준다). */
function ftpSections(
	snapshot: FtpSnapshot,
	config: ControllerTreeConfig,
	ftpCacheMatches: boolean,
	titles: { gpl: { title: string; icon: string }; flash: { title: string; icon: string } },
): [SectionNode, SectionNode] {
	const common = { lastFtpRefreshAt: snapshot.lastFtpRefreshAt, controllerHost: config.ip, cacheMatches: ftpCacheMatches };
	return [
		buildFtpSection({ id: 'ftp', ...titles.gpl, basePath: config.ftpBasePath, entries: snapshot.ftpEntries, error: snapshot.ftpError, flash: false, ...common }),
		buildFtpSection({ id: 'ftpFlash', ...titles.flash, basePath: config.ftpFlashProjectsPath, entries: snapshot.ftpFlashEntries, error: snapshot.ftpFlashError, flash: true, ...common }),
	];
}

/** 미연결 루트 — 연결 안내 섹션. FTP 탐색 전용 모드(browseFtp)면 두 FTP 섹션을 덧붙인다. */
export function buildDisconnectedRoot(snapshot: FtpSnapshot & { config: ControllerTreeConfig }, ftpBrowseOnly: boolean, ftpCacheMatches: boolean): SectionNode[] {
	const sec = buildDisconnectedSection();
	if (!ftpBrowseOnly) { return [sec]; }
	const cfg = snapshot.config;
	return [sec, ...ftpSections(snapshot, cfg, ftpCacheMatches, {
		gpl: { title: `FTP ${cfg.ftpBasePath}`, icon: 'folder' },
		flash: { title: `FTP ${cfg.ftpFlashProjectsPath}`, icon: 'folder-library' },
	})];
}

/**
 * 연결 상태의 루트 — 섹션 **순서의 정본**(2026-11-04 재배치: 자주 보는 것 → 가끔 여는 것):
 * (런타임 오류 컨텍스트) → 연결 → 프로젝트 상태 → 쓰레드 → 코드 오류 → 브레이크포인트 → FTP 파일 → 시스템 정보 → I/O
 * → 환경 경고 → Flash Projects.
 * 묶음: 어느 제어기·어느 프로젝트(연결·프로젝트 상태) / 실행·디버그(쓰레드·코드 오류·브레이크포인트) /
 * 배포 파일(FTP /GPL) / 장비(시스템 정보·I/O) / 드물게 여는 진단·보관(환경 경고·Flash Projects).
 * 기본 접힘 상태는 각 섹션 빌더가 정하고, 바꾸면 SECTION_LAYOUT_EPOCH 를 올린다.
 */
export function buildConnectedRoot(input: TreeRootInput): SectionNode[] {
	const cfg = input.config;
	const sections: SectionNode[] = [];

	if (input.runtimeErrorContext) {
		sections.push(buildRuntimeErrorSection(input.runtimeErrorContext));
	}

	// ── 연결 정보 (간소화) — 헤더 한 줄이 "어느 제어기에 붙어 있나"를 보여 준다.
	sections.push(buildConnectionSection({
		ip: cfg.ip,
		port: cfg.port,
		consolePort: cfg.consolePort,
		trafficOptions: input.trafficOptions,
		connectionStats: input.connectionStats,
		runtimeConsoleStatus: input.runtimeConsoleStatus,
	}));

	// ── 프로젝트 컨텍스트 (불일치 가시화)
	sections.push(buildProjectContextSection(input));

	// ── 쓰레드
	sections.push(buildThreadsSection(input.threads));

	// ── 에러 로그: 코드 오류는 실행·디버그 묶음에, 환경 경고는 아래쪽 진단 묶음에 둔다.
	const [codeErrors, envWarnings] = buildErrorSections(input.errors, input.threads);
	sections.push(codeErrors);

	// ── 브레이크포인트 (제어기 기준 — 0개여도 상시 표시해 상태를 보이게 한다, §1-AR)
	sections.push(buildBreakpointsSection(input.breakpoints, input.editorBreakpointTargets));

	// ── FTP 파일 (/GPL) · Flash Projects (/flash/projects) — Flash 는 맨 아래로 보낸다.
	const [ftpGpl, ftpFlash] = ftpSections(input, cfg, input.ftpCacheMatches, {
		gpl: { title: `FTP 파일 (${cfg.ftpBasePath})`, icon: 'folder-library' },
		flash: { title: `Flash Projects (${cfg.ftpFlashProjectsPath})`, icon: 'archive' },
	});
	sections.push(ftpGpl);

	// ── 시스템 정보
	sections.push(buildSystemInfoSection(input.sysInfo, input.lastSystemInfoRefreshAt));

	// ── I/O · 전역변수 (상호작용 진입점)
	sections.push(buildIoSection());

	sections.push(envWarnings, ftpFlash);

	return sections;
}
