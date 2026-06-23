/**
 * 의존성 없는 초경량 테스트 러너.
 *
 * `node ./out/test/index.js`로 실행한다. 외부 테스트 프레임워크나 vscode
 * 확장 호스트가 필요 없는 순수 모듈(파서/문자열 헬퍼 등)의 회귀를 잡는다.
 * 하나라도 실패하면 프로세스 종료코드를 1로 설정하여 CI가 감지할 수 있게 한다.
 */
type TestFn = () => void | Promise<void>;

const cases: Array<{ name: string; fn: TestFn }> = [];

export function test(name: string, fn: TestFn): void {
    cases.push({ name, fn });
}

export async function run(): Promise<void> {
    let passed = 0;
    const failed: string[] = [];

    for (const c of cases) {
        try {
            await c.fn();
            passed++;
            console.log(`  ✓ ${c.name}`);
        } catch (err: any) {
            failed.push(c.name);
            console.error(`  ✗ ${c.name}`);
            console.error(`      ${err?.stack ?? err?.message ?? String(err)}`);
        }
    }

    console.log(`\n${passed}/${cases.length} passed${failed.length ? `, ${failed.length} failed` : ''}`);
    if (failed.length) {
        process.exitCode = 1;
    }
}
