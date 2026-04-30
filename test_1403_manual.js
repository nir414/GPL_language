/**
 * 검증 테스트: RuntimeConsole 동일 로직 시뮬레이션
 * - FIN 후 100ms 대기 → 즉시 재연결 (이벤트 배치 모델)
 * - normalizeConsoleLine과 동일한 파싱 로직 적용
 * - 전체 출력 수집 확인
 * 사용법: node test_1403_manual.js
 */

const net = require('net');

const IP = '192.168.0.2';
const CMD_PORT = 1402;
const CONSOLE_PORT = 1403;
const RECONNECT_IMMEDIATE_MS = 100;

function ts() {
    const d = new Date();
    return d.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function sendCommand(command, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let buf = '';
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`Timeout: ${command}`));
        }, timeoutMs);

        socket.connect(CMD_PORT, IP, () => {
            socket.write(command + '\r\n', 'ascii');
        });
        socket.on('data', d => {
            buf += d.toString('ascii').replace(/\0/g, '');
            if (buf.includes('</STATUS>')) {
                clearTimeout(timer);
                socket.destroy();
                resolve(buf.trim());
            }
        });
        socket.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

// normalizeConsoleLine 재현 (responseParser.ts와 동일 로직)
function normalizeConsoleLine(line) {
    const s = line.replace(/\0/g, '').replace(/\r/g, '').trim();
    if (!s || s === '</E>' || /^<E>\d+,\d+<\/E>$/.test(s)) {
        return '';
    }
    const projMatch = s.match(/^<E>\d+,([^<]+)/);
    let msg = s.replace(/^.*<L>\d+<\/L>/, '').replace(/<\/E>$/, '').trim();
    if (projMatch && msg) {
        return `[${projMatch[1]}] ${msg}`;
    }
    return msg || '';
}

// RuntimeConsole과 동일한 재연결 패턴
class ConsoleSimulator {
    constructor() {
        this.socket = null;
        this.carry = '';
        this.sessionDataReceived = false;
        this.allLines = [];
        this.sessionCount = 0;
        this.running = true;
        this._resolve = null;
        this._stopTimer = null;
        this._reconnectTimer = null;
    }

    start() {
        return new Promise((resolve) => {
            this._resolve = resolve;
            this.connectInternal();
        });
    }

    stop() {
        this.running = false;
        if (this.socket) {
            this.socket.end();
            setTimeout(() => {
                try { this.socket?.destroy(); } catch {}
            }, 1000);
        }
        if (this._stopTimer) clearTimeout(this._stopTimer);
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        if (this._resolve) this._resolve(this.allLines);
    }

    connectInternal() {
        if (!this.running) return;

        const label = `S${this.sessionCount++}`;
        const socket = new net.Socket();
        this.socket = socket;
        this.carry = '';
        this.sessionDataReceived = false;

        socket.connect(CONSOLE_PORT, IP, () => {
            console.log(`[${ts()}][${label}] CONNECTED`);
            socket.setKeepAlive(true, 5000);
            socket.setNoDelay(true);
        });

        socket.on('data', (data) => {
            this.sessionDataReceived = true;
            const raw = data.toString('ascii');
            const text = (this.carry + raw).replace(/\r/g, '');
            const lines = text.split('\n');

            if (!text.endsWith('\n')) {
                this.carry = lines[lines.length - 1];
                lines.length = lines.length - 1;
            } else {
                this.carry = '';
            }

            for (const line of lines) {
                const normalized = normalizeConsoleLine(line);
                if (normalized) {
                    this.allLines.push(normalized);
                    console.log(`[${ts()}][${label}] ${normalized}`);
                }
            }
        });

        socket.on('end', () => {
            const dataRcv = this.sessionDataReceived;
            console.log(`[${ts()}][${label}] FIN (data=${dataRcv})`);
        });

        socket.on('close', (hadError) => {
            this.socket = null;
            const dataReceived = this.sessionDataReceived;
            if (!this.running) return;

            if (dataReceived && !hadError) {
                // 이벤트 배치 완료 → 즉시 재연결
                console.log(`[${ts()}][${label}] → 즉시 재연결 (${RECONNECT_IMMEDIATE_MS}ms)`);
                this._reconnectTimer = setTimeout(() => {
                    this.connectInternal();
                }, RECONNECT_IMMEDIATE_MS);
            } else {
                console.log(`[${ts()}][${label}] → 빈 세션/에러, 재연결 중단`);
                this.stop();
            }
        });

        socket.on('error', (err) => {
            console.log(`[${ts()}][${label}] ERROR: ${err.message}`);
        });
    }
}

async function main() {
    console.log(`=== 검증 테스트: RuntimeConsole 시뮬레이션 ===`);
    console.log(`=== IP: ${IP}, 버전: v0.5.28 ===\n`);

    // 1) Stop All
    try { await sendCommand('Stop All'); } catch {}
    await new Promise(r => setTimeout(r, 1000));

    // 2) 시뮬레이터 시작
    const sim = new ConsoleSimulator();
    const resultPromise = sim.start();

    await new Promise(r => setTimeout(r, 500));

    // 3) Start
    console.log(`\n[${ts()}] >>> Start GPL_Code`);
    try {
        const resp = await sendCommand('Start GPL_Code');
        const status = resp.match(/<STATUS>(.*?)<\/STATUS>/)?.[1] ?? '';
        console.log(`[${ts()}] Start 응답: ${status}`);
    } catch (err) {
        console.log(`[${ts()}] Start 실패: ${err.message}`);
    }

    // 4) 20초 후 강제 종료 (안전장치)
    const forceStop = setTimeout(() => {
        console.log(`\n[${ts()}] --- 20초 타임아웃, 강제 종료 ---`);
        sim.stop();
    }, 20000);

    // 5) 결과 대기
    const lines = await resultPromise;
    clearTimeout(forceStop);

    // 6) 결과 보고
    console.log(`\n========== 결과 보고 ==========`);
    console.log(`수집된 콘솔 줄 수: ${lines.length}`);
    console.log(`\n--- 전체 출력 ---`);
    for (let i = 0; i < lines.length; i++) {
        console.log(`  ${i + 1}. ${lines[i]}`);
    }

    // 7) 기대 출력과 비교
    const expected = [
        'Program start',
        'APON TEST START',
        'SetString/GetString',
        'SetInt/GetInt',
        'SetDbl/GetDbl',
        'Default fallback',
        'Array count=3',
        'Array values=',
        'Block  ip=',
        'After remove',
        'HasChild',
        'Parse  robotName',
        'Parse  tags',
        'Parse  motor',
        'BuildString result',
    ];
    let matched = 0;
    for (const exp of expected) {
        if (lines.some(l => l.includes(exp))) matched++;
    }
    console.log(`\n기대 항목: ${expected.length}`);
    console.log(`매칭된 항목: ${matched}`);
    console.log(`결과: ${matched >= expected.length - 1 ? '✅ 성공' : '❌ 실패'}`);

    // 최종 쓰레드 상태
    try {
        const th = await sendCommand('Show Thread');
        const data = th.match(/<DATA>([\s\S]*?)<\/DATA>/)?.[1]?.trim() ?? '';
        console.log(`쓰레드 상태: ${data}`);
    } catch {}

    console.log(`\n=== 검증 테스트 완료 ===`);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
