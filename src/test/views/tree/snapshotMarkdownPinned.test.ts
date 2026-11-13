/**
 * 상황/진단 스냅샷 마크다운의 **출력 고정(pinned)** 테스트 — controllerTreeProvider 분할(2026-10-27) 전의 옛 단일 클래스와
 * 바이트 단위로 같은 출력임을 `scripts/dev/compareTreeProvider.js` 로 확인한 값을 그대로 박아 둔다.
 * 결정성만 보는 snapshotMarkdown.test.ts 와 달리, 문구·순서·표 서식이 바뀌면 여기서 깨진다.
 * 의도한 서식 변경이라면 EXPECTED 를 새 출력으로 갱신한다(시각은 로컬 타임존 생성자로 만들어 타임존에 무관).
 */
import * as assert from 'assert';
import { test } from '../../harness';
import { buildDiagnosticSnapshotMarkdown, buildSituationSnapshotMarkdown } from '../../../views/tree/snapshotMarkdown';
import type { ControllerStatusSnapshot } from '../../../views/tree/treeSnapshot';
import type { SituationDeploySnapshot } from '../../../controller/deployment/deployOutcome';
import type { RuntimeConsoleStatusSnapshot } from '../../../controller/runtime/runtimeConsole';

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 27, h, m, s).getTime();
const NOW = at(9, 30);

const idleConsole: RuntimeConsoleStatusSnapshot = {
    state: 'idle', connected: false, reason: '미연결', noPayloadStreak: 0, immediateEofStreak: 0, lastChangedAt: at(9, 29, 55),
};
const liveConsole: RuntimeConsoleStatusSnapshot = {
    state: 'connected', connected: true, reason: '수신 중', noPayloadStreak: 0, immediateEofStreak: 0,
    lastChangedAt: at(9, 29), lastConnectAt: at(9, 28, 59), lastPayloadAt: at(9, 29, 58), lastPayloadBytes: 2048,
};
const flappingConsole: RuntimeConsoleStatusSnapshot = {
    state: 'reconnecting', connected: false, reason: '재연결 대기', detail: 'ECONNRESET', noPayloadStreak: 4, immediateEofStreak: 0,
    lastChangedAt: at(9, 20), lastConnectAt: at(9, 19), lastErrorCode: 'ECONNRESET', reconnectDelayMs: 4000, reconnectAttempt: 3,
};

const CONFIG = { ip: '192.168.0.50', port: 1402, consolePort: 1403, ftpBasePath: '/GPL', ftpFlashProjectsPath: '/flash/projects' };

function snapshot(over: Partial<ControllerStatusSnapshot>): ControllerStatusSnapshot {
    return {
        connected: false, config: CONFIG, expectedProjectName: 'Demo', expectedProjectFolderName: 'Demo',
        threads: [], breakpoints: [], errors: [], ftpEntries: [], ftpError: null, ftpFlashEntries: [], ftpFlashError: null,
        lastFtpRefreshAt: 0, sysInfo: [], lastSystemInfoRefreshAt: 0, runtimeConsoleStatus: idleConsole, ...over,
    };
}

/** A: 미연결, 아무 데이터 없음 */
const disconnected = snapshot({});

