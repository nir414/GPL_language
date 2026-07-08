import * as assert from 'assert';
import { test } from './harness';
import {
    selectProjectFromCandidates,
    ProjectCandidate,
} from '../controller/responseParser';

/** 소문자 basename 집합 헬퍼. */
function S(...names: string[]): Set<string> {
    return new Set(names.map(n => n.toLowerCase()));
}

function cand(projectName: string, gprPath: string, sources: string[]): ProjectCandidate {
    return { projectName, gprPath, sourceNames: S(...sources) };
}

test('selectProject: 단일 후보는 그대로 반환', () => {
    const sel = selectProjectFromCandidates(
        [cand('Alpha', '/ws/Alpha/Project.gpr', ['Main.gpl'])],
        '',
    );
    assert.strictEqual(sel?.projectName, 'Alpha');
    assert.strictEqual(sel?.ambiguous, false);
});

test('selectProject: 이름 같은 stale 사본은 단일 프로젝트로 병합', () => {
    // 서로 다른 경로지만 동일 ProjectName(.history 사본 등) → 다중 아님.
    const sel = selectProjectFromCandidates(
        [
            cand('Alpha', '/ws/Alpha/Project.gpr', ['Main.gpl']),
            cand('Alpha', '/ws/.history/Alpha/Project_20240101.gpr', ['Main.gpl']),
        ],
        '',
    );
    assert.strictEqual(sel?.projectName, 'Alpha');
    assert.strictEqual(sel?.ambiguous, false);
});

test('selectProject: 동일 .gpr 경로 중복은 제거', () => {
    const sel = selectProjectFromCandidates(
        [
            cand('Alpha', '/ws/Alpha/Project.gpr', ['Main.gpl']),
            cand('Alpha', '/ws/Alpha/Project.gpr', ['Main.gpl']),
        ],
        '',
    );
    assert.strictEqual(sel?.projectName, 'Alpha');
    assert.strictEqual(sel?.ambiguous, false);
});

test('selectProject(회귀): 파일명 충돌 시 디렉터리 포함이 basename 매칭보다 우선', () => {
    // Alpha 폴더에 열린 Main.gpl. Alpha의 소스 목록엔 Main.gpl이 없고 Beta에만 있음.
    // 과거 로직은 sourceMatches[0]=Beta로 오인식했으나, 실제 파일은 Alpha 폴더에 있음.
    const candidates = [
        cand('Alpha', '/ws/Alpha/Project.gpr', ['Other.gpl']),
        cand('Beta', '/ws/Beta/Project.gpr', ['Main.gpl']),
    ];
    const sel = selectProjectFromCandidates(candidates, '/ws/Alpha/Main.gpl');
    assert.strictEqual(sel?.projectName, 'Alpha');
    assert.strictEqual(sel?.ambiguous, false);
});

test('selectProject: 폴더 포함 + 소스 일치면 그 프로젝트(가장 강한 신호)', () => {
    const candidates = [
        cand('Alpha', '/ws/Alpha/Project.gpr', ['Main.gpl']),
        cand('Beta', '/ws/Beta/Project.gpr', ['Main.gpl']),
    ];
    const sel = selectProjectFromCandidates(candidates, '/ws/Alpha/Main.gpl');
    assert.strictEqual(sel?.projectName, 'Alpha');
    assert.strictEqual(sel?.ambiguous, false);
});

test('selectProject: 폴더 밖 파일 + 고유 소스명 일치 → 해당 프로젝트', () => {
    const candidates = [
        cand('Alpha', '/ws/Alpha/Project.gpr', ['Main.gpl']),
        cand('Beta', '/ws/Beta/Project.gpr', ['Setup.gpl']),
    ];
    const sel = selectProjectFromCandidates(candidates, '/elsewhere/Setup.gpl');
    assert.strictEqual(sel?.projectName, 'Beta');
    assert.strictEqual(sel?.ambiguous, false);
});

test('selectProject: 폴더 밖 파일명이 여러 프로젝트에 존재 → 모호(결정적)', () => {
    const candidates = [
        cand('Beta', '/ws/Beta/Project.gpr', ['Main.gpl']),
        cand('Alpha', '/ws/Alpha/Project.gpr', ['Main.gpl']),
    ];
    const sel = selectProjectFromCandidates(candidates, '/elsewhere/Main.gpl');
    // 경로 정렬상 /ws/Alpha < /ws/Beta → Alpha가 결정적 기본값.
    assert.strictEqual(sel?.projectName, 'Alpha');
    assert.strictEqual(sel?.ambiguous, true);
});

test('selectProject: 활성 파일 없음 + 다중 → 모호(결정적 fallback)', () => {
    const candidates = [
        cand('Beta', '/ws/Beta/Project.gpr', ['B.gpl']),
        cand('Alpha', '/ws/Alpha/Project.gpr', ['A.gpl']),
    ];
    const sel = selectProjectFromCandidates(candidates, '');
    assert.strictEqual(sel?.projectName, 'Alpha');
    assert.strictEqual(sel?.ambiguous, true);
});

test('selectProject: 중첩 프로젝트는 가장 깊은(구체적) 폴더 우선', () => {
    const candidates = [
        cand('Root', '/ws/Project.gpr', ['X.gpl']),
        cand('Sub', '/ws/Sub/Project.gpr', ['Y.gpl']),
    ];
    const sel = selectProjectFromCandidates(candidates, '/ws/Sub/Z.gpl');
    assert.strictEqual(sel?.projectName, 'Sub');
    assert.strictEqual(sel?.ambiguous, false);
});

test('selectProject: 이름 없는 후보/빈 배열은 undefined', () => {
    assert.strictEqual(selectProjectFromCandidates([], '/ws/Main.gpl'), undefined);
    const sel = selectProjectFromCandidates(
        [cand('', '/ws/NoName/Project.gpr', ['Main.gpl'])],
        '/ws/NoName/Main.gpl',
    );
    assert.strictEqual(sel, undefined);
});
