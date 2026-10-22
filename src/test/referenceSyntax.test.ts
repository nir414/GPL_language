import * as assert from 'assert';
import { test } from './harness';
import {
    buildConstructorUsagePattern,
    findSymbolStringConsumerAt,
    isSymbolicStringReferenceAt,
    isTypeUsageAt,
} from '../language/referenceSyntax';

test('참조 문법: `Sub New`의 사용부는 `New <선언 클래스>`로 찾는다', () => {
    const re = new RegExp(buildConstructorUsagePattern('TcpServer'), 'gi');
    const line = '\t\tDim server As New TcpServer(PORT_TEST)';
    const match = re.exec(line);

    assert.ok(match, 'TcpServer 생성자 사용부가 일치해야 한다');
    assert.strictEqual(match![0], 'New TcpServer');
    assert.strictEqual(match!.index, line.indexOf('New TcpServer'));
});

test('참조 문법: 다른 클래스 생성자와 이름 일부 일치는 제외한다', () => {
    const re = new RegExp(buildConstructorUsagePattern('TcpServer'), 'gi');
    assert.strictEqual(re.test('Set x = New TcpServerFactory(1)'), false);
    re.lastIndex = 0;
    assert.strictEqual(re.test('Set x = New OtherServer(1)'), false);
});

test('참조 문법: 정확한 `"Class.Proc"` callback 문자열을 참조로 인정한다', () => {
    const line = '\tclientThread = New Thread("TcpServer.TcpClientSessionThreadFunc",,"TCPCLI")';
    const column = line.indexOf('TcpClientSessionThreadFunc');

    assert.strictEqual(isSymbolicStringReferenceAt(line, column, {
        name: 'TcpClientSessionThreadFunc',
        containerNames: ['TcpServer'],
    }), true);
});

test('참조 문법: 문자열의 부분 언급·다른 컨테이너·일반 label은 제외한다', () => {
    const message = 'LOG.Write("failed TcpServer.TcpClientSessionThreadFunc")';
    const wrongOwner = 'New Thread("Other.TcpClientSessionThreadFunc")';
    const label = 'New Thread("TCPCLI")';
    const target = {
        name: 'TcpClientSessionThreadFunc',
        containerNames: ['TcpServer'],
    };

    assert.strictEqual(
        isSymbolicStringReferenceAt(message, message.indexOf(target.name), target),
        false,
    );
    assert.strictEqual(
        isSymbolicStringReferenceAt(wrongOwner, wrongOwner.indexOf(target.name), target),
        false,
    );
    assert.strictEqual(
        isSymbolicStringReferenceAt(label, label.indexOf('TCPCLI'), target),
        false,
    );
});

test('참조 문법: 단독 `"Proc"`는 호출자가 허용한 스코프에서만 인정한다', () => {
    const line = 'New Thread("TcpClientSessionThreadFunc")';
    const column = line.indexOf('TcpClientSessionThreadFunc');

    assert.strictEqual(isSymbolicStringReferenceAt(line, column, {
        name: 'TcpClientSessionThreadFunc',
        allowUnqualified: true,
    }), true);
    assert.strictEqual(isSymbolicStringReferenceAt(line, column, {
        name: 'TcpClientSessionThreadFunc',
        allowUnqualified: false,
    }), false);
});

test('참조 문법: `As`/`New` 뒤 이름은 타입 사용부로 본다', () => {
    const decl = '\tPrivate g_robot As MachineRobot';
    assert.strictEqual(isTypeUsageAt(decl, decl.indexOf('MachineRobot')), true);

    const ctor = '\t\tg_machine = New MachineRobot(g_robot, g_sys)';
    assert.strictEqual(isTypeUsageAt(ctor, ctor.indexOf('MachineRobot')), true);

    const dimNew = '\t\tDim sw As New Stopwatch';
    assert.strictEqual(isTypeUsageAt(dimNew, dimNew.indexOf('Stopwatch')), true);
});

test('참조 문법: 선언·멤버 접근·한정 표기는 타입 사용부가 아니다', () => {
    const decl = 'Public Class MachineRobot';
    assert.strictEqual(isTypeUsageAt(decl, decl.indexOf('MachineRobot')), false);

    const member = '\t\tg_machine.MachineRobot = 1';
    assert.strictEqual(isTypeUsageAt(member, member.indexOf('MachineRobot')), false);

    // 한정 표기의 마지막 이름은 한정자 해석이 따로 맡는다.
    const qualified = '\tPrivate g_robot As ROB.MachineRobot';
    assert.strictEqual(isTypeUsageAt(qualified, qualified.indexOf('MachineRobot')), false);

    // 이름의 일부가 As/New로 끝나는 식별자에 속으면 안 된다.
    const alias = '\t\tbias MachineRobot';
    assert.strictEqual(isTypeUsageAt(alias, alias.indexOf('MachineRobot')), false);
});

test('참조 문법: 문자열은 프로시저 이름을 소비하는 인자 자리에서만 참조다', () => {
    const spawn = 'ths = New Thread("NPU.WorkerLoop",,"TCPCMD")';
    const consumer = findSymbolStringConsumerAt(spawn, spawn.indexOf('"NPU'));
    assert.ok(consumer, 'New Thread 의 첫 인자는 procedure_name');
    assert.strictEqual(consumer!.argIndex, 0);

    // 세 번째 인자는 thread_name(런타임 라벨) — 프로시저를 찾는 자리가 아니다.
    assert.strictEqual(findSymbolStringConsumerAt(spawn, spawn.indexOf('"TCPCMD"')), undefined);

    // 로그 문자열: 감싸는 호출이 표에 없다.
    const log = 'LOG.WriteEx(ex, "STA.ClearError")';
    assert.strictEqual(findSymbolStringConsumerAt(log, log.indexOf('"STA')), undefined);

    // 인자 안의 중첩 호출을 건너뛰어도 인자 번호를 정확히 센다.
    const nested = 'LOG.Write(Fmt(a, b), "STA.ClearError")';
    assert.strictEqual(findSymbolStringConsumerAt(nested, nested.indexOf('"STA')), undefined);

    // 선언형 생성(`Dim … As New Thread`)도 같은 머리로 인식한다.
    const dim = '\t\tDim worker As New Thread("NPU.WorkerLoop")';
    assert.ok(findSymbolStringConsumerAt(dim, dim.indexOf('"NPU')));

    // 호출 밖의 문자열(대입)은 참조가 아니다.
    const assign = 'tag = "STA.ClearError"';
    assert.strictEqual(findSymbolStringConsumerAt(assign, assign.indexOf('"STA')), undefined);
});

test('참조 문법: 로그 문자열은 `"Mod.Proc"` 모양이어도 참조로 세지 않는다', () => {
    const log = 'LOG.WriteEx(ex, "STA.ClearError")';
    assert.strictEqual(
        isSymbolicStringReferenceAt(log, log.indexOf('ClearError'), {
            name: 'ClearError',
            containerNames: ['STA'],
            allowUnqualified: true,
        }),
        false,
        '2026-09-22 사용자 보고 — 로그 문자열이 참조 목록에 섞이던 것',
    );

    const spawn = 'ths = New Thread("NPU.WorkerLoop",,"TCPCMD")';
    assert.strictEqual(
        isSymbolicStringReferenceAt(spawn, spawn.indexOf('WorkerLoop'), {
            name: 'WorkerLoop',
            containerNames: ['NPU'],
        }),
        true,
        '실제 스레드 시작 프로시저는 계속 참조',
    );
});
