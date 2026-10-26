/**
 * PA 콘솔의 `Stop [thread_name | -all]`에 안전하게 넣을 수 있는 쓰레드 이름 판정.
 * 공식 문서에는 따옴표/이스케이프 구문이 없고, 실기(4.2K5)에서 `Stop RWK[0]`·`Stop "RWK[0]"`·`Stop TCPLSN:4000` 이 모두
 * STATUS -712(*Invalid syntax*)였다(2026-10-23). 확인된 것은 영숫자 이름뿐이므로 **영숫자·`_` 이외 문자가 하나라도 있으면**
 * 이름별 전송을 건너뛴다(대괄호·콜론만 막던 종전 규칙을 넓힘). 임의 인용으로 추측하거나 `Stop -all`로 범위를 넓히지 않는다.
 */
export function isConsoleStopThreadName(name) {
  const value = String(name ?? '').trim();
  if (!value) return false;
  return /^[A-Za-z0-9_]+$/.test(value);
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
        statusIfSent: -712,
        detail: '영숫자·_ 이외 문자가 든 이름은 콘솔 Stop 이 -712(*Invalid syntax*)로 거부하고 인용 형식도 없어 이름별 전송을 생략했습니다.',
      });
      continue;
    }
    safeNames.push(name);
    commands.push(`Stop ${name}`);
  }
  return { commands, names: safeNames, skipped };
}
