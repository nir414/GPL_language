import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureFilesFor, parseCaptureLine, searchCapture } from '../src/consoleCapture.js';

// 런타임 콘솔 캡처 파일 검색 — 2026-10-22 Sample Prep(에이징 이력을 파일 grep 으로 복원했다).

function withFiles(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-capture-test-'));
  const files = contents.map((text, i) => {
    const file = path.join(dir, `f${i}.log`);
    if (text !== null) fs.writeFileSync(file, text);
    return file;
  });
  return { files, cleanup: () => { for (const f of files) { try { fs.unlinkSync(f); } catch { /* 없음 */ } } fs.rmdirSync(dir); } };
}

test('captureFilesFor: 확장과 같은 경로 규칙, 직전(.1.log) 다음 최근 순', () => {
  const [older, current] = captureFilesFor('192.168.0.1', 'T');
  assert.equal(current, path.join('T', 'gpl-controller', 'runtime-console-192.168.0.1.log'));
  assert.equal(older, path.join('T', 'gpl-controller', 'runtime-console-192.168.0.1.1.log'));
});

test('parseCaptureLine: 프로젝트 있는 줄·없는 줄·마커·형식 밖', () => {
  assert.deepEqual(parseCaptureLine('2026-10-20T13:03:00.000Z [AXIS_Probe] Repeat start 3'),
    { at: '2026-10-20T13:03:00.000Z', project: 'AXIS_Probe', text: 'Repeat start 3', marker: false });
  assert.equal(parseCaptureLine('2026-10-20T13:03:00.000Z hello').project, undefined);
  assert.equal(parseCaptureLine('2026-10-21T02:00:00.000Z --- capture start 192.168.0.1:1403 (pid 1) ---').marker, true);
  assert.equal(parseCaptureLine('garbage'), null);
});

test('searchCapture: 두 파일을 오래된 것부터 읽고 패턴·프로젝트·시간 범위로 거른다', () => {
  const { files, cleanup } = withFiles([
    '2026-10-20T13:00:00.000Z [AXIS_Probe] Repeat start\n2026-10-20T13:10:00.000Z [AXIS_Probe] Cycle end 1\n',
    '2026-10-21T02:00:00.000Z --- reconnected 192.168.0.1:1403 — not listening for 46800 s ---\n'
      + '2026-10-22T00:10:00.000Z [BINDER_Probe] Repeat end\n2026-10-22T00:11:00.000Z [BINDER_Probe] other\n',
  ]);
  try {
    const all = searchCapture({ files, pattern: 'repeat (start|end)' });
    assert.equal(all.ok, true);
    assert.deepEqual(all.lines.map((l) => l.text), ['Repeat start', all.lines[1].text, 'Repeat end']);
    assert.equal(all.lines[1].marker, true, '마커는 패턴과 무관하게 포함');
    assert.equal(all.matchedLines, 2);

    const binder = searchCapture({ files, project: 'binder_probe', includeMarkers: false });
    assert.deepEqual(binder.lines.map((l) => l.text), ['Repeat end', 'other']);

    const ranged = searchCapture({ files, since: '2026-10-20T13:05:00Z', until: '2026-10-21T00:00:00Z' });
    assert.deepEqual(ranged.lines.map((l) => l.text), ['Cycle end 1']);
  } finally { cleanup(); }
});

test('searchCapture: maxLines 를 넘으면 최근 것을 남기고 truncated', () => {
  const body = Array.from({ length: 5 }, (_, i) => `2026-10-22T00:0${i}:00.000Z line ${i}`).join('\n');
  const { files, cleanup } = withFiles([null, body]);
  try {
    const r = searchCapture({ files, maxLines: 2 });
    assert.equal(r.truncated, true);
    assert.deepEqual(r.lines.map((l) => l.text), ['line 3', 'line 4']);
    assert.equal(r.files[0].exists, false);
  } finally { cleanup(); }
});

test('searchCapture: 잘못된 패턴·시각은 구조화된 오류, 파일이 하나도 없으면 note', () => {
  assert.equal(searchCapture({ files: [], pattern: '(' }).error, 'bad-pattern');
  assert.equal(searchCapture({ files: [], since: 'yesterday' }).error, 'bad-time');
  const none = searchCapture({ files: [path.join(os.tmpdir(), 'nope-gpl-capture.log')] });
  assert.equal(none.ok, true);
  assert.match(none.note, /캡처 파일이 없다/);
});
