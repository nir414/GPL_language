import * as assert from 'assert';
import { test } from '../../harness';
import { classifyRemoteClearRoot, judgeAiClearThreadGate, selectRemoteClearTargets } from '../../../controller/files/remoteFolderClear';
import type { FtpEntry } from '../../../controller/files/ftpClient';

// /GPL 비우기(사람의 트리 명령 + AI 의 clear_remote_folder)가 같이 쓰는 대상 판정 — 2026-10-21.

const CFG = { gplBasePath: '/GPL', flashBasePath: '/flash/projects' };

test('classifyRemoteClearRoot: 설정된 /GPL 만 gpl, flash 와 그 하위는 flash', () => {
    assert.strictEqual(classifyRemoteClearRoot('/GPL', CFG), 'gpl');
    assert.strictEqual(classifyRemoteClearRoot('/gpl/', CFG), 'gpl');
    assert.strictEqual(classifyRemoteClearRoot('/flash/projects', CFG), 'flash');
    assert.strictEqual(classifyRemoteClearRoot('/flash/projects/Lib', CFG), 'flash');
    assert.strictEqual(classifyRemoteClearRoot('/flash', CFG), 'flash');
    assert.strictEqual(classifyRemoteClearRoot('/FLASH/data', CFG), 'flash');
});

test('classifyRemoteClearRoot: 루트·빈 경로는 unsafe, 그 밖의 경로(하위 폴더 포함)는 other', () => {
    assert.strictEqual(classifyRemoteClearRoot('', CFG), 'unsafe');
    assert.strictEqual(classifyRemoteClearRoot('/', CFG), 'unsafe');
    assert.strictEqual(classifyRemoteClearRoot('/GPL/Lib', CFG), 'other');
    assert.strictEqual(classifyRemoteClearRoot('/data', CFG), 'other');
});

function entry(name: string, isDirectory = true): FtpEntry {
    return { name, isDirectory, size: 0 } as FtpEntry;
}

test('selectRemoteClearTargets: names 가 없으면 . / .. 를 뺀 전부', () => {
    const r = selectRemoteClearTargets([entry('.'), entry('..'), entry('Lib'), entry('a.txt', false)]);
    assert.deepStrictEqual(r.targets.map(e => e.name), ['Lib', 'a.txt']);
    assert.deepStrictEqual(r.missing, []);
});

test('selectRemoteClearTargets: names 는 대소문자 무시로 고르고, 없는 이름은 missing 으로 돌려준다', () => {
    const r = selectRemoteClearTargets([entry('Lib'), entry('COM_Probe'), entry('New')], ['lib', 'com_probe', 'Gone']);
    assert.deepStrictEqual(r.targets.map(e => e.name), ['Lib', 'COM_Probe']);
    assert.deepStrictEqual(r.missing, ['Gone']);
});

test('selectRemoteClearTargets: 빈 names 는 아무것도 고르지 않는다(전부 지우기로 해석하지 않음)', () => {
    const r = selectRemoteClearTargets([entry('Lib')], []);
    assert.deepStrictEqual(r.targets, []);
});

// ── AI 비우기 쓰레드 게이트: stop_threads 와 같은 정착 판정 (2026-11-05) ─────────────────────

test('judgeAiClearThreadGate: Idle/Stopped/Error 만 남았으면 진행하고 남은 쓰레드를 알려 준다', () => {
    const g = judgeAiClearThreadGate([
        { name: 'App', state: 'Idle', project: 'App' },
        { name: 'TCPCLI_0', state: 'Idle' },
        { name: '_Cmd_App', state: 'Stopped' },
        { name: 'Probe', state: 'Error' },
    ]);
    assert.strictEqual(g.proceed, true);
    assert.deepStrictEqual(g.settledRemaining.map(t => t.name), ['App', 'TCPCLI_0', '_Cmd_App', 'Probe']);
});

test('judgeAiClearThreadGate: 빈 목록은 진행', () => {
    const g = judgeAiClearThreadGate([]);
    assert.strictEqual(g.proceed, true);
});

test('judgeAiClearThreadGate: Running·Paused·Break·Stopping 은 막고 전체 목록과 recommendedAction 을 돌려준다', () => {
    for (const state of ['Running', 'Paused', 'Break', 'Stopping']) {
        const g = judgeAiClearThreadGate([
            { name: 'App', state, project: 'App' },
            { name: 'TCPCLI_0', state: 'Idle' },
        ]);
        assert.strictEqual(g.proceed, false, state);
        if (g.proceed) { continue; }
        assert.deepStrictEqual(g.active.map(t => t.name), ['App']);
        assert.deepStrictEqual(g.settledRemaining.map(t => t.name), ['TCPCLI_0']);
        assert.deepStrictEqual(g.threads.map(t => t.name), ['App', 'TCPCLI_0']);
        assert.match(g.recommendedAction, /stop_threads\(\{ project: "App" \}\)/);
        assert.match(g.recommendedAction, /unload_project\(\{ project: "App" \}\)/);
        assert.match(g.detail, /App\(/);
    }
});

test('judgeAiClearThreadGate: 상태 대소문자·공백을 무시한다', () => {
    assert.strictEqual(judgeAiClearThreadGate([{ name: 'a', state: ' idle ' }]).proceed, true);
    assert.strictEqual(judgeAiClearThreadGate([{ name: 'a', state: 'RUNNING' }]).proceed, false);
});
