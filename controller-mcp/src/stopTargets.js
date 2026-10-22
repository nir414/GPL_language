/**
 * PA 콘솔의 `Stop [thread_name | -all]`에 안전하게 넣을 수 있는 쓰레드 이름 판정.
 * 공식 문서에는 따옴표/이스케이프 구문이 없고, 실기에서는 `TCPCLI[0]`가 STATUS -712였다.
 * 표현할 수 없는 이름을 임의 인용해 추측하거나 `Stop -all`로 범위를 넓히지 않는다.
 */
export function isConsoleStopThreadName(name) {
  const value = String(name ?? '').trim();
  if (!value || value.startsWith('-')) return false;
  return !/[\s\[\]:"']/.test(value);
}

/** 이름별 Stop으로 표현 가능한 대상과 건너뛸 대상을 분리한다. */
export function partitionStopTargets(names) {
  const commands = [];
  const safeNames = [];
  const skipped = [];
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim();
    if (!isConsoleStopThreadName(name)) {
      skipped.push({
        name,
        reason: 'console-syntax-unsupported',
        detail: 'Stop 명령에 쓸 수 있는 따옴표/이스케이프 구문이 확인되지 않아 이름별 전송을 생략했습니다.',
      });
      continue;
    }
    safeNames.push(name);
    commands.push(`Stop ${name}`);
  }
  return { commands, names: safeNames, skipped };
}
