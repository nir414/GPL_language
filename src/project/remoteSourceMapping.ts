/**
 * 제어기 원격 사본(`/GPL/<프로젝트>/…`)과 로컬 프로젝트의 대응 — 순수 로직(vscode 무의존).
 *
 * 배경(2026-10-26 Sample Prep 보고 「원격 GPL 파일 정의 찾기」): FTP 트리에서 연 원격 사본은 작업공간의 어떤 `.gpr` 에도
 * 속하지 않아, 원격 언어 서비스(activation/controllerSourceLanguage.ts)는 **열어 본 원격 파일만** 인덱싱했다. 다른 파일의
 * 모듈(`MSC.OnErr` 가 `Msc.gpl` 에 있는 경우)로는 이동하지 못했고, 매번 원격 파일을 하나씩 열어야 했다.
 *
 * 규칙:
 *  - 원격 경로의 **루트 바로 아래 폴더 이름**이 프로젝트 이름이다(제어기 `/GPL/<ProjectName>` 규약 — CLAUDE.md §하드 규칙 7).
 *  - 로컬 후보는 ① 이 창이 마지막으로 그 프로젝트를 컴파일 확정한 출처(deploy record `projectDir`) ② 작업공간 `.gpr` 중
 *    `ProjectName` 이 같은 것 ③ 폴더 이름이 같은 것 순으로 고른다. ②③에서 후보가 여럿이면 고르지 않는다(엉뚱한 과제 폴더로
 *    섞지 않는다 — compileUnit.ts 와 같은 원칙).
 *  - 매핑된 로컬 프로젝트의 컴파일 단위(자기 소스 + ProjectLibrary 재귀)를 원격 세션 캐시에 **씨앗**으로 넣는다. 열어 본 원격
 *    파일은 같은 파일 점수(SCORE_SAME_FILE)로 로컬 사본보다 앞선다.
 *
 * 단위 테스트: src/test/remoteSourceMapping.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseGprText } from './gprSync';
import { buildLibraryGraph, collectProjectSourcePaths, gprPathInDir } from './projectSources';

export interface RemoteProjectLocation {
    /** 루트 바로 아래 폴더 이름 = 제어기 프로젝트 이름. */
    projectName: string;
    /** 프로젝트 폴더 기준 상대 경로(`/` 구분). 프로젝트 폴더 자체면 ''. */
    relative: string;
}

/** `/GPL/Lib/Motion/Cmd/MotionCmd.gpl` (root `/GPL`) → { projectName: 'Lib', relative: 'Motion/Cmd/MotionCmd.gpl' }. */
export function remoteProjectLocation(root: string, remotePath: string): RemoteProjectLocation | undefined {
    const norm = (v: string) => v.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const r = norm(root);
    const p = remotePath.replace(/\\/g, '/');
    if (!r || norm(p) === r || !norm(p).startsWith(`${r}/`)) { return undefined; }
    const segments = p.slice(root.replace(/\/+$/, '').length).split('/').filter(Boolean);
    if (segments.length === 0) { return undefined; }
    return { projectName: segments[0], relative: segments.slice(1).join('/') };
}

export interface LocalProjectCandidate {
    gprPath: string;
    /** `.gpr` 의 ProjectName(없으면 undefined). */
    projectName?: string;
}

export interface LocalProjectMatch {
    projectDir: string;
    gprPath: string;
    via: 'deploy-record' | 'project-name' | 'folder-name';
}

/**
 * 원격 프로젝트 이름에 맞는 로컬 프로젝트를 고른다. `recordDir` 는 deploy record 의 projectDir(있으면 최우선).
 * 작업공간 후보는 ProjectName 일치 → 폴더 이름 일치 순이고, 각 단계에서 후보가 둘 이상이면 고르지 않는다.
 */
export function pickLocalProject(
    projectName: string,
    candidates: readonly LocalProjectCandidate[],
    recordDir?: string,
    exists: (p: string) => boolean = fs.existsSync,
): LocalProjectMatch | undefined {
    if (recordDir && exists(recordDir)) {
        const gprPath = gprPathInDir(recordDir);
        if (gprPath) { return { projectDir: path.resolve(recordDir), gprPath, via: 'deploy-record' }; }
    }
    const ci = (a: string | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
    const byName = candidates.filter(c => ci(c.projectName, projectName));
    if (byName.length === 1) { return { projectDir: path.dirname(path.resolve(byName[0].gprPath)), gprPath: byName[0].gprPath, via: 'project-name' }; }
    if (byName.length > 1) { return undefined; }
    const byFolder = candidates.filter(c => ci(path.basename(path.dirname(path.resolve(c.gprPath))), projectName));
    if (byFolder.length === 1) { return { projectDir: path.dirname(path.resolve(byFolder[0].gprPath)), gprPath: byFolder[0].gprPath, via: 'folder-name' }; }
    return undefined;
}

/** `.gpr` 경로 목록 → 후보(ProjectName 은 파일을 읽어 얻는다; 못 읽으면 undefined). */
export function describeGprCandidates(gprPaths: readonly string[], readText: (p: string) => string = p => fs.readFileSync(p, 'utf8')): LocalProjectCandidate[] {
    return gprPaths.map(gprPath => {
        try { return { gprPath, projectName: parseGprText(readText(gprPath)).projectName?.trim() || undefined }; } catch { return { gprPath }; }
    });
}

/** 원격 사본의 로컬 대응 파일 경로(존재 여부는 호출측이 본다). */
export function localFileFor(projectDir: string, relative: string): string {
    return path.join(projectDir, ...relative.split('/').filter(Boolean));
}

/**
 * 로컬 프로젝트의 컴파일 단위 소스 — 자기 폴더의 소스 + ProjectLibrary 가 가리키는 프로젝트들의 소스(재귀).
 * 원격 세션 캐시의 씨앗으로 쓴다. 읽기 실패는 그 프로젝트만 건너뛴다.
 */
export function localCompileUnitSources(gprPath: string, readText: (p: string) => string = p => fs.readFileSync(p, 'utf8')): string[] {
    let rootText: string;
    try { rootText = readText(gprPath); } catch { return []; }
    const graph = buildLibraryGraph(gprPath, rootText, { readText });
    const out: string[] = [];
    const seen = new Set<string>();
    for (const node of graph.nodes.values()) {
        let text: string;
        try { text = readText(node.gprPath); } catch { continue; }
        for (const file of collectProjectSourcePaths(node.gprPath, text).files) {
            const key = file.toLowerCase();
            if (seen.has(key)) { continue; }
            seen.add(key);
            out.push(file);
        }
    }
    return out;
}

/** 원격 사본과 로컬 파일의 내용이 같은지 — 줄바꿈(CRLF/LF)·BOM·끝 공백 차이는 같은 것으로 본다. */
export function sameSourceText(a: string, b: string): boolean {
    const norm = (s: string) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
    return norm(a) === norm(b);
}
