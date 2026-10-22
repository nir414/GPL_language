/** VS Code 연결 큐와 순수 상태 수집기를 연결한다. */
import { ControllerConfig, getControllerConfig, sendCommandDetailed } from '../connection/controllerConnection';
import { ControllerStatusSampler, ControllerStatusSnapshot, FetchStatusOptions } from './statusSampling';

export * from './statusSampling';

/** sampler를 전달하면 호출 사이에 저빈도 진단 캐시를 재사용한다. */
export async function fetchControllerStatus(
	config?: Partial<ControllerConfig>,
	options?: FetchStatusOptions,
	sampler = new ControllerStatusSampler(),
	isActive?: () => boolean,
): Promise<ControllerStatusSnapshot> {
	const cfg = { ...getControllerConfig(), ...(config ?? {}) };
	return sampler.sample(cfg, {
		send: async command => {
			try {
				return (await sendCommandDetailed(command, cfg, { timeoutMs: 4000, waitForStatusClose: true })).raw;
			} catch { return null; }
		},
		now: Date.now,
		isActive,
	}, options);
}
