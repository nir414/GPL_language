import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSourceFile, sameSourceFile, splitLibraryQualifiedFile } from '../src/libraryLocation.js';

test('라이브러리 표기: <lib>/<file> 은 project:<lib>, file:<file> 로 푼다', () => {
  assert.deepEqual(splitLibraryQualifiedFile('PaL/Data_Store.gpl', ['PaL', 'Gantry']), { project: 'PaL', file: 'Data_Store.gpl' });
  assert.deepEqual(splitLibraryQualifiedFile('pal\\Sub\\x.gpl', ['PaL']), { project: 'PaL', file: 'Sub/x.gpl' });
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
