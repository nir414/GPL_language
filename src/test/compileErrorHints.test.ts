import * as assert from 'assert';
import { test } from './harness';
import { attachCompileErrorHints, compileErrorHint } from '../controller/deployment/compileErrorHints';
import { CompileError, getErrorCodeHint, parseCompileErrors } from '../controller/protocol/responseParser';

// ─── 컴파일 에러 줄 문맥 안내 (2026-10-25 실기 컴파일 원문) ───

const RAW = [
    'Lib\\Device\\LeadshineRS/LeadshineRS.gpl:1368:(-741): *Argument mismatch* ReadFeedback',
    'Lib\\Device\\LeadshineRS/LeadshineRS.gpl:1370:(-729): *Undefined symbol* result',
    'Lib\\Device\\LeadshineRS/LeadshineRS.gpl:1373:(-733): *Not a top-level statement*',
    'Lib\\Motion\\System/MotionSystem.gpl:1317:(-741): *Argument mismatch* EnsurePowerOn',
    'Lib\\Motion\\System/MotionSystem.gpl:1324:(-773): *Missing module end* End Function',
    'Lib\\Device\\LeadshineRS/LeadshineRS.gpl:1353:(-722): *Unexpected text at end of line*',
    'Lib\\Robot/RobotUnit.gpl:900:(-737): *Too many errors*',
].join('\n');

const LINES: Record<string, string> = {
    'LeadshineRS.gpl:1368': '    Public Function ReadFeedback() As LeadshineFeedbackResult',
    'MotionSystem.gpl:1317': '    Public Function EnsurePowerOn() As MotionResult',
    'LeadshineRS.gpl:1353': '        result = New LeadshineFeedbackResult()  \' 결과 객체',
};

function readLine(file: string, line: number): string | undefined {
    return LINES[`${file.split('/').pop()}:${line}`];
}

test('compileErrorHints: 선언 줄 -741 · 파생 -733/-773 · New X() -722 · -737 에 안내', () => {
    const errors = parseCompileErrors(RAW);
    assert.strictEqual(errors.length, 7);
    attachCompileErrorHints(errors, readLine);
    const byLine = new Map(errors.map(e => [`${e.code}@${e.line}`, e.hint]));
    assert.strictEqual(byLine.get('-741@1368'), getErrorCodeHint(-741)!.action);
    assert.strictEqual(byLine.get('-741@1317'), getErrorCodeHint(-741)!.action);
    assert.strictEqual(byLine.get('-729@1370'), undefined, '표에 없는 코드는 안내 없음');
    assert.ok(byLine.get('-733@1373')!.startsWith('1368행 -741 의 파생'));
    assert.ok(byLine.get('-773@1324')!.startsWith('1317행 -741 의 파생'));
    assert.strictEqual(byLine.get('-722@1353'), getErrorCodeHint(-722)!.action);
    assert.ok(byLine.get('-737@900')!.includes('다음 컴파일'));
});

test('compileErrorHints: 문맥이 맞지 않으면 붙이지 않는다', () => {
    const call: CompileError = { file: 'A.gpl', line: 10, code: -741, message: '*Argument mismatch* F' };
    assert.strictEqual(compileErrorHint(call, [call], '        x = F(1, 2)'), undefined, '호출 줄의 -741');
    assert.strictEqual(compileErrorHint(call, [call], undefined), undefined, '줄을 못 읽음');
    const extra: CompileError = { file: 'A.gpl', line: 5, code: -722, message: '*Unexpected text at end of line*' };
    assert.strictEqual(compileErrorHint(extra, [extra], '    x = 1 2'), undefined);
    assert.strictEqual(compileErrorHint(extra, [extra], "    x = 1 ' New Foo()"), undefined, '주석 속 New X()');
    assert.strictEqual(compileErrorHint(extra, [extra], '    Dim p As New Pt(1)'), undefined, '인자가 있으면 다른 원인');
    const orphan: CompileError = { file: 'A.gpl', line: 20, code: -733, message: '*Not a top-level statement*' };
    const otherFile: CompileError = { file: 'B.gpl', line: 1, code: -741, message: '*Argument mismatch* G' };
    assert.strictEqual(compileErrorHint(orphan, [otherFile, orphan], '    x = 1'), undefined, '다른 파일의 -741 은 원인이 아니다');
});

test('compileErrorHints: 다시 붙이면 낡은 안내를 지운다', () => {
    const err: CompileError = { file: 'A.gpl', line: 3, code: -741, message: '*Argument mismatch* F', hint: '이전 값' };
    attachCompileErrorHints([err], () => '    F(1)');
    assert.strictEqual(err.hint, undefined);
});
