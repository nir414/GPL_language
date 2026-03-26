# GPL File I/O Implementation

Flash 메모리 수명을 고려한 안전한 파일 저장 시스템 구현

## 📁 구현된 파일들

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
            - **중요**: 단순히 `PendingCount=0`만 기다리면, 워커가 "Dequeue 후 실제 저장 중(in-flight)"인 작업을 놓칠 수 있습니다.
            - 현재 구현은 `PendingCount=0` **그리고** `inFlight=0`(워커가 저장 중이 아님)일 때만 완료로 봅니다.

### 3. Data_XmlStore.gpl
- **목적**: 인스턴스 기반 XML key-value 저장소 (`Class XmlStore`)
- **주요 기능**:
    - `SaveAsync()`: `Data_AsyncSave` 큐로 저장 예약
    - `SaveSync()`: 즉시 동기 저장
    - `LoadFromFile()`: 파일에서 로드
    - `RestoreFromBackup()`: 백업에서 복구

### 4. Data_DatStore.gpl
- **목적**: 인스턴스 기반 DAT(JSON 유사) key-value 저장소 (`Class DatStore`)
- **특징**: 저장은 `Data_AsyncSave` 공용 큐를 사용

## 🔧 주요 기능

### Flash 메모리 보호
- **임시 파일 사용**: ROMDISK에서 먼저 쓰기 후 Flash로 이동
- **원자적 쓰기**: 중간 실패 시 원본 파일 보호
- **백업 생성**: 기존 파일을 `.bak` 확장자로 백업
- **쓰기 최소화**: 불필요한 Flash 쓰기 방지

### 에러 처리
- **자동 복구**: 저장 실패 시 백업에서 자동 복구
- **상세한 에러 코드**: 실패 원인 추적 가능
- **로깅**: 모든 작업에 대한 상세 로그

### 경로 관리
- **Flash 경로**: `/flash/` - 영구 저장, 안전한 쓰기 방식 사용
- **ROMDISK 경로**: `/ROMDISK/` - 임시 저장, 직접 쓰기
- **임시 경로**: `/ROMDISK/temp/` - 원자적 쓰기용 임시 파일

## 📖 사용법

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

## 🧠 StreamWriter buffering/flush 요약 (GPL 공식 문서 기반)

- `StreamWriter.AutoFlush = True`면 각 Write/WriteLine마다 즉시 output이 발생할 수 있어 **파일 쓰기 성능이 느려질 수 있음**
- `StreamWriter.Flush`는 **버퍼된 데이터를 즉시 쓰고, output이 완료될 때까지 block**
- `StreamWriter.Close`는 **Flush equivalent**를 수행하며, output 중이면 완료될 때까지 block

따라서 파일 I/O 계층에서는 작은 Write를 여러 번 하는 경우 `AutoFlush=False + 필요한 시점에 Flush`가 효율적이고,
AsyncSave의 `Flush()`는 "큐 draining"뿐 아니라 "워커의 저장 완료"까지 기다려야 의미가 정확합니다.

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

### 파일 읽기 (StreamReader)
```vb
' GPL에서는 EndOfStream() 미지원 - Peek() 사용 필수
Dim reader As StreamReader
reader = New StreamReader("/flash/data/log.txt")
Dim content As String
Dim line As String

content = ""
' EOF 감지: Peek() >= 0 (EOF일 때 음수 반환)
Do While reader.Peek() >= 0
    line = reader.ReadLine()
    If content <> "" Then
        content = content & Utils.CRLF
    End If
    content = content & line
Loop
reader.Close()

' ❌ 잘못된 예 - EndOfStream() 미지원
' Do While Not reader.EndOfStream()

' ❌ 잘못된 예 - 빈 줄과 EOF 구분 불가
' Do While line <> ""
'     line = reader.ReadLine()
'     If line = "" Then Exit Do  ' 빈 줄에서 조기 종료!
' Loop
```

