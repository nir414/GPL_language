import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from '../../harness';
import {
    isPreprocessActive,
    preprocessUndefinedSymbolHint,
    resolvePreprocessOptions,
    rewriteGprWithout,
} from '../../../controller/deployment/deployPreprocess';
import { preparePreprocess, preprocessStageDir } from '../../../controller/deployment/deployPreprocessStage';
import type { DeployContext } from '../../../controller/deployment/deployContext';
import type { DeployProjectInfo } from '../../../controller/deployment/deployPrecheck';
import type { DeployTarget } from '../../../controller/deployment/deployTargetStage';
import { emptyDeployResult } from '../../../controller/deployment/deployTypes';
import { parseGpr } from '../../../controller/protocol/responseParser';
import { normalizePathKey } from '../../../util/pathKey';

test('deployPreprocess: 설정 해석 — 공통 < projects.<이름>(대소문자 무시) < 호출 인자, keepFiles 는 합침, false 는 끔', () => {
    const setting = {
        stripComments: true,
        keepFiles: ['Net_Log'],
        projects: { app: { excludeUnreachableLibraryFiles: true, keepFiles: ['FTL', 'net_log'] } },
    };
    const app = resolvePreprocessOptions(setting, 'App');
    assert.deepStrictEqual(app, { stripComments: true, trimWhitespace: false, excludeUnreachableLibraryFiles: true, removeUnusedMembers: false, keepFiles: ['Net_Log', 'FTL'] });
    const other = resolvePreprocessOptions(setting, 'Other', { trimWhitespace: true, stripComments: false });
    assert.deepStrictEqual(other, { stripComments: false, trimWhitespace: true, excludeUnreachableLibraryFiles: false, removeUnusedMembers: false, keepFiles: ['Net_Log'] });
    assert.strictEqual(isPreprocessActive(resolvePreprocessOptions(setting, 'App', false)), false);
    assert.strictEqual(isPreprocessActive(resolvePreprocessOptions(undefined, 'App')), false);
    assert.strictEqual(isPreprocessActive(resolvePreprocessOptions({ stripComments: 'yes', projects: [] }, 'App')), false, '모르는 모양은 무시');
});

test('deployPreprocess: .gpr 고쳐 쓰기 — 제외 파일의 ProjectSource 줄만 빼고 줄바꿈·끝 개행 유지', () => {
    const gpr = path.resolve('/ws/projects/PaL/Project.gpr');
    const text = 'ProjectName="PaL"\r\nProjectSource="Core\\Parse.gpl"\r\nProjectSource="Net/Client.gpl"\r\nProjectEnd\r\n';
    const out = rewriteGprWithout(gpr, text, new Set([normalizePathKey(path.resolve('/ws/projects/PaL/net/client.GPL'))]));
    assert.strictEqual(out, 'ProjectName="PaL"\r\nProjectSource="Core\\Parse.gpl"\r\nProjectEnd\r\n');
    assert.strictEqual(rewriteGprWithout(gpr, text, new Set()), undefined);
});

test('deployPreprocess: -729 안내 — 이름을 선언한 제외 파일을 짚고, 모르면 일반 안내, 제외가 없으면 없음', () => {
    const excluded = [{ remotePath: '/GPL/PaL/Net_Client.gpl', declared: ['ntc', 'connect'] }];
    assert.match(preprocessUndefinedSymbolHint('*Undefined symbol* NTC', excluded)!, /Net_Client\.gpl/);
    assert.match(preprocessUndefinedSymbolHint('*Undefined symbol* result', excluded)!, /1개를 뺐습니다/);
    assert.strictEqual(preprocessUndefinedSymbolHint('*Undefined symbol* NTC', []), undefined);
});

