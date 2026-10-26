import * as assert from 'assert';
import { test } from './harness';
import { createProviderWorld, NO_CANCEL, Position } from './providerHarness';

// MergeCode RobotModule.gpl(3921~3938행)의 getWafer 오버로드를 줄인 합성 픽스처.
// 3-인자 오버로드가 세 개(Integer / RobotArm / RobotArm()) — 인자 개수만으로는 가를 수 없다.
const ROBOT = 'C:\\proj\\RobotModule.gpl';
const ARM = 'C:\\proj\\RobotArm.gpl';
const ROBOT_SRC = [
    'Module RobotModule',                                                                              // 0
    'Public Class RNDRobot',                                                                           // 1
    'Private m_arms() As RobotArm',                                                                    // 2
    'Private m_main As RobotArm',                                                                      // 3
    'Public Sub getWafer(stage As Integer, gSlot As Integer, armNumber As Integer)',                   // 4
    'Dim robotArmList() As RobotArm',                                                                  // 5
    'getWafer(stage,gSlot,robotArmList)',                                                              // 6
    'End Sub',                                                                                         // 7
    'Public Sub getWafer(stage As Integer, gSlot As Integer, arm As RobotArm)',                        // 8
    'Dim armList(1) As RobotArm',                                                                      // 9
    'armList(0) = arm',                                                                                // 10
    'getWafer(stage,gSlot,armList)',                                                                   // 11
    'End Sub',                                                                                         // 12
    'Public Sub getWafer(stage As Integer, gSlot As Integer, armlist() As RobotArm)',                  // 13
    'getWafer(stage,gSlot,armList,0)',                                                                 // 14
    'End Sub',                                                                                         // 15
    'Public Sub getWafer(stage As Integer, gSlot As Integer, armList() As RobotArm, Offset As Double)', // 16
    'End Sub',                                                                                         // 17
    'Public Sub useAll(ByRef arms() As RobotArm, ByVal one As RobotArm)',                              // 18
    'getWafer(1, 2, arms)',                                                                            // 19
    'getWafer(1, 2, one)',                                                                             // 20
    'getWafer(1, 2, 3)',                                                                               // 21
    'Me.getWafer(1, 2, m_arms)',                                                                       // 22
    'getWafer(1, 2, Me.m_main)',                                                                       // 23
    'getWafer(1, 2, m_arms(0))',                                                                       // 24
    'getWafer(1, 2, m_main.peers)',                                                                    // 25
    'getWafer(u1, u2, u3)',                                                                            // 26
    'Dim peers As Integer',                                                                            // 27
    'peers = 0',                                                                                       // 28
    'End Sub',                                                                                         // 29
    'End Class',                                                                                       // 30
    'End Module',                                                                                      // 31
].join('\n');
const ARM_SRC = [
    'Module RobotArmModule',
    'Public Class RobotArm',
    'Public peers() As RobotArm',
    'Public Function getWafer(stage As Integer, armList() As RobotArm, Optional mode As Integer = 0) As Integer',
    'End Function',
    'End Class',
    'End Module',
].join('\n');

function setup(files: Record<string, string> = { [ROBOT]: ROBOT_SRC, [ARM]: ARM_SRC }) {
    const world = createProviderWorld(files);
    const { GPLDefinitionProvider } = world.load('providers/definitionProvider.js');
    const provider = new GPLDefinitionProvider(world.cache, world.output);
    const define = async (file: string, pos: Position) => {
        const result = await provider.provideDefinition(world.docs.get(file), pos, NO_CANCEL);
        const list = result === undefined ? [] : Array.isArray(result) ? result : [result];
        return [...list].map((l: any) => `${l.uri.fsPath.split('\\').pop()}:${l.range.start.line}`);
    };
    return { world, define };
}

test('정의 이동: 배열 로컬 인자는 배열 오버로드로 간다 (getWafer 사례)', async () => {
    const { world, define } = setup();
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 6, 'getWafer', 2)), ['RobotModule.gpl:13']);
});

test('정의 이동: 크기 지정 배열 로컬(`Dim armList(1)`)도 배열이다', async () => {
    const { world, define } = setup();
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 11, 'getWafer', 2)), ['RobotModule.gpl:13']);
});

test('정의 이동: 인자 4개는 4-인자 오버로드', async () => {
    const { world, define } = setup();
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 14, 'getWafer', 2)), ['RobotModule.gpl:16']);
});

test('정의 이동: ByRef 배열·ByVal 객체·숫자 리터럴 인자를 각각 맞는 오버로드로', async () => {
    const { world, define } = setup();
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 19, 'getWafer', 2)), ['RobotModule.gpl:13']);
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 20, 'getWafer', 2)), ['RobotModule.gpl:8']);
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 21, 'getWafer', 2)), ['RobotModule.gpl:4']);
});

