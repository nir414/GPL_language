/**
 * 제어기 채널 용어 정본 — 포트 번호 대신 **이름**으로 부른다 (2026-09-22 사용자 결정).
 *
 * 왜: `1402`·`1403` 은 포트 번호를 외운 사람에게만 뜻이 통한다. "1402 미연결" 은 무엇이 끊겼는지
 * 말해 주지 않고, 화면·로그·보고서마다 숫자가 그대로 노출돼 있었다. 이름으로 부르면 문장이 바로
 * 읽히고("명령 콘솔 연결이 끊겼습니다"), 포트를 바꿔 쓰는 설치에서도 문구가 어긋나지 않는다.
 *
 * 표기 규칙:
 *   - 사용자 대면 문구는 **이름이 주어**다 — `명령 콘솔`, `런타임 콘솔`.
 *   - 번호는 덧붙일 뿐이고, 붙이는 자리는 셋뿐이다:
 *       ① 설정 값 표시,  ② `ip:port` 엔드포인트,  ③ 원인을 가리는 진단 상세.
 *     그때는 `channelWithPort`/`channelEndpoint` 로 `명령 콘솔(1402)` · `명령 콘솔 192.168.0.1:1402` 처럼 쓴다.
 *   - 프로토콜 표·패킷 분석처럼 **포트 자체가 주제**인 문서(`docs/reference/console-commands.md`)와
 *     설정 키 이름(`keepAlive1402`)·과거 기록(CHANGELOG·아카이브)은 숫자를 그대로 둔다.
 */

/** 확장이 쓰는 제어기 채널. */
export type ControllerChannel = 'command' | 'runtime' | 'ftp';

/** 채널 이름(한국어 UI 정본). */
export const CHANNEL_NAMES: Readonly<Record<ControllerChannel, string>> = Object.freeze({
    command: '명령 콘솔',
    runtime: '런타임 콘솔',
    ftp: 'FTP',
});

/** 영문 표기(영문 UI·명령 제목용). */
export const CHANNEL_NAMES_EN: Readonly<Record<ControllerChannel, string>> = Object.freeze({
    command: 'Command Console',
    runtime: 'Runtime Console',
    ftp: 'FTP',
});

/** 제어기 기본 포트 — 설정이 없을 때의 값이자 문서에 적히는 번호. */
export const DEFAULT_CHANNEL_PORTS: Readonly<Record<ControllerChannel, number>> = Object.freeze({
    command: 1402,
    runtime: 1403,
    ftp: 21,
});

export function channelName(channel: ControllerChannel): string {
    return CHANNEL_NAMES[channel];
}

/**
 * `명령 콘솔(1402)` — 번호가 필요한 자리(설정 설명·진단 상세)에서만 쓴다.
 * 포트를 주지 않으면 기본 포트를 쓴다.
 */
export function channelWithPort(channel: ControllerChannel, port?: number): string {
    return `${CHANNEL_NAMES[channel]}(${port ?? DEFAULT_CHANNEL_PORTS[channel]})`;
}

/** `명령 콘솔 192.168.0.1:1402` — 어디에 붙었는지가 사실 자체인 자리. */
export function channelEndpoint(channel: ControllerChannel, ip: string, port: number): string {
    return `${CHANNEL_NAMES[channel]} ${ip}:${port}`;
}
