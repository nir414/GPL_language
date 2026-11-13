/**
 * 파일별 의존 계산 결과 캐시 — 키는 파일 본문 **그리고 심볼 인덱스 세대**다.
 *
 * 한 파일의 의존(어느 파일의 모듈을 쓰는가)은 그 파일 본문만이 아니라 "이름 → 정의 파일" 대응에도 기댄다. 본문이 같아도
 * 다른 파일로 모듈이 옮겨지면 결과가 달라지므로, 본문만 키로 쓰면 외부 도구가 파일을 나눈 뒤에도 옛 의존이 남아
 * `.gpr` 의 source-missing 이 낡은 채로 보인다(2026-11-04 SamplePrep 보고). 세대가 바뀌면 전부 버린다.
 *
 * 순수 모듈 — 단위 테스트: src/test/project/gpr/fileDepsCache.test.ts
 */
export class FileDepsCache<T> {
    private generation = Number.NaN;
    private readonly entries = new Map<string, { text: string; value: T }>();

    /** 본문과 세대가 모두 같으면 캐시된 값을, 아니면 `compute` 로 새로 계산해 저장한다. */
    public getOrCompute(key: string, text: string, generation: number, compute: () => T): T {
        if (generation !== this.generation) {
            this.entries.clear();
            this.generation = generation;
        }
        const hit = this.entries.get(key);
        if (hit && hit.text === text) { return hit.value; }
        const value = compute();
        this.entries.set(key, { text, value });
        return value;
    }

    public clear(): void {
        this.entries.clear();
        this.generation = Number.NaN;
    }
}
