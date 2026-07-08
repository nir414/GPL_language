#!/usr/bin/env node
// GPL Controller MCP server.
// Brooks / Precise Automation PA 제어기를 1402 ASCII 콘솔로 조작한다.
// Claude(Desktop/Cowork/Code)가 compile / run / debug 도구를 호출할 수 있게 노출.
//
// 설정(환경변수):
//   GPL_HOST       제어기 IP            (기본 192.168.0.1)
//   GPL_PORT       콘솔 포트            (기본 1402)
//   GPL_PROJECT    기본 프로젝트명      (기본 MergeCode)
//   GPL_TIMEOUT_MS 명령 타임아웃(ms)    (기본 15000)
//
// 주의: stdout은 MCP 전송 채널이다. 로그는 반드시 stderr(console.error)로만.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ControllerConsole } from './console.js';
import {
  parseStatus,
  extractData,
  parseCompileErrors,
  parseThreadList,
  isSuccess,
} from './parse.js';

const HOST = process.env.GPL_HOST || '192.168.0.1';
const PORT = parseInt(process.env.GPL_PORT || '1402', 10);
const DEFAULT_PROJECT = process.env.GPL_PROJECT || 'MergeCode';
const TIMEOUT = parseInt(process.env.GPL_TIMEOUT_MS || '15000', 10);

const consoleClient = new ControllerConsole({ host: HOST, port: PORT, commandTimeoutMs: TIMEOUT });

const server = new McpServer({ name: 'gpl-controller-mcp', version: '0.1.0' });

function textResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

async function runCommand(command, opts) {
  const raw = await consoleClient.send(command, opts);
  const status = parseStatus(raw);
  return { command, status, ok: isSuccess(status), data: extractData(raw) };
}

