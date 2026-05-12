import * as vscode from 'vscode';

let terminal: vscode.Terminal | undefined;
let writeEmitter: vscode.EventEmitter<string> | undefined;
let closeEmitter: vscode.EventEmitter<number | void> | undefined;

function writeLine(line: string): void {
    if (!writeEmitter) { return; }
    writeEmitter.fire(`${line}\r\n`);
}

export function startLiveLogTerminal(): void {
    if (terminal) {
        terminal.show(true);
        return;
    }

    writeEmitter = new vscode.EventEmitter<string>();
    closeEmitter = new vscode.EventEmitter<number | void>();

    const pty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
            writeLine('[GPL Live Logs] started');
        },
        close: () => {
            // VS Code terminal UI close
            disposeLiveLogTerminal();
        },
    };

    terminal = vscode.window.createTerminal({
        name: 'GPL Live Logs',
        pty,
    });
    terminal.show(true);
}

export function stopLiveLogTerminal(): void {
    if (!terminal) { return; }
    writeLine('[GPL Live Logs] stopped');
    terminal.dispose();
    disposeLiveLogTerminal();
}

export function appendLiveLog(line: string): void {
    if (!terminal || !writeEmitter) { return; }
    writeLine(line);
}

export function isLiveLogTerminalEnabled(): boolean {
    return !!terminal;
}

function disposeLiveLogTerminal(): void {
    closeEmitter?.fire();
    writeEmitter?.dispose();
    closeEmitter?.dispose();
    writeEmitter = undefined;
    closeEmitter = undefined;
    terminal = undefined;
}
