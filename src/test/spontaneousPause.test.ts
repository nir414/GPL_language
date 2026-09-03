import * as assert from 'assert';
import { test } from './harness';
import { SpontaneousPauseTracker, BreakpointLookup } from '../debug/spontaneousPause';

/** BP 가 하나도 없는 프로젝트 */
const noBreakpoints: BreakpointLookup = () => false;

/** 지정한 위치들에만 BP 가 있는 조회기 (키: `basename소문자:줄`) */
function breakpointsAt(...spots: string[]): BreakpointLookup {
    const set = new Set(spots.map(s => s.toLowerCase()));
    return (file, line) => set.has(`${file}:${line}`);
}

test('spontaneousPause: 등록 BP 와 일치하는 위치는 첫 관측에서 정지로 인정', () => {
    const t = new SpontaneousPauseTracker(3);
    assert.strictEqual(
        t.observe('MAIN', 'Main.gpl', 36, breakpointsAt('main.gpl:36')),
        'breakpoint',
    );
});

test('spontaneousPause: BP 없는 위치의 첫 관측은 알리지 않는다 (스케줄러 대기)', () => {
    const t = new SpontaneousPauseTracker(3);
    assert.strictEqual(t.observe('TCPLSN4000', 'TcpServer.gpl', 330, noBreakpoints), 'scheduler');
});

test('spontaneousPause: Thread.Sleep 루프처럼 위치가 오가면 끝까지 알리지 않는다', () => {
    const t = new SpontaneousPauseTracker(3);
    // 실측 재현: 같은 sleep 루프 안에서 326 ↔ 330 을 오간다.
    const seen = [326, 330, 326, 330, 326, 330].map(
        line => t.observe('TCPLSN4000', 'TcpServer.gpl', line, noBreakpoints),
    );
    assert.deepStrictEqual(seen, ['scheduler', 'scheduler', 'scheduler', 'scheduler', 'scheduler', 'scheduler']);
});

