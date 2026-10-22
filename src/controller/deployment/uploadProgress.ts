/**
 * 업로드 진행 집계 — 정본(vscode 무의존).
 *
 * FTP 업로드(`ftpClient.uploadProject`/`mirrorProject`)가 파일 단위·바이트 단위로 알리는 진행을 하나의 스냅샷으로
 * 모아 이벤트로 내보낸다(`UploadProgressTracker`). 어떻게 보이는가(진행 바 글자·툴팁·완료 요약)는
 * `views/uploadProgressBar`(순수)에 있고, 상태바(`views/connectionStatusBar`)가 그것을 그린다(ai-handoff §1-EE).
 * 출력 패널은 한 번 쓴 줄을 제자리에서 고칠 수 없으므로 움직이는 바는 상태바에만 그리고, 출력 패널에는 종전처럼
 * 파일별 한 줄 로그만 남긴다.
 *
 * # 분모
 * 총량은 **로컬 대상 파일 크기의 합**이다. 스킵(내용 동일) 판정은 파일마다 루프 안에서 이뤄지므로(원격 SIZE 조회·SHA-1)
 * 미리 걸러내려면 왕복이 두 배가 된다. 대신 스킵된 파일은 그 시점에 "완료"로 더한다 — 바는 "프로젝트 중 얼마가
 * 원격과 같아졌는가"를 뜻하고, 스킵 구간에서는 단숨에 뛴다.
 *
 * # 바이트 출처
 * basic-ftp `trackProgress` 는 전송 중인 소켓의 바이트를 0.5초마다(시작·끝에는 즉시) 알린다. 값은 **전송 건별**이라
 * 검증 실패 재전송에서는 0부터 다시 시작하는데, 파일 크기로 자르므로 바가 잠깐 물러섰다 되돌아올 뿐 넘치지 않는다.
 */

export type UploadFileAction = 'uploaded' | 'skipped';

/** 진행 스냅샷 — 표시의 단위. */
export interface UploadProgress {
    /** 처리가 끝난 파일 크기 누적 + 전송 중 파일의 전송분(바이트). */
    doneBytes: number;
    /** 대상 파일 크기 합(스킵될 파일 포함). */
    totalBytes: number;
    /** 처리가 끝난(업로드 또는 스킵) 파일 수. */
    doneFiles: number;
    totalFiles: number;
    /** 지금 전송 중이거나 방금 끝난 파일 — 프로젝트 기준 상대 경로(`/` 구분). */
    file?: string;
}

/**
 * 진행 이벤트. `file` 은 파일 하나의 처리가 끝났을 때(로그 한 줄의 단위), `bytes` 는 전송 중 바이트 갱신
 * (상태바만 관심 있다 — 로그에 찍으면 같은 파일이 여러 줄 쌓인다).
 */
export type UploadProgressEvent =
    | (UploadProgress & { type: 'bytes' })
    | (UploadProgress & { type: 'file'; action: UploadFileAction });

/** 업로드 집계 결과 — 완료 표시 문구의 재료. */
export interface UploadSummary {
    uploaded: number;
    skipped: number;
    totalBytes: number;
}

/**
 * 파일 단위·바이트 단위 진행을 한 스냅샷으로 모아 이벤트로 내보낸다.
 *
 * 호출 규약(ftpClient 가 지킨다): 업로드하는 파일은 `begin` → (`transferred` …) → `end('uploaded')`,
 * 스킵하는 파일은 `end('skipped')` 만. `transferred` 는 `begin` 없이 오면 무시한다(목록 조회 같은 다른 전송의 바이트가
 * 섞여 들어와도 바가 움직이지 않게). 크기는 생성자에 준 목록(루프 전 스냅샷)과 같은 값을 `begin`/`end` 에 넘긴다 —
 * 그래야 끝났을 때 done 이 total 과 정확히 같다.
 */
export class UploadProgressTracker {
    readonly totalBytes: number;
    readonly totalFiles: number;
    private doneBytes = 0;
    private doneFiles = 0;
    private current: { file: string; size: number; bytes: number } | undefined;

    constructor(
        files: ReadonlyArray<{ size: number }>,
        private readonly emit: (event: UploadProgressEvent) => void,
    ) {
        this.totalFiles = files.length;
        this.totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    }

    /** 파일 전송 시작. 이후 `transferred` 가 이 파일의 바이트를 갱신한다. */
    begin(file: string, size: number): void {
        this.current = { file, size, bytes: 0 };
        this.emit({ ...this.snapshot(), type: 'bytes' });
    }

    /** 전송 중 파일의 누적 전송 바이트(전송 건 기준 — 재전송이면 0부터). 파일 크기를 넘지 않게 자른다. */
    transferred(bytes: number): void {
        if (!this.current) { return; }
        this.current.bytes = Math.max(0, Math.min(bytes, this.current.size));
        this.emit({ ...this.snapshot(), type: 'bytes' });
    }

    /** 파일 처리 끝 — 업로드됐든 스킵됐든 그 크기를 완료분에 더한다. */
    end(file: string, size: number, action: UploadFileAction): void {
        this.current = undefined;
        this.doneBytes += size;
        this.doneFiles++;
        this.emit({ ...this.snapshot(), file, type: 'file', action });
    }

    snapshot(): UploadProgress {
        return {
            doneBytes: this.doneBytes + (this.current?.bytes ?? 0),
            totalBytes: this.totalBytes,
            doneFiles: this.doneFiles,
            totalFiles: this.totalFiles,
            file: this.current?.file,
        };
    }
}
