import { parseShowMemory } from './resourceProbes';
import { parseStatus } from '../protocol/responseParser';

/**
 * 현장 보고를 바탕으로 한 운영 기준이며 제어기 사양의 절대 한계가 아니다.
 *
 * 경고 전용(2026-10-26 사용자 결정, inbox 2026-10-26_SamplePrep_메모리사전검사_배포차단): "경고만 하랬지 기능을 막으란 건
 * 아니었다." 종전 `blockMb` 미만·측정 실패는 Compile/Start·배포를 **전송하지 않았다**(10-13 AntiBodyR2 첫 Compile 로 제어기가
 * 다운된 사례의 대응). 실측(Binder 8Ch): 앱 실행 중엔 런타임 버퍼로 ~3 MB 를 더 써서 Free 0.18 MB, 정지하면 3.19 MB —
 * 정지 전 값으로 막으면 "잘 돌아가는 배포"를 항상 막는다. 이제 어느 수준이든 **경고만 남기고 계속한다**. 실제로 모자라면
 * 제어기 Compile 이 실패를 알린다. `criticalMb` 는 경고의 두 번째 단계(심각)일 뿐 차단 기준이 아니다.
 */
export const DEFAULT_MEMORY_GUARD = { warnMb: 4, criticalMb: 2.5 };

export interface MemoryGuardOptions {
    warnMb: number;
    criticalMb: number;
}

export interface MemoryPrecheck {
    freeMb: number | null;
    warnMb: number;
    criticalMb: number;
    /** ok / warning(warnMb 미만) / critical(criticalMb 미만) / unknown(측정 실패). 어느 것도 전송을 막지 않는다. */
    level: 'ok' | 'warning' | 'critical' | 'unknown';
    message: string;
}

export function needsMemoryGuard(command: string): boolean {
    return /^\s*(?:Compile|Start)\b/i.test(command);
}

const GUIDANCE = ' /GPL 잔존 파일과 로드된 프로젝트를 확인하세요. 삭제·Unload는 별도 판단이 필요하며, Unload 뒤에는 수 분간 명령 채널이 응답하지 않을 수 있습니다.';

export function assessMemory(raw: string, options: MemoryGuardOptions = DEFAULT_MEMORY_GUARD): MemoryPrecheck {
    const criticalMb = Number.isFinite(options.criticalMb) && options.criticalMb >= 0 ? options.criticalMb : DEFAULT_MEMORY_GUARD.criticalMb;
    const warnMb = Math.max(criticalMb, Number.isFinite(options.warnMb) && options.warnMb >= 0 ? options.warnMb : DEFAULT_MEMORY_GUARD.warnMb);
    const status = parseStatus(raw);
    const freeMb = /<\/STATUS>/i.test(raw) && status.code === 0 ? parseShowMemory(raw)?.freeMb ?? null : null;
    const level = freeMb === null || !Number.isFinite(freeMb) || freeMb < 0 ? 'unknown'
        : freeMb < criticalMb ? 'critical' : freeMb < warnMb ? 'warning' : 'ok';
    let message: string;
    switch (level) {
        case 'unknown':
            message = 'Show Memory의 정상 종결 응답을 받지 못해 여유 메모리를 확인하지 못했습니다 — 검사 없이 계속합니다.';
            break;
        case 'critical':
            message = `여유 메모리 ${freeMb} MB — 심각(${criticalMb} MB 미만, 경고 ${warnMb} MB). 전송은 막지 않습니다. 실제로 모자라면 제어기 Compile이 실패를 알립니다.` + GUIDANCE;
            break;
        case 'warning':
            message = `여유 메모리 ${freeMb} MB (경고 ${warnMb} MB / 심각 ${criticalMb} MB).` + GUIDANCE;
            break;
        default:
            message = `여유 메모리 ${freeMb} MB (경고 ${warnMb} MB / 심각 ${criticalMb} MB).`;
    }
    return { freeMb, warnMb, criticalMb, level, message };
}

/**
 * 전송 함수를 주입하여 큐 슬롯 안에서도 재진입 없이 검사한다. 어느 수준이든 예외를 내지 않는다 — 결과는 경고(precheckWarnings·
 * Output·상태 표시줄)로만 전달되고 호출측은 작업을 계속한다.
 */
export async function checkMemory(
    probe: () => Promise<string>,
    options: MemoryGuardOptions = DEFAULT_MEMORY_GUARD,
    report: (check: MemoryPrecheck) => void = () => {},
): Promise<MemoryPrecheck> {
    let raw = '';
    try { raw = await probe(); } catch { /* 측정 실패는 unknown — 막지 않고 알린다. */ }
    const check = assessMemory(raw, options);
    report(check);
    return check;
}
