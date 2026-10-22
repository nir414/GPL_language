/**
 * 실행 위치 데코레이션 — 트리에서 고른 쓰레드의 정지 줄(노란 강조)과 디버그 에러 줄(붉은 강조).
 *
 * 종전에는 activate() 클로저의 `stoppedLineDecoration`/`errorLineDecoration` 과 "현재 칠해진 에디터" 변수 2개를
 * 트리 명령과 디버그 이벤트 핸들러가 함께 만졌다. 여기로 모아 "한 번에 한 곳만 칠한다"는 규칙을 한 객체가 지킨다.
 * 칠해진 문서를 사용자가 편집하면 그 강조를 지운다(다른 문서·Output 채널의 변경은 무시 — §1-EA).
 *
 * 강조는 제어기 상태의 표시이므로 상태가 끝나면 함께 지운다(§1-EP): 칠할 때 **주인 쓰레드**를 기억해 두고,
 * 트리가 쓰레드 목록을 갱신할 때마다 `reconcile` 로 "그 쓰레드가 아직 그 상태인가"를 확인한다(판정은
 * `controller/debugging/executionMarks` 순수 함수). 종전에는 편집·덮어칠하기 외에 지우는 경로가 없어 에러 난 쓰레드를
 * 재시작해 에러가 사라진 뒤에도 붉은 줄이 남았다.
 */
import * as vscode from 'vscode';
import { ExecutionMarkOwner, isErrorMarkStale, isStoppedMarkStale, RuntimeStateSnapshot } from '../controller/debugging/executionMarks';

export class ExecutionDecorations implements vscode.Disposable {
	private readonly stoppedLine: vscode.TextEditorDecorationType;
	private readonly errorLine: vscode.TextEditorDecorationType;
	// Track the current decoration so we can clear it
	private stoppedEditor: vscode.TextEditor | undefined;
	private stoppedOwner: ExecutionMarkOwner = {};
	private errorEditor: vscode.TextEditor | undefined;
	private errorOwner: ExecutionMarkOwner = {};
	private readonly disposables: vscode.Disposable[] = [];

	constructor() {
		// Decoration: yellow arrow + line highlight for the stopped position
		this.stoppedLine = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground'),
			overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
			overviewRulerLane: vscode.OverviewRulerLane.Center,
		});
		this.errorLine = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: 'rgba(255, 40, 40, 0.22)',
			border: '1px solid rgba(255, 80, 80, 0.9)',
			overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.errorForeground'),
			overviewRulerLane: vscode.OverviewRulerLane.Right,
		});
		// 칠해진 문서를 사용자가 실제로 편집하면 그 강조만 지운다.
		// 종전에는 어떤 문서의 변경이든 두 강조를 다 지웠는데, Output 채널(`output:` 스킴)도 TextDocument 라 이 이벤트를
		// 낸다 — `threadShowLocation` 이 칠한 직후 `[Thread] … 정지 위치` 로그 한 줄을 찍는 순간 강조가 지워져
		// "노란색이 깜빡하고 사라진다"(2026-09-21 사용자 관측, §1-EA). 5초 폴링 로그·1403 콘솔 줄도 같은 경로로 지웠다.
		this.disposables.push(
			this.stoppedLine,
			this.errorLine,
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.contentChanges.length === 0) { return; }
				if (this.stoppedEditor && e.document === this.stoppedEditor.document) { this.clearStopped(); }
				if (this.errorEditor && e.document === this.errorEditor.document) { this.clearError(); }
			}),
		);
	}

	/**
	 * 정지 위치 강조 — 이전 강조는 지우고 이 에디터의 range 하나만 칠한다.
	 * `owner.threadName` 을 주면 그 쓰레드가 정지 상태를 벗어날 때 자동으로 지워진다(`reconcile`).
	 */
	showStopped(editor: vscode.TextEditor, range: vscode.Range, owner: ExecutionMarkOwner = {}): void {
		this.clearStopped();
		editor.setDecorations(this.stoppedLine, [{ range }]);
		this.stoppedEditor = editor;
		this.stoppedOwner = owner;
	}

	/**
	 * 에러 위치 강조 — 정지 강조까지 함께 지운 뒤 칠한다(에러 줄이 유일한 강조가 되도록, 종전 동작).
	 * `owner.threadName` 을 주면 그 쓰레드가 `Error` 상태를 벗어날 때(재시작·Stop) 자동으로 지워진다(`reconcile`).
	 */
	showError(editor: vscode.TextEditor, range: vscode.Range, owner: ExecutionMarkOwner = {}): void {
		this.clearStopped();
		this.clearError();
		editor.setDecorations(this.errorLine, [{ range }]);
		this.errorEditor = editor;
		this.errorOwner = owner;
	}

	/**
	 * 쓰레드 목록 갱신에 맞춰 낡은 강조를 지운다 — 트리의 `onDidChangeRuntimeState` 마다 호출된다
	 * (폴링·디버그 브리지·연결 해제 모두 같은 경로). 판정 규칙은 `controller/debugging/executionMarks` 참조.
	 */
	reconcile(snapshot: RuntimeStateSnapshot): void {
		if (this.errorEditor && isErrorMarkStale(this.errorOwner, snapshot)) { this.clearError(); }
		if (this.stoppedEditor && isStoppedMarkStale(this.stoppedOwner, snapshot)) { this.clearStopped(); }
	}

	/** Clear the stopped-line highlight */
	clearStopped(): void {
		if (this.stoppedEditor) {
			this.stoppedEditor.setDecorations(this.stoppedLine, []);
			this.stoppedEditor = undefined;
		}
		this.stoppedOwner = {};
	}

	clearError(): void {
		if (this.errorEditor) {
			this.errorEditor.setDecorations(this.errorLine, []);
			this.errorEditor = undefined;
		}
		this.errorOwner = {};
	}

	dispose(): void {
		for (const d of this.disposables) { d.dispose(); }
		this.disposables.length = 0;
	}
}
