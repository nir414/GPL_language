# GPL 프로젝트 에러 처리 가이드

## 개요
모든 에러 및 로그 출력은 `Core_ErrorHandler` 모듈의 API로 통일합니다.

- 일반 로그: `Core_ErrorHandler.log(msg[, context])`
- 에러 로그(메시지): `Core_ErrorHandler.logErrorMessage(msg)`
- 예외 로그: `Core_ErrorHandler.logException(ex, context)`
- 예외 발생: `Core_ErrorHandler.throwError(errCode, msg[, robotNum, axisBits])`

> NOTE: `Console.WriteLine`을 각 모듈에서 직접 호출하는 방식은 지양합니다. (표준화/포워딩/파일로그를 위해 `Core_ErrorHandler`로 모읍니다.)

---

## Silent Catch(예외 무시) 금지

다음 패턴은 **금지**합니다.

```vb
Try
    DoSomething()
Catch ex
    ' 무시
End Try
```

### 허용되는 처리 방식 (택1)

1) **상위로 전파**: 호출자가 처리하도록 `Try...Catch` 자체를 제거하거나, 함수/프로시저가 반환값으로 실패를 표현할 수 있으면 반환값으로 올립니다.

2) **즉시 로깅**: 실패가 중요한 경우

```vb
Catch ex
    Core_ErrorHandler.logException(ex, "Module.Function - Operation failed | Context: ...")
End Try
```

3) **빈번 실패 구간은 throttle 로깅**: 네트워크 Send/Close 같이 운영 중 정상적으로 자주 실패할 수 있는 경로는 로그 폭주를 막기 위해 **주기(예: 1초) 단위로 누적/요약하여 로깅**합니다.

### Core_ErrorHandler 내부 예외 처리 주의

`Core_ErrorHandler` 자체 내부(파일 기록/포워딩 등)에서 발생한 예외를 다시 `Core_ErrorHandler.log/logException`으로 기록하면 재귀가 발생할 수 있습니다.
이 경우에는 **Console에만 최소 경고를 남기는 방식**을 사용합니다.

자세한 정책은 `docs/Project/EXCEPTION_POLICY.md`를 참고하세요.

## 표준 로그 포맷

### 기본 구조
```vb
Core_ErrorHandler가 내부적으로 시간/스레드명/컨텍스트를 포함해 출력합니다.
```

### 레벨 종류
- **ERR**: 에러 (작업 실패, 예외 발생)
- **WARN**: 경고 (문제 가능성, 비정상적 상황이지만 진행)
- **INFO**: 정보 (정상 동작, 중요 이벤트)

## 에러 메시지 패턴

### 1. 일반 에러 (예외 없음)
```vb
Core_ErrorHandler.log("ERR: Module.Function - Description | Context: value")
```

**예시:**
```vb
Core_ErrorHandler.log("ERR: XmlStore.SetValue - MAX_ITEMS exceeded (256) | Key: " & k)
```

### 2. 예외 처리 (Exception 객체 있음)
```vb
Catch exc
    Core_ErrorHandler.logException(exc, "Module.Function | Context: value")
End Try
```

**예시:**
```vb
Catch excRead
    Core_ErrorHandler.logException(excRead, "Storage_File_Manager.ReadFileContent | Path: " & path)
End Try
```

### 3. 경고 메시지
```vb
Core_ErrorHandler.log("WARN: Module.Function - Description | Context: value")
```

**예시:**
```vb
Core_ErrorHandler.log("WARN: XmlStore.SaveAsync - Path not set, file will not be saved")
```

### 4. 정보 메시지
```vb
Core_ErrorHandler.log("INFO: Module.Function - Description | Context: value")
```

**예시:**
```vb
Core_ErrorHandler.log("INFO: Storage_File_Manager.SafeSaveToFlash - Safe save completed | Path: " & path)
```

## 컨텍스트 정보 규칙

### 필수 포함 정보
- **파일 경로**: `Path: {path}`
- **키/값**: `Key: {key}`, `Value: {value}`
- **에러 코드**: `ErrorCode: {code}`
- **관련 파라미터**: 실패 원인 파악에 필요한 값

### 구분자
- 메시지와 컨텍스트: ` | ` (파이프 전후 공백)
- 여러 컨텍스트 항목: `, ` (쉼표 공백)