/** projects/App(ProjectStart, ProjectLibrary="PaL") + projects/PaL(라이브러리 4파일) 을 임시 폴더에 만든다. */
function makeWorkspace(): { projects: string; app: string; pal: string } {
    const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-pre-'));
    const app = path.join(projects, 'App');
    const pal = path.join(projects, 'PaL');
    fs.mkdirSync(app); fs.mkdirSync(pal); fs.mkdirSync(path.join(app, '.vscode'));
    const w = (file: string, text: string): void => fs.writeFileSync(file, text);
    w(path.join(app, 'Project.gpr'), 'ProjectName="App"\r\nProjectStart="Main"\r\nProjectSource="App.gpl"\r\nProjectLibrary="PaL"\r\nProjectEnd\r\n');
    w(path.join(app, 'App.gpl'), "' 앱 진입점\r\nModule App\r\n    Public Sub Main() ' 시작\r\n        PRA.ParseLine(\"x\")\r\n        Dim t As New Thread(\"FLR.RecorderLoop\", 1)\r\n    End Sub\r\nEnd Module\r\n");
    w(path.join(app, '.vscode', 'settings.json'), '{}');
    w(path.join(pal, 'Project.gpr'), 'ProjectName="PaL"\r\nProjectSource="Core_Parse.gpl"\r\nProjectSource="Flow_Recorder.gpl"\r\nProjectSource="Net_Client.gpl"\r\nProjectSource="Frame_Tool.gpl"\r\nProjectEnd\r\n');
    w(path.join(pal, 'Core_Parse.gpl'), 'Module PRA\r\n    Public Sub ParseLine(s As String) \' 파서\r\n    End Sub\r\nEnd Module\r\n');
    w(path.join(pal, 'Flow_Recorder.gpl'), 'Module FLR\r\n    Public Sub RecorderLoop()\r\n    End Sub\r\nEnd Module\r\n');
    w(path.join(pal, 'Net_Client.gpl'), 'Module NTC\r\n    Public Sub Connect()\r\n    End Sub\r\nEnd Module\r\n');
    w(path.join(pal, 'Frame_Tool.gpl'), 'Module FTL\r\n    Public Sub Offset()\r\n    End Sub\r\nEnd Module\r\n');
    w(path.join(pal, 'data.csv'), 'a,b\r\n');
    return { projects, app, pal };
}

function fakeContext(projectDir: string, setting: unknown, ip: string): DeployContext {
    const result = emptyDeployResult();
    return {
        options: { projectDir },
        cfg: { ip },
        result,
        pushTrace: (line: string) => result.trace.push(line),
        host: { readSourceExtensionsSetting: () => undefined, readPreprocessSetting: () => setting },
    } as unknown as DeployContext;
}

