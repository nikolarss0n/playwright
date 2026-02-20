/**
 * Standalone test runner for MCP server.
 *
 * Creates an in-memory capture target (no TUI store dependency),
 * runs tests with capture hook injection, collects results.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createCaptureServer, type CaptureTarget } from '../runner/captureServer.js';
import { discoverTests, discoverProjects } from '../runner/testRunner.js';
import type { ActionCapture } from 'playwright-core/lib/server/actionCaptureTypes';
import type { TestRunResult, TestRunTestEntry, TestAttachment } from './types.js';

export { discoverTests, discoverProjects };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * In-memory accumulator implementing CaptureTarget.
 */
class MemoryTarget implements CaptureTarget {
  actions: ActionCapture[] = [];
  currentAction: string | null = null;

  addActionCapture(capture: ActionCapture): void {
    this.actions.push(capture);
  }

  setCurrentAction(name: string | null): void {
    this.currentAction = name;
  }

  reset(): void {
    this.actions = [];
    this.currentAction = null;
  }
}

/**
 * Run a single test location with capture and return structured results.
 */
export async function runTest(
  testLocation: string,
  cwd: string,
  options?: { timeoutMs?: number; project?: string; grep?: string; repeatEach?: number; onProgress?: (msg: string) => void },
): Promise<TestRunResult> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const target = new MemoryTarget();
  const captureServer = createCaptureServer(target);

  let captureEndpoint: string | null = null;
  try {
    await captureServer.start();
    captureEndpoint = captureServer.getEndpoint();
  } catch {
    // Continue without capture
  }

  const startTime = Date.now();

  try {
    const spawnResult = await spawnTest(testLocation, cwd, captureEndpoint, options?.timeoutMs, options?.project, options?.grep, options?.repeatEach, options?.onProgress);
    const duration = Date.now() - startTime;

    // Collect screenshots
    const attachments = collectScreenshots(cwd, startTime);
    collectActionScreenshots(target.actions, cwd, attachments);

    // Parse test location for file/line
    const lastColon = testLocation.lastIndexOf(':');
    const file = lastColon > 0 ? testLocation.substring(0, lastColon) : testLocation;
    const relFile = path.relative(cwd, file);

    const entry: TestRunTestEntry = {
      file: relFile,
      test: testLocation,
      location: testLocation,
      status: spawnResult.success ? 'passed' : 'failed',
      duration,
      error: spawnResult.error,
      actions: [...target.actions],
      attachments,
    };

    return { runId, timestamp: startTime, tests: [entry] };
  } finally {
    captureServer.stop();
  }
}

/**
 * Run multiple test locations in sequence.
 */
export async function runTests(
  testLocations: string[],
  cwd: string,
  options?: { timeoutMs?: number },
): Promise<TestRunResult> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const target = new MemoryTarget();
  const captureServer = createCaptureServer(target);
  const tests: TestRunTestEntry[] = [];

  let captureEndpoint: string | null = null;
  try {
    await captureServer.start();
    captureEndpoint = captureServer.getEndpoint();
  } catch {
    // Continue without capture
  }

  const timestamp = Date.now();

  try {
    for (const loc of testLocations) {
      target.reset();
      const startTime = Date.now();
      const spawnResult = await spawnTest(loc, cwd, captureEndpoint, options?.timeoutMs);
      const duration = Date.now() - startTime;

      const attachments = collectScreenshots(cwd, startTime);
      collectActionScreenshots(target.actions, cwd, attachments);

      const lastColon = loc.lastIndexOf(':');
      const file = lastColon > 0 ? loc.substring(0, lastColon) : loc;
      const relFile = path.relative(cwd, file);

      tests.push({
        file: relFile,
        test: loc,
        location: loc,
        status: spawnResult.success ? 'passed' : 'failed',
        duration,
        error: spawnResult.error,
        actions: [...target.actions],
        attachments,
      });
    }
  } finally {
    captureServer.stop();
  }

  return { runId, timestamp, tests };
}

/**
 * Run all tests (optionally filtered by project) using JSON reporter.
 * Returns per-test results without action capture (for batch overview).
 */
