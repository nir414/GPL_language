import * as assert from 'assert';
import { test } from './harness';
import {
    classifyConsoleCommand,
    formatConsoleCommandClassification,
} from '../controller/consoleCommandClassifier';

test('console command classifier marks observed packet commands', () => {
    assert.deepStrictEqual(classifyConsoleCommand('PD 234,-1,0,0'), {
        commandName: 'pd',
        category: 'parameter',
        impact: 'read-only',
        detail: 'parameter database read',
    });

    assert.deepStrictEqual(classifyConsoleCommand('PC(1700,0,0,1)=""'), {
        commandName: 'pc',
        category: 'parameter',
        impact: 'state-changing',
        detail: 'parameter database write',
    });

    assert.deepStrictEqual(classifyConsoleCommand('Show Thread  -web'), {
        commandName: 'show',
        category: 'debug',
        impact: 'read-only',
        detail: 'thread state',
    });

    assert.strictEqual(
        formatConsoleCommandClassification('COMPILE MergeCode'),
        'state-changing/project/compile',
    );
    assert.strictEqual(
        formatConsoleCommandClassification('Start Mergecode -event'),
        'state-changing/project/start',
    );
    assert.strictEqual(
        formatConsoleCommandClassification('Stop -a'),
        'state-changing/runtime/stop',
    );
});

test('console command classifier marks destructive commands', () => {
    assert.strictEqual(
        formatConsoleCommandClassification('Format /flash'),
        'destructive/file/format',
    );
    assert.strictEqual(
        formatConsoleCommandClassification('SoftEStop'),
        'destructive/runtime/softestop',
    );
    assert.strictEqual(
        formatConsoleCommandClassification('Shutdown'),
        'destructive/system/shutdown',
    );
});
