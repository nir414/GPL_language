// Package the VS Code extension into dist/ with a stable, versioned filename.
//
// Responsibilities:
//   1. Preflight: detect broken/Unix-style symlinks before vsce scans files.
//      (A Linux-side `npm install` can leave Unix symlinks, e.g. in
//      controller-mcp/node_modules/.bin, which fail on Windows with
//      "EACCES: permission denied, scandir ...".)
//   2. Optional version bump (--bump major|minor|patch). If packaging fails,
//      package.json / package-lock.json are restored so a failed run does not
//      waste a version number.
//   3. Run vsce via Node directly (node node_modules/@vscode/vsce/vsce),
//      which behaves identically on Windows/macOS/Linux and avoids the
//      shell:true DEP0190 deprecation warning.
//
// Note: `vsce package` triggers "vscode:prepublish" -> "npm run compile",
// so this script must NOT compile beforehand (it would compile twice).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            stdio: 'inherit',
            cwd: repoRoot,
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

// --- 1. Preflight -----------------------------------------------------------

// Top-level directories that never need scanning (root node_modules is
// managed by npm on this machine; .git/.history are ignored by vsce anyway).
const PREFLIGHT_SKIP_AT_ROOT = new Set(['.git', '.history', 'node_modules', 'out', 'dist']);

function preflight() {
    const problems = [];
    const stack = [repoRoot];

    while (stack.length > 0) {
        const dir = stack.pop();

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            problems.push(`${path.relative(repoRoot, dir)}  (unreadable directory: ${err.code})`);
            continue;
        }

        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (dir === repoRoot && PREFLIGHT_SKIP_AT_ROOT.has(entry.name)) {
                continue;
            }

            try {
                if (entry.isSymbolicLink()) {
                    // vsce follows symlinks; a broken or Unix-created link
                    // breaks the scan on Windows (EACCES on scandir).
                    fs.realpathSync(full);
                    fs.statSync(full);
                } else if (entry.isDirectory()) {
                    stack.push(full);
                }
            } catch (err) {
                problems.push(`${path.relative(repoRoot, full)}  (broken/unreadable symlink: ${err.code})`);
            }
        }
    }

    if (problems.length > 0) {
        console.error('\nERROR: preflight found entries that will break "vsce package":\n');
        for (const p of problems) {
            console.error(`  - ${p}`);
        }
        console.error(
            '\nThese are usually left behind by running "npm install" from a Linux/WSL environment.\n' +
            'Fix: delete the listed entries (or their containing node_modules) and, if that\n' +
            'sub-project is needed, re-run "npm install" there from Windows.\n'
        );
        process.exit(1);
    }
}

// --- 2. Optional version bump with rollback ---------------------------------

function snapshotVersionFiles() {
    const files = ['package.json', 'package-lock.json']
        .map((name) => path.join(repoRoot, name))
        .filter(exists);
    return files.map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }));
}

function restoreVersionFiles(snapshots) {
    for (const { file, content } of snapshots) {
        fs.writeFileSync(file, content);
    }
}

// --- 3. Package -------------------------------------------------------------

async function runVsce(outFile) {
    // Prefer vsce's JS entry point run through the current Node executable.
    // This avoids .cmd wrappers and shell:true entirely.
    const vsceMain = path.join(repoRoot, 'node_modules', '@vscode', 'vsce', 'vsce');

    if (exists(vsceMain)) {
        await run(process.execPath, [vsceMain, 'package', '-o', outFile]);
    } else {
        // Fallback to npx if the local install is missing.
        // NOTE: args 배열 + shell:true 조합은 DEP0190이고 공백 포함 경로가 깨진다 —
        // 출력 경로를 인용한 단일 명령 문자열로 실행한다 (Windows에서 npx는 셸 필요).
        const quotedOut = `"${String(outFile).replace(/"/g, '\\"')}"`;
        await run(`npx vsce package -o ${quotedOut}`, [], { shell: true });
    }
}

async function main() {
    const args = process.argv.slice(2);
    const bumpIndex = args.indexOf('--bump');
    const bumpType = bumpIndex !== -1 ? (args[bumpIndex + 1] || 'patch') : null;

    preflight();

    const snapshots = snapshotVersionFiles();

    try {
        // bump 도중 실패해도 package.json/package-lock.json 스냅샷이 복원되도록
        // bump 실행 자체도 try 안에서 수행한다.
        if (bumpType) {
            await run(process.execPath, [path.join(__dirname, 'auto-bump-package-version.js'), bumpType]);
        }

        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

        const distDir = path.join(repoRoot, 'dist');
        fs.mkdirSync(distDir, { recursive: true });

        const outFile = path.join(distDir, `gpl-language-support-${pkg.version}.vsix`);
        await runVsce(outFile);

        console.log(`\nDONE: ${outFile}`);
    } catch (err) {
        if (bumpType) {
            restoreVersionFiles(snapshots);
            console.error('\nPackaging failed — version bump was reverted.');
        }
        throw err;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
