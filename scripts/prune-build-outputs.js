const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const keyOf = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const isInside = (root, file) => {
    const relative = path.relative(root, file);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/** 현재 tsconfig의 emit 목록에서 빠진 JavaScript·소스맵만 제거한다. */
function pruneBuildOutputs(projectDir) {
    const root = fs.realpathSync(projectDir);
    const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: diagnostic => {
            throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        },
    });
    if (!config || config.errors.length > 0) {
        throw new Error((config?.errors ?? []).map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
    }
    const outputDir = config.options.outDir;
    if (!outputDir || !isInside(root, outputDir) || config.fileNames.some(file => isInside(outputDir, file))) {
        throw new Error('Refusing to prune outputs outside a dedicated project output directory');
    }
    if (!fs.existsSync(outputDir)) { return []; }
    const realOutputDir = fs.realpathSync(outputDir);
    if (fs.lstatSync(outputDir).isSymbolicLink() || keyOf(realOutputDir) !== keyOf(outputDir) || !isInside(root, realOutputDir)) {
        throw new Error('Refusing to prune a linked output directory');
    }

    const expected = new Set(config.fileNames.flatMap(file =>
        ts.getOutputFileNames(config, file, process.platform === 'win32').map(keyOf)));
    const stale = [];
    function scan(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) { throw new Error(`Refusing to follow output link: ${file}`); }
            if (entry.isDirectory()) { scan(file); }
            else if (/\.js(?:\.map)?$/i.test(entry.name) && !expected.has(keyOf(file))) { stale.push(file); }
        }
    }
    // 전체 경로를 검증한 뒤 삭제한다. 별도 번들(.cjs)·리소스·다른 산출물은 그대로 둔다.
    scan(outputDir);
    for (const file of stale) { fs.unlinkSync(file); }
    return stale.map(file => path.relative(root, file));
}

module.exports = { pruneBuildOutputs };

if (require.main === module) {
    try {
        const removed = pruneBuildOutputs(path.resolve(__dirname, '..'));
        console.log(`Build outputs: removed ${removed.length} stale JavaScript/source-map files.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