// 모든 핸들러를 try/catch로 감싸 에러를 도구 결과로 반환(서버 크래시 방지).
function tool(name, description, shape, handler) {
  server.tool(name, description, shape, async (args) => {
    try {
      return await handler(args ?? {});
    } catch (err) {
      return {
        content: [{ type: 'text', text: `ERROR (${name}): ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  });
}

const proj = (p) => (p && p.trim()) || DEFAULT_PROJECT;

// ── 기본/에스케이프 ───────────────────────────────────────────────────────
tool('controller_command',
  '임의의 1402 콘솔 명령을 그대로 전송한다(에스케이프 해치). 구조화 도구로 안 되는 명령에만 사용.',
  { command: z.string().describe('보낼 콘솔 명령 한 줄') },
  async ({ command }) => textResult(await runCommand(command)));

tool('controller_status',
  '제어기 연결/스레드 상태를 빠르게 확인한다(Show Thread -web).',
  {},
  async () => {
    const raw = await consoleClient.send('Show Thread -web');
    const status = parseStatus(raw);
    const { threads } = parseThreadList(raw);
    return textResult({ host: HOST, port: PORT, ok: isSuccess(status), status, threadCount: threads.length, threads });
  });

// ── 컴파일/실행 ───────────────────────────────────────────────────────────
tool('compile_project',
  '프로젝트를 컴파일한다(Compile). 성공/실패는 STATUS로만 판정하고, 실패 시 에러 라인을 파싱해 돌려준다.',
  { project: z.string().optional().describe(`프로젝트명(기본 ${DEFAULT_PROJECT})`) },
  async ({ project }) => {
    const raw = await consoleClient.send(`Compile ${proj(project)}`, { timeoutMs: Math.max(TIMEOUT, 60000) });
    const status = parseStatus(raw);
    const { errors, aggregate } = parseCompileErrors(raw);
    return textResult({ command: `Compile ${proj(project)}`, ok: isSuccess(status), status, errorCount: errors.length, errors, aggregate });
  });

tool('start_project',
  '프로젝트 실행을 시작한다(Start). stopOnEntry=true면 진입점에서 정지(-break -bex). [시뮬레이션 모드 권장]',
  {
    project: z.string().optional(),
    stopOnEntry: z.boolean().optional().describe('진입점에서 멈춤(디버그 시작용)'),
  },
  async ({ project, stopOnEntry }) => {
    const cmd = stopOnEntry ? `Start ${proj(project)} -break -bex` : `Start ${proj(project)}`;
    return textResult(await runCommand(cmd));
  });

tool('unload_project',
  '프로젝트를 메모리에서 제거한다(Unload).',
  { project: z.string().optional() },
  async ({ project }) => textResult(await runCommand(`Unload ${proj(project)}`)));

// ── 실행 제어(디버그) ─────────────────────────────────────────────────────
tool('pause_thread',
  '실행 중인 스레드를 일시정지한다(Break <thread>).',
  { thread: z.string().describe('스레드 이름') },
  async ({ thread }) => textResult(await runCommand(`Break ${thread}`)));

tool('continue_thread',
  '일시정지된 스레드를 재개한다(Continue). ignoreErrors=true면 -noerror.',
  { thread: z.string(), ignoreErrors: z.boolean().optional() },
  async ({ thread, ignoreErrors }) =>
    textResult(await runCommand(`Continue ${thread}${ignoreErrors ? ' -noerror' : ''}`)));

tool('step_thread',
  '한 스텝 실행한다(Step). mode: into(기본)/over/out. 항상 -noerror 적용.',
  { thread: z.string(), mode: z.enum(['into', 'over', 'out']).optional() },
  async ({ thread, mode }) => {
    const flag = mode === 'over' ? ' -over' : mode === 'out' ? ' -out' : '';
    return textResult(await runCommand(`Step ${thread}${flag} -noerror`));
  });

tool('softestop',
  '모든 로봇 모션을 급정지한다(SoftEStop, 모터 전원은 유지). 안전 정지용.',
  {},
  async () => textResult(await runCommand('SoftEStop')));

// ── 브레이크포인트 ────────────────────────────────────────────────────────
// 주의: Set Break/Nobreak는 따옴표와 줄번호 사이에 공백이 없다(GDE 캡처로 검증).
tool('set_breakpoint',
  '브레이크포인트 설정(Set Break <project> "<file>"<line>). file은 따옴표 안 파일명.',
  { file: z.string().describe('예: ProtocolModule.gpl'), line: z.number().int().positive(), project: z.string().optional() },
  async ({ file, line, project }) => textResult(await runCommand(`Set Break ${proj(project)} "${file}"${line}`)));

tool('clear_breakpoint',
  '브레이크포인트 해제(Set Nobreak <project> "<file>"<line>).',
  { file: z.string(), line: z.number().int().positive(), project: z.string().optional() },
  async ({ file, line, project }) => textResult(await runCommand(`Set Nobreak ${proj(project)} "${file}"${line}`)));

tool('list_breakpoints',
  '설정된 모든 브레이크포인트 표시(Show Break).',
  {},
  async () => textResult(await runCommand('Show Break')));

// ── 관찰(스레드/스택/변수) ────────────────────────────────────────────────
tool('show_threads',
  '전체 스레드 목록(Show Thread -web)을 구조화해 반환.',
  {},
  async () => {
    const raw = await consoleClient.send('Show Thread -web');
    const status = parseStatus(raw);
    const { threads, rawLines } = parseThreadList(raw);
    return textResult({ ok: isSuccess(status), status, threads, rawLines });
  });

tool('show_thread',
  '특정 스레드 상세(Show Thread <thread>) — 현재 위치/상태.',
  { thread: z.string() },
  async ({ thread }) => textResult(await runCommand(`Show Thread ${thread}`)));

tool('show_stack',
  '스레드의 호출 스택(Show Stack <thread>).',
  { thread: z.string() },
  async ({ thread }) => textResult(await runCommand(`Show Stack ${thread}`)));

tool('eval_expression',
  '정지된 스레드의 특정 프레임에서 식/변수를 평가한다(Show Variable -eval <thread> <frame> <expr>).',
  {
    thread: z.string(),
    frame: z.number().int().min(0).describe('스택 프레임 인덱스(0=최상단)'),
    expression: z.string().describe('변수명 또는 식'),
  },
  async ({ thread, frame, expression }) =>
    textResult(await runCommand(`Show Variable -eval ${thread} ${frame} ${expression}`)));

tool('set_variable',
  '변수/식에 값을 대입한다(Execute <expression>, <project>). 예: expression="myVar = 1". [시뮬레이션 모드 권장]',
  { expression: z.string().describe('예: someVar = 123'), project: z.string().optional() },
  async ({ expression, project }) => textResult(await runCommand(`Execute ${expression}, ${proj(project)}`)));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[gpl-controller-mcp] ready — target ${HOST}:${PORT}, default project "${DEFAULT_PROJECT}"`);
}

main().catch((err) => {
  console.error('[gpl-controller-mcp] fatal:', err);
  process.exit(1);
});
