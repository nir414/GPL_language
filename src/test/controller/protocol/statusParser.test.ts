import * as assert from 'assert';
import { test } from '../../harness';
import { parseStatus } from '../../../controller/protocol/statusParser';

test('parseStatus: 성공 코드와 메시지', () => {
    const r = parseStatus('<STATUS>0,"OK"</STATUS>');
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.message, 'OK');
});

test('parseStatus: 음수 에러 코드', () => {
    const r = parseStatus('<STATUS>-745,"already loaded"</STATUS>');
    assert.strictEqual(r.code, -745);
    assert.strictEqual(r.message, 'already loaded');
});

test('parseStatus: 메시지 없는 STATUS', () => {
    const r = parseStatus('prefix <STATUS> -742 </STATUS> suffix');
    assert.strictEqual(r.code, -742);
    assert.strictEqual(r.message, '');
});

test('parseStatus: STATUS 없으면 -9999', () => {
    const r = parseStatus('garbage response without status');
    assert.strictEqual(r.code, -9999);
});

test('parseStatus: DATA 본문에 STATUS 텍스트가 있어도 마지막(종결) 블록을 채택', () => {
    const dump = '<DATA>log says <STATUS>-999,"fake"</STATUS> inside body</DATA>\r\n<STATUS>0,"Success"</STATUS>';
    const r = parseStatus(dump);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.message, 'Success');
});

test('parseStatus(§1-GZ): 닫는 </STATUS> 가 없는 잘린 블록은 코드로 읽지 않는다', () => {
    assert.strictEqual(parseStatus('<DATA>x</DATA><STATUS>-75').code, -9999);
    assert.strictEqual(parseStatus('<STATUS>0,"Success"').code, -9999);
    assert.strictEqual(parseStatus('<STATUS>-750,"*Invalid when thread active*"</STATUS>\r\n').code, -750);
    assert.strictEqual(parseStatus('<STATUS>0</STATUS>').code, 0);
});
