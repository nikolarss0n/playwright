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
        retries: { type: 'number', description: 'Run the test N+1 times to detect flaky failures (default: 0). Only works with location set. Returns per-run results and a FLAKY/CONSISTENT verdict.' },
        repeatEach: { type: 'number', description: 'Repeat each test N times within a single Playwright run (native --repeat-each). Fast stress-test for flakiness — use 30-100 for confidence. Returns pass/fail counts.' },
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
    name: 'e2e_get_evidence_bundle',
    description: 'Get ALL failure evidence for a test in one call — error, steps to reproduce, action timeline, network, console, DOM snapshot, and screenshots. Replaces calling 6+ tools separately. Use for Jira attachments with outputFile: true.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID from e2e_run_test' },
        testIndex: { type: 'number', description: 'Test index within the run (default: 0)' },
        outputFile: { type: 'boolean', description: 'Write evidence to test-reports/evidence-<runId>.md (default: false)' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'e2e_generate_report',
    description: 'Generate a self-contained HTML or JSON report file for a test run. HTML includes inline styles, base64 screenshots, collapsible per-test sections.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID from e2e_run_test' },
        format: { type: 'string', description: '"html" or "json" (default: "html")' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'e2e_suggest_tests',
    description: 'Analyze test coverage gaps: untested page object methods, missing flow variants, and uncovered flow steps. No parameters — scans everything.',
    inputSchema: {
      type: 'object',
      properties: {},
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
  runTest: (location: string, cwd: string, options?: { project?: string; grep?: string; timeoutMs?: number; repeatEach?: number }) => Promise<TestRunResult>;
  runProject: (cwd: string, options?: { project?: string; repeatEach?: number }) => Promise<TestRunResult>;
  sendProgress?: (message: string) => void;
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
    case 'e2e_get_evidence_bundle':
      return handleGetEvidenceBundle(args, ctx);
    case 'e2e_generate_report':
      return handleGenerateReport(args, ctx);
    case 'e2e_suggest_tests':
      return handleSuggestTests(ctx);
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
  const retries = args.retries ? Math.max(0, Math.floor(Number(args.retries))) : 0;
  const repeatEach = args.repeatEach ? Math.max(1, Math.floor(Number(args.repeatEach))) : undefined;

  // Batch mode: run all tests when no location specified
  if (!location) {
    if (retries > 0) {
      return text('⚠ `retries` is only supported when `location` is set (single-test mode). Running batch without retries.');
    }
    const result = await ctx.runProject(ctx.cwd, { project, repeatEach });
    ctx.runs.set(result.runId, result);

    // Auto-generate HTML report for batch runs
    const dir = path.join(ctx.cwd, 'test-reports');
    fs.mkdirSync(dir, { recursive: true });
    ctx.sendProgress?.('Generating HTML report...');
    const html = buildHtmlReport(result, ctx.cwd, ctx.sendProgress);
    const reportPath = path.join(dir, `report-${result.runId}.html`);
    fs.writeFileSync(reportPath, html, 'utf-8');

    return text(formatBatchResults(result, project) + `\n\n📄 **Report:** \`${reportPath}\``);
  }

  // Flaky detection mode: run N+1 times
  if (retries > 0) {
    const totalRuns = retries + 1;
    const attempts: Array<{ runId: string; status: string; duration: number; error?: string }> = [];

    for (let i = 0; i < totalRuns; i++) {
      ctx.sendProgress?.(`Retry ${i + 1}/${totalRuns} starting...`);
      const result = await ctx.runTest(location, ctx.cwd, { project, grep, timeoutMs, repeatEach });
      ctx.runs.set(result.runId, result);
      const firstTest = result.tests[0];
      const status = firstTest?.status ?? 'unknown';
      attempts.push({
        runId: result.runId,
        status,
        duration: firstTest?.duration ?? 0,
        error: firstTest?.error?.slice(0, 200),
      });
      const passed = attempts.filter(a => a.status === 'passed').length;
      const failed = attempts.filter(a => a.status === 'failed').length;
      ctx.sendProgress?.(`Retry ${i + 1}/${totalRuns} done: ${status === 'passed' ? '✅' : '❌'} (${passed} passed, ${failed} failed so far)`);
    }

    const statuses = new Set(attempts.map(a => a.status));
    let verdict: string;
    if (statuses.size === 1) {
      verdict = statuses.has('passed') ? '✅ CONSISTENT PASS' : '❌ CONSISTENT FAIL';
    } else {
      verdict = '⚠️ FLAKY';
    }

    const lines: string[] = [
      `## Flaky Detection: ${totalRuns} runs`,
      '',
      `**Verdict:** ${verdict}`,
      '',
      '| Run | Status | Duration | Run ID |',
      '|-----|--------|----------|--------|',
    ];
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const icon = a.status === 'passed' ? '✅' : '❌';
      lines.push(`| ${i + 1} | ${icon} ${a.status} | ${formatDuration(a.duration)} | \`${a.runId}\` |`);
    }
    lines.push('');

    if (verdict.includes('FLAKY')) {
      const failedAttempt = attempts.find(a => a.status === 'failed');
      if (failedAttempt) {
        lines.push(`Use \`e2e_get_failure_report\` with runId \`${failedAttempt.runId}\` to investigate the failure.`);
      }
    } else if (verdict.includes('CONSISTENT FAIL')) {
      lines.push(`Use \`e2e_get_failure_report\` with runId \`${attempts[0].runId}\` for detailed analysis.`);
    }

    return text(lines.join('\n'));
  }

  // Single test mode: run with action capture
  const result = await ctx.runTest(location, ctx.cwd, { project, grep, timeoutMs, repeatEach });
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

// ── Evidence bundle & report handlers ──

async function handleGetEvidenceBundle(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const testIndex = Number(args.testIndex ?? 0);
  const outputFile = Boolean(args.outputFile ?? false);
  const test = getTest(ctx, runId, testIndex);
  if (!test) return error(`Run "${runId}" not found or test index ${testIndex} out of range.`);

  ctx.sendProgress?.('Collecting error summary...');
  const parts: string[] = [];
  parts.push(`# Evidence Bundle — \`${test.file}\``);
  parts.push('');
  parts.push(`- **Status:** ${test.status}`);
  parts.push(`- **Duration:** ${formatDuration(test.duration)}`);
  parts.push(`- **Location:** \`${test.location}\``);

  const failingAction = test.actions.find(a => a.error);
  if (failingAction) {
    parts.push(`- **Page URL:** ${failingAction.pageUrl || 'unknown'}`);
  }
  parts.push('');

  // Error summary
  if (test.error) {
    parts.push('## Error');
    parts.push(`\`\`\`\n${test.error}\n\`\`\``);
    parts.push('');
  }

  // Steps to reproduce
  if (test.actions.length > 0) {
    parts.push('## Steps to Reproduce');
    for (let i = 0; i < test.actions.length; i++) {
      const a = test.actions[i];
      const marker = a.error ? ' **← FAILED HERE**' : '';
      parts.push(`${i + 1}. \`${a.type}.${a.method}\`${a.title ? ` — ${a.title}` : ''}${marker}`);
    }
    parts.push('');
  }

  // Action timeline
  if (test.actions.length > 0) {
    parts.push(`## Action Timeline (${test.actions.length} actions)`);
    const padLen = String(test.actions.length - 1).length;
    for (let i = 0; i < test.actions.length; i++) {
      const a = test.actions[i];
      const icon = a.error ? '✗' : '✓';
      const net = a.network?.requests?.length || 0;
      const netInfo = net > 0 ? ` [${net} req]` : '';
      const marker = a.error ? '  ← FAILING' : '';
      parts.push(`${String(i).padStart(padLen)}. ${icon} ${a.type}.${a.method}${netInfo}  ${formatDuration(a.timing?.durationMs)}${marker}`);
      if (a.error) parts.push(`    ${a.error.message}`);
    }
    parts.push('');
  }

  // Failing action detail
  if (failingAction) {
    const failIdx = test.actions.indexOf(failingAction);
    parts.push(`## Failing Action Detail (step ${failIdx})`);
    parts.push(`- **Action:** \`${failingAction.type}.${failingAction.method}\``);
    if (failingAction.params) {
      const p = typeof failingAction.params === 'string' ? failingAction.params : JSON.stringify(failingAction.params, null, 2);
      parts.push(`- **Params:** \`${p}\``);
    }
    if (failingAction.error) {
      parts.push(`- **Error:** ${failingAction.error.message}`);
      if (failingAction.error.stack) parts.push(`\`\`\`\n${failingAction.error.stack}\n\`\`\``);
    }
    parts.push('');
  }

  // Failed network requests with bodies
  ctx.sendProgress?.('Collecting network requests...');
  const allReqs = test.actions.flatMap(a => a.network?.requests || []);
  const failedReqs = allReqs.filter(r => r.status && r.status >= 400);
  if (failedReqs.length > 0) {
    parts.push(`## Failed Network Requests (${failedReqs.length})`);
    for (const r of failedReqs.slice(0, 15)) {
      parts.push(`### \`${r.method}\` ${r.url} → **${r.status}**`);
      parts.push(`Duration: ${formatDuration(r.durationMs)}`);
      if (r.requestPostData) {
        parts.push(`\nRequest body:\n\`\`\`json\n${truncate(r.requestPostData, 3000)}\n\`\`\``);
      }
      if (r.responseBody) {
        const f = formatBody(r.responseBody, 5000);
        parts.push(`\nResponse body:\n\`\`\`${f.lang}\n${f.text}\n\`\`\``);
      }
      parts.push('');
    }
  }

  // Console errors
  ctx.sendProgress?.('Collecting console errors...');
  const allConsole = test.actions.flatMap(a => a.console || []);
  const consoleErrors = allConsole.filter(c => c.type === 'error');
  if (consoleErrors.length > 0) {
    parts.push(`## Console Errors (${consoleErrors.length})`);
    for (const e of consoleErrors.slice(0, 20)) {
      parts.push(`- ${e.text}`);
    }
    parts.push('');
  }

  // DOM snapshot at failure
  ctx.sendProgress?.('Collecting DOM snapshot...');
  if (failingAction?.snapshot?.after) {
    parts.push('## DOM at Failure Point');
    parts.push(`\`\`\`\n${truncate(failingAction.snapshot.after, 5000)}\n\`\`\``);
    parts.push('');
  }

  const markdown = parts.join('\n');

  // Build response with screenshots as image content
  ctx.sendProgress?.('Reading screenshots...');
  const content: Content[] = [{ type: 'text', text: markdown }];
  const screenshots = test.attachments.filter(a => a.contentType.startsWith('image/'));
  for (const screenshot of screenshots) {
    try {
      const data = fs.readFileSync(screenshot.path);
      content.push(
        { type: 'text', text: `\n**Screenshot:** ${screenshot.name}` },
        { type: 'image', data: data.toString('base64'), mimeType: screenshot.contentType },
      );
    } catch {
      // skip unreadable screenshots
    }
  }

  // Write to file if requested
  if (outputFile) {
    const dir = path.join(ctx.cwd, 'test-reports');
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, `evidence-${runId}.md`);
    fs.writeFileSync(outPath, markdown, 'utf-8');
    content.push({ type: 'text', text: `\n_Evidence written to \`${outPath}\`_` });
  }

  return { content };
}

