#!/usr/bin/env node

/**
 * CHANGELOG에서 특정 버전의 릴리즈 노트를 추출하는 스크립트
 * Usage: node scripts/extract-changelog.js <version>
 * Example: node scripts/extract-changelog.js 0.2.13
 */

const fs = require('fs');
const path = require('path');

function extractChangelogForVersion(version) {
    const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
    
    if (!fs.existsSync(changelogPath)) {
        console.error('❌ CHANGELOG.md not found');
        process.exit(1);
    }
    
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    const lines = changelog.split('\n');
    
    // ## [버전] 패턴 찾기
    const versionHeaderPattern = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`);
    const startIndex = lines.findIndex(line => versionHeaderPattern.test(line));
    
    if (startIndex === -1) {
        console.warn(`⚠️  Version [${version}] not found in CHANGELOG.md`);
        return null;
    }
    
    // 다음 ## [ 패턴까지 또는 파일 끝까지
    let endIndex = lines.findIndex((line, idx) => 
        idx > startIndex && /^## \[/.test(line)
    );
    
    if (endIndex === -1) {
        endIndex = lines.length;
    }
    
    // 버전 헤더 제외하고 내용만 추출
    const content = lines.slice(startIndex + 1, endIndex)
        .join('\n')
        .trim();
    
    return content;
}

function main() {
    const version = process.argv[2];
    
    if (!version) {
        console.error('Usage: node scripts/extract-changelog.js <version>');
        console.error('Example: node scripts/extract-changelog.js 0.2.13');
        process.exit(1);
    }
    
    const content = extractChangelogForVersion(version);
    
    if (content) {
        console.log(content);
    } else {
        // 버전을 찾지 못한 경우 기본 메시지
        console.log(`Release ${version}`);
        console.log('');
        console.log('See [CHANGELOG.md](https://github.com/nir414/GPL_language/blob/main/CHANGELOG.md) for details.');
    }
}

main();
