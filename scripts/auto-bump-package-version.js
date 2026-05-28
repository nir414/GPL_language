#!/usr/bin/env node

/**
 * Lightweight version bump for packaging.
 *
 * Unlike scripts/bump-version.js, this does not touch CHANGELOG.md.
 * It only keeps package.json and package-lock.json in sync before VSIX packaging.
 *
 * Usage:
 *   node scripts/auto-bump-package-version.js [major|minor|patch]
 */

const fs = require('fs');
const path = require('path');

const VALID_BUMPS = new Set(['major', 'minor', 'patch']);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4) + '\n');
}

function bumpVersion(version, bumpType) {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0)) {
        throw new Error(`Unsupported version format: ${version}`);
    }

    if (bumpType === 'major') {
        parts[0] += 1;
        parts[1] = 0;
        parts[2] = 0;
    } else if (bumpType === 'minor') {
        parts[1] += 1;
        parts[2] = 0;
    } else {
        parts[2] += 1;
    }

    return parts.join('.');
}

function updatePackageLock(lockPath, newVersion) {
    if (!fs.existsSync(lockPath)) {
        return false;
    }

    const lockJson = readJson(lockPath);
    lockJson.version = newVersion;
    if (lockJson.packages && lockJson.packages['']) {
        lockJson.packages[''].version = newVersion;
    }
    writeJson(lockPath, lockJson);
    return true;
}

function main() {
    const bumpType = process.argv[2] || 'patch';
    if (!VALID_BUMPS.has(bumpType)) {
        throw new Error(`Invalid bump type "${bumpType}". Use major, minor, or patch.`);
    }

    const repoRoot = path.resolve(__dirname, '..');
    const packagePath = path.join(repoRoot, 'package.json');
    const lockPath = path.join(repoRoot, 'package-lock.json');

    const packageJson = readJson(packagePath);
    const oldVersion = packageJson.version;
    const newVersion = bumpVersion(oldVersion, bumpType);

    packageJson.version = newVersion;
    writeJson(packagePath, packageJson);

    const lockUpdated = updatePackageLock(lockPath, newVersion);

    console.log(`Version bumped for packaging: ${oldVersion} -> ${newVersion}`);
    if (lockUpdated) {
        console.log('package-lock.json version synchronized.');
    }
}

main();
