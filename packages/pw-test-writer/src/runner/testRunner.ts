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
import { store, TestFile, TestCase } from '../ui/store.js';
import { startCaptureServer, stopCaptureServer, getCaptureEndpoint } from './captureServer.js';

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
export async function discoverTests(cwd: string): Promise<TestFile[]> {
  try {
    // Use Playwright's own test discovery which respects config
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn('npx', ['playwright', 'test', '--list', '--reporter=json'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
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

      child.on('error', reject);

      // Timeout after 30 seconds
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Test discovery timeout'));
      }, 30000);
    });

    // Parse the JSON and extract tests
    return parsePlaywrightJson(result, cwd);
  } catch (err) {
    // Fallback to glob-based discovery if Playwright command fails
    if (process.env.DEBUG) {
      console.error('Playwright test list failed, falling back to glob discovery:', err);
    }
    return discoverTestsWithGlob(cwd);
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
 * Kill currently running test
 */
export function killCurrentTest(): void {
  stopRequested = true;
  if (currentChild) {
    currentChild.kill('SIGTERM');
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

        // Record result with testKey
        store.addTestResult({
          file: file.relativePath,
          test: test.fullTitle,
          testKey,
          status: result.success ? 'passed' : 'failed',
          duration,
          actions: [...store.getState().currentTestActions],
          error: result.success ? undefined : result.error,
        });

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

        store.addTestResult({
          file: file.relativePath,
          test: test.fullTitle,
          testKey,
          status: 'failed',
          duration,
          actions: [],
          error: error.message || 'Test error',
        });

        failed++;
      }

      // Update status with running tally
      store.setStatus(`Progress: ${passed} passed, ${failed} failed (${i + 1}/${total}) [Esc to stop]`);
    }

  } catch (error: any) {
    store.setStatus(`Error: ${error.message}`);
  } finally {
    // Stop capture server
    stopCaptureServer();
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

    child.on('close', (code) => {
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

        for (const line of lines) {
          const trimmed = line.trim();

          if (!capturing && (
            trimmed.startsWith('Error:') ||
            trimmed.startsWith('expect(') ||
            trimmed.startsWith('Expected:') ||
            trimmed.startsWith('Received:')
          )) {
            capturing = true;
          }

          if (capturing) {
            errorLines.push(line);
            if (errorLines.length >= 50) {
              break;
            }
            // Stop after 'at' location line, but keep going for
            // Expected/Received/Call log sections
            if (trimmed.startsWith('at ') &&
                !lines[lines.indexOf(line) + 1]?.trim().match(/^(Expected|Received|Call log|at )/)) {
              break;
            }
          }
        }

        if (errorLines.length > 0) {
          error = errorLines.join('\n');
        } else {
          // Fallback: grab meaningful lines from end of output
          const meaningful = lines
            .map(l => l.trim())
            .filter(l => l && !l.includes('Running') && !l.startsWith('npx'));
          error = meaningful.slice(-5).join('\n') || `Exit code: ${code}`;
        }
      }

      resolve({ success, error });
    });

    child.on('error', (err) => {
      currentChild = null;
      resolve({ success: false, error: err.message });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      if (currentChild === child) {
        child.kill('SIGTERM');
        currentChild = null;
        resolve({ success: false, error: 'Test timeout (2 minutes)' });
      }
    }, 120000);
  });
}
