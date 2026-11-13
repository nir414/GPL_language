/**
 * 제어기 하드웨어 정체(serial·Controller ID·이름·모델) 읽기와 기대 serial 대조 — vscode 무의존 순수 모듈.
 *
 * 배경(Sample Prep 보고 2026-11-06): 같은 IP 에 다른 제어기(시뮬 구성)가 붙어 있어도 확장은 알 수 없었다. IP·모델·이름은
 * 구분 근거가 못 된다(이름 109 는 임의 설정, 2105 는 설정값). 문서상 공장 설정·읽기 전용인 110 이 가장 좋은 근거다.
 *
 * 문서상 근거(Brooks PDB, system identification):
 *   101 Controller model · 109 Controller name · 110 Controller serial number(RO) · 114 Controller ID(RO, CPU 보드 64-bit ID)
 *   https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/system%20identification.htm
 * 실측 응답(보고 인용): 110 = "0014FF-02300289", 114 = "410c-01be-49c4-e3b5", 101 = "G2400C", 109 = "102. Antibody 96Ch".
 * (GPL 안의 `CStr(Controller.PDb(110))` 은 "14" 를 돌려줬다는 다른 보고가 있다 — 그건 GPL 쪽 변환이고, 여기서는 콘솔 `pd 110` 을 쓴다.)
 *
 * 읽기 전용 `pd` 만 쓴다(값 변경 `pc` 없음). MCP 쪽 대응 구현은 controller-mcp/src/identity.js 다.
 */

import { parseDataIdValues } from '../diagnostics/robotAxes';

export const HARDWARE_ID_DATAIDS = { serial: 110, id: 114, name: 109, model: 101 } as const;
export type HardwareIdKey = keyof typeof HARDWARE_ID_DATAIDS;

export interface ControllerHardwareId {
    serial: string | null;
    id: string | null;
    name: string | null;
    model: string | null;
}

export interface IdentityMismatch {
    expected: string[];
    actual: string | null;
    reason: 'serial-differs' | 'serial-unreadable';
}

function unquote(token: string | undefined): string | null {
    if (token === undefined) { return null; }
    const t = token.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/""/g, '"').trim();
    return t === '' ? null : t;
}

/** pd 응답 원문 → 첫 값을 문자열로(따옴표 제거). 형식이 아니면 null. */
export function firstStringValue(raw: string | null): string | null {
    const values = parseDataIdValues(raw);
    return values && values.length > 0 ? unquote(values[0]) : null;
}

/** 각 DataID 응답 원문(읽기 실패는 null) → 정체. 하나도 못 읽었으면 null. */
export function parseHardwareId(raws: Partial<Record<HardwareIdKey, string | null>>): ControllerHardwareId | null {
    const pick = (k: HardwareIdKey): string | null => firstStringValue(raws[k] ?? null);
    const id: ControllerHardwareId = { serial: pick('serial'), id: pick('id'), name: pick('name'), model: pick('model') };
    return id.serial || id.id || id.name || id.model ? id : null;
}

/** 설정값(문자열 또는 배열; 문자열은 콤마·세미콜론·공백 구분) → 기대 serial 목록. */
export function parseExpectedSerials(value: unknown): string[] {
    const list = Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/);
    return list.map(s => String(s).trim()).filter(Boolean);
}

/** 기대 serial 이 없으면 null. serial 을 못 읽었으면 일치로 추정하지 않고 'serial-unreadable'. */
export function evaluateExpectedSerial(identity: ControllerHardwareId | null, expected: unknown): IdentityMismatch | null {
    const list = parseExpectedSerials(expected);
    if (list.length === 0) { return null; }
    const actual = identity?.serial ?? null;
    if (!actual) { return { expected: list, actual: null, reason: 'serial-unreadable' }; }
    const norm = (s: string): string => s.trim().toUpperCase();
    return list.some(e => norm(e) === norm(actual)) ? null : { expected: list, actual, reason: 'serial-differs' };
}

/** Output 한 줄용 요약. */
export function describeHardwareId(id: ControllerHardwareId): string {
    return `serial=${id.serial ?? '?'} id=${id.id ?? '?'} name=${id.name ?? '?'} model=${id.model ?? '?'}`;
}

/** 합쇼체 경고문(비모달 알림·Output 공용). */
export function describeIdentityMismatch(m: IdentityMismatch, ip: string): string {
    const expected = m.expected.join(', ');
    return m.reason === 'serial-differs'
        ? `${ip} 에 연결된 제어기의 serial 이 ${m.actual} 입니다. 설정(gpl.controller.expectedSerial)의 ${expected} 와 달라 같은 IP 의 다른 제어기일 수 있습니다.`
        : `${ip} 의 제어기 serial 을 읽지 못해 설정(gpl.controller.expectedSerial)의 ${expected} 와 대조하지 못했습니다.`;
}

/** 읽기 전용 pd 4건을 보내 정체를 읽는다. 개별 실패는 null 로 남기고 예외는 던지지 않는다. */
export async function readControllerHardwareId(send: (command: string) => Promise<string | null>): Promise<ControllerHardwareId | null> {
    const raws: Partial<Record<HardwareIdKey, string | null>> = {};
    for (const key of Object.keys(HARDWARE_ID_DATAIDS) as HardwareIdKey[]) {
        try {
            raws[key] = await send(`pd ${HARDWARE_ID_DATAIDS[key]}`);
        } catch {
            raws[key] = null;
        }
    }
    return parseHardwareId(raws);
}
