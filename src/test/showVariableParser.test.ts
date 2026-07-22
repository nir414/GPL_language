import * as assert from 'assert';
import { test } from './harness';
import {
    parseShowVariableMulti,
    classifyVarEntry,
    arrayRank,
    splitVarLine,
} from '../debug/showVariableParser';

// ─── 실기기 캡처 픽스처 (GPL 4.x, 2026-07-22, MergeCode/OpCommandRunThread1) ───
// Show Variable -eval OpCommandRunThread1 0 cmd
const REAL_OBJECT_DUMP = '<DATA>cmd, Object Command\n'
    + 'cmd.m_cmd, String, "get"\n'
    + 'cmd.m_cmdCode, Integer, 0\n'
    + 'cmd.m_needLogWrite, Boolean, -1\n'
    + 'cmd.m_rawArg, String, "7,6"\n'
    + 'cmd.m_responseRobotIndex, Boolean, 0\n'
    + 'cmd.m_robotIndex, Integer, 0\n'
    + 'cmd.m_sourceDevice, Integer, 2\n'
    + '</DATA>\n<STATUS>0,"Success"</STATUS>';

test('parseShowVariableMulti: 실기기 객체 덤프 — 헤더+멤버 7줄, 값 속 쉼표 보존', () => {
    const entries = parseShowVariableMulti(REAL_OBJECT_DUMP);
    assert.strictEqual(entries.length, 8);
    assert.deepStrictEqual(entries[0], { name: 'cmd', type: 'Object Command', value: '' });
    const rawArg = entries.find(e => e.name === 'cmd.m_rawArg');
    assert.strictEqual(rawArg?.value, '"7,6"'); // 쉼표 포함 문자열이 잘리지 않아야 함
    assert.strictEqual(entries.find(e => e.name === 'cmd.m_needLogWrite')?.value, '-1');
});

test('classifyVarEntry: 실기기 객체 헤더는 클래스명 포함(`Object Command`) — object로 분류', () => {
    // 실기기는 `Object Command`, 공식 문서 예시는 `Object` 단독 — 둘 다 object여야 한다.
    assert.strictEqual(classifyVarEntry({ name: 'cmd', type: 'Object Command', value: '' }), 'object');
    assert.strictEqual(classifyVarEntry({ name: 'Loc', type: 'Object', value: '' }), 'object');
});

test('classifyVarEntry: 배열 헤더/요소/단순 값 분류 불변', () => {
    // 배열 헤더: 값 없이 타입 끝 괄호
    assert.strictEqual(classifyVarEntry({ name: 'My_array', type: 'Double(,)', value: '' }), 'array');
    assert.strictEqual(classifyVarEntry({ name: 'buf', type: 'String()', value: '' }), 'array');
    // 요소 응답은 값이 있으므로 simple
    assert.strictEqual(classifyVarEntry({ name: 'arr(0,0)', type: 'Double(,)', value: '30.5' }), 'simple');
    assert.strictEqual(classifyVarEntry({ name: 'i', type: 'Integer', value: '5' }), 'simple');
});

test('classifyVarEntry: 객체 배열 헤더(`RobotArm()`류)는 array가 우선', () => {
    // 배열 판정을 먼저 해야 `Object Xxx()` 형태가 object로 오분류되지 않는다.
    assert.strictEqual(classifyVarEntry({ name: 'list', type: 'Object Command()', value: '' }), 'array');
});

test('parseShowVariableMulti: 에러 STATUS만 있는 응답은 빈 목록', () => {
    // 실기기: cmd.ints(0) → -780, cmd.m_rawArgs(0) → -729
    const resp = '<DATA></DATA>\n<STATUS>-780,"*Unsupported procedure reference*"</STATUS>';
    assert.deepStrictEqual(parseShowVariableMulti(resp), []);
});

test('arrayRank: 차원 수 추출', () => {
    assert.strictEqual(arrayRank('Double()'), 1);
    assert.strictEqual(arrayRank('Double(,)'), 2);
    assert.strictEqual(arrayRank('Integer(,,)'), 3);
});

test('splitVarLine: 괄호 안 쉼표 무시 + maxParts 이후 병합', () => {
    assert.deepStrictEqual(
        splitVarLine('arr(0,1), Double(,), 30.5', 3),
        ['arr(0,1)', 'Double(,)', '30.5'],
    );
    assert.deepStrictEqual(
        splitVarLine('cmd.m_rawArg, String, "7,6"', 3),
        ['cmd.m_rawArg', 'String', '"7,6"'],
    );
});
