/**
 * 예약어 정본(gplReservedWords) 단위 테스트.
 *
 * 이 목록은 rename 금지·정의 탐색 조기 차단·디버그 hover 평가 차단이 함께 쓰므로,
 * 좁은 집합이 넓은 집합의 부분집합이라는 관계와 실사용 낱말이 깨지지 않는지 지킨다.
 */
import * as assert from 'assert';
import { test } from './harness';
import {
    GPL_RESERVED_WORDS,
    GPL_CONTROL_KEYWORDS,
    isGplReservedWord,
    isGplControlKeyword,
} from '../language/gplReservedWords';
import { GPL_RENAME_RESERVED, isRenameReservedWord } from '../language/renameCore';

test('예약어: 좁은 집합(제어문)은 넓은 집합의 부분집합', () => {
    for (const w of GPL_CONTROL_KEYWORDS) {
        assert.ok(GPL_RESERVED_WORDS.has(w), `넓은 집합에 없음: ${w}`);
    }
    assert.ok(GPL_RESERVED_WORDS.size > GPL_CONTROL_KEYWORDS.size);
    // 좁은 집합에서 의도적으로 뺀 낱말(정의 탐색이 해석해야 하는 것들)
    for (const w of ['new', 'me', 'mybase', 'string', 'integer']) {
        assert.ok(!GPL_CONTROL_KEYWORDS.has(w), `좁은 집합에 있으면 안 됨: ${w}`);
        assert.ok(GPL_RESERVED_WORDS.has(w), `넓은 집합에 있어야 함: ${w}`);
    }
});

// config.ts의 GPL_CONTROL_KEYWORDS 재노출은 vscode 의존 모듈이라 이 순수 러너에서 import할 수 없다
// (컴파일 시점의 타입 검사로 계약이 지켜진다). 여기서는 순수 모듈 경로만 대조한다.
test('예약어: renameCore 재노출이 정본과 같은 집합', () => {
    assert.strictEqual(GPL_RENAME_RESERVED, GPL_RESERVED_WORDS);
});

test('예약어: 대소문자·공백 무시 판정', () => {
    assert.strictEqual(isGplReservedWord('If'), true);
    assert.strictEqual(isGplReservedWord('  THEN '), true);
    assert.strictEqual(isGplReservedWord('String'), true);
    assert.strictEqual(isGplReservedWord('context'), false);
    assert.strictEqual(isRenameReservedWord('Me'), true);
    assert.strictEqual(isGplControlKeyword('Then'), true);
    assert.strictEqual(isGplControlKeyword('String'), false);
});
