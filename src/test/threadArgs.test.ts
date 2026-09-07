import * as assert from 'assert';
import { test } from './harness';
import { asThreadNode } from '../controller/threadArgs';

test('threadArgs: 트리 노드({ thread: { name, project } })는 그대로 돌려준다', () => {
    const node = { thread: { name: 'Main', project: 'GPL_Code' }, extra: 1 };
    assert.strictEqual(asThreadNode(node), node);
});

test('threadArgs: 문자열은 이름으로 — 공백은 정리하고 빈 문자열은 undefined', () => {
    assert.deepStrictEqual(asThreadNode('  Main '), { thread: { name: 'Main' } });
    assert.strictEqual(asThreadNode('   '), undefined);
});

test('threadArgs: { threadName, project } / { name } 도 노드 형태로 받는다 (URI·AI 호출)', () => {
    assert.deepStrictEqual(asThreadNode({ threadName: 'Worker', project: 'P' }), { thread: { name: 'Worker', project: 'P' } });
    assert.deepStrictEqual(asThreadNode({ name: 'Worker' }), { thread: { name: 'Worker', project: undefined } });
});

test('threadArgs: 이름이 없거나 객체가 아니면 undefined (호출측은 조용히 반환)', () => {
    assert.strictEqual(asThreadNode(undefined), undefined);
    assert.strictEqual(asThreadNode(42), undefined);
    assert.strictEqual(asThreadNode({ thread: { name: '' } }), undefined);
    assert.strictEqual(asThreadNode({ project: 'P' }), undefined);
});
