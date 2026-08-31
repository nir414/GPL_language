import * as assert from 'assert';
import { test } from './harness';
import { GPLSymbol, GPLSymbolKind } from '../gplParser';
import {
    buildDocumentReceiverLookup,
    elementTypeOf,
    membersNamed,
    nestedTypesIn,
    ownedByHolder,
    resolveReceiverHolder,
    resolveReceiverTypeName,
    ReceiverLookup,
} from '../language/receiverType';

// ─── 픽스처: GitHub #32 재현 — RobotArm.controlAxis(Property) vs RNDRobot.controlAxis(Function) ─────────
const sym = (partial: Partial<GPLSymbol> & { name: string; kind: GPLSymbolKind }): GPLSymbol => ({
    range: { start: 0, end: 0 },
    line: 0,
    filePath: 'RobotModule.gpl',
    module: 'RobotModule',
    ...partial,
});

const WORKSPACE: GPLSymbol[] = [
    sym({ name: 'RobotModule', kind: GPLSymbolKind.Module, line: 0 }),
    sym({ name: 'RobotArm', kind: GPLSymbolKind.Class, line: 10 }),
    sym({ name: 'm_controlAxis', kind: GPLSymbolKind.Variable, className: 'RobotArm', line: 11, returnType: 'Integer', accessModifier: 'private' }),
    sym({ name: 'controlAxis', kind: GPLSymbolKind.Property, className: 'RobotArm', line: 12, returnType: 'Integer', getterReturnExpr: 'm_controlAxis', hasGetter: true }),
    sym({ name: 'RNDRobot', kind: GPLSymbolKind.Class, line: 100 }),
    sym({ name: 'controlAxis', kind: GPLSymbolKind.Function, className: 'RNDRobot', line: 101, returnType: 'Integer', parameters: ['axisName As String'] }),
    sym({ name: 'thePointDataManager', kind: GPLSymbolKind.Variable, className: 'RNDRobot', line: 102, returnType: 'PointDataManager' }),
    sym({ name: 'org', kind: GPLSymbolKind.Sub, className: 'RNDRobot', line: 110 }),
    sym({ name: 'PointDataManager', kind: GPLSymbolKind.Class, line: 200, filePath: 'PointData.gpl', module: 'PointData' }),
    sym({ name: 'getLocation', kind: GPLSymbolKind.Function, className: 'PointDataManager', line: 201, returnType: 'LocationEx', filePath: 'PointData.gpl', module: 'PointData' }),
    sym({ name: 'LocationEx', kind: GPLSymbolKind.Class, line: 300, filePath: 'LocationEx.gpl', module: 'LocationExModule' }),
    sym({ name: 'loc', kind: GPLSymbolKind.Property, className: 'LocationEx', line: 301, returnType: 'Location', filePath: 'LocationEx.gpl', module: 'LocationExModule' }),
    sym({ name: 'JogModule', kind: GPLSymbolKind.Module, line: 0, filePath: 'Jog.gpl', module: 'JogModule' }),
    sym({ name: 'jogSpeed', kind: GPLSymbolKind.Variable, line: 3, filePath: 'Jog.gpl', module: 'JogModule', returnType: 'Double' }),
    // 클래스 심볼의 className은 파서가 자기 자신으로 채운다(gplParser: className: currentClass).
    // 소속은 parentClassName(중첩) / module(모듈 최상위)로 판정해야 한다.
    sym({ name: 'ZeroPlan', kind: GPLSymbolKind.Class, className: 'ZeroPlan', line: 400, filePath: 'Zero.gpl', module: 'ZeroModule' }),
    sym({ name: 'StepBatch', kind: GPLSymbolKind.Class, className: 'StepBatch', line: 410, filePath: 'Zero.gpl', module: 'ZeroModule', parentClassName: 'ZeroPlan' }),
    sym({ name: 'count', kind: GPLSymbolKind.Variable, className: 'StepBatch', line: 411, filePath: 'Zero.gpl', module: 'ZeroModule', returnType: 'Integer' }),
    // GitHub 재현: Main에서 해석 실패한 `X.Run`이 한정자를 버린 전역 이름 폴백 때문에
    // 이 Lib_MoveQueue.Run으로 점프하던 케이스.
    sym({ name: 'Lib_MoveQueue', kind: GPLSymbolKind.Module, line: 0, filePath: 'Lib_MoveQueue.gpl', module: 'Lib_MoveQueue' }),
    sym({ name: 'Run', kind: GPLSymbolKind.Sub, line: 37, filePath: 'Lib_MoveQueue.gpl', module: 'Lib_MoveQueue', parameters: ['start As Integer'] }),
];

