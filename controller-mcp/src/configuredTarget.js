export function projectForCommand(explicit, sessionTarget) {
  const project = explicit?.trim() || sessionTarget?.project;
  if (!project) {
    return { ok: false, error: 'PROJECT_TARGET_REQUIRED', detail: '작업 대상이 정해지지 않았습니다. 먼저 project_target에 projectDir을 지정하세요.' };
  }
  return { ok: true, project };
}

/**
 * deploy_project에 보낼 대상 키. 명시한 폴더/파일은 그 자체로 대상이므로 세션의 다른 프로젝트 이름을 섞지 않는다.
 * 이름만 명시했을 때도 세션 폴더를 붙이지 않는다. 아무 대상도 없을 때만 세션의 이름+폴더를 함께 재사용한다.
 */
export function deployTargetArgs({ project, projectDir, projectFile }, sessionTarget) {
  const hasExplicitLocation = !!projectDir || !!projectFile;
  return {
    project: project ?? (hasExplicitLocation ? undefined : sessionTarget?.project ?? undefined),
    projectDir: projectDir ?? (project || projectFile ? undefined : sessionTarget?.dir ?? undefined),
    projectFile: projectFile ?? undefined,
  };
}

/** `project_target` 으로 명시 고정한 세션 대상인가(배포의 부수 효과로 정해진 대상과 구분한다). */
const PINNED_VIAS = new Set(['extension', 'requested', 'requested-no-bridge']);

const sameDir = (a, b) => !!a && !!b && String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase();
const sameProject = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * 배포 성공 뒤 세션 대상 규칙(2026-10-23 inbox deploy-target-switch-runs-library). 종전에는 성공한 배포 대상이 무조건
 * 세션 대상이 돼, `deploy_project(projectDir=Lib)` 하나로 `project_target` 의 BinderR3 가 Lib 로 바뀌었고 이어진 인자 없는
 * upload-start 가 실행 불가 그룹을 Stop -all + Compile 했다.
 *  - 실행 불가(runnable:false) 대상은 세션 대상이 되지 않는다.
 *  - `project_target` 으로 고정한 대상은 배포의 부수 효과로 바꾸지 않는다(바꾸려면 project_target 을 다시 부른다).
 *  - 세션 대상이 없거나 배포가 정한 대상이었으면 새 대상으로 바꾸고, 바뀌면 `change` 로 알린다.
 * @param current 세션 대상 { project, dir, verified, via } | null
 * @param deployed { project, dir, runnable: true|false|null(모름) }
 * @returns {{ target: object|null, change: {from, to}|null, kept: {reason, project}|null }}
 */
export function sessionTargetAfterDeploy(current, deployed) {
  const name = typeof deployed?.project === 'string' ? deployed.project.trim() : '';
  if (!name) return { target: current ?? null, change: null, kept: null };
  if (current && (sameDir(current.dir, deployed.dir) || (!current.dir && !deployed.dir && sameProject(current.project, name)))) {
    return { target: { ...current, verified: true }, change: null, kept: null };
  }
  if (deployed.runnable === false) {
    return { target: current ?? null, change: null, kept: { reason: 'non-runnable', project: name } };
  }
  if (current && PINNED_VIAS.has(current.via)) {
    return { target: current, change: null, kept: { reason: 'pinned-by-project_target', project: name } };
  }
  return {
    target: { project: name, dir: deployed.dir || null, verified: true, via: 'deploy' },
    change: { from: current?.project ?? null, to: name },
    kept: null,
  };
}

/**
 * 이 호출의 대상이 어디서 왔는지 — 'argument' | 'session-target' | 'session-target-from-deploy' | 'unresolved'.
 * 배포가 정한 세션 대상으로 인자 없이 가는 호출은 `project_target` 으로 고정한 것과 구분해 알린다.
 */
export function targetSourceOf(explicit, sessionTarget) {
  if (typeof explicit === 'string' && explicit.trim()) return 'argument';
  if (!sessionTarget) return 'unresolved';
  return sessionTarget.via === 'deploy' ? 'session-target-from-deploy' : 'session-target';
}
