/**
 * 바이트 → 사람이 읽는 크기 — 트리 FTP 목록·업로드 진행 바·완료 요약이 함께 쓰는 **단일 규칙**(vscode 무의존).
 *
 * 종전에는 `views/treeFormat.formatSize` 가 트리 전용으로 있었는데, 업로드 진행 바(2026-09-30 §1-EE)가 같은 규칙을
 * 다시 쓰려 하자 사본이 생겨 여기로 올렸다. 어느 계층에도 속하지 않는 순수 헬퍼만 `util/` 에 둔다.
 *
 * B 는 정수, 그 위는 소수 1자리 고정(`10.7 MB`) — 자릿수가 흔들리면 상태바 글자가 떨린다. 단위는 1024 배수, GB 까지.
 */

export const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
export type ByteUnit = typeof BYTE_UNITS[number];

/** `bytes` 를 표기할 단위 — 1024 배수로 올라가며 마지막 단위(GB)에서 멈춘다. */
export function byteUnitFor(bytes: number): ByteUnit {
    let unit = 0;
    let value = Math.max(0, bytes);
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    return BYTE_UNITS[unit];
}

/** 정해진 단위로 표기 — 두 값을 같은 단위로 나란히 쓸 때(`3.2 MB / 10.7 MB`). B 는 정수, 그 위는 소수 1자리. */
export function formatBytesAs(bytes: number, unit: ByteUnit): string {
    const n = Math.max(0, bytes);
    if (unit === 'B') { return `${Math.round(n)} B`; }
    return `${(n / 1024 ** BYTE_UNITS.indexOf(unit)).toFixed(1)} ${unit}`;
}

/** 값에 맞는 단위로 표기 — `1023 B` · `1.5 KB` · `10.7 MB`. 음수는 0 으로 자른다. */
export function formatBytes(bytes: number): string {
    return formatBytesAs(bytes, byteUnitFor(bytes));
}
