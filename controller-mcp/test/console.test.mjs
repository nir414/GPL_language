// ControllerConsole(1402 클라이언트) — 명령 검증·재전송 정책·인코딩 (§1-GZ, 2026-11-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ControllerConsole, invalidCommandReason } from '../src/console.js';

const OK = '<DATA>x</DATA>\r\n<STATUS>0,"Success"</STATUS>\r\n';

/** 줄 단위로 명령을 받는 가짜 제어기. onLine(line, socket, connIndex, lineIndex). */
function fakeConsole(onLine) {
  return new Promise((resolve) => {
    const fake = { connections: 0, received: [] };
    const sockets = new Set();
    const server = net.createServer((socket) => {
      const connIndex = fake.connections++;
      fake.received[connIndex] = [];
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        let idx;
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.subarray(0, idx).toString('utf8');
          buf = buf.subarray(idx + 2);
          const lineIndex = fake.received[connIndex].push(line) - 1;
          onLine(line, socket, connIndex, lineIndex);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      fake.port = server.address().port;
      fake.close = () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); });
      resolve(fake);
    });
  });
}

test('invalidCommandReason: CR/LF·제어 문자는 거부, 탭과 평범한 명령은 허용', () => {
  assert.ok(invalidCommandReason('Show Thread\r\nUnload -all'));
  assert.ok(invalidCommandReason('Show\nThread'));
  assert.ok(invalidCommandReason('Show\u0000Thread'));
  assert.equal(invalidCommandReason('Show Thread\t-web'), null);
  assert.equal(invalidCommandReason('Set Break Main "Main.gpl"12'), null);
});

test('send: 여러 줄 명령은 연결도 열지 않고 INVALID_COMMAND(sent:false)로 거부', async () => {
  const fake = await fakeConsole((_l, s) => s.write(OK));
  const c = new ControllerConsole({ host: '127.0.0.1', port: fake.port, commandTimeoutMs: 2000 });
  try {
    await assert.rejects(c.send('Show Thread\r\nStop -all'), (err) => err.code === 'INVALID_COMMAND' && err.sent === false);
    assert.equal(fake.connections, 0);
  } finally {
    c._dropSocket();
    await fake.close();
  }
});

test('stale keep-alive: 조회 명령은 전달 뒤 0바이트 끊김이면 새 연결로 1회 재시도한다', async () => {
  const fake = await fakeConsole((_l, s, conn, line) => {
    if (conn === 0 && line >= 1) { s.destroy(); return; }
    s.write(OK);
  });
  const c = new ControllerConsole({ host: '127.0.0.1', port: fake.port, commandTimeoutMs: 2000 });
  try {
    await c.send('Show Thread');
    const raw = await c.send('Show Break');
    assert.ok(raw.includes('</STATUS>'));
    assert.equal(fake.connections, 2);
    assert.deepEqual(fake.received[1], ['Show Break']);
  } finally {
    c._dropSocket();
    await fake.close();
  }
});

test('stale keep-alive: 상태 변경 명령은 전달 뒤 끊겨도 재전송하지 않는다(결과 미확정, sent:true)', async () => {
  const fake = await fakeConsole((_l, s, conn, line) => {
    if (conn === 0 && line >= 1) { s.destroy(); return; }
    s.write(OK);
  });
  const c = new ControllerConsole({ host: '127.0.0.1', port: fake.port, commandTimeoutMs: 2000 });
  try {
    await c.send('Show Thread');
    await assert.rejects(c.send('Unload Main'), (err) => err.sent === true);
    assert.equal(fake.connections, 1, '새 연결로 같은 명령을 보내지 않음');
  } finally {
    c._dropSocket();
    await fake.close();
  }
});

test('인코딩: UTF-8 응답이 chunk 경계에서 갈려도 그대로 돌려주고, 명령은 UTF-8 로 보낸다', async () => {
  const body = Buffer.from('<DATA>/GPL/한글</DATA>\r\n<STATUS>0,"Success"</STATUS>\r\n', 'utf8');
  const fake = await fakeConsole((_l, s) => {
    s.write(body.subarray(0, 12));
    setTimeout(() => s.write(body.subarray(12)), 20);
  });
  const c = new ControllerConsole({ host: '127.0.0.1', port: fake.port, commandTimeoutMs: 2000 });
  try {
    const raw = await c.send('Show Thread 한글');
    assert.equal(raw, body.toString('utf8'));
    assert.deepEqual(fake.received[0], ['Show Thread 한글']);
  } finally {
    c._dropSocket();
    await fake.close();
  }
});
