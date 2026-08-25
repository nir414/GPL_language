// controller-mcp(MCP 서버)를 esbuild로 단일 CJS 파일로 번들해 out/mcp/ 에 둔다.
// 목적: VSIX에 서버를 동봉("확장 설치 = 서버 배포")하기 위함. node_modules를
// 통째로 싣지 않으므로 과거의 유닉스 심링크 EACCES/용량 문제가 발생하지 않는다.
//
// 산출물: out/mcp/gpl-controller-mcp.cjs  (VSIX에 포함 — .vscodeignore가 out/를 허용)
// 소비자: src/ai/exportAgentSetup.ts 의 `GPL: Export AI Agent Setup` 명령이
//         이 파일을 globalStorage(버전 무관 안정 경로)로 복사해 .mcp.json이 가리키게 한다.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const entry = path.join(repoRoot, 'controller-mcp', 'src', 'index.js');
const depsDir = path.join(repoRoot, 'controller-mcp', 'node_modules');
const outFile = path.join(repoRoot, 'out', 'mcp', 'gpl-controller-mcp.cjs');

if (!fs.existsSync(entry)) {
    console.error(`ERROR: MCP 서버 엔트리가 없습니다: ${entry}`);
    process.exit(1);
}

if (!fs.existsSync(depsDir)) {
    console.error(
        'ERROR: controller-mcp/node_modules 가 없어 번들할 수 없습니다.\n' +
        '  해결: Windows에서 `cd controller-mcp && npm install` 후 다시 실행.\n' +
        '  (리눅스/WSL에서 install 금지 — 유닉스 심링크가 vsce package를 깨뜨림. CLAUDE.md 하드 규칙 5)'
    );
    process.exit(1);
}

const esbuild = require('esbuild');

// 빌드 스탬프(GitHub #23): 확장 버전·빌드 시각·git sha를 번들 안(define → index.js BUILD)과 사이드카
// out/mcp/gpl-controller-mcp.build.json에 함께 기록한다. 서버 stderr ready 줄·get_session_log·controller_status.server와
// 확장의 `GPL: Check AI Agent Setup`이 "지금 어느 번들인가"를 이 값으로 판별한다(McpServer version은 늘 0.1.0이어서 구별이 안 됐음).
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
let gitSha = null;
try {
    gitSha = execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
} catch { /* git 없음/비저장소 — 스탬프에서 생략 */ }
const build = { version: pkg.version, builtAt: new Date().toISOString(), gitSha, bundled: true };
const buildInfoFile = outFile.replace(/\.cjs$/, '.build.json');

esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: outFile,
    logLevel: 'info',
    define: {
        __GPL_MCP_BUILD_JSON__: JSON.stringify(JSON.stringify(build)),
    },
    banner: {
        js: `// bundled from controller-mcp/src by scripts/bundle-mcp.js — do not edit; stdout은 MCP 전송 채널(로그는 stderr만)\n// build: v${build.version} ${gitSha ?? ''} ${build.builtAt}`,
    },
}).then(() => {
    fs.writeFileSync(buildInfoFile, JSON.stringify(build, null, 2) + '\n');
    const size = fs.statSync(outFile).size;
    console.log(`bundle:mcp DONE: ${path.relative(repoRoot, outFile)} (${Math.round(size / 1024)} KB) — v${build.version} ${gitSha ?? ''} ${build.builtAt}`);
}).catch((err) => {
    console.error('bundle:mcp FAILED:', err);
    process.exit(1);
});
