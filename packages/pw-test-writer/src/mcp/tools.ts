/**
 * MCP Tool definitions for the E2E test capture server.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ActionCapture, NetworkRequestCapture } from 'playwright-core/lib/server/actionCaptureTypes';
import type { TestRunResult, TestRunTestEntry } from './types.js';
import { scanPageObjects, formatPageObjectIndex, formatPageObjectSummary } from './pageObjects.js';
import { readFlows, saveFlow, formatFlows, discoverFlowsFromSpecs, formatDiscoveredFlows, type AppFlow, type FlowStep } from './flows.js';

// ── Tool metadata ──

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const toolDefs: ToolDef[] = [
  {
    name: 'e2e_list_tests',
    description: 'Discover available Playwright tests in the project. Returns test files with their test cases and line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Playwright project name to filter by (e.g. "e2e", "admin", "mobile")' },
      },
    },
  },
  {
    name: 'e2e_list_projects',
    description: 'List available Playwright projects from the config. Returns project names that can be used with the project parameter in other tools.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'e2e_run_test',
    description: 'Run Playwright tests. When location is provided, runs a specific test with action capture for deep debugging. When location is omitted, runs all tests (optionally filtered by project) and returns a pass/fail summary.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Test location: file path or file:line. Omit to run all tests.' },
        grep: { type: 'string', description: 'Filter tests by title (passed as --grep to Playwright). Use with location to isolate parameterized tests that share the same line number.' },
        project: { type: 'string', description: 'Playwright project name to filter by (e.g. "e2e", "admin", "mobile")' },
        timeout: { type: 'number', description: 'Timeout in seconds for the test run (default: 120). Increase for slow tests or multi-step flows.' },
      },
    },
  },
  {
    name: 'e2e_get_failure_report',
    description: 'Get a failure report for a test run. Returns error, failing action details, action timeline, failed network requests, and console errors. DOM snapshot and network bodies are excluded by default to save tokens — use includeDom/includeNetworkBodies params when needed.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID from e2e_run_test' },
        testIndex: { type: 'number', description: 'Test index within the run (default: 0)' },
        includeDom: { type: 'boolean', description: 'Include DOM snapshot at point of failure (default: false). Only use when you need to inspect page structure.' },
        includeNetworkBodies: { type: 'boolean', description: 'Include full request/response bodies in network section (default: false). Only use when you need to inspect payloads.' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'e2e_get_actions',
    description: 'Get the action timeline for a test run. Shows what happened step-by-step.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID from e2e_run_test' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'e2e_get_action_detail',
    description: 'Get full detail for a single action including DOM snapshots, timing, params, error.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
        actionIndex: { type: 'number', description: 'Action index in the timeline' },
      },
      required: ['runId', 'actionIndex'],
    },
  },
  {
    name: 'e2e_get_network',
    description: 'Get network requests from a test run. Optionally filter by URL pattern, method, or status code. Response bodies are excluded by default to save tokens — use includeBody=true when you need payload details.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
        urlPattern: { type: 'string', description: 'Filter by URL substring' },
        method: { type: 'string', description: 'Filter by HTTP method' },
        statusMin: { type: 'number', description: 'Minimum status code (e.g. 400 for errors)' },
        includeBody: { type: 'boolean', description: 'Include full request/response bodies (default: false). Expensive — only use when you need to inspect payloads.' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'e2e_get_console',
    description: 'Get console output from a test run. Optionally filter by type (error, warn, log, info).',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
        type: { type: 'string', description: 'Filter by type: error, warn, log, info' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'e2e_get_screenshot',
    description: 'Get a failure screenshot as a base64 image. Returns the image content that Claude can display.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
        screenshotIndex: { type: 'number', description: 'Screenshot index (default: 0)' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'e2e_get_dom_snapshot',
    description: 'Get the DOM snapshot before and/or after a specific action. Use interactiveOnly=true to get only inputs/buttons/dropdowns (much smaller). Use depth to limit tree depth for orientation.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
        actionIndex: { type: 'number', description: 'Action index' },
        which: { type: 'string', description: '"before", "after", or "both" (default: "after")' },
        interactiveOnly: { type: 'boolean', description: 'Only return interactive elements (buttons, inputs, dropdowns, checkboxes, radios). Reduces output by ~70%. Use this first before requesting full snapshot.' },
        depth: { type: 'number', description: 'Max tree depth to return (0=root only, 2=top sections, unlimited by default). Use 2 for page orientation, omit for full detail.' },
      },
      required: ['runId', 'actionIndex'],
    },
  },
  {
    name: 'e2e_get_dom_diff',
    description: 'Get the DOM diff (added/removed/changed elements) for a specific action.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
        actionIndex: { type: 'number', description: 'Action index' },
      },
      required: ['runId', 'actionIndex'],
    },
  },
  {
    name: 'e2e_get_test_source',
    description: 'Read the test source file with the specific test function highlighted.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Test file path (relative to project root)' },
        testLine: { type: 'number', description: 'Line number of the test' },
        context: { type: 'number', description: 'Number of lines before/after testLine to include (default: 60). Use smaller values to save tokens when you only need the test function body.' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'e2e_find_elements',
    description: 'Search the DOM snapshot for elements matching a role or text. Much cheaper than loading a full DOM snapshot — use this to check if a specific dropdown, button, or input exists on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        testIndex: { type: 'number', description: 'Test index (default: 0)' },
        actionIndex: { type: 'number', description: 'Action index to get the snapshot from' },
        which: { type: 'string', description: '"before" or "after" (default: "after")' },
        role: { type: 'string', description: 'ARIA role to search for (e.g. "combobox", "button", "textbox", "checkbox", "radio")' },
        text: { type: 'string', description: 'Text to search for in element labels/values (case-insensitive)' },
      },
      required: ['runId', 'actionIndex'],
    },
  },
  {
    name: 'e2e_scan_page_objects',
    description: 'Scan all .page.ts and .service.ts files in the project. Returns class names, methods (with @step decorators), and getters — so you know what page object methods are available before writing or fixing tests.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'e2e_get_app_flows',
    description: 'Read stored application flows from .e2e-flows.json. Flows describe confirmed user journeys (e.g. "user-registration") with their required steps and actions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'e2e_save_app_flow',
    description: 'Save a confirmed application flow to .e2e-flows.json. The flow must include confirmed: true to indicate the user has verified it. Updates existing flows by flowName. Use a naming convention for variants: "checkout--continue-draft", "checkout--validation".',
    inputSchema: {
      type: 'object',
      properties: {
        flowName: { type: 'string', description: 'Unique flow identifier (e.g. "user-registration"). Use "--" suffix for variants: "user-registration--continue-draft".' },
        description: { type: 'string', description: 'Human-readable description of the flow' },
        pre_conditions: {
          type: 'array',
          items: { type: 'string' },
          description: 'State the app must be in before this flow starts. E.g. ["no draft exists", "user is logged in"]. Claude uses this to diagnose dirty-state failures.',
        },
        steps: {
          type: 'array',
          description: 'Ordered steps in the flow',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Step name (e.g. "Basic Car Info")' },
              required_actions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Required actions in this step (e.g. "selectCategory(\'Electronics\')")',
              },
            },
            required: ['name', 'required_actions'],
          },
        },
        notes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Free-form observations about this flow — edge cases, known dialogs, gotchas. Accumulates like memory entries. E.g. ["If \'Continue?\' dialog appears, state is dirty → beforeEach should delete draft via API"].',
        },
        related_flows: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of related flows: variants, prerequisites, follow-ups. E.g. ["checkout--continue-draft", "checkout--validation"].',
        },
        confirmed: { type: 'boolean', description: 'Must be true — indicates the user has verified this flow' },
      },
      required: ['flowName', 'description', 'steps', 'confirmed'],
    },
  },
  {
    name: 'e2e_get_context',
    description: 'Load project context in one call: stored application flows + page object index. Call this before debugging to understand the project structure and available methods.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'e2e_discover_flows',
    description: 'Scan all spec files and extract the sequence of page-object method calls per test. Use this when no flows are stored yet — it gives you a draft flow map inferred from static analysis so you can understand what each test is trying to do without running it.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Content types for MCP responses ──

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

type Content = TextContent | ImageContent;

export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] };
}

function error(msg: string): ToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

// ── Tool handlers ──

export type RunsMap = Map<string, TestRunResult>;

export interface ToolContext {
  cwd: string;
  runs: RunsMap;
  discoverTests: (cwd: string, project?: string) => Promise<Array<{ path: string; relativePath: string; tests: Array<{ title: string; line: number; fullTitle: string }> }>>;
  discoverProjects: (cwd: string) => Promise<Array<{ name: string; testDir?: string }>>;
  runTest: (location: string, cwd: string, options?: { project?: string; grep?: string; timeoutMs?: number }) => Promise<TestRunResult>;
  runProject: (cwd: string, options?: { project?: string }) => Promise<TestRunResult>;
}

function getTest(ctx: ToolContext, runId: string, testIndex = 0): TestRunTestEntry | null {
  const run = ctx.runs.get(runId);
  if (!run) return null;
  return run.tests[testIndex] ?? null;
}

function getAction(ctx: ToolContext, runId: string, testIndex: number, actionIndex: number): ActionCapture | null {
  const test = getTest(ctx, runId, testIndex);
  if (!test) return null;
  return test.actions[actionIndex] ?? null;
}

function actionNotFound(ctx: ToolContext, runId: string, testIndex: number, actionIndex: number): ToolResult {
  const test = getTest(ctx, runId, testIndex);
  if (!test) return error(`Run "${runId}" not found or test index ${testIndex} out of range.`);
  const count = test.actions.length;
  if (count === 0) return error(`Action ${actionIndex} not found. This run captured 0 actions.`);
  return error(`Action ${actionIndex} not found. This run has ${count} action(s), valid indices: 0–${count - 1}.`);
}

export async function handleTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  switch (name) {
    case 'e2e_list_tests':
      return handleListTests(args, ctx);
    case 'e2e_list_projects':
      return handleListProjects(ctx);
    case 'e2e_run_test':
      return handleRunTest(args, ctx);
    case 'e2e_get_failure_report':
      return handleGetFailureReport(args, ctx);
    case 'e2e_get_actions':
      return handleGetActions(args, ctx);
    case 'e2e_get_action_detail':
      return handleGetActionDetail(args, ctx);
    case 'e2e_get_network':
      return handleGetNetwork(args, ctx);
    case 'e2e_get_console':
      return handleGetConsole(args, ctx);
    case 'e2e_get_screenshot':
      return handleGetScreenshot(args, ctx);
    case 'e2e_get_dom_snapshot':
      return handleGetDomSnapshot(args, ctx);
    case 'e2e_get_dom_diff':
      return handleGetDomDiff(args, ctx);
    case 'e2e_get_test_source':
      return handleGetTestSource(args, ctx);
    case 'e2e_find_elements':
      return handleFindElements(args, ctx);
    case 'e2e_scan_page_objects':
      return handleScanPageObjects(ctx);
    case 'e2e_get_app_flows':
      return handleGetAppFlows(ctx);
    case 'e2e_save_app_flow':
      return handleSaveAppFlow(args, ctx);
    case 'e2e_get_context':
      return handleGetContext(ctx);
    case 'e2e_discover_flows':
      return handleDiscoverFlows(ctx);
    default:
      return error(`Unknown tool: ${name}`);
  }
}

// ── Individual tool handlers ──

async function handleListTests(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const project = args.project ? String(args.project) : undefined;
  const files = await ctx.discoverTests(ctx.cwd, project);
  if (files.length === 0) return text('No test files found.');

  const lines: string[] = [];
  for (const file of files) {
    lines.push(`## ${file.relativePath}`);
    for (const test of file.tests) {
      lines.push(`  - ${test.fullTitle} (line ${test.line})`);
    }
    lines.push('');
  }
  return text(lines.join('\n'));
}

async function handleListProjects(ctx: ToolContext): Promise<ToolResult> {
  const projects = await ctx.discoverProjects(ctx.cwd);
  if (projects.length === 0) return text('No Playwright projects found. Check that playwright.config.ts exists and defines projects.');

  const lines: string[] = [`## Playwright Projects (${projects.length})`, ''];
  for (const p of projects) {
    const dir = p.testDir ? ` — ${p.testDir}` : '';
    lines.push(`- **${p.name}**${dir}`);
  }
  lines.push('');
  lines.push('Use `e2e_run_test` with `project` parameter to run all tests in a project, or `e2e_list_tests` with `project` to see individual tests.');
  return text(lines.join('\n'));
}

async function handleRunTest(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const location = args.location ? String(args.location) : undefined;
  const grep = args.grep ? String(args.grep) : undefined;
  const project = args.project ? String(args.project) : undefined;
  const timeoutMs = args.timeout ? Number(args.timeout) * 1000 : undefined;

  // Batch mode: run all tests when no location specified
  if (!location) {
    const result = await ctx.runProject(ctx.cwd, { project });
    ctx.runs.set(result.runId, result);
    return text(formatBatchResults(result, project));
  }

  // Single test mode: run with action capture
  const result = await ctx.runTest(location, ctx.cwd, { project, grep, timeoutMs });
  ctx.runs.set(result.runId, result);

  const lines: string[] = [`**Run ID:** \`${result.runId}\``, ''];
  for (const test of result.tests) {
    const passed = test.status === 'passed';
    const icon = passed ? '✅' : '❌';
    const dur = formatDuration(test.duration);
    const actionRange = test.actions.length > 0 ? ` (indices 0–${test.actions.length - 1})` : '';
    lines.push(`${icon} **${test.status.toUpperCase()}** · \`${test.file}\` · ${dur} · ${test.actions.length} actions${actionRange}`);
    if (test.error) lines.push(`> ${test.error.slice(0, 300)}`);
    if (test.attachments.length > 0) lines.push(`📷 ${test.attachments.length} screenshot(s)`);
    lines.push('');
  }
  const allPassed = result.tests.every(t => t.status === 'passed');
  if (!allPassed) {
    lines.push(`Use \`e2e_get_failure_report\` with runId \`${result.runId}\` for detailed analysis.`);
  } else {
    const totalActions = result.tests.reduce((sum, t) => sum + t.actions.length, 0);
    if (totalActions > 0) {
      lines.push(`_Tip: This passing test captured ${totalActions} actions. Consider saving the flow with \`e2e_save_app_flow\` so future debugging sessions start with full context._`);
    }
  }
  return text(lines.join('\n'));
}

function formatBatchResults(result: TestRunResult, project?: string): string {
  const passed = result.tests.filter(t => t.status === 'passed');
  const failed = result.tests.filter(t => t.status === 'failed');
  const totalDuration = result.tests.reduce((sum, t) => sum + t.duration, 0);

  const lines: string[] = [`**Run ID:** \`${result.runId}\``, ''];

  const projectNote = project ? ` (project: ${project})` : '';
  lines.push(`## Results: ${passed.length} passed, ${failed.length} failed${projectNote} · ${formatDuration(totalDuration)}`, '');

  if (failed.length > 0) {
    lines.push(`### Failed (${failed.length})`, '');
    for (const test of failed) {
      const idx = result.tests.indexOf(test);
      const dur = formatDuration(test.duration);
      lines.push(`❌ [${idx}] \`${test.location}\` — ${test.test} · ${dur}`);
      if (test.error) {
        const summary = test.error.split('\n').map(l => l.trim()).filter(Boolean)[0] || test.error;
        lines.push(`> ${summary.slice(0, 200)}`);
      }
      lines.push('');
    }
    lines.push(`_Use \`e2e_get_failure_report\` with runId \`${result.runId}\` and testIndex [N] to investigate._`);
    lines.push('_To debug with action capture, re-run the specific test: \`e2e_run_test\` with the file:line location._');
  } else {
    lines.push('All tests passed!');
  }

  return lines.join('\n');
}

async function handleGetFailureReport(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const includeDom = Boolean(args.includeDom ?? false);
  const includeNetworkBodies = Boolean(args.includeNetworkBodies ?? false);
  const test = getTest(ctx, runId, testIndex);
  if (!test) return error(`Run "${runId}" not found or test index ${testIndex} out of range.`);

  return text(buildFailureReport(test, ctx.cwd, { includeDom, includeNetworkBodies }));
}

async function handleGetActions(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const test = getTest(ctx, runId, testIndex);
  if (!test) return error(`Run "${runId}" not found.`);

  if (test.actions.length === 0) return text('No actions captured.');

  const padLen = String(test.actions.length - 1).length;
  const lines: string[] = [`## Action Timeline (${test.actions.length} actions)`, ''];
  for (let i = 0; i < test.actions.length; i++) {
    const a = test.actions[i];
    const icon = a.error ? '✗' : '✓';
    const net = a.network?.requests?.length || 0;
    const netInfo = net > 0 ? ` [${net} req]` : '';
    const dur = formatDuration(a.timing?.durationMs);
    const failMark = a.error ? '  ← FAILED' : '';
    lines.push(`${String(i).padStart(padLen)}. ${icon} ${a.type}.${a.method}${netInfo}  ${dur}${failMark}`);
    if (a.error) lines.push(`    ${a.error.message}`);
  }
  return text(lines.join('\n'));
}

async function handleGetActionDetail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const actionIndex = Number(args.actionIndex);
  const action = getAction(ctx, runId, testIndex, actionIndex);
  if (!action) return actionNotFound(ctx, runId, testIndex, actionIndex);

  const statusIcon = action.error ? '❌' : '✓';
  const parts: string[] = [];
  parts.push(`## ${statusIcon} Action ${actionIndex}: \`${action.type}.${action.method}\``);
  if (action.title) parts.push(`**Title:** ${action.title}`);
  if (action.pageUrl) parts.push(`**URL:** ${action.pageUrl}`);
  parts.push(`**Duration:** ${formatDuration(action.timing?.durationMs)}`);

  if (action.params) {
    const p = typeof action.params === 'string' ? action.params : JSON.stringify(action.params, null, 2);
    parts.push(`\n**Params:**\n\`\`\`json\n${p}\n\`\`\``);
  }

  if (action.error) {
    parts.push(`\n❌ **Error:** ${action.error.message}`);
    if (action.error.stack) parts.push(`\`\`\`\n${action.error.stack}\n\`\`\``);
  }

  if (action.snapshot?.diff) {
    const d = action.snapshot.diff;
    if (d.added.length || d.removed.length || d.changed.length) {
      parts.push('\n### DOM Changes');
      if (d.added.length) parts.push(`+ Added: ${d.added.join(', ')}`);
      if (d.removed.length) parts.push(`- Removed: ${d.removed.join(', ')}`);
      if (d.changed.length) parts.push(`~ Changed: ${d.changed.join(', ')}`);
    }
  }

  if (action.network?.requests?.length) {
    parts.push(`\n### Network (${action.network.requests.length} requests)`);
    for (const r of action.network.requests) {
      const icon = r.status && r.status >= 400 ? '✗' : '✓';
      parts.push(`- ${icon} \`${r.method}\` ${r.url} → ${r.status ?? 'pending'} (${formatDuration(r.durationMs)})`);
    }
  }

  if (action.console?.length) {
    const errors = action.console.filter((c: { type: string }) => c.type === 'error');
    if (errors.length) {
      parts.push(`\n### Console Errors (${errors.length})`);
      for (const e of errors.slice(0, 5) as Array<{ text: string }>) parts.push(`- ⚠ ${e.text}`);
    }
  }

  return text(parts.join('\n'));
}

async function handleGetNetwork(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const test = getTest(ctx, runId, testIndex);
  if (!test) return error(`Run "${runId}" not found.`);

  let requests = test.actions.flatMap(a => a.network?.requests || []);

  const urlPattern = args.urlPattern ? String(args.urlPattern) : undefined;
  const method = args.method ? String(args.method).toUpperCase() : undefined;
  const statusMin = args.statusMin != null ? Number(args.statusMin) : undefined;
  const includeBody = Boolean(args.includeBody ?? false);

  if (urlPattern) requests = requests.filter(r => r.url.includes(urlPattern));
  if (method) requests = requests.filter(r => r.method === method);
  if (statusMin != null) requests = requests.filter(r => r.status != null && r.status >= statusMin);

  if (requests.length === 0) return text('No matching network requests.');

  const parts: string[] = [`## Network Requests (${requests.length})`, ''];
  for (const r of requests) {
    const isError = r.status != null && r.status >= 400;
    const icon = isError ? '✗' : '✓';
    const statusStr = r.status != null ? String(r.status) : 'pending';
    parts.push(`### ${icon} \`${r.method}\` ${r.url}`);
    parts.push(`**Status:** ${statusStr} · **Duration:** ${formatDuration(r.durationMs)} · **Type:** ${r.resourceType || '?'}`);
    if (includeBody) {
      if (r.requestPostData) {
        parts.push(`\nRequest body:\n\`\`\`json\n${truncate(r.requestPostData, 5000)}\n\`\`\``);
      }
      if (r.responseBody) {
        const formatted = formatBody(r.responseBody, 10000);
        parts.push(`\nResponse body:\n\`\`\`${formatted.lang}\n${formatted.text}\n\`\`\``);
      }
    }
    parts.push('');
  }

  if (!includeBody) {
    parts.push('_Bodies omitted. Pass includeBody=true to include request/response payloads._');
  }

  return text(parts.join('\n'));
}

async function handleGetConsole(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const test = getTest(ctx, runId, testIndex);
  if (!test) return error(`Run "${runId}" not found.`);

  let messages = test.actions.flatMap(a => a.console || []);
  const typeFilter = args.type ? String(args.type) : undefined;
  if (typeFilter) messages = messages.filter(m => m.type === typeFilter);

  if (messages.length === 0) return text('No console messages.');

  const lines: string[] = [`## Console Output (${messages.length})`, ''];
  for (const m of messages) {
    const loc = m.location ? ` (${m.location})` : '';
    lines.push(`[${m.type.toUpperCase()}] ${m.text}${loc}`);
  }
  return text(lines.join('\n'));
}

async function handleGetScreenshot(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const screenshotIndex = Number(args.screenshotIndex ?? 0);
  const test = getTest(ctx, runId, testIndex);
  if (!test) return error(`Run "${runId}" not found.`);

  const screenshots = test.attachments.filter(a => a.contentType.startsWith('image/'));
  if (screenshots.length === 0) return text('No screenshots captured.');
  if (screenshotIndex >= screenshots.length) return error(`Screenshot index ${screenshotIndex} out of range (${screenshots.length} available).`);

  const screenshot = screenshots[screenshotIndex];
  try {
    const data = fs.readFileSync(screenshot.path);
    const base64 = data.toString('base64');
    return {
      content: [
        { type: 'text', text: `Screenshot: ${screenshot.name}` },
        { type: 'image', data: base64, mimeType: screenshot.contentType },
      ],
    };
  } catch (err: any) {
    return error(`Failed to read screenshot: ${err.message}`);
  }
}

async function handleGetDomSnapshot(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const actionIndex = Number(args.actionIndex);
  const which = String(args.which || 'after');
  const interactiveOnly = Boolean(args.interactiveOnly ?? false);
  const depth = args.depth != null ? Number(args.depth) : undefined;
  const action = getAction(ctx, runId, testIndex, actionIndex);
  if (!action) return actionNotFound(ctx, runId, testIndex, actionIndex);

  const processSnapshot = (raw: string): string => {
    let result = raw;
    if (depth != null) result = limitDepth(result, depth);
    if (interactiveOnly) result = filterInteractiveOnly(result);
    return result;
  };

  const parts: string[] = [];
  if ((which === 'before' || which === 'both') && action.snapshot?.before) {
    const processed = processSnapshot(action.snapshot.before);
    const note = interactiveOnly ? ' (interactive elements only)' : depth != null ? ` (depth≤${depth})` : '';
    parts.push(`## DOM Before Action ${actionIndex}${note}`);
    parts.push(`\`\`\`\n${processed}\n\`\`\``);
  }
  if ((which === 'after' || which === 'both') && action.snapshot?.after) {
    const processed = processSnapshot(action.snapshot.after);
    const note = interactiveOnly ? ' (interactive elements only)' : depth != null ? ` (depth≤${depth})` : '';
    parts.push(`## DOM After Action ${actionIndex}${note}`);
    parts.push(`\`\`\`\n${processed}\n\`\`\``);
  }
  if (parts.length === 0) return text('No DOM snapshot available for this action.');
  return text(parts.join('\n\n'));
}

async function handleGetDomDiff(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const actionIndex = Number(args.actionIndex);
  const action = getAction(ctx, runId, testIndex, actionIndex);
  if (!action) return actionNotFound(ctx, runId, testIndex, actionIndex);

  const diff = action.snapshot?.diff;
  if (!diff) return text('No DOM diff available for this action.');

  const parts: string[] = [`## DOM Diff for Action ${actionIndex}: ${action.type}.${action.method}`, ''];
  if (diff.added.length) {
    parts.push(`### Added Elements (${diff.added.length})`);
    for (const e of diff.added) parts.push(`+ ${e}`);
    parts.push('');
  }
  if (diff.removed.length) {
    parts.push(`### Removed Elements (${diff.removed.length})`);
    for (const e of diff.removed) parts.push(`- ${e}`);
    parts.push('');
  }
  if (diff.changed.length) {
    parts.push(`### Changed Elements (${diff.changed.length})`);
    for (const e of diff.changed) parts.push(`~ ${e}`);
    parts.push('');
  }
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
    parts.push('No DOM changes detected.');
  }
  return text(parts.join('\n'));
}

async function handleGetTestSource(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = String(args.filePath || '');
  if (!filePath) return error('Missing required parameter: filePath');

  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);
  if (!resolved.startsWith(ctx.cwd)) return error('Path outside project root.');

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    const lines = content.split('\n');
    const testLine = args.testLine != null ? Number(args.testLine) : undefined;

    let startLine = 0;
    let endLine = lines.length;

    if (testLine) {
      const context = args.context != null ? Number(args.context) : 60;
      startLine = Math.max(0, testLine - 1 - context);
      endLine = Math.min(lines.length, testLine - 1 + context);
    }

    const slice = lines.slice(startLine, endLine);
    const numbered = slice.map((l, i) => {
      const lineNum = startLine + i + 1;
      const marker = testLine && lineNum === testLine ? ' >>>' : '    ';
      return `${marker} ${String(lineNum).padStart(4)}| ${l}`;
    });

    const rangeNote = testLine ? ` (lines ${startLine + 1}–${endLine})` : '';
    return text(`## ${filePath}${rangeNote}\n\`\`\`typescript\n${numbered.join('\n')}\n\`\`\``);
  } catch (err: any) {
    return error(`Failed to read file: ${err.message}`);
  }
}

async function handleFindElements(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const actionIndex = Number(args.actionIndex);
  const which = String(args.which || 'after');
  const roleFilter = args.role ? String(args.role).toLowerCase() : undefined;
  const textFilter = args.text ? String(args.text).toLowerCase() : undefined;

  const action = getAction(ctx, runId, testIndex, actionIndex);
  if (!action) return actionNotFound(ctx, runId, testIndex, actionIndex);

  const snapshot = which === 'before' ? action.snapshot?.before : action.snapshot?.after;
  if (!snapshot) return text('No DOM snapshot available for this action.');

  const matches = snapshot.split('\n').filter((line: string) => {
    if (!/^\s+- \w/.test(line)) return false;
    if (roleFilter && !line.toLowerCase().includes(`- ${roleFilter}`)) return false;
    if (textFilter && !line.toLowerCase().includes(textFilter)) return false;
    return true;
  });

  if (matches.length === 0) {
    const filters: string[] = [];
    if (roleFilter) filters.push(`role="${roleFilter}"`);
    if (textFilter) filters.push(`text="${args.text}"`);
    return text(`No elements found matching ${filters.join(', ')}.`);
  }

  const parts: string[] = [
    `## Found ${matches.length} element(s) (action ${actionIndex} ${which})`,
    '',
    ...matches.map((m: string) => m.trimStart()),
  ];
  return text(parts.join('\n'));
}

// ── Context & flow handlers ──

async function handleScanPageObjects(ctx: ToolContext): Promise<ToolResult> {
  const objects = await scanPageObjects(ctx.cwd);
  return text(formatPageObjectIndex(objects));
}

async function handleGetAppFlows(ctx: ToolContext): Promise<ToolResult> {
  const file = readFlows(ctx.cwd);
  return text(formatFlows(file));
}

async function handleSaveAppFlow(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const flowName = args.flowName ? String(args.flowName) : '';
  const description = args.description ? String(args.description) : '';
  const confirmed = Boolean(args.confirmed);
  const stepsRaw = args.steps;

  if (!flowName) return error('Missing required parameter: flowName');
  if (!description) return error('Missing required parameter: description');
  if (!confirmed) return error('Flow must be confirmed (confirmed: true) before saving.');
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return error('Missing required parameter: steps (non-empty array)');

  const steps: FlowStep[] = stepsRaw.map((s: any) => ({
    name: String(s.name || ''),
    required_actions: Array.isArray(s.required_actions) ? s.required_actions.map(String) : [],
  }));

  const pre_conditions = Array.isArray(args.pre_conditions) ? args.pre_conditions.map(String) : undefined;
  const notes = Array.isArray(args.notes) ? args.notes.map(String) : undefined;
  const related_flows = Array.isArray(args.related_flows) ? args.related_flows.map(String) : undefined;

  const flow: AppFlow = {
    flowName,
    description,
    ...(pre_conditions && pre_conditions.length > 0 && { pre_conditions }),
    steps,
    ...(notes && notes.length > 0 && { notes }),
    ...(related_flows && related_flows.length > 0 && { related_flows }),
    confirmed,
    savedAt: new Date().toISOString(),
  };

  const file = saveFlow(ctx.cwd, flow);
  return text(`Flow "${flowName}" saved (${steps.length} steps). Total flows: ${file.flows.length}.`);
}

async function handleDiscoverFlows(ctx: ToolContext): Promise<ToolResult> {
  const tests = await discoverFlowsFromSpecs(ctx.cwd);
  return text(formatDiscoveredFlows(tests));
}

async function handleGetContext(ctx: ToolContext): Promise<ToolResult> {
  const [flowsFile, objects] = await Promise.all([
    readFlows(ctx.cwd),
    scanPageObjects(ctx.cwd),
  ]);

  const parts: string[] = [];
  parts.push('# Project Context', '');
  parts.push(formatFlows(flowsFile));
  parts.push('');
  parts.push(formatPageObjectSummary(objects));
  return text(parts.join('\n'));
}

// ── Report builder ──

interface FailureReportOptions {
  includeDom: boolean;
  includeNetworkBodies: boolean;
}

function buildFailureReport(test: TestRunTestEntry, cwd: string, opts: FailureReportOptions = { includeDom: false, includeNetworkBodies: false }): string {
  const parts: string[] = [];
  const topIcon = test.status === 'passed' ? '✅' : '❌';
  parts.push(`# ${topIcon} Failure Report`);
  parts.push(`- **File:** \`${test.file}\``);
  parts.push(`- **Status:** ${test.status}`);
  parts.push(`- **Duration:** ${formatDuration(test.duration)}`);
  if (test.error) parts.push(`- **Error:**\n\`\`\`\n${test.error}\n\`\`\``);
  parts.push('');

  // Find failing action
  const failingAction = test.actions.find(a => a.error);
  const failIdx = failingAction ? test.actions.indexOf(failingAction) : -1;

  if (failingAction) {
    parts.push(`## ❌ Failing Action (step ${failIdx + 1} of ${test.actions.length})`);
    parts.push(`- **Action:** \`${failingAction.type}.${failingAction.method}\``);
    if (failingAction.title) parts.push(`- **Title:** ${failingAction.title}`);
    if (failingAction.params) {
      const p = typeof failingAction.params === 'string' ? failingAction.params : JSON.stringify(failingAction.params, null, 2);
      parts.push(`- **Params:** \`${p}\``);
    }
    if (failingAction.pageUrl) parts.push(`- **Page URL:** ${failingAction.pageUrl}`);
    parts.push(`- **Duration:** ${formatDuration(failingAction.timing?.durationMs)}`);
    if (failingAction.error) {
      parts.push(`- **Error:** ${failingAction.error.message}`);
      if (failingAction.error.stack) parts.push(`\`\`\`\n${failingAction.error.stack}\n\`\`\``);
    }

    if (opts.includeDom && failingAction.snapshot?.after) {
      parts.push(`\n### DOM at Failure\n\`\`\`\n${failingAction.snapshot.after.slice(0, 5000)}\n\`\`\``);
    } else if (failingAction.snapshot?.after) {
      parts.push(`\n_DOM snapshot available. Use \`e2e_get_dom_snapshot\` (actionIndex=${failIdx}) or re-request with includeDom=true._`);
    }

    if (failingAction.snapshot?.diff) {
      const d = failingAction.snapshot.diff;
      if (d.added.length || d.removed.length || d.changed.length) {
        parts.push(`\n### DOM Changes`);
        if (d.added.length) parts.push(`Added: ${d.added.join(', ')}`);
        if (d.removed.length) parts.push(`Removed: ${d.removed.join(', ')}`);
        if (d.changed.length) parts.push(`Changed: ${d.changed.join(', ')}`);
      }
    }

    if (failingAction.network?.requests?.length) {
      parts.push(`\n### Network During Failure (${failingAction.network.requests.length})`);
      for (const r of failingAction.network.requests) {
        const icon = r.status && r.status >= 400 ? '✗' : '✓';
        parts.push(`- ${icon} \`${r.method}\` ${r.url} → ${r.status ?? 'pending'} (${formatDuration(r.durationMs)})`);
        if (opts.includeNetworkBodies && r.responseBody) {
          const f = formatBody(r.responseBody, 3000);
          parts.push(`  \`\`\`${f.lang}\n${f.text}\n\`\`\``);
        }
      }
    }

    if (failingAction.console?.length) {
      const errors = failingAction.console.filter((c: { type: string }) => c.type === 'error');
      if (errors.length) {
        parts.push(`\n### Console Errors`);
        for (const e of errors as Array<{ text: string }>) parts.push(`- ${e.text}`);
      }
    }
    parts.push('');
  }

  // Screenshots
  if (test.attachments.length > 0) {
    parts.push(`## Screenshots (${test.attachments.length})`);
    for (const a of test.attachments) parts.push(`- ${a.name}: \`${a.path}\``);
    parts.push('Use `e2e_get_screenshot` to view them.');
    parts.push('');
  }

  // Failed network requests across all actions
  const allReqs = test.actions.flatMap(a => a.network?.requests || []);
  const failedReqs = allReqs.filter(r => r.status && r.status >= 400);
  if (failedReqs.length > 0) {
    parts.push(`## ✗ Failed Network Requests (${failedReqs.length})`);
    for (const r of failedReqs.slice(0, 10)) {
      parts.push(`- \`${r.method}\` ${r.url} → **${r.status}**`);
      if (opts.includeNetworkBodies && r.responseBody) parts.push(`  ${truncate(r.responseBody, 500)}`);
    }
    if (!opts.includeNetworkBodies) {
      parts.push('_Bodies omitted. Pass includeNetworkBodies=true to include response payloads._');
    }
    parts.push('');
  }

  // Console errors across all actions
  const allConsole = test.actions.flatMap(a => a.console || []);
  const errors = allConsole.filter(c => c.type === 'error');
  if (errors.length > 0) {
    parts.push(`## Console Errors (${errors.length})`);
    for (const e of errors.slice(0, 10)) parts.push(`- ${e.text}`);
    parts.push('');
  }

  // Timeline
  if (test.actions.length > 0) {
    parts.push(`## Action Timeline (${test.actions.length})`);
    const padLen = String(test.actions.length - 1).length;
    for (let i = 0; i < test.actions.length; i++) {
      const a = test.actions[i];
      const icon = a.error ? '✗' : '✓';
      const net = a.network?.requests?.length || 0;
      const netInfo = net > 0 ? ` [${net} req]` : '';
      const marker = a === failingAction ? '  ← FAILING' : '';
      parts.push(`${String(i).padStart(padLen)}. ${icon} ${a.type}.${a.method}${netInfo}  ${formatDuration(a.timing?.durationMs)}${marker}`);
    }
  }

  return parts.join('\n');
}

// ── DOM utilities ──

const INTERACTIVE_ROLES = /^\s+- (button|link|textbox|combobox|checkbox|radio|option|menuitem|menuitemcheckbox|menuitemradio|spinbutton|searchbox|switch|slider|tab|treeitem|listbox|tree)/;

/** Filter an aria snapshot to only interactive elements. Reduces size by ~70% on content-heavy pages. */
function filterInteractiveOnly(snapshot: string): string {
  const lines = snapshot.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (INTERACTIVE_ROLES.test(line)) result.push(line);
  }
  return result.join('\n');
}

/** Limit an aria snapshot to a maximum tree depth. Each indent level is 2 spaces. */
function limitDepth(snapshot: string, maxDepth: number): string {
  return snapshot.split('\n').filter(line => {
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    return Math.floor(indent / 2) <= maxDepth;
  }).join('\n');
}

// ── Utilities ──

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '?';
  if (ms >= 10000) return `${Math.round(ms / 1000)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) + '... (truncated)';
}

function formatBody(body: string, limit: number): { text: string; lang: string } {
  let formatted = body;
  let lang = 'text';
  try {
    formatted = JSON.stringify(JSON.parse(body), null, 2);
    lang = 'json';
  } catch {
    if (body.trimStart().startsWith('<')) lang = 'html';
  }
  return { text: truncate(formatted, limit), lang };
}
