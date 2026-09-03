import * as assert from 'assert';
import { test } from './harness';
import {
    parseShowVariableMulti,
    classifyVarEntry,
    arrayRank,
    splitVarLine,
    isTypeToken,
    isLocationType,
    summarizeLocation,
    annotateLocationMember,
    dapColorizeType,
} from '../debug/showVariableParser';

// ─── 실기기 캡처 픽스처 (GPL 4.x, 2026-07-22, MergeCode/OpCommandRunThread1) ───
// Show Variable -eval OpCommandRunThread1 0 cmd
const REAL_OBJECT_DUMP = '<DATA>cmd, Object Command\n'
    + 'cmd.m_cmd, String, "get"\n'
    + 'cmd.m_cmdCode, Integer, 0\n'
    + 'cmd.m_needLogWrite, Boolean, -1\n'
    + 'cmd.m_rawArg, String, "7,6"\n'
    + 'cmd.m_responseRobotIndex, Boolean, 0\n'
    + 'cmd.m_robotIndex, Integer, 0\n'
    + 'cmd.m_sourceDevice, Integer, 2\n'
    + '</DATA>\n<STATUS>0,"Success"</STATUS>';

test('parseShowVariableMulti: 실기기 객체 덤프 — 헤더+멤버 7줄, 값 속 쉼표 보존', () => {
    const entries = parseShowVariableMulti(REAL_OBJECT_DUMP);
    assert.strictEqual(entries.length, 8);
    assert.deepStrictEqual(entries[0], { name: 'cmd', type: 'Object Command', value: '' });
    const rawArg = entries.find(e => e.name === 'cmd.m_rawArg');
    assert.strictEqual(rawArg?.value, '"7,6"'); // 쉼표 포함 문자열이 잘리지 않아야 함
    assert.strictEqual(entries.find(e => e.name === 'cmd.m_needLogWrite')?.value, '-1');
});

test('classifyVarEntry: 실기기 객체 헤더는 클래스명 포함(`Object Command`) — object로 분류', () => {
    // 실기기는 `Object Command`, 공식 문서 예시는 `Object` 단독 — 둘 다 object여야 한다.
    assert.strictEqual(classifyVarEntry({ name: 'cmd', type: 'Object Command', value: '' }), 'object');
    assert.strictEqual(classifyVarEntry({ name: 'Loc', type: 'Object', value: '' }), 'object');
});

test('classifyVarEntry: 배열 헤더/요소/단순 값 분류 불변', () => {
    // 배열 헤더: 값 없이 타입 끝 괄호
    assert.strictEqual(classifyVarEntry({ name: 'My_array', type: 'Double(,)', value: '' }), 'array');
    assert.strictEqual(classifyVarEntry({ name: 'buf', type: 'String()', value: '' }), 'array');
    // 요소 응답은 값이 있으므로 simple
    assert.strictEqual(classifyVarEntry({ name: 'arr(0,0)', type: 'Double(,)', value: '30.5' }), 'simple');
    assert.strictEqual(classifyVarEntry({ name: 'i', type: 'Integer', value: '5' }), 'simple');
});

test('classifyVarEntry: 객체 배열 헤더(`RobotArm()`류)는 array가 우선', () => {
    // 배열 판정을 먼저 해야 `Object Xxx()` 형태가 object로 오분류되지 않는다.
    assert.strictEqual(classifyVarEntry({ name: 'list', type: 'Object Command()', value: '' }), 'array');
});

test('classifyVarEntry: null 객체 참조 요소는 simple — 무한 가짜 배열 트리 방지', () => {
    // 실기기 재현(2026-07-22): `Dim armList(1) As RobotArm`에서 armList(0)만 채우면
    // `armList(1), Object() null`(null 참조)이 온다. 배열로 오분류하면 null 인덱싱
    // (`armList(1)(0)`)이 또 null을 성공으로 돌려줘 트리가 무한 재귀했다.
    assert.strictEqual(
        classifyVarEntry({ name: 'armList(1)', type: 'Object() null', value: '' }, false), 'simple');
    // 멤버 줄(점 포함 이름)의 null 참조도 동일
    assert.strictEqual(
        classifyVarEntry({ name: 'a(1)(0).armCenterDeg', type: 'Object() null', value: '' }, false), 'simple');
    // 요소인데 런타임 클래스가 있으면(필드 없는 객체 등) 객체 — 재조회로 덤프 확보
    assert.strictEqual(
        classifyVarEntry({ name: 'armList(0)', type: 'Object() RobotArm', value: '' }, false), 'object');
});

test('classifyVarEntry: 실기기 객체 배열 — `Object() null`=배열, `Object() RobotArm`+멤버=요소 객체', () => {
    // 실기기 캡처(2026-07-22, moveToReady 프레임):
    //   armList, Object() null                          ← 배열 전체 (멤버 없음)
    //   armList(0), Object() RobotArm + 멤버 31줄        ← 요소 객체
    assert.strictEqual(
        classifyVarEntry({ name: 'armList', type: 'Object() null', value: '' }, false), 'array');
    assert.strictEqual(
        classifyVarEntry({ name: 'armList(0)', type: 'Object() RobotArm', value: '' }, true), 'object');
    // 멤버 정보 없이 호출되는 expand 경로(저장된 varType)에서도 배열로 판정돼야 요소 조회가 된다
    assert.strictEqual(
        classifyVarEntry({ name: '', type: 'Object() null', value: '' }), 'array');
});

