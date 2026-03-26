# GPL Location 정리: Cartesian / PosWrtRef / XYZ

이 문서는 Brooks GPL 공식 문서를 기반으로 `Location`의 핵심 개념과,
실무에서 자주 만나는 컴파일 오류(`-722`, `-781`)를 빠르게 해결하기 위해 정리한 가이드입니다.

---

## 1) 핵심 개념 요약

## Location 타입

- `Location`에는 크게 **Angles** / **Cartesian** 두 타입이 존재
- Cartesian은 다음 6개 요소로 표현됨
  - `X`, `Y`, `Z`
  - `Yaw`, `Pitch`, `Roll`

공식 문서 표현으로는 이 6개 값이 `PosWrtRef`(reference frame 기준 위치/자세)를 구성합니다.

---

## PosWrtRef vs Pos

- `PosWrtRef`
  - **참조 프레임 기준 값 자체**를 읽고/씀
  - 참조 프레임이 있더라도, 이 속성은 그 프레임 계산을 무시하고 내부 PosWrtRef를 다룸

- `Pos`
  - Location의 **총 위치(total position)**를 읽고/씀
  - Cartesian + RefFrame 조합 결과(또는 Angles 값)를 반영

실무 팁:

- RefFrame 영향 없는 단순 Cartesian 좌표 세팅이면 `XYZ(...)` 또는 `X/Y/Z/Yaw/Pitch/Roll` 직접 대입이 가장 직관적
- RefFrame 포함한 “최종 좌표” 동기화 목적이면 `Pos` 사용을 고려

---

## XYZ 메서드

`location_object.XYZ(x, y, z, yaw, pitch, roll)`

- Cartesian 6개 성분을 한 번에 설정
- 문서상 **개별 속성 대입보다 효율적**
- 호출 완료 후 타입이 Cartesian으로 설정됨

예:

```vb
Dim loc As New Location
loc.XYZ(100, 100, 50, 0, 0, 0)
```

---

## XYZValue 메서드

`Location.XYZValue(x, y, z, yaw, pitch, roll)`

- 지정한 총 위치를 갖는 Cartesian Location 값을 반환
- 표현식에서 Location 값을 만들 때 편리
- 단일 Location의 PosWrtRef 세팅은 `XYZ(...)`가 더 효율적(공식 문서 권장)

---

## 2) 이번 오류 케이스와 원인 매핑

사용자 로그:

- `(-722) Unexpected text at end of line` (여러 줄)
- `(-781) Missing string DPdistance`

### A. `(-722)` 원인 패턴

주요 원인:

- GPL Statement Structure에서 **한 줄당 한 문장만 허용**
- `:`는 문장 연결자가 아니라 **라인 라벨(`Label: Statement`) 구분자**

예:

```vb
Loc1.X = 100 : Loc1.Y = 100 : Loc1.Z = 50
```

권장:

```vb
Loc1.X = 100
Loc1.Y = 100
Loc1.Z = 50
```

또는

```vb
Loc1.XYZ(100, 100, 50, 0, 0, 0)
```

### B. `(-781) Missing string DPdistance` 원인 패턴

로그 문자열 연결 시 숫자 타입을 직접 붙일 때, 환경/파서 조건에 따라 문자열 인자로 강제되지 않아 발생 가능.

권장:

```vb
Core_ErrorHandler.log("Distance from point to segment: " & CStr(DPdistance), "MAIN")
```

---

## 3) 권장 코드 패턴 (안전/간단)

```vb
Dim Loc1 As New Location
Dim Loc2 As New Location
Dim LocP As New Location

Loc1.XYZ(100, 100, 50, 0, 0, 0)
Loc2.XYZ(250, 120, 50, 0, 0, 0)
LocP.XYZ(180, 220, 50, 0, 0, 0)

Dim DPdistance As Double
DPdistance = point_segment_distance(Loc1, Loc2, LocP)
Core_ErrorHandler.log("Distance from point to segment: " & CStr(DPdistance), "MAIN")
```

---

## 4) 공식 문서 링크

- Statement Structure  
  https://www2.brooksautomation.com/#Controller_Software/Introduction_To_The_Software/Guidance_Programming_Language/statementstructure.htm

- Location Class Summary  
  https://www2.brooksautomation.com/#Controller_Software/Software_Reference/GPL_Dictionary/Location/locationintro.htm
- location_object.PosWrtRef Property  
  https://www2.brooksautomation.com/#Controller_Software/Software_Reference/GPL_Dictionary/Location/poswrtref.htm
- location_object.XYZ Method  
  https://www2.brooksautomation.com/#Controller_Software/Software_Reference/GPL_Dictionary/Location/xyz.htm

보강 참고:

- location_object.Pos Property  
  https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/pos.htm
- Location.XYZValue Method  
  https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/Location/xyzvalue.htm
