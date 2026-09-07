import * as assert from 'assert';
import { test } from './harness';
import {
    DeployOutcomeHistory,
    buildCompileRawSectionLines,
    buildDeployOutcomeSignature,
    classifyDeployErrorLog,
    comparisonNoteFor,
    controllerSystemErrorEntries,
    describeDeployFailure,
    makeDeploySnapshot,
    parsedErrorCodes,
    summarizeCompileAttempts,
} from '../controller/deployOutcome';
import type { CompileAttemptLog, DeployResult } from '../controller/deployService';

// deployOutcome 은 deployService 를 `import type` 으로만 참조하므로 vscode 없이 로드된다.
// 이 테스트는 runDeployCore 결과 보고부(Output 줄·알림 문구·스냅샷)의 문구·순서 회귀를 잡는다.

function result(partial: Partial<DeployResult> = {}): DeployResult {
    return {
        success: false,
        projectName: 'MergeCode',
        compileErrors: [],
        compileAttemptLogs: [],
        precheckWarnings: [],
        errorLog: [],
        trace: [],
        ...partial,
    };
}

function attempt(partial: Partial<CompileAttemptLog> = {}): CompileAttemptLog {
    return { command: 'Compile MergeCode', statusCode: 0, raw: '', errors: [], ...partial };
}

// 실기기 ErrorLog 형식: `MM-DD-YYYY HH:MM:SS.mmm, <source>, <code>, "<message>"`
const SYS_1521 = '09-07-2026 10:00:00.123, Trj, -1521, "Invalid parameter DB file not loaded"';
const SYS_1521_B = '09-07-2026 10:00:00.456, AutoEx, -1521, "Invalid parameter DB file not loaded"';
const CODE_782 = '09-07-2026 10:00:01.000, GPL, -782, "Property not found"';
const FREE_TEXT = 'some unparsable line';

test('deployOutcome 서명: 성공/실패·단계·명령·STATUS·코드 집합(중복 제거·정렬)로 구성된다', () => {
    const ok = buildDeployOutcomeSignature(result({ success: true }), []);
    assert.strictEqual(ok, 'success|SUCCESS|-|status:none|compile:none|system:none');
    const fail = buildDeployOutcomeSignature(result({
        failedPhase: 'COMPILE', failedCommand: 'Compile MergeCode', failedStatusCode: -730,
        compileErrors: [
            { file: 'a.gpl', line: 1, code: -760, message: 'x' },
            { file: 'b.gpl', line: 2, code: -730, message: 'y' },
            { file: 'c.gpl', line: 3, code: -760, message: 'z' },
        ],
    }), [-1521, -1521, -1600]);
    assert.strictEqual(fail, 'fail|COMPILE|Compile MergeCode|status:-730|compile:-760,-730|system:-1600,-1521');
});

test('deployOutcome 컴파일 시도 요약: 첫 비어 있지 않은 줄 + 미완결 메타 + note', () => {
    const r = result({
        compileAttemptLogs: [
            attempt({ raw: '\r\n  \r\n<STATUS>0</STATUS>\r\n' }),
            attempt({
                command: 'Compile X', statusCode: -742, raw: '', note: 'busy-retry',
                responseMeta: {
                    responseComplete: false, bytesReceived: 12, lastChunkAt: 't', idleTimeoutMs: 3000,
                    statusTagReceived: false, dataTagClosed: false, extraIdleApplied: false, durationMs: 1, socketReused: false, socketKept: false,
                },
            }),
        ],
    });
    assert.deepStrictEqual(summarizeCompileAttempts(r), [
        'Compile MergeCode / STATUS 0 / <STATUS>0</STATUS>',
        'Compile X / STATUS -742 / responseComplete=false bytes=12 idle=3000ms / note=busy-retry / (empty)',
    ]);
});

test('deployOutcome 스냅샷: 코드 목록 중복 제거, 시각 주입', () => {
    const s = makeDeploySnapshot({
        mode: 'Build', success: true, lastStage: 'SUCCESS', summary: '빌드 성공',
        compileErrorCodes: [-760, -760], controllerSystemCodes: [-1521, -1600, -1521], comparisonNote: 'n',
    }, 1234);
    assert.deepStrictEqual(s, {
        mode: 'Build', success: true, lastStage: 'SUCCESS', compileErrorCodes: [-760], controllerSystemCodes: [-1521, -1600],
        updatedAt: 1234, summary: '빌드 성공', comparisonNote: 'n', unverifiableReason: undefined, compileRawSummary: undefined,
    });
});

