import * as assert from 'assert';
import { test } from '../../harness';
import { loadDashboard } from './dashboardHarness';

/** I/O 탭 칩: 클릭 = 강제 토글, 더블클릭 = 강제 해제(2026-11-04 사용자 요청). */
function setup(forced: boolean) {
	const d = loadDashboard();
	d.run('renderDio(snap)', {
		snap: {
			connected: true, timestamp: 0, target: { ip: 'c', port: 1402 }, absent: [],
			groups: [{ id: 'soft', section: 'local', title: 'Soft', detail: '', on: 1, forced: forced ? 1 : 0, signals: [{ signal: 20064, direction: 'output', on: true, forced }] }],
		},
	});
	d.posted.length = 0;
	const chip = { dataset: { signal: '20064', group: 'soft' } };
	const click = (detail = 1) => d.fire('dioView', 'click', { closest: { '.dio-chip': chip }, detail });
	const dblclick = () => d.fire('dioView', 'dblclick', { closest: { '.dio-chip': chip } });
	return { d, click, dblclick };
}

test('dashboard dio: 한 번 클릭하면 잠깐 뒤 강제 토글을 한 번 보낸다', () => {
	const s = setup(false);
	s.click();
	assert.deepStrictEqual(s.d.posted, [], '더블클릭인지 가리는 동안은 보내지 않는다');
	s.d.tick(300);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(s.d.posted)), [{ type: 'toggleDio', signal: 20064 }]);
});

test('dashboard dio: 더블클릭은 토글 없이 강제 해제만 보낸다', () => {
	const s = setup(true);
	s.click(1);
	s.click(2);
	s.dblclick();
	s.d.tick(1000);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(s.d.posted)), [{ type: 'setDio', signal: 20064, value: 0 }]);
});

test('dashboard dio: 강제되지 않은 신호의 더블클릭은 아무것도 보내지 않고 이유를 알린다', () => {
	const s = setup(false);
	s.click(1);
	s.click(2);
	s.dblclick();
	s.d.tick(1000);
	assert.deepStrictEqual(s.d.posted, []);
	assert.ok(s.d.element('dioNotice').textContent.includes('강제된 신호가 아닙니다'));
});
