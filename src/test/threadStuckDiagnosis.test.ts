import * as assert from 'assert';
import { test } from './harness';
import { ThreadStopIo, ThreadStopResponse } from '../controller/threadStop';
import {
    buildRecoveryCandidates,
    diagnoseStuckThread,
    extractCallTarget,
} from '../controller/threadStuckDiagnosis';

/** `Show Thread  -web` 파이프 형식 한 줄. */
function row(name: string, state: string, file: string, fileLine: number): string {
    return `${name}| ${state}| 0| ""| MergeCode| communicationStart| 6| ${file}| ${fileLine}`;
}

/** 실제 응답처럼 `</DATA>` 다음에 줄바꿈을 둔다 — 없으면 태그를 벗긴 뒤 마지막 값과 STATUS 가 붙는다. */
function listResponse(...rows: string[]): string {
    return `<DATA>${rows.join('\n')}</DATA>\r\n<STATUS>0,"Success"</STATUS>`;
}

/** 가짜 IO — `Show Thread  -web` 응답을 순서대로 돌려준다(가상 시계라 실제로 기다리지 않는다). */
function makeIo(responses: Array<string | null>): ThreadStopIo & { lines: string[]; sent: string[] } {
    let clock = 0;
    const queue = [...responses];
    const lines: string[] = [];
    const sent: string[] = [];
    return {
        lines,
        sent,
        send: async (command): Promise<ThreadStopResponse | null> => {
            sent.push(command);
            clock += 10;
            const raw = queue.length > 1 ? queue.shift()! : queue[0];
            return raw === null ? null : { raw };
        },
        log: line => lines.push(line),
        sleep: async ms => { clock += ms; },
        now: () => clock,
    };
}

// ─── extractCallTarget ────────────────────────────────────

test('extractCallTarget: 체인의 마지막 호출을 고른다 (배열 인덱스 포함)', () => {
    const t = extractCallTarget('\t\t\t\t\t\tNetworkManager.comReceiver(i).Read()');
    assert.deepStrictEqual(t, { receiver: 'NetworkManager.comReceiver(i)', method: 'Read' });
});

test('extractCallTarget: While 조건문에서도 수신자만 뽑는다', () => {
    const t = extractCallTarget('While NetworkManager.comReceiver(i).Peek() <> -1');
    assert.deepStrictEqual(t, { receiver: 'NetworkManager.comReceiver(i)', method: 'Peek' });
});

test('extractCallTarget: 대입문의 좌변은 빼고 수신자만 뽑는다', () => {
    const t = extractCallTarget('  nBytes = sock.Read(buf, 1024)');
    assert.deepStrictEqual(t, { receiver: 'sock', method: 'Read' });
});

test('extractCallTarget: 주석 안의 호출은 무시한다', () => {
    const t = extractCallTarget('sock.Read()   \' later: other.Close()');
    assert.deepStrictEqual(t, { receiver: 'sock', method: 'Read' });
});

test('extractCallTarget: 문자열 리터럴 안의 점은 무시한다', () => {
    const t = extractCallTarget('writer.WriteLine("a.b(1).c()")');
    assert.deepStrictEqual(t, { receiver: 'writer', method: 'WriteLine' });
});

test('extractCallTarget: 메서드 호출이 없으면 undefined', () => {
    assert.strictEqual(extractCallTarget('Dim i As Integer'), undefined);
    assert.strictEqual(extractCallTarget('i = i + 1'), undefined);
});

// ─── buildRecoveryCandidates ──────────────────────────────

test('buildRecoveryCandidates: 지역 변수 인덱스는 0..N 으로 펼친다', () => {
    const c = buildRecoveryCandidates('NetworkManager.comReceiver(i)', 'MergeCode', { maxArrayIndexProbe: 2 });
    assert.deepStrictEqual(c.map(x => x.command), [
        'Execute NetworkManager.comReceiver(0).Close(), MergeCode',
        'Execute NetworkManager.comReceiver(1).Close(), MergeCode',
        'Execute NetworkManager.comReceiver(2).Close(), MergeCode',
    ]);
});

test('buildRecoveryCandidates: 인덱스가 없으면 후보 하나', () => {
    const c = buildRecoveryCandidates('theSocket', 'MergeCode');
    assert.deepStrictEqual(c.map(x => x.command), ['Execute theSocket.Close(), MergeCode']);
});

test('buildRecoveryCandidates: 숫자 인덱스는 그대로 둔다', () => {
    const c = buildRecoveryCandidates('NetworkManager.comReceiver(0)', 'MergeCode');
    assert.deepStrictEqual(c.map(x => x.command), ['Execute NetworkManager.comReceiver(0).Close(), MergeCode']);
});

// ─── diagnoseStuckThread ──────────────────────────────────

/** 92번 줄이 Sub 선언이 되도록 앞을 채운 가짜 소스. */
function fakeSource(): string[] {
    const lines = new Array(91).fill('');
    lines.push('\t\tPublic Sub communicationStart()');                      // 92
    lines.push("\t\t\t' Flush");                                            // 93
    lines.push('\t\t\tDim i As Integer');                                   // 94
    lines.push('\t\t\tFor i = 0 To MAX_DEV_COUNT-1');                       // 95
    lines.push('\t\t\t\tIf Not(NetworkManager.comReceiver(i) Is Nothing) Then'); // 96
    lines.push('\t\t\t\t\tWhile NetworkManager.comReceiver(i).Peek() <> -1');    // 97
    lines.push('\t\t\t\t\t\tNetworkManager.comReceiver(i).Read()');              // 98
    lines.push('\t\t\t\t\tEnd While');                                      // 99
    lines.push('\t\t\t\tEnd If');                                           // 100
    return lines;
}

