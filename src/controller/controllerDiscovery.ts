/**
 * 제어기 자동 검색 — SubnetSyncer의 UDP 브로드캐스트 방식 포팅.
 * 포트 51417로 브로드캐스트 패킷을 보내 응답하는 Brooks 제어기를 찾는다.
 */

import * as dgram from 'dgram';
import * as vscode from 'vscode';

const BROADCAST_PORT = 51417;
const DISCOVERY_TIMEOUT_MS = 3000;

// SubnetSyncer와 동일한 discovery 메시지
const DISCOVERY_MESSAGE = Buffer.from([0, 0, 255, 255, 0, 0, 0, 12, 0, 101, 0, 0]);

export interface DiscoveredController {
    ip: string;
    name: string;
    model: string;
    gplVersion: string;
}

/**
 * 네트워크에서 Brooks 제어기를 자동 검색.
 * UDP 브로드캐스트(포트 51417) 응답에서 PA 장비 정보를 파싱한다.
 */
export function discoverControllers(): Promise<DiscoveredController[]> {
    return new Promise((resolve) => {
        const results: DiscoveredController[] = [];
        const seen = new Set<string>();

        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        const timer = setTimeout(() => {
            socket.close();
            resolve(results);
        }, DISCOVERY_TIMEOUT_MS);

        socket.on('message', (msg, rinfo) => {
            if (seen.has(rinfo.address)) { return; }
            seen.add(rinfo.address);

            const text = msg.toString('ascii');
            // PA 장비 응답: "CN=name;MD=model;VR=version;..."
            if (text.includes('CN=') || text.includes('VR=')) {
                const parsed = parsePAResponse(text);
                results.push({
                    ip: rinfo.address,
                    name: parsed['CN'] || '',
                    model: parsed['MD'] || '',
                    gplVersion: parsed['VR'] || '',
                });
            }
        });

        socket.on('error', () => {
            clearTimeout(timer);
            socket.close();
            resolve(results);
        });

        socket.bind(BROADCAST_PORT, () => {
            socket.setBroadcast(true);
            socket.send(DISCOVERY_MESSAGE, BROADCAST_PORT, '255.255.255.255');
        });
    });
}

function parsePAResponse(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    const sections = text.split(';');
    for (const section of sections) {
        const eqIdx = section.indexOf('=');
        if (eqIdx > 0) {
            result[section.substring(0, eqIdx)] = section.substring(eqIdx + 1);
        }
    }
    return result;
}

/**
 * 검색 결과를 QuickPick으로 표시하여 사용자가 선택하게 한다.
 */
export async function showControllerPicker(): Promise<DiscoveredController | undefined> {
    const controllers = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Searching for controllers...' },
        () => discoverControllers()
    );

    if (controllers.length === 0) {
        const manual = await vscode.window.showInputBox({
            prompt: 'No controllers found. Enter IP address manually:',
            placeHolder: '192.168.0.2',
            validateInput: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? null : 'Invalid IP format',
        });
        if (manual) {
            return { ip: manual, name: '', model: '', gplVersion: '' };
        }
        return undefined;
    }

    const items = controllers.map(c => ({
        label: `$(server) ${c.ip}`,
        description: c.name || c.model || '',
        detail: `Model: ${c.model || 'N/A'} | GPL: ${c.gplVersion || 'N/A'}`,
        controller: c,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a controller to connect',
    });

    return selected?.controller;
}
