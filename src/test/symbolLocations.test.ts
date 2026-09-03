import * as assert from 'assert';
import * as path from 'path';
import { test } from './harness';
import { dedupeSymbolLocations, preferExistingFiles, isMissingFile, fileExists } from '../language/symbolLocations';
import { normalizePathKey, normalizeDirKey } from '../controller/projectPickerCore';

const at = (filePath: string, line: number) => ({ filePath, line } as any);

/** 플랫폼 절대 경로 — Windows/리눅스 양쪽에서 같은 의미가 되게 만든다. */
const abs = (...parts: string[]) => path.resolve(path.sep, ...parts);

test('normalizePathKey: 대소문자·구분자·`.`/`..`·끝 슬래시 차이를 같은 키로 본다', () => {
    const base = abs('proj', 'GPL_Code', 'LogFile.gpl');
    assert.strictEqual(normalizePathKey(base), normalizePathKey(base.toUpperCase()));
    assert.strictEqual(
        normalizePathKey(base),
        normalizePathKey(path.join(abs('proj'), 'GPL_Code', '.', 'sub', '..', 'LogFile.gpl'))
    );
    assert.strictEqual(normalizePathKey(abs('proj') + path.sep), normalizePathKey(abs('proj')));
    // 폴더용 이름은 같은 규칙의 별칭이다.
    assert.strictEqual(normalizeDirKey(base), normalizePathKey(base));
});

test('dedupeSymbolLocations: 같은 파일·줄은 첫 항목만 남기고 순서를 유지한다', () => {
    const disk = abs('proj', 'GPL_Code', 'LogFile.gpl');
    const shouty = disk.toUpperCase();
    const dotted = path.join(abs('proj'), 'GPL_Code', '.', 'LogFile.gpl');

    const out = dedupeSymbolLocations([at(disk, 79), at(shouty, 79), at(dotted, 79)]);

    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].filePath, disk, '먼저 온(랭킹이 높은) 표기가 남아야 한다');
});

test('dedupeSymbolLocations: 줄이 다르면 서로 다른 선언이므로 유지한다', () => {
    const file = abs('proj', 'Lib.gpl');
    const out = dedupeSymbolLocations([at(file, 10), at(file, 42), at(abs('proj', 'Other.gpl'), 10)]);
    assert.strictEqual(out.length, 3);
});

test('dedupeSymbolLocations: 후보 0·1개는 그대로 (복사본을 돌려준다)', () => {
    assert.deepStrictEqual(dedupeSymbolLocations([]), []);
    const one = [at(abs('proj', 'A.gpl'), 1)];
    const out = dedupeSymbolLocations(one);
    assert.strictEqual(out.length, 1);
    assert.notStrictEqual(out, one, '원본 배열을 그대로 넘기지 않는다');
});

test('preferExistingFiles: 사라진 파일의 잔류 후보를 뺀다', () => {
    const live = abs('proj', 'Live.gpl');
    const gone = abs('proj', 'Gone.gpl');

    const out = preferExistingFiles([at(gone, 5), at(live, 7)], p => p === live);

    assert.deepStrictEqual(out.map(s => s.filePath), [live]);
});

test('preferExistingFiles: 존재 확인은 정규화 키 기준이고 파일당 한 번만 한다', () => {
    const live = abs('proj', 'Live.gpl');
    const asked: string[] = [];
    const exists = (p: string) => { asked.push(p); return true; };

    preferExistingFiles([at(live, 5), at(live.toUpperCase(), 9)], exists);

    assert.strictEqual(asked.length, 1, '같은 파일을 두 번 확인하지 않는다');
});

test('preferExistingFiles: 전부 없으면 원본을 유지한다(정의 없음으로 퇴보 금지)', () => {
    const a = abs('proj', 'A.gpl');
    const b = abs('proj', 'B.gpl');

    const out = preferExistingFiles([at(a, 1), at(b, 2)], () => false);

    assert.deepStrictEqual(out.map(s => s.filePath), [a, b]);
});

test('preferExistingFiles: 후보가 하나면 확인 자체를 하지 않는다', () => {
    let calls = 0;
    const out = preferExistingFiles([at(abs('proj', 'Only.gpl'), 3)], () => { calls++; return false; });
    assert.strictEqual(calls, 0);
    assert.strictEqual(out.length, 1);
});

test('isMissingFile: 없는 경로는 없음, 있는 파일은 있음으로 본다', () => {
    assert.strictEqual(isMissingFile(__filename), false);
    assert.strictEqual(isMissingFile(path.join(__dirname, 'no-such-file-xyz.gpl')), true);
});

test('isMissingFile: ENOENT가 아닌 오류는 "없음"으로 보지 않는다 (확인 실패 ≠ 삭제)', () => {
    // 이 규칙이 깨지면 권한 오류·네트워크 드라이브 일시 장애만으로 인덱스에서 파일이 지워져
    // 정의가 통째로 사라진다. 오류 코드별로 못 박아 둔다.
    const throwing = (code: string) => () => {
        const e: NodeJS.ErrnoException = new Error(code);
        e.code = code;
        throw e;
    };

    assert.strictEqual(isMissingFile('x.gpl', throwing('ENOENT')), true);
    for (const code of ['EPERM', 'EACCES', 'EBUSY', 'ETIMEDOUT', 'ENOTDIR', 'EINVAL', 'EIO']) {
        assert.strictEqual(isMissingFile('x.gpl', throwing(code)), false, `${code}는 삭제가 아니다`);
    }
    // 코드가 없는 오류(정체 불명)도 "없음"으로 단정하지 않는다.
    assert.strictEqual(isMissingFile('x.gpl', () => { throw new Error('무슨 일인지 모른다'); }), false);
});

test('fileExists: isMissingFile의 반대이고 preferExistingFiles의 기본 probe로 쓸 수 있다', () => {
    const gone = path.join(__dirname, 'gone-xyz.gpl');
    const out = preferExistingFiles([at(gone, 1), at(__filename, 2)], fileExists);
    assert.deepStrictEqual(out.map(s => s.filePath), [__filename]);
});
