import * as assert from 'assert';
import { test } from './harness';
import {
    findRenameOccurrencesInLine,
    findReturnAssignmentColumn,
    findStringLiteralRenameOccurrences,
    isDotQualifiedAt,
    isRenameReservedWord,
    isValidGplIdentifier,
    isWordAt,
    resolveDeclarationNameColumn
} from '../language/renameCore';
import { isInCommentOrString } from '../language/cursorExpression';

// ── 식별자/예약어 검증 ─────────────────────────────────────────────────────

test('renameCore: 식별자 형식 검증', () => {
    assert.strictEqual(isValidGplIdentifier('robotArm1'), true);
    assert.strictEqual(isValidGplIdentifier('_temp'), true);
    assert.strictEqual(isValidGplIdentifier('1abc'), false);
    assert.strictEqual(isValidGplIdentifier('my-name'), false);
    assert.strictEqual(isValidGplIdentifier('Mod.Proc'), false);
    assert.strictEqual(isValidGplIdentifier(''), false);
});

test('renameCore: 예약어 차단 (제어문+선언+타입, 대소문자 무시)', () => {
    assert.strictEqual(isRenameReservedWord('If'), true);
    assert.strictEqual(isRenameReservedWord('SUB'), true);
    assert.strictEqual(isRenameReservedWord('Integer'), true);
    assert.strictEqual(isRenameReservedWord('new'), true);
    assert.strictEqual(isRenameReservedWord('Me'), true);
    assert.strictEqual(isRenameReservedWord('moveArm'), false);
});

// ── 줄 단위 발생 위치 스캔 ────────────────────────────────────────────────

test('renameCore: 기본 매치 — 대소문자 무시, 단어 경계', () => {
    const line = 'count = COUNT + counter';
    const occ = findRenameOccurrencesInLine(line, 'count');
    // "counter"는 단어 경계로 제외
    assert.deepStrictEqual(occ.map(o => o.character), [0, 8]);
});

test('renameCore: 주석/문자열 내부 제외', () => {
    const line = 'x = foo(1) \' foo 호출';
    assert.deepStrictEqual(
        findRenameOccurrencesInLine(line, 'foo').map(o => o.character),
        [4]
    );
    const line2 = 'msg = "foo" & foo';
    assert.deepStrictEqual(
        findRenameOccurrencesInLine(line2, 'foo').map(o => o.character),
        [14]
    );
});

test('renameCore: skipQualified — 점 뒤 멤버 자리는 제외, 점 앞 기준 객체는 유지', () => {
    const line = 'loc = other.loc + loc.X';
    // "other.loc"의 loc(12)은 제외, 좌변 loc(0)과 "loc.X"의 loc(18)은 유지
    assert.deepStrictEqual(
        findRenameOccurrencesInLine(line, 'loc', { skipQualified: true }).map(o => o.character),
        [0, 18]
    );
    // skipQualified 없으면 셋 다
    assert.deepStrictEqual(
        findRenameOccurrencesInLine(line, 'loc').map(o => o.character),
        [0, 12, 18]
    );
});

test('renameCore: isDotQualifiedAt — 공백 낀 점 접근 인식', () => {
    assert.strictEqual(isDotQualifiedAt('obj.member', 4), true);
    assert.strictEqual(isDotQualifiedAt('obj . member', 6), true);
    assert.strictEqual(isDotQualifiedAt('member', 0), false);
    assert.strictEqual(isDotQualifiedAt('a + member', 4), false);
});

// ── 함수 반환값 대입 ──────────────────────────────────────────────────────

test('renameCore: 반환값 대입 탐지 — 문장 선두 단일 =만', () => {
    assert.strictEqual(findReturnAssignmentColumn('    GetCount = 5', 'GetCount'), 4);
    assert.strictEqual(findReturnAssignmentColumn('getcount = total', 'GetCount'), 0); // 대소문자 무시
    assert.strictEqual(findReturnAssignmentColumn('If GetCount = 5 Then', 'GetCount'), -1); // 비교문
    assert.strictEqual(findReturnAssignmentColumn('x = GetCount(1)', 'GetCount'), -1); // 우변 호출
    assert.strictEqual(findReturnAssignmentColumn('GetCounter = 5', 'GetCount'), -1); // 다른 식별자
    assert.strictEqual(findReturnAssignmentColumn('GetCount == 5', 'GetCount'), -1); // 합성 연산자 방어
});

// ── 문자열 프로시저 참조 ──────────────────────────────────────────────────

test('renameCore: 문자열 참조 — "Mod.Proc"에서 proc 세그먼트 (한정자 일치 시만)', () => {
    const line = 'th = New Thread("DataFile.SaveThread")';
    const hit = findStringLiteralRenameOccurrences(line, 'SaveThread', {
        kind: 'proc', containerName: 'DataFile'
    });
    assert.strictEqual(hit.length, 1);
    assert.strictEqual(line.substring(hit[0].character, hit[0].character + 'SaveThread'.length), 'SaveThread');

    // 한정자 불일치 → 무관한 동명 문자열이므로 제외
    const miss = findStringLiteralRenameOccurrences(line, 'SaveThread', {
        kind: 'proc', containerName: 'OtherModule'
    });
    assert.strictEqual(miss.length, 0);
});