// RNDRobot.org() 본문(라인 110~130)의 로컬 — `Dim robotArmList() As RobotArm`
const DOC_LOCALS: GPLSymbol[] = [
    sym({ name: 'robotArmList', kind: GPLSymbolKind.Variable, className: 'RNDRobot', line: 112, returnType: 'RobotArm[]', isLocal: true }),
    sym({ name: 'singleArm', kind: GPLSymbolKind.Variable, className: 'RNDRobot', line: 113, returnType: 'RobotArm', isLocal: true }),
    sym({ name: 'n', kind: GPLSymbolKind.Variable, className: 'RNDRobot', line: 114, returnType: 'Integer', isLocal: true }),
    sym({ name: 'arm', kind: GPLSymbolKind.Variable, className: 'RNDRobot', line: 110, returnType: 'RobotArm', isParameter: true }),
    // 내장 클래스 타입 로컬 — `Dim saveThread As Thread = New Thread("DataFile.SaveThread")`
    sym({ name: 'saveThread', kind: GPLSymbolKind.Variable, className: 'RNDRobot', line: 115, returnType: 'Thread', isLocal: true }),
];

const findAllByName = (name: string) => WORKSPACE.filter(s => s.name.toLowerCase() === name.toLowerCase());

const lookupInOrg = (): ReceiverLookup => buildDocumentReceiverLookup(
    [...WORKSPACE, ...DOC_LOCALS],
    { startLine: 110, endLine: 130 },
    120,
    findAllByName,
);

test('elementTypeOf: 인덱싱된 배열 타입은 요소 타입, 인덱싱 없는 배열은 undefined', () => {
    assert.strictEqual(elementTypeOf('RobotArm[]', true), 'RobotArm');
    assert.strictEqual(elementTypeOf('RobotArm()', true), 'RobotArm');
    assert.strictEqual(elementTypeOf('Double(,)', true), 'Double');
    assert.strictEqual(elementTypeOf('RobotArm[]', false), undefined);
    assert.strictEqual(elementTypeOf('RobotArm', false), 'RobotArm');
    assert.strictEqual(elementTypeOf('RobotArm', true), 'RobotArm');
});

test('#32: 배열 인덱싱 로컬 수신자 robotArmList(0) → RobotArm 클래스', () => {
    const holder = resolveReceiverHolder([{ name: 'robotArmList', args: '0' }], lookupInOrg());
    assert.deepStrictEqual(holder, { kind: 'class', name: 'RobotArm' });
});

test('#32: 수신자 클래스의 멤버만 후보 — RobotArm.controlAxis(Property)만 남고 RNDRobot.controlAxis(Function)은 제외', () => {
    const lookup = lookupInOrg();
    const holder = resolveReceiverHolder([{ name: 'robotArmList', args: '0' }], lookup)!;
    const members = membersNamed(lookup, holder, 'controlAxis');
    assert.strictEqual(members.length, 1);
    assert.strictEqual(members[0].kind, GPLSymbolKind.Property);
    assert.strictEqual(members[0].className, 'RobotArm');
    assert.strictEqual(members[0].getterReturnExpr, 'm_controlAxis');
});

test('수신자: 인덱싱 없는 배열 로컬(robotArmList.) → 내장 Array라 해석 실패(undefined)', () => {
    assert.strictEqual(resolveReceiverHolder([{ name: 'robotArmList' }], lookupInOrg()), undefined);
});

test('수신자: 파라미터(arm As RobotArm) → RobotArm', () => {
    assert.deepStrictEqual(resolveReceiverHolder([{ name: 'arm' }], lookupInOrg()), { kind: 'class', name: 'RobotArm' });
});

test('수신자: 원시 타입 로컬(n As Integer) → undefined', () => {
    assert.strictEqual(resolveReceiverHolder([{ name: 'n' }], lookupInOrg()), undefined);
});

test('수신자: Me → 감싸는 프로시저(org)의 클래스 RNDRobot', () => {
    assert.deepStrictEqual(resolveReceiverHolder([{ name: 'Me' }], lookupInOrg()), { kind: 'class', name: 'RNDRobot' });
});

test('수신자: 클래스 이름 정적 접근(RobotArm.) → class, 모듈 이름(JogModule.) → module', () => {
    assert.deepStrictEqual(resolveReceiverHolder([{ name: 'RobotArm' }], lookupInOrg()), { kind: 'class', name: 'RobotArm' });
    assert.deepStrictEqual(resolveReceiverHolder([{ name: 'JogModule' }], lookupInOrg()), { kind: 'module', name: 'JogModule' });
    const members = membersNamed(lookupInOrg(), { kind: 'module', name: 'JogModule' }, 'jogSpeed');
    assert.strictEqual(members.length, 1);
});

