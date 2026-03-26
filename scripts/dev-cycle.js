const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function fail(message, extra) {
  console.error(message);
  if (extra) console.error(extra);
  process.exit(1);
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (res.error) {
    fail(`[dev:cycle] Command error: ${cmd} ${args.join(' ')}`, res.error.message);
  }

  if (typeof res.status !== 'number' || res.status !== 0) {
    fail(`[dev:cycle] Command failed: ${cmd} ${args.join(' ')} (exit ${String(res.status)})`);
  }
}

function getNpmCommand(root) {
  return 'npm';
}

function main() {
  const root = path.resolve(__dirname, '..');
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version || '0.0.0';

  const npm = getNpmCommand(root);

  // 1) compile
  run(npm, ['run', 'compile'], root);

  // 2) package (creates dist/gpl-language-support-vX.Y.Z.vsix)
  run(npm, ['run', 'package'], root);

  const vsix = path.join(root, 'dist', `gpl-language-support-v${version}.vsix`);
  if (!fs.existsSync(vsix)) {
    fail(`[dev:cycle] VSIX not found after packaging: ${vsix}`);
  }

  console.log('[dev:cycle] Done (compile → package). Auto-install is disabled to avoid opening VS Code windows.');
  console.log(`[dev:cycle] VSIX path: ${vsix}`);
}

main();
