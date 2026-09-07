/**
 * 실행 위치 데코레이션 — 트리에서 고른 쓰레드의 정지 줄(노란 강조)과 디버그 에러 줄(붉은 강조).
 *
 * 종전에는 activate() 클로저의 `stoppedLineDecoration`/`errorLineDecoration` 과 "현재 칠해진 에디터" 변수 2개를
 * 트리 명령과 디버그 이벤트 핸들러가 함께 만졌다. 여기로 모아 "한 번에 한 곳만 칠한다"는 규칙을 한 객체가 지킨다.
 * 사용자가 편집을 시작하면 두 강조를 모두 지운다(종전과 동일).
 */
import * as vscode from 'vscode';

export class ExecutionDecorations implements vscode.Disposable {
	private readonly stoppedLine: vscode.TextEditorDecorationType;
	private readonly errorLine: vscode.TextEditorDecorationType;
	// Track the current decoration so we can clear it
	private stoppedEditor: vscode.TextEditor | undefined;
	private errorEditor: vscode.TextEditor | undefined;
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
		// Clear highlight when user starts editing or switches away
		this.disposables.push(
			this.stoppedLine,
			this.errorLine,
			vscode.workspace.onDidChangeTextDocument(() => {
				this.clearStopped();
				this.clearError();
			}),
		);
	}

	/** 정지 위치 강조 — 이전 강조는 지우고 이 에디터의 range 하나만 칠한다. */
	showStopped(editor: vscode.TextEditor, range: vscode.Range): void {
		this.clearStopped();
		editor.setDecorations(this.stoppedLine, [{ range }]);
		this.stoppedEditor = editor;
	}

	/** 에러 위치 강조 — 정지 강조까지 함께 지운 뒤 칠한다(에러 줄이 유일한 강조가 되도록, 종전 동작). */
	showError(editor: vscode.TextEditor, range: vscode.Range): void {
		this.clearStopped();
		this.clearError();
		editor.setDecorations(this.errorLine, [{ range }]);
		this.errorEditor = editor;
	}

	/** Clear the stopped-line highlight */
	clearStopped(): void {
		if (this.stoppedEditor) {
			this.stoppedEditor.setDecorations(this.stoppedLine, []);
			this.stoppedEditor = undefined;
		}
	}

	clearError(): void {
		if (this.errorEditor) {
			this.errorEditor.setDecorations(this.errorLine, []);
			this.errorEditor = undefined;
		}
	}

	dispose(): void {
		for (const d of this.disposables) { d.dispose(); }
		this.disposables.length = 0;
	}
}
