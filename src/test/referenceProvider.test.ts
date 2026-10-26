import * as assert from 'assert';
import { test } from './harness';
import { createProviderWorld, fileUri, NO_CANCEL, Position } from './providerHarness';

/** 프로젝트 범위 폴백이 묶음의 모든 파일을 훑게 하는 대역(.gpr 탐색 대신). */
function setup(files: Record<string, string>) {
    const world = createProviderWorld(files);
    const projectFileScope = {
        PROJECT_EXCLUDE_GLOB: '',
        resolveProjectFileScope: async () => ({
            files: Object.keys(files).map(fileUri), origin: 'project', projectDir: 'C:\\proj', truncated: false,
        }),
    };
    const { GPLReferenceProvider } = world.load('providers/referenceProvider.js', {
        '../project/projectFileScope': projectFileScope,
    });
    const provider = new GPLReferenceProvider(world.cache, world.output);
    const refs = async (file: string, pos: Position, includeDeclaration = true) => {
        const result = await provider.provideReferences(world.docs.get(file), pos, { includeDeclaration }, NO_CANCEL);
        return [...result]
            .map((l: any) => `${l.uri.fsPath.split('\\').pop()}:${l.range.start.line}`)
            .sort();
    };
    return { world, refs };
}

// ── ① 모듈 범위 — Sample Prep BinderR3 의 BRI.Setup / BRM.Setup 축약 ─────────────────────────
const IO = 'C:\\proj\\App\\Config\\IoConfig.gpl';
const MACHINE = 'C:\\proj\\App\\Control\\Machine.gpl';
const MAIN = 'C:\\proj\\App\\Main.gpl';
const SETUP_FILES = {
    [IO]: [
        'Module BRI',                                // 0
        'Public Function Setup() As Boolean',        // 1  정의
        'Setup = True',                              // 2  반환값 대입(참조 아님 — 종전 규칙)
        'LOG.WriteEx(ex, "BRI.Setup")',              // 3  문자열
        'End Function',                              // 4
        'Public Sub Reset()',                        // 5
        'If Setup() Then',                           // 6  같은 모듈 안 한정자 없는 호출 → 참조
        'End If',                                    // 7
        'End Sub',                                   // 8
        'End Module',                                // 9
    ].join('\n'),
    [MACHINE]: [
        'Module BRM',                                // 0
        'Public Sub Setup()',                        // 1  다른 모듈의 동명 선언
        'LOG.WriteEx(ex, "BRM.Setup")',              // 2
        'End Sub',                                   // 3
        'Public Sub Init()',                         // 4
        'Setup()',                                   // 5  BRM 안 — BRM.Setup 으로 해석
        'End Sub',                                   // 6
        'End Module',                                // 7
    ].join('\n'),
    [MAIN]: [
        'Module APP',                                // 0
        'Public Sub Main()',                         // 1
        'Dim okRio As Boolean',                      // 2
        'BRM.Setup()',                               // 3  한정자 BRM
        'okRio = BRI.Setup()',                       // 4  한정자 BRI
        'Setup()',                                   // 5  제3 모듈 — 동명 모듈 멤버가 둘이라 확정 불가
        'End Sub',                                   // 6
        'End Module',                                // 7
    ].join('\n'),
};

test('참조 찾기: 다른 모듈의 동명 선언·한정자는 빼고 정의 모듈의 참조만 (BRI.Setup)', async () => {
    const { world, refs } = setup(SETUP_FILES);
    assert.deepStrictEqual(await refs(IO, world.at(IO, 1, 'Setup', 1)), ['IoConfig.gpl:1', 'IoConfig.gpl:6', 'Main.gpl:4']);
    const log = world.logs.join('\n');
    assert.match(log, /exclude Machine\.gpl:2 reason=other-module-decl/);
    assert.match(log, /exclude Main\.gpl:4 reason=qualifier-mismatch/);
    assert.match(log, /exclude Machine\.gpl:6 reason=shadowed-by-member/);
    assert.match(log, /exclude Main\.gpl:6 reason=ambiguous-unqualified/);
    assert.match(log, /hit Main\.gpl:5/);
});

test('참조 찾기: 반대 방향(BRM.Setup)도 자기 모듈 것만', async () => {
    const { world, refs } = setup(SETUP_FILES);
    assert.deepStrictEqual(await refs(MACHINE, world.at(MACHINE, 1, 'Setup', 1)), ['Machine.gpl:1', 'Machine.gpl:5', 'Main.gpl:3']);
});

test('참조 찾기: 호출부(`BRI.Setup()`)에서 실행해도 선언에서 실행한 것과 같다', async () => {
    const { world, refs } = setup(SETUP_FILES);
    assert.deepStrictEqual(await refs(MAIN, world.at(MAIN, 4, 'Setup', 1)), ['IoConfig.gpl:1', 'IoConfig.gpl:6', 'Main.gpl:4']);
    assert.deepStrictEqual(await refs(MAIN, world.at(MAIN, 3, 'Setup', 1)), ['Machine.gpl:1', 'Machine.gpl:5', 'Main.gpl:3']);
});