async function handleGenerateReport(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const runId = String(args.runId || '');
  const format = String(args.format || 'html');
  const run = ctx.runs.get(runId);
  if (!run) return error(`Run "${runId}" not found.`);

  const dir = path.join(ctx.cwd, 'test-reports');
  fs.mkdirSync(dir, { recursive: true });

  if (format === 'json') {
    ctx.sendProgress?.('Serializing JSON report...');
    const data = {
      runId: run.runId,
      timestamp: run.timestamp,
      tests: run.tests.map(t => ({
        file: t.file,
        test: t.test,
        location: t.location,
        status: t.status,
        duration: t.duration,
        error: t.error,
        actions: t.actions,
        attachments: t.attachments.map(a => ({ name: a.name, path: a.path, contentType: a.contentType })),
      })),
    };
    const outPath = path.join(dir, `report-${runId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
    return text(`JSON report written to \`${outPath}\` (${run.tests.length} tests).`);
  }

  // HTML format
  ctx.sendProgress?.(`Building HTML report for ${run.tests.length} tests...`);
  const html = buildHtmlReport(run, ctx.cwd, ctx.sendProgress);
  const outPath = path.join(dir, `report-${runId}.html`);
  fs.writeFileSync(outPath, html, 'utf-8');
  const passed = run.tests.filter(t => t.status === 'passed').length;
  const failed = run.tests.filter(t => t.status === 'failed').length;
  return text(`HTML report written to \`${outPath}\` (${passed} passed, ${failed} failed).`);
}

