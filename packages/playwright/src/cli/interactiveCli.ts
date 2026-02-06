#!/usr/bin/env node
/**
 * Interactive Action Capture CLI
 *
 * A terminal-based interface for running Playwright tests with action capture.
 *
 * Features:
 * - Auto-discovers tests in your project
 * - Interactive test selection
 * - Real-time action capture display
 * - Results summary
 *
 * Usage:
 *   npx pw-capture
 */

import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

// ============================================================================
// ANSI Colors and Styles
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

const style = {
  title: (s: string) => `${colors.bold}${colors.cyan}${s}${colors.reset}`,
  success: (s: string) => `${colors.green}${s}${colors.reset}`,
  error: (s: string) => `${colors.red}${s}${colors.reset}`,
  warning: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  info: (s: string) => `${colors.blue}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  highlight: (s: string) => `${colors.bold}${colors.white}${s}${colors.reset}`,
  action: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  network: (s: string) => `${colors.cyan}${s}${colors.reset}`,
};

// ============================================================================
// Terminal Utilities
// ============================================================================

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function moveCursor(row: number, col: number) {
  process.stdout.write(`\x1b[${row};${col}H`);
}

function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

function showCursor() {
  process.stdout.write('\x1b[?25h');
}

function clearLine() {
  process.stdout.write('\x1b[2K');
}

// ============================================================================
// Box Drawing
// ============================================================================

const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
};

function drawBox(title: string, width: number = 70): string {
  const titleLen = title.length;
  const padding = Math.floor((width - titleLen - 4) / 2);
  const top = box.topLeft + box.horizontal.repeat(padding) + ` ${title} ` + box.horizontal.repeat(width - padding - titleLen - 4) + box.topRight;
  return top;
}

function drawBoxBottom(width: number = 70): string {
  return box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight;
}

function drawBoxLine(content: string, width: number = 70): string {
  const visibleLength = content.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = width - visibleLength - 4;
  return `${box.vertical} ${content}${' '.repeat(Math.max(0, padding))} ${box.vertical}`;
}

// ============================================================================
// Test Discovery
// ============================================================================

interface TestFile {
  path: string;
  relativePath: string;
  tests: TestCase[];
}

interface TestCase {
  title: string;
  line: number;
  fullTitle: string;
}

async function discoverTests(cwd: string): Promise<TestFile[]> {
  const testFiles: TestFile[] = [];

  // Common test patterns
  const patterns = [
    'tests/**/*.spec.ts',
    'tests/**/*.spec.js',
    'test/**/*.spec.ts',
    'test/**/*.spec.js',
    'e2e/**/*.spec.ts',
    'e2e/**/*.spec.js',
    '**/*.spec.ts',
    '**/*.spec.js',
  ];

  // Find test files
  const glob = await import('glob');

  for (const pattern of patterns) {
    try {
      const files = await glob.glob(pattern, {
        cwd,
        ignore: ['**/node_modules/**'],
        absolute: true,
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

// ============================================================================
// Interactive Menu
// ============================================================================

interface MenuItem {
  label: string;
  value: string;
  type: 'file' | 'test' | 'action';
  file?: TestFile;
  test?: TestCase;
}

class InteractiveMenu {
  private items: MenuItem[] = [];
  private selectedIndex = 0;
  private selectedItems = new Set<number>();
  private rl: readline.Interface;
  private resolve?: (value: MenuItem[]) => void;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async select(items: MenuItem[], title: string): Promise<MenuItem[]> {
    this.items = items;
    this.selectedIndex = 0;
    this.selectedItems.clear();

    return new Promise((resolve) => {
      this.resolve = resolve;

      hideCursor();
      this.setupKeyHandlers();
      this.render(title);
    });
  }

  private setupKeyHandlers() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', this.handleKey.bind(this));
  }

  private handleKey(key: Buffer) {
    const keyStr = key.toString();

    switch (keyStr) {
      case '\x1b[A': // Up arrow
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        break;
      case '\x1b[B': // Down arrow
        this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
        break;
      case ' ': // Space - toggle selection
        if (this.selectedItems.has(this.selectedIndex)) {
          this.selectedItems.delete(this.selectedIndex);
        } else {
          this.selectedItems.add(this.selectedIndex);
        }
        break;
      case '\r': // Enter - confirm
      case '\n':
        this.finish();
        return;
      case 'a': // Select all
        if (this.selectedItems.size === this.items.length) {
          this.selectedItems.clear();
        } else {
          this.items.forEach((_, i) => this.selectedItems.add(i));
        }
        break;
      case 'q': // Quit
      case '\x03': // Ctrl+C
        this.cleanup();
        process.exit(0);
        break;
    }

    this.render('Select Tests');
  }

  private render(title: string) {
    clearScreen();

    console.log('');
    console.log(style.title(`  ${drawBox(title)}`));

    const visibleStart = Math.max(0, this.selectedIndex - 10);
    const visibleEnd = Math.min(this.items.length, visibleStart + 20);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const item = this.items[i];
      const isSelected = i === this.selectedIndex;
      const isChecked = this.selectedItems.has(i);

      const cursor = isSelected ? style.highlight('❯') : ' ';
      const checkbox = isChecked ? style.success('◉') : style.dim('○');

      let label = item.label;
      if (item.type === 'file') {
        label = style.info(item.label);
      } else if (item.type === 'test') {
        label = `  ${style.dim('└')} ${item.label}`;
      }

      if (isSelected) {
        label = style.highlight(label.replace(/\x1b\[[0-9;]*m/g, ''));
      }

      console.log(`  ${cursor} ${checkbox} ${label}`);
    }

    if (this.items.length > 20) {
      console.log(style.dim(`     ... and ${this.items.length - 20} more`));
    }

    console.log('');
    console.log(style.dim('  ↑↓ Navigate  ␣ Select  a All  ↵ Run  q Quit'));
    console.log(style.dim(`  ${this.selectedItems.size} of ${this.items.length} selected`));
  }

  private finish() {
    this.cleanup();

    const selected = this.selectedItems.size > 0
      ? Array.from(this.selectedItems).map(i => this.items[i])
      : this.items; // Run all if none selected

    this.resolve?.(selected);
  }

  private cleanup() {
    process.stdin.removeAllListeners('data');
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    showCursor();
    this.rl.close();
  }
}

// ============================================================================
// Action Capture Display
// ============================================================================

interface ActionCapture {
  type: string;
  method: string;
  title?: string;
  timing: { durationMs: number };
  network: { requests: Array<{ method: string; url: string; status: number | null; durationMs: number }>; summary: string };
  snapshot: { diff?: { added: string[]; removed: string[]; changed: string[]; summary: string } };
  console: Array<{ type: string; text: string }>;
  error?: { message: string };
}

class ActionCaptureDisplay {
  private actions: ActionCapture[] = [];
  private currentTest = '';
  private startTime = Date.now();

  setCurrentTest(name: string) {
    this.currentTest = name;
    this.actions = [];
    this.startTime = Date.now();
    this.renderHeader();
  }

  addAction(capture: ActionCapture) {
    this.actions.push(capture);
    this.renderAction(capture, this.actions.length);
  }

  private renderHeader() {
    console.log('');
    console.log(style.title(`  ▶ Running: ${this.currentTest}`));
    console.log(style.dim(`  ${'─'.repeat(66)}`));
  }

  private renderAction(capture: ActionCapture, index: number) {
    const elapsed = Date.now() - this.startTime;
    const actionName = capture.title || `${capture.type}.${capture.method}`;

    // Action line
    let statusIcon = style.success('✓');
    if (capture.error) {
      statusIcon = style.error('✗');
    }

    console.log(`  ${statusIcon} ${style.action(actionName)} ${style.dim(`(${capture.timing.durationMs}ms)`)}`);

    // Network requests
    if (capture.network.requests.length > 0) {
      for (const req of capture.network.requests.slice(0, 3)) {
        const statusColor = req.status && req.status >= 400 ? style.error : style.success;
        const status = req.status !== null ? statusColor(String(req.status)) : style.warning('...');
        const urlPath = new URL(req.url, 'http://localhost').pathname;
        console.log(`    ${style.network('↳')} ${style.dim(req.method)} ${urlPath} ${status}`);
      }
      if (capture.network.requests.length > 3) {
        console.log(style.dim(`    ... +${capture.network.requests.length - 3} more requests`));
      }
    }

    // Page changes
    if (capture.snapshot.diff && capture.snapshot.diff.summary !== 'no changes') {
      const diff = capture.snapshot.diff;
      if (diff.added.length > 0) {
        console.log(`    ${style.success('+')} ${diff.added.slice(0, 2).join(', ')}${diff.added.length > 2 ? ` +${diff.added.length - 2} more` : ''}`);
      }
      if (diff.removed.length > 0) {
        console.log(`    ${style.error('-')} ${diff.removed.slice(0, 2).join(', ')}${diff.removed.length > 2 ? ` +${diff.removed.length - 2} more` : ''}`);
      }
    }

    // Console errors
    const errors = capture.console.filter(c => c.type === 'error');
    if (errors.length > 0) {
      console.log(`    ${style.warning('⚠')} ${errors.length} console error(s)`);
    }

    // Action error
    if (capture.error) {
      console.log(`    ${style.error('Error:')} ${capture.error.message}`);
    }
  }

  renderSummary() {
    const totalDuration = this.actions.reduce((sum, a) => sum + a.timing.durationMs, 0);
    const totalRequests = this.actions.reduce((sum, a) => sum + a.network.requests.length, 0);
    const errors = this.actions.filter(a => a.error).length;

    console.log('');
    console.log(style.dim(`  ${'─'.repeat(66)}`));
    console.log(`  ${style.dim('Actions:')} ${this.actions.length}  ${style.dim('Duration:')} ${totalDuration}ms  ${style.dim('Requests:')} ${totalRequests}  ${style.dim('Errors:')} ${errors > 0 ? style.error(String(errors)) : style.success('0')}`);
  }
}

// ============================================================================
// Test Runner
// ============================================================================

class TestRunner {
  private display = new ActionCaptureDisplay();
  private results: { passed: number; failed: number; skipped: number } = { passed: 0, failed: 0, skipped: 0 };

  async runTests(items: MenuItem[], cwd: string): Promise<void> {
    clearScreen();

    console.log('');
    console.log(style.title('  ' + drawBox('Running Tests')));
    console.log('');

    // Group by file
    const testsByFile = new Map<string, MenuItem[]>();
    for (const item of items) {
      if (item.type === 'test' && item.file) {
        const existing = testsByFile.get(item.file.path) || [];
        existing.push(item);
        testsByFile.set(item.file.path, existing);
      } else if (item.type === 'file' && item.file) {
        // If file is selected, run all its tests
        const allTests = item.file.tests.map(t => ({
          label: t.title,
          value: `${item.file!.path}:${t.line}`,
          type: 'test' as const,
          file: item.file,
          test: t,
        }));
        testsByFile.set(item.file.path, allTests);
      }
    }

    // Run tests
    for (const [filePath, tests] of testsByFile) {
      const relativePath = path.relative(cwd, filePath);
      console.log(style.info(`  📁 ${relativePath}`));

      for (const test of tests) {
        if (test.test) {
          this.display.setCurrentTest(test.test.fullTitle);

          const result = await this.runSingleTest(filePath, test.test.line, cwd);

          if (result.success) {
            this.results.passed++;
          } else {
            this.results.failed++;
          }

          this.display.renderSummary();
        }
      }

      console.log('');
    }

    // Final summary
    this.renderFinalSummary();
  }

  private async runSingleTest(filePath: string, line: number, cwd: string): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
      const testLocation = `${filePath}:${line}`;

      // Run playwright test
      const child = spawn('npx', [
        'playwright', 'test',
        testLocation,
        '--reporter=line',
      ], {
        cwd,
        env: {
          ...process.env,
          PW_ACTION_CAPTURE: 'true', // Enable action capture in our fork
          FORCE_COLOR: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stderr?.on('data', (data) => {
        const output = data.toString();
        const lines = output.split('\n');

        for (const line of lines) {
          // Parse action capture output
          if (line.includes('[action:capture]')) {
            try {
              const jsonStart = line.indexOf('{');
              if (jsonStart !== -1) {
                const json = line.slice(jsonStart);
                const capture = JSON.parse(json) as ActionCapture;
                this.display.addAction(capture);
              }
            } catch {
              // Not JSON, show as-is
              if (line.trim()) {
                console.log(style.dim(`    ${line.trim()}`));
              }
            }
          } else if (line.includes('✓') || line.includes('✗') || line.includes('○')) {
            // Test result line
            console.log(`  ${line}`);
          }
        }
      });

      child.stdout?.on('data', (data) => {
        // Capture stdout but don't display (it's the JSON report)
      });

      child.on('close', (code) => {
        resolve({ success: code === 0 });
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        child.kill();
        resolve({ success: false });
      }, 120000);
    });
  }

  private renderFinalSummary() {
    console.log('');
    console.log(style.title('  ' + drawBox('Results')));
    console.log('');

    const total = this.results.passed + this.results.failed + this.results.skipped;

    console.log(`  ${style.success(`✓ ${this.results.passed} passed`)}`);
    if (this.results.failed > 0) {
      console.log(`  ${style.error(`✗ ${this.results.failed} failed`)}`);
    }
    if (this.results.skipped > 0) {
      console.log(`  ${style.warning(`○ ${this.results.skipped} skipped`)}`);
    }

    console.log('');
    console.log(style.dim(`  Total: ${total} tests`));
    console.log('');
  }
}

// ============================================================================
// Main Application
// ============================================================================

async function main() {
  const cwd = process.cwd();

  clearScreen();

  // Header
  console.log('');
  console.log(style.title('  ╭──────────────────────────────────────────────────────────────────╮'));
  console.log(style.title('  │                                                                  │'));
  console.log(style.title('  │              🎭  Playwright Action Capture                       │'));
  console.log(style.title('  │                                                                  │'));
  console.log(style.title('  │     Run tests with automatic network & UI change tracking        │'));
  console.log(style.title('  │                                                                  │'));
  console.log(style.title('  ╰──────────────────────────────────────────────────────────────────╯'));
  console.log('');

  // Discover tests
  console.log(style.info('  🔍 Discovering tests...'));

  const testFiles = await discoverTests(cwd);

  if (testFiles.length === 0) {
    console.log('');
    console.log(style.error('  No test files found!'));
    console.log(style.dim('  Make sure you have test files matching: tests/**/*.spec.ts'));
    console.log('');
    process.exit(1);
  }

  // Build menu items
  const menuItems: MenuItem[] = [];

  for (const file of testFiles) {
    // Add file
    menuItems.push({
      label: file.relativePath,
      value: file.path,
      type: 'file',
      file,
    });

    // Add tests in file
    for (const test of file.tests) {
      menuItems.push({
        label: test.title,
        value: `${file.path}:${test.line}`,
        type: 'test',
        file,
        test,
      });
    }
  }

  console.log(style.success(`  ✓ Found ${testFiles.length} test files with ${menuItems.filter(m => m.type === 'test').length} tests`));
  console.log('');

  // Interactive selection
  const menu = new InteractiveMenu();
  const selected = await menu.select(menuItems, 'Select Tests');

  if (selected.length === 0) {
    console.log(style.warning('  No tests selected'));
    process.exit(0);
  }

  // Run tests
  const runner = new TestRunner();
  await runner.runTests(selected, cwd);
}

// ============================================================================
// Entry Point
// ============================================================================

main().catch(error => {
  showCursor();
  console.error(style.error('Fatal error:'), error);
  process.exit(1);
});
