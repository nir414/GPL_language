/**
 * Debug Adapter 등록 — DebugConfigurationProvider + InlineDebugAdapterFactory.
 */

import * as vscode from 'vscode';
import { GPLDebugSession } from './gplDebugSession';
import { pickProjectDirDetailed, projectNameOf } from '../controller/projectPicker';

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

        // 다중 프로젝트 워크스페이스에서 대상이 정해지지 않았으면 여기서(어댑터 시작 전, 확장 호스트) 묻는다.
        // 어댑터 안의 자동 감지는 사람에게 물을 수 없어 "경로 정렬 첫 번째" 폴백으로 떨어졌었다.
        if (config.type === 'brooks-gpl' && config.request === 'attach') {
            const proceed = await fillProjectTarget(config);
            if (!proceed) { return undefined; }
        }

        return config;
    }
}

/**
 * launch 구성의 projectDir/projectName을 공용 프로젝트 선택 규칙으로 채운다.
 * - projectDir 명시: 그대로(projectName만 비어 있으면 .gpr에서 보충).
 * - projectName만 명시 + deployBeforeAttach 아님: 폴더가 필요 없으므로 묻지 않는다.
 * - 그 외: 후보 1개면 자동, 2개 이상이면 QuickPick(projectName이 있으면 그 이름과 일치하는 폴더 안에서).
 *   사용자가 명시한 projectName은 덮어쓰지 않는다(제어기 쪽 이름을 의도적으로 지정한 경우 존중).
 * 반환 false = 사용자가 QuickPick을 취소 → 세션 시작 중단. 후보가 없으면 어댑터의 기존 폴백(Show Thread)에 맡긴다.
 */
async function fillProjectTarget(config: vscode.DebugConfiguration): Promise<boolean> {
    const explicitDir = typeof config.projectDir === 'string' && config.projectDir.trim() ? config.projectDir.trim() : '';
    const explicitName = typeof config.projectName === 'string' && config.projectName.trim() ? config.projectName.trim() : '';
    if (explicitDir) {
        if (!explicitName) { config.projectName = projectNameOf(explicitDir); }
        return true;
    }
    if (explicitName && !config.deployBeforeAttach) { return true; }

    const picked = await pickProjectDirDetailed({
        placeHolder: explicitName
            ? `'${explicitName}'로 배포할 프로젝트 폴더를 선택하세요 (같은 이름의 폴더가 여러 개)`
            : '디버그할 GPL 프로젝트를 선택하세요',
        projectName: explicitName || undefined,
        silent: true,
    });
    if (picked.kind === 'cancelled') { return false; }
    if (picked.kind !== 'picked') { return true; }

    config.projectDir = picked.dir;
    if (!explicitName) { config.projectName = projectNameOf(picked.dir); }
    return true;
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new GPLDebugSession());
    }
}
