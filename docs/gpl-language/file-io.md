# GPL 파일 입출력

GPL(Guidance Programming Language)의 파일 입출력 API와 Flash 메모리 환경에서의 안전한
저장 패턴을 정리한다.

> 옛 Test_robot 프로젝트의 저장 시스템 구현(`Storage_File_Manager`/`Data_AsyncSave` 등)
> 설명은 [아카이브](../archive/test-robot/file-io-implementation.md)로 이관됐다. 그 설계의
> 근거(Flash 수명, 원자적 쓰기)는 아래 원칙과 [design-principles](../development/design-principles.md)에 남아 있다.

## 저장 경로와 Flash 메모리 특성

- **Flash 경로**: `/flash/` — 영구 저장. **쓰기 횟수 수명 제한**이 있으므로 빈번한 쓰기를 피한다.
- **ROMDISK 경로**: `/ROMDISK/` — 휘발성 임시 저장, 직접 쓰기에 적합.
- 안전 저장 패턴: **ROMDISK에 임시 파일로 먼저 쓴 뒤 Flash로 이동(원자적 쓰기)**, 기존 파일은
  `.bak`으로 백업. 중간 실패 시 원본이 보호되고 백업에서 복구할 수 있다.

## 🧠 StreamWriter buffering/flush 요약 (GPL 공식 문서 기반)

- `StreamWriter.AutoFlush = True`면 각 Write/WriteLine마다 즉시 output이 발생할 수 있어 **파일 쓰기 성능이 느려질 수 있음**
- **AutoFlush 기본값: serial port 및 `/NVRAM` = True, 그 외 파일 = False**
- `StreamWriter.Flush`는 **버퍼된 데이터를 즉시 쓰고, output이 완료될 때까지 block** —
  호출자 관점에서 출력 완료를 보장하는 동기화 지점 (AutoFlush=True면 Flush 호출은 중복)
- `StreamWriter.Close`는 **Flush equivalent**를 수행하며, output 중이면 완료될 때까지 block. I/O 오류 시 Exception

따라서 작은 Write를 여러 번 하는 경우 `AutoFlush=False + 필요한 시점에 Flush`가 효율적이다.
비동기 저장 큐를 만든다면 `Flush()`는 "큐 draining"뿐 아니라 "워커의 저장 완료(in-flight)"까지
기다려야 의미가 정확하다.

공식 원문 (Brooks GPL Dictionary — File and Serial I/O):

- [StreamWriter Constructor](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/construct_sw.htm)
  · [AutoFlush](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/autoflush_wr.htm)
  · [Flush](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/flush_wr.htm)
  · [Close](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/close_wr.htm)
  · [Write](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/write_wr.htm)
  · [WriteLine](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/writeline_wr.htm)
  · [NewLine](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/newline_wr.htm)
- [File and Serial I/O Classes Summary](https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/fileserialintro.htm)

프로젝트 적용 이력(비동기 저장의 in-flight 추적 등)은 [아카이브 노트](../archive/sessions/streamwriter-notes.md) 참조.

## 파일 읽기 (StreamReader)

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

## File 클래스 (Shared Methods)

### 파일 삭제 (File.DeleteFile)
```vb
File.DeleteFile("/flash/projects/MergeCode/Macro.gpl")
File.DeleteFile("/flash/temp/old_data.txt")
```

### 파일 복사 (File.Copy)
```vb
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
1. **빈번한 쓰기 금지**: 같은 위치에 반복 저장 피하기 — 배치로 모아 쓰기
2. **백업 활용**: 중요한 파일은 항상 백업과 함께 저장
3. **임시 파일 정리**: 원자적 쓰기에 쓴 임시 파일은 정기적으로 정리

### 에러 처리
1. **반환값 확인**: 모든 저장 작업의 반환값 확인 필수
2. **백업 복구**: 저장 실패 시 백업에서 복구 고려
3. **로그 모니터링**: Console 출력을 통한 작업 상태 확인

### 성능 고려
1. **비동기/배치**: 대량 저장 시 워커 스레드 큐로 모아 저장 (Flash 쓰기 횟수도 줄어든다)
2. **경로 선택**: 임시 데이터는 ROMDISK, 영구 데이터는 Flash 사용
