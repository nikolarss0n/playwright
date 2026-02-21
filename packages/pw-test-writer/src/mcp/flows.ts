/**
 * Business Flow Memory — persistent storage for application flow descriptions.
 *
 * Flows are stored in `.e2e-flows.json` at the project root. They represent
 * confirmed application user flows (e.g. "user registration") with their
 * required steps and actions, so Claude can cross-reference them against
 * failing tests to identify missing steps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { ActionCapture } from 'playwright-core/lib/server/actionCaptureTypes';
import type { TestRunTestEntry } from './types.js';

export interface FlowStep {
  name: string;
  required_actions: string[];
}

export interface AppFlow {
  flowName: string;
  description: string;
  /**
   * State the app must be in before this flow starts.
   * E.g. ["no draft exists", "user is logged in"]
   * Claude uses this to diagnose dirty-state failures.
   */
  pre_conditions?: string[];
  steps: FlowStep[];
  /**
   * Free-form observations about this flow — edge cases, known dialogs,
   * gotchas discovered during debugging. Analogous to claude-mem observations.
   * E.g. ["If 'Continue?' dialog appears, state is dirty → add beforeEach draft cleanup"]
   */
  notes?: string[];
  /**
   * Related flow names (variants, prerequisites, follow-ups).
   * E.g. ["checkout--continue-draft", "checkout--validation"]
   */
  related_flows?: string[];
  confirmed: boolean;
  savedAt: string;
}

export interface FlowsFile {
  version: number;
  flows: AppFlow[];
}

const FLOWS_FILENAME = '.e2e-flows.json';

// ── Flow discovery from spec files ──

export interface DiscoveredTest {
  describe: string;
  name: string;
  filePath: string;
  line: number;
  calls: string[];
}

