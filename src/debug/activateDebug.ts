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
    async resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken,
    ): Promise<vscode.DebugConfiguration | undefined> {
        // launch.json이 비어 있거나 없을 때 기본 attach 설정 제공
        if (!config.type && !config.request && !config.name) {
            config.type = 'brooks-gpl';
            config.request = 'attach';
            config.name = 'Attach to GPL Controller';
        }

        // 중복 세션 방지: 이미 brooks-gpl 세션이 활성 상태이면 새 세션 시작을 차단.
        // (제어기는 단일 디버그 클라이언트만 의미가 있으므로 동시 세션이 만들어지면
        //  호출 스택이 중복으로 보이고 명령 직렬화도 깨진다.)
        const active = vscode.debug.activeDebugSession;
        if (config.type === 'brooks-gpl' && active?.type === 'brooks-gpl') {
            const pick = await vscode.window.showWarningMessage(
                'GPL 디버그 세션이 이미 실행 중입니다.',
                { modal: false },
                '기존 세션 유지',
                '중단하고 다시 시작',
            );
            if (pick === '중단하고 다시 시작') {
                try {
                    await vscode.debug.stopDebugging(active);
                    await new Promise(r => setTimeout(r, 400));
                } catch {
                    // 무시
                }
                return config;
            }
            // 기본: 기존 세션 유지 → 새 세션 시작 차단
            return undefined;
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
