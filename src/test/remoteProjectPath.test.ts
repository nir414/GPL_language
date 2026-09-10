import * as assert from 'assert';
import { test } from './harness';
import { describeRemotePathCandidates, resolveRemoteProjectPath } from '../controller/remoteProjectPath';

const FLASH = '/flash/projects';
const GPL = '/GPL';

/** 주어진 기준 경로에만 프로젝트 폴더가 있는 가짜 원격. */
function listDirWith(existsIn: string[], name = 'MergeCode') {
    return async (basePath: string) => existsIn.includes(basePath)
        ? [{ name, isDirectory: true }, { name: 'other', isDirectory: true }]
        : [{ name: 'other', isDirectory: true }];
}

test('remoteProjectPath: 존재하는 폴더가 존재하지 않는 폴더를 이긴다(없는 경로로 Load 하면 실패한다)', async () => {
    const choice = await resolveRemoteProjectPath({
        projectFolderName: 'MergeCode',
        flashBasePath: FLASH,
        gplBasePath: GPL,
        listDir: listDirWith([GPL]),
    });
    assert.strictEqual(choice.projectPath, '/GPL/MergeCode');
});

test('remoteProjectPath: 존재 여부가 같으면 flash 영구 사본을 우선한다', async () => {
    const both = await resolveRemoteProjectPath({
        projectFolderName: 'MergeCode',
        flashBasePath: FLASH,
        gplBasePath: GPL,
        listDir: listDirWith([FLASH, GPL]),
    });
    assert.strictEqual(both.projectPath, '/flash/projects/MergeCode');

    const neither = await resolveRemoteProjectPath({
        projectFolderName: 'MergeCode',
        flashBasePath: FLASH,
        gplBasePath: GPL,
        listDir: listDirWith([]),
    });
    assert.strictEqual(neither.projectPath, '/flash/projects/MergeCode');
});

test('remoteProjectPath: 옛 배포 구현의 순서(flash-exists > gpl-exists > flash-없음 > gpl-없음)를 그대로 재현한다', async () => {
    const order = async (existsIn: string[]): Promise<string[]> => {
        const c = await resolveRemoteProjectPath({
            projectFolderName: 'P', flashBasePath: FLASH, gplBasePath: GPL, listDir: listDirWith(existsIn, 'P'),
        });
        return c.candidates.map(x => x.projectPath);
    };
    assert.deepStrictEqual(await order([FLASH, GPL]), ['/flash/projects/P', '/GPL/P']);
    assert.deepStrictEqual(await order([GPL]), ['/GPL/P', '/flash/projects/P']);
    assert.deepStrictEqual(await order([]), ['/flash/projects/P', '/GPL/P']);
});

test('remoteProjectPath: 고른 경로 가점은 같은 등급 안에서만 작동한다 — flash·존재 가점을 뒤집지 못한다', async () => {
    // 셋 다 없음: flash(80) > 고른 /user/custom(20) > /GPL(0). 고른 경로는 같은 등급(0점)끼리만 이긴다.
    const ranked = await resolveRemoteProjectPath({
        projectFolderName: 'P', flashBasePath: FLASH, gplBasePath: GPL,
        extraBasePaths: ['/user/custom'], selectedPath: '/user/custom/P',
        listDir: listDirWith([], 'P'),
    });
    assert.deepStrictEqual(ranked.candidates.map(c => c.projectPath),
        ['/flash/projects/P', '/user/custom/P', '/GPL/P']);

    // 그래서 고른 경로와 다른 곳이 뽑힐 수 있다 — 그 사실을 switched 로 알려 로그에 남긴다.
    const beaten = await resolveRemoteProjectPath({
        projectFolderName: 'P', flashBasePath: FLASH, gplBasePath: GPL,
        selectedPath: '/GPL/P', listDir: listDirWith([FLASH], 'P'),
    });
    assert.strictEqual(beaten.projectPath, '/flash/projects/P');
    assert.strictEqual(beaten.switched, true);
});

test('remoteProjectPath: 추가 기준 경로(고른 노드의 상위 폴더)도 후보가 된다', async () => {
    const choice = await resolveRemoteProjectPath({
        projectFolderName: 'P', flashBasePath: FLASH, gplBasePath: GPL,
        extraBasePaths: ['/user/custom'], selectedPath: '/user/custom/P',
        listDir: listDirWith(['/user/custom'], 'P'),
    });
    assert.strictEqual(choice.projectPath, '/user/custom/P');
    assert.strictEqual(choice.candidates.length, 3);
});

test('remoteProjectPath: 목록 조회 실패는 "없음"이 아니라 "확인 못 함" — 후보에서 빼지 않는다', async () => {
    const choice = await resolveRemoteProjectPath({
        projectFolderName: 'P', flashBasePath: FLASH, gplBasePath: GPL,
        listDir: async () => { throw new Error('ftp down'); },
    });
    assert.strictEqual(choice.candidates.length, 2);
    assert.deepStrictEqual(choice.candidates.map(c => c.exists), [false, false]);
    assert.strictEqual(choice.projectPath, '/flash/projects/P');
});

test('remoteProjectPath: 뒤쪽 슬래시·대소문자 차이를 흡수한다', async () => {
    const choice = await resolveRemoteProjectPath({
        projectFolderName: 'MergeCode',
        flashBasePath: '/flash/projects/',
        gplBasePath: '/GPL/',
        listDir: async () => [{ name: 'mergecode', isDirectory: true }],
    });
    assert.strictEqual(choice.projectPath, '/flash/projects/MergeCode');
    assert.strictEqual(choice.candidates[0].exists, true);
});

test('remoteProjectPath: 후보 설명 줄은 존재 표시를 붙인다', async () => {
    const choice = await resolveRemoteProjectPath({
        projectFolderName: 'P', flashBasePath: FLASH, gplBasePath: GPL, listDir: listDirWith([GPL], 'P'),
    });
    assert.deepStrictEqual(describeRemotePathCandidates(choice.candidates), ['/GPL/P (exists)', '/flash/projects/P']);
});
