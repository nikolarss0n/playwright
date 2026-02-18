/**
 * Test Runner
 *
 * Discovers and runs Playwright tests with test selection and live status updates.
 * Integrates action capture for live network/console/snapshot data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { store, TestFile, TestCase, type TestAttachment, type ActionCapture } from '../ui/store.js';
import { startCaptureServer, stopCaptureServer, getCaptureEndpoint } from './captureServer.js';
import { saveTestResult, loadHistory } from './history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Common test patterns
const TEST_PATTERNS = [
  'tests/**/*.spec.ts',
  'tests/**/*.spec.js',
  'test/**/*.spec.ts',
  'test/**/*.spec.js',
  'e2e/**/*.spec.ts',
  'e2e/**/*.spec.js',
];

/**
 * Discover test files in the project using Playwright's --list command
 * This respects playwright.config.ts settings
 */
export async function discoverTests(cwd: string, project?: string): Promise<TestFile[]> {
  try {
    // Use Playwright's own test discovery which respects config
    const result = await new Promise<string>((resolve, reject) => {
      const args = ['test', '--list', '--reporter=json'];
      if (project) args.push('--project', project);

      // Use the target project's local playwright binary to avoid resolving
      // to a different playwright installation (e.g. monorepo's forked version)
      const localBin = path.join(cwd, 'node_modules', '.bin', 'playwright');
      const cmd = fs.existsSync(localBin) ? localBin : 'npx';
      if (cmd === 'npx') args.unshift('playwright');

      const child = spawn(cmd, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      // Timeout after 30 seconds
      const discoveryTimeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Test discovery timeout'));
      }, 30000);

      child.on('close', (code) => {
        clearTimeout(discoveryTimeout);
        // JSON reporter may output valid JSON even with non-zero exit
        // Try to parse stdout first
        if (stdout.trim().startsWith('{')) {
          resolve(stdout);
        } else if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Exit code ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(discoveryTimeout);
        reject(err);
      });
    });

    // Parse the JSON and extract tests
    return parsePlaywrightJson(result, cwd);
  } catch (err: any) {
    // Fallback to glob-based discovery if Playwright command fails
    const fs2 = await import('fs');
    try { fs2.appendFileSync('/tmp/pw-test-writer.log', `[${new Date().toISOString()}] discoverTests: npx failed (${err.message}), falling back to glob in ${cwd}\n`); } catch {}
    return discoverTestsWithGlob(cwd);
  }
}

export interface PlaywrightProject {
  name: string;
  testDir?: string;
}

/**
 * Discover available Playwright projects from the config
 */