test('spontaneousPause: 같은 위치 연속 관측이 문턱에 닿으면 외부 정지로 인정', () => {
    const t = new SpontaneousPauseTracker(3);
    assert.strictEqual(t.observe('TCPCMD', 'TcpServer.gpl', 819, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('TCPCMD', 'TcpServer.gpl', 819, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('TCPCMD', 'TcpServer.gpl', 819, noBreakpoints), 'external');
});

test('spontaneousPause: 인정 뒤 같은 위치가 이어지면 announced (중복 StoppedEvent 방지)', () => {
    const t = new SpontaneousPauseTracker(2);
    assert.strictEqual(t.observe('MAIN', 'Main.gpl', 36, breakpointsAt('main.gpl:36')), 'breakpoint');
    assert.strictEqual(t.observe('MAIN', 'Main.gpl', 36, breakpointsAt('main.gpl:36')), 'announced');
    assert.strictEqual(t.observe('MAIN', 'Main.gpl', 36, breakpointsAt('main.gpl:36')), 'announced');
});

test('spontaneousPause: 위치가 바뀌면 연속 카운트가 처음부터 다시 센다', () => {
    const t = new SpontaneousPauseTracker(3);
    t.observe('W', 'A.gpl', 10, noBreakpoints);
    t.observe('W', 'A.gpl', 10, noBreakpoints);
    assert.strictEqual(t.observe('W', 'A.gpl', 11, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('W', 'A.gpl', 11, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('W', 'A.gpl', 11, noBreakpoints), 'external');
});

test('spontaneousPause: 파일이 다르면 같은 줄이어도 다른 위치로 센다', () => {
    const t = new SpontaneousPauseTracker(2);
    assert.strictEqual(t.observe('W', 'A.gpl', 10, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('W', 'B.gpl', 10, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('W', 'B.gpl', 10, noBreakpoints), 'external');
});

test('spontaneousPause: reset 후에는 같은 BP 줄에 다시 도달해도 새 정지로 인정', () => {
    const t = new SpontaneousPauseTracker(3);
    const bp = breakpointsAt('main.gpl:36');
    assert.strictEqual(t.observe('MAIN', 'Main.gpl', 36, bp), 'breakpoint');
    assert.strictEqual(t.observe('MAIN', 'Main.gpl', 36, bp), 'announced');
    t.reset('MAIN'); // 쓰레드가 Running 으로 관측됨
    assert.strictEqual(t.observe('MAIN', 'Main.gpl', 36, bp), 'breakpoint');
});

test('spontaneousPause: clear 는 모든 쓰레드의 추적을 버린다', () => {
    const t = new SpontaneousPauseTracker(2);
    t.observe('A', 'X.gpl', 1, noBreakpoints);
    t.observe('B', 'X.gpl', 1, noBreakpoints);
    t.clear();
    assert.strictEqual(t.observe('A', 'X.gpl', 1, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('B', 'X.gpl', 1, noBreakpoints), 'scheduler');
});

test('spontaneousPause: 쓰레드별로 독립 추적한다', () => {
    const t = new SpontaneousPauseTracker(2);
    assert.strictEqual(t.observe('A', 'X.gpl', 5, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('B', 'X.gpl', 5, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('A', 'X.gpl', 5, noBreakpoints), 'external');
});

test('spontaneousPause: 제어기가 준 전체 경로는 basename 으로 정규화해 비교한다', () => {
    const t = new SpontaneousPauseTracker(2);
    const bp = breakpointsAt('tcpserver.gpl:291');
    // Show Thread 는 `GPL_Code\Lib_Net/TcpServer.gpl` 처럼 프로젝트 경로를 붙여 보고한다.
    assert.strictEqual(t.observe('W', 'GPL_Code\\Lib_Net/TcpServer.gpl', 291, bp), 'breakpoint');
});

test('spontaneousPause: 대소문자가 달라도 같은 위치로 센다', () => {
    const t = new SpontaneousPauseTracker(2);
    assert.strictEqual(t.observe('W', 'TcpServer.gpl', 291, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('W', 'TCPSERVER.GPL', 291, noBreakpoints), 'external');
});

test('spontaneousPause: 위치 불명(파일/줄 없음)은 BP 조회를 하지 않는다', () => {
    const t = new SpontaneousPauseTracker(3);
    let asked = 0;
    const spy: BreakpointLookup = () => { asked++; return true; };
    assert.strictEqual(t.observe('W', undefined, undefined, spy), 'scheduler');
    assert.strictEqual(asked, 0, '위치를 모르면 BP 일치 판정을 시도하지 않는다');
});

test('spontaneousPause: 위치 불명이 계속되면 외부 정지 문턱은 그대로 적용된다', () => {
    const t = new SpontaneousPauseTracker(2);
    assert.strictEqual(t.observe('W', undefined, 0, noBreakpoints), 'scheduler');
    assert.strictEqual(t.observe('W', undefined, 0, noBreakpoints), 'external');
});

test('spontaneousPause: confirmPolls 는 최소 1 로 보정된다', () => {
    const t = new SpontaneousPauseTracker(0);
    assert.strictEqual(t.confirmPolls, 1);
    assert.strictEqual(t.observe('W', 'X.gpl', 1, noBreakpoints), 'external');
});

// ── 시간 조건 (1403 트리거로 폴이 빨라질 때의 오인 방지) ──────────────────────

test('spontaneousPause: 횟수를 채워도 confirmMs 미만이면 아직 알리지 않는다', () => {
    const t = new SpontaneousPauseTracker(3, 1500);
    assert.strictEqual(t.observe('W', 'X.gpl', 10, noBreakpoints, 0), 'scheduler');
    assert.strictEqual(t.observe('W', 'X.gpl', 10, noBreakpoints, 250), 'scheduler');
    // 3회째지만 750ms 경과 — 빠른 폴 구간이라 아직 확정하지 않는다.
    assert.strictEqual(t.observe('W', 'X.gpl', 10, noBreakpoints, 750), 'scheduler');
});

test('spontaneousPause: 횟수와 시간을 모두 채우면 외부 정지로 인정', () => {
    const t = new SpontaneousPauseTracker(3, 1500);
    t.observe('W', 'X.gpl', 10, noBreakpoints, 0);
    t.observe('W', 'X.gpl', 10, noBreakpoints, 250);
    t.observe('W', 'X.gpl', 10, noBreakpoints, 750);
    assert.strictEqual(t.observe('W', 'X.gpl', 10, noBreakpoints, 1500), 'external');
});

test('spontaneousPause: 시간을 채워도 횟수가 모자라면 알리지 않는다', () => {
    const t = new SpontaneousPauseTracker(3, 1500);
    assert.strictEqual(t.observe('W', 'X.gpl', 10, noBreakpoints, 0), 'scheduler');
    assert.strictEqual(t.observe('W', 'X.gpl', 10, noBreakpoints, 9_000), 'scheduler');
});

test('spontaneousPause: 위치가 바뀌면 경과 시간도 처음부터 다시 센다', () => {
    const t = new SpontaneousPauseTracker(2, 1000);
    t.observe('W', 'X.gpl', 10, noBreakpoints, 0);
    t.observe('W', 'X.gpl', 10, noBreakpoints, 5_000);
    // 위치 이동 → firstSeenAt 재설정. 횟수는 채우지만 경과는 200ms 뿐이다.
    assert.strictEqual(t.observe('W', 'X.gpl', 11, noBreakpoints, 5_100), 'scheduler');
    assert.strictEqual(t.observe('W', 'X.gpl', 11, noBreakpoints, 5_300), 'scheduler');
});

test('spontaneousPause: BP 일치는 시간 조건과 무관하게 즉시 인정', () => {
    const t = new SpontaneousPauseTracker(3, 1500);
    assert.strictEqual(
        t.observe('MAIN', 'Main.gpl', 36, breakpointsAt('main.gpl:36'), 0),
        'breakpoint',
    );
});