test('renameCore: 문자열 참조 — 단일 식별자 리터럴은 전체 일치만', () => {
    const line = 'th = New Thread("Mod.SaveThread",, "SaveThread")';
    const hits = findStringLiteralRenameOccurrences(line, 'SaveThread', {
        kind: 'proc', containerName: 'Mod'
    });
    // "Mod.SaveThread"의 tail + 단독 "SaveThread" 둘 다
    assert.strictEqual(hits.length, 2);

    // 식별자 형태가 아닌 문자열(문장)은 이름이 포함돼도 제외
    const sentence = 'Console.WriteLine("SaveThread started at boot")';
    assert.strictEqual(
        findStringLiteralRenameOccurrences(sentence, 'SaveThread', { kind: 'proc' }).length,
        0
    );
});

test('renameCore: 문자열 참조 — container는 "Name.xxx"의 첫 세그먼트만', () => {
    const line = 'th = New Thread("DataFile.SaveThread")';
    const hit = findStringLiteralRenameOccurrences(line, 'DataFile', { kind: 'container' });
    assert.strictEqual(hit.length, 1);
    assert.strictEqual(line.substring(hit[0].character, hit[0].character + 'DataFile'.length), 'DataFile');

    // 단독 "DataFile" 리터럴은 컨테이너 참조로 보지 않는다 (F12도 점프하지 않는 형태)
    const bare = 'name = "DataFile"';
    assert.strictEqual(
        findStringLiteralRenameOccurrences(bare, 'DataFile', { kind: 'container' }).length,
        0
    );
});

test('renameCore: 문자열 참조 — 주석 안의 문자열은 제외', () => {
    const line = "' th = New Thread(\"DataFile.SaveThread\")";
    assert.strictEqual(
        findStringLiteralRenameOccurrences(line, 'SaveThread', {
            kind: 'proc', containerName: 'DataFile'
        }).length,
        0
    );
});

// ── 선언 줄 이름 컬럼 확정 / 편집 전 검증 ────────────────────────────────

test('renameCore: isWordAt — 단어 경계까지 확인', () => {
    const line = '    Public count As Integer';
    assert.strictEqual(isWordAt(line, 11, 'count'), true);
    assert.strictEqual(isWordAt(line, 11, 'COUNT'), true, '대소문자 무시');
    assert.strictEqual(isWordAt(line, 0, 'count'), false, '들여쓰기 공백 자리');
    assert.strictEqual(isWordAt('counter = 1', 0, 'count'), false, '부분 문자열 거부');
    assert.strictEqual(isWordAt(line, -1, 'count'), false);
    assert.strictEqual(isWordAt(line, 200, 'count'), false, '줄 밖');
});

test('renameCore: 선언 줄 이름 컬럼 — hint가 맞으면 그대로', () => {
    const line = '    Public count As Integer';
    assert.strictEqual(resolveDeclarationNameColumn(line, 'count', 11), 11);
});

test('renameCore: 선언 줄 이름 컬럼 — hint가 틀리면(줄 전체 range 시절 값 0) 실제 위치로 보정', () => {
    const line = '    Public count As Integer';
    // 종전 파서는 변수/상수/Property/Type의 range를 "줄 전체(start=0)"로 넣었다.
    // 그 값을 그대로 쓰면 선언 줄 앞부분("    P")을 덮어써 코드가 깨진다.
    assert.strictEqual(resolveDeclarationNameColumn(line, 'count', 0), 11);
    assert.strictEqual(resolveDeclarationNameColumn(line, 'count', -1), 11);
});

test('renameCore: 선언 줄에 이름이 없으면 -1 (이름 바꾸기 중단 신호)', () => {
    assert.strictEqual(resolveDeclarationNameColumn('    Public other As Integer', 'count', 0), -1);
    // 주석 안의 이름은 선언 위치가 아니다
    assert.strictEqual(resolveDeclarationNameColumn("    ' count 설명", 'count', 0), -1);
});

// ── isInCommentOrString 이동 회귀 (config → cursorExpression) ─────────────

test('cursorExpression: isInCommentOrString 정본 이동 후 동작 유지', () => {
    assert.strictEqual(isInCommentOrString("x = 1 ' comment", 10), true);
    assert.strictEqual(isInCommentOrString('s = "abc"', 6), true);
    assert.strictEqual(isInCommentOrString('s = "abc" & d', 12), false);
    assert.strictEqual(isInCommentOrString("s = \"it's\" & d", 12), false); // 문자열 속 아포스트로피
});