export async function runProject(
  cwd: string,
  options?: { project?: string; timeoutMs?: number; repeatEach?: number; onProgress?: (msg: string) => void },
): Promise<TestRunResult> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  const args = ['test'];
  if (options?.project) args.push('--project', options.project);
  if (options?.repeatEach && options.repeatEach > 1) args.push('--repeat-each', String(options.repeatEach));
  args.push('--reporter=json');

  const localBin = path.join(cwd, 'node_modules', '.bin', 'playwright');
  const cmd = fs.existsSync(localBin) ? localBin : 'npx';
  if (cmd === 'npx') args.unshift('playwright');

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let batchPassed = 0;
    let batchFailed = 0;
    let batchTotal = 0;

    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => {
      if (!options?.onProgress) return;
      const clean = d.toString().replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
      for (const line of clean.split('\n')) {
        const trimmed = line.trim();
        // Parse "Running N tests using M workers"
        const runningMatch = trimmed.match(/Running (\d+) test/);
        if (runningMatch) {
          batchTotal = parseInt(runningMatch[1], 10);
          options.onProgress(`Running ${batchTotal} tests...`);
        }
        // Parse pass/fail counts from summary lines like "63 passed" or "2 failed"
        const passedMatch = trimmed.match(/(\d+) passed/);
        const failedMatch = trimmed.match(/(\d+) failed/);
        if (passedMatch) batchPassed = parseInt(passedMatch[1], 10);
        if (failedMatch) batchFailed = parseInt(failedMatch[1], 10);
        if ((passedMatch || failedMatch) && batchTotal > 0) {
          options.onProgress(`${batchPassed + batchFailed}/${batchTotal} · ✅ ${batchPassed} passed, ❌ ${batchFailed} failed`);
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000).unref();
      resolve(out);
    }, options?.timeoutMs || 600000);

    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const tests = parseJsonRunResults(stdout, cwd);
  return { runId, timestamp: startTime, tests };
}

function parseJsonRunResults(jsonStr: string, cwd: string): TestRunTestEntry[] {
  let data: any;
  try {
    data = JSON.parse(jsonStr.trim());
  } catch {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(jsonStr.substring(start, end + 1));
      } catch {
        return [{
          file: 'unknown', test: 'all', location: '',
          status: 'failed', duration: 0,
          error: 'Failed to parse test output. Raw:\n' + jsonStr.slice(0, 500),
          actions: [], attachments: [],
        }];
      }
    } else {
      return [{
        file: 'unknown', test: 'all', location: '',
        status: 'failed', duration: 0,
        error: 'No JSON output from test run. Raw:\n' + jsonStr.slice(0, 500),
        actions: [], attachments: [],
      }];
    }
  }

  const rootDir = data.config?.rootDir || cwd;
  const entries: TestRunTestEntry[] = [];

  function processSuite(suite: any, parentTitle: string) {
    const currentTitle = parentTitle && suite.title
      ? `${parentTitle} > ${suite.title}`
      : suite.title || parentTitle;

    for (const spec of suite.specs || []) {
      const specFile = spec.file || suite.file || '';
      const relFile = specFile
        ? path.relative(cwd, path.isAbsolute(specFile) ? specFile : path.resolve(rootDir, specFile))
        : 'unknown';
      const fullTitle = currentTitle && spec.title
        ? `${currentTitle} > ${spec.title}`
        : spec.title || currentTitle;

      for (const test of spec.tests || []) {
        if (test.status === 'skipped') continue;

        const lastResult = test.results?.[test.results.length - 1];
        const status: 'passed' | 'failed' =
          test.status === 'expected' || test.status === 'flaky' ? 'passed' : 'failed';

        const duration = lastResult?.duration || 0;
        const errors = (lastResult?.errors || [])
          .map((e: any) => (e.message || '').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
          .filter(Boolean)
          .join('\n');

        const projectSuffix = test.projectName ? ` [${test.projectName}]` : '';

        entries.push({
          file: relFile,
          test: `${fullTitle}${projectSuffix}`,
          location: `${relFile}:${spec.line || 0}`,
          status,
          duration,
          error: errors || undefined,
          actions: [],
          attachments: [],
        });
      }
    }

    for (const nested of suite.suites || []) {
      processSuite(nested, currentTitle);
    }
  }

  for (const suite of data.suites || []) {
    processSuite(suite, '');
  }

  return entries;
}

// ── Internal helpers ──

interface SpawnResult {
  success: boolean;
  error?: string;
}

