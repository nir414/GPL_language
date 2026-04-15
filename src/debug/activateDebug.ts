/**
 * Debug Adapter 등록 — DebugConfigurationProvider + InlineDebugAdapterFactory.
 */

import * as vscode from 'vscode';
import { GPLDebugSession } from './gplDebugSession';

export function activateDebug(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(
            'brooks-gpl',
            new GPLDebugConfigurationProvider(),
        ),
    );

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            'brooks-gpl',
            new InlineDebugAdapterFactory(),
        ),
    );
}

class GPLDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // launch.json이 비어 있거나 없을 때 기본 attach 설정 제공
        if (!config.type && !config.request && !config.name) {
            config.type = 'brooks-gpl';
            config.request = 'attach';
            config.name = 'Attach to GPL Controller';
        }
        return config;
    }
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new GPLDebugSession());
    }
}
