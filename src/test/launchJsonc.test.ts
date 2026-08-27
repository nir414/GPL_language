import * as assert from 'assert';
import { test } from './harness';
import { describeJsoncErrors, detectFormatting, parseJsonc, upsertLaunchConfiguration } from '../launchJsonc';

const GPL = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    type: 'brooks-gpl',
    request: 'attach',
    controllerIp: '192.168.0.1',
    controllerPort: 1402,
    projectName: 'MergeCode',
    deployBeforeAttach: true,
    stopOnEntry: false,
    ...extra,
});

test('launchJsonc: 주석·trailing comma·줄 끝 주석이 있는 launch.json 을 파싱한다 (GitHub #30 재현 입력)', () => {
    const text = [
        '{',
        '  // GPL 디버깅 구성',
        '  "version": "0.2.0", // 버전',
        '  /* 블록 주석 "안의 따옴표" */',
        '  "configurations": [',
        '    { "name": "A", "type": "brooks-gpl", "request": "attach", "controllerIp": "${config:gpl.controller.ip}", },',
        '  ],',
        '}',
    ].join('\n');
    const { value, errors } = parseJsonc<{ version: string; configurations: Array<{ name: string; controllerIp: string }> }>(text);
    assert.strictEqual(errors.length, 0, describeJsoncErrors(text, errors));
    assert.strictEqual(value!.version, '0.2.0');
    assert.strictEqual(value!.configurations[0].controllerIp, '${config:gpl.controller.ip}');
});

test('launchJsonc: 문자열 안의 /* 와 // 는 주석으로 오인하지 않는다 (정규식 제거 방식의 취약점)', () => {
    const text = '{ "configurations": [ { "name": "x", "note": "a /* not comment */ b // not comment", "type": "brooks-gpl" } ] }';
    const { value, errors } = parseJsonc<{ configurations: Array<{ note: string }> }>(text);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(value!.configurations[0].note, 'a /* not comment */ b // not comment');
});

test('launchJsonc: 파싱 오류는 1-based 줄/열로 설명한다', () => {
    const text = '{\n  "version": "0.2.0"\n  "configurations": []\n}';
    const { errors } = parseJsonc(text);
    assert.ok(errors.length > 0);
    const desc = describeJsoncErrors(text, errors);
    assert.ok(/^3행 3열: /.test(desc), desc);
});

test('launchJsonc: detectFormatting — 공백 2칸·CRLF / 탭 / 판단 불가 기본값', () => {
    assert.deepStrictEqual(detectFormatting('{\r\n  "a": 1\r\n}'), { insertSpaces: true, tabSize: 2, eol: '\r\n' });
    assert.deepStrictEqual(detectFormatting('{\n\t"a": 1\n}'), { insertSpaces: false, tabSize: 4, eol: '\n' });
    assert.deepStrictEqual(detectFormatting('{}'), { insertSpaces: true, tabSize: 4, eol: '\n' });
});

test('launchJsonc: upsert — 다른 구성·최상위 주석·${config} 참조·들여쓰기를 보존하며 같은 name 항목만 교체한다', () => {
    const text = [
        '{',
        '    // 사용자가 손으로 관리하는 파일',
        '    "version": "0.2.0",',
        '    "configurations": [',
        '        {',
        '            "name": "Attach only (fast)",',
        '            "type": "brooks-gpl",',
        '            "request": "attach",',
        '            "controllerIp": "${config:gpl.controller.ip}", // 설정 참조',
        '            "deployBeforeAttach": false',
        '        },',
        '        {',
        '            "name": "GPL: Attach (MergeCode)",',
        '            "type": "brooks-gpl",',
        '            "request": "attach",',
        '            "controllerIp": "10.0.0.9"',
        '        }',
        '    ]',
        '}',
        '',
    ].join('\n');
    const r = upsertLaunchConfiguration(text, GPL('GPL: Attach (MergeCode)'));
    assert.strictEqual(r.action, 'replaced');
    assert.strictEqual(r.index, 1);
    assert.ok(r.text.includes('// 사용자가 손으로 관리하는 파일'), '최상위 주석 보존');
    assert.ok(r.text.includes('"controllerIp": "${config:gpl.controller.ip}", // 설정 참조'), '다른 구성의 주석·참조 보존');
    assert.ok(!r.text.includes('10.0.0.9'), '같은 name 항목은 교체됨');
    const parsed = parseJsonc<{ configurations: Array<Record<string, unknown>> }>(r.text);
    assert.strictEqual(parsed.errors.length, 0);
    assert.strictEqual(parsed.value!.configurations.length, 2);
    assert.strictEqual(parsed.value!.configurations[1].controllerIp, '192.168.0.1');
    assert.strictEqual(parsed.value!.configurations[1].stopOnEntry, false);
    assert.ok(/\n {12}"controllerIp": "192\.168\.0\.1"/.test(r.text), '기존 4칸 들여쓰기 유지');
});

test('launchJsonc: upsert — name 이 없으면 configurations 끝에 추가(trailing comma 파일 포함)', () => {
    const text = '{\n  "version": "0.2.0",\n  "configurations": [\n    { "name": "Other", "type": "node", },\n  ],\n}\n';
    const r = upsertLaunchConfiguration(text, GPL('GPL: Attach (MergeCode) — Stop on Entry', { stopOnEntry: true }));
    assert.strictEqual(r.action, 'inserted');
    assert.strictEqual(r.index, 1);
    const parsed = parseJsonc<{ configurations: Array<Record<string, unknown>> }>(r.text);
    assert.strictEqual(parsed.errors.length, 0, describeJsoncErrors(r.text, parsed.errors));
    assert.strictEqual(parsed.value!.configurations.length, 2);
    assert.strictEqual(parsed.value!.configurations[0].name, 'Other');
    assert.strictEqual(parsed.value!.configurations[1].stopOnEntry, true);
});

test('launchJsonc: upsert — 빈 파일은 골격 생성, configurations 누락 파일은 배열을 만들어 추가', () => {
    const created = upsertLaunchConfiguration('', GPL('A'));
    assert.strictEqual(created.action, 'created');
    const p1 = parseJsonc<{ version: string; configurations: unknown[] }>(created.text);
    assert.strictEqual(p1.errors.length, 0);
    assert.strictEqual(p1.value!.version, '0.2.0');
    assert.strictEqual(p1.value!.configurations.length, 1);

    const noConfigs = upsertLaunchConfiguration('{\n  // 아직 구성 없음\n  "version": "0.2.0"\n}\n', GPL('B'));
    assert.strictEqual(noConfigs.action, 'inserted');
    assert.ok(noConfigs.text.includes('// 아직 구성 없음'));
    const p2 = parseJsonc<{ configurations: Array<{ name: string }> }>(noConfigs.text);
    assert.strictEqual(p2.errors.length, 0, describeJsoncErrors(noConfigs.text, p2.errors));
    assert.strictEqual(p2.value!.configurations[0].name, 'B');
});

test('launchJsonc: upsert — 파싱 오류 파일은 줄/열이 담긴 예외를 던지고 파일을 건드리지 않는다', () => {
    assert.throws(
        () => upsertLaunchConfiguration('{\n  "version": "0.2.0"\n  "configurations": []\n}', GPL('A')),
        /launch\.json 파싱 실패: 3행 3열/,
    );
});
