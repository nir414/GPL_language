import * as assert from 'assert';
import { test } from './harness';
import {
    STATUS_CONTROLLER_BUSY,
    STATUS_PROJECT_ALREADY_LOADED,
    TRANSIENT_COMPILE_STATUS_CODES,
    PROJECT_NOT_LOADED_STATUS_CODES,
    isBusyStatus,
    isTransientCompileStatus,
    isProjectAlreadyLoaded,
    isProjectNotLoaded,
} from '../controller/controllerStatusCodes';

// 펌웨어 의존 매직넘버가 리팩터링 중 바뀌지 않도록 값 자체를 고정한다.
test('status code 상수 값 고정', () => {
    assert.strictEqual(STATUS_CONTROLLER_BUSY, -752);
    assert.strictEqual(STATUS_PROJECT_ALREADY_LOADED, -745);
    assert.deepStrictEqual([...TRANSIENT_COMPILE_STATUS_CODES].sort((a, b) => a - b), [-752, -746, -742]);
    assert.deepStrictEqual([...PROJECT_NOT_LOADED_STATUS_CODES].sort((a, b) => a - b), [-743, -508]);
});

test('isBusyStatus', () => {
    assert.strictEqual(isBusyStatus(-752), true);
    assert.strictEqual(isBusyStatus(-745), false);
    assert.strictEqual(isBusyStatus(0), false);
});

test('isTransientCompileStatus', () => {
    assert.strictEqual(isTransientCompileStatus(-742), true);
    assert.strictEqual(isTransientCompileStatus(-746), true);
    assert.strictEqual(isTransientCompileStatus(-752), true);
    assert.strictEqual(isTransientCompileStatus(-745), false);
});

test('isProjectAlreadyLoaded / isProjectNotLoaded', () => {
    assert.strictEqual(isProjectAlreadyLoaded(-745), true);
    assert.strictEqual(isProjectAlreadyLoaded(-508), false);
    assert.strictEqual(isProjectNotLoaded(-508), true);
    assert.strictEqual(isProjectNotLoaded(-743), true);
    assert.strictEqual(isProjectNotLoaded(-745), false);
});