### 파일 삭제 (File.DeleteFile)
```vb
' 파일 삭제 - File 클래스의 Shared Method
File.DeleteFile("/flash/projects/MergeCode/Macro.gpl")
File.DeleteFile("/flash/temp/old_data.txt")
```

### 파일 복사 (File.Copy)
```vb
' 파일 복사
File.Copy("/flash/config/settings.xml", "/flash/backup/settings.xml")
```

### 디렉토리 관련
```vb
' 디렉토리 생성
File.CreateDirectory("/flash/data/logs")

' 디렉토리 삭제 (빈 디렉토리만 가능)
File.DeleteDirectory("/flash/temp/empty_folder")

' 디렉토리 내 파일 목록 가져오기
Dim files() As String
files = File.GetFiles("/flash/data")

' 디렉토리 내 하위 디렉토리 목록 가져오기
Dim dirs() As String
dirs = File.GetDirectories("/flash")
```

### 파일 정보
```vb
' 파일 길이 (디렉토리 엔트리 기반, 빠름)
Dim fileLen As Integer
fileLen = File.Length("/flash/data/config.xml")

' 파일 길이 (바이트 직접 카운트, 검증용)
Dim computedLen As Integer
computedLen = File.ComputeLength("/flash/data/config.xml")

' CRC 체크코드 (파일 무결성 검증)
Dim crc As Integer
crc = File.ComputeCRC("/flash/data/config.xml")
```

## ⚠️ 주의사항

### Flash 메모리 수명 고려
1. **빈번한 쓰기 금지**: 같은 위치에 반복 저장 피하기
2. **백업 활용**: 중요한 파일은 항상 백업과 함께 저장
3. **임시 파일 정리**: 정기적으로 `Storage_File_Manager.CleanupTempFiles()` 호출

### 에러 처리
1. **반환값 확인**: 모든 저장 작업의 반환값 확인 필수
2. **백업 복구**: 저장 실패 시 백업에서 복구 고려
3. **로그 모니터링**: Console 출력을 통한 작업 상태 확인

### 성능 고려
1. **비동기 사용**: 대량 저장 시 비동기 큐 활용
2. **배치 처리**: 여러 파일 저장 시 큐 사용으로 성능 향상
3. **경로 선택**: 임시 데이터는 ROMDISK, 영구 데이터는 Flash 사용

## 🧪 테스트 실행

```vb
' 모든 테스트 실행
FileIOTest.RunAllTests()

' 개별 테스트
FileIOTest.TestBasicFileSave()
FileIOTest.TestXmlStore()
FileIOTest.TestAsyncQueue()
FileIOTest.TestErrorRecovery()
```

## 📊 에러 코드

| 코드 | 상수 | 설명 |
|------|------|------|
| 1 | SAVE_SUCCESS | 저장 성공 |
| -1 | SAVE_ERROR_PATH_INVALID | 잘못된 경로 또는 빈 내용 |
| -2 | SAVE_ERROR_WRITE_FAILED | 파일 쓰기 실패 |
| -3 | SAVE_ERROR_BACKUP_FAILED | 백업 생성 실패 |
| -4 | SAVE_ERROR_TEMP_FAILED | 임시 파일 생성 실패 |
| -5 | SAVE_ERROR_MOVE_FAILED | 최종 파일 이동 실패 |

## 🔄 업그레이드 가이드

기존 코드에서 새로운 파일 저장 시스템으로 마이그레이션:

### 기존 코드
```vb
' 기존: 시뮬레이션만
' (레거시) XMLHandler_KDY 기반 코드 예시는 현재 리포지토리에서 사용하지 않습니다.
```

### 새로운 코드
```vb
' 새로운: XmlStore 사용 (권장)
Dim store As XmlStore
store = New XmlStore()
store.Path = "/flash/data.xml"
store.SetValue("key", "value")
store.SaveSync() ' 즉시 저장

' 종료/테스트 시: 비동기 큐 drain 대기
Data_AsyncSave.Flush(5000)
```

이제 GPL에서 Flash 메모리의 수명을 고려한 안전하고 실용적인 파일 저장 시스템을 사용할 수 있습니다.