test('deployPreprocessStage: 사본에 주석 제거·미사용 제외·라이브러리 .gpr 고쳐 쓰기, 워크스페이스는 그대로', () => {
    const ws = makeWorkspace();
    const ip = '10.250.0.1';
    try {
        const gprPath = path.join(ws.app, 'Project.gpr');
        const gprText = fs.readFileSync(gprPath, 'utf8');
        const project: DeployProjectInfo = { gprPath, gprText, gprInfo: parseGpr(gprText), folderName: 'App', projectName: 'App' };
        const target = {
            directActive: true,
            ftpProjectDir: '/GPL/App',
            libraryPlan: { uploads: [{ raw: 'PaL', localDir: ws.pal, remoteDir: '/GPL/PaL' }], covered: [], embedded: [], skipped: [], unresolved: [] },
        } as unknown as DeployTarget;
        const ctx = fakeContext(ws.app, { projects: { App: { stripComments: true, excludeUnreachableLibraryFiles: true, keepFiles: ['FTL'] } } }, ip);
        const before = fs.readFileSync(path.join(ws.app, 'App.gpl'), 'utf8');

        const prepared = preparePreprocess(ctx, project, target)!;
        assert.ok(prepared, '사본을 만든다');
        const appStage = prepared.uploadDirFor(ws.app);
        const palStage = prepared.uploadDirFor(ws.pal);
        assert.strictEqual(appStage, preprocessStageDir(ip, '/GPL/App'));
        assert.ok(!normalizePathKey(appStage).startsWith(normalizePathKey(ws.projects)), '사본은 워크스페이스 밖');

        const stagedApp = fs.readFileSync(path.join(appStage, 'App.gpl'), 'utf8');
        assert.strictEqual(stagedApp, '\r\nModule App\r\n    Public Sub Main()\r\n        PRA.ParseLine("x")\r\n        Dim t As New Thread("FLR.RecorderLoop", 1)\r\n    End Sub\r\nEnd Module\r\n');
        assert.strictEqual(stagedApp.split('\r\n').length, before.split('\r\n').length, '줄 수 유지');
        assert.ok(!fs.existsSync(path.join(appStage, '.vscode')), '점 폴더는 올리지 않는다(ftpClient 와 같은 규칙)');

        // 닿는 파일: PRA(코드)·FLR(문자열 진입점)·FTL(keepFiles). 빠지는 파일: NTC.
        assert.ok(!fs.existsSync(path.join(palStage, 'Net_Client.gpl')));
        for (const f of ['Core_Parse.gpl', 'Flow_Recorder.gpl', 'Frame_Tool.gpl', 'data.csv']) {
            assert.ok(fs.existsSync(path.join(palStage, f)), f);
        }
        assert.strictEqual(fs.readFileSync(path.join(palStage, 'Project.gpr'), 'utf8'),
            'ProjectName="PaL"\r\nProjectSource="Core_Parse.gpl"\r\nProjectSource="Flow_Recorder.gpl"\r\nProjectSource="Frame_Tool.gpl"\r\nProjectEnd\r\n');

        const s = ctx.result.preprocess!;
        assert.strictEqual(s.applied, true);
        assert.deepStrictEqual(s.excluded.map(e => e.remotePath), ['/GPL/PaL/Net_Client.gpl']);
        assert.deepStrictEqual(s.rewrittenGpr, ['/GPL/PaL/Project.gpr']);
        assert.ok(s.savedBytes > 0 && s.sourceBytesAfter < s.sourceBytesBefore);
        assert.ok(prepared.isExcludedRemote('/gpl/pal/net_client.gpl'));

        // 예전 업로드로 남은 제외 파일 — 동기화 기록에 있는 것만 지울 대상.
        const refs = prepared.staleExcludedRefs('/GPL/PaL', { 'net_client.gpl': { size: 1, sha1: '' }, 'core_parse.gpl': { size: 1, sha1: '' } });
        assert.deepStrictEqual(refs, [{ remotePath: '/GPL/PaL/Net_Client.gpl', relativePath: 'net_client.gpl' }]);
        assert.deepStrictEqual(prepared.staleExcludedRefs('/GPL/PaL', {}), []);

        // 증적: 원본을 같은 규칙으로 전처리한 지문 = 사본 지문, 제외 파일은 없음.
        const snap = prepared.snapshot(ws.pal);
        assert.ok(!('Net_Client.gpl' in snap));
        assert.strictEqual(snap['Project.gpr'].size, fs.statSync(path.join(palStage, 'Project.gpr')).size);

        assert.strictEqual(fs.readFileSync(path.join(ws.app, 'App.gpl'), 'utf8'), before, '원본은 그대로');
        assert.ok(fs.readFileSync(path.join(ws.pal, 'Project.gpr'), 'utf8').includes('Net_Client.gpl'), '로컬 .gpr 그대로');
    } finally {
        fs.rmSync(ws.projects, { recursive: true, force: true });
        fs.rmSync(preprocessStageDir(ip, ''), { recursive: true, force: true });
    }
});