test('수신자: 필드 → Function 반환형 체이닝 (thePointDataManager.getLocation(16). → LocationEx)', () => {
    const holder = resolveReceiverHolder(
        [{ name: 'thePointDataManager' }, { name: 'getLocation', args: '16' }],
        lookupInOrg(),
    );
    assert.deepStrictEqual(holder, { kind: 'class', name: 'LocationEx' });
    // 그 뒤 `.loc`은 시스템 Location 반환 — 사용자 클래스가 아니므로 더 내려가면 undefined
    assert.strictEqual(resolveReceiverHolder(
        [{ name: 'thePointDataManager' }, { name: 'getLocation', args: '16' }, { name: 'loc' }],
        lookupInOrg(),
    ), undefined);
});

test('수신자: 중첩 클래스 하강(ZeroPlan.StepBatch. → StepBatch)', () => {
    const holder = resolveReceiverHolder([{ name: 'ZeroPlan' }, { name: 'StepBatch' }], lookupInOrg());
    assert.deepStrictEqual(holder, { kind: 'class', name: 'StepBatch' });
    assert.strictEqual(membersNamed(lookupInOrg(), holder!, 'count').length, 1);
});

test('수신자: 알 수 없는 이름 → undefined(호출자는 이름 기반 보수 판정으로 폴백)', () => {
    assert.strictEqual(resolveReceiverHolder([{ name: 'nothingHere' }], lookupInOrg()), undefined);
    assert.strictEqual(resolveReceiverHolder([], lookupInOrg()), undefined);
});

test('buildDocumentReceiverLookup: 프로시저 범위 밖의 로컬은 보이지 않고, 같은 이름은 사용 위치 위의 가장 가까운 선언', () => {
    const outside = buildDocumentReceiverLookup([...WORKSPACE, ...DOC_LOCALS], { startLine: 500, endLine: 520 }, 510, findAllByName);
    assert.strictEqual(outside.findLocal('robotArmList'), undefined);
    assert.strictEqual(outside.enclosingClassName, undefined);

    const shadowed = [
        ...DOC_LOCALS,
        sym({ name: 'singleArm', kind: GPLSymbolKind.Variable, className: 'RNDRobot', line: 125, returnType: 'LocationEx', isLocal: true }),
    ];
    const at120 = buildDocumentReceiverLookup([...WORKSPACE, ...shadowed], { startLine: 110, endLine: 130 }, 120, findAllByName);
    assert.strictEqual(at120.findLocal('singleArm')?.returnType, 'RobotArm');
    const at128 = buildDocumentReceiverLookup([...WORKSPACE, ...shadowed], { startLine: 110, endLine: 130 }, 128, findAllByName);
    assert.strictEqual(at128.findLocal('singleArm')?.returnType, 'LocationEx');
});

test('buildDocumentReceiverLookup: findAllByName은 문서 심볼과 캐시 심볼을 합치되 같은 항목은 한 번만', () => {
    const lookup = buildDocumentReceiverLookup([...WORKSPACE, ...DOC_LOCALS], { startLine: 110, endLine: 130 }, 120, findAllByName);
    const all = lookup.findAllByName('controlAxis');
    assert.strictEqual(all.length, 2); // RobotArm.Property + RNDRobot.Function (문서·캐시 중복 제거)
    assert.ok(all.every(s => !s.isLocal));
});

// ─── 내장 클래스 타입 수신자 (호버가 GPL Dictionary 항목을 띄우기 위한 전제) ──────────────
test('내장 클래스 타입 로컬은 타입 이름으로 해석되고, 홀더로는 해석되지 않는다', () => {
    const lookup = lookupInOrg();
    // 사용자 클래스/모듈이 아니므로 홀더는 undefined — 종전 동작 유지
    assert.strictEqual(resolveReceiverHolder([{ name: 'saveThread' }], lookup), undefined);
    // 타입 이름은 얻을 수 있어야 내장 사전에서 Thread.Abort를 찾을 수 있다
    assert.strictEqual(resolveReceiverTypeName([{ name: 'saveThread' }], lookup), 'Thread');
});

test('resolveReceiverTypeName: 사용자 타입·배열 요소·Me·미해석', () => {
    const lookup = lookupInOrg();
    assert.strictEqual(resolveReceiverTypeName([{ name: 'arm' }], lookup), 'RobotArm');
    assert.strictEqual(resolveReceiverTypeName([{ name: 'robotArmList', args: '0' }], lookup), 'RobotArm');
    // 인덱싱 없는 배열은 내장 Array라 이름 해석에서도 제외(종전 규칙 유지)
    assert.strictEqual(resolveReceiverTypeName([{ name: 'robotArmList' }], lookup), undefined);
    assert.strictEqual(resolveReceiverTypeName([{ name: 'Me' }], lookup), 'RNDRobot');
    assert.strictEqual(resolveReceiverTypeName([{ name: 'n' }], lookup), undefined); // 원시 타입
    assert.strictEqual(resolveReceiverTypeName([{ name: 'nothingHere' }], lookup), undefined);
    assert.strictEqual(resolveReceiverTypeName([], lookup), undefined);
});

