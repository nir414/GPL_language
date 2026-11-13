import test from 'node:test';
import assert from 'node:assert/strict';
import { nestedLibraryOf, normalizeSourceFile, sameSourceFile, splitLibraryQualifiedFile } from '../src/libraryLocation.js';

test('라이브러리 표기: <lib>/<file> 은 project:<lib>, file:<file> 로 푼다 — 파일 부분은 제어기가 받는 역슬래시로', () => {
  assert.deepEqual(splitLibraryQualifiedFile('PaL/Data_Store.gpl', ['PaL', 'Gantry']), { project: 'PaL', file: 'Data_Store.gpl' });
  assert.deepEqual(splitLibraryQualifiedFile('pal\\Sub\\x.gpl', ['PaL']), { project: 'PaL', file: 'Sub\\x.gpl' });
  // 2026-11-13 실측: 위치 `TLib/Core\Log\Logger.gpl` → Set Break TLib "Core\Log\Logger.gpl" 는 0, "Core/Log/Logger.gpl" 은 -508.
  assert.deepEqual(splitLibraryQualifiedFile('TLib/Core\\Log\\Logger.gpl', ['TLib']), { project: 'TLib', file: 'Core\\Log\\Logger.gpl' });
  assert.deepEqual(splitLibraryQualifiedFile('TLib/Core/Log/Logger.gpl', ['TLib']), { project: 'TLib', file: 'Core\\Log\\Logger.gpl' });
});

test('중첩 라이브러리: 위치가 중첩 ProjectLibrary 값으로 시작하면 그 값을(가장 긴 것) — 지정 불가라 보내지 않는다', () => {
  const nested = ['NLib/Core', 'NLib/Core/Log', 'NLib/Util'];
  assert.equal(nestedLibraryOf('NLib\\Core\\Log/Logger.gpl', nested), 'NLib/Core/Log');
  assert.equal(nestedLibraryOf('nlib/util/Util.gpl', nested), 'NLib/Util');
  assert.equal(nestedLibraryOf('TLib/Core\\Log\\Logger.gpl', nested), null);
  assert.equal(nestedLibraryOf('NLib/Core/Log', nested), 'NLib/Core');
  assert.equal(nestedLibraryOf('Main.gpl', nested), null);
  assert.equal(nestedLibraryOf('NLib/x.gpl', []), null);
});

test('라이브러리 표기: 라이브러리가 아닌 첫 구간·단독 파일명·빈 목록은 건드리지 않는다', () => {
  assert.equal(splitLibraryQualifiedFile('Sub/x.gpl', ['PaL']), null);
  assert.equal(splitLibraryQualifiedFile('Data_Store.gpl', ['PaL']), null);
  assert.equal(splitLibraryQualifiedFile('PaL/Data_Store.gpl', []), null);
  assert.equal(splitLibraryQualifiedFile('PaL/', ['PaL']), null);
  assert.equal(splitLibraryQualifiedFile('/x.gpl', ['PaL']), null);
});

test('정규화: 구분자 통일', () => {
  assert.equal(normalizeSourceFile(' .\\A\\\\B/c.gpl '), 'A/B/c.gpl');
});

test('atRequestedLine 파일 비교: 라이브러리 표기 차이를 같게 본다', () => {
  // 요청 project:PaL file:Data_Store.gpl, 정지 위치 project:App file:PaL/Data_Store.gpl
  assert.equal(sameSourceFile({ project: 'PaL', file: 'Data_Store.gpl' }, { project: 'App', file: 'PaL/Data_Store.gpl' }), true);
  // 요청 project:App file:PaL/Data_Store.gpl, 정지 위치 project:PaL file:Data_Store.gpl
  assert.equal(sameSourceFile({ project: 'App', file: 'PaL/Data_Store.gpl' }, { project: 'PaL', file: 'Data_Store.gpl' }), true);
  // 같은 표기·대소문자·구분자 차이
  assert.equal(sameSourceFile({ file: 'a.GPL' }, { file: 'A.gpl' }), true);
  assert.equal(sameSourceFile({ file: 'Sub\\a.gpl' }, { file: 'Sub/a.gpl' }), true);
});

test('atRequestedLine 파일 비교: 다른 파일·다른 폴더의 동명 파일은 같다고 하지 않는다', () => {
  assert.equal(sameSourceFile({ project: 'PaL', file: 'Data_Store.gpl' }, { project: 'App', file: 'Data_Store.gpl' }), false);
  assert.equal(sameSourceFile({ file: 'A/x.gpl' }, { file: 'B/x.gpl' }), false);
  assert.equal(sameSourceFile({ project: 'PaL', file: 'Data_Store.gpl' }, { project: 'PaL', file: 'Other.gpl' }), false);
  assert.equal(sameSourceFile({ file: '' }, { file: '' }), false);
  assert.equal(sameSourceFile(undefined, { file: 'a.gpl' }), false);
});