**예시:**
```vb
Core_ErrorHandler.log("ERR: AsyncSave.WorkerFunc - Save failed | Path: " & p & " | ErrorCode: " & CStr(saveResult))
```

## Core_ErrorHandler 함수 사용

### logErrorMessage (메시지만 출력)
```vb
Core_ErrorHandler.logErrorMessage("XmlStore initialization failed")
```
- 예외 없이 에러 메시지만 출력
- 자동으로 타임스탬프, 스레드명, 시스템 상태 포함

### logException (예외 객체 로깅)
```vb
Dim exc As New Exception
Try
    ' ... 작업
Catch exc
    Core_ErrorHandler.logException(exc, "XmlStore.LoadFromFile")
End Try
```
- 예외 정보 상세 출력 (ErrorCode, Message 포함)
- 컨텍스트 문자열로 발생 위치 명시

### logExceptionThrottled (예외 로깅 + throttle)

네트워크 Send/Close 같은 "실패가 잦은 경로"에서 로그 폭주를 막기 위한 API입니다.

```vb
Catch ex
    Core_ErrorHandler.logExceptionThrottled(ex, "Net_Tcp_SocketIO.Send | idx=...", "Net_Tcp_SocketIO.Send")
End Try
```

- `key` 단위로 **최소 간격(기본 1000ms)**마다 대표 예외 1회 + 누적 count(throttledCount)를 기록합니다.
- Silent ignore 대신 사용합니다.

### throwError (에러 코드 + 메시지)
```vb
Core_ErrorHandler.throwError(-1001, "Configuration invalid")
```

### throwError (로봇 에러 정보 포함)
```vb
Core_ErrorHandler.throwError(-1038, "Motion error", 1, &HF)
```

## 모듈별 적용 예시

### Storage_File_Manager
```vb
' 경로 검증 실패
If path = "" Then
    Core_ErrorHandler.log("ERR: Storage_File_Manager.SafeSaveFile - Invalid path or empty content")
    SafeSaveFile = SAVE_ERROR_PATH_INVALID
    Exit Function
End If

' 예외 처리
Catch excWrite
    Core_ErrorHandler.logException(excWrite, "Storage_File_Manager.DirectSaveFile | Path: " & path)
    DirectSaveFile = SAVE_ERROR_WRITE_FAILED
End Try
```

### XmlStore
```vb
' 경고 메시지
If m_path = "" Then
    Console.WriteLine(Utils.timeString() & " [" & Thread.CurrentThread.Name & "] WARN: XmlStore.SaveAsync - Path not set, file will not be saved")
End If

' 에러 메시지
If itemCount >= MAX_ITEMS Then
    Console.WriteLine(Utils.timeString() & " [" & Thread.CurrentThread.Name & "] ERR: XmlStore.SetValue - MAX_ITEMS exceeded (" & CStr(MAX_ITEMS) & ") | Key: " & k)
    Exit Sub
End If
```

### Data_AsyncSave
```vb
' 성공 정보
If saveResult = Storage_File_Manager.SAVE_SUCCESS Then
    If debugOn = 1 Then
        Core_ErrorHandler.log("INFO: AsyncSave.WorkerFunc - Saved successfully | Path: " & p & " (" & CStr(lenX) & " chars)")
    End If
Else
    Core_ErrorHandler.log("ERR: AsyncSave.WorkerFunc - Save failed | Path: " & p & " | ErrorCode: " & CStr(saveResult))
End If
```

## 체크리스트

새로운 에러 처리를 추가할 때:
- [ ] `Utils.timeString()` 사용
- [ ] `Thread.CurrentThread.Name` 포함
- [ ] 적절한 레벨 (ERR/WARN/INFO) 사용
- [ ] `Module.Function` 형식으로 위치 명시
- [ ] 파이프(`|`)로 컨텍스트 구분
- [ ] 중요 파라미터 값 포함
- [ ] 예외 객체가 있으면 ErrorCode와 Message 출력
- [ ] 가능하면 `Core_ErrorHandler` 함수 활용

## 참고
- 기준 모듈: `Core_ErrorHandler.gpl`
- 적용 모듈: `Storage_File_Manager.gpl`, `Data_XmlStore.gpl`, `Data_AsyncSave.gpl`
- 시스템 상태 정보 (SoftEStop, PowerState)는 `Core_ErrorHandler` 함수 사용 시 자동 포함
