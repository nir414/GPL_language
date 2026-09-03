import * as assert from 'assert';
import { test } from './harness';
import {
    buildConstructorUsagePattern,
    isSymbolicStringReferenceAt,
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
