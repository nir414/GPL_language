import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { SymbolIndex } from '../language/symbols/symbolIndex';
import { test } from './harness';

/** VS Code 경계만 대체하고 실제 Hover·수신자 해석·심볼 인덱스를 실행한다. */
function setup(expression = 'axes = table.AxisCount()') {
    class Range {
        start: { line: number; character: number };
        end: { line: number; character: number };
        constructor(startLine: number, start: number, endLine: number, end: number) {
            this.start = { line: startLine, character: start };
            this.end = { line: endLine, character: end };
        }
    }
    const lines = [
        'Module RPF',
        'Public Dim table As String',
        'Public Function ReadTable(ByVal table As JointPoseTable) As Integer',
        'Dim axes As Integer',
        'Dim tables() As JointPoseTable',
        expression,
        'End Function',
        'End Module',
    ];
    const document = {
        uri: { fsPath: 'PoseFile.gpl', toString: () => 'file:///PoseFile.gpl' },
        version: 1,
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] }),
        getText: (range?: Range) => range
            ? lines[range.start.line].slice(range.start.character, range.end.character) : lines.join('\n'),
        getWordRangeAtPosition: (position: { line: number; character: number }, pattern: RegExp) => {
            for (const match of lines[position.line].matchAll(new RegExp(pattern.source, 'g'))) {
                if (position.character >= match.index! && position.character <= match.index! + match[0].length) {
                    return new Range(position.line, match.index!, position.line, match.index! + match[0].length);
                }
            }
            return undefined;
        },
    };
    const vscode = {
        workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        debug: {},
        Range,
        MarkdownString: class {
            value = '';
            appendMarkdown(value: string) { this.value += value; }
            appendCodeblock(value: string) { this.value += `\n${value}\n`; }
        },
        Hover: class { constructor(public contents: any, public range: Range) {} },
    };
    let projectLookups = 0;
    const index = new SymbolIndex({
        narrowCandidates: candidates => { projectLookups++; return candidates; },
        scoreFilePath: () => 0,
        isSameCompileUnit: () => { projectLookups++; return true; },
    });
    index.updateFileText(document.uri.fsPath, document.getText());
    index.updateFileText('Pose.gpl', [
        'Module RPS', 'Public Class JointPoseTable',
        "' 표의 축 수를 반환한다.",
        'Public Function AxisCount() As Integer', 'End Function', 'End Class', 'End Module',
    ].join('\n'));
    index.rebuildNameIndex();
    const loaded = new Map<string, { exports: any }>();
    function load(filename: string): any {
        const cached = loaded.get(filename);
        if (cached) { return cached.exports; }
        const module = { exports: {} as any };
        loaded.set(filename, module);
        const realRequire = createRequire(filename);
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            module, exports: module.exports,
            require: (id: string) => {
                if (id === 'vscode') { return vscode; }
                const resolved = realRequire.resolve(id);
                return id.startsWith('.') && resolved.endsWith('.js') ? load(resolved) : realRequire(id);
            },
        }, { filename });
        return module.exports;
    }
    const { GPLHoverProvider } = load(path.resolve(__dirname, '../providers/hoverProvider.js'));
    const provider = new GPLHoverProvider(index);
    return {
        projectLookups: () => projectLookups,
        hover: (word: string, cancelled = false) => provider.provideHover(document,
            { line: 5, character: expression.indexOf(word) + Math.floor(word.length / 2) },
            { isCancellationRequested: cancelled }),
        covered: (hover: any) => expression.slice(hover.range.start.character, hover.range.end.character),
    };
}

test('Hover: 멤버 접근 앞의 매개변수는 동명 전역 변수보다 우선한다', async () => {
    const s = setup();
    const hover = await s.hover('table');
    assert.ok(hover?.contents.value.includes('JointPoseTable'), 'table 매개변수의 타입을 표시해야 한다');
    assert.ok(!hover.contents.value.includes('String'));
    assert.strictEqual(s.covered(hover), 'table');
});

test('Hover: 같은 줄의 로컬 변수와 메서드를 각각 표시한다', async () => {
    const s = setup();
    const local = await s.hover('axes');
    const member = await s.hover('AxisCount');
    assert.ok(local?.contents.value.includes('Integer'));
    assert.ok(member?.contents.value.includes('Function AxisCount() As Integer'));
    assert.ok(member.contents.value.includes('표의 축 수를 반환한다.'));
    assert.strictEqual(s.covered(local), 'axes');
    assert.strictEqual(s.covered(member), 'AxisCount');
});

test('Hover: 점 주위 공백과 배열 인덱싱 뒤에도 식별자 범위만 반환한다', async () => {
    for (const expression of ['axes = table . AxisCount()', 'axes = tables(0).AxisCount()']) {
        const s = setup(expression);
        const hover = await s.hover('AxisCount');
        assert.ok(hover?.contents.value.includes('Function AxisCount() As Integer'));
        assert.strictEqual(s.covered(hover), 'AxisCount');
    }
});

test('Hover: 내장 클래스와 그 멤버는 커서 아래 항목을 각각 표시한다', async () => {
    const s = setup('Thread.CurrentThread.Name');
    const cls = await s.hover('Thread');
    const member = await s.hover('CurrentThread');
    const tail = await s.hover('Name');
    assert.ok(cls?.contents.value.includes('GPL Built-in Class'));
    assert.ok(member?.contents.value.includes('CurrentThread'));
    assert.ok(tail?.contents.value.includes('Name'));
    assert.strictEqual(s.covered(cls), 'Thread');
    assert.strictEqual(s.covered(member), 'CurrentThread');
    assert.strictEqual(s.covered(tail), 'Name');
});

test('Hover: 한정된 내장 함수와 전역 함수의 문서를 유지한다', async () => {
    for (const [expression, word, expected] of [
        ['Math.Abs(axes)', 'Abs', 'Abs'],
        ['CStr(axes)', 'CStr', 'CStr'],
        ['Thread.CurrentThread().Name', 'Name', 'Name'],
    ]) {
        const s = setup(expression);
        const hover = await s.hover(word);
        assert.ok(hover?.contents.value.includes(expected));
        assert.strictEqual(s.covered(hover), word);
    }
});

test('Hover: 주석·문자열·취소된 요청은 표시하지 않는다', async () => {
    assert.strictEqual(await setup("' table.AxisCount()").hover('table'), undefined);
    assert.strictEqual(await setup('"table.AxisCount()"').hover('AxisCount'), undefined);
    assert.strictEqual(await setup().hover('AxisCount', true), undefined);
});

test('Hover: 현재 문서 함수와 해석된 멤버의 첫 요청은 프로젝트 관계를 탐색하지 않는다', async () => {
    for (const [expression, word] of [['ReadTable(table)', 'ReadTable'], ['axes = table.AxisCount()', 'AxisCount']]) {
        const s = setup(expression);
        const hover = await s.hover(word);
        assert.ok(hover?.contents.value.includes(`Function ${word}(`));
        assert.strictEqual(s.projectLookups(), 0);
    }
});
