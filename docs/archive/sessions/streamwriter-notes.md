# StreamWriter Flush/Close/AutoFlush 요약 (Brooks / GPL Dictionary)

작성일: 2025-12-17

## 목적
이 문서는 Brooks 컨트롤러 GPL Dictionary의 **StreamWriter** 문서에서 Flush/Close/AutoFlush 동작 의미를 빠르게 재확인하고,
프로젝트의 비동기 저장(`Test_robot/Data_AsyncSave.gpl`)에서 **Flush 의미를 어떻게 맞췄는지**를 기록한다.

## 참고 링크 (원문)
- New StreamWriter Constructor
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/construct_sw.htm
- StreamWriter.AutoFlush Property
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/autoflush_wr.htm
- StreamWriter.Flush Method
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/flush_wr.htm
- StreamWriter.Close Method
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/close_wr.htm
- StreamWriter.Write Method
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/write_wr.htm
- StreamWriter.WriteLine Method
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/writeline_wr.htm
- StreamWriter.NewLine Property
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/StreamWriter/newline_wr.htm
- File and Serial I/O Classes Summary
  - https://www2.brooksautomation.com/Controller_Software/Software_Reference/GPL_Dictionary/File_Serial/fileserialintro.htm

## 핵심 요약

### 1) Flush: 버퍼된 출력 즉시 수행 + 완료될 때까지 block
원문(요지):
- Flush는 StreamWriter의 **버퍼된 데이터를 즉시 출력**한다.
- 실제 출력이 수행될 때, **완료될 때까지 block**한다.
- AutoFlush가 True이면 Flush 호출은 **중복**이다.

실무 해석:
- “Flush를 호출했는데 아직 기록 중” 같은 상태는 문서 의미상 허용되지 않는다.
- 즉 Flush는 호출자 관점에서 **출력 완료를 보장하는 동기화 지점**이다.

### 2) AutoFlush: True면 write마다 즉시 출력(느려질 수 있음)
원문(요지):
- AutoFlush=True → 출력 요청이 즉시 파일/디바이스로 기록된다.
- AutoFlush=False → 출력이 버퍼링될 수 있으며 시스템이 기록 시점을 결정한다.
- 버퍼된 출력은 Flush/Close에서 항상 즉시 기록된다.
- 파일에 대해 AutoFlush=True는 write 성능을 크게 저하시킬 수 있다.
- 기본값: serial port 및 /NVRAM = True, 그 외 파일 = False

실무 해석:
- 작은 write가 많을 때 AutoFlush=True는 비효율적일 수 있다.
- 여러 write를 모아 Flush 한 번이 더 효율적일 수 있다.

### 3) Close: Flush equivalent를 항상 수행 + 완료될 때까지 block
원문(요지):
- Close는 연결된 파일/디바이스를 닫는다.
- 닫히기 전에 **pending buffered output을 기록**한다.
- 기록 중이면 **완료될 때까지 block**한다.
- I/O 오류 시 Exception.

실무 해석:
- 안전 종료 시 Close는 “버퍼 비우기 + 닫기”를 보장하는 최종 동작.

## 프로젝트 적용 메모

### Storage_File_Manager 동기 저장
`Test_robot/Storage_File_Manager.gpl`의 `DirectSaveFile()`은 `Write()` 후 `Flush()` 후 `Close()`를 수행한다.
문서 의미와 정합적이며, 동기 저장 경로에서 “버퍼 남김” 문제는 낮다.

### Data_AsyncSave.Flush 의미 개선
문제:
- 기존 `Data_AsyncSave.Flush()`가 `PendingCount()==0`만 조건으로 보면,
  워커가 `Dequeue` 후 실제 `SafeSaveFile()` 수행 중인 작업(in-flight)이 있어도
  Flush가 성공으로 빠르게 종료될 수 있다.

개선(현재 적용):
- `Data_AsyncSave`가 `inFlight`를 추적한다.
- `Flush()`는 다음을 모두 만족할 때만 성공:
  - `PendingCount() == 0`
  - `inFlight == 0`

추가 진단:
- `GetCompletedCount()` / `GetLastCompletedTick()` 제공 (타임아웃/정체 원인 추적용)

## 체크리스트 (운영/디버깅)
- Flush 타임아웃이 발생하면:
  - PendingCount가 계속 0이 아닌지
  - inFlight가 1에서 내려오지 않는지
  - Worker health(IsWorkerAlive) 및 로그에서 SafeSaveFile 에러 여부 확인

