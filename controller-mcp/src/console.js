// Brooks / Precise Automation PA controller — 1402 ASCII console client.
//
// 설계 메모(확장 코드 리뷰 반영):
//  - 직렬화 큐: 1402는 단일 클라이언트 요청/응답 채널이라 명령이 겹치면 응답이 섞인다.
//    한 번에 하나씩만 보낸다.
//  - keep-alive 소켓(v0.2): 종전 connect-per-command는 명령마다 TCP 연결 비용이 붙어
//    폴링(150ms 간격 Show Thread)과 AI 왕복 지연의 주범이었다. 연결을 유지하고
//    idleCloseMs(기본 30s) 유휴 시 닫는다. 재사용 소켓에 쓰기 자체가 실패했으면 새 연결로
//    1회 재시도한다. 쓰기가 된 뒤 0바이트로 끊겼으면 명령이 실행됐는지 모르므로 조회 명령
//    (isRetrySafeCommand)만 재시도하고, 상태 변경 명령은 결과 미확정(sent:true)으로 올린다(§1-GZ).
//  - CR/LF·제어 문자가 든 명령은 보내지 않는다(INVALID_COMMAND, sent:false) — 두 번째 명령이
//    끼어들어 첫 단어만 보는 분류·가드를 우회하지 못하게(§1-GZ, 확장 consoleSocket 과 같은 규칙).
//  - 완료 판정은 종결자 `</STATUS>`(또는 `</DATA>`) 기준. idle 타임아웃으로 조기
//    완료하지 않는다(부분 버퍼를 성공으로 오판하던 문제 방지).
//  - 디코딩은 latin1(바이너리 안전)로 누적한 뒤 완성 응답을 UTF-8 로 푼다. 'ascii'는 0x80 이상
//    바이트를 손상시킨다. 송신은 UTF-8.
//  - onCommand 훅: 명령/소요시간/응답(또는 에러)을 세션 로그로 넘긴다(왕복 낭비 분석용).

import net from 'node:net';
import { isRetrySafeCommand } from './extensionBridge.js';

/** 1402 로 보낼 수 없는 명령이면 사유, 아니면 null(확장 consoleSocket.invalidCommandReason 과 같은 규칙). */
export function invalidCommandReason(command) {
  const c = String(command ?? '');
  if (/[\r\n]/.test(c)) return '명령 안에 줄바꿈(CR/LF)이 있습니다 — 한 번에 한 줄 명령만 보낼 수 있습니다.';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(c)) return '명령 안에 제어 문자가 있습니다.';
  return null;
}

/** latin1 로 누적한 응답을 UTF-8 로 푼다(모두 7비트면 그대로). */
function latin1ToUtf8(text) {
  return /[\x80-\xff]/.test(text) ? Buffer.from(text, 'latin1').toString('utf8') : text;
}

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
    const invalid = invalidCommandReason(command);
    if (invalid) {
      const err = Object.assign(new Error(`Invalid command (not sent): ${invalid}`), { code: 'INVALID_COMMAND', sent: false });
      try { this.onCommand?.({ command, ms: 0, raw: null, error: err }); } catch { /* noop */ }
      return Promise.reject(err);
    }
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

  /**
   * 대상 주소를 바꾼다(확장 창이 다른 제어기로 연결을 옮긴 경우). 진행 중인 명령이 끝난 뒤 적용되도록 직렬 큐에 넣고,
   * 옛 주소로 열려 있던 소켓은 버린다. 같은 주소면 아무것도 하지 않는다.
   */
  retarget(host, port = this.port) {
    if (!host || (host === this.host && port === this.port)) return;
    this._chain = this._chain.then(() => {
      if (host === this.host && port === this.port) return;
      this._dropSocket();
      this.host = host;
      this.port = port;
    });
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
      // 명령 바이트를 소켓에 넘겼는가 — 그 뒤 0바이트 끊김은 실행 여부를 알 수 없다(§1-GZ).
      let delivered = false;
      const retryAllowed = () => reused && buf.length === 0 && (!delivered || isRetrySafeCommand(command));
      const writeCommand = () => {
        socket.write(command + '\r\n', 'utf8', (err) => {
          if (err) { delivered = false; finishErr(err, retryAllowed()); }
        });
        delivered = true;
      };

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
        resolve(latin1ToUtf8(raw));
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

      const onConnect = () => { writeCommand(); };
      const onData = (chunk) => {
        buf += chunk;
        // 종결자 기준 완료. STATUS 블록까지 받으면 응답 완료로 본다.
        if (buf.includes('</STATUS>')) {
          finishOk(buf);
        }
      };
      const onError = (err) => {
        if (!retryAllowed() && delivered) { err.sent = true; }
        finishErr(err, retryAllowed());
      };
      const onClose = () => {
        if (buf.length > 0) {
          // 종결자 없이 닫힌 경우: 부분 응답 반환(파서가 STATUS 부재를 -9999로 표시).
          finishOk(buf);
        } else if (retryAllowed()) {
          finishErr(new Error('stale keep-alive socket'), true);
        } else {
          // 명령을 넘긴 뒤의 끊김 — 제어기가 실행했는지 모른다(상태 변경 명령이면 결과 미확정, 재전송 금지).
          finishErr(Object.assign(new Error(`Connection closed with no response: ${command}`), delivered ? { sent: true } : {}));
        }
      };

      if (reused) {
        socket = this._socket;
        clearTimeout(this._idleTimer);
        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);
        try {
          writeCommand();
        } catch (err) {
          delivered = false; // write 가 던졌다 — 바이트가 나가지 않았다.
          finishErr(err, retryAllowed());
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
