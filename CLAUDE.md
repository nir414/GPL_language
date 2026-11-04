# CLAUDE.md — Claude Code 전용 보충

공통 지침의 정본은 `AGENTS.md`다. 아래 import로 그대로 읽히므로 여기에는 Claude Code에만 해당하는 내용만 둔다.
공통 규칙을 이 파일에 복사하지 않는다. 고칠 때는 `AGENTS.md`를 고친다.

@AGENTS.md

## Claude Code 전용

- **제어기 조작은 `gpl-controller` MCP 도구로 한다.** 서버가 `instructions`로 안전 규칙(대상 프로젝트 고정, 결과 미확정 처리,
  재확인 금지, 대기 도구)을 매 세션 전달하므로 그 응답 필드(`outcome`·`next`·`recommendedAction`)를 그대로 따른다.
- **하위 에이전트** — 병렬로 위임할 때는 Sonnet 같은 하위 모델을 쓰고(Fable은 쓰지 않는다), 읽기는 필요한 범위만 하며,
  대량의 기계적 수정은 스크립트로 처리한다. 검증은 아끼지 말고 실제로 돌려 확인한다(2026-10-27 사용자 방침).
- `isolation: "worktree"` 에이전트는 HEAD가 아니라 `main`에서 갈라진다. 아직 병합하지 않은 커밋이 필요하면 먼저 반영한다.
- 동시에 작업하는 다른 세션은 `ListAgents`로 확인하고 `SendMessage`로 조율한다. 공용 파일(`docs/ai-handoff.md` 등)을
  크게 바꾸기 전에 알리고, 상대가 맡은 미커밋 파일은 커밋에 넣지 않는다.
