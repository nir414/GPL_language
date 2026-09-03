import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBreakList, hasBreakpointAt } from '../src/parse.js';

/** 실기기 `Show Break` 응답 (2026-08-31 G2400C 캡처). */
const SHOW_BREAK = '<STATUS>0, "Success"</STATUS>\r\n'
  + '119, GPL_Code, MAIN, 3, Main.gpl, 10, 0\r\n'
  + '120, GPL_Code, MAIN, 29, Main.gpl, 36, 2\r\n'
  + '121, GPL_Code, Proto, 8, ProtocolModule.gpl, 818, 0\r\n';

test('parseBreakList: 실기기 응답에서 위치와 히트수를 뽑는다', () => {
  assert.deepEqual(parseBreakList(SHOW_BREAK), [
    { number: 119, project: 'GPL_Code', proc: 'MAIN', file: 'Main.gpl', line: 10, hits: 0 },
    { number: 120, project: 'GPL_Code', proc: 'MAIN', file: 'Main.gpl', line: 36, hits: 2 },
    { number: 121, project: 'GPL_Code', proc: 'Proto', file: 'ProtocolModule.gpl', line: 818, hits: 0 },
  ]);
});

test('parseBreakList: 중단점이 없거나 형식이 어긋난 줄은 버린다', () => {
  assert.deepEqual(parseBreakList('<STATUS>0, "Success"</STATUS>\r\n'), []);
  // 위치가 없는 항목(파일줄 0)은 "그 자리에 BP가 있다"고 말할 수 없다.
  assert.deepEqual(parseBreakList('1, P, MAIN, 3, Main.gpl, 0, 0'), []);
  assert.deepEqual(parseBreakList('쓰레기 응답'), []);
});

test('hasBreakpointAt: 파일명 대소문자·경로를 무시하고 줄 번호로 찾는다', () => {
  const list = parseBreakList(SHOW_BREAK);
  assert.equal(hasBreakpointAt(list, 'Main.gpl', 10), true);
  assert.equal(hasBreakpointAt(list, 'main.GPL', 36), true);
  assert.equal(hasBreakpointAt(list, 'sub\\Main.gpl', 10), true);
  assert.equal(hasBreakpointAt(list, 'Main.gpl', 11), false);
  assert.equal(hasBreakpointAt(list, 'Other.gpl', 10), false);
  assert.equal(hasBreakpointAt([], 'Main.gpl', 10), false);
});