// ── ② 클래스 멤버 Num() 이 Module NUM 을 가리는 자리 ─────────────────────────────────────
const NUMBERS = 'C:\\proj\\Lib\\Numbers.gpl';
const UNIT = 'C:\\proj\\Lib\\RobotUnit.gpl';
const NUM_FILES = {
    [NUMBERS]: [
        'Module NUM',                                                         // 0
        'Public Function FixedText(v As Double, digits As Integer) As String', // 1
        'End Function',                                                       // 2
        'End Module',                                                         // 3
    ].join('\n'),
    [UNIT]: [
        'Module RBU',                              // 0
        'Public Class RobotUnit',                  // 1
        'Public Function Num() As Integer',        // 2  동명 클래스 멤버
        'End Function',                            // 3
        'Public Function Pos() As String',         // 4
        'Dim n As Integer = Num()',                // 5  멤버 호출 — Module 참조 아님
        'Return NUM.FixedText(n, 3)',              // 6  Module 한정자(컴파일러는 멤버로 해석 -781)
        'End Function',                            // 7
        'End Class',                               // 8
        'Public Function Other() As String',       // 9
        'Return NUM.FixedText(2.5, 3)',            // 10
        'End Function',                            // 11
        'End Module',                              // 12
    ].join('\n'),
};

test('참조 찾기: 모듈 한정자 `NUM` 은 Module NUM 의 한정자 사용만 — 동명 멤버 Num 토큰은 빼다', async () => {
    const { world, refs } = setup(NUM_FILES);
    assert.deepStrictEqual(await refs(UNIT, world.at(UNIT, 6, 'NUM', 1)), ['Numbers.gpl:0', 'RobotUnit.gpl:10', 'RobotUnit.gpl:6']);
    const log = world.logs.join('\n');
    assert.match(log, /exclude RobotUnit\.gpl:3 reason=other-module-decl/);
    assert.match(log, /exclude RobotUnit\.gpl:6 reason=not-qualifier-usage/);
});

// ── ③ 오버로드 — MergeCode getWafer 축약 ───────────────────────────────────────────────
const ROBOT = 'C:\\proj\\RobotModule.gpl';
const OVERLOAD_FILES = {
    [ROBOT]: [
        'Module RobotModule',                                                                              // 0
        'Public Class RNDRobot',                                                                           // 1
        'Private m_arms() As RobotArm',                                                                    // 2
        'Private m_main As RobotArm',                                                                      // 3
        'Public Sub getWafer(stage As Integer, gSlot As Integer, armNumber As Integer)',                   // 4
        'Dim robotArmList() As RobotArm',                                                                  // 5
        'getWafer(stage,gSlot,robotArmList)',                                                              // 6  배열
        'End Sub',                                                                                         // 7
        'Public Sub getWafer(stage As Integer, gSlot As Integer, arm As RobotArm)',                        // 8
        'Dim armList(1) As RobotArm',                                                                      // 9
        'getWafer(stage,gSlot,armList)',                                                                   // 10 배열
        'End Sub',                                                                                         // 11
        'Public Sub getWafer(stage As Integer, gSlot As Integer, armlist() As RobotArm)',                  // 12 대상
        'getWafer(stage,gSlot,armList,0)',                                                                 // 13 4-인자
        'End Sub',                                                                                         // 14
        'Public Sub getWafer(stage As Integer, gSlot As Integer, armList() As RobotArm, Offset As Double)', // 15
        'End Sub',                                                                                         // 16
        'Public Sub useAll(ByRef arms() As RobotArm, ByVal one As RobotArm)',                              // 17
        'getWafer(1, 2, arms)',                                                                            // 18 배열
        'getWafer(1, 2, one)',                                                                             // 19 객체
        'getWafer(1, 2, 3)',                                                                               // 20 숫자
        'Me.getWafer(1, 2, m_arms)',                                                                       // 21 배열
        'getWafer(1, 2, Me.m_main)',                                                                       // 22 객체
        'getWafer(u1, u2, u3)',                                                                            // 23 타입 미상 → 남김
        'End Sub',                                                                                         // 24
        'End Class',                                                                                       // 25
        'End Module',                                                                                      // 26
    ].join('\n'),
    'C:\\proj\\RobotArm.gpl': [
        'Module RobotArmModule',
        'Public Class RobotArm',
        'End Class',
        'End Module',
    ].join('\n'),
};
const ARRAY_OVERLOAD_REFS = [6, 10, 12, 18, 21, 23].map(l => `RobotModule.gpl:${l}`).sort();

test('참조 찾기: 오버로드 선언에서 실행하면 그 오버로드에 맞는 호출만', async () => {
    const { world, refs } = setup(OVERLOAD_FILES);
    assert.deepStrictEqual(await refs(ROBOT, world.at(ROBOT, 12, 'getWafer', 1)), ARRAY_OVERLOAD_REFS);
    const log = world.logs.join('\n');
    assert.match(log, /exclude RobotModule\.gpl:14 reason=overload-mismatch/);
    assert.match(log, /exclude RobotModule\.gpl:5 reason=overload-mismatch/);
});

test('참조 찾기: 호출부에서 실행해도 인자로 오버로드를 확정해 같은 결과', async () => {
    const { world, refs } = setup(OVERLOAD_FILES);
    assert.deepStrictEqual(await refs(ROBOT, world.at(ROBOT, 6, 'getWafer', 1)), ARRAY_OVERLOAD_REFS);
});

test('참조 찾기: 인자로 오버로드를 확정할 수 없는 호출부는 모든 오버로드를 대상으로 둔다', async () => {
    const { world, refs } = setup(OVERLOAD_FILES);
    const all = await refs(ROBOT, world.at(ROBOT, 23, 'getWafer', 1));
    for (const line of [4, 6, 8, 10, 12, 13, 15, 18, 19, 20, 21, 22, 23]) {
        assert.ok(all.includes(`RobotModule.gpl:${line}`), `RobotModule.gpl:${line} 이 빠졌다: ${all.join(', ')}`);
    }
});