test('parseShowVariableMulti: 실기기 객체 배열 요소 덤프 — 헤더+멤버, 타입에 런타임 클래스', () => {
    const resp = '<DATA>armList(0), Object() RobotArm\n'
        + 'armList(0).m_armIndex, Integer, 1\n'
        + 'armList(0).m_flipSizeDeg, Double, 20\n'
        + '</DATA>\n<STATUS>0,"Success"</STATUS>';
    const entries = parseShowVariableMulti(resp);
    assert.strictEqual(entries.length, 3);
    assert.deepStrictEqual(entries[0], { name: 'armList(0)', type: 'Object() RobotArm', value: '' });
    assert.deepStrictEqual(entries[1], { name: 'armList(0).m_armIndex', type: 'Integer', value: '1' });
});

test('arrayRank: 객체 배열 타입(괄호 뒤 클래스명)도 차원 인식', () => {
    assert.strictEqual(arrayRank('Object() null'), 1);
    assert.strictEqual(arrayRank('Object(,) null'), 2);
});

test('parseShowVariableMulti: 에러 STATUS만 있는 응답은 빈 목록', () => {
    // 실기기: cmd.ints(0) → -780, cmd.m_rawArgs(0) → -729
    const resp = '<DATA></DATA>\n<STATUS>-780,"*Unsupported procedure reference*"</STATUS>';
    assert.deepStrictEqual(parseShowVariableMulti(resp), []);
});

test('arrayRank: 차원 수 추출', () => {
    assert.strictEqual(arrayRank('Double()'), 1);
    assert.strictEqual(arrayRank('Double(,)'), 2);
    assert.strictEqual(arrayRank('Integer(,,)'), 3);
});

// ─── 시스템 Location 덤프 픽스처 (GPL 4.2K5, 2026-08-25, GitHub #27) ───
// Show Variable -eval JogCommandRunThread 0 Robot.Where(1) — 멤버 줄이 2열(name, value)+주석 값
const REAL_LOCATION_CART = '<DATA>Robot.Where(1), Object Location\n'
    + 'Robot.Where(1).Type, 0 = Cartesian\n'
    + 'Robot.Where(1).Config, 1  = Righty\n'
    + 'Robot.Where(1).X, 636\n'
    + 'Robot.Where(1).Y, 0\n'
    + 'Robot.Where(1).Z, 0\n'
    + 'Robot.Where(1).Yaw, 0\n'
    + 'Robot.Where(1).Pitch, 90\n'
    + 'Robot.Where(1).Roll, -180\n'
    + 'Robot.Where(1).RefFrame, Null\n'
    + 'Robot.Where(1).ZClearance, 1E+32\n'
    + 'Robot.Where(1).ZWorld, 0\n'
    + '</DATA>\n<STATUS>0,"Success"</STATUS>';
const REAL_LOCATION_ANGLES = '<DATA>Robot.WhereAngles(1), Object Location\n'
    + 'Robot.WhereAngles(1).Type, 1 = Angles\n'
    + 'Robot.WhereAngles(1).Angle(1), 0\n'
    + 'Robot.WhereAngles(1).Angle(2), 0\n'
    + 'Robot.WhereAngles(1).Angle(3), 0\n'
    + 'Robot.WhereAngles(1).Angle(4), 0\n'
    + 'Robot.WhereAngles(1).Angle(5), 0.196000011246651\n'
    + 'Robot.WhereAngles(1).ZClearance, 1E+32\n'
    + 'Robot.WhereAngles(1).ZWorld, 0\n'
    + '</DATA>\n<STATUS>0,"Success"</STATUS>';

test('isTypeToken: 타입 토큰과 2열 값 구분', () => {
    for (const t of ['Integer', 'Double', 'String', 'Boolean', 'Double(,)', 'String()', 'Object', 'Object Command',
        'Object Location', 'Object() null', 'Object() RobotArm', 'RobotArm()']) {
        assert.strictEqual(isTypeToken(t), true, `타입이어야 함: ${t}`);
    }
    for (const v of ['636', '-180', '1E+32', '0.196000011246651', '0 = Cartesian', '1  = Righty', 'Null', '"7,6"', '']) {
        assert.strictEqual(isTypeToken(v), false, `값이어야 함: ${v}`);
    }
});

