import test from 'node:test';
import assert from 'node:assert/strict';
import {
    describeHardwareId, describeIdentityMismatch, evaluateExpectedSerial, parseExpectedSerials, parseHardwareId, readControllerHardwareId,
} from '../../../controller/connection/controllerHardwareId';

const pd = (id: number, desc: string, value: string) => `<DATA>${id}, 1, 1, 0, "${desc}" = ${value}</DATA><STATUS>0</STATUS>`;

test('parseHardwareId: 110/114/109/101 문자열 값', () => {
    const id = parseHardwareId({
        serial: pd(110, 'Controller serial number', '"0014FF-02300289"'),
        id: pd(114, 'Controller ID', '"410c-01be-49c4-e3b5"'),
        name: pd(109, 'Controller name', '"102. Antibody 96Ch"'),
        model: pd(101, 'Controller model', '"G2400C"'),
    });
    assert.deepStrictEqual(id, { serial: '0014FF-02300289', id: '410c-01be-49c4-e3b5', name: '102. Antibody 96Ch', model: 'G2400C' });
    assert.match(describeHardwareId(id!), /serial=0014FF-02300289/);
});

test('parseHardwareId: 전부 실패하면 null', () => {
    assert.strictEqual(parseHardwareId({ serial: null, id: '-1503 *x*' }), null);
});

test('evaluateExpectedSerial: 없음/일치(대소문자 무시)/불일치/읽기 실패', () => {
    const id = { serial: '0014FF-02300289', id: null, name: null, model: null };
    assert.strictEqual(evaluateExpectedSerial(id, undefined), null);
    assert.strictEqual(evaluateExpectedSerial(id, []), null);
    assert.strictEqual(evaluateExpectedSerial(id, '0014ff-02300289'), null);
    assert.strictEqual(evaluateExpectedSerial(id, ['X', '0014FF-02300289']), null);
    assert.strictEqual(evaluateExpectedSerial(id, 'X')?.reason, 'serial-differs');
    assert.strictEqual(evaluateExpectedSerial(null, 'X')?.reason, 'serial-unreadable');
    assert.deepStrictEqual(parseExpectedSerials('A, B;C'), ['A', 'B', 'C']);
    assert.match(describeIdentityMismatch(evaluateExpectedSerial(id, 'X')!, '192.168.0.1'), /다른 제어기일 수 있습니다\.$/);
});

test('readControllerHardwareId: 읽기 전용 pd 4건, 개별 예외 허용', async () => {
    const sent: string[] = [];
    const id = await readControllerHardwareId(async cmd => {
        sent.push(cmd);
        if (cmd === 'pd 114') { throw new Error('x'); }
        return cmd === 'pd 110' ? pd(110, 's', '"S1"') : null;
    });
    assert.deepStrictEqual(sent, ['pd 110', 'pd 114', 'pd 109', 'pd 101']);
    assert.strictEqual(id?.serial, 'S1');
    assert.strictEqual(id?.id, null);
});