async function handleSuggestTests(ctx: ToolContext): Promise<ToolResult> {
  ctx.sendProgress?.('Scanning page objects, spec files, and flows...');
  const [objects, specs, flowsFile] = await Promise.all([
    scanPageObjects(ctx.cwd),
    discoverFlowsFromSpecs(ctx.cwd),
    readFlows(ctx.cwd),
  ]);

  const parts: string[] = ['# Test Coverage Analysis', ''];

  // Phase 1: Untested page object methods
  ctx.sendProgress?.('Phase 1/3: Analyzing untested page object methods...');
  const calledMethods = new Set<string>();
  for (const spec of specs) {
    for (const call of spec.calls) {
      const match = call.match(/\.(\w+)\(/);
      if (match) calledMethods.add(match[1]);
    }
  }

  const untestedMethods: Array<{ className: string; method: string; file: string }> = [];
  for (const obj of objects) {
    for (const m of obj.methods) {
      if (!calledMethods.has(m.name)) {
        untestedMethods.push({ className: obj.className, method: m.name, file: obj.relativePath });
      }
    }
  }

  parts.push(`## Phase 1: Untested Page Object Methods (${untestedMethods.length})`);
  parts.push('');
  if (untestedMethods.length === 0) {
    parts.push('All page object methods appear in at least one spec.');
  } else {
    parts.push('These methods exist in page objects but are never called in any spec file:');
    parts.push('');
    const byClass = new Map<string, typeof untestedMethods>();
    for (const m of untestedMethods) {
      if (!byClass.has(m.className)) byClass.set(m.className, []);
      byClass.get(m.className)!.push(m);
    }
    for (const [cls, methods] of byClass) {
      parts.push(`**${cls}** (\`${methods[0].file}\`)`);
      for (const m of methods) parts.push(`  - ${m.method}()`);
      parts.push('');
    }
  }

  // Phase 2: Missing flow variants
  ctx.sendProgress?.('Phase 2/3: Checking missing flow variants...');
  const flows = flowsFile.flows;
  const flowNames = new Set(flows.map(f => f.flowName));
  const missingVariants: string[] = [];

  for (const flow of flows) {
    if (flow.pre_conditions && flow.pre_conditions.length > 0) {
      const baseName = flow.flowName.split('--')[0];
      const hasDraftVariant = flowNames.has(`${baseName}--continue-draft`);
      if (!hasDraftVariant && flow.pre_conditions.some(c => c.toLowerCase().includes('no draft') || c.toLowerCase().includes('clean'))) {
        missingVariants.push(`\`${baseName}--continue-draft\` — flow "${flow.flowName}" has pre_condition about clean state but no continuation variant`);
      }
    }

    if (flow.notes) {
      for (const note of flow.notes) {
        const lower = note.toLowerCase();
        if ((lower.includes('validation') || lower.includes('error')) && !flowNames.has(`${flow.flowName.split('--')[0]}--validation`)) {
          missingVariants.push(`\`${flow.flowName.split('--')[0]}--validation\` — note mentions "${note.slice(0, 80)}"`);
        }
      }
    }
  }

  parts.push(`## Phase 2: Missing Flow Variants (${missingVariants.length})`);
  parts.push('');
  if (missingVariants.length === 0) {
    parts.push(flows.length === 0 ? 'No flows stored yet. Save flows with `e2e_save_app_flow` to enable variant analysis.' : 'No missing variants detected.');
  } else {
    parts.push('Based on pre_conditions and notes, these flow variants should exist but are missing:');
    parts.push('');
    for (const v of missingVariants) parts.push(`- ${v}`);
  }
  parts.push('');

  // Phase 3: Uncovered flow steps
  ctx.sendProgress?.('Phase 3/3: Cross-referencing flow steps with specs...');
  const uncovered: Array<{ flowName: string; step: string; action: string }> = [];
  for (const flow of flows) {
    for (const step of flow.steps) {
      for (const action of step.required_actions) {
        const methodMatch = action.match(/(\w+)\(/);
        if (methodMatch && !calledMethods.has(methodMatch[1])) {
          uncovered.push({ flowName: flow.flowName, step: step.name, action });
        }
      }
    }
  }

  parts.push(`## Phase 3: Uncovered Flow Steps (${uncovered.length})`);
  parts.push('');
  if (uncovered.length === 0) {
    parts.push(flows.length === 0 ? 'No flows stored yet.' : 'All confirmed flow steps are exercised by at least one spec.');
  } else {
    parts.push('These actions are listed in confirmed flows but no spec file calls them:');
    parts.push('');
    const byFlow = new Map<string, typeof uncovered>();
    for (const u of uncovered) {
      if (!byFlow.has(u.flowName)) byFlow.set(u.flowName, []);
      byFlow.get(u.flowName)!.push(u);
    }
    for (const [name, items] of byFlow) {
      parts.push(`**${name}**`);
      for (const i of items) parts.push(`  - Step "${i.step}": \`${i.action}\``);
      parts.push('');
    }
  }

  // Summary
  const totalGaps = untestedMethods.length + missingVariants.length + uncovered.length;
  parts.push('---');
  parts.push(`**Total gaps found:** ${totalGaps}`);
  if (totalGaps > 0) {
    parts.push('Consider adding tests for the identified gaps to improve coverage.');
  }

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

function buildHtmlReport(run: TestRunResult, cwd: string, sendProgress?: (msg: string) => void): string {
  const passed = run.tests.filter(t => t.status === 'passed');
  const failed = run.tests.filter(t => t.status === 'failed');
  const totalDuration = run.tests.reduce((sum, t) => sum + t.duration, 0);
  const timestamp = new Date(run.timestamp).toLocaleString();

  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let testSections = '';
  for (let ti = 0; ti < run.tests.length; ti++) {
    sendProgress?.(`Processing test ${ti + 1}/${run.tests.length}...`);
    const test = run.tests[ti];
    const statusClass = test.status === 'passed' ? 'pass' : 'fail';
    const statusBadge = test.status === 'passed' ? '<span class="badge pass">PASS</span>' : '<span class="badge fail">FAIL</span>';

    let details = '';

    if (test.error) {
      details += `<div class="section"><h4>Error</h4><pre>${escHtml(test.error)}</pre></div>`;
    }

    // Action timeline
    if (test.actions.length > 0) {
      const failingAction = test.actions.find(a => a.error);
      let rows = '';
      for (let i = 0; i < test.actions.length; i++) {
        const a = test.actions[i];
        const isFailing = a === failingAction;
        const rowClass = isFailing ? ' class="fail-row"' : '';
        const icon = a.error ? '&#10007;' : '&#10003;';
        const net = a.network?.requests?.length || 0;
        rows += `<tr${rowClass}><td>${i}</td><td>${icon}</td><td>${escHtml(a.type)}.${escHtml(a.method)}</td><td>${net}</td><td>${formatDuration(a.timing?.durationMs)}</td></tr>`;
      }
      details += `<div class="section"><h4>Action Timeline (${test.actions.length})</h4><table><tr><th>#</th><th></th><th>Action</th><th>Net</th><th>Duration</th></tr>${rows}</table></div>`;
    }

    // Network requests (failed ones highlighted)
    const allReqs = test.actions.flatMap(a => a.network?.requests || []);
    const failedReqs = allReqs.filter(r => r.status && r.status >= 400);
    if (failedReqs.length > 0) {
      let rows = '';
      for (const r of failedReqs.slice(0, 20)) {
        rows += `<tr class="fail-row"><td>${escHtml(r.method)}</td><td>${escHtml(r.url)}</td><td>${r.status}</td><td>${formatDuration(r.durationMs)}</td></tr>`;
      }
      details += `<div class="section"><h4>Failed Network Requests (${failedReqs.length})</h4><table><tr><th>Method</th><th>URL</th><th>Status</th><th>Duration</th></tr>${rows}</table></div>`;
    }

    // Console errors
    const allConsole = test.actions.flatMap(a => a.console || []);
    const consoleErrors = allConsole.filter(c => c.type === 'error');
    if (consoleErrors.length > 0) {
      const items = consoleErrors.slice(0, 20).map(e => `<li>${escHtml(e.text)}</li>`).join('');
      details += `<div class="section"><h4>Console Errors (${consoleErrors.length})</h4><ul>${items}</ul></div>`;
    }

    // DOM snapshot at failure
    const failingAction = test.actions.find(a => a.error);
    if (failingAction?.snapshot?.after) {
      details += `<div class="section"><h4>DOM at Failure</h4><pre>${escHtml(failingAction.snapshot.after.slice(0, 5000))}</pre></div>`;
    }

    // Screenshots as base64 images
    const screenshots = test.attachments.filter(a => a.contentType.startsWith('image/'));
    if (screenshots.length > 0) {
      sendProgress?.(`Encoding ${screenshots.length} screenshot(s) for test ${ti + 1}...`);
      let imgs = '';
      for (const s of screenshots) {
        try {
          const data = fs.readFileSync(s.path);
          const b64 = data.toString('base64');
          imgs += `<div class="screenshot"><p>${escHtml(s.name)}</p><img src="data:${s.contentType};base64,${b64}" alt="${escHtml(s.name)}"/></div>`;
        } catch {
          imgs += `<div class="screenshot"><p>${escHtml(s.name)} (file not found)</p></div>`;
        }
      }
      details += `<div class="section"><h4>Screenshots</h4>${imgs}</div>`;
    }

    const open = test.status === 'failed' ? ' open' : '';
    testSections += `<details${open} class="test ${statusClass}"><summary>${statusBadge} <strong>${escHtml(test.test || test.file)}</strong> <span class="dur">${formatDuration(test.duration)}</span></summary>${details}</details>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Test Report — ${escHtml(run.runId)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; max-width: 1200px; margin: 0 auto; }
  h1 { margin-bottom: 8px; }
  .summary { background: #fff; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.1); display: flex; gap: 24px; flex-wrap: wrap; align-items: center; }
  .summary .stat { text-align: center; }
  .summary .stat .num { font-size: 28px; font-weight: 700; }
  .summary .stat .label { font-size: 12px; color: #888; text-transform: uppercase; }
  .pass-num { color: #22863a; }
  .fail-num { color: #cb2431; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .badge.pass { background: #dcffe4; color: #22863a; }
  .badge.fail { background: #ffdce0; color: #cb2431; }
  details.test { background: #fff; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  details.test summary { padding: 12px 16px; cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; }
  details.test summary::-webkit-details-marker { display: none; }
  details.test summary::before { content: '▶'; font-size: 10px; transition: transform .2s; }
  details.test[open] summary::before { transform: rotate(90deg); }
  .dur { color: #888; font-size: 13px; margin-left: auto; }
  .section { padding: 12px 16px; border-top: 1px solid #eee; }
  .section h4 { margin-bottom: 8px; font-size: 14px; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eee; }
  th { font-weight: 600; background: #f9f9f9; }
  .fail-row { background: #fff5f5; }
  ul { padding-left: 20px; font-size: 13px; }
  li { margin-bottom: 4px; }
  .screenshot img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin-top: 4px; }
  .screenshot p { font-size: 12px; color: #666; }
  .meta { font-size: 13px; color: #888; margin-bottom: 16px; }
</style>
</head>
<body>
<h1>Test Report</h1>
<p class="meta">Run ID: ${escHtml(run.runId)} &middot; ${escHtml(timestamp)}</p>
<div class="summary">
  <div class="stat"><div class="num">${run.tests.length}</div><div class="label">Total</div></div>
  <div class="stat"><div class="num pass-num">${passed.length}</div><div class="label">Passed</div></div>
  <div class="stat"><div class="num fail-num">${failed.length}</div><div class="label">Failed</div></div>
  <div class="stat"><div class="num">${formatDuration(totalDuration)}</div><div class="label">Duration</div></div>
</div>
${testSections}
</body>
</html>`;
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