test('deployOutcome 이력: countSame 은 push 전 기준, 상한을 넘으면 오래된 것부터 버린다', () => {
    const h = new DeployOutcomeHistory(2);
    assert.strictEqual(h.countSame('a'), 0);
    h.push({ mode: 'Build', signature: 'a', timestamp: 1, summary: '성공' });
    assert.strictEqual(h.countSame('a'), 1);
    h.push({ mode: 'Build', signature: 'b', timestamp: 2, summary: '성공' });
    h.push({ mode: 'Build', signature: 'c', timestamp: 3, summary: '성공' });
    assert.strictEqual(h.size, 2);
    assert.strictEqual(h.countSame('a'), 0, '상한 초과로 가장 오래된 a 가 밀려났다');
    assert.strictEqual(comparisonNoteFor(0, 'result'), undefined);
    assert.strictEqual(comparisonNoteFor(1, 'result'), '회귀 아님: 동일 결과 패턴 2회 관측');
    assert.strictEqual(comparisonNoteFor(2, 'failure'), '회귀 아님: 동일 실패 패턴 3회 관측');
});

test('deployOutcome ErrorLog 분류: 비면 줄 없음, 시스템/코드 항목 집계, 같은 코드의 부가 설명은 한 번만', () => {
    assert.deepStrictEqual(classifyDeployErrorLog([]), { sysCount: 0, deployErrCount: 0, lines: [] });

    const c = classifyDeployErrorLog([SYS_1521, SYS_1521_B, CODE_782, FREE_TEXT]);
    assert.strictEqual(c.sysCount, 2, '-1521 두 건은 제어기 시스템 경고');
    assert.strictEqual(c.deployErrCount, 2, '-782(code 힌트)와 자유 텍스트는 코드/배포 에러');
    assert.strictEqual(c.lines[0], '', '섹션 앞 빈 줄');
    assert.ok(c.lines[1].startsWith('── [ErrorLog 분류]'), c.lines[1]);
    assert.ok(/^─+$/.test(c.lines[c.lines.length - 1]), '섹션 꼬리 구분선');

    const sysLines = c.lines.filter(l => l.startsWith('[⚠ 환경 경고] [-1521]'));
    assert.strictEqual(sysLines.length, 2);
    const firstIdx = c.lines.indexOf(sysLines[0]);
    const secondIdx = c.lines.indexOf(sysLines[1]);
    assert.ok(c.lines[firstIdx + 1].startsWith('          '), '첫 -1521 뒤에는 detail/해석/권장 들여쓰기 줄이 붙는다');
    assert.ok(c.lines[secondIdx + 1].startsWith('[✘ 코드/배포 에러] [-782]'), '두 번째 -1521 뒤에는 부가 설명 없이 다음 항목');
    assert.ok(c.lines.some(l => l === `[✘ 코드/배포 에러] ${FREE_TEXT}`), '파싱 불가 항목은 코드 표기 없이 원문');
});

test('deployOutcome COMPILE 원문 섹션: 시도 없으면 빈 배열, 미완결 응답은 meta 4줄, precheckWarnings 꼬리', () => {
    assert.deepStrictEqual(buildCompileRawSectionLines(result()), []);
    const lines = buildCompileRawSectionLines(result({
        compileAttemptLogs: [attempt({
            statusCode: -742, note: 'retry', raw: 'RAW',
            errors: [{ file: 'Main.gpl', line: 12, code: -760, message: 'Invalid assignment' }],
            responseMeta: {
                responseComplete: true, bytesReceived: 5, lastChunkAt: 'T', idleTimeoutMs: 3000,
                statusTagReceived: false, dataTagClosed: true, extraIdleApplied: false, durationMs: 1, socketReused: true, socketKept: true,
            },
        })],
        precheckWarnings: ['w1'],
    }));
    assert.deepStrictEqual(lines.slice(0, 2).map((l, i) => i === 1 ? l.startsWith('── [COMPILE 원문 로그]') : l), ['', true]);
    assert.deepStrictEqual(lines.slice(2, -1), [
        '[Compile MergeCode] STATUS -742',
        '  note: retry',
        '  responseComplete=true',
        '  bytesReceived=5',
        '  lastChunkAt=T',
        '  idleTimeoutMs=3000',
        'RAW',
        '  -> Main.gpl:12 (-760) Invalid assignment',
        '  precheckWarnings:',
        '  - w1',
    ]);
});

