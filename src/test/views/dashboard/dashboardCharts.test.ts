import * as assert from 'assert';
import { test } from '../../harness';
import { loadDashboard } from './dashboardHarness';

const limits = (min: number, max: number) => [{ min, max }];

/** 실측 구성(2026-11-04): 단일 축 로봇 5대, R1 Track 리밋 −8.1~288.6 */
function robots(r1 = 129.924) {
	return [
		{ robot: 1, name: 'Track', type: 1, angles: [r1], limits: limits(-8.111301, 288.5901) },
		{ robot: 2, name: 'H1 evZ', type: 1, angles: [0], limits: limits(-138.5697, 9.922552) },
		{ robot: 3, name: 'R3', type: 1, angles: [7.5], limits: limits(-8.102965, 11.7852) },
		{ robot: 4, name: 'R4', type: 1, angles: [], limits: limits(-137.6799, 8.25768), note: '조회 실패 STATUS -1001' },
		{ robot: 5, name: 'R5', type: 1, angles: [7.5], limits: [{ min: null, max: null }] },
	];
}

test('dashboard axes: 로봇별 막대가 소프트 리밋 안 위치(%)·리밋 값·근접을 보여 준다', () => {
	const d = loadDashboard();
	d.run('renderAxes(snap)', { snap: { connected: true, robots: robots() } });
	const html: string = d.element('axes').innerHTML;
	// R1: (129.924 + 8.111301) / (288.5901 + 8.111301) = 46.5%
	assert.ok(html.includes('style="width:46.52%"'), html);
	assert.ok(html.includes('<span class="lim lo">-8.1</span><span class="lim hi">288.6</span>'));
	assert.ok(html.includes('47%'));
	assert.ok(html.includes('<span class="rn">Track</span>'));
	// R3 7.5 / 리밋 11.79 → 78.4% (근접 아님), R2 0 / 9.92 → 93.3% (근접 아님 — 5% 밖)
	assert.ok(!/R2[\s\S]*?mark near/.test(html.split('R3')[0]));
	// R4 위치 실패는 그 로봇 줄에만 메모
	assert.ok(html.includes('조회 실패 STATUS -1001'));
	// R5 리밋 없음 → 관측 범위(점선)
	assert.ok(html.includes('rail observed'));
	assert.ok(html.includes('관측 '));
	const sum: string = d.element('axesSum').innerHTML;
	assert.ok(sum.includes('로봇 <b>5</b>'));
	assert.ok(sum.includes('축 <b>4</b>'));
	assert.ok(sum.includes('리밋 없음 <b>1</b>'));
});

test('dashboard axes: 리밋 5% 이내는 근접, 밖은 오류, 움직이면 방향·변화량을 표시한다', () => {
	const d = loadDashboard();
	d.run('renderAxes(snap)', { snap: { connected: true, robots: robots(100) } });
	d.run('renderAxes(snap)', { snap: { connected: true, robots: robots(285) } });
	let html: string = d.element('axes').innerHTML;
	assert.ok(html.includes('class="mark near"'));
	assert.ok(html.includes('▲ 185.00<'));
	assert.ok(d.element('axesSum').innerHTML.includes('이동 중 <b class="warn">1</b>'));
	d.run('renderAxes(snap)', { snap: { connected: true, robots: robots(300) } });
	html = d.element('axes').innerHTML;
	assert.ok(html.includes('class="mark out"'));
	assert.ok(html.includes('ax-val err'));
	assert.ok(d.element('axesSum').innerHTML.includes('리밋 밖 <b class="err">1</b>'));
});

test('dashboard axes: 연결 해제·옛 스냅샷(jointAngles) 모두 처리한다', () => {
	const d = loadDashboard();
	d.run('renderAxes(snap)', { snap: { connected: true, jointAngles: [1, 2] } });
	assert.ok(d.element('axes').innerHTML.includes('J2'));
	d.run('renderAxes(snap)', { snap: { connected: false, robots: robots() } });
	assert.ok(d.element('axes').innerHTML.includes('데이터 없음'));
	assert.strictEqual(d.element('axesSum').innerHTML, '');
});

test('dashboard cartesian: 조인트 전용 구성은 직교 좌표가 없다고 밝힌다', () => {
	const d = loadDashboard();
	d.run('renderCartesian(snap)', { snap: { connected: true, cartesianRobot: null, cartesian: {} } });
	assert.ok(d.element('cartSub').textContent.includes('조인트 전용'));
	d.run('renderCartesian(snap)', { snap: { connected: true, cartesianRobot: 2, cartesian: { x: 1, y: 2 } } });
	assert.ok(d.element('cartSub').textContent.includes('로봇 2'));
});

test('dashboard charts: 모든 추이가 한 카드의 같은 차트로 그려지고 끊긴 구간·임계선·현재값을 표시한다', () => {
	const d = loadDashboard();
	assert.ok(d.html.includes('id="charts"'));
	assert.ok(!d.html.includes('class="spark'), '옛 스파크라인 마크업이 남지 않는다');
	const ids: string[] = JSON.parse(d.run('JSON.stringify(CHARTS.map((c) => c.id))'));
	assert.deepStrictEqual(ids, ['chCpu', 'chAmp', 'chFree', 'chAcc', 'chCl']);
	const pts = [
		{ t: 0, acceptedPerSec: 0.5, clustersFree: 220, freeMb: 3.6 },
		{ t: 60000, acceptedPerSec: null, clustersFree: 219, freeMb: 3.59 },
		{ t: 120000, acceptedPerSec: 12, clustersFree: 210, freeMb: 3.5 },
	];
	d.run("renderChartsFor('res', pts, '대기')", { pts });
	const acc: string = d.element('chAcc-svg').innerHTML;
	assert.strictEqual((acc.match(/M/g) || []).length >= 2, true, 'null 에서 선이 끊긴다');
	assert.ok(acc.includes('class="thr err"'), '경고 임계선');
	assert.ok(acc.includes('>경고</text>'));
	assert.ok(d.element('chAcc-svg').attrs.get('class').includes('err'));
	assert.ok(d.element('chAcc-val').className.includes('err'));
	assert.ok(d.element('chAcc-val').innerHTML.startsWith('12.00'));
	assert.strictEqual(d.element('chAcc-span').textContent, '2.0분 · 2점');
	assert.ok(d.element('chCl-range').textContent.includes('최소 210 · 최대 220'));
	assert.ok(d.element('chFree-svg').innerHTML.includes('class="ylab"'));
	// 데이터가 없으면 이유를 그래프 자리에 쓴다
	d.run("renderChartsFor('temp', [], '연결 끊김')");
	assert.ok(d.element('chCpu-svg').innerHTML.includes('연결 끊김'));
	assert.strictEqual(d.element('chCpu-val').textContent, '—');
});

test('dashboard charts: 사용자 온도 주의 기준을 넘으면 선·현재값이 주의 색이 된다', () => {
	const d = loadDashboard();
	d.run('state.chartCtx.warningC = 55');
	d.run("renderChartsFor('temp', pts, '')", { pts: [{ t: 0, cpuMaxC: 50, amplifierMaxC: null }, { t: 10000, cpuMaxC: 57, amplifierMaxC: null }] });
	assert.ok(d.element('chCpu-svg').innerHTML.includes('주의 55°C'));
	assert.ok(d.element('chCpu-val').className.includes('warn'));
});
