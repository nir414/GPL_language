# Test_robot 파일 저장 시스템 구현 (아카이브)

> ⚠️ **아카이브 — Test_robot 시절 문서.** 현재 저장소에 존재하지 않는 GPL 로봇 애플리케이션
> `Test_robot`의 파일 저장 시스템(`Storage_File_Manager` / `Data_AsyncSave` / `Data_XmlStore` /
> `Data_DatStore`) 구현 설명이다. 범용 GPL 파일 입출력 지식(StreamReader/StreamWriter,
> File 클래스, Flash 수명 원칙)은 [gpl-language/file-io.md](../../gpl-language/file-io.md)로 분리됐다.

Flash 메모리 수명을 고려한 안전한 파일 저장 시스템 구현.

## 구현된 파일들

### 1. Storage_File_Manager.gpl
- **목적**: Flash 메모리 수명을 고려한 안전한 파일 저장 관리자
- **주요 기능**:
  - 원자적 파일 쓰기 (임시 파일 → 최종 파일)
  - 백업 파일 생성 및 복구
  - Flash vs ROMDISK 자동 구분
  - 디렉토리 자동 생성
  - 에러 처리 및 복구

### 2. Data_AsyncSave.gpl
- **목적**: 범용 비동기 저장 큐 (XML/DAT 등 포맷 공용)
- **특징**:
    - 백그라운드 워커 스레드에서 안전한 파일 저장 수행
    - 내부적으로 `Storage_File_Manager.SafeSaveFile()` 사용
        - `Flush(timeoutMs)` 제공 (종료/테스트 시 유용)
            - **중요**: 단순히 `PendingCount=0`만 기다리면, 워커가 "Dequeue 후 실제 저장 중(in-flight)"인 작업을 놓칠 수 있다.
            - 구현은 `PendingCount=0` **그리고** `inFlight=0`(워커가 저장 중이 아님)일 때만 완료로 본다.

### 3. Data_XmlStore.gpl
- **목적**: 인스턴스 기반 XML key-value 저장소 (`Class XmlStore`)
- **주요 기능**: `SaveAsync()` (큐 저장 예약), `SaveSync()` (즉시 동기 저장), `LoadFromFile()`, `RestoreFromBackup()`

### 4. Data_DatStore.gpl
- **목적**: 인스턴스 기반 DAT(JSON 유사) key-value 저장소 (`Class DatStore`)
- **특징**: 저장은 `Data_AsyncSave` 공용 큐를 사용

## 사용법

### Storage_File_Manager 직접 사용
```vb
Dim result As Integer
result = Storage_File_Manager.SafeSaveFile("/flash/data/config.xml", xmlContent, 1)

If result = Storage_File_Manager.SAVE_SUCCESS Then
    Console.WriteLine("저장 성공")
Else
    Console.WriteLine("저장 실패: " & CStr(result))
End If
```

### XmlStore 사용 (권장)
```vb
Dim store As XmlStore
store = New XmlStore()
store.Path = "/flash/config/robot.xml"

' 데이터 설정
store.SetValue("robot_name", "TestRobot")
store.SetValue("max_speed", "1500")

' 즉시 저장
If store.SaveSync() = Storage_File_Manager.SAVE_SUCCESS Then
    Console.WriteLine("동기 저장 완료")
End If

' 비동기 저장 (큐 사용)
store.SaveAsync()
```

### 비동기 큐 사용
```vb
' Data_AsyncSave 큐 사용
Data_AsyncSave.Enqueue("/flash/data/sensor.xml", xmlContent)

' 모든 큐 처리 대기
If Data_AsyncSave.Flush(5000) = 1 Then
    Console.WriteLine("모든 저장 완료")
End If
```

### 파일 로드
```vb
Dim store As XmlStore
store = New XmlStore()
store.Path = "/flash/config/robot.xml"

If store.LoadFromFile() = 1 Then
    Dim robotName As String
    robotName = store.GetValue("robot_name")
    Console.WriteLine("로봇 이름: " & robotName)
End If
```

## 테스트 실행

```vb
' 모든 테스트 실행
FileIOTest.RunAllTests()

' 개별 테스트
FileIOTest.TestBasicFileSave()
FileIOTest.TestXmlStore()
FileIOTest.TestAsyncQueue()
FileIOTest.TestErrorRecovery()
```

## 에러 코드 (Storage_File_Manager 모듈 상수)

| 코드 | 상수 | 설명 |
|------|------|------|
| 1 | SAVE_SUCCESS | 저장 성공 |
| -1 | SAVE_ERROR_PATH_INVALID | 잘못된 경로 또는 빈 내용 |
| -2 | SAVE_ERROR_WRITE_FAILED | 파일 쓰기 실패 |
| -3 | SAVE_ERROR_BACKUP_FAILED | 백업 생성 실패 |
| -4 | SAVE_ERROR_TEMP_FAILED | 임시 파일 생성 실패 |
| -5 | SAVE_ERROR_MOVE_FAILED | 최종 파일 이동 실패 |

## 업그레이드 가이드 (당시 마이그레이션 안내)

```vb
' XmlStore 사용 (권장)
Dim store As XmlStore
store = New XmlStore()
store.Path = "/flash/data.xml"
store.SetValue("key", "value")
store.SaveSync() ' 즉시 저장

' 종료/테스트 시: 비동기 큐 drain 대기
Data_AsyncSave.Flush(5000)
```

관련 이력: 비동기 저장의 in-flight 추적 개선은 [streamwriter-notes](../sessions/streamwriter-notes.md),
Flash 수명 설계 근거는 [design-principles](../../development/design-principles.md) 참조.
