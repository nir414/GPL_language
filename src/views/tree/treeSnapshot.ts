/**
 * 제어기 트리가 모아 둔 상태의 **평문 데이터** 형식 — vscode 무의존.
 * controllerTreeProvider.ts 에서 분리했다(2026-10-27, 동작 동일). provider 는 제어기에서 받은 것을 이 꼴
 * (`ControllerStatusSnapshot`) 하나로 옮기고, 섹션 빌더(treeSections)와 보고서 렌더러(snapshotMarkdown)는 이것만
 * 읽는다 — 둘 다 Node 단독 테스트가 가능하다.
 */
import type { CompileStaleInfo } from '../../controller/deployment/compileStale';
import type { BreakpointInfo, ThreadInfo } from '../../controller/protocol/responseParser';
import type { FtpEntry } from '../../controller/files/ftpClient';
import type { RuntimeConsoleStatusSnapshot } from '../../controller/runtime/runtimeConsole';

export interface RuntimeErrorContext {
	threadName: string;
	threadId?: number;
	lastCommand?: string;
	firstSeenAt?: string;
	statusText?: string;
	stackFrames?: string[];
	relatedFunctions?: string[];
}

/** 시스템 정보 섹션 한 행(메모리·플래시·CPU·온도). `systemInfoItems.buildSystemInfoItems` 가 만든다. */
export interface SystemInfoItem {
	label: string;
	value: string;
	tooltip?: string;
	iconId?: string;
	/**
	 * 접힌 하위 묶음으로 보낼 행의 묶음 이름. 지금은 앰프 온도(`'ampTemperature'`)만 — 로봇·앰프 수만큼 늘어나
	 * 자주 보지 않으므로 시스템 정보 아래 접힌 "앰프 온도" 노드로 모은다(2026-11-04 사용자 요청). 없으면 섹션 바로 아래.
	 */
	group?: 'ampTemperature';
	/** 온도 행의 판정 가능한 섭씨 값(묶음 헤더의 최고 온도 요약용). 센서 지원 미확인이면 없음. */
	celsius?: number;
}

/** 트리가 쓰는 제어기 설정값(`controllerConnection.getControllerConfig` 의 부분집합). */
export interface ControllerTreeConfig {
	ip: string;
	port: number;
	consolePort: number;
	ftpBasePath: string;
	ftpFlashProjectsPath: string;
}

/** 트리 섹션과 상황/진단 보고서가 읽는 제어기 상태 전체. provider 의 필드를 그대로 평문으로 옮긴 것. */
export interface ControllerStatusSnapshot {
	connected: boolean;
	config: ControllerTreeConfig;
	expectedProjectName: string;
	expectedProjectFolderName: string;
	threads: readonly ThreadInfo[];
	breakpoints: readonly BreakpointInfo[];
	errors: readonly string[];
	ftpEntries: readonly FtpEntry[];
	ftpError: string | null;
	ftpFlashEntries: readonly FtpEntry[];
	ftpFlashError: string | null;
	/** 마지막 FTP 목록 조회 성공 시각(epoch ms, 0=없음) */
	lastFtpRefreshAt: number;
	sysInfo: readonly SystemInfoItem[];
	/** 마지막 시스템 정보 조회 성공 시각(epoch ms, 0=없음) */
	lastSystemInfoRefreshAt: number;
	runtimeConsoleStatus: RuntimeConsoleStatusSnapshot;
	runtimeErrorContext?: RuntimeErrorContext;
	/** "컴파일 검증 필요" 목록 — 현재 제어기 것, 오래된 → 최근 표시 순(정본은 host 의 CompileStaleTracker — 여기는 표시만). */
	compileStale?: readonly CompileStaleInfo[];
}
