/**
 * URI 진입점 토큰 파일 — `%TEMP%\gpl-controller\uri-token` (vscode 무의존, 2026-11-04 §1-GZ).
 *
 * 웹 페이지·문서 링크로 열린 `vscode://nir414.gpl-language-support/...` 가 제어기 명령을 실행하지 못하게, 조회 전용이 아닌 명령은
 * 이 파일의 값을 `token=` 쿼리로 함께 줘야 한다(판정은 uriDispatch.uriCommandNeedsToken·uriTokenMatches). 같은 PC 의
 * 터미널·에이전트는 파일을 읽을 수 있으므로 자동화를 막지 않는다.
 *
 * 값은 PC 사용자 단위로 하나다 — 창마다 새로 만들면 여러 VS Code 창이 서로의 토큰을 무효화한다. 이미 있으면 그대로 쓰고,
 * 없거나 모양이 틀리면 새로 만든다(임시 폴더를 지우면 다음 활성화 때 새 값이 생긴다).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENT_BRIDGE_DIR_NAME } from './agentBridge';

export const URI_TOKEN_FILE_NAME = 'uri-token';

const TOKEN_RE = /^[0-9a-f]{32}$/;

export function uriTokenPath(baseDir: string = os.tmpdir()): string {
    return path.join(baseDir, AGENT_BRIDGE_DIR_NAME, URI_TOKEN_FILE_NAME);
}

/** 토큰을 읽고, 없으면 만든다. 파일을 쓰지 못하면 undefined(토큰이 필요한 URI 명령은 모두 거부된다 — 닫힌 쪽으로 실패). */
export function ensureUriToken(baseDir: string = os.tmpdir()): string | undefined {
    const file = uriTokenPath(baseDir);
    try {
        const existing = fs.readFileSync(file, 'utf8').trim();
        if (TOKEN_RE.test(existing)) { return existing; }
    } catch { /* 없음 — 아래에서 만든다 */ }
    const token = crypto.randomBytes(16).toString('hex');
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, token, { encoding: 'utf8' });
        fs.renameSync(tmp, file);
        // 다른 창이 같은 순간에 먼저 만들었으면 그 값을 따른다(마지막 rename 이 이긴다 — 다시 읽어 맞춘다).
        const settled = fs.readFileSync(file, 'utf8').trim();
        return TOKEN_RE.test(settled) ? settled : token;
    } catch {
        return undefined;
    }
}
