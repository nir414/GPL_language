import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import {
    describeGprCandidates, localCompileUnitSources, localFileFor, pickLocalProject, remoteProjectLocation, sameSourceText,
} from '../../../project/remote/remoteSourceMapping';

test('remoteSourceMapping: 루트 바로 아래 폴더가 프로젝트, 나머지가 상대 경로', () => {
    assert.deepStrictEqual(remoteProjectLocation('/GPL', '/GPL/Lib/Motion/Cmd/MotionCmd.gpl'), { projectName: 'Lib', relative: 'Motion/Cmd/MotionCmd.gpl' });
    assert.deepStrictEqual(remoteProjectLocation('/GPL', '/GPL/App'), { projectName: 'App', relative: '' });
    assert.deepStrictEqual(remoteProjectLocation('/flash/projects/', '/flash/projects/App/Main.gpl'), { projectName: 'App', relative: 'Main.gpl' });
    assert.strictEqual(remoteProjectLocation('/GPL', '/GPL'), undefined);
    assert.strictEqual(remoteProjectLocation('/GPL', '/flash/projects/App/Main.gpl'), undefined);
    assert.strictEqual(localFileFor('C:\\work\\V2\\Lib', 'Motion/Cmd/MotionCmd.gpl'), path.join('C:\\work\\V2\\Lib', 'Motion', 'Cmd', 'MotionCmd.gpl'));
});

test('remoteSourceMapping: deploy record → ProjectName → 폴더 이름 순, 여럿이면 고르지 않는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-remote-map-'));
    try {
        const mk = (dir: string, name?: string) => {
            fs.mkdirSync(path.join(root, dir), { recursive: true });
            const gpr = path.join(root, dir, 'Project.gpr');
            fs.writeFileSync(gpr, name ? `ProjectName="${name}"\nProjectSource="Main.gpl"\n` : 'ProjectSource="Main.gpl"\n');
            return gpr;
        };
        const recorded = mk('record/Lib', 'Lib');
        const named = mk('task34/Lib', 'Lib');
        const folderOnly = mk('task37/Lib');
        const other = mk('task37/Other', 'Other');
        const candidates = describeGprCandidates([named, folderOnly, other]);
        assert.deepStrictEqual(candidates.map(c => c.projectName), ['Lib', undefined, 'Other']);

        const viaRecord = pickLocalProject('Lib', candidates, path.dirname(recorded));
        assert.deepStrictEqual(viaRecord, { projectDir: path.dirname(recorded), gprPath: recorded, via: 'deploy-record' });
        const viaName = pickLocalProject('lib', candidates, path.join(root, 'missing'));
        assert.deepStrictEqual(viaName, { projectDir: path.dirname(named), gprPath: named, via: 'project-name' });
        const viaFolder = pickLocalProject('Lib', [candidates[1], candidates[2]]);
        assert.deepStrictEqual(viaFolder, { projectDir: path.dirname(folderOnly), gprPath: folderOnly, via: 'folder-name' });
        assert.strictEqual(pickLocalProject('Lib', [candidates[0], { gprPath: mk('task38/Lib', 'Lib'), projectName: 'Lib' }]), undefined, 'ProjectName 이 둘이면 모름');
        assert.strictEqual(pickLocalProject('Nope', candidates), undefined);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('remoteSourceMapping: 컴파일 단위 소스는 자기 소스 + 라이브러리 프로젝트 소스', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-remote-unit-'));
    try {
        fs.mkdirSync(path.join(root, 'App'), { recursive: true });
        fs.mkdirSync(path.join(root, 'Lib', 'Motion'), { recursive: true });
        fs.writeFileSync(path.join(root, 'App', 'Project.gpr'), 'ProjectName="App"\nProjectSource="Main.gpl"\nProjectLibrary="..\\Lib"\n');
        fs.writeFileSync(path.join(root, 'App', 'Main.gpl'), 'Module Main\nEnd Module\n');
        fs.writeFileSync(path.join(root, 'Lib', 'Project.gpr'), 'ProjectName="Lib"\nProjectSource="Motion\\Msc.gpl"\n');
        fs.writeFileSync(path.join(root, 'Lib', 'Motion', 'Msc.gpl'), 'Module MSC\nEnd Module\n');
        const sources = localCompileUnitSources(path.join(root, 'App', 'Project.gpr')).map(p => path.relative(root, p).split(path.sep).join('/')).sort();
        assert.deepStrictEqual(sources, ['App/Main.gpl', 'Lib/Motion/Msc.gpl']);
        assert.deepStrictEqual(localCompileUnitSources(path.join(root, 'none', 'Project.gpr')), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('remoteSourceMapping: 내용 비교는 줄바꿈·BOM·끝 공백 차이를 무시한다', () => {
    assert.ok(sameSourceText('\uFEFFModule A\r\n  x = 1  \r\nEnd Module\r\n', 'Module A\n  x = 1\nEnd Module'));
    assert.ok(!sameSourceText('Module A\nx = 1\nEnd Module', 'Module A\nx = 2\nEnd Module'));
});