test('parseShowVariableMulti: Location 덤프 2열 멤버는 value로(type 비움), 주석 값 보존, Null→null', () => {
    const entries = parseShowVariableMulti(REAL_LOCATION_CART);
    assert.strictEqual(entries.length, 12);
    assert.deepStrictEqual(entries[0], { name: 'Robot.Where(1)', type: 'Object Location', value: '' });
    const byLeaf = (leaf: string) => entries.find(e => e.name.endsWith(`.${leaf}`))!;
    assert.deepStrictEqual(byLeaf('X'), { name: 'Robot.Where(1).X', type: '', value: '636' });
    assert.strictEqual(byLeaf('Type').value, '0 = Cartesian');
    assert.strictEqual(byLeaf('Config').value, '1  = Righty');
    assert.strictEqual(byLeaf('RefFrame').value, 'null');
    assert.strictEqual(byLeaf('Roll').value, '-180');
    // 2열 값 줄은 simple — 배열/객체로 오분류되지 않는다
    assert.strictEqual(classifyVarEntry(byLeaf('X')), 'simple');
    assert.strictEqual(classifyVarEntry(byLeaf('RefFrame')), 'simple');
    assert.strictEqual(classifyVarEntry(entries[0], true), 'object');
});

test('parseShowVariableMulti: 단일 프로퍼티 3열·빈 문자열 2열(`x.Text, String`)은 종전대로 type', () => {
    const single = parseShowVariableMulti('<DATA>Robot.Where(1).Config, Integer, 1</DATA>\n<STATUS>0,"Success"</STATUS>');
    assert.deepStrictEqual(single[0], { name: 'Robot.Where(1).Config', type: 'Integer', value: '1' });
    const empty = parseShowVariableMulti('<DATA>Robot.Where(1).Text, String</DATA>\n<STATUS>0,"Success"</STATUS>');
    assert.deepStrictEqual(empty[0], { name: 'Robot.Where(1).Text', type: 'String', value: '' });
});

test('summarizeLocation: Cartesian/Angles 한 줄 요약, 미지 Type은 undefined', () => {
    const cart = parseShowVariableMulti(REAL_LOCATION_CART);
    assert.strictEqual(isLocationType(cart[0].type), true);
    assert.strictEqual(summarizeLocation(cart.slice(1)), '(636, 0, 0 | 0, 90, -180) cfg=1');
    const ang = parseShowVariableMulti(REAL_LOCATION_ANGLES);
    assert.strictEqual(summarizeLocation(ang.slice(1)), 'Angles(0, 0, 0, 0, 0.196)');
    assert.strictEqual(summarizeLocation([{ name: 'l.X', type: '', value: '1' }]), undefined);
    assert.strictEqual(summarizeLocation([]), undefined);
    assert.strictEqual(isLocationType('Object Command'), false);
});

test('annotateLocationMember: ZClearance 1E+32만 "(미설정)" 주석', () => {
    assert.strictEqual(annotateLocationMember('Robot.Where(1).ZClearance', '1E+32'), '1E+32 (미설정)');
    assert.strictEqual(annotateLocationMember('Robot.Where(1).ZClearance', '25'), '25');
    assert.strictEqual(annotateLocationMember('Robot.Where(1).X', '1E+32'), '1E+32');
});

test('splitVarLine: 괄호 안 쉼표 무시 + maxParts 이후 병합', () => {
    assert.deepStrictEqual(
        splitVarLine('arr(0,1), Double(,), 30.5', 3),
        ['arr(0,1)', 'Double(,)', '30.5'],
    );
    assert.deepStrictEqual(
        splitVarLine('cmd.m_rawArg, String, "7,6"', 3),
        ['cmd.m_rawArg', 'String', '"7,6"'],
    );
});

test('dapColorizeType: 원시 타입만 DAP 표준 이름으로 — 객체/배열은 undefined', () => {
    // 표시 값에 타입 접미·hex 힌트가 붙어 VS Code의 값 모양 추측이 실패하므로 타입을 명시한다.
    assert.strictEqual(dapColorizeType('String', '"MAIN"'), 'string');
    assert.strictEqual(dapColorizeType('Char', '"A"'), 'string');
    assert.strictEqual(dapColorizeType('Integer', '5'), 'number');
    assert.strictEqual(dapColorizeType('Double', '30.5'), 'number');
    assert.strictEqual(dapColorizeType('single', '1.5'), 'number');
    assert.strictEqual(dapColorizeType('Boolean', '-1'), 'boolean');
    // 배열 헤더·객체·null 참조는 색상화 대상이 아니다.
    assert.strictEqual(dapColorizeType('String()', ''), undefined);
    assert.strictEqual(dapColorizeType('Double(,)', ''), undefined);
    assert.strictEqual(dapColorizeType('Object Command', ''), undefined);
    assert.strictEqual(dapColorizeType('Object() null', ''), undefined);
});

test('dapColorizeType: 타입 칸이 없는 2열 응답은 값 모양으로 추정', () => {
    // 시스템 Location 덤프 멤버(`Robot.Where(1).X, 636`)는 타입 칸이 없다.
    assert.strictEqual(dapColorizeType('', '636'), 'number');
    assert.strictEqual(dapColorizeType('', '1E+32'), 'number');
    assert.strictEqual(dapColorizeType('', '"text"'), 'string');
    assert.strictEqual(dapColorizeType('', 'True'), 'boolean');
    assert.strictEqual(dapColorizeType('', '0 = Cartesian'), undefined);
    assert.strictEqual(dapColorizeType('', 'null'), undefined);
    assert.strictEqual(dapColorizeType('', ''), undefined);
    assert.strictEqual(dapColorizeType(''), undefined);
});