export async function discoverProjects(cwd: string): Promise<PlaywrightProject[]> {
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const args = ['test', '--list', '--reporter=json'];
      const localBin = path.join(cwd, 'node_modules', '.bin', 'playwright');
      const cmd = fs.existsSync(localBin) ? localBin : 'npx';
      if (cmd === 'npx') args.unshift('playwright');

      const child = spawn(cmd, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout?.on('data', (data) => { stdout += data.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Project discovery timeout'));
      }, 15000);

      child.on('close', () => {
        clearTimeout(timer);
        resolve(stdout);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const data = JSON.parse(result);
    return (data.config?.projects || [])
      .map((p: any) => ({
        name: String(p.name || ''),
        testDir: p.testDir ? String(p.testDir) : undefined,
      }))
      .filter((p: PlaywrightProject) => p.name);
  } catch {
    return [];
  }
}

/**
 * Parse Playwright JSON output into TestFile array
 */
function parsePlaywrightJson(json: string, cwd: string): TestFile[] {
  const testFiles: TestFile[] = [];
  const data = JSON.parse(json);
  const fileMap = new Map<string, TestCase[]>();

  // Use rootDir from config if available (where test files are relative to)
  const rootDir = data.config?.rootDir || cwd;

  for (const suite of data.suites || []) {
    processTestSuite(suite, rootDir, fileMap);
  }

  for (const [filePath, tests] of fileMap) {
    const relativePath = path.relative(cwd, filePath);
    testFiles.push({ path: filePath, relativePath, tests });
  }

  return testFiles;
}

/**
 * Process a test suite recursively from Playwright JSON output
 */
function processTestSuite(suite: any, cwd: string, fileMap: Map<string, TestCase[]>, parentTitle = '') {
  const currentTitle = parentTitle && suite.title
    ? `${parentTitle} > ${suite.title}`
    : suite.title || parentTitle;

  // Process specs in this suite
  for (const spec of suite.specs || []) {
    const specFile = spec.file || suite.file;
    if (!specFile) continue;

    const filePath = path.isAbsolute(specFile) ? specFile : path.resolve(cwd, specFile);

    if (!fileMap.has(filePath)) {
      fileMap.set(filePath, []);
    }

    const tests = fileMap.get(filePath)!;
    const title = spec.title;
    const line = spec.line || 1;
    const fullTitle = currentTitle ? `${currentTitle} > ${title}` : title;

    // Avoid duplicates
    if (!tests.some(t => t.line === line && t.title === title)) {
      tests.push({ title, line, fullTitle });
    }
  }

  // Process nested suites
  for (const nested of suite.suites || []) {
    processTestSuite(nested, cwd, fileMap, currentTitle);
  }
}

/**
 * Fallback: Discover test files using glob patterns
 * Only searches if there's a playwright.config in the directory
 */
async function discoverTestsWithGlob(cwd: string): Promise<TestFile[]> {
  const testFiles: TestFile[] = [];

  // Only use glob fallback if there's a playwright config in cwd
  const hasConfig = fs.existsSync(path.join(cwd, 'playwright.config.ts')) ||
                    fs.existsSync(path.join(cwd, 'playwright.config.js'));

  if (!hasConfig) {
    // No config found - don't blindly scan for tests
    return testFiles;
  }

  // Dynamic import for glob
  const { glob } = await import('glob');

  // Look for test files in common locations (but not recursively deep)
  const patterns = [
    'tests/**/*.spec.ts',
    'tests/**/*.spec.js',
    'test/**/*.spec.ts',
    'test/**/*.spec.js',
    'e2e/**/*.spec.ts',
    'e2e/**/*.spec.js',
  ];

  for (const pattern of patterns) {
    try {
      const files = await glob(pattern, {
        cwd,
        ignore: ['**/node_modules/**'],
        absolute: true,
        maxDepth: 3, // Limit depth to avoid scanning too deep
      });

      for (const file of files) {
        if (testFiles.some(t => t.path === file)) continue;

        const relativePath = path.relative(cwd, file);
        const tests = await parseTestFile(file);

        if (tests.length > 0) {
          testFiles.push({ path: file, relativePath, tests });
        }
      }
    } catch {
      // Pattern didn't match, continue
    }
  }

  return testFiles;
}

/**
 * Parse a test file to extract test cases
 */
async function parseTestFile(filePath: string): Promise<TestCase[]> {
  const tests: TestCase[] = [];

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    let currentDescribe = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match describe blocks
      const describeMatch = line.match(/(?:test\.)?describe\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (describeMatch) {
        currentDescribe = describeMatch[1];
      }

      // Match test blocks
      const testMatch = line.match(/(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (testMatch) {
        const title = testMatch[1];
        const fullTitle = currentDescribe ? `${currentDescribe} > ${title}` : title;
        tests.push({ title, line: i + 1, fullTitle });
      }
    }
  } catch {
    // Failed to parse file
  }

  return tests;
}

// Track if we need to stop
let stopRequested = false;
let currentChild: ChildProcess | null = null;

/**
 * Request stop for running tests
 */
export function requestStop(): void {
  stopRequested = true;
}

/**
 * Kill currently running test (SIGTERM then SIGKILL escalation)
 */
export function killCurrentTest(): void {
  stopRequested = true;
  if (currentChild) {
    const child = currentChild;
    child.kill('SIGTERM');
    // Escalate to SIGKILL if still alive after 5 seconds
    const escalation = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 5000);
    escalation.unref();
    currentChild = null;
  }
}

/**
 * Run selected tests
 */
export async function runSelectedTests(cwd: string): Promise<void> {
  const state = store.getState();
  let selectedKeys = Object.keys(state.selectedTests);

  if (selectedKeys.length === 0) {
    // Run all tests if none selected
    for (const file of state.testFiles) {
      for (const test of file.tests) {
        selectedKeys.push(`${file.path}:${test.line}`);
      }
    }
  }

  if (selectedKeys.length === 0) {
    store.setStatus('No tests to run');
    return;
  }

  store.setIsRunning(true);
  store.resetTestRunner();
  stopRequested = false;

  // Start capture server for live action capture
  let captureEndpoint: string | null = null;
  try {
    await startCaptureServer();
    captureEndpoint = getCaptureEndpoint();
  } catch {
    // Continue without capture if server fails to start
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const total = selectedKeys.length;

  store.setStatus(`Starting ${total} test(s)...`);

  try {
    for (let i = 0; i < selectedKeys.length; i++) {
      // Check if stop was requested
      if (stopRequested || store.isStopRequested()) {
        skipped = total - i;
        store.setStatus(`Stopped: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        break;
      }

      const key = selectedKeys[i];
      // Handle paths with colons (Windows drive letters)
      const lastColonIndex = key.lastIndexOf(':');
      const filePath = key.substring(0, lastColonIndex);
      const line = parseInt(key.substring(lastColonIndex + 1), 10);

      // Find the test info
      const file = state.testFiles.find(f => f.path === filePath);
      const test = file?.tests.find(t => t.line === line);

      if (!file || !test) continue;

      const testKey = key;
      store.setStatus(`Running (${i + 1}/${total}): ${test.fullTitle} [Esc to stop]`);
      store.clearCurrentTestActions();

      // Mark test as running
      store.setTestRunning(testKey, file.relativePath, test.fullTitle);

      // Start test timer for progress tracking
      store.startTestTimer();

      // Add step for this test
      const stepId = store.addStep(`Test: ${test.fullTitle}`);
      store.updateStep(stepId, 'running');

      const startTime = Date.now();

      try {
        // Run the single test using spawn with capture integration
        const testLocation = `${filePath}:${line}`;
        const result = await runTestWithSpawn(testLocation, cwd, captureEndpoint);

        const duration = Date.now() - startTime;

        // Update step status
        store.updateStep(stepId, result.success ? 'done' : 'error', result.success ? `${duration}ms` : result.error || 'Test failed');

        const testStatus = result.success ? 'passed' : 'failed';

        // Collect screenshots from test-results/ and from captured action params
        const attachments = collectScreenshots(cwd, startTime);
        const capturedActions = store.getState().currentTestActions;
        collectActionScreenshots(capturedActions, cwd, attachments);

        // Record result with testKey
        store.addTestResult({
          file: file.relativePath,
          test: test.fullTitle,
          testKey,
          status: testStatus,
          duration,
          actions: [...capturedActions],
          error: result.success ? undefined : result.error,
          ...(attachments.length > 0 ? { attachments } : {}),
        });

        // Save to local history
        try { saveTestResult(cwd, file.relativePath, line, testStatus, duration); } catch {}
        // Refresh history in store
        try { store.setState({ testHistory: loadHistory(cwd) }); } catch {}

        // Clear test timer
        store.clearTestTimer();

        if (result.success) {
          passed++;
        } else {
          failed++;
        }
      } catch (error: any) {
        const duration = Date.now() - startTime;
        store.updateStep(stepId, 'error', error.message || 'Test error');

        // Clear test timer
        store.clearTestTimer();

        const attachments = collectScreenshots(cwd, startTime);
        collectActionScreenshots(store.getState().currentTestActions, cwd, attachments);

        store.addTestResult({
          file: file.relativePath,
          test: test.fullTitle,
          testKey,
          status: 'failed',
          duration,
          actions: [],
          error: error.message || 'Test error',
          ...(attachments.length > 0 ? { attachments } : {}),
        });

        // Save to local history
        try { saveTestResult(cwd, file.relativePath, line, 'failed', duration); } catch {}
        try { store.setState({ testHistory: loadHistory(cwd) }); } catch {}

        failed++;
      }

      // Update status with running tally
      store.setStatus(`Progress: ${passed} passed, ${failed} failed (${i + 1}/${total}) [Esc to stop]`);
    }

  } catch (error: any) {
    store.setStatus(`Error: ${error.message}`);
  } finally {
    try { stopCaptureServer(); } catch {}
  }

  store.setIsRunning(false);
  if (skipped === 0) {
    store.setStatus(`Done: ${passed} passed, ${failed} failed`);
  }
}

/**
 * Run a single test using spawn with optional capture integration
 */
async function runTestWithSpawn(
  testLocation: string,
  cwd: string,
  captureEndpoint: string | null
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Build environment with capture settings
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FORCE_COLOR: '0', // Disable colors to make parsing easier
    };

    // Add capture endpoint if available
    if (captureEndpoint) {
      env.PW_CAPTURE_ENDPOINT = captureEndpoint;
      env.PW_CAPTURE_SESSION = `test-${Date.now()}`;

      // Use NODE_OPTIONS to inject our capture hook into worker processes
      const hookPath = path.resolve(__dirname, 'captureHook.cjs');
      if (fs.existsSync(hookPath)) {
        const existingNodeOptions = env.NODE_OPTIONS || '';
        env.NODE_OPTIONS = `${existingNodeOptions} --require "${hookPath}"`.trim();
      }
    }

    const child = spawn('npx', [
      'playwright', 'test',
      testLocation,
      '--reporter=line',
    ], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    currentChild = child;

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout after 2 minutes
    const execTimeout = setTimeout(() => {
      if (currentChild === child) {
        child.kill('SIGTERM');
        // Escalate to SIGKILL after 5 seconds
        const escalation = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
        }, 5000);
        escalation.unref();
        currentChild = null;
        resolve({ success: false, error: 'Test timeout (2 minutes)' });
      }
    }, 120000);

    child.on('close', (code) => {
      clearTimeout(execTimeout);
      currentChild = null;
      const success = code === 0;
      let error: string | undefined;

      if (!success) {
        if (process.env.DEBUG) {
          console.error('Test failed. Location:', testLocation);
          console.error('STDOUT:', stdout);
          console.error('STDERR:', stderr);
        }

        // Combine and clean output
        const combined = (stdout + '\n' + stderr)
          .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')  // Strip ANSI
          .replace(/\[1A|\[2K/g, '');               // Strip terminal control

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
            // Stop after stack trace line, but keep going for
            // Expected/Received/Call log sections
            if (trimmed.startsWith('at ') &&
                !lines[li + 1]?.trim().match(/^(Expected|Received|Call log|at |waiting for|- )/)) {
              break;
            }
            // Stop after Call log entries end
            if (trimmed.startsWith('=') && errorLines.length > 2) break;
          }
        }

        if (errorLines.length > 0) {
          error = errorLines.join('\n');
        } else {
          // Fallback: filter reporter noise, keep error-relevant lines
          const noise = /^\d+ (passed|failed|skipped)|^Running \d|^npx |^\[.+\] ›|^reports\/|^\s*$/;
          const meaningful = lines
            .map(l => l.trim())
            .filter(l => l && !noise.test(l));
          error = meaningful.slice(-8).join('\n') || `Test failed with exit code ${code}`;
        }
      }

      resolve({ success, error });
    });

    child.on('error', (err) => {
      clearTimeout(execTimeout);
      currentChild = null;
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Collect Playwright failure screenshots created after startTime.
 * Searches the project tree (excluding node_modules) for test-failed-*.png files.
 */
function collectScreenshots(cwd: string, startTime: number): TestAttachment[] {
  const attachments: TestAttachment[] = [];
  const seenPaths = new Set<string>();

  const walkForScreenshots = (dir: string, depth = 0) => {
    if (depth > 4 || !fs.existsSync(dir)) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkForScreenshots(full, depth + 1); continue; }
        // Match Playwright's failure screenshot pattern: test-failed-N.png
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

  walkForScreenshots(cwd);
  return attachments;
}

/**
 * Extract screenshot paths from captured Page.screenshot actions
 */
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