function spawnTest(
  testLocation: string,
  cwd: string,
  captureEndpoint: string | null,
  timeoutMs = 120000,
  project?: string,
  grep?: string,
  repeatEach?: number,
  onProgress?: (msg: string) => void,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FORCE_COLOR: '0',
    };

    if (captureEndpoint) {
      env.PW_CAPTURE_ENDPOINT = captureEndpoint;
      env.PW_CAPTURE_SESSION = `test-${Date.now()}`;

      // Resolve hook path relative to this file (works in both src and dist)
      const hookPath = path.resolve(__dirname, '..', 'runner', 'captureHook.cjs');
      if (fs.existsSync(hookPath)) {
        const existing = env.NODE_OPTIONS || '';
        env.NODE_OPTIONS = `${existing} --require "${hookPath}"`.trim();
      }
    }

    const args = ['test', testLocation];
    if (grep) args.push('--grep', grep);
    if (project) args.push('--project', project);
    if (repeatEach && repeatEach > 1) args.push('--repeat-each', String(repeatEach));
    args.push('--reporter=line');

    // Use the target project's local playwright binary to avoid resolving
    // to a different playwright installation (e.g. monorepo's forked version)
    const localBin = path.join(cwd, 'node_modules', '.bin', 'playwright');
    const cmd = fs.existsSync(localBin) ? localBin : 'npx';
    if (cmd === 'npx') args.unshift('playwright');

    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let progressPassed = 0;
    let progressFailed = 0;
    const total = repeatEach && repeatEach > 1 ? repeatEach : 0;

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (onProgress && total > 0) {
        // Playwright line reporter outputs lines like: "  ✓  1 ..." or "  ✗  2 ..."
        const clean = chunk.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
        for (const line of clean.split('\n')) {
          const trimmed = line.trim();
          if (/^[✓✔]/.test(trimmed) || /^\d+\s+passed/.test(trimmed)) {
            progressPassed++;
            onProgress(`${progressPassed + progressFailed}/${total} · ✅ ${progressPassed} passed, ❌ ${progressFailed} failed`);
          } else if (/^[✗✘×]/.test(trimmed) || /^\d+\s+failed/.test(trimmed)) {
            progressFailed++;
            onProgress(`${progressPassed + progressFailed}/${total} · ✅ ${progressPassed} passed, ❌ ${progressFailed} failed`);
          }
        }
      }
    });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000).unref();
      resolve({ success: false, error: `Test timeout (${timeoutMs / 1000}s)` });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true });
        return;
      }

      // Parse error from output
      const combined = (stdout + '\n' + stderr)
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\[1A|\[2K/g, '');

      const lines = combined.split('\n');
      const errorLines: string[] = [];
      let capturing = false;

      for (let li = 0; li < lines.length; li++) {
        const trimmed = lines[li].trim();
        if (!capturing && (
          trimmed.startsWith('Error:') ||
          trimmed.startsWith('TimeoutError:') ||
          trimmed.startsWith('expect(') ||
          trimmed.startsWith('Expected:') ||
          trimmed.startsWith('Received:') ||
          trimmed.match(/^Timeout \d+ms exceeded/) ||
          trimmed.startsWith('waiting for') ||
          trimmed.startsWith('Call log:')
        )) {
          capturing = true;
        }
        if (capturing) {
          errorLines.push(lines[li]);
          if (errorLines.length >= 50) break;
          if (trimmed.startsWith('at ') &&
              !lines[li + 1]?.trim().match(/^(Expected|Received|Call log|at |waiting for|- )/)) {
            break;
          }
          if (trimmed.startsWith('=') && errorLines.length > 2) break;
        }
      }

      if (errorLines.length > 0) {
        resolve({ success: false, error: errorLines.join('\n') });
      } else {
        const noise = /^\d+ (passed|failed|skipped)|^Running \d|^npx |^\[.+\] ›|^reports\/|^\s*$/;
        const meaningful = lines.map(l => l.trim()).filter(l => l && !noise.test(l));
        resolve({ success: false, error: meaningful.slice(-8).join('\n') || `Exit code ${code}` });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
  });
}

function collectScreenshots(cwd: string, startTime: number): TestAttachment[] {
  const attachments: TestAttachment[] = [];
  const seenPaths = new Set<string>();

  const walk = (dir: string, depth = 0) => {
    if (depth > 4 || !fs.existsSync(dir)) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, depth + 1); continue; }
        if (!entry.name.match(/^test-failed.*\.png$/)) continue;
        if (seenPaths.has(full)) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs >= startTime) {
            seenPaths.add(full);
            attachments.push({ name: entry.name, path: full, contentType: 'image/png' });
          }
        } catch {}
      }
    } catch {}
  };

  walk(cwd);
  return attachments;
}

function collectActionScreenshots(actions: ActionCapture[], cwd: string, attachments: TestAttachment[]): void {
  for (const action of actions) {
    if (action.method !== 'screenshot') continue;
    const filePath = action.params?.path;
    if (!filePath || typeof filePath !== 'string') continue;
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    if (!fs.existsSync(resolved)) continue;
    if (attachments.some(a => a.path === resolved)) continue;
    attachments.push({ name: path.basename(resolved), path: resolved, contentType: 'image/png' });
  }
}
