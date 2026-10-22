// 런타임 콘솔(1403) 캡처 파일 검색 — MCP `runtime_console_search` 의 본체(2026-10-22 Sample Prep 요청).
//
// 확장은 수신한 런타임 콘솔 줄을 링버퍼(runtime_console_read, 최근 2000줄)와 별도로 파일에 덧붙인다:
//   %TEMP%\gpl-controller\runtime-console-<제어기 IP>.log   (2 MB 를 넘으면 .1.log 로 밀고 새로 씀 — 최근 + 직전 두 파일)
// 줄 형식: `<PC 수신 시각 UTC ISO> [<프로젝트>] <정규화된 줄>` (프로젝트는 있을 때만),
// 듣기 상태 마커: `<ISO> --- capture start … ---` / `--- reconnected … not listening for N s … ---` / `--- capture paused … ---`.
// 링버퍼 밖의 지난 실행(에이징 등) 이력은 여기서만 찾을 수 있다. 확장 쪽 경로 규칙은 src/controller/runtime/runtimeConsole.ts captureFilePath.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 확장(runtimeConsole.ts captureFilePath)과 같은 규칙의 캡처 파일 경로 — [직전(.1.log), 최근] 순(오래된 것 먼저). */
export function captureFilesFor(host, tmpdir = os.tmpdir()) {
  const ip = String(host ?? '').replace(/[^A-Za-z0-9.-]/g, '_');
  const current = path.join(tmpdir, 'gpl-controller', `runtime-console-${ip}.log`);
  return [current.replace(/\.log$/, '.1.log'), current];
}

const LINE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (?:\[([^\]]+)\] )?(.*)$/;
const MARKER_RE = /^--- .* ---$/;

/** 캡처 파일 한 줄을 {at, project?, text, marker} 로. 형식이 다르면 null(머리 없는 줄은 앞 줄의 이어짐으로 보지 않고 버린다). */
export function parseCaptureLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const text = m[3];
  return { at: m[1], ...(m[2] ? { project: m[2] } : {}), text, marker: MARKER_RE.test(text) };
}

function toEpoch(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`${name} 를 시각으로 해석할 수 없다: ${value} (ISO 8601 예: 2026-10-20T13:00:00Z 또는 2026-10-20T22:00:00+09:00)`);
  return t;
}

/**
 * 캡처 파일을 검색한다. 결과는 시각 오름차순이고, maxLines 를 넘으면 **가장 최근 것**을 남긴다(truncated:true).
 * 마커 줄은 includeMarkers(기본 true)면 시간 범위 안의 것을 패턴과 무관하게 함께 돌려준다 — 공백 구간이 "출력 없음" 인지
 * "듣지 않음" 인지 가르는 근거라서. project 필터도 마커에는 적용하지 않는다.
 */
export function searchCapture({ files, pattern, since, until, project, maxLines = 200, includeMarkers = true }) {
  let re;
  if (pattern) {
    try { re = new RegExp(pattern, 'i'); } catch (err) { return { ok: false, error: 'bad-pattern', detail: String(err?.message ?? err) }; }
  }
  let from; let to;
  try { from = toEpoch(since, 'since'); to = toEpoch(until, 'until'); } catch (err) { return { ok: false, error: 'bad-time', detail: err.message }; }
  const wantProject = project ? String(project).toLowerCase() : undefined;
  const limit = Math.max(1, Math.min(2000, Math.floor(maxLines)));

  const fileInfo = [];
  const hits = [];
  let scanned = 0;
  let matchedLines = 0;
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { fileInfo.push({ path: file, exists: false }); continue; }
    fileInfo.push({ path: file, exists: true, bytes: Buffer.byteLength(content) });
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseCaptureLine(lines[i]);
      if (!parsed) continue;
      scanned++;
      const t = Date.parse(parsed.at);
      if (from !== undefined && t < from) continue;
      if (to !== undefined && t > to) continue;
      if (parsed.marker) {
        if (includeMarkers || (re && re.test(parsed.text))) hits.push({ ...parsed, file: path.basename(file), line: i + 1 });
        continue;
      }
      if (wantProject && (parsed.project ?? '').toLowerCase() !== wantProject) continue;
      if (re && !re.test(parsed.text)) continue;
      matchedLines++;
      hits.push({ ...parsed, file: path.basename(file), line: i + 1 });
    }
  }
  const truncated = hits.length > limit;
  return {
    ok: true,
    files: fileInfo,
    scannedLines: scanned,
    matchedLines,
    truncated,
    lines: truncated ? hits.slice(-limit) : hits,
    ...(fileInfo.every((f) => !f.exists)
      ? { note: '캡처 파일이 없다 — 이 PC 의 확장이 이 제어기의 런타임 콘솔을 받은 적이 없거나, gpl.runtimeConsole.captureFile 설정이 꺼져 있다.' }
      : {}),
  };
}
