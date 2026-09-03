// Lightweight cleanup script for this VS Code extension repo.
// - Default: remove build artifacts and packaging outputs
// - --hard: also remove node_modules (heavier, requires reinstall)

const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const hard = args.has('--hard');

const repoRoot = path.resolve(__dirname, '..');

function rm(relPath) {
    const abs = path.join(repoRoot, relPath);
    if (!fs.existsSync(abs)) return;

    // Safety: only delete paths inside repo root.
    const real = fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs);
    const rootReal = fs.realpathSync.native ? fs.realpathSync.native(repoRoot) : fs.realpathSync(repoRoot);
    if (!real.startsWith(rootReal)) {
        throw new Error(`Refusing to delete outside repo: ${relPath}`);
    }

    removeRecursive(abs);
    console.log(`Removed: ${relPath}`);
}

// ASCII 전용 경로인지 — fs.rmSync 를 쓸 수 있는지 판정한다(아래 removeRecursive 주석 참조).
function isAsciiPath(p) {
    for (let i = 0; i < p.length; i++) {
        if (p.charCodeAt(i) > 0x7f) return false;
    }
    return true;
}

/**
 * 재귀 삭제. Node v24.11.1(Windows)에서 `fs.rmSync()`의 **경로 인자에 비ASCII 문자가 있으면**
 * 예외도 exit 이벤트도 없이 프로세스가 0xC0000409(STATUS_STACK_BUFFER_OVERRUN)로 죽는다
 * (ai-handoff §1-CN 실측 — 파일/디렉터리·force/recursive 무관, 2026-09-02 재확인).
 * 인자 자체가 ASCII면 하위에 한글 폴더가 있어도 안전하므로, ASCII 경로는 빠른 native 경로를 그대로 쓰고
 * 비ASCII 경로만 unlinkSync/rmdirSync 로 직접 내려간다(이 둘과 readdirSync/lstatSync 는 비ASCII 에서도 정상).
 * → 저장소를 한글 경로에 클론해도 `npm run clean`이 죽지 않는다.
 */
function removeRecursive(abs) {
    if (isAsciiPath(abs)) {
        fs.rmSync(abs, { recursive: true, force: true });
        return;
    }
    let st;
    try {
        st = fs.lstatSync(abs);
    } catch (e) {
        if (e && e.code === 'ENOENT') return;   // force: true 와 같은 관용
        throw e;
    }
    if (st.isDirectory() && !st.isSymbolicLink()) {
        for (const name of fs.readdirSync(abs)) {
            removeRecursive(path.join(abs, name));
        }
        fs.rmdirSync(abs);
        return;
    }
    fs.unlinkSync(abs);   // 파일·심링크(디렉터리 심링크는 대상까지 따라가지 않는다)
}

function rmRootVsixFiles() {
    const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.toLowerCase().endsWith('.vsix')) continue;
        const rel = e.name;
        rm(rel);
    }
}

// Build / test / packaging artifacts
rm('out');
rm('dist');
rm('.vscode-test');
rmRootVsixFiles();

// Local editor/tooling caches
rm('.history');

if (hard) {
    rm('node_modules');
}

console.log('Clean done' + (hard ? ' (hard)' : ''));
