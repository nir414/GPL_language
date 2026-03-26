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

    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`Removed: ${relPath}`);
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