test('resolveReceiverTypeName: 여러 세그먼트는 사용자 심볼 체이닝 뒤 마지막 반환 타입', () => {
    const lookup = lookupInOrg();
    assert.strictEqual(
        resolveReceiverTypeName([{ name: 'Me' }, { name: 'thePointDataManager' }], lookup),
        'PointDataManager'
    );
    assert.strictEqual(
        resolveReceiverTypeName([{ name: 'Me' }, { name: 'thePointDataManager' }, { name: 'getLocation', args: '' }], lookup),
        'LocationEx'
    );
});

// ─── ownedByHolder: 한정자를 버리는 전역 이름 폴백의 안전한 대체품 ──────────────────────────
// 정의찾기가 `X.Run`의 멤버 해석에 실패했을 때, 종전에는 이름만으로 워크스페이스를 뒤져
// 무관한 Lib_MoveQueue.Run으로 점프했다. 이제 소속이 확인된 후보만 쓰고, 없으면 "정의 없음"이다.

test('ownedByHolder: 한정자에 속한 심볼만 — 다른 컨테이너의 동명 Sub로 새지 않는다', () => {
    const lookup = lookupInOrg();

    const owned = ownedByHolder(lookup, { kind: 'module', name: 'Lib_MoveQueue' }, 'Run');
    assert.strictEqual(owned.length, 1);
    assert.strictEqual(owned[0].filePath, 'Lib_MoveQueue.gpl');

    // 다른 모듈/클래스를 한정자로 주면 아무것도 나오지 않는다 → 호출부가 전역 폴백을 차단한다.
    assert.deepStrictEqual(ownedByHolder(lookup, { kind: 'module', name: 'JogModule' }, 'Run'), []);
    assert.deepStrictEqual(ownedByHolder(lookup, { kind: 'class', name: 'RobotArm' }, 'Run'), []);
    assert.deepStrictEqual(ownedByHolder(lookup, { kind: 'module', name: 'RobotModule' }, 'Run'), []);
});

test('ownedByHolder: 종류가 걸러지던 모듈 안 클래스(Module.Class)·중첩 클래스(Outer.Inner)도 찾는다', () => {
    const lookup = lookupInOrg();

    // 클래스 심볼은 className이 자기 자신이라 membersNamed(module)의 `!className` 조건에 걸린다.
    assert.deepStrictEqual(membersNamed(lookup, { kind: 'module', name: 'ZeroModule' }, 'ZeroPlan'), []);
    const inModule = ownedByHolder(lookup, { kind: 'module', name: 'ZeroModule' }, 'ZeroPlan');
    assert.strictEqual(inModule.length, 1);
    assert.strictEqual(inModule[0].kind, GPLSymbolKind.Class);

    // StepBatch는 ZeroPlan 안에 중첩 — 모듈 한정자로는 안 잡히고 클래스 한정자로 잡힌다.
    assert.deepStrictEqual(ownedByHolder(lookup, { kind: 'module', name: 'ZeroModule' }, 'StepBatch'), []);
    const nested = ownedByHolder(lookup, { kind: 'class', name: 'ZeroPlan' }, 'StepBatch');
    assert.strictEqual(nested.length, 1);
    assert.strictEqual(nested[0].parentClassName, 'ZeroPlan');
});

test('ownedByHolder: 클래스 멤버는 membersNamed 결과를 그대로 유지(중복 없음)', () => {
    const lookup = lookupInOrg();
    const owned = ownedByHolder(lookup, { kind: 'class', name: 'RobotArm' }, 'controlAxis');
    assert.strictEqual(owned.length, 1);
    assert.strictEqual(owned[0].kind, GPLSymbolKind.Property);
    assert.strictEqual(owned[0].className, 'RobotArm');
});

test('nestedTypesIn: 클래스 선언만 — 일반 멤버는 걸리지 않는다', () => {
    const lookup = lookupInOrg();
    assert.deepStrictEqual(nestedTypesIn(lookup, { kind: 'class', name: 'StepBatch' }, 'count'), []);
    assert.strictEqual(nestedTypesIn(lookup, { kind: 'class', name: 'ZeroPlan' }, 'StepBatch').length, 1);
});
