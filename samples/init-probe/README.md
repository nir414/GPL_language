# init-probe — `Init` 이름이 GPL 런타임에 특별한가? → **특별하다 (2026-09-21 실기 확정)**

2026-09-21 GenAdp 가 `Start` 직후 `LineBuffer.Init` 한 프레임만 가진 채 `-757 Object not instantiated` 로
죽은 사건(ai-handoff §1-EA)에서 나온 가설을 실기기(192.168.0.1, GPL 5.1D6)로 가른 최소 프로젝트다. **모션 없음, 콘솔 출력만.**

## 공식 문서 근거

[GPL / Modules](https://www2.brooksautomation.com/Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/modules.htm):

> If a user Sub procedure named **Init** is defined within a module, it is executed as part of the module
> initialization, **before the startup procedure begins.**
> An internal Sub procedure named **`_Init`** is automatically generated to perform module-level initialization.
> Do not attempt to create a procedure with this name.

즉 모듈 수준 `Sub Init` 은 **문서화된 자동 실행 훅**이다(레거시 프로젝트들의 빈 `Public Sub Init` 은 이 훅을 비워서 선점한 것).

## 실기 결과

| 단계 | 소스 | 물음 | 결과 |
| --- | --- | --- | --- |
| A | `StageA_ModuleInit.gpl` | 모듈 수준 `Public Sub Init` 이 Start 때 자동 호출되나 | **확정(16:31 콘솔).** `PROBE A: Init called` → `PROBE A: Main called` — 문서대로 시작 프로시저보다 먼저. 스레드 정상 종료 |
| B | `StageB_ClassInit.gpl` | **모듈 안 클래스의 `Private Sub Init`** 까지 잡아채나 (GenAdp 재현) | **재현.** `Main` 이 한 줄도 돌기 전에 `-757 *Object not instantiated*`, `Show Stack` = `0, init_probe, Init, 1, StageB_ClassInit.gpl, 24` — **`Init` 프레임 하나, 호출자 없음.** GenAdp 스택과 같은 모양 |
| B′ | 같은 파일에서 `Init` 의 필드 접근(`m_buf = ""`)만 주석 처리 | `-757` 은 호출 차단인가 필드 접근인가 | **조용히 통과.** `Probe.Init` → `Main called` → `Probe.Init` → `Probe constructed` — 자동 호출은 그대로 일어나고 **부작용만 두 번** 실행된다(16:21 콘솔) |
| C | `StageC_InitFieldAccess.gpl` | 유령 프레임이 어디까지 실행되나 | **확정.** 정지 위치 `StageC_InitFieldAccess.gpl:42 (Init)` = `m_buf = "x"`. **41 행(`Console.WriteLine`)은 통과**하고 필드 접근 줄에서만 `-757` — 호출 차단이 아니라 `Me = Nothing` |
| D | `StageD_UnderscoreInit.gpl` | 문서가 금지한 `_Init` 을 직접 정의하면 | **미확정(16:35 콘솔).** 컴파일 통과 · `D: user _Init called` 안 찍힘 · `gStamp=[INITIALIZED]`. 자동 호출은 없고 모듈 변수 초기화도 멀쩡하지만, **"안 불렸다" 와 "그 이름의 Sub 가 애초에 없다" 를 구분하지 못한다** — 그냥 정상 실행일 수도 있다 |
| E | `StageE_UnderscoreCallable.gpl` | D 를 가른다 — `_Init` 은 참조 가능한 이름인가 | 예정 — `_Init()` 을 Main 에서 직접 호출 + `gStamp` 를 덮어쓴 뒤 값이 되돌아가는지로 지문 확인 |
| F | A + B 동시 등록 (B 의 `Module Main` 주석 처리, `Private Class Probe`) | 인스턴스를 만드는 코드가 **하나도 없으면** 어떻게 되나 | **가장 무거운 결과(16:43 콘솔).** `PROBE A: Init` → `PROBE B: Probe.Init` → `PROBE A: Main`. `Probe` 를 `New` 하는 코드가 프로젝트 어디에도 없는데 호출됐고, `Private Class` 도 소용없었으며, `Init` 이 여럿이면 **전부** 불린 뒤 시작 프로시저가 돈다 |

Stage B 가 보여 주는 문서화되지 않은 날카로운 모서리: 모듈 초기화가 `Init` 을 **이름으로** 찾을 때 클래스 경계와
`Private` 을 보지 않는다. 클래스 메서드 `Init` 이 인스턴스 없이(`Me = Nothing`) 불려 첫 필드 접근에서 `-757` 이 난다.

**`-757` 은 증상이지 원인이 아니다(Stage C).** 유령 프레임은 정상적으로 **진입해 문장을 실행**하고, 인스턴스 필드를
건드리는 그 줄에서만 죽는다. 원인은 "클래스 메서드가 인스턴스 없이 호출된다" 하나이고, 필드 접근 여부가
**시끄럽게 죽느냐(B·C) 조용히 완주하느냐(B′)** 를 가를 뿐이다.

**B′ 가 더 위험하다.** `-757` 로 죽는 쪽은 최소한 시끄럽게 알려 준다. 필드를 건드리지 않는 `Init`(로그 출력,
모듈 전역 세팅, 카운터 증가, 포트 열기…)은 **경고 없이 두 번** 돈다 — 한 번은 유령 프레임에서, 한 번은 `New()` 에서.

## 실무 규칙

- **클래스 메서드에 `Init` 이라는 이름을 쓰지 않는다** — `InitDefaults`·`Reset` 등으로. 확장이 이 경우를 진단으로 잡는다.
- **"그 클래스 안 쓰는데요" 는 방어가 아니다(Stage F).** 인스턴스를 만드는 코드가 프로젝트에 하나도 없어도,
  클래스가 `Private` 이어도 호출된다. 소스에 **존재**하기만 하면 된다 — 라이브러리에 딸려 온 클래스도 마찬가지다.
- **`Init` 이 여럿이면 전부 호출된다(Stage F).** 모듈 수준 `Init` 과 클래스 `Init` 이 서로를 배제하지 않는다.
- **`-757` 이 안 난다고 안전한 게 아니다(Stage B′·C).** 인스턴스 필드를 건드리지 않는 `Init`(로그, 모듈 전역 세팅,
  카운터, 포트 열기…)은 경고 없이 완주하고, 실제 호출 경로에서 한 번 더 돌아 **부작용이 두 번** 일어난다.
- 모듈 수준 `Public Sub Init` 은 합법적인 초기화 훅이다(문서화됨). 다만 "왜 있는지" 주석을 남길 것.
- `_Init` 은 컴파일러 내부 이름 — 만들지 않는다(Stage D 는 무해해 보였으나 Stage E 전까지 미확정).
- 곁다리: `Lib` 은 GPL 예약어다(`Module Lib` → `-719 *Illegal use of keyword* Lib`, 이 실험에서 걸림).

단계 전환은 `Project.gpr` 의 `ProjectSource=` 한 줄만 바꾼다. 여러 단계를 **같이** 올리려면 `ProjectSource=` 를
여러 줄 쓰되, `Module Main` 이 겹치지 않게 한쪽을 주석 처리한다(Stage F 가 그 방법으로 나왔다).
`hello-project` 는 F5 첫 인상용이라 건드리지 않고 형제 폴더로 두었다.
