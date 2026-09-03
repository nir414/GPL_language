import * as assert from 'assert';
import { test } from './harness';
import {
    breakpointEchoKey,
    formatBreakpointCommand,
    MirrorEchoMemory,
    parseBreakpointCommand,
} from '../controller/breakpointCommand';

test('breakpointCommand: 표준 표기는 따옴표와 줄번호 사이에 공백이 없다 (GDE 실측)', () => {
    assert.strictEqual(
        formatBreakpointCommand('Break', 'GPL_Code', 'Main.gpl', 10),
        'Set Break GPL_Code "Main.gpl"10');
    assert.strictEqual(
        formatBreakpointCommand('Nobreak', 'GPL_Code', 'Main.gpl', 36),
        'Set Nobreak GPL_Code "Main.gpl"36');
});

test('breakpointCommand: 무공백·문서(공백) 표기를 모두 해석한다', () => {
    assert.deepStrictEqual(parseBreakpointCommand('Set Break GPL_Code "Main.gpl"10'),
        { kind: 'Break', project: 'GPL_Code', file: 'Main.gpl', line: 10 });
    assert.deepStrictEqual(parseBreakpointCommand('Set Break My_project "Testfile.gpl" 30'),
        { kind: 'Break', project: 'My_project', file: 'Testfile.gpl', line: 30 });
    assert.deepStrictEqual(parseBreakpointCommand('  set nobreak GPL_Code "Main.gpl"  7  '),
        { kind: 'Nobreak', project: 'GPL_Code', file: 'Main.gpl', line: 7 });
});

test('breakpointCommand: 생성한 명령은 그대로 되해석된다 (왕복)', () => {
    const cmd = formatBreakpointCommand('Nobreak', 'MergeCode', 'ProtocolModule.gpl', 818);
    assert.deepStrictEqual(parseBreakpointCommand(cmd),
        { kind: 'Nobreak', project: 'MergeCode', file: 'ProtocolModule.gpl', line: 818 });
});

test('breakpointCommand: 하위 폴더 표기는 파일명만 남긴다 (제어기 목록과 같은 단위)', () => {
    assert.strictEqual(parseBreakpointCommand('Set Break P "T1\\T2\\T2.gpl"5')?.file, 'T2.gpl');
    assert.strictEqual(parseBreakpointCommand('Set Break P "sub/Other.gpl"5')?.file, 'Other.gpl');
});

test('breakpointCommand: BP 명령이 아니면 해석하지 않는다', () => {
    // 스레드 정지 명령 `Break <thread>`는 `Set` 접두어가 없다 — 미러가 잘못 반응하면 안 된다.
    assert.strictEqual(parseBreakpointCommand('Break MAIN'), undefined);
    assert.strictEqual(parseBreakpointCommand('Show Break'), undefined);
    assert.strictEqual(parseBreakpointCommand('Set Variable x = 1'), undefined);
    assert.strictEqual(parseBreakpointCommand('Set Break GPL_Code "Main.gpl"'), undefined);
    assert.strictEqual(parseBreakpointCommand('Set Break GPL_Code "Main.gpl"0'), undefined);
    assert.strictEqual(parseBreakpointCommand('Set Break GPL_Code ""10'), undefined);
});

test('MirrorEchoMemory: 기억한 변경은 한 번만 소비된다', () => {
    const echo = new MirrorEchoMemory();
    echo.note('Break', 'Main.gpl', 10);
    assert.strictEqual(echo.consume('Break', 'Main.gpl', 10), true);
    // 두 번째는 사용자가 같은 자리를 다시 토글한 것 — 제어기로 정상 전송돼야 한다.
    assert.strictEqual(echo.consume('Break', 'Main.gpl', 10), false);
});

test('MirrorEchoMemory: 종류·위치가 다르면 걸리지 않는다', () => {
    const echo = new MirrorEchoMemory();
    echo.note('Break', 'Main.gpl', 10);
    assert.strictEqual(echo.consume('Nobreak', 'Main.gpl', 10), false);
    assert.strictEqual(echo.consume('Break', 'Main.gpl', 11), false);
    assert.strictEqual(echo.consume('Break', 'Other.gpl', 10), false);
    assert.strictEqual(echo.consume('Break', 'MAIN.GPL', 10), true, '파일명 대소문자는 무시');
});

test('MirrorEchoMemory: TTL이 지난 기록은 에코로 보지 않는다 (놓친 이벤트가 뒤늦게 걸리지 않게)', () => {
    let now = 1000;
    const echo = new MirrorEchoMemory(3000, () => now);
    echo.note('Break', 'Main.gpl', 10);
    now += 3001;
    assert.strictEqual(echo.consume('Break', 'Main.gpl', 10), false);
});

test('MirrorEchoMemory: prune이 만료 기록을 정리한다', () => {
    let now = 1000;
    const echo = new MirrorEchoMemory(3000, () => now);
    echo.note('Break', 'Main.gpl', 10);
    echo.note('Break', 'Main.gpl', 20);
    echo.prune();
    assert.strictEqual(echo.size, 2);
    now += 3001;
    echo.prune();
    assert.strictEqual(echo.size, 0);
});

test('breakpointEchoKey: 경로가 붙어도 같은 키 (미러와 이벤트 쪽 표기가 달라도 매칭)', () => {
    assert.strictEqual(
        breakpointEchoKey('Break', 'C:\\proj\\Main.gpl', 10),
        breakpointEchoKey('Break', 'main.gpl', 10));
});
