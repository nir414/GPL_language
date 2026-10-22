import { parseShowMemory } from './resourceProbes';
import { parseStatus } from './responseParser';

/** 현장 보고를 바탕으로 한 운영 기준이며 제어기 사양의 절대 한계가 아니다. */
export const DEFAULT_MEMORY_GUARD = { warnMb: 4, blockMb: 2.5 };

export interface MemoryPrecheck {
    freeMb: number | null;
    warnMb: number;
    blockMb: number;
    level: 'ok' | 'warning' | 'blocked' | 'unknown';
    message: string;
}

export function needsMemoryGuard(command: string): boolean {
    return /^\s*(?:Compile|Start)\b/i.test(command);
}

export function assessMemory(raw: string, options = DEFAULT_MEMORY_GUARD): MemoryPrecheck {
    const blockMb = Number.isFinite(options.blockMb) && options.blockMb >= 0 ? options.blockMb : DEFAULT_MEMORY_GUARD.blockMb;
    const warnMb = Math.max(blockMb, Number.isFinite(options.warnMb) && options.warnMb >= 0 ? options.warnMb : DEFAULT_MEMORY_GUARD.warnMb);
    const status = parseStatus(raw);
    const freeMb = /<\/STATUS>/i.test(raw) && status.code === 0 ? parseShowMemory(raw)?.freeMb ?? null : null;
    const level = freeMb === null || !Number.isFinite(freeMb) || freeMb < 0 ? 'unknown'
        : freeMb < blockMb ? 'blocked' : freeMb < warnMb ? 'warning' : 'ok';
    return {
        freeMb, warnMb, blockMb, level,
        message: level === 'unknown' ? 'Show Memory의 정상 종결 응답과 여유 메모리를 확인하지 못해 작업을 보내지 않았습니다.'
            : `여유 메모리 ${freeMb} MB (경고 ${warnMb} MB / 차단 ${blockMb} MB).`
                + (level === 'ok' ? '' : ' /GPL 잔존 파일과 로드된 프로젝트를 확인하세요. 삭제·Unload는 별도 판단이 필요하며, Unload 뒤에는 수 분간 명령 채널이 응답하지 않을 수 있습니다.'),
    };
}

export class MemoryGuardError extends Error {
    readonly code: 'LOW_MEMORY' | 'MEMORY_UNVERIFIED';
    readonly sent = false;
    constructor(readonly precheck: MemoryPrecheck) {
        super(precheck.message);
        this.code = precheck.level === 'blocked' ? 'LOW_MEMORY' : 'MEMORY_UNVERIFIED';
    }
}

/** 전송 함수를 주입하여 큐 슬롯 안에서도 재진입 없이 검사한다. */
export async function checkMemory(
    probe: () => Promise<string>,
    options = DEFAULT_MEMORY_GUARD,
    report: (check: MemoryPrecheck) => void = () => {},
): Promise<MemoryPrecheck> {
    let raw = '';
    try { raw = await probe(); } catch { /* 알 수 없는 상태는 안전하다고 추정하지 않는다. */ }
    const check = assessMemory(raw, options);
    report(check);
    if (check.level === 'blocked' || check.level === 'unknown') { throw new MemoryGuardError(check); }
    return check;
}
