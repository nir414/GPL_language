/**
 * 상태바 업로드 진행 바 — 표시 규칙의 정본(vscode 무의존). 집계는 `controller/uploadProgress`.
 *
 * `views/compileStaleBadge` 와 같은 나눔이다: 무엇이 일어났는가(집계·이벤트)는 controller 에, **어떻게 보이는가**
 * (`██████████░░░░░░░░░░  3.2 MB / 10.7 MB`·툴팁·완료 요약)는 여기에. 상태바(`connectionStatusBar`)는 이 문자열을
 * 붙이고 보이기/숨기기 타이밍만 안다(ai-handoff §1-EE). 바이트 표기 자체는 트리 FTP 목록과 공유하는 `util/formatBytes`.
 */

import type { UploadProgress, UploadProgressEvent, UploadSummary } from '../controller/uploadProgress';
import { byteUnitFor, formatBytes, formatBytesAs } from '../util/formatBytes';

/** 진행 바 칸 수. 상태바 한 항목에 들어가는 폭 기준. */
export const UPLOAD_BAR_WIDTH = 20;

const FULL_BLOCK = '█';
const EMPTY_BLOCK = '░';
/** 경계 칸의 1/8 단위 부분 블록(왼쪽부터 채움). 인덱스 0 은 "부분 없음". */
const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/**
 * 진행 바 문자열. 총량이 0 이면(올릴 것이 없음) 가득 찬 바 — 비어 있는 바는 "아직 시작 전"으로 읽히기 때문.
 * 경계 칸은 1/8 단위 부분 블록으로 그려 작은 프로젝트에서도 바가 끊기지 않고 움직인다.
 */
export function renderBar(done: number, total: number, width = UPLOAD_BAR_WIDTH): string {
    if (width <= 0) { return ''; }
    const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 1;
    const cells = ratio * width;
    const full = Math.floor(cells);
    const partial = full < width ? PARTIAL_BLOCKS[Math.floor((cells - full) * PARTIAL_BLOCKS.length)] : '';
    const empty = width - full - (partial ? 1 : 0);
    return FULL_BLOCK.repeat(full) + partial + EMPTY_BLOCK.repeat(empty);
}

/** `done / total` 을 total 의 단위로 맞춰 나란히 — `3.2 MB / 10.7 MB` (단위가 다르면 비율이 한눈에 안 읽힌다). */
export function formatBytesPair(done: number, total: number): string {
    const unit = byteUnitFor(total);
    return `${formatBytesAs(done, unit)} / ${formatBytesAs(total, unit)}`;
}

/** 상태바 본문 — `██████████░░░░░░░░░░  3.2 MB / 10.7 MB`. 아이콘·프로젝트명은 접착 계층이 앞뒤에 붙인다. */
export function renderUploadProgress(p: UploadProgress): string {
    return `${renderBar(p.doneBytes, p.totalBytes)}  ${formatBytesPair(p.doneBytes, p.totalBytes)}`;
}

/**
 * 상태바 툴팁 — 파일 수와 현재 파일. 전송 중(`bytes`)이면 "전송 중:", 파일 하나가 방금 끝난 뒤(`file`)면
 * "완료:"/"동일:" 로 구분한다(스킵만 이어지는 구간에 "전송 중" 이라고 쓰면 거짓이다).
 * `projectName` 이 있으면 어느 프로젝트가 올라가는지 앞에 적는다.
 */
export function describeUploadProgress(e: UploadProgressEvent, projectName?: string): string {
    const head = projectName ? `${projectName} 업로드 중` : '업로드 중';
    const files = `${e.doneFiles}/${e.totalFiles} 파일 · ${formatBytesPair(e.doneBytes, e.totalBytes)}`;
    let current = '';
    if (e.file && e.doneFiles < e.totalFiles) {
        current = e.type === 'bytes'
            ? `\n전송 중: ${e.file}`
            : `\n${e.action === 'uploaded' ? '완료' : '동일'}: ${e.file}`;
    }
    return `${head} — ${files}${current}\n\n스킵(내용 동일)된 파일은 그 시점에 완료로 더해져 바가 단숨에 뜁니다.`;
}

/** 완료 표시 — `업로드 완료 10.7 MB (3 전송 · 44 동일)`. 전송 0 이면 "변경 없음"으로 읽히게 쓴다. */
export function renderUploadSummary(s: UploadSummary): string {
    const parts = [`${s.uploaded} 전송`];
    if (s.skipped > 0) { parts.push(`${s.skipped} 동일`); }
    const size = formatBytes(s.totalBytes);
    return s.uploaded === 0 && s.skipped > 0
        ? `업로드 완료 — 변경 없음 (${s.skipped} 동일, ${size})`
        : `업로드 완료 ${size} (${parts.join(' · ')})`;
}
