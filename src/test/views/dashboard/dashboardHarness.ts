import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * 실제 대시보드 웹뷰 스크립트를 vm 에서 실행하고 DOM 경계만 대체한다. 브라우저 배치·모양 검증은 별도다.
 * 이벤트 리스너는 잡아 두었다가 `fire` 로 부르고, 타이머는 `tick` 으로 직접 흘리며, 웹뷰가 보낸 메시지는 `posted` 에 쌓인다.
 */
export function loadDashboard() {
	const html = fs.readFileSync(path.resolve(__dirname, '../../../../assets/webview/dashboard.html'), 'utf8');
	const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1];
	const elements = new Map<string, any>();
	const listeners = new Map<string, Array<(event: any) => void>>();
	function element(id: string): any {
		if (!elements.has(id)) {
			const attrs = new Map<string, string>();
			elements.set(id, {
				textContent: '', innerHTML: '', className: '', title: '', options: [], style: {}, hidden: false, attrs,
				classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
				querySelector: (selector: string) => element(id + selector),
				addEventListener: (type: string, fn: (event: any) => void) => {
					const key = id + '#' + type;
					listeners.set(key, [...(listeners.get(key) ?? []), fn]);
				},
				removeAttribute() {}, appendChild() {},
				setAttribute: (k: string, v: unknown) => { attrs.set(k, String(v)); },
				getBoundingClientRect: () => ({ left: 0, top: 0, width: 260, height: 70 }),
			});
		}
		return elements.get(id);
	}
	let now = 0;
	let nextTimer = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const posted: any[] = [];
	const context = vm.createContext({
		document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, createElement: () => element('new'), addEventListener() {} },
		window: { addEventListener() {}, innerWidth: 1000, getSelection: () => ({ removeAllRanges() {} }) },
		acquireVsCodeApi: () => ({ postMessage: (m: unknown) => { posted.push(m); } }),
		setTimeout: (fn: () => void, ms = 0) => { const id = nextTimer++; timers.set(id, { at: now + ms, fn }); return id; },
		clearTimeout: (id: number) => { timers.delete(id); },
		CSS: { escape: (s: string) => s },
	});
	vm.runInContext(script, context, { filename: 'dashboard.html' });
	posted.length = 0;   // 시작 시 'ready'
	const run = (code: string, vars: Record<string, unknown> = {}) => {
		Object.assign(context, vars);
		return vm.runInContext(code, context);
	};
	/** `id` 요소에 등록된 `type` 리스너를 부른다. target.closest 는 selector 가 맞을 때 `match` 를 돌려준다. */
	const fire = (id: string, type: string, event: { closest?: Record<string, any>; detail?: number } = {}) => {
		const target = { closest: (selector: string) => event.closest?.[selector] ?? null };
		(listeners.get(id + '#' + type) ?? []).forEach(fn => fn({ target, detail: event.detail ?? 1, preventDefault() {} }));
	};
	const tick = (ms: number) => {
		now += ms;
		for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
			if (t.at <= now && timers.has(id)) { timers.delete(id); t.fn(); }
		}
	};
	return { html, element, context, run, fire, tick, posted };
}
