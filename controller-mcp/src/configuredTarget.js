/** Export 설정의 폴더 대상은 project_target으로 확인한 뒤 사용한다. */
export function readConfiguredTarget(env) {
  return {
    // 빈 기본값은 미확정 상태다. 예전 수동 설정의 기본값은 유지한다.
    project: env.GPL_PROJECT ?? 'MergeCode',
    dir: env.GPL_PROJECT_DIR || null,
    requiresResolution: env.GPL_PROJECT_DIR !== undefined,
  };
}

export function projectForCommand(explicit, sessionTarget, configured) {
  if (configured.requiresResolution && (!sessionTarget?.verified || !sessionTarget.dir
      || (explicit?.trim() && explicit.trim() !== sessionTarget.project))) {
    return {
      ok: false,
      error: 'PROJECT_TARGET_REQUIRED',
      detail: '작업 폴더가 이 MCP 세션에서 확인되지 않았습니다. 먼저 project_target에 projectDir을 지정하고 성공 응답을 확인하세요.'
        + (configured.dir ? ` Export 대상 폴더: ${configured.dir}` : ''),
    };
  }
  const project = explicit?.trim() || sessionTarget?.project || configured.project;
  if (!project) {
    return { ok: false, error: 'PROJECT_TARGET_REQUIRED', detail: '기본 프로젝트가 미확정입니다. project_target에 projectDir을 지정하세요.' };
  }
  return { ok: true, project };
}
