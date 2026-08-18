#!/usr/bin/env node

/**
 * 릴리즈 전 검증 체크리스트
 * Usage: node scripts/pre-release-check.js
 * 
 * 릴리즈 전에 필수 조건들을 확인합니다.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const checks = [];
let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        const result = fn();
        if (result) {
            console.log(`✅ ${name}`);
            passed++;
            return true;
        } else {
            console.log(`❌ ${name}`);
            failed++;
            return false;
        }
    } catch (error) {
        console.log(`❌ ${name}: ${error.message}`);
        failed++;
        return false;
    }
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function gitCheck(command) {
    try {
        return execSync(command, { encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

console.log('\n🔍 Pre-Release Checklist\n');
console.log('=' .repeat(50));

// 1. package.json 존재 확인
check('package.json exists', () => {
    return fs.existsSync('package.json');
});

// 2. CHANGELOG.md 존재 확인
check('CHANGELOG.md exists', () => {
    return fs.existsSync('CHANGELOG.md');
});

// 3. package.json 버전 형식 확인
const packageJson = readJson('package.json');
const version = packageJson.version;
check(`package.json version is valid (${version})`, () => {
    return /^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/.test(version);
});

// 4. CHANGELOG에 현재 버전 존재 확인
check(`CHANGELOG contains version ${version}`, () => {
    const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
    return changelog.includes(`## [${version}]`);
});

// 4.5 README.md 버전 표기 대조 (v0.8.8 표기가 6릴리스 연속 방치됐던 사고 방지, ai-handoff §1-AZ)
check(`README.md version text matches v${version}`, () => {
    const readme = fs.readFileSync('README.md', 'utf8');
    const m = readme.match(/현재 버전:\s*\*\*v([\d.]+(?:-[a-z]+\.\d+)?)\*\*/);
    if (!m) throw new Error('README.md에서 "현재 버전: **vX.Y.Z**" 표기를 찾지 못함');
    if (m[1] !== version) throw new Error(`README=v${m[1]} != package.json=v${version}`);
    return true;
});

// 5. Git 상태 확인
const gitStatus = gitCheck('git status --porcelain');
check('Git working directory is clean', () => {
    return gitStatus === '';
});

// 6. Git 브랜치 확인
const currentBranch = gitCheck('git branch --show-current');
check(`On main branch (current: ${currentBranch})`, () => {
    return currentBranch === 'main';
});

// 7. npm dependencies 설치 확인
check('node_modules exists', () => {
    return fs.existsSync('node_modules');
});

// 8. TypeScript 컴파일 테스트
check('TypeScript compiles without errors', () => {
    try {
        execSync('npm run compile', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
});

// 9. 필수 파일 존재 확인
const requiredFiles = [
    'src/extension.ts',
    'syntaxes/gpl.tmGrammar.json',
    'language-configuration.json',
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml'
];

requiredFiles.forEach(file => {
    check(`Required file exists: ${file}`, () => {
        return fs.existsSync(file);
    });
});

// 10. scripts 폴더 확인
const requiredScripts = [
    'scripts/bump-version.js',
    'scripts/extract-changelog.js',
    'scripts/package.js'
];

requiredScripts.forEach(script => {
    check(`Required script exists: ${script}`, () => {
        return fs.existsSync(script);
    });
});

console.log('=' .repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
    console.log('✅ All checks passed! Ready to release.\n');
    console.log('Next steps:');
    console.log(`  1. git tag v${version}`);
    console.log(`  2. git push origin v${version}`);
    console.log('');
    process.exit(0);
} else {
    console.log('❌ Some checks failed. Please fix the issues before releasing.\n');
    process.exit(1);
}
