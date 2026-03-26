#!/usr/bin/env node

/**
 * 버전 범프 헬퍼 스크립트
 * Usage: node scripts/bump-version.js [major|minor|patch]
 * 
 * - package.json의 버전을 업데이트
 * - CHANGELOG.md에 새 버전 섹션 추가
 */

const fs = require('fs');
const path = require('path');

const VALID_BUMPS = ['major', 'minor', 'patch'];

function showUsage() {
    console.log('Usage: node scripts/bump-version.js [major|minor|patch]');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/bump-version.js patch   # 0.2.12 -> 0.2.13');
    console.log('  node scripts/bump-version.js minor   # 0.2.12 -> 0.3.0');
    console.log('  node scripts/bump-version.js major   # 0.2.12 -> 1.0.0');
}

function bumpVersion(version, bumpType) {
    const parts = version.split('.').map(Number);
    
    switch (bumpType) {
        case 'major':
            parts[0]++;
            parts[1] = 0;
            parts[2] = 0;
            break;
        case 'minor':
            parts[1]++;
            parts[2] = 0;
            break;
        case 'patch':
            parts[2]++;
            break;
    }
    
    return parts.join('.');
}

function getTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function updatePackageJson(newVersion) {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const oldVersion = packageJson.version;
    
    packageJson.version = newVersion;
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 4) + '\n');
    
    console.log(`✅ package.json updated: ${oldVersion} -> ${newVersion}`);
    return oldVersion;
}

function updateChangelog(newVersion) {
    const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    
    // 이미 해당 버전이 있는지 확인
    if (changelog.includes(`## [${newVersion}]`)) {
        console.log(`⚠️  CHANGELOG.md already contains version ${newVersion}`);
        return;
    }
    
    const today = getTodayDate();
    const newSection = `## [${newVersion}] - ${today}\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Removed\n\n`;
    
    // "# Changelog" 뒤의 첫 번째 "## [" 섹션 앞에 삽입
    const lines = changelog.split('\n');
    
    // ## [ 패턴을 찾되, "# Changelog" 헤더 이후부터 검색
    let insertIndex = -1;
    let foundHeader = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // "# Changelog" 또는 비슷한 헤더 찾기
        if (!foundHeader && /^#\s+Changelog/i.test(line)) {
            foundHeader = true;
            continue;
        }
        
        // 헤더를 찾은 후 첫 번째 버전 섹션 찾기
        if (foundHeader && /^## \[/.test(line)) {
            insertIndex = i;
            break;
        }
    }
    
    if (insertIndex === -1) {
        // "## [" 패턴을 찾지 못하면 파일 끝에 추가
        console.log('⚠️  No existing version sections found, appending to end');
        fs.appendFileSync(changelogPath, '\n' + newSection);
    } else {
        // 적절한 위치에 삽입 (빈 줄 하나 추가)
        lines.splice(insertIndex, 0, newSection.trimEnd(), '');
        fs.writeFileSync(changelogPath, lines.join('\n'));
    }
    
    console.log(`✅ CHANGELOG.md updated with version ${newVersion}`);
    console.log(`   Date: ${today}`);
    console.log(`   Edit CHANGELOG.md to document your changes`);
}

function main() {
    const bumpType = process.argv[2];
    
    if (!bumpType || !VALID_BUMPS.includes(bumpType)) {
        showUsage();
        process.exit(1);
    }
    
    // 현재 버전 읽기
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const currentVersion = packageJson.version;
    
    // 새 버전 계산
    const newVersion = bumpVersion(currentVersion, bumpType);
    
    console.log(`\nBumping version: ${currentVersion} -> ${newVersion} (${bumpType})\n`);
    
    // package.json 업데이트
    updatePackageJson(newVersion);
    
    // CHANGELOG.md 업데이트
    updateChangelog(newVersion);
    
    console.log('\n✅ Version bump complete!');
    console.log('\nNext steps:');
    console.log('  1. Edit CHANGELOG.md to document changes');
    console.log('  2. Review the changes: git diff');
    console.log('  3. Commit: git add package.json CHANGELOG.md');
    console.log(`  4. Commit: git commit -m "chore: bump version to ${newVersion}"`);
    console.log('  5. Push: git push origin main');
    console.log(`  6. Tag: git tag v${newVersion}`);
    console.log(`  7. Push tag: git push origin v${newVersion}`);
}

main();
