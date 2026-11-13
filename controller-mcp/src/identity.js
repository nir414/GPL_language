// identity.js — 제어기 정체(serial·ID·이름·모델)와 전원 상태를 파라미터 DB(pd)로 읽는 순수 로직 + 연결별 캐시.
//
// 배경(2026-11-06 Sample Prep 보고): 같은 IP 에 다른 제어기(시뮬 구성)가 붙어 있어도 controller_status 는 알 수 없었다.
// 문서상(Brooks PDB system identification) 근거:
//   110 Controller serial number (RO, 공장 설정) · 114 Controller ID (RO, CPU 보드 64-bit ID) ·
//   109 Controller name (임의 설정) · 101 Controller model
//   https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/system%20identification.htm
// 실측(보고 인용): 110 = "0014FF-02300289", 114 = "410c-01be-49c4-e3b5", 101 = "G2400C", 109 = "102. Antibody 96Ch".
// 여기서 pd 를 쓰는 이유는 read_dataids 와 같다 — 읽기 전용, 로드된 프로젝트·쓰레드 불필요.
//
// 전원: 230 Power state (RO, 0~7 꺼짐 계열, 8~12 켜짐 계열) — 확장 robotAxes.readPowerState 와 같은 판정.
//   https://www2.brooksautomation.com/Controller_Software/Software_Reference/PDB/Controller_Settings/operationmodes.htm
//   종전 `Execute Controller.PowerEnabled` 는 4.2K5 에서 -712 였다(2026-11-04 실측).

import { parseDataIdResponse } from './parse.js';

export const IDENTITY_DATAIDS = Object.freeze({ serial: 110, id: 114, name: 109, model: 101 });
export const POWER_STATE_DATAID = 230;

/** 값 토큰 하나 → 문자열(바깥 따옴표 제거). 없으면 null. */
function unquote(token) {
  if (token === undefined || token === null) return null;
  const t = String(token).trim().replace(/^"([\s\S]*)"$/, '$1').replace(/""/g, '"').trim();
  return t === '' ? null : t;
}

/**
 * pd 한 건의 응답 본문(runCommand 의 data)에서 첫 값을 문자열로 읽는다. 형식이 아니면 null.
 * 문자열 값은 따옴표를 벗긴다(`110, 1, 1, 0, "Controller serial number" = "0014FF-02300289"`).
 */
export function firstDataIdString(data) {
  const parsed = data ? parseDataIdResponse(data) : null;
  return parsed ? unquote(parsed.values[0]) : null;
}

/**
 * pd 110·114·109·101 응답(각 runCommand 결과 모양 {ok,data}) → controllerIdentity.
 * 아무 것도 못 읽었으면 null. serial·id 는 비교 근거이므로 대소문자·공백만 정규화해 비교한다(evaluateIdentity).
 */
export function parseIdentity(results) {
  const pick = (key) => {
    const r = results?.[key];
    return r && r.ok ? firstDataIdString(r.data) : null;
  };
  const identity = { serial: pick('serial'), id: pick('id'), name: pick('name'), model: pick('model') };
  return identity.serial || identity.id || identity.name || identity.model ? identity : null;
}

/** 기대 serial 목록 파싱 — 콤마·세미콜론·공백 구분 문자열 또는 배열. 비면 []. */
export function parseExpectedSerials(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}

const normalizeSerial = (s) => String(s).trim().toUpperCase();

/**
 * 연결된 제어기가 기대 serial 중 하나인지 판정한다. 기대값이 없으면 null(경고 없음).
 * serial 을 읽지 못했으면 일치로 추정하지 않고 `unverified` 를 돌려준다(단정 금지 — 하드 규칙 3).
 * @returns {null | {expected:string[], actual:string|null, reason:'serial-differs'|'serial-unreadable', message:string}}
 */
export function evaluateIdentity(identity, expected) {
  const list = parseExpectedSerials(expected);
  if (list.length === 0) return null;
  const actual = identity?.serial ?? null;
  if (!actual) {
    return {
      expected: list, actual: null, reason: 'serial-unreadable',
      message: `기대 serial(${list.join(', ')})을 확인하지 못했다 — pd 110 을 읽지 못했다. 같은 IP 의 다른 제어기일 수 있으니 확인 전에는 실기로 간주하지 말 것.`,
    };
  }
  if (list.some((e) => normalizeSerial(e) === normalizeSerial(actual))) return null;
  return {
    expected: list, actual, reason: 'serial-differs',
    message: `연결된 제어기 serial 이 ${actual} 이다 — 기대(${list.join(', ')})와 다르다. 같은 IP 에 다른 제어기가 붙은 것일 수 있다.`
      + ' 배포·실행 전에 사용자에게 알릴 것.',
  };
}

/** 230 Power state 응답 본문 → true(8~12)/false(0~7)/null(해석 불가). */
export function powerEnabledFromDataId(data) {
  const parsed = data ? parseDataIdResponse(data) : null;
  const n = parsed ? Number(parsed.values[0]) : NaN;
  if (!Number.isInteger(n) || n < 0) return null;
  return n >= 8;
}

/**
 * 정체 조회기 — 연결(host:port)별로 1회만 읽어 캐시한다(성공했을 때만; 실패는 다음 호출에서 다시 시도).
 * io: { key(): string, readIdentity(): Promise<identity|null>, expected(): string|string[]|undefined, now?():number }
 * 같은 키 안에서도 maxAgeMs(기본 10 분) 뒤에는 다시 읽는다 — 재부팅 없이 케이블만 바뀌는 경우의 보험.
 */
export function createIdentityProbe(io, { maxAgeMs = 10 * 60 * 1000 } = {}) {
  let cache = null; // { key, identity, at }
  const now = () => (io.now ? io.now() : Date.now());

  async function identity() {
    const key = io.key();
    if (cache && cache.key === key && now() - cache.at < maxAgeMs) return { identity: cache.identity, cached: true };
    let read = null;
    try {
      read = await io.readIdentity();
    } catch {
      read = null;
    }
    if (read) cache = { key, identity: read, at: now() };
    return { identity: read, cached: false };
  }

  return {
    identity,
    /** 응답에 얹을 필드: { controllerIdentity, identityMismatch? }. 읽기 실패면 controllerIdentity:null. */
    async fields() {
      const { identity: id } = await identity();
      const mismatch = evaluateIdentity(id, io.expected());
      return { controllerIdentity: id, ...(mismatch ? { identityMismatch: mismatch } : {}) };
    },
    reset() { cache = null; },
  };
}