test('deployPreprocessStage: 꺼져 있으면 아무 기록도 없고, 클래식 경로는 원본을 올린다고 남긴다', () => {
    const ws = makeWorkspace();
    try {
        const gprPath = path.join(ws.app, 'Project.gpr');
        const gprText = fs.readFileSync(gprPath, 'utf8');
        const project: DeployProjectInfo = { gprPath, gprText, gprInfo: parseGpr(gprText), folderName: 'App', projectName: 'App' };
        const off = fakeContext(ws.app, {}, '10.250.0.2');
        assert.strictEqual(preparePreprocess(off, project, { directActive: true, ftpProjectDir: '/GPL/App' } as DeployTarget), undefined);
        assert.strictEqual(off.result.preprocess, undefined);

        const classic = fakeContext(ws.app, { stripComments: true }, '10.250.0.2');
        assert.strictEqual(preparePreprocess(classic, project, { directActive: false, ftpProjectDir: '/flash/projects/App' } as DeployTarget), undefined);
        assert.strictEqual(classic.result.preprocess?.applied, false);
        assert.match(classic.result.preprocess!.note!, /클래식/);
    } finally {
        fs.rmSync(ws.projects, { recursive: true, force: true });
    }
});

test('deployPreprocessStage: removeUnusedMembers — 라이브러리 안의 안 쓰는 선언을 빈 줄로(줄 수 유지), 앱 파일은 그대로, -729 안내에 선언이 잡힌다', () => {
    const ws = makeWorkspace();
    const ip = '10.250.0.3';
    try {
        fs.writeFileSync(path.join(ws.pal, 'Core_Parse.gpl'),
            'Module PRA\r\n    Public Sub ParseLine(s As String)\r\n    End Sub\r\n    Public Sub Dead()\r\n        Dim x As Integer\r\n    End Sub\r\nEnd Module\r\n');
        const gprPath = path.join(ws.app, 'Project.gpr');
        const gprText = fs.readFileSync(gprPath, 'utf8');
        const project: DeployProjectInfo = { gprPath, gprText, gprInfo: parseGpr(gprText), folderName: 'App', projectName: 'App' };
        const target = {
            directActive: true,
            ftpProjectDir: '/GPL/App',
            libraryPlan: { uploads: [{ raw: 'PaL', localDir: ws.pal, remoteDir: '/GPL/PaL' }], covered: [], embedded: [], skipped: [], unresolved: [] },
        } as unknown as DeployTarget;
        const ctx = fakeContext(ws.app, { removeUnusedMembers: true, keepFiles: ['FTL.Offset'] }, ip);
        const prepared = preparePreprocess(ctx, project, target)!;
        const staged = fs.readFileSync(path.join(prepared.uploadDirFor(ws.pal), 'Core_Parse.gpl'), 'utf8');
        assert.strictEqual(staged, 'Module PRA\r\n    Public Sub ParseLine(s As String)\r\n    End Sub\r\n\r\n\r\n\r\nEnd Module\r\n');
        // Net_Client(NTC) 은 파일 제외가 꺼져 있으니 선언 단위로 비워진다. Frame_Tool 의 Offset 은 keep.
        const ntc = fs.readFileSync(path.join(prepared.uploadDirFor(ws.pal), 'Net_Client.gpl'), 'utf8');
        assert.strictEqual(ntc, 'Module NTC\r\n\r\n\r\nEnd Module\r\n');
        assert.ok(fs.readFileSync(path.join(prepared.uploadDirFor(ws.pal), 'Frame_Tool.gpl'), 'utf8').includes('Offset'));
        assert.strictEqual(fs.readFileSync(path.join(prepared.uploadDirFor(ws.app), 'App.gpl'), 'utf8'), fs.readFileSync(path.join(ws.app, 'App.gpl'), 'utf8'));
        const s = ctx.result.preprocess!;
        assert.strictEqual(s.removedMemberCount, 2);
        assert.deepStrictEqual(s.removedMembers!.map(m => `${m.container}.${m.name}`).sort(), ['pra.Dead', 'ntc.Connect'].sort());
        assert.match(preprocessUndefinedSymbolHint('*Undefined symbol* Connect', prepared.hintEntries)!, /Net_Client\.gpl:2 \(ntc\.Connect\)/);
    } finally {
        fs.rmSync(ws.projects, { recursive: true, force: true });
        fs.rmSync(preprocessStageDir(ip, ''), { recursive: true, force: true });
    }
});
