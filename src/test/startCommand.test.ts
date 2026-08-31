import * as assert from 'assert';
import { test } from './harness';
import { buildStartCommand } from '../controller/startCommand';

test('startCommand: 기본값은 GDE와 같은 -event', () => {
    assert.strictEqual(buildStartCommand({ projectName: 'MergeCode' }), 'Start MergeCode -event');
});

test('startCommand: eventMode=false 는 -noevent', () => {
    assert.strictEqual(
        buildStartCommand({ projectName: 'MergeCode', eventMode: false }),
        'Start MergeCode -noevent',
    );
});

test('startCommand: 디버거 stopOnEntry — 문서 구문 순서(-bex → -break → -event)', () => {
    assert.strictEqual(
        buildStartCommand({ projectName: 'MergeCode', breakOnEntry: true, breakOnException: true }),
        'Start MergeCode -bex -break -event',
    );
});

test('startCommand: -init / -stack / -trace / -name', () => {
    assert.strictEqual(
        buildStartCommand({
            projectName: 'MergeCode',
            threadName: 'dbg',
            breakOnEntry: true,
            showInitStatements: true,
            stackSizeKb: 16,
            trace: true,
        }),
        'Start MergeCode -name dbg -break -event -init -stack 16 -trace',
    );
});

test('startCommand: -compile 은 절대 붙이지 않는다(하드 규칙 7)', () => {
    const cmd = buildStartCommand({ projectName: 'MergeCode', breakOnEntry: true, stackSizeKb: 8 });
    assert.ok(!/-compile/.test(cmd), cmd);
});

test('startCommand: 스택 크기 범위를 벗어나면 무시한다', () => {
    assert.strictEqual(buildStartCommand({ projectName: 'P', stackSizeKb: 0 }), 'Start P -event');
    assert.strictEqual(buildStartCommand({ projectName: 'P', stackSizeKb: 4096 }), 'Start P -event');
    assert.strictEqual(buildStartCommand({ projectName: 'P', stackSizeKb: 4.5 }), 'Start P -event');
});

test('startCommand: 쓰레드 이름에 공백이 있으면 -name 을 붙이지 않는다', () => {
    assert.strictEqual(
        buildStartCommand({ projectName: 'P', threadName: 'my thread' }),
        'Start P -event',
    );
});

test('startCommand: 프로젝트 이름이 비었거나 공백을 포함하면 예외', () => {
    assert.throws(() => buildStartCommand({ projectName: '' }), /비어 있습니다/);
    assert.throws(() => buildStartCommand({ projectName: '  ' }), /비어 있습니다/);
    assert.throws(() => buildStartCommand({ projectName: 'My project' }), /공백/);
    assert.throws(() => buildStartCommand({ projectName: 'My　project' }), /공백/);
});
