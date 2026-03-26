# GPL 지원 데이터 타입 및 상수 정리

## 지원 데이터 타입
- Boolean: True(<>0)/False(=0)
- Byte: 0~255 (8비트)
- Short: 16비트 정수
- Integer: 32비트 정수
- Single: 32비트 부동소수점
- Double: 64비트 부동소수점
- String: 임의 길이 문자열
- Object: 시스템 구조/클래스용 포인터(사용자 정의 불가)

## 미지원 데이터 타입 (VB6/VB.NET)
- Long/Int64: 64비트 정수
- Decimal: 96비트 정수
- Int16/Int32: Short/Integer의 별칭
- Char: 16비트 유니코드
- Variant: VB6 범용 타입
- Date: 날짜/시간

## 타입 지정 문자 미지원
- 변수/상수 선언 시 접미사(예: 725L, Abc!) 불가

## 자동/명시적 타입 변환
- 모든 정수형은 부동소수점 연산 시 자동 변환
- 명시적 변환 함수: CBool, CByte, CDbl, CInt, CShort, CSng, CStr, Hex

## 상수
- GPL_CR: ASCII CR(13)
- GPL_LF: ASCII LF(10)
- GPL_Righty: 오른쪽 어깨 구성(&H01)
- GPL_Lefty: 왼쪽 어깨 구성(&H02)
- GPL_Above: 팔꿈치 위(&H04)
- GPL_Below: 팔꿈치 아래(&H08)
- GPL_Flip: 손목 위(&H10)
- GPL_NoFlip: 손목 아래(&H20)
- GPL_Single: 손목 위치 제한(&H1000)

## 기타
- 모든 입력 문자는 7비트 ASCII만 허용
- 8비트 ASCII/유니코드 문자, 심볼명/문자열 리터럴 불가
- 16진수: &H, 8진수: &O (문자열 연결 시 & 뒤에 공백 필요)

## 배열(Arrays)

배열은 별도 문서로 분리했습니다.

- **[arrays.md](arrays.md)**: 0-based 인덱스 규칙, upper bound 의미, `ReDim` 제약, 배열 대입 시 참조 공유(포인터 복사) 동작, `Array.Length/Rank/GetUpperBound` 정리
