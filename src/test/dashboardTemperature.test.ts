import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { test } from './harness';
import { parseTemperatureResponse } from '../controller/diagnostics/temperature';

/** 실제 웹뷰 스크립트를 실행하고 DOM 경계만 대체한다. 브라우저 배치 검증은 별도다. */
function setup() {
	const html = fs.readFileSync(path.resolve(__dirname, '../../media/dashboard.html'), 'utf8');
	const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1];
	const elements = new Map<string, any>();
	function element(id: string): any {
		if (!elements.has(id)) {
			elements.set(id, {
				textContent: '', innerHTML: '', className: '', title: '', options: [], style: {},
				classList: { add() {}, remove() {}, toggle() {} },
				querySelector: (selector: string) => element(id + selector),
				addEventListener() {}, removeAttribute() {}, appendChild() {}, setAttribute() {},
			});
		}
		return elements.get(id);
	}
	const context = vm.createContext({
		document: { getElementById: element, querySelectorAll: () => [], createElement: () => element('new') },
		window: { addEventListener() {} }, acquireVsCodeApi: () => ({ postMessage() {} }),
	});
	vm.runInContext(script, context, { filename: 'dashboard.html' });
	const snapshot = { connected: true, timestamp: 1000, temperature: parseTemperatureResponse('<DATA>CPU 1: 57.1 C\nRobot 1\nAmp 1: 0.0 C</DATA><STATUS>0,"Success"</STATUS>', 1000) };
	const render = (s = snapshot, warningC = 0) => {
		Object.assign(context, { snapshot: s, warningC });
		vm.runInContext('renderTemperature(snapshot, [{t:1000,cpuMaxC:57.1,amplifierMaxC:null}], warningC, 10000)', context);
	};
	return { render, element, snapshot, context, html };
}

test('dashboard temperature: 실제 웹뷰가 CPU 실측과 앰프 센서 제한을 표시한다', () => {
	const s = setup();
	s.render();
	assert.strictEqual(s.element('bTemp.v').textContent, '57.1 °C');
	assert.ok(s.element('tempReadings').innerHTML.includes('센서 지원 미확인'));
	assert.ok(s.element('tempSummary').textContent.includes('과열 여부 미판정'));
	assert.ok(!s.element('bTemp').className.includes('ok'));
	assert.ok(s.element('tempRaw').textContent.includes('57.1 C'));
	assert.ok(s.element('sparkCpuCap').textContent.includes('범위 57.1~57.1'));
	assert.ok(s.html.includes('id="bTemp"'));
});

test('dashboard temperature: 사용자 기준만 주의 색상을 만들고 제조사 한계와 구별한다', () => {
	const s = setup();
	s.render(s.snapshot, 57);
	assert.ok(s.element('bTemp').className.includes('warn'));
	assert.ok(s.element('bTemp.s').textContent.includes('제조사 보호 한계와 별개'));
});

test('dashboard temperature: 캐시의 조회 시각·오래된 값을 드러낸다', () => {
	const s = setup();
	s.render({ ...s.snapshot, timestamp: 32000 });
	assert.ok(s.element('tempSub').textContent.includes('31초 전'));
	assert.ok(s.element('tempSub').textContent.includes('오래된 값'));
	assert.ok(s.element('bTemp').className.includes('warn'));
});

test('dashboard temperature: 실패와 연결 해제가 이전 센서값을 현재값으로 남기지 않는다', () => {
	const s = setup();
	s.render();
	s.render({ ...s.snapshot, temperature: parseTemperatureResponse(null, 2000) });
	assert.strictEqual(s.element('bTemp.v').textContent, '—');
	assert.ok(s.element('tempReadings').innerHTML.includes('응답 없음'));
	s.render({ ...s.snapshot, connected: false });
	assert.strictEqual(s.element('bTemp.v').textContent, '—');
	assert.strictEqual(s.element('tempSub').textContent, '연결 끊김');
	assert.strictEqual(s.element('tempRaw').textContent, '—');
});

test('dashboard temperature: 원문·센서 라벨에 HTML이 있어도 실행 가능한 태그로 넣지 않는다', () => {
	const s = setup();
	s.snapshot.temperature.readings[0].label = '<img src=x onerror=alert(1)>';
	s.render();
	assert.ok(s.element('tempReadings').innerHTML.includes('&lt;img'));
	assert.ok(!s.element('tempReadings').innerHTML.includes('<img'));
});

test('dashboard log: 실패한 오류 조회를 로그 없음으로 표시하지 않는다', () => {
	const s = setup();
	Object.assign(s.context, { snapshot: { connected: true, errors: [], errorsNote: '에러 로그 조회 실패' } });
	vm.runInContext('renderLog(snapshot)', s.context);
	assert.ok(s.element('log').innerHTML.includes('조회 실패'));
	assert.strictEqual(s.element('logSub').textContent, '에러 로그 조회 실패');
});

test('dashboard resources: 연결 해제 시 이전 센서값·그래프·원문을 지운다', () => {
	const s = setup();
	s.element('rFree').textContent = '5.0 MB';
	s.element('sparkAcc').innerHTML = '<path></path>';
	s.element('resRawPre').textContent = 'old-controller-data';
	vm.runInContext('renderResources({connected:false}, [], false)', s.context);
	assert.strictEqual(s.element('rFree').textContent, '—');
	assert.strictEqual(s.element('sparkAcc').innerHTML, '');
	assert.strictEqual(s.element('resRawPre').textContent, '—');
});
