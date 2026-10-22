import * as assert from 'assert';
import { test } from './harness';
import { renderErrorReport, ErrorReportInput } from '../controller/diagnostics/errorReport';
import { getErrorCodeHint } from '../controller/protocol/responseParser';

// ─── 「오류 상세」 렌더러 — 보이는 것(Output)과 복사되는 것(클립보드)이 같은 재료·같은 줄 (§1-EA) ───

const clock = (ms: number): string => `T${ms}`;

function genAdp757(over: Partial<ErrorReportInput> = {}): ErrorReportInput {
    return {
        raw: '09-21-2026 10:04:49.135, GenAdp, -757, "*Object not instantiated*"',
        code: -757,
        category: 'code',
        groupTitle: 'Language Related Errors',
        hint: getErrorCodeHint(-757),
        threadName: 'GenAdp',
        threadState: 'Error',
        threadStatus: '-757 *Object not instantiated*',
        project: 'GenAdp',
        projectStart: 'ORCH_Main.MAIN',
        lastCommand: 'ErrorLog',
        firstSeenAt: '09-21-2026 10:04:49.135',
        location: { file: 'LineBuffer.gpl', line: 69, procedure: 'Init' },
        stackLines: ['Init @ LineBuffer.gpl:69'],
        relatedFunctions: ['Init'],
        startMismatch: '⚠ 진입점 불일치: …',
        recentEvents: [{ at: 1000, text: '[Start] CMD Start GenAdp -compile -event', count: 1 }],
        extensionVersion: '0.9.5',
        now: 5000,
        formatTime: clock,
        ...over,
    };
}

test('errorReport: 제목은 스레드·코드·상태 문구를 담고 코드 숫자를 두 번 쓰지 않는다', () => {
    const lines = renderErrorReport(genAdp757());
    assert.strictEqual(lines[0], '## 오류 상세 — GenAdp -757 *Object not instantiated*');
});

test('errorReport: 종전 복사(툴팁 몇 줄)에 없던 재료가 전부 들어간다', () => {
    const text = renderErrorReport(genAdp757()).join('\n');
    for (const must of [
        '- 분류: 코드 오류 (문서상 Language Related Errors)',
        '- 에러 스레드: GenAdp (Error · -757 *Object not instantiated*)',
        '- 프로젝트: GenAdp · ProjectStart="ORCH_Main.MAIN"',
        '- 위치: LineBuffer.gpl:69 (Init)',
        '- 첫 에러 시각: 09-21-2026 10:04:49.135',
        '- 해석: Object not instantiated',
        '⚠ 진입점 불일치',
        '### 호출 경로/프레임 (안쪽 → 바깥쪽)',
        '- 0: Init @ LineBuffer.gpl:69',
        '### 직전 제어기 사건 (최근 10건)',
        '- T1000  [Start] CMD Start GenAdp -compile -event',
        '_GPL Language Support v0.9.5 · T5000_',
    ]) {
        assert.ok(text.includes(must), `빠진 줄: ${must}\n---\n${text}`);
    }
});

test('errorReport: 모르는 값은 (미확인)/(없음) 으로 적고 지어내지 않는다', () => {
    const lines = renderErrorReport({
        category: 'unknown',
        stackLines: [],
        relatedFunctions: [],
        recentEvents: [],
        extensionVersion: '0.9.5',
        now: 1,
        formatTime: clock,
    });
    const text = lines.join('\n');
    assert.strictEqual(lines[0], '## 오류 상세 — GPL');
    assert.ok(text.includes('- 원문: (없음)'));
    assert.ok(text.includes('- 코드: (미확인)'));
    assert.ok(text.includes('- 분류: 분류 미상'));
    assert.ok(text.includes('- 위치: (미확인)'));
    assert.ok(text.includes('- (스택 정보 없음)') && text.includes('- (식별 실패)') && text.includes('- (기록 없음)'));
    assert.ok(!text.includes('프로젝트:'), '프로젝트도 ProjectStart 도 모르면 그 줄을 만들지 않는다');
    assert.ok(!text.includes('해석:'), '힌트가 없으면 해석 줄이 없다');
});

test('errorReport: -782 는 종전 후보 줄을 유지한다', () => {
    const text = renderErrorReport(genAdp757({ code: -782, hint: getErrorCodeHint(-782), threadStatus: undefined })).join('\n');
    assert.ok(text.includes('- -782 후보:'));
    assert.strictEqual(text.split('\n')[0], '## 오류 상세 — GenAdp -782');
});
