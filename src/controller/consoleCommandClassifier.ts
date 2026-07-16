export type ConsoleCommandImpact = 'read-only' | 'state-changing' | 'destructive' | 'unknown';

export type ConsoleCommandCategory =
    | 'debug'
    | 'event-log'
    | 'file'
    | 'memory'
    | 'parameter'
    | 'project'
    | 'runtime'
    | 'system'
    | 'unknown';

export interface ConsoleCommandClassification {
    commandName: string;
    category: ConsoleCommandCategory;
    impact: ConsoleCommandImpact;
    detail: string;
}

const READ_ONLY_COMMANDS = new Map<string, ConsoleCommandCategory>([
    ['date', 'system'],
    ['dir', 'file'],
    ['directory', 'file'],
    ['errorlog', 'event-log'],
    ['memory', 'memory'],
    ['pd', 'parameter'],
    ['pdx', 'parameter'],
    ['show', 'debug'],
    ['type', 'file'],
]);

const STATE_CHANGING_COMMANDS = new Map<string, ConsoleCommandCategory>([
    ['break', 'debug'],
    ['compile', 'project'],
    ['continue', 'debug'],
    ['copy', 'file'],
    ['create', 'file'],
    ['execute', 'runtime'],
    ['load', 'project'],
    ['pc', 'parameter'],
    ['set', 'debug'],
    ['start', 'project'],
    ['step', 'debug'],
    ['stop', 'runtime'],
    ['sync', 'file'],
    ['unload', 'project'],
    ['xmodem', 'file'],
]);

const DESTRUCTIVE_COMMANDS = new Map<string, ConsoleCommandCategory>([
    ['del', 'file'],
    ['format', 'file'],
    ['shutdown', 'system'],
    ['softestop', 'runtime'],
]);

const SHOW_DETAIL_BY_ARG = new Map<string, string>([
    ['break', 'breakpoint list'],
    ['dio', 'digital I/O state'],
    ['global', 'global variable'],
    ['memory', 'memory usage'],
    ['modbus', 'MODBUS state'],
    ['network', 'network state'],
    ['stack', 'thread stack'],
    ['startuplog', 'startup log'],
    ['thread', 'thread state'],
    ['variable', 'thread variable'],
]);

export function classifyConsoleCommand(command: string): ConsoleCommandClassification {
    const normalized = command.trim().replace(/\s+/g, ' ');
    const match = normalized.match(/^([A-Za-z]+)(?:\b|\()/);
    const commandName = (match?.[1] ?? '').toLowerCase();

    if (!commandName) {
        return {
            commandName: '(empty)',
            category: 'unknown',
            impact: 'unknown',
            detail: 'empty or non-text command',
        };
    }

    // ErrorLog는 기본적으로 조회지만 `-clear` 플래그는 로그를 지우는 상태 변경 동작이다.
    if (commandName === 'errorlog' && /(^|\s)-clear\b/i.test(normalized)) {
        return {
            commandName,
            category: 'event-log',
            impact: 'state-changing',
            detail: 'error log clear',
        };
    }

    if (DESTRUCTIVE_COMMANDS.has(commandName)) {
        return {
            commandName,
            category: DESTRUCTIVE_COMMANDS.get(commandName)!,
            impact: 'destructive',
            detail: detailFor(commandName, normalized),
        };
    }

    if (READ_ONLY_COMMANDS.has(commandName)) {
        return {
            commandName,
            category: READ_ONLY_COMMANDS.get(commandName)!,
            impact: 'read-only',
            detail: detailFor(commandName, normalized),
        };
    }

    if (STATE_CHANGING_COMMANDS.has(commandName)) {
        return {
            commandName,
            category: STATE_CHANGING_COMMANDS.get(commandName)!,
            impact: 'state-changing',
            detail: detailFor(commandName, normalized),
        };
    }

    return {
        commandName,
        category: 'unknown',
        impact: 'unknown',
        detail: 'unclassified console command',
    };
}

export function formatConsoleCommandClassification(command: string): string {
    const c = classifyConsoleCommand(command);
    return `${c.impact}/${c.category}/${c.commandName}`;
}

/**
 * 디버그 REPL 등에서 쓰는 단순 판정 — 읽기 전용으로 확인된 명령만 true.
 * 미분류(unknown) 명령은 안전을 위해 읽기 전용으로 취급하지 않는다.
 */
export function isReadOnlyConsoleCommand(command: string): boolean {
    return classifyConsoleCommand(command).impact === 'read-only';
}

function detailFor(commandName: string, normalized: string): string {
    if (commandName === 'show') {
        const arg = normalized.split(' ')[1]?.toLowerCase();
        return SHOW_DETAIL_BY_ARG.get(arg) ?? 'controller state query';
    }

    if (commandName === 'pd' || commandName === 'pdx') {
        return 'parameter database read';
    }

    if (commandName === 'pc') {
        return 'parameter database write';
    }

    if (commandName === 'dir' || commandName === 'directory') {
        return 'controller directory query';
    }

    if (commandName === 'memory') {
        return 'memory usage query';
    }

    if (commandName === 'compile') {
        return 'project compile';
    }

    if (commandName === 'start') {
        return 'project/thread start';
    }

    if (commandName === 'stop') {
        return normalized.toLowerCase().includes('-a') || normalized.toLowerCase().includes('-all')
            ? 'stop all threads'
            : 'stop target thread';
    }

    return `${commandName} console command`;
}