function extractTestCalls(content: string, relativePath: string): DiscoveredTest[] {
  const lines = content.split('\n');
  const tests: DiscoveredTest[] = [];

  let currentDescribe = path.basename(relativePath, '.ts');
  let currentTest: DiscoveredTest | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect describe block name
    const describeMatch = line.match(/^\s*describe\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (describeMatch) currentDescribe = describeMatch[1];

    // Detect test/it start → open a new entry
    const testMatch = line.match(/^\s*(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (testMatch) {
      currentTest = { describe: currentDescribe, name: testMatch[1], filePath: relativePath, line: i + 1, calls: [] };
      tests.push(currentTest);
    }

    // Extract await calls inside a test
    if (currentTest) {
      const m = line.match(/await\s+(\w+)\.(\w+)\s*\(([^)]*)\)/);
      if (m) {
        const args = m[3].trim().slice(0, 60);
        const suffix = m[3].trim().length > 60 ? '...' : '';
        currentTest.calls.push(`${m[1]}.${m[2]}(${args}${suffix})`);
      }
    }
  }

  return tests;
}

export async function discoverFlowsFromSpecs(cwd: string): Promise<DiscoveredTest[]> {
  const files = await glob('**/*.spec.ts', { cwd, ignore: ['**/node_modules/**', '**/dist/**'] });
  const results: DiscoveredTest[] = [];

  for (const rel of files.sort()) {
    try {
      const content = fs.readFileSync(path.resolve(cwd, rel), 'utf-8');
      results.push(...extractTestCalls(content, rel));
    } catch {
      // skip
    }
  }

  return results;
}

export function formatDiscoveredFlows(tests: DiscoveredTest[]): string {
  if (tests.length === 0) return 'No spec files found.';

  const byDescribe = new Map<string, DiscoveredTest[]>();
  for (const t of tests) {
    const key = `${t.filePath} › ${t.describe}`;
    if (!byDescribe.has(key)) byDescribe.set(key, []);
    byDescribe.get(key)!.push(t);
  }

  const lines: string[] = [
    `## Discovered Flows from Spec Files (${tests.length} tests)`,
    '',
    '_This is a draft based on static analysis. Use `e2e_save_app_flow` to save a confirmed version._',
    '',
  ];

  for (const [key, group] of byDescribe) {
    lines.push(`### ${key}`);
    for (const t of group) {
      lines.push(`**${t.name}** (line ${t.line})`);
      if (t.calls.length === 0) {
        lines.push('  _no await calls detected_');
      } else {
        for (const c of t.calls) lines.push(`  ${c}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function flowsPath(cwd: string): string {
  return path.join(cwd, FLOWS_FILENAME);
}

export function readFlows(cwd: string): FlowsFile {
  const fp = flowsPath(cwd);
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    return JSON.parse(raw) as FlowsFile;
  } catch {
    return { version: 1, flows: [] };
  }
}

export function saveFlow(cwd: string, flow: AppFlow): FlowsFile {
  const file = readFlows(cwd);
  const idx = file.flows.findIndex(f => f.flowName === flow.flowName);
  if (idx >= 0) {
    file.flows[idx] = flow;
  } else {
    file.flows.push(flow);
  }

  fs.writeFileSync(flowsPath(cwd), JSON.stringify(file, null, 2) + '\n', 'utf-8');
  return file;
}

export function formatFlowsSummary(file: FlowsFile): string {
  if (file.flows.length === 0) {
    return [
      '## Application Flows — None stored yet',
      '',
      'No confirmed flows in `.e2e-flows.json`. Use `e2e_discover_flows` or `e2e_build_flows` to generate them.',
    ].join('\n');
  }

  const lines: string[] = [`## Application Flows (${file.flows.length})`, ''];
  lines.push('Use `e2e_get_app_flows` for full step details on any flow.', '');

  for (const flow of file.flows) {
    const status = flow.confirmed ? 'confirmed' : 'unconfirmed';
    const steps = `${flow.steps.length} steps`;
    const related = flow.related_flows?.length ? ` | related: ${flow.related_flows.join(', ')}` : '';
    lines.push(`- **${flow.flowName}** (${status}, ${steps}${related}) — ${flow.description}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatFlows(file: FlowsFile): string {
  if (file.flows.length === 0) {
    return [
      '## Application Flows — None stored yet',
      '',
      'No confirmed flows in `.e2e-flows.json`. You must understand the intended user journey before debugging.',
      '',
      '**Flow discovery strategy (follow in order):**',
      '1. **Search documentation first.** If Confluence, wiki, or doc-search tools are available, search for the feature name or page being tested. Specification documents describe the intended flow better than code.',
      '2. Use `e2e_get_test_source` to read the test file and understand what it intends to do',
      '3. Run the test with `e2e_run_test`, then use `e2e_get_actions` to see what actually executed',
      '4. Use `e2e_discover_flows` to auto-scan all test files and get a draft flow map',
      '5. Compare intended steps vs actual steps to identify what is missing or wrong',
      '6. After fixing, use `e2e_save_app_flow` to save the confirmed flow for future sessions',
    ].join('\n');
  }

  const lines: string[] = [`## Application Flows (${file.flows.length})`, ''];

  for (const flow of file.flows) {
    const status = flow.confirmed ? 'confirmed' : 'unconfirmed';
    lines.push(`### ${flow.flowName} (${status})`);
    lines.push(flow.description);
    lines.push('');

    if (flow.pre_conditions && flow.pre_conditions.length > 0) {
      lines.push('**Pre-conditions:**');
      for (const cond of flow.pre_conditions) lines.push(`  - ${cond}`);
      lines.push('');
    }

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      lines.push(`**Step ${i + 1}: ${step.name}**`);
      for (const action of step.required_actions) {
        lines.push(`  - ${action}`);
      }
    }

    if (flow.notes && flow.notes.length > 0) {
      lines.push('');
      lines.push('**Notes (edge cases & observations):**');
      for (const note of flow.notes) lines.push(`  - ${note}`);
    }

    if (flow.related_flows && flow.related_flows.length > 0) {
      lines.push('');
      lines.push(`**Related flows:** ${flow.related_flows.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ── Auto-flow functions ──

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Strip Playwright file-path prefix and project suffix from a test title. */
export function normalizeTestTitle(testTitle: string): string {
  let t = testTitle;
  // Strip trailing project suffix like " [e2e]" for consistent naming across modes
  t = t.replace(/\s*\[[\w-]+\]\s*$/, '');
  // Strip file path prefix from Playwright's fullTitle format:
  // "path/to/file.spec.ts > Suite > Test" → "Suite > Test"
  t = t.replace(/^.*?\.spec\.\w+\s*>\s*/, '');
  return t;
}

export function deriveFlowName(file: string, testTitle: string): string {
  const base = path.basename(file).replace(/\.spec\.\w+$/, '').replace(/\.\w+$/, '');
  return `${slugify(base)}/${slugify(normalizeTestTitle(testTitle))}`;
}

/** Internal actions to skip when building flows */
const SKIP_METHODS = new Set([
  'waitForNavigation', 'waitForLoadState', 'waitForURL', 'waitForSelector',
  'waitForTimeout', 'waitForFunction', 'waitForEvent', 'waitForResponse',
  'waitForRequest', 'finished', 'close', 'dispose',
]);

export function formatActionForFlow(action: ActionCapture): string | null {
  if (SKIP_METHODS.has(action.method)) return null;
  if (action.type === 'Response' || action.type === 'Request') return null;
  if (action.type === 'Frame' && SKIP_METHODS.has(action.method)) return null;

  if (action.title) return action.title;

  const params = action.params;
  let paramStr = '';
  if (params) {
    if (typeof params === 'string') {
      paramStr = params.length > 80 ? params.slice(0, 80) + '...' : params;
    } else if (typeof params === 'object') {
      const selector = params.selector || params.url || params.name || params.value;
      if (typeof selector === 'string') {
        paramStr = selector.length > 80 ? selector.slice(0, 80) + '...' : selector;
      } else {
        const json = JSON.stringify(params);
        paramStr = json.length > 80 ? json.slice(0, 80) + '...' : json;
      }
    }
  }

  return `${action.type}.${action.method}(${paramStr})`;
}

export function buildFlowFromActions(test: TestRunTestEntry): AppFlow {
  const flowName = deriveFlowName(test.file, test.test);

  const steps: FlowStep[] = [];
  let currentUrl = '';
  let currentActions: string[] = [];

  for (const action of test.actions) {
    const formatted = formatActionForFlow(action);
    if (!formatted) continue;

    const url = action.pageUrl || 'unknown';
    if (url !== currentUrl && currentActions.length > 0) {
      let stepName: string;
      try {
        stepName = currentUrl ? new URL(currentUrl).pathname : 'initial';
      } catch {
        stepName = currentUrl || 'initial';
      }
      steps.push({ name: stepName, required_actions: currentActions });
      currentActions = [];
    }
    currentUrl = url;
    currentActions.push(formatted);
  }

  if (currentActions.length > 0) {
    let stepName: string;
    try {
      stepName = currentUrl ? new URL(currentUrl).pathname : 'initial';
    } catch {
      stepName = currentUrl || 'initial';
    }
    steps.push({ name: stepName, required_actions: currentActions });
  }

  return {
    flowName,
    description: `Auto-captured flow for: ${normalizeTestTitle(test.test)}`,
    steps,
    confirmed: true,
    savedAt: new Date().toISOString(),
  };
}

export function compareFlows(existing: AppFlow, current: AppFlow): { changed: boolean; summary: string } {
  if (existing.steps.length !== current.steps.length) {
    return { changed: true, summary: `Step count changed: ${existing.steps.length} → ${current.steps.length}` };
  }

  const diffs: string[] = [];
  for (let i = 0; i < existing.steps.length; i++) {
    const eStep = existing.steps[i];
    const cStep = current.steps[i];

    if (eStep.name !== cStep.name) {
      diffs.push(`Step ${i + 1} renamed: "${eStep.name}" → "${cStep.name}"`);
    }

    const eActions = eStep.required_actions.join('\n');
    const cActions = cStep.required_actions.join('\n');
    if (eActions !== cActions) {
      const added = cStep.required_actions.filter(a => !eStep.required_actions.includes(a));
      const removed = eStep.required_actions.filter(a => !cStep.required_actions.includes(a));
      const parts: string[] = [];
      if (added.length) parts.push(`+${added.length} actions`);
      if (removed.length) parts.push(`-${removed.length} actions`);
      diffs.push(`Step ${i + 1} ("${cStep.name}"): ${parts.join(', ')}`);
    }
  }

  if (diffs.length === 0) return { changed: false, summary: 'Flow is up to date' };
  return { changed: true, summary: diffs.join('; ') };
}

export function findFlowForTest(cwd: string, file: string, testTitle: string): AppFlow | null {
  const flowsFile = readFlows(cwd);
  if (flowsFile.flows.length === 0) return null;

  const derivedName = deriveFlowName(file, testTitle);
  const exact = flowsFile.flows.find(f => f.flowName === derivedName);
  if (exact) return exact;

  const baseSlug = slugify(path.basename(file).replace(/\.spec\.\w+$/, '').replace(/\.\w+$/, ''));
  return flowsFile.flows.find(f => f.flowName.startsWith(baseSlug + '/')) ?? null;
}