/** B: 연결 + 쓰레드(실행/정지/에러) + 에러 로그(코드·환경·체인) + 중단점 + FTP + 시스템 정보 + 런타임 오류 컨텍스트 */
const busy = snapshot({
    connected: true,
    runtimeConsoleStatus: liveConsole,
    threads: [
        { name: 'Main', state: 'Running', lastStatus: '0', project: 'Demo', file: 'Main.gpl', fileLine: 12, stackTiming: [1, 2, 3] },
        { name: 'Worker', state: 'Paused', lastStatus: '-755', project: 'Demo', file: 'Util.gpl', fileLine: 40 },
        { name: 'Bad', state: 'Error', lastStatus: '-757', project: 'Other', file: 'Other.gpl', fileLine: 7 },
    ],
    errors: [
        '09-21-2026 10:04:49.135, GenAdp, -757, "*Object not instantiated*"',
        '09-21-2026 10:04:50.000, SYSTEM, -1521, "*Invalid parameter DB*"',
        '09-21-2026 10:05:00.000, GenAdp, -782, "*Some failure*"',
        '09-21-2026 10:05:01.000, GenAdp, -508, "*File not found*"',
        '09-21-2026 10:05:02.000, GenAdp, -2, "*Command failed*"',
    ],
    breakpoints: [
        { number: 1, project: 'Demo', proc: 'Main', procLine: 5, file: 'Main.gpl', fileLine: 10, hitCount: 3 },
        { number: 2, project: 'Demo', proc: 'Helper', procLine: 2, file: 'Util.gpl', fileLine: 21, hitCount: 0 },
    ],
    ftpEntries: [
        { name: 'Demo', isDirectory: true, size: 0, modifiedAt: new Date(2026, 9, 20, 10, 2) },
        { name: 'boot.gpo', isDirectory: false, size: 123456, modifiedAt: new Date(2026, 8, 1, 19, 0) },
        { name: 'tiny.txt', isDirectory: false, size: 12 },
    ],
    ftpFlashEntries: [{ name: 'Saved', isDirectory: true, size: 0 }],
    lastFtpRefreshAt: at(9, 25),
    sysInfo: [
        { label: '메모리', value: 'Free: 12.34 MB', tooltip: 'raw', iconId: 'database' },
        { label: 'CPU', value: '37.5%', tooltip: 'cpu', iconId: 'pulse' },
    ],
    lastSystemInfoRefreshAt: at(9, 26),
    runtimeErrorContext: {
        threadName: 'Bad', threadId: 4, lastCommand: 'Start Demo', firstSeenAt: '10:04:49', statusText: '-757 Object not instantiated',
        stackFrames: ['Main.gpl:12 Foo', 'Util.gpl:7 Bar'], relatedFunctions: ['Foo', 'Bar'],
    },
});

/** C: 연결 + 쓰레드 없음 + 런타임 콘솔 재연결 중 + 컴파일 검증 필요 */
const flapping = snapshot({
    connected: true,
    runtimeConsoleStatus: flappingConsole,
    ftpEntries: [{ name: 'Demo', isDirectory: true, size: 0 }],
    compileStale: [{ ip: '192.168.0.50', projectName: 'Demo', projectDir: 'C:/proj/Demo', since: at(9, 28), markedAt: at(9, 28), reason: '/GPL 소스만 업로드됨' }],
});

const failedCompile: SituationDeploySnapshot = {
    mode: 'Upload & Start', success: false, lastStage: 'COMPILE', compileErrorCodes: [-508, -782], controllerSystemCodes: [-1521],
    updatedAt: at(9, 27), summary: '컴파일 실패', compileRawSummary: ['err a', 'err b'],
};
const okBuild: SituationDeploySnapshot = {
    mode: 'Build', success: true, lastStage: 'SUCCESS', compileErrorCodes: [], controllerSystemCodes: [], updatedAt: at(9, 27), summary: 'ok',
    unverifiableReason: '이전 빌드와 동일', comparisonNote: '동일',
};

const CASES: ReadonlyArray<{ name: string; snap: ControllerStatusSnapshot; deploy?: SituationDeploySnapshot }> = [
    { name: 'disconnected', snap: disconnected },
    { name: 'busy+compileFail', snap: busy, deploy: failedCompile },
    { name: 'flapping+buildOk', snap: flapping, deploy: okBuild },
];

