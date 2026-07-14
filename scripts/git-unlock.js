#!/usr/bin/env node
/**
 * git-unlock.js — .git 의 stale 락 파일을 안전하게 감지/제거한다.
 *
 * 배경: git 은 인덱스에 쓰기(add/commit/reset 등) 전에 .git/index.lock 을 만들고
 * 끝나면 지운다. 프로세스가 중간에 강제 종료/크래시/AV 간섭 등으로 중단되면 락이
 * 남고, 이후 모든 쓰기 명령이 "Unable to create '.../index.lock': File exists" 로
 * 실패한다. 이 스크립트는 "실행 중인 git 프로세스가 없을 때만" 락을 지워
 * 살아있는 작업을 절대 깨뜨리지 않는다.
 *
 * 사용:
 *   node scripts/git-unlock.js          # 안전 모드(권장): git 프로세스 없을 때만 제거
 *   node scripts/git-unlock.js --check  # 상태만 출력, 아무것도 지우지 않음
 *   node scripts/git-unlock.js --force  # git 프로세스 확인을 건너뛰고 강제 제거
 *
 * npm:  npm run git:unlock  /  npm run git:unlock -- --check
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const FORCE = args.includes('--force');

// 이 락 파일보다 최근에 만들어졌으면(=몇 초 이내) 실행 중인 작업일 수 있으니
// git 프로세스가 안 보여도 지우지 않는다(레이스 방지). --force 로 무시 가능.
const MIN_AGE_SECONDS = 5;

function findGitDir(startDir) {
  let dir = startDir;
  // 최상위까지 올라가며 .git 을 찾는다.
  for (;;) {
    const gitPath = path.join(dir, '.git');
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) return gitPath;
      // worktree/submodule: .git 이 "gitdir: <path>" 파일인 경우
      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, 'utf8').trim();
        const m = content.match(/^gitdir:\s*(.+)$/m);
        if (m) return path.resolve(dir, m[1].trim());
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 현재 실행 중인 git 프로세스가 있는지 검사(플랫폼별). 실패 시 null(=불확실). */
function gitProcessRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq git.exe" /NH', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return /git\.exe/i.test(out);
    }
    const out = execSync('ps -e -o comm=', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').some((l) => l.trim() === 'git' || l.trim().endsWith('/git'));
  } catch {
    return null; // 검사 자체가 실패 → 불확실
  }
}

function ageSeconds(file) {
  try {
    return (Date.now() - fs.statSync(file).mtimeMs) / 1000;
  } catch {
    return Infinity;
  }
}

function main() {
  const gitDir = findGitDir(process.cwd());
  if (!gitDir) {
    console.error('✗ .git 디렉터리를 찾지 못했습니다. 리포지토리 안에서 실행하세요.');
    process.exit(1);
  }

  // git 이 남길 수 있는 대표적인 락 파일들.
  const lockNames = ['index.lock', 'HEAD.lock', 'config.lock', 'shallow.lock'];
  const locks = lockNames
    .map((n) => path.join(gitDir, n))
    .filter((p) => fs.existsSync(p));

  if (locks.length === 0) {
    console.log('✓ 락 파일이 없습니다. 정상 상태입니다.');
    return;
  }

  console.log(`발견된 락 파일 ${locks.length}개:`);
  for (const l of locks) {
    console.log(`  - ${path.relative(process.cwd(), l)}  (${ageSeconds(l).toFixed(0)}s 전)`);
  }

  const running = gitProcessRunning();
  if (running === true && !FORCE) {
    console.error('\n✗ 실행 중인 git 프로세스가 있습니다. 살아있는 작업일 수 있어 제거하지 않습니다.');
    console.error('  git 명령이 끝나길 기다리거나, 확실히 stale 이면 --force 로 강제 제거하세요.');
    process.exit(2);
  }

  if (CHECK_ONLY) {
    console.log('\n(--check) 상태만 확인했습니다. 제거하지 않았습니다.');
    if (running === null) console.log('  참고: git 프로세스 검사에 실패했습니다(불확실).');
    return;
  }

  let removed = 0;
  for (const l of locks) {
    const age = ageSeconds(l);
    if (!FORCE && age < MIN_AGE_SECONDS) {
      console.error(`  ! ${path.basename(l)} 는 ${age.toFixed(1)}s 전에 생성됨 — 진행 중일 수 있어 건너뜀 (--force 로 강제).`);
      continue;
    }
    fs.unlinkSync(l);
    console.log(`  ✓ 제거: ${path.basename(l)}`);
    removed++;
  }

  if (removed > 0) {
    console.log(`\n완료. ${removed}개의 stale 락을 제거했습니다. 이제 git 명령을 다시 실행하세요.`);
  } else {
    console.log('\n제거한 락이 없습니다.');
  }
}

main();
