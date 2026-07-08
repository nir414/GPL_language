// Brooks / Precise Automation PA controller — 1402 ASCII console client.
//
// 설계 메모(확장 코드 리뷰 반영):
//  - connect-per-command + 직렬화 큐: 1402는 단일 클라이언트 요청/응답 채널이라
//    명령이 겹치면 응답이 섞인다. 한 번에 하나씩만 보낸다.
//  - 완료 판정은 종결자 `</STATUS>`(또는 `</DATA>`) 기준. idle 타임아웃으로 조기
//    완료하지 않는다(부분 버퍼를 성공으로 오판하던 문제 방지).
//  - 디코딩은 latin1(바이너리 안전). 'ascii'는 0x80 이상 바이트를 손상시킨다.

import net from 'node:net';

export class ControllerConsole {
  constructor({ host, port = 1402, commandTimeoutMs = 15000 } = {}) {
    if (!host) {
      throw new Error('ControllerConsole: host is required');
    }
    this.host = host;
    this.port = port;
    this.commandTimeoutMs = commandTimeoutMs;
    // 직렬화 큐: 이전 명령이 끝난 뒤에 다음 명령을 보낸다.
    this._chain = Promise.resolve();
  }

  /**
   * 한 줄 콘솔 명령을 보내고 응답 전체(raw 문자열)를 돌려준다.
   * @param {string} command
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<string>} raw response text
   */
  send(command, opts = {}) {
    const run = () => this._sendOnce(command, opts);
    // 성공/실패와 무관하게 다음 명령이 이어지도록 체인.
    const result = this._chain.then(run, run);
    this._chain = result.then(() => undefined, () => undefined);
    return result;
  }

  _sendOnce(command, { timeoutMs } = {}) {
    const to = timeoutMs ?? this.commandTimeoutMs;
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      socket.setEncoding('latin1');

      let buf = '';
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeAllListeners();
        // end()로 FIN 전송(상대 TCP 스택 보호). 이미 닫혔으면 무시.
        try { socket.end(); } catch { /* noop */ }
        try { socket.destroy(); } catch { /* noop */ }
      };
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(arg);
      };

      const timer = setTimeout(() => {
        finish(reject, new Error(`Command timed out after ${to}ms: ${command}`));
      }, to);

      socket.on('connect', () => {
        socket.write(command + '\r\n');
      });
      socket.on('data', (chunk) => {
        buf += chunk;
        // 종결자 기준 완료. STATUS 블록까지 받으면 응답 완료로 본다.
        if (buf.includes('</STATUS>')) {
          finish(resolve, buf);
        }
      });
      socket.on('error', (err) => {
        finish(reject, err);
      });
      socket.on('close', () => {
        // 종결자 없이 닫힌 경우: 데이터가 있으면 부분 응답으로 반환(파서가
        // STATUS 부재를 code -9999로 표시), 전혀 없으면 에러.
        if (buf.length > 0) {
          finish(resolve, buf);
        } else {
          finish(reject, new Error(`Connection closed with no response: ${command}`));
        }
      });
    });
  }
}
