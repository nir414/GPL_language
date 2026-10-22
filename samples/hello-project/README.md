# GPL 확장 기능 둘러보기

[Main.gpl](Main.gpl) 한 파일에서 간단한 계산과 카운터를 실행하는 예제입니다.
F5의 **Run Extension**으로 열고 아래 기능을 확인합니다. 편집 기능은 제어기 없이 사용할 수 있습니다.

- **호버·시그니처 도움말**: Clamp에 마우스를 올리거나 호출 괄호 안에서 Ctrl+Shift+Space를 누릅니다.
- **정의·참조·이름 바꾸기**: Add나 Clamp에서 F12, Shift+F12, F2를 눌러 봅니다.
- **자동완성**: Main 안에서 `counter.` 또는 `Console.`을 입력합니다. 체험 후 입력을 지웁니다.
- **개요·접기**: Outline에서 Counter와 Property를 펼치거나 함수·If·For 블록을 접습니다.
- **스니펫·주석 생성**: 빈 줄에서 `for`를 입력하거나 선언 줄에서 Ctrl+.로 문서화 주석을 생성·보완합니다.

기본 코드는 계산과 콘솔 출력 후 종료합니다. 제어기에서 실행하면 `sum: 3`, `clamped: 100`, `count: 3`을 예상합니다.
제어기 디버깅은 `counter.Increment()`에 중단점을 두고 i와 counter의 변화를 확인하면 됩니다.
더 많은 문법 예제는 [syntax-tour](../syntax-tour/)에 있습니다.
