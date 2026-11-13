import * as assert from 'assert';
import * as path from 'path';
import { test } from '../../harness';
import { planLibraryUploads } from '../../../controller/deployment/libraryUploadPlan';

const P = path.resolve('/ws/projects');
const at = (...seg: string[]): string => path.join(P, ...seg);

test('libraryUploadPlan: 독립형 — projects 안 형제 라이브러리는 /GPL/<값> 으로, 프로젝트 폴더 안은 이미 포함', () => {
    const plan = planLibraryUploads({
        projectDir: at('Main'),
        refs: [
            { raw: 'Libraries', dir: at('Libraries') },
            { raw: 'Main\\Inner', dir: at('Main', 'Inner') },
            { raw: 'Common\\Util', dir: at('Common', 'Util') },
        ],
        remoteRoot: '/GPL',
    });
    assert.strictEqual(plan.embeddedIn, undefined);
    assert.deepStrictEqual(plan.uploads.map(u => [u.localDir, u.remoteDir]), [
        [at('Libraries'), '/GPL/Libraries'],
        [at('Common', 'Util'), '/GPL/Common/Util'],
    ]);
    assert.deepStrictEqual(plan.covered, [path.join('Main', 'Inner')]);
    assert.deepStrictEqual(plan.embedded, []);
});

test('libraryUploadPlan: 함께 올릴 라이브러리 안의 라이브러리는 한 번만(바깥 폴더 재귀 업로드에 포함), 중복 참조도 한 번', () => {
    const plan = planLibraryUploads({
        projectDir: at('Main'),
        refs: [
            { raw: 'Lib\\Core', dir: at('Lib', 'Core') },
            { raw: 'Lib', dir: at('Lib') },
            { raw: 'Lib', dir: at('Lib') },
        ],
        remoteRoot: '/GPL/',
    });
    assert.deepStrictEqual(plan.uploads.map(u => u.remoteDir), ['/GPL/Lib']);
    assert.deepStrictEqual(plan.covered, [path.join('Lib', 'Core')]);
});

test('libraryUploadPlan: 값이 projects 기준 경로가 아니거나 projects 밖이면 올리지 않고 사유를 남긴다, 미해석은 따로', () => {
    const plan = planLibraryUploads({
        projectDir: at('Main'),
        refs: [
            { raw: 'Libraries', dir: at('Vendor', 'Libraries') },      // 다른 기준(알려진 .gpr 폴백 등)으로 찾은 폴더
            { raw: 'Shared', dir: path.resolve('/elsewhere/Shared') },
            { raw: '..\\Up', dir: path.resolve('/ws/Up') },
            { raw: 'Missing' },
        ],
        remoteRoot: '/GPL',
    });
    assert.deepStrictEqual(plan.uploads, []);
    assert.deepStrictEqual(plan.skipped.map(s => s.raw), ['Libraries', 'Shared', '..\\Up']);
    assert.ok(plan.skipped[0].reason.includes('위치 불확실'));
    assert.ok(plan.skipped[1].reason.includes('projects 폴더 밖'));
    assert.deepStrictEqual(plan.unresolved, ['Missing']);
});

test('libraryUploadPlan: 내장형(BinderR4) — 리프 패키지의 라이브러리는 컴파일 루트 안이라 따로 올리지 않는다', () => {
    const root = at('BinderR4');
    const plan = planLibraryUploads({
        projectDir: path.join(root, 'Gantry', 'Data'),
        compileRootDir: root,
        refs: [
            { raw: 'Lib\\Core\\Text', dir: path.join(root, 'Lib', 'Core', 'Text') },
            { raw: 'Gantry\\Host', dir: path.join(root, 'Gantry', 'Host') },
            { raw: 'Libraries', dir: at('Libraries') },                // 루트 밖 형제는 독립형과 같은 규칙
        ],
        remoteRoot: '/GPL',
    });
    assert.strictEqual(plan.embeddedIn, root);
    assert.deepStrictEqual(plan.embedded, [path.join('BinderR4', 'Lib', 'Core', 'Text'), path.join('BinderR4', 'Gantry', 'Host')]);
    assert.deepStrictEqual(plan.uploads.map(u => u.remoteDir), ['/GPL/Libraries']);
});

test('libraryUploadPlan: 컴파일 루트 자신을 올리면 루트 안 라이브러리는 이미 포함(내장형 아님)', () => {
    const root = at('BinderR4');
    const plan = planLibraryUploads({
        projectDir: root,
        compileRootDir: root,
        refs: [{ raw: 'Lib', dir: path.join(root, 'Lib') }],
        remoteRoot: '/GPL',
    });
    assert.strictEqual(plan.embeddedIn, undefined);
    assert.deepStrictEqual(plan.covered, [path.join('BinderR4', 'Lib')]);
    assert.deepStrictEqual(plan.uploads, []);
});

test('libraryUploadPlan: 컴파일 루트가 프로젝트 위가 아니면(엉뚱한 경로) 독립형으로 본다', () => {
    const plan = planLibraryUploads({
        projectDir: at('Main'),
        compileRootDir: at('Other'),
        refs: [{ raw: 'Libraries', dir: at('Libraries') }],
        remoteRoot: '/GPL',
    });
    assert.strictEqual(plan.embeddedIn, undefined);
    assert.deepStrictEqual(plan.uploads.map(u => u.remoteDir), ['/GPL/Libraries']);
});