test('diagnoseStuckThread: 위치 고정 + 소스에서 복구 후보를 만든다', async () => {
    const resp = listResponse(row('MergeCode', 'Running', '_network_NetManager.gpl', 98));
    const io = makeIo([resp]);
    const d = await diagnoseStuckThread(io, 'MergeCode', () => fakeSource(), { sampleCount: 3, sampleIntervalMs: 10 });

    assert.strictEqual(d.samples.length, 3);
    assert.strictEqual(d.positionMoved, false);
    assert.deepStrictEqual(d.location, { file: '_network_NetManager.gpl', line: 98, func: 'communicationStart' });
    assert.strictEqual(d.receiver, 'NetworkManager.comReceiver(i)');
    assert.strictEqual(d.method, 'Read');
    assert.strictEqual(d.blockingMethod, true);
    // Read 는 문서가 무한 블록을 명시한 호출 — 1순위 표시와 근거 URL 이 리포트에 실린다(§1-DM).
    assert.strictEqual(d.unboundedBlocking, true);
    assert.ok(d.blockingNote?.includes('hang your procedure'), d.blockingNote);
    assert.ok(d.report.some(l => l.includes('영구 대기')), d.report.join('\n'));
    assert.ok(d.report.some(l => l.includes('read_sr.htm')), d.report.join('\n'));
    // 위치가 고정이어도 좁은 루프의 I/O 시간일 수 있다는 경고를 같이 싣는다(§1-DI — 실측에서 못 갈랐다).
    assert.ok(d.report.some(l => l.includes('입력원을 끊어')), d.report.join('\n'));
    assert.strictEqual(d.candidates[0].command, 'Execute NetworkManager.comReceiver(0).Close(), MergeCode');
    // 읽기 전용만 보냈는지 — 상태를 바꾸는 명령이 섞이면 안 된다.
    assert.ok(io.sent.every(c => /^Show Thread/.test(c)), io.sent.join(' | '));
    // 소스 문맥에 정지 줄 표시가 있다.
    assert.ok(d.report.some(l => l.startsWith('▶') && l.includes('.Read()')), d.report.join('\n'));
});

test('diagnoseStuckThread: Peek 은 문서상 블록하지 않는다 — 범인으로 지목하지 않는다', async () => {
    // 정지 위치가 `While … Peek() <> -1` 줄(97)로 잡힌 경우. Peek 은 바이트가 없으면 즉시 -1 이므로
    // 여기서 영구 대기하지 않는다 — 예전 목록은 Peek 을 블로킹으로 분류해 엉뚱한 곳을 가리켰다(§1-DM).
    const resp = listResponse(row('MergeCode', 'Running', '_network_NetManager.gpl', 97));
    const io = makeIo([resp]);
    const d = await diagnoseStuckThread(io, 'MergeCode', () => fakeSource(), { sampleCount: 2, sampleIntervalMs: 10 });

    assert.strictEqual(d.method, 'Peek');
    assert.strictEqual(d.blockingMethod, false);
    assert.strictEqual(d.unboundedBlocking, false);
    assert.ok(d.blockingNote?.includes('does not block'), d.blockingNote);
    assert.ok(d.report.some(l => l.includes('탈출 조건 없는 루프')), d.report.join('\n'));
    // 그래도 복구 후보는 만든다 — 수신자는 같고, 루프 안쪽이 박혀 있을 수 있다.
    assert.strictEqual(d.candidates[0].command, 'Execute NetworkManager.comReceiver(0).Close(), MergeCode');
});

test('diagnoseStuckThread: 위치가 움직이면 루프 가능성을 알린다', async () => {
    const io = makeIo([
        listResponse(row('MergeCode', 'Running', '_network_NetManager.gpl', 97)),
        listResponse(row('MergeCode', 'Running', '_network_NetManager.gpl', 98)),
    ]);
    const d = await diagnoseStuckThread(io, 'MergeCode', () => fakeSource(), { sampleCount: 2, sampleIntervalMs: 10 });
    assert.strictEqual(d.positionMoved, true);
    assert.ok(d.report.some(l => l.includes('루프')), d.report.join('\n'));
});

test('diagnoseStuckThread: 진단 중 사라지면 거기서 끝낸다', async () => {
    const io = makeIo([listResponse()]);
    const d = await diagnoseStuckThread(io, 'MergeCode', () => fakeSource(), { sampleCount: 4, sampleIntervalMs: 10 });
    assert.strictEqual(d.resolvedDuringSampling, true);
    assert.strictEqual(d.candidates.length, 0);
    assert.ok(d.report.some(l => l.includes('사라졌습니다')), d.report.join('\n'));
});

test('diagnoseStuckThread: 소스를 못 찾아도 샘플 결과는 보고한다', async () => {
    const resp = listResponse(row('MergeCode', 'Running', '_network_NetManager.gpl', 98));
    const io = makeIo([resp]);
    const d = await diagnoseStuckThread(io, 'MergeCode', () => null, { sampleCount: 2, sampleIntervalMs: 10 });
    assert.strictEqual(d.receiver, undefined);
    assert.strictEqual(d.candidates.length, 0);
    assert.ok(d.location);
    assert.ok(d.report.some(l => l.includes('로컬 소스를 찾지 못해')), d.report.join('\n'));
});

test('diagnoseStuckThread: Show Thread 무응답이어도 예외를 던지지 않는다', async () => {
    const io = makeIo([null]);
    const d = await diagnoseStuckThread(io, 'MergeCode', () => fakeSource(), { sampleCount: 2, sampleIntervalMs: 10 });
    assert.strictEqual(d.samples.length, 0);
    assert.strictEqual(d.location, undefined);
    assert.ok(d.report.length > 0);
});
