import * as assert from 'assert';
import { test } from './harness';
import {
    classifyFtpBanner,
    decideControllerIdentity,
    disabledControllerCheck,
    formatControllerCheckTarget,
    normalizeFtpBanner,
    observeCommandConsole,
    observeFtpBanner,
    rebootSuspicionHint,
} from '../controller/connection/controllerIdentity';
import type { ConsoleObservation, IdentityPreflightIo } from '../controller/connection/controllerIdentity';

// 2026-10-23 Sample Prep 보고: 채널 유실 상태에서 Upload Only 가 정체 확인 없이 116개 파일을 올렸다.
const RTEMS = '220 RTEMS FTP server (Version 1.1-JWJ) ready.';
const T0 = Date.UTC(2026, 9, 23, 10, 57, 0);
const clock = (ms: number) => `t+${Math.round((ms - T0) / 1000)}`;
const okConsole: ConsoleObservation = { state: 'ok', command: 'Show Memory', statusCode: 0, at: T0, via: 'same-operation' };
const lostConsole: ConsoleObservation = { state: 'lost', command: 'Show Thread  -web', failureKind: 'refused', detail: 'connect ECONNREFUSED 192.168.0.1:1402', at: T0, via: 'probe' };

test('controllerIdentity: FTP 220 배너 — RTEMS 만 PA 제어기, 다른 서버는 다른 장치, 빈 배너는 판정 불가', () => {
    assert.strictEqual(classifyFtpBanner(RTEMS), 'pa-controller');
    assert.strictEqual(classifyFtpBanner(`${RTEMS}\r\n`), 'pa-controller');
    assert.strictEqual(classifyFtpBanner('220 (vsFTPd 3.0.3)'), 'other-device');
    assert.strictEqual(classifyFtpBanner('220 Microsoft FTP Service'), 'other-device');
    assert.strictEqual(classifyFtpBanner(''), 'unreadable');
    assert.strictEqual(classifyFtpBanner(undefined), 'unreadable');
    assert.strictEqual(normalizeFtpBanner(`\r\n${RTEMS}\r\n230 x`), RTEMS);
});

test('controllerIdentity: 명령 콘솔 STATUS + RTEMS 배너면 통과, 기록에 근거가 남는다', () => {
    const rec = decideControllerIdentity({ console: okConsole, ftp: { banner: RTEMS, at: T0, via: 'same-operation' }, now: T0, formatTime: clock });
    assert.strictEqual(rec.verified, true);
    assert.deepStrictEqual(rec.reasons, []);
    assert.strictEqual(rec.commandConsole, 'ok');
    assert.strictEqual(rec.ftpBanner, RTEMS);
    assert.strictEqual(rec.ftpBannerVerdict, 'pa-controller');
    assert.strictEqual(rec.checkedAt, new Date(T0).toISOString());
    assert.match(rec.commandConsoleDetail, /Show Memory STATUS 0 \(t\+0, 같은 작업\)/);
});

test('controllerIdentity: 명령 콘솔 유실이면 실패 — FTP 를 보기 전에 막는다(ftp not-checked)', () => {
    const rec = decideControllerIdentity({ console: lostConsole, now: T0 });
    assert.strictEqual(rec.verified, false);
    assert.strictEqual(rec.commandConsole, 'lost');
    assert.strictEqual(rec.ftpBannerVerdict, 'not-checked');
    assert.strictEqual(rec.reasons.length, 1);
    assert.match(rec.reasons[0], /명령 콘솔이 응답하지 않습니다\(refused/);
});

test('controllerIdentity: FTP 배너가 다른 장치거나 접속 실패면 실패 사유가 남는다', () => {
    const other = decideControllerIdentity({ console: okConsole, ftp: { banner: '220 (vsFTPd 3.0.3)', at: T0, via: 'probe' }, now: T0 });
    assert.strictEqual(other.verified, false);
    assert.match(other.reasons[0], /RTEMS FTP server/);
    const failed = decideControllerIdentity({ console: okConsole, ftp: { error: 'FTP 접속 refused', at: T0, via: 'probe' }, now: T0 });
    assert.strictEqual(failed.verified, false);
    assert.strictEqual(failed.ftpBanner, null);
    assert.match(failed.reasons[0], /FTP 접속 refused/);
});

test('controllerIdentity: 도달성 스냅샷의 "제어기 아님" 은 이번 확인이 성공하면 참고로만, 실패하면 이유에 더한다', () => {
    const reach = { responder: 'other-device' as const, mac: 'D8-43-AE-A9-7F-89', at: T0 - 240_000, interfaceAlias: '이더넷 4' };
    const fresh = decideControllerIdentity({ console: okConsole, ftp: { banner: RTEMS, at: T0, via: 'probe' }, reachability: reach, now: T0, formatTime: clock });
    assert.strictEqual(fresh.verified, true, '지금의 STATUS·배너가 4분 전 스냅샷보다 우선한다');
    assert.strictEqual(fresh.notes?.length, 1);
    assert.strictEqual(fresh.mac, 'D8-43-AE-A9-7F-89');
    const stale = decideControllerIdentity({ console: lostConsole, reachability: reach, now: T0, formatTime: clock });
    assert.strictEqual(stale.verified, false);
    assert.strictEqual(stale.reasons.length, 2);
    assert.match(stale.reasons[1], /도달성 스냅샷\(t\+-240, 이더넷 4\)/);
});

test('controllerIdentity: Target 줄은 확인 결과를 그대로 쓴다(확인 안 한 대상을 확정처럼 쓰지 않는다)', () => {
    const ok = decideControllerIdentity({ console: okConsole, ftp: { banner: RTEMS, at: T0, via: 'probe' }, reachability: { responder: 'controller', mac: '00-14-FF-0F-4F-FF', at: T0 }, now: T0, formatTime: clock });
    assert.strictEqual(formatControllerCheckTarget('192.168.0.1', ok),
        `192.168.0.1 — 명령 콘솔 Show Memory STATUS 0 (t+0, 같은 작업), FTP ${RTEMS}, MAC 00-14-FF-0F-4F-FF`);
    const lost = decideControllerIdentity({ console: lostConsole, now: T0, formatTime: clock });
    assert.match(formatControllerCheckTarget('192.168.0.1', lost), /FTP 미확인 — 제어기 미확인$/);
    lost.overridden = true;
    assert.match(formatControllerCheckTarget('192.168.0.1', lost), /사용자가 진행 선택\)$/);
    assert.strictEqual(formatControllerCheckTarget('192.168.0.1', disabledControllerCheck(T0)), '192.168.0.1 — 제어기 확인 꺼짐(설정)');
    assert.strictEqual(disabledControllerCheck(T0).commandConsole, 'skipped');
});