test('deployOutcome 시스템 항목 추출과 코드 파싱', () => {
    const log = [SYS_1521, CODE_782, FREE_TEXT];
    assert.deepStrictEqual(controllerSystemErrorEntries(log), [SYS_1521]);
    assert.deepStrictEqual(parsedErrorCodes(log), [-1521, -782], '파싱 불가 항목은 코드 없음');
});

test('deployOutcome 실패 문구 ①: COMPILE 단계 + 시스템 에러 = 환경 블로커(검증 불가), 점프 없음', () => {
    const r = result({ failedPhase: 'COMPILE', failedCommand: 'Compile MergeCode', failedStatusCode: -1521, failedStatusMessage: 'bad db', errorLog: [SYS_1521] });
    const d = describeDeployFailure(r, [SYS_1521], undefined);
    assert.strictEqual(d.message,
        '코드 수정 효과 검증 불가: COMPILE 환경 블로커 감지 (COMPILE 단계) / Compile MergeCode / STATUS -1521 (bad db) / 제어기 시스템 경고 1건 (배포 원인 아님) — COMPILE 원문 로그 확인');
    assert.strictEqual(d.unverifiableReason, '제어기 환경 오류가 COMPILE 단계에 존재');
    assert.strictEqual(d.lastStage, 'COMPILE');
    assert.strictEqual(d.jumpToCompileErrors, false);
});

test('deployOutcome 실패 문구 ②: 컴파일 에러가 있으면 개수 표기 + 첫 에러로 점프, 접미(회귀 주석·경로) 순서', () => {
    const r = result({
        failedPhase: 'COMPILE', compileErrors: [{ file: 'a.gpl', line: 1, code: -760, message: 'x' }, { file: 'b.gpl', line: 2, code: -730, message: 'y' }],
        selectedRemoteProjectPath: '/GPL/MergeCode',
    });
    const d = describeDeployFailure(r, [], '회귀 아님: 동일 실패 패턴 2회 관측');
    assert.strictEqual(d.message, '2개 컴파일 에러 (COMPILE 단계) — COMPILE 원문 로그 확인 / 회귀 아님: 동일 실패 패턴 2회 관측 / 경로: /GPL/MergeCode');
    assert.strictEqual(d.jumpToCompileErrors, true);
    assert.strictEqual(d.unverifiableReason, undefined);
});

test('deployOutcome 실패 문구 ③: ErrorLog 전체가 시스템 에러면 "GPL 코드 오류 없음" 명시', () => {
    const r = result({ failedPhase: 'START', failedCommand: 'Start MergeCode', errorLog: [SYS_1521, SYS_1521_B] });
    const d = describeDeployFailure(r, [SYS_1521, SYS_1521_B], undefined);
    assert.strictEqual(d.message, 'START 단계 실패 / Start MergeCode — GPL 코드 오류 없음, 제어기 시스템 경고 2건: Trj (-1521): Invalid parameter DB file not loaded');
    assert.strictEqual(d.lastStage, 'START');
    assert.strictEqual(d.jumpToCompileErrors, false);
});

test('deployOutcome 실패 문구 ④: 그 외는 미상 — 단계가 없으면 lastStage 는 COMPILE 로 폴백', () => {
    const d = describeDeployFailure(result({ errorLog: [FREE_TEXT] }), [], undefined);
    assert.strictEqual(d.message, '알 수 없는 오류 — COMPILE 원문 로그 확인');
    assert.strictEqual(d.lastStage, 'COMPILE');
    const mixed = describeDeployFailure(result({ failedPhase: 'START', errorLog: [SYS_1521, FREE_TEXT] }), [SYS_1521], undefined);
    assert.strictEqual(mixed.message, '알 수 없는 오류 (START 단계) / 제어기 시스템 경고 1건 (배포 원인 아님) — COMPILE 원문 로그 확인',
        '시스템 에러가 섞였지만 전체가 아니면 ③이 아니라 ④');
});
