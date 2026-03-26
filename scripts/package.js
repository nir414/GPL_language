// Package the VS Code extension into dist/ with a stable, versioned filename.
// This avoids shell-specific env var expansion differences across Windows/macOS/Linux.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            stdio: 'inherit',
            // On Windows, spawning .cmd (vsce.cmd, npx.cmd) requires shell.
            shell: process.platform === 'win32',
            ...opts
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
            }
        });
    });
}

function exists(p) {
    try {
        fs.accessSync(p);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const repoRoot = path.resolve(__dirname, '..');
    const pkgPath = path.join(repoRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    const distDir = path.join(repoRoot, 'dist');
    fs.mkdirSync(distDir, { recursive: true });

    const outFile = path.join(distDir, `gpl-language-support-${pkg.version}.vsix`);

    // Prefer the locally installed vsce binary from node_modules/.bin to avoid shell/OS differences.
    const vsceBin = path.join(
        repoRoot,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'vsce.cmd' : 'vsce'
    );

    if (exists(vsceBin)) {
        await run(vsceBin, ['package', '-o', outFile], { cwd: repoRoot });
    } else {
        // Fallback to npx if for some reason the local bin does not exist.
        // Use shell:true here to let Windows resolve npx.cmd reliably.
        const npx = process.platform === 'win32' ? 'npx' : 'npx';
        await new Promise((resolve, reject) => {
            const child = spawn(npx, ['vsce', 'package', '-o', outFile], {
                cwd: repoRoot,
                stdio: 'inherit',
                shell: true
            });
            child.on('error', reject);
            child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npx vsce package exited with code ${code}`))));
        });
    }

    console.log(`\nDONE: ${outFile}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