test('정의 이동: `Me.` 호출과 필드·멤버 체인 인자도 타입으로 오버로드를 고른다', async () => {
    const { world, define } = setup();
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 22, 'getWafer', 2)), ['RobotModule.gpl:13'], 'Me.getWafer(…, m_arms)');
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 23, 'getWafer', 2)), ['RobotModule.gpl:8'], 'Me.m_main');
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 24, 'getWafer', 2)), ['RobotModule.gpl:8'], 'm_arms(0)');
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 25, 'getWafer', 2)), ['RobotModule.gpl:13'], 'm_main.peers');
});

test('정의 이동: 선언 줄의 오버로드 이름은 그 선언 자신이다', async () => {
    const { world, define } = setup();
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 13, 'getWafer', 2)), ['RobotModule.gpl:13']);
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 8, 'getWafer', 2)), ['RobotModule.gpl:8']);
});

test('정의 이동: 클래스 안의 한정자 없는 호출은 감싸는 클래스의 오버로드에서만 고른다', async () => {
    const { world, define } = setup();
    // 인자 타입을 모르면 같은 개수의 RNDRobot 오버로드 셋이 peek 에 남되, 다른 클래스(RobotArm)의 동명 함수는 섞이지 않는다.
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 26, 'getWafer', 2)),
        ['RobotModule.gpl:4', 'RobotModule.gpl:8', 'RobotModule.gpl:13']);
});

test('정의 이동: 로컬 변수는 다른 클래스의 동명 필드보다 우선한다', async () => {
    const { world, define } = setup();
    assert.deepStrictEqual(await define(ROBOT, world.at(ROBOT, 28, 'peers', 1)), ['RobotModule.gpl:27']);
});

// Sample Prep RobotUnit.gpl(Module RBU > Class RobotUnit 의 Num()) ↔ Numbers.gpl(Module NUM) 축약.
const NUMBERS = 'C:\\proj\\Lib\\Numbers.gpl';
const UNIT = 'C:\\proj\\Lib\\RobotUnit.gpl';
const NUMBERS_SRC = [
    'Module NUM',
    'Public Function FixedText(v As Double, digits As Integer) As String',
    'End Function',
    'End Module',
].join('\n');
const UNIT_SRC = [
    'Module RBU',                              // 0
    'Public Class RobotUnit',                  // 1
    'Public Function Num() As Integer',        // 2
    'End Function',                            // 3
    'Public Function Pos() As String',         // 4
    'Return NUM.FixedText(1.5, 3)',            // 5
    'End Function',                            // 6
    'End Class',                               // 7
    'Public Function Other() As String',       // 8
    'Return NUM.FixedText(2.5, 3)',            // 9
    'End Function',                            // 10
    'End Module',                              // 11
].join('\n');

test('정의 이동: 클래스 멤버 Num() 이 Module NUM 을 가리는 자리 — 둘 다(모듈 먼저)', async () => {
    const { world, define } = setup({ [NUMBERS]: NUMBERS_SRC, [UNIT]: UNIT_SRC });
    assert.deepStrictEqual(await define(UNIT, world.at(UNIT, 5, 'NUM', 1)), ['Numbers.gpl:0', 'RobotUnit.gpl:2']);
});

test('정의 이동: 가림이 없는 자리의 모듈 한정자는 Module 로 간다', async () => {
    const { world, define } = setup({ [NUMBERS]: NUMBERS_SRC, [UNIT]: UNIT_SRC });
    assert.deepStrictEqual(await define(UNIT, world.at(UNIT, 9, 'NUM', 1)), ['Numbers.gpl:0']);
    assert.deepStrictEqual(await define(UNIT, world.at(UNIT, 5, 'FixedText', 2)), ['Numbers.gpl:1']);
});
test('정의 이동: 타입 자리(`As Station`)는 같은 이름의 프로퍼티가 아니라 타입으로 간다', async () => {
    const file = 'C:\\proj\\Cell.gpl';
    const { world, define } = setup({
        [file]: [
            'Module M',                               // 0
            'Public Class Station',                   // 1
            'End Class',                              // 2
            'Public Class Cell',                      // 3
            'Public Property Station As Station',     // 4
            'Get',                                    // 5
            'Return Nothing',                         // 6
            'End Get',                                // 7
            'End Property',                           // 8
            'Public Sub Work()',                      // 9
            'Dim s As Station',                       // 10
            's = Station',                            // 11
            'End Sub',                                // 12
            'End Class',                              // 13
            'End Module',                             // 14
        ].join('\n'),
    });
    assert.deepStrictEqual(await define(file, world.at(file, 10, 'Station', 1)), ['Cell.gpl:1']);
    assert.deepStrictEqual(await define(file, world.at(file, 11, 'Station', 1)), ['Cell.gpl:4'], '값 자리는 감싸는 클래스의 프로퍼티');
});