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