function fakeIo(over: Partial<IdentityPreflightIo> & { probes?: string[] }): IdentityPreflightIo & { probes: string[] } {
    const probes = over.probes ?? [];
    return {
        probes,
        recentConsoleStatus: () => undefined,
        probeConsole: async () => { probes.push('console'); return { command: 'Show Thread  -web', outcome: { ok: true, raw: '<STATUS>0,""</STATUS>' } }; },
        recentFtpBanner: () => undefined,
        readFtpBanner: async () => { probes.push('ftp'); return RTEMS; },
        now: () => T0,
        ...over,
    };
}

test('controllerIdentity: 같은 작업 안에서 받은 STATUS·배너가 있으면 왕복 없이 재사용한다', async () => {
    const io = fakeIo({
        recentConsoleStatus: since => (since <= T0 - 10 ? { at: T0 - 5, command: 'Show Memory', statusCode: 0 } : undefined),
        recentFtpBanner: since => (since <= T0 - 10 ? { banner: RTEMS, at: T0 - 3 } : undefined),
    });
    const c = await observeCommandConsole(io, T0 - 10);
    const f = await observeFtpBanner(io, T0 - 10);
    assert.deepStrictEqual(io.probes, [], '재사용할 관측이 있으면 명령 콘솔·FTP 에 아무것도 보내지 않는다');
    assert.strictEqual(c.via, 'same-operation');
    assert.strictEqual(c.command, 'Show Memory');
    assert.strictEqual(f.via, 'same-operation');
    assert.strictEqual(f.banner, RTEMS);
});

test('controllerIdentity: 재사용할 관측이 없으면(Upload Only) 읽기 전용 명령 하나·배너 접속 하나만', async () => {
    const io = fakeIo({});
    const c = await observeCommandConsole(io, T0);
    const f = await observeFtpBanner(io, T0);
    assert.deepStrictEqual(io.probes, ['console', 'ftp']);
    assert.strictEqual(c.state, 'ok');
    assert.strictEqual(c.statusCode, 0);
    assert.strictEqual(f.banner, RTEMS);
});

test('controllerIdentity: 프로브 실패는 lost/배너 오류로 — 예외를 밖으로 내지 않는다', async () => {
    const io = fakeIo({
        probeConsole: async () => ({ command: 'Show Thread  -web', outcome: { ok: false, kind: 'refused', detail: 'ECONNREFUSED' } }),
        readFtpBanner: async () => { throw new Error('FTP 접속 timeout'); },
    });
    const c = await observeCommandConsole(io, T0);
    const f = await observeFtpBanner(io, T0);
    assert.strictEqual(c.state, 'lost');
    assert.strictEqual(c.failureKind, 'refused');
    assert.strictEqual(f.error, 'FTP 접속 timeout');
    assert.strictEqual(decideControllerIdentity({ console: c, ftp: f, now: T0 }).verified, false);
});

test('controllerIdentity: /GPL/<프로젝트> 없음 + 직전 채널 유실이면 재부팅 정황 안내, 아니면 없음', () => {
    const hint = rebootSuspicionHint({ folderMissing: true, projectName: 'Lib', lastChannelLossAt: T0 - 4 * 60_000, gplEmpty: true, now: T0, formatTime: clock });
    assert.ok(hint);
    assert.match(hint!, /약 4분 전/);
    assert.match(hint!, /\/GPL 이 비어 있고/);
    assert.match(hint!, /재부팅된 것으로 보입니다/);
    assert.match(hint!, /라이브러리 포함/);
    assert.strictEqual(rebootSuspicionHint({ folderMissing: true, projectName: 'Lib', now: T0 }), undefined, '유실 기록이 없으면 정황이 아니다');
    assert.strictEqual(rebootSuspicionHint({ folderMissing: false, projectName: 'Lib', lastChannelLossAt: T0 - 1000, now: T0 }), undefined);
    assert.strictEqual(rebootSuspicionHint({ folderMissing: true, projectName: 'Lib', lastChannelLossAt: T0 - 2 * 3600_000, now: T0 }), undefined, '오래된 유실은 보지 않는다');
});
