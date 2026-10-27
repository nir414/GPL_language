/**
 * 쓰레드가 Error 상태로 들어갔을 때 확장에 보내는 `gpl.errorLocation` 이벤트 — 정지 위치·Show Thread 상태·ErrorLog 앞부분·최근 스택.
 *
 * 확장(activation/debug/debugIntegration)이 이 이벤트로 에러 위치를 열고 트리/진단에 표시한다.
 *
 * `gplDebugSession.ts`(5,700줄) 에서 2026-10-27 에 분리했다. 세션 상태는 `DebugSessionIo` getter 로만 읽는다.
 */

import { Event } from '@vscode/debugadapter';
import { parseThreadDetail, parseErrorLog } from '../../controller/protocol/responseParser';
import type { DebugSessionIo } from './sessionIo';
import type { FrameCache } from './frameCache';

export class ErrorLocationReporter {
    constructor(private readonly io: DebugSessionIo, private readonly frames: FrameCache) {}

    private firstErrorSeenAtByThread = new Map<string, string>();

    async emitErrorLocationEvent(threadId: number, threadName: string, statusText: string): Promise<void> {
        const frames = await this.frames.getThreadFrames(threadName);
        const top = frames[0];
        const errorDetail = await this.getThreadErrorDetail(threadName, statusText);
        if (!this.firstErrorSeenAtByThread.has(threadName)) {
            this.firstErrorSeenAtByThread.set(threadName, new Date().toISOString());
        }
        const firstSeenAt = this.firstErrorSeenAtByThread.get(threadName);
        const stackFrames = frames
            .slice(0, 6)
            .map(f => `${f.process || '(unknown)'} @ ${f.file || '?'}:${f.fileLine || 0}`);
        const relatedFunctions = frames
            .map(f => (f.process || '').trim())
            .filter(Boolean)
            .filter((v, idx, arr) => arr.indexOf(v) === idx)
            .slice(0, 6);
        if (!top?.file || top.fileLine <= 0) {
            this.io.sendEvent(new Event('gpl.errorLocation', {
                threadId,
                threadName,
                statusText,
                errorCode: errorDetail.code,
                errorMessage: errorDetail.message,
                errorLogLines: errorDetail.errorLogLines,
                firstSeenAt,
                lastCommand: this.io.lastControllerCommand,
                stackFrames,
                relatedFunctions,
            }));
            return;
        }

        this.io.sendEvent(new Event('gpl.errorLocation', {
            threadId,
            threadName,
            file: top.file,
            line: top.fileLine,
            process: top.process,
            statusText,
            errorCode: errorDetail.code,
            errorMessage: errorDetail.message,
            errorLogLines: errorDetail.errorLogLines,
            firstSeenAt,
            lastCommand: this.io.lastControllerCommand,
            stackFrames,
            relatedFunctions,
        }));
    }

    private async getThreadErrorDetail(
        threadName: string,
        fallbackStatus: string,
    ): Promise<{ code?: number; message: string; errorLogLines: string[] }> {
        let code: number | undefined;
        let message = fallbackStatus && fallbackStatus !== 'Error' ? fallbackStatus : '';

        const detailResp = await this.io.sendCmd(`Show Thread ${threadName}`);
        const detail = detailResp ? parseThreadDetail(detailResp) : null;
        if (detail) {
            if (detail.statusCode !== 0) {
                code = detail.statusCode;
            }
            if (detail.statusMessage) {
                message = detail.statusMessage;
            }
        }

        let errorLogLines: string[] = [];
        const errorLogResp = await this.io.sendCmd('ErrorLog');
        if (errorLogResp) {
            errorLogLines = parseErrorLog(errorLogResp).slice(0, 5);
        }

        if (!message && errorLogLines.length > 0) {
            message = errorLogLines[0];
        }
        if (!message && typeof code === 'number') {
            message = `STATUS ${code}`;
        }
        if (!message) {
            message = fallbackStatus || 'Error';
        }

        return { code, message, errorLogLines };
    }
}
