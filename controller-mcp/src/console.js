// Brooks / Precise Automation PA controller — 1402 ASCII console client.
//
// 설계 메모(확장 코드 리뷰 반영):
//  - 직렬화 큐: 1402는 단일 클라이언트 요청/응답 채널이라 명령이 겹치면 응답이 섞인다.
//    한 번에 하나씩만 보낸다.
//  - keep-alive 소켓(v0.2): 종전 connect-per-command는 명령마다 TCP 연결 비용이 붙어
//    폴링(150ms 간격 Show Thread)과 AI 왕복 지연의 주범이었다. 연결을 유지하고
//    idleCloseMs(기본 30s) 유휴 시 닫는다. 재사용 소켓이 죽어 있었으면(0바이트에서
//    끊김/쓰기 실패) 새 연결로 1회 재시도한다.
//  - 완료 판정은 종결자 `</STATUS>`(또는 `</DATA>`) 기준. idle 타임아웃으로 조기
//    완료하지 않는다(부분 버퍼를 성공으로 오판하던 문제 방지).
//  - 디코딩은 latin1(바이너리 안전). 'ascii'는 0x80 이상 바이트를 손상시킨다.
//  - onCommand 훅: 명령/소요시간/응답(또는 에러)을 세션 로그로 넘긴다(왕복 낭비 분석용).

import net from 'node:net';

export class ControllerConsole {
  constructor({ host, port = 1402, commandTimeoutMs = 15000, idleCloseMs = 30000, onCommand = null } = {}) {
    if (!host) {
      throw new Error('ControllerConsole: host is required');
    }
    this.host = host;
    this.port = port;
    this.commandTimeoutMs = commandTimeoutMs;
    this.idleCloseMs = idleCloseMs;
    this.onCommand = onCommand;
    // 직렬화 큐: 이전 명령이 끝난 뒤에 다음 명령을 보낸다.
    this._chain = Promise.resolve();
    this._socket = null;
    this._idleTimer = null;
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

  async _sendOnce(command, { timeoutMs } = {}) {
    const to = timeoutMs ?? this.commandTimeoutMs;
    const started = Date.now();
    try {
      const raw = await this._attempt(command, to, false);
      this._armIdleClose();
      try { this.onCommand?.({ command, ms: Date.now() - started, raw, error: null }); } catch { /* noop */ }
      return raw;
    } catch (err) {
      try { this.onCommand?.({ command, ms: Date.now() - started, raw: null, error: err }); } catch { /* noop */ }
      throw err;
    }
  }

  /** 유휴 소켓을 idleCloseMs 뒤에 닫는다(1402 채널을 오래 점유하지 않기 위해). */
  _armIdleClose() {
    clearTimeout(this._idleTimer);
    if (!this._socket) return;
    this._idleTimer = setTimeout(() => this._dropSocket(), this.idleCloseMs);
    this._idleTimer.unref?.();
  }

  _dropSocket() {
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
    const s = this._socket;
    this._socket = null;
    if (s) {
      s.removeAllListeners();
      s.on('error', () => { /* 폐기 중 에러 무시 */ });
      try { s.end(); } catch { /* noop */ }
      try { s.destroy(); } catch { /* noop */ }
    }
  }

  _attempt(command, to, forceFresh) {
    return new Promise((resolve, reject) => {
      const reused = !forceFresh && !!this._socket && !this._socket.destroyed;
      let settled = false;
      let buf = '';
      let socket;

      const cleanup = () => {
        clearTimeout(timer);
        if (socket) {
          socket.removeListener('data', onData);
          socket.removeListener('error', onError);
          socket.removeListener('close', onClose);
          socket.removeListener('connect', onConnect);
        }
      };
      const finishOk = (raw) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(raw);
      };
      const finishErr = (err, retry = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        this._dropSocket();
        if (retry) {
          // 죽어 있던 keep-alive 소켓 → 새 연결로 같은 명령 1회 재시도.
          resolve(this._attempt(command, to, true));
        } else {
          reject(err);
        }
      };

      const timer = setTimeout(() => {
        finishErr(new Error(`Command timed out after ${to}ms: ${command}`));
      }, to);

      const onConnect = () => { socket.write(command + '\r\n'); };
      const onData = (chunk) => {
        buf += chunk;
        // 종결자 기준 완료. STATUS 블록까지 받으면 응답 완료로 본다.
        if (buf.includes('</STATUS>')) {
          finishOk(buf);
        }
      };
      const onError = (err) => {
        finishErr(err, reused && buf.length === 0);
      };
      const onClose = () => {
        if (buf.length > 0) {
          // 종결자 없이 닫힌 경우: 부분 응답 반환(파서가 STATUS 부재를 -9999로 표시).
          finishOk(buf);
        } else if (reused) {
          finishErr(new Error('stale keep-alive socket'), true);
        } else {
          finishErr(new Error(`Connection closed with no response: ${command}`));
        }
      };

      if (reused) {
        socket = this._socket;
        clearTimeout(this._idleTimer);
        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);
        try {
          socket.write(command + '\r\n');
        } catch (err) {
          finishErr(err, true);
        }
      } else {
        this._dropSocket();
        socket = net.connect({ host: this.host, port: this.port });
        socket.setEncoding('latin1');
        socket.setNoDelay(true);
        this._socket = socket;
        // 유휴 중(명령 리스너 제거 후) 소켓 이벤트로 프로세스가 죽지 않도록 상시 핸들러.
        socket.on('error', () => { /* in-flight 명령은 per-command onError가 처리 */ });
        socket.on('close', () => {
          if (this._socket === socket) {
            this._socket = null;
            clearTimeout(this._idleTimer);
          }
        });
        socket.on('connect', onConnect);
        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);
      }
    });
  }
}
