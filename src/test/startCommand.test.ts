import * as assert from 'assert';
import { test } from './harness';
import { buildStartCommand, commandRunsCompiler } from '../controller/startCommand';

test('startCommand: 기본값은 -compile + GDE와 같은 -event', () => {
    assert.strictEqual(buildStartCommand({ projectName: 'MergeCode' }), 'Start MergeCode -compile -event');
});

test('startCommand: eventMode=false 는 -noevent', () => {
    assert.strictEqual(
        buildStartCommand({ projectName: 'MergeCode', eventMode: false }),
        'Start MergeCode -compile -noevent',
    );
});

test('startCommand: 디버거 stopOnEntry — 문서 구문 순서(-bex → -break → -event)', () => {
    assert.strictEqual(
        buildStartCommand({ projectName: 'MergeCode', breakOnEntry: true, breakOnException: true }),
        'Start MergeCode -bex -break -compile -event',
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
        'Start MergeCode -name dbg -break -compile -event -init -stack 16 -trace',
    );
});

// -compile 은 기본 on 이다 — 없으면 제어기가 옛 바이너리를 실행한다(2026-09-10 실기 관측, §1-DN).
test('startCommand: -compile 은 기본으로 항상 붙는다', () => {
    for (const opts of [
        { projectName: 'MergeCode' },
        { projectName: 'MergeCode', breakOnEntry: true, stackSizeKb: 8 },
        { projectName: 'MergeCode', eventMode: false },
        { projectName: 'MergeCode', compile: true },
    ]) {
        const cmd = buildStartCommand(opts);
        assert.ok(cmd.split(' ').includes('-compile'), cmd);
    }
});

test('startCommand: compile=false 를 명시할 때만 -compile 을 뺀다', () => {
    assert.strictEqual(
        buildStartCommand({ projectName: 'MergeCode', compile: false }),
        'Start MergeCode -event',
    );
});

test('startCommand: 스택 크기 범위를 벗어나면 무시한다', () => {
    assert.strictEqual(buildStartCommand({ projectName: 'P', stackSizeKb: 0 }), 'Start P -compile -event');
    assert.strictEqual(buildStartCommand({ projectName: 'P', stackSizeKb: 4096 }), 'Start P -compile -event');
    assert.strictEqual(buildStartCommand({ projectName: 'P', stackSizeKb: 4.5 }), 'Start P -compile -event');
});

test('startCommand: 쓰레드 이름에 공백이 있으면 -name 을 붙이지 않는다', () => {
    assert.strictEqual(
        buildStartCommand({ projectName: 'P', threadName: 'my thread' }),
        'Start P -compile -event',
    );
});

test('startCommand: 프로젝트 이름이 비었거나 공백을 포함하면 예외', () => {
    assert.throws(() => buildStartCommand({ projectName: '' }), /비어 있습니다/);
    assert.throws(() => buildStartCommand({ projectName: '  ' }), /비어 있습니다/);
    assert.throws(() => buildStartCommand({ projectName: 'My project' }), /공백/);
    assert.throws(() => buildStartCommand({ projectName: 'My　project' }), /공백/);
});

// `-compile` 이 붙은 Start 는 Compile 과 같은 응답 대기 규칙이 필요하다 — 짧은 idle 완료로 받으면
// compiler pass 도중 잘려 `-9999 No STATUS found` 가 된다(2026-09-10 실기 관측, §1-DN).
test('commandRunsCompiler: Compile 과 -compile 붙은 Start 만 참', () => {
    assert.ok(commandRunsCompiler('Compile MergeCode'));
    assert.ok(commandRunsCompiler('  compile MergeCode  '));
    assert.ok(commandRunsCompiler('Start MergeCode -compile -event'));
    assert.ok(commandRunsCompiler('Start MergeCode -bex -break -compile -event'));
    assert.ok(commandRunsCompiler(buildStartCommand({ projectName: 'MergeCode' })));
});

test('commandRunsCompiler: 컴파일하지 않는 명령은 거짓', () => {
    assert.ok(!commandRunsCompiler('Start MergeCode -event'));
    assert.ok(!commandRunsCompiler(buildStartCommand({ projectName: 'MergeCode', compile: false })));
    assert.ok(!commandRunsCompiler('Stop -all'));
    assert.ok(!commandRunsCompiler('Show Thread'));
    assert.ok(!commandRunsCompiler(''));
    // 프로젝트 이름에 compile 이 들어가도 스위치가 아니면 거짓
    assert.ok(!commandRunsCompiler('Start compileTest -event'));
});