const EXPECTED: Record<string, { situation: string[]; diagnostic: string[] }> = {
    'disconnected': {
        situation: [
            '# GPL Controller 상황 스냅샷',
            '',
            '## 연결',
            '- 명령 포트: Disconnected',
            '- 콘솔 포트: Disconnected (192.168.0.50:1403)',
            '- 콘솔 상세: 미연결',
            '- 시각: 2026. 10. 27. 오전 9:30:00',
            '',
            '## 최근 배포 결과',
            '- 최근 배포 기록 없음',
            '',
            '## 프로젝트 컨텍스트',
            '- 기대 프로젝트: Demo ⚠ 불일치',
            '- 기대 FTP 폴더: Demo',
            '- 실행 프로젝트: (없음) ⚠ 기대 프로젝트 미실행',
            '- FTP 프로젝트 폴더: (없음) ⚠ 기대 프로젝트 폴더 없음',
            '',
            '## 쓰레드',
            '- 전체 0: Running 0, Paused 0, Idle 0, Error 0',
            '',
            '## 브레이크포인트',
            '- 없음',
            '',
            '## FTP 파일',
            '- 파일 없음',
            '',
            '## 시스템 정보',
            '- 조회 안됨',
            '',
            '## 에러 로그',
            '- 활성 에러 없음',
        ],
        diagnostic: [
            '# GPL 원클릭 진단 스냅샷',
            '',
            '- 생성 시각: 2026. 10. 27. 오전 9:30:00',
            '- 명령 콘솔: Disconnected',
            '- 런타임 콘솔: Disconnected (192.168.0.50:1403)',
            '- 런타임 콘솔 상세: 미연결',
            '',
            '## 런타임 콘솔 관찰 증거',
            '- 마지막 상태 변경: 2026. 10. 27. 오전 9:29:55',
            '- noPayloadStreak: 0',
            '- pollEmptyStreak: 0',
            '- 마지막 payload: 없음',
            '',
            '## Deploy 단계 판정',
            '- STOPPING: N/A',
            '- UPLOADING: N/A',
            '- COMPILE: N/A',
            '- RUNNING: N/A',
            '',
            '## 최근 에러 코드 Top N',
            '- 없음',
            '',
            '## 원인 체인 (추정)',
            '- 감지된 대표 체인 없음',
            '',
            '## 최종 판정',
            '- 실패 (명령 콘솔 미연결)',
            '- 판정(환경/코드/UI): 환경 이슈: 없음 / 코드 이슈: 없음 / 표시/UI 이슈: 낮음',
        ],
    },
    'busy+compileFail': {
        situation: [
            '# GPL Controller 상황 스냅샷',
            '',
            '## 연결',
            '- 명령 포트: Connected (192.168.0.50:1402)',
            '- 콘솔 포트: Connected (192.168.0.50:1403)',
            '- 콘솔 상세: 수신 중',
            '- 마지막 payload: 2026. 10. 27. 오전 9:29:58 (2048 bytes)',
            '- 시각: 2026. 10. 27. 오전 9:30:00',
            '',
            '## 최근 배포 결과',
            '- 결과: 실패',
            '- 모드: Upload & Start',
            '- 마지막 단계: COMPILE',
            '- 컴파일 에러 코드: -508, -782',
            '- 제어기 시스템 코드: -1521',
            '- 요약: 컴파일 실패',
            '- 기록 시각: 2026. 10. 27. 오전 9:27:00',
            '',
            '## 프로젝트 컨텍스트',
            '- 기대 프로젝트: Demo',
            '- 기대 FTP 폴더: Demo',
            '- 실행 프로젝트: Demo, Other',
            '- FTP 프로젝트 폴더: Demo, Saved',
            '',
            '## 쓰레드',
            '- 전체 3: Running 1, Paused 1, Idle 0, Error 1',
            '',
            '| 이름 | 상태 | STATUS | 프로젝트 | 위치 | 프로시저 | Timing(-stack) |',
            '|------|------|--------|----------|------|----------|----------------|',
            '| Main | Running | 0 | Demo | Main.gpl:12 | - | 1 / 2 / 3 |',
            '| Worker | Paused | -755 | Demo | Util.gpl:40 | - | - |',
            '| Bad | Error | -757 | Other | Other.gpl:7 | - | - |',
            '',
            '## 브레이크포인트',
            '',
            '| 파일:줄 | 프로시저 | hit 횟수 |',
            '|---------|----------|----------|',
            '| Main.gpl:10 | Main | 3 |',
            '| Util.gpl:21 | Helper | 0 |',
            '',
            '## FTP 파일',
            '',
            '| 이름 | 유형 | 크기 | 수정일 |',
            '|------|------|------|--------|',
            '| Demo | 폴더 | - | 2026-10-20 10:02 |',
            '| boot.gpo | 파일 | 120.6 KB | 2026-09-01 19:00 |',
            '| tiny.txt | 파일 | 12 B | - |',
            '- 마지막 FTP 조회: 2026. 10. 27. 오전 9:25:00 (연결 플랩 시 자동 재조회 안 함 — 새로고침으로 갱신)',
            '',
            '## 시스템 정보',
            '- 메모리: Free: 12.34 MB',
            '- CPU: 37.5%',
            '',
            '## 에러 로그',
            '- 09-21-2026 10:04:49.135, GenAdp, -757, "*Object not instantiated*"',
            '- 09-21-2026 10:04:50.000, SYSTEM, -1521, "*Invalid parameter DB*"',
            '- 09-21-2026 10:05:00.000, GenAdp, -782, "*Some failure*"',
            '- 09-21-2026 10:05:01.000, GenAdp, -508, "*File not found*"',
            '- 09-21-2026 10:05:02.000, GenAdp, -2, "*Command failed*"',
            '',
            '## 오류 스레드 상세',
            '- 스레드: Bad (#4)',
            '- 상태: -757 Object not instantiated',
            '- 직전 실행 명령: Start Demo',
            '- 최초 발생 시각: 10:04:49',
            '- 스택:',
            '  - Main.gpl:12 Foo',
            '  - Util.gpl:7 Bar',
            '- 관련 함수: Foo, Bar',
        ],
        diagnostic: [
            '# GPL 원클릭 진단 스냅샷',
            '',
            '- 생성 시각: 2026. 10. 27. 오전 9:30:00',
            '- 명령 콘솔: Connected (192.168.0.50:1402)',
            '- 런타임 콘솔: Connected (192.168.0.50:1403)',
            '- 런타임 콘솔 상세: 수신 중',
            '',
            '## 런타임 콘솔 관찰 증거',
            '- 마지막 상태 변경: 2026. 10. 27. 오전 9:29:00',
            '- noPayloadStreak: 0',
            '- pollEmptyStreak: 0',
            '- 마지막 연결 시도: 2026. 10. 27. 오전 9:28:59',
            '- 마지막 payload: 2026. 10. 27. 오전 9:29:58 (2048 bytes)',
            '',
            '## Deploy 단계 판정',
            '- STOPPING: OK',
            '- UPLOADING: OK',
            '- COMPILE: FAIL',
            '- RUNNING: N/A',
            '- 최근 배포 요약: 컴파일 실패',
            '',
            '## COMPILE 원문 로그 요약',
            '- err a',
            '- err b',
            '',
            '## Error Thread 상세',
            '- 스레드: Bad (#4)',
            '- 상태: -757 Object not instantiated',
            '- 직전 실행 명령: Start Demo',
            '- 최초 발생 시각: 10:04:49',
            '- 프레임: Main.gpl:12 Foo',
            '- 프레임: Util.gpl:7 Bar',
            '- 관련 함수: Foo, Bar',
            '',
            '## 최근 에러 코드 Top N',
            '- -757: 1회 · Object not instantiated — 객체 블록이 할당되지 않은 상태에서 그 필드/멤버에 접근했다(문서: Language Related Errors)',
            '- -1521: 1회 · Controller 환경 이슈 — Invalid parameter DB file not loaded (/flash/config *.pac 로드/형식 문제)',
            '- -782: 1회 · Object value is Nothing — 객체/참조값 초기화 누락 가능성이 큼',
            '- -508: 1회 · File not found — 파일/프로젝트 경로를 찾지 못함',
            '- -2: 1회 · Command/Runtime failure — 선행 실패의 연쇄로 발생할 수 있는 일반 실패 코드',
            '',
            '## 원인 체인 (추정)',
            '- -782 → -508 → -2',
            '- -782 → -2',
            '- -508 → -2',
            '',
            '## 최종 판정',
            '- 실패 (코드 오류 4건 / Error thread 1건)',
            '- 판정(환경/코드/UI): 환경 이슈: 있음 / 코드 이슈: 있음 / 표시/UI 이슈: 낮음',
        ],
    },
    'flapping+buildOk': {
        situation: [
            '# GPL Controller 상황 스냅샷',
            '',
            '## 연결',
            '- 명령 포트: Connected (192.168.0.50:1402)',
            '- 콘솔 포트: Reconnecting (192.168.0.50:1403)',
            '- 콘솔 상세: 재연결 대기 / ECONNRESET / noPayloadStreak=4 / reconnect=4000ms',
            '- 시각: 2026. 10. 27. 오전 9:30:00',
            '',
            '## 최근 배포 결과',
            '- 결과: 성공',
            '- 모드: Build',
            '- 마지막 단계: SUCCESS',
            '- 컴파일 에러 코드: (없음)',
            '- 제어기 시스템 코드: (없음)',
            '- 요약: ok',
            '- 기록 시각: 2026. 10. 27. 오전 9:27:00',
            '',
            '## 프로젝트 컨텍스트',
            '- 기대 프로젝트: Demo',
            '- 기대 FTP 폴더: Demo',
            '- 실행 프로젝트: (없음) (Build Only 가능)',
            '- FTP 프로젝트 폴더: Demo',
            '',
            '## 쓰레드',
            '- 전체 0: Running 0, Paused 0, Idle 0, Error 0',
            '',
            '## 브레이크포인트',
            '- 없음',
            '',
            '## FTP 파일',
            '',
            '| 이름 | 유형 | 크기 | 수정일 |',
            '|------|------|------|--------|',
            '| Demo | 폴더 | - | - |',
            '',
            '## 시스템 정보',
            '- 조회 안됨',
            '',
            '## 에러 로그',
            '- 활성 에러 없음',
        ],
        diagnostic: [
            '# GPL 원클릭 진단 스냅샷',
            '',
            '- 생성 시각: 2026. 10. 27. 오전 9:30:00',
            '- 명령 콘솔: Connected (192.168.0.50:1402)',
            '- 런타임 콘솔: Reconnecting (192.168.0.50:1403)',
            '- 런타임 콘솔 상세: 재연결 대기 / ECONNRESET / noPayloadStreak=4 / reconnect=4000ms',
            '',
            '## 런타임 콘솔 관찰 증거',
            '- 마지막 상태 변경: 2026. 10. 27. 오전 9:20:00',
            '- noPayloadStreak: 4',
            '- pollEmptyStreak: 0',
            '- 마지막 연결 시도: 2026. 10. 27. 오전 9:19:00',
            '- 마지막 payload: 없음',
            '- 마지막 소켓 오류 코드: ECONNRESET',
            '- 재연결 대기: 4000ms (attempt 3)',
            '',
            '## Deploy 단계 판정',
            '- STOPPING: OK',
            '- UPLOADING: OK',
            '- COMPILE: OK',
            '- RUNNING: SKIP',
            '- 최근 배포 요약: ok',
            '- 검증 상태: 코드 수정 효과 검증 불가 (이전 빌드와 동일)',
            '- 비교 판정: 동일',
            '',
            '## 최근 에러 코드 Top N',
            '- 없음',
            '',
            '## 원인 체인 (추정)',
            '- 감지된 대표 체인 없음',
            '',
            '## 최종 판정',
            '- 간헐 (런타임 콘솔 불안정 (재연결 대기, ECONNRESET))',
            '- 판정(환경/코드/UI): 환경 이슈: 없음 / 코드 이슈: 없음 / 표시/UI 이슈: 가능성 높음',
        ],
    },
};

for (const c of CASES) {
    test(`snapshotMarkdown 고정 출력: ${c.name} — 상황 스냅샷`, () => {
        const actual = buildSituationSnapshotMarkdown(c.snap, { now: NOW, deploySnapshot: c.deploy });
        assert.strictEqual(actual, EXPECTED[c.name].situation.join('\n'));
    });
    test(`snapshotMarkdown 고정 출력: ${c.name} — 진단 스냅샷`, () => {
        const actual = buildDiagnosticSnapshotMarkdown(c.snap, { now: NOW, deploySnapshot: c.deploy });
        assert.strictEqual(actual, EXPECTED[c.name].diagnostic.join('\n'));
    });
}
