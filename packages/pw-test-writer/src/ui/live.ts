import chalk from 'chalk';
import logUpdate from 'log-update';
import * as readline from 'readline';
import * as fs from 'fs';
import { store, TabId, ModelId, AppMode, PanelFocus, ActionDetailFocus } from './store.js';
import { parsePlaywrightConfig, saveBaseURL } from '../config/playwright.js';
import { discoverTests, runSelectedTests, killCurrentTest } from '../runner/testRunner.js';
import { getAiSuggestion, getCurrentAiContext, extractCodeFromResponse, replaceTestInFile } from '../ai/assistant.js';

// Strip ANSI escape codes to get visual width
const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const visualWidth = (str: string) => stripAnsi(str).length;
const padEndVisual = (str: string, width: number) => str + ' '.repeat(Math.max(0, width - visualWidth(str)));

// Format milliseconds as human readable time
const formatTime = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
};

// Create a progress bar
const progressBar = (elapsed: number, total: number, width: number = 20): string => {
  const percent = Math.min(1, elapsed / total);
  const filled = Math.floor(percent * width);
  const empty = width - filled;
  const bar = chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  const remaining = total - elapsed;
  const timeColor = remaining < 30000 ? chalk.red : remaining < 60000 ? chalk.yellow : chalk.green;
  return `${bar} ${timeColor(formatTime(remaining))}`;
};

// Spinner frames for loading animation
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const getSpinner = (): string => {
  const frame = Math.floor(Date.now() / 80) % spinnerFrames.length;
  return chalk.cyan(spinnerFrames[frame]);
};

// Colorize JSON output like jq
const colorizeJson = (line: string): string => {
  return line
    // Keys (before colon)
    .replace(/"([^"]+)":/g, (_, key) => chalk.cyan(`"${key}"`) + ':')
    // String values (truncate long ones)
    .replace(/: "([^"]*)"/g, (_, val) => {
      const display = val.length > 60 ? val.slice(0, 57) + '...' : val;
      return ': ' + chalk.green(`"${display}"`);
    })
    // Numbers
    .replace(/: (-?\d+\.?\d*)/g, (_, num) => ': ' + chalk.yellow(num))
    // Booleans
    .replace(/: (true|false)/g, (_, bool) => ': ' + chalk.magenta(bool))
    // Null
    .replace(/: (null)/g, (_, n) => ': ' + chalk.dim(n))
    // Brackets and braces
    .replace(/([{}\[\]])/g, chalk.white('$1'));
};

/**
 * Format JSON for compact display in a box.
 * Returns pre-styled lines with chalk colors applied.
 */
const formatJsonPreview = (jsonStr: string, maxLines: number, maxWidth: number): string[] => {
  try {
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed)) {
      const lines: string[] = [];
      const itemCount = parsed.length;

      if (itemCount === 0) {
        lines.push(chalk.dim('[]'));
        return lines;
      }

      lines.push(chalk.white('[') + chalk.dim(` ${itemCount} items`));

      // Show first 2 items compactly
      const previewCount = Math.min(2, itemCount);
      for (let i = 0; i < previewCount; i++) {
        const item = parsed[i];
        if (typeof item === 'object' && item !== null) {
          const keys = Object.keys(item);
          const oneLiner = JSON.stringify(item);
          if (oneLiner.length <= maxWidth - 4) {
            lines.push(chalk.gray('  ') + formatJsonOneLiner(item, maxWidth - 4));
          } else {
            // Show key-value pairs compactly
            lines.push(chalk.gray('  {'));
            for (let k = 0; k < Math.min(keys.length, 4); k++) {
              const key = keys[k];
              const val = formatValue(item[key], maxWidth - key.length - 10);
              lines.push(chalk.gray('    ') + chalk.cyan(key) + chalk.gray(': ') + val + (k < keys.length - 1 ? chalk.gray(',') : ''));
            }
            if (keys.length > 4) {
              lines.push(chalk.dim(`    ... +${keys.length - 4} fields`));
            }
            lines.push(chalk.gray('  }'));
          }
        } else {
          lines.push(chalk.gray('  ') + formatValue(item, maxWidth - 4));
        }
      }

      if (itemCount > previewCount) {
        lines.push(chalk.dim(`  ... +${itemCount - previewCount} more items`));
      }
      lines.push(chalk.white(']'));

      return lines.slice(0, maxLines);
    }

    // Object: show key-value pairs
    if (typeof parsed === 'object' && parsed !== null) {
      const lines: string[] = [];
      const keys = Object.keys(parsed);
      lines.push(chalk.white('{'));
      for (let k = 0; k < Math.min(keys.length, maxLines - 2); k++) {
        const key = keys[k];
        const val = formatValue(parsed[key], maxWidth - key.length - 8);
        lines.push(chalk.gray('  ') + chalk.cyan(key) + chalk.gray(': ') + val + (k < keys.length - 1 ? chalk.gray(',') : ''));
      }
      if (keys.length > maxLines - 2) {
        lines.push(chalk.dim(`  ... +${keys.length - (maxLines - 2)} more fields`));
      }
      lines.push(chalk.white('}'));
      return lines.slice(0, maxLines);
    }

    // Primitive
    return [formatValue(parsed, maxWidth)];
  } catch {
    // Not valid JSON - show raw text
    const lines = jsonStr.split('\n').slice(0, maxLines);
    return lines.map(l => chalk.gray(l.slice(0, maxWidth)));
  }
};

const formatValue = (value: any, maxWidth: number): string => {
  if (value === null) return chalk.dim('null');
  if (value === undefined) return chalk.dim('undefined');
  if (typeof value === 'boolean') return chalk.magenta(String(value));
  if (typeof value === 'number') return chalk.yellow(String(value));
  if (typeof value === 'string') {
    const escaped = value.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
    if (escaped.length > maxWidth - 2) {
      return chalk.green(`"${escaped.slice(0, maxWidth - 5)}..."`);
    }
    return chalk.green(`"${escaped}"`);
  }
  if (Array.isArray(value)) {
    return chalk.white('[') + chalk.dim(`${value.length} items`) + chalk.white(']');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return chalk.white('{') + chalk.dim(`${keys.length} fields`) + chalk.white('}');
  }
  return chalk.gray(String(value).slice(0, maxWidth));
};

const formatJsonOneLiner = (obj: any, maxWidth: number): string => {
  const parts: string[] = [];
  const keys = Object.keys(obj);
  let totalLen = 2; // { }
  for (const key of keys) {
    const val = typeof obj[key] === 'string'
      ? `"${obj[key].slice(0, 20)}${obj[key].length > 20 ? '...' : ''}"`
      : JSON.stringify(obj[key]);
    const part = `${key}: ${val}`;
    totalLen += part.length + 2;
    if (totalLen > maxWidth) {
      parts.push(chalk.dim('...'));
      break;
    }
    parts.push(chalk.cyan(key) + chalk.gray(': ') + chalk.white(val));
  }
  return chalk.white('{') + ' ' + parts.join(chalk.gray(', ')) + ' ' + chalk.white('}');
};

const RESPONSE_VISIBLE_LINES = 10;

const formatJsonFull = (jsonStr: string, maxWidth: number): string[] => {
  try {
    const parsed = JSON.parse(jsonStr);
    const formatted = JSON.stringify(parsed, null, 2);
    return formatted.split('\n').map(line => {
      if (line.length > maxWidth) {
        line = line.slice(0, maxWidth - 3) + '...';
      }
      return styleJsonLine(line);
    });
  } catch {
    return jsonStr.split('\n').map(l => chalk.gray(l.slice(0, maxWidth)));
  }
};

const styleJsonLine = (line: string): string => {
  const m = line.match(/^(\s*)(.*)/);
  if (!m) return chalk.gray(line);
  const [, indent, content] = m;

  const kvMatch = content.match(/^("(?:[^"\\]|\\.)*")\s*:\s*(.*)/);
  if (kvMatch) {
    let [, key, rest] = kvMatch;
    const comma = rest.endsWith(',') ? ',' : '';
    if (comma) rest = rest.slice(0, -1);
    return indent + chalk.cyan(key) + chalk.gray(': ') + styleValue(rest.trim()) + chalk.gray(comma);
  }

  const comma = content.endsWith(',') ? ',' : '';
  const val = comma ? content.slice(0, -1) : content;
  return indent + styleValue(val.trim()) + chalk.gray(comma);
};

const styleValue = (val: string): string => {
  if (!val) return '';
  if (val.startsWith('"')) return chalk.green(val);
  if (val === 'null') return chalk.dim('null');
  if (val === 'true' || val === 'false') return chalk.magenta(val);
  if (/^-?\d/.test(val)) return chalk.yellow(val);
  return chalk.white(val);
};

const formatTestError = (error: string, maxWidth: number, maxLines: number): string[] => {
  const lines: string[] = [];
  const errorLines = error.split('\n');

  for (const raw of errorLines) {
    if (lines.length >= maxLines) break;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('Error:')) {
      lines.push(chalk.red.bold(trimmed.slice(0, maxWidth)));
    } else if (trimmed.startsWith('Expected:')) {
      const val = trimmed.replace('Expected:', '').trim();
      lines.push(chalk.green('  Expected: ') + chalk.green.bold(val));
    } else if (trimmed.startsWith('Received:')) {
      const val = trimmed.replace('Received:', '').trim();
      lines.push(chalk.red('  Received: ') + chalk.red.bold(val));
    } else if (trimmed.startsWith('>')) {
      lines.push(chalk.red('  ' + trimmed.slice(0, maxWidth - 4)));
    } else if (trimmed.match(/^\d+\s*\|/)) {
      lines.push(chalk.gray('  ' + trimmed.slice(0, maxWidth - 4)));
    } else if (trimmed.match(/^\|?\s*\^/)) {
      lines.push(chalk.red('  ' + trimmed.slice(0, maxWidth - 4)));
    } else if (trimmed.startsWith('at ')) {
      lines.push(chalk.dim('  ' + trimmed.slice(0, maxWidth - 4)));
    } else {
      lines.push(chalk.red('  ' + trimmed.slice(0, maxWidth - 4)));
    }
  }

  return lines;
};

type InputMode = 'task' | 'baseURL' | 'ai';

let aiInputBuffer = '';

const WRITE_TABS: { id: TabId; label: string; fkey: string }[] = [
  { id: 'steps', label: 'Steps', fkey: 'f1' },
  { id: 'pom', label: 'POM', fkey: 'f2' },
  { id: 'business', label: 'Business', fkey: 'f3' },
  { id: 'test', label: 'Test', fkey: 'f4' },
  { id: 'network', label: 'Network', fkey: 'f5' },
  { id: 'console', label: 'Console', fkey: 'f6' },
];

const RUN_TABS: { id: TabId; label: string; fkey: string }[] = [
  { id: 'tests', label: 'Tests', fkey: 'f1' },
  { id: 'steps', label: 'Actions', fkey: 'f2' },
  { id: 'network', label: 'Network', fkey: 'f3' },
  { id: 'console', label: 'Console', fkey: 'f4' },
];

const MODELS: { id: ModelId; label: string; color: typeof chalk.green }[] = [
  { id: 'haiku', label: 'Haiku 4.5', color: chalk.green },
  { id: 'opus', label: 'Opus 4.5', color: chalk.magenta },
];

export function startUI(onSubmit: (task: string, model: string, baseURL: string) => Promise<void>) {
  // Load Playwright config on startup
  const pwConfig = parsePlaywrightConfig();
  if (pwConfig.baseURL) {
    store.setBaseURL(pwConfig.baseURL);
  }
  if (pwConfig.configPath) {
    store.setConfigPath(pwConfig.configPath);
  }

  // Enter alternate screen buffer (fullscreen mode like vim/less)
  process.stdout.write('\x1B[?1049h');
  // Hide cursor
  process.stdout.write('\x1B[?25l');

  // Setup keyboard input
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  let inputBuffer = '';
  let cursorPos = 0;
  let inputMode: InputMode = store.getState().baseURL ? 'task' : 'baseURL';

  // Get terminal dimensions
  const getTerminalSize = () => ({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });

  const render = () => {
    const { width, height } = getTerminalSize();
    const state = store.getState();
    const model = MODELS.find(m => m.id === state.selectedModel)!;
    const TABS = state.mode === 'run' ? RUN_TABS : WRITE_TABS;

    let output = '';

    // Top menu bar with pill-style buttons
    const pill = (text: string, bg: typeof chalk.bgCyan, fg: typeof chalk.black, active = false) => {
      if (active) {
        return bg(fg(` ${text} `)) + ' ';
      }
      return chalk.gray(`(${text})`) + ' ';
    };

    const activePill = (text: string, bg: typeof chalk.bgCyan, fg: typeof chalk.black) => {
      return bg(fg(` ${text} `)) + ' ';
    };

    let menuBar = '';
    for (const tab of TABS) {
      const isActive = state.activeTab === tab.id;
      let badge = '';
      if (tab.id === 'network' && state.networkRequests.length > 0) {
        badge = ` ${state.networkRequests.length}`;
      }
      if (tab.id === 'console' && state.consoleMessages.length > 0) {
        badge = ` ${state.consoleMessages.length}`;
      }
      if (tab.id === 'tests' && state.testFiles.length > 0) {
        const totalTests = state.testFiles.reduce((sum, f) => sum + f.tests.length, 0);
        badge = ` ${totalTests}`;
      }
      const keyLabel = tab.fkey.toUpperCase();
      const label = `${keyLabel} ${tab.label}${badge}`;
      if (isActive) {
        menuBar += chalk.bgCyan.black(` ${label} `) + ' ';
      } else {
        menuBar += chalk.gray(`(${label})`) + ' ';
      }
    }
    // Add mode toggle and other F-key options
    const modeLabel = state.mode === 'write' ? 'F7 Run Tests' : 'F7 Write Tests';
    const modeBg = state.mode === 'write' ? chalk.bgMagenta : chalk.bgGreen;
    menuBar += modeBg.white(` ${modeLabel} `) + ' ';
    if (state.mode === 'write') {
      menuBar += chalk.bgBlue.white(` F9 ${model.label} `) + ' ';
    }
    menuBar += chalk.bgGreen.black(` F10 URL `) + ' ';
    menuBar += chalk.bgYellow.black(` F12 Reset `) + ' ';
    menuBar += chalk.bgRed.white(` Esc Quit `) + ' ';
    output += menuBar + '\n';
    output += chalk.gray('─'.repeat(width - 1)) + '\n';

    // Header with title and base URL
    const titleIcon = state.mode === 'run' ? '🧪' : '🎭';
    const titleText = state.mode === 'run' ? 'Playwright Test Runner' : 'Playwright Test Writer';
    output += chalk.magenta.bold(`${titleIcon} ${titleText}`);
    if (state.baseURL) {
      output += chalk.gray(' │ ') + chalk.green(state.baseURL);
      if (state.configPath) {
        output += chalk.gray(' [config]');
      }
    }
    output += '\n';

    // Input field (different for each mode)
    if (state.mode === 'run') {
      if (state.isRunning) {
        const { progress } = state;
        let progressLine = chalk.cyan('● Running');

        // Show current action
        if (progress.currentAction) {
          progressLine += chalk.gray(' │ ') + chalk.yellow(progress.currentAction);
          if (progress.waitingFor) {
            progressLine += chalk.dim(` (waiting: ${progress.waitingFor})`);
          }
        }

        // Show timeout countdown if test is running
        if (progress.testStartTime) {
          const elapsed = Date.now() - progress.testStartTime;
          progressLine += chalk.gray(' │ ') + progressBar(elapsed, progress.testTimeoutMs, 15);
        }

        output += progressLine + chalk.gray(' [Esc to stop]') + '\n';
      } else {
        const selectedCount = Object.keys(state.selectedTests).length;
        const totalTests = state.testFiles.reduce((sum, f) => sum + f.tests.length, 0);
        if (totalTests === 0) {
          output += chalk.yellow('No tests found. Press F8 to refresh.') + '\n';
        } else {
          const panelHint = state.panelFocus === 'tests' ? chalk.cyan('[Tests]') : chalk.cyan('[Actions]');
          output += `${panelHint} ${chalk.cyan(`${selectedCount}/${totalTests}`)}` + chalk.gray(' │ ') + chalk.green('Enter=Run') + chalk.gray(' │ Tab=Switch │ Space=Toggle │ ^A=All') + '\n';
        }
      }
    } else {
      if (state.isRunning) {
        output += chalk.cyan('Task: ') + chalk.gray(state.task) + '\n';
      } else if (inputMode === 'baseURL') {
        output += chalk.yellow('Base URL: ') + inputBuffer + chalk.inverse(' ') + chalk.gray(' (Enter=save, Esc=cancel)') + '\n';
      } else {
        if (!state.baseURL) {
          output += chalk.yellow('⚠ No base URL. Press F10 to set.') + '\n';
        }
        output += chalk.cyan('Task: ') + inputBuffer + chalk.inverse(' ') + '\n';
      }
    }
    output += chalk.gray('─'.repeat(width - 1)) + '\n';

    // Build AI bar lines (run mode only, bottom of screen)
    const aiBarLines: string[] = [];
    if (state.mode === 'run') {
      if (state.aiLoading) {
        aiBarLines.push(chalk.magenta('🤖 ') + chalk.cyan('Thinking...'));
      } else if (state.aiResponse) {
        const responseLines = state.aiResponse.split('\n');
        const maxResponseLines = Math.min(8, responseLines.length);
        for (let i = 0; i < maxResponseLines; i++) {
          const line = responseLines[i].slice(0, width - 6);
          aiBarLines.push(chalk.magenta('  │ ') + line);
        }
        if (responseLines.length > maxResponseLines) {
          aiBarLines.push(chalk.magenta('  │ ') + chalk.dim(`... ${responseLines.length - maxResponseLines} more lines`));
        }
        aiBarLines.push(chalk.magenta('  │ ') + chalk.green('Tab=Apply') + chalk.gray(' │ ') + chalk.yellow('Ctrl+S=Save') + chalk.gray(' │ ') + chalk.gray('Esc=Dismiss'));
      }
      if (!state.isRunning) {
        if (aiInputBuffer) {
          aiBarLines.push(chalk.magenta('🤖 > ') + aiInputBuffer + chalk.inverse(' '));
        } else {
          aiBarLines.push(chalk.magenta('🤖 > ') + chalk.dim('Ask AI...') + chalk.inverse(' '));
        }
      }
    }

    // Content - reserve lines for menu (2), header (2-3), input (2), status (2), AI bar
    const aiBarHeight = aiBarLines.length;
    const contentHeight = Math.max(5, height - 10 - aiBarHeight);
    output += renderContent(state, width, contentHeight) + '\n';

    output += chalk.gray('─'.repeat(width - 1)) + '\n';

    // AI bar
    for (const line of aiBarLines) {
      output += line + '\n';
    }

    // Status bar
    if (state.isRunning && state.progress.testStartTime) {
      const elapsed = Date.now() - state.progress.testStartTime;
      const elapsedStr = formatTime(elapsed);
      const statusIcon = chalk.cyan('●');

      // Build detailed status line
      let statusLine = `${statusIcon} ${state.status}`;

      // Add elapsed time
      statusLine += chalk.gray(` │ elapsed: ${elapsedStr}`);

      // Add current action details if available
      if (state.progress.currentAction) {
        const actionElapsed = state.progress.actionStartTime
          ? Date.now() - state.progress.actionStartTime
          : 0;
        if (actionElapsed > 1000) {
          statusLine += chalk.gray(` │ action: ${formatTime(actionElapsed)}`);
        }
      }

      output += statusLine;
    } else {
      const statusIcon = state.isRunning ? chalk.cyan('●') : chalk.green('○');
      output += `${statusIcon} ${state.status}`;
    }

    logUpdate(output);
  };

  const renderContent = (state: ReturnType<typeof store.getState>, termWidth: number, maxLines: number): string => {
    const lines: string[] = [];
    const contentWidth = termWidth - 2;

    switch (state.activeTab) {
      case 'tests': {
        if (state.testFiles.length === 0) {
          lines.push(chalk.gray('No test files found. Press F8 to scan for tests.'));
        } else {
          // Split-pane layout: Tests on left, Actions on right
          const leftWidth = Math.min(35, Math.floor(contentWidth * 0.35));
          const rightWidth = contentWidth - leftWidth - 3; // 3 for separator

          // First, find the selected test (for highlighting in left panel)
          let selectedTestKey = '';
          let selectedTestName = '';
          let findIdx = 0;
          findLoop: for (const file of state.testFiles) {
            findIdx++; // file header
            for (const test of file.tests) {
              if (findIdx === state.testSelectionIndex) {
                selectedTestKey = `${file.path}:${test.line}`;
                selectedTestName = test.title;
                break findLoop;
              }
              findIdx++;
            }
          }
          const selectedResult = selectedTestKey ? state.testResults.find(r => r.testKey === selectedTestKey) : null;

          // Build left panel (tests list)
          const leftLines: string[] = [];
          const focusLeft = state.panelFocus === 'tests';
          leftLines.push(focusLeft ? chalk.bgCyan.black(' Tests ') + chalk.gray('─'.repeat(leftWidth - 8)) : chalk.gray('─ Tests ' + '─'.repeat(leftWidth - 9)));

          let itemIndex = 0;
          for (const file of state.testFiles) {
            const fileResults = file.tests.map(t => state.testResults.find(r => r.testKey === `${file.path}:${t.line}`));
            const allPassed = fileResults.every(r => r?.status === 'passed');
            const anyFailed = fileResults.some(r => r?.status === 'failed');
            const anyRunning = fileResults.some(r => r?.status === 'running');
            const hasResults = fileResults.some(r => r);

            let fileIcon: string;
            if (anyRunning) fileIcon = chalk.cyan('●');
            else if (hasResults && allPassed) fileIcon = chalk.green('✓');
            else if (anyFailed) fileIcon = chalk.red('✗');
            else {
              const fileSelected = file.tests.every(t => state.selectedTests[`${file.path}:${t.line}`]);
              const filePartial = file.tests.some(t => state.selectedTests[`${file.path}:${t.line}`]) && !fileSelected;
              fileIcon = fileSelected ? chalk.green('◉') : filePartial ? chalk.yellow('◐') : chalk.gray('○');
            }

            const isHighlighted = focusLeft && itemIndex === state.testSelectionIndex;
            const fileName = file.relativePath.length > leftWidth - 5 ? '...' + file.relativePath.slice(-(leftWidth - 8)) : file.relativePath;
            const fileLine = `${fileIcon} ${isHighlighted ? chalk.inverse(fileName.padEnd(leftWidth - 3)) : chalk.cyan(fileName)}`;
            leftLines.push(fileLine);
            itemIndex++;

            for (const test of file.tests) {
              const testKey = `${file.path}:${test.line}`;
              const isSelected = !!state.selectedTests[testKey];
              const result = state.testResults.find(r => r.testKey === testKey);
              const isViewingThis = testKey === selectedTestKey;

              let icon: string;
              if (result?.status === 'running') icon = chalk.cyan('●');
              else if (result?.status === 'passed') icon = chalk.green('✓');
              else if (result?.status === 'failed') icon = chalk.red('✗');
              else icon = isSelected ? chalk.green('◉') : chalk.gray('○');

              const isHighlighted2 = focusLeft && itemIndex === state.testSelectionIndex;
              const testName = test.title.length > leftWidth - 6 ? test.title.slice(0, leftWidth - 9) + '...' : test.title;

              // Mark the test being viewed with an arrow when not focused on left panel
              const viewMarker = (!focusLeft && isViewingThis) ? chalk.yellow('→ ') : '  ';
              const nameDisplay = isHighlighted2
                ? chalk.inverse(testName.padEnd(leftWidth - 5))
                : isViewingThis && !focusLeft
                  ? chalk.yellow(testName)
                  : testName;
              const testLine = `${viewMarker}${icon} ${nameDisplay}`;
              leftLines.push(testLine);
              itemIndex++;
            }
          }

          // Build right panel (actions for selected test)
          const rightLines: string[] = [];
          const focusRight = state.panelFocus === 'actions';

          // Header with test name
          const actionsLabel = selectedTestName
            ? ` ${selectedTestName.slice(0, rightWidth - 15)} `
            : ' Actions ';
          const headerLen = actionsLabel.length;
          if (focusRight) {
            rightLines.push(chalk.bgCyan.black(actionsLabel) + chalk.gray('─'.repeat(Math.max(0, rightWidth - headerLen - 1))));
          } else {
            rightLines.push(chalk.gray('─' + actionsLabel + '─'.repeat(Math.max(0, rightWidth - headerLen - 2))));
          }

          if (!selectedResult || selectedResult.actions.length === 0) {
            if (selectedResult?.status === 'running') {
              // Show current action progress for running test
              const { progress } = state;
              if (progress.currentAction) {
                rightLines.push(`${getSpinner()} ${chalk.yellow(progress.currentAction)}`);
                if (progress.waitingFor) {
                  rightLines.push(chalk.dim(`  └─ waiting for ${progress.waitingFor}...`));
                }
                if (progress.actionStartTime) {
                  const actionElapsed = Date.now() - progress.actionStartTime;
                  if (actionElapsed > 500) {
                    rightLines.push(chalk.gray(`  └─ ${formatTime(actionElapsed)} elapsed`));
                  }
                }
              } else {
                rightLines.push(`${getSpinner()} ${chalk.cyan('Running test...')}`);
              }
              rightLines.push('');
              rightLines.push(chalk.gray('Actions will appear here as they complete.'));
            } else if (selectedResult?.status === 'failed' && selectedResult?.error) {
              rightLines.push(chalk.red.bold('✗ Test Failed'));
              rightLines.push('');
              const formattedError = formatTestError(selectedResult.error, rightWidth - 2, 15);
              rightLines.push(...formattedError);
            } else if (selectedTestName) {
              rightLines.push(chalk.gray('No actions captured for this test.'));
              rightLines.push(chalk.gray('Run the test to see actions.'));
            } else {
              rightLines.push(chalk.gray('Select a test to see its actions.'));
              rightLines.push(chalk.gray('Use ↑ ↓ to navigate, Enter to run.'));
            }
          } else {
            const actions = selectedResult.actions;
            const scrollStart = Math.max(0, state.actionScrollIndex - Math.floor((maxLines - 4) / 4));

            for (let i = scrollStart; i < actions.length && rightLines.length < maxLines - 2; i++) {
              const action = actions[i];
              const isExpanded = state.expandedActionIndex === i;
              const isActionSelected = focusRight && state.actionScrollIndex === i;
              const actionIcon = action.error ? chalk.red('✗') : chalk.green('✓');
              const expandIcon = isExpanded ? '▼' : '▶';
              const actionName = (action.title || `${action.type}.${action.method}`).slice(0, rightWidth - 20);
              const duration = action.timing?.durationMs ? `${action.timing.durationMs}ms` : '';

              // Action header line
              let headerLine = `${expandIcon} ${actionIcon} ${actionName}`;
              if (duration) headerLine += chalk.gray(` ${duration}`);

              if (isActionSelected) {
                rightLines.push(chalk.inverse(padEndVisual(headerLine, rightWidth - 1)));
              } else {
                rightLines.push(headerLine);
              }

              // Expanded content
              if (isExpanded) {
                const hasNetwork = action.network?.requests?.length > 0;
                const hasConsole = action.console?.length > 0;
                const hasDiff = action.snapshot?.diff;
                const inNetworkMode = state.actionDetailFocus === 'network';

                // Network section - navigable when expanded
                if (hasNetwork) {
                  const networkFocused = inNetworkMode && focusRight;
                  const headerStyle = networkFocused ? chalk.bgCyan.black : chalk.cyan;

                  // Separate completed and pending requests
                  const allRequests = action.network.requests;
                  const completedRequests = allRequests.filter(r => r.status !== null);
                  const pendingRequests = allRequests.filter(r => r.status === null);

                  // Show completed count and pending count
                  let headerText = `  Network: ${completedRequests.length} completed`;
                  if (pendingRequests.length > 0) {
                    headerText += chalk.yellow(` +${pendingRequests.length} pending`);
                  }
                  rightLines.push(headerStyle(headerText));

                  // Show completed requests first, then a few pending
                  const requestsToShow = [
                    ...completedRequests.slice(0, 15),
                    ...(pendingRequests.length > 0 && completedRequests.length < 10 ? pendingRequests.slice(0, 5) : []),
                  ];

                  for (let ri = 0; ri < requestsToShow.length && rightLines.length < maxLines - 6; ri++) {
                    const req = requestsToShow[ri];
                    // Find original index for selection state
                    const originalIndex = allRequests.indexOf(req);
                    const isNetSelected = networkFocused && state.networkScrollIndex === originalIndex;
                    const isNetExpanded = state.expandedNetworkIndex === originalIndex;
                    const isPending = req.status === null;
                    const statusColor = isPending ? chalk.yellow :
                                        (req.status ?? 0) >= 400 ? chalk.red : chalk.green;
                    const statusText = isPending ? '...' : String(req.status);

                    // Request line - show duration for completed
                    const expandIcon = isNetExpanded ? '▼' : '▶';
                    const durationText = !isPending && req.durationMs ? chalk.gray(` ${req.durationMs.toFixed(0)}ms`) : '';
                    let reqLine = `    ${expandIcon} ${req.method} ${statusColor(statusText)}`;
                    const urlSpace = rightWidth - 22 - req.method.length - (durationText ? 8 : 0);
                    const urlDisplay = req.url.length > urlSpace ? req.url.slice(0, urlSpace - 3) + '...' : req.url;
                    reqLine += ` ${urlDisplay}${durationText}`;

                    if (isNetSelected) {
                      rightLines.push(chalk.inverse(padEndVisual(reqLine, rightWidth - 1)));
                    } else {
                      rightLines.push(isPending ? chalk.dim(reqLine) : reqLine);
                    }

                    // Expanded network request details - beautiful box format
                    if (isNetExpanded) {
                      const boxWidth = rightWidth - 6;
                      const borderColor = (req.status ?? 0) >= 400 ? chalk.red : chalk.green;
                      const dim = chalk.dim;

                      // Top border with method and URL
                      rightLines.push(borderColor(`    ┌${'─'.repeat(boxWidth - 2)}┐`));
                      const urlMaxLen = boxWidth - req.method.length - 5;
                      const urlDisplay2 = req.url.length > urlMaxLen ? req.url.slice(0, urlMaxLen - 1) + '…' : req.url;
                      const urlLine = chalk.bold(` ${req.method} `) + chalk.cyan(urlDisplay2);
                      rightLines.push(borderColor(`    │`) + padEndVisual(urlLine, boxWidth - 2) + borderColor(`│`));
                      rightLines.push(borderColor(`    ├${'─'.repeat(boxWidth - 2)}┤`));

                      // Status line
                      const statusEmoji = (req.status ?? 0) >= 400 ? '✗' : '✓';
                      const statusLine = ` ${statusEmoji} ${statusText} ${req.statusText || ''} │ ${req.durationMs?.toFixed(0) || '?'}ms │ ${req.resourceType || 'fetch'}`;
                      rightLines.push(borderColor(`    │`) + padEndVisual(statusLine, boxWidth - 2) + borderColor(`│`));

                      // Helper to render a line inside the box with proper padding
                      const boxLine = (content: string) => {
                        return borderColor(`    │`) + padEndVisual(` ${content}`, boxWidth - 2) + borderColor(`│`);
                      };

                      const bodyMaxWidth = boxWidth - 6;

                      // Request body if present
                      if (req.requestPostData) {
                        rightLines.push(borderColor(`    ├${'─'.repeat(boxWidth - 2)}┤`));
                        rightLines.push(boxLine(chalk.yellow.bold('REQUEST')));

                        const postLines = formatJsonPreview(req.requestPostData, 6, bodyMaxWidth);
                        for (const line of postLines) {
                          rightLines.push(boxLine(line));
                        }
                      }

                      // Response body (scrollable)
                      rightLines.push(borderColor(`    ├${'─'.repeat(boxWidth - 2)}┤`));
                      if (req.responseBody) {
                        const allBodyLines = formatJsonFull(req.responseBody, bodyMaxWidth);
                        const totalBodyLines = allBodyLines.length;
                        const needsScroll = totalBodyLines > RESPONSE_VISIBLE_LINES;
                        const scrollOffset = needsScroll
                          ? Math.min(state.responseScrollOffset, Math.max(0, totalBodyLines - RESPONSE_VISIBLE_LINES))
                          : 0;
                        const visibleCount = Math.min(RESPONSE_VISIBLE_LINES, totalBodyLines);
                        const visibleLines = allBodyLines.slice(scrollOffset, scrollOffset + visibleCount);

                        const scrollInfo = needsScroll
                          ? chalk.dim(` ${scrollOffset + 1}-${scrollOffset + visibleLines.length}/${totalBodyLines}`)
                          : '';
                        const scrollHint = needsScroll ? chalk.dim(' ↕') : '';
                        rightLines.push(boxLine(chalk.green.bold('RESPONSE') + scrollInfo + scrollHint));

                        if (scrollOffset > 0) {
                          rightLines.push(boxLine(chalk.dim(`  ▲ ${scrollOffset} more lines`)));
                        }
                        for (const line of visibleLines) {
                          rightLines.push(boxLine(line));
                        }
                        const remaining = totalBodyLines - scrollOffset - visibleLines.length;
                        if (remaining > 0) {
                          rightLines.push(boxLine(chalk.dim(`  ▼ ${remaining} more lines`)));
                        }
                      } else if (isPending) {
                        rightLines.push(boxLine(chalk.yellow('Waiting for response...')));
                      } else {
                        rightLines.push(boxLine(chalk.dim('(no body)')));
                      }

                      // Bottom border
                      rightLines.push(borderColor(`    └${'─'.repeat(boxWidth - 2)}┘`));
                    }
                  }

                  // Summary of hidden requests
                  const hiddenCompleted = Math.max(0, completedRequests.length - 15);
                  const hiddenPending = pendingRequests.length - (completedRequests.length < 10 ? Math.min(5, pendingRequests.length) : 0);
                  if (hiddenCompleted > 0 || hiddenPending > 0) {
                    let hiddenText = '    ';
                    if (hiddenCompleted > 0) hiddenText += `+${hiddenCompleted} more`;
                    if (hiddenCompleted > 0 && hiddenPending > 0) hiddenText += ', ';
                    if (hiddenPending > 0) hiddenText += chalk.yellow(`+${hiddenPending} pending`);
                    rightLines.push(chalk.gray(hiddenText));
                  }
                } else {
                  rightLines.push(chalk.dim('  Network: ') + chalk.dim.italic('none'));
                }

                // Console section
                if (hasConsole) {
                  const errCount = action.console.filter(c => c.type === 'error').length;
                  const warnCount = action.console.filter(c => c.type === 'warn').length;
                  let consoleInfo = `  Console (${action.console.length}):`;
                  if (errCount > 0) consoleInfo += chalk.red(` ${errCount} err`);
                  if (warnCount > 0) consoleInfo += chalk.yellow(` ${warnCount} warn`);
                  rightLines.push(chalk.cyan(consoleInfo));
                  for (const msg of action.console.slice(0, 3)) {
                    const color = msg.type === 'error' ? chalk.red : msg.type === 'warn' ? chalk.yellow : chalk.gray;
                    rightLines.push(`    ${color(msg.text.slice(0, rightWidth - 6))}`);
                  }
                } else {
                  rightLines.push(chalk.dim('  Console: ') + chalk.dim.italic('none'));
                }

                // DOM changes section
                if (hasDiff && action.snapshot.diff) {
                  rightLines.push(chalk.cyan(`  DOM: ${action.snapshot.diff.summary}`));
                  if (action.snapshot.diff.added.length > 0) {
                    rightLines.push(chalk.green(`    + ${action.snapshot.diff.added.slice(0, 2).join(', ')}`));
                  }
                  if (action.snapshot.diff.removed.length > 0) {
                    rightLines.push(chalk.red(`    - ${action.snapshot.diff.removed.slice(0, 2).join(', ')}`));
                  }
                } else {
                  rightLines.push(chalk.dim('  DOM: ') + chalk.dim.italic('no changes'));
                }

                rightLines.push(''); // spacer after expanded
              }
            }

            // Show current running action at end of list if test is still running
            if (selectedResult.status === 'running' && state.progress.currentAction) {
              rightLines.push(''); // spacer
              rightLines.push(`${getSpinner()} ${chalk.yellow(state.progress.currentAction)}`);
              if (state.progress.waitingFor) {
                rightLines.push(chalk.dim(`  └─ waiting for ${state.progress.waitingFor}...`));
              }
              if (state.progress.actionStartTime) {
                const actionElapsed = Date.now() - state.progress.actionStartTime;
                if (actionElapsed > 500) {
                  rightLines.push(chalk.gray(`  └─ ${formatTime(actionElapsed)} elapsed`));
                }
              }
            }

            // Show error at end of actions list for failed tests
            if (selectedResult.status === 'failed' && selectedResult.error) {
              rightLines.push(''); // spacer
              rightLines.push(chalk.red.bold('✗ Test Failed'));
              const formattedError = formatTestError(selectedResult.error, rightWidth - 2, 10);
              rightLines.push(...formattedError);
            }
          }

          // Combine panels side by side
          const maxPanelLines = Math.max(leftLines.length, rightLines.length, maxLines - 2);
          for (let i = 0; i < maxPanelLines && lines.length < maxLines; i++) {
            const leftContent = leftLines[i] || '';
            const left = padEndVisual(leftContent, leftWidth);
            const right = rightLines[i] || '';
            lines.push(`${left} │ ${right}`);
          }

          // Results summary at bottom
          if (state.testResults.length > 0 && lines.length < maxLines) {
            const passed = state.testResults.filter(r => r.status === 'passed').length;
            const failed = state.testResults.filter(r => r.status === 'failed').length;
            const running = state.testResults.filter(r => r.status === 'running').length;
            let summary = chalk.bold('Results: ');
            if (running > 0) summary += chalk.cyan(`${running} running, `);
            summary += chalk.green(`${passed} passed`) + ', ' + chalk.red(`${failed} failed`);
            lines.push(summary);
          }
        }
        break;
      }
      case 'steps': {
        const stepsLabel = state.mode === 'run' ? 'actions captured' : 'steps';
        if (state.steps.length === 0) {
          const hint = state.mode === 'run' ? 'Run tests to see captured actions.' : 'Enter a task and press Enter.';
          lines.push(chalk.gray(`No ${stepsLabel} yet. ${hint}`));
        } else {
          for (const step of state.steps.slice(-maxLines)) {
            const icon = step.status === 'running' ? chalk.cyan('●') :
                         step.status === 'done' ? chalk.green('✓') :
                         step.status === 'error' ? chalk.red('✗') : chalk.gray('○');
            const color = step.status === 'error' ? chalk.red :
                          step.status === 'done' ? chalk.green :
                          step.status === 'running' ? chalk.cyan : chalk.white;
            lines.push(`${icon} ${color(step.action)}`);
            if (step.details) {
              lines.push(chalk.gray(`  └─ ${step.details.slice(0, contentWidth - 6)}`));
            }
          }
        }
        break;
      }
      case 'pom':
      case 'business':
      case 'test': {
        const code = state.activeTab === 'pom' ? state.pomCode :
                     state.activeTab === 'business' ? state.businessCode : state.testCode;
        const title = state.activeTab === 'pom' ? 'Page Object Model' :
                      state.activeTab === 'business' ? 'Business Layer' : 'Test Specification';
        if (!code) {
          lines.push(chalk.gray(`No ${title.toLowerCase()} generated yet.`));
        } else {
          lines.push(chalk.cyan.bold(title) + chalk.gray(` (${code.split('\n').length} lines)`));
          const codeLines = code.split('\n').slice(0, maxLines - 2);
          for (let i = 0; i < codeLines.length; i++) {
            lines.push(chalk.gray(`${String(i + 1).padStart(3)} │ `) + codeLines[i]);
          }
          if (code.split('\n').length > maxLines - 2) {
            lines.push(chalk.gray(`    ... ${code.split('\n').length - (maxLines - 2)} more lines`));
          }
        }
        break;
      }
      case 'network': {
        if (state.networkRequests.length === 0) {
          lines.push(chalk.gray('No network requests captured yet.'));
        } else {
          lines.push(chalk.cyan.bold('Network Requests') + chalk.gray(` (${state.networkRequests.length})`));
          for (const req of state.networkRequests.slice(-maxLines + 1)) {
            const methodColor = req.method === 'GET' ? chalk.green : chalk.yellow;
            const statusColor = !req.status ? chalk.gray :
                                req.status < 300 ? chalk.green :
                                req.status < 400 ? chalk.yellow : chalk.red;
            const duration = req.durationMs ? chalk.gray(` ${req.durationMs}ms`) : '';
            const maxUrlLen = contentWidth - 18 - (req.durationMs ? 8 : 0);
            lines.push(`${methodColor(req.method.padEnd(6))} ${statusColor(String(req.status || '...').padEnd(4))} ${req.url.slice(0, maxUrlLen)}${duration}`);
          }
        }
        break;
      }
      case 'console': {
        if (state.consoleMessages.length === 0) {
          lines.push(chalk.gray('No console messages captured yet.'));
        } else {
          lines.push(chalk.cyan.bold('Console Messages') + chalk.gray(` (${state.consoleMessages.length})`));
          for (const msg of state.consoleMessages.slice(-maxLines + 1)) {
            const color = msg.type === 'error' ? chalk.red :
                          msg.type === 'warn' ? chalk.yellow : chalk.gray;
            lines.push(color(`[${msg.type.toUpperCase().padEnd(5)}] ${msg.text.slice(0, contentWidth - 10)}`));
          }
        }
        break;
      }
    }

    // Pad to fixed height
    while (lines.length < maxLines) {
      lines.push('');
    }

    return lines.slice(0, maxLines).join('\n');
  };

  // Initial render
  render();

  // Subscribe to store changes
  store.subscribe(render);

  // Re-render on terminal resize
  process.stdout.on('resize', render);

  // Progress update interval for smooth countdown animation
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  const startProgressInterval = () => {
    if (progressInterval) return;
    progressInterval = setInterval(() => {
      if (store.getState().isRunning) {
        render();
      } else {
        // Stop interval when not running
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
      }
    }, 500); // Update every 500ms for smooth countdown
  };

  // Watch for running state changes
  store.subscribe(() => {
    const state = store.getState();
    if (state.isRunning && !progressInterval) {
      startProgressInterval();
    }
  });

  // Handle keyboard input
  process.stdin.on('keypress', async (str, key) => {
    const state = store.getState();
    const TABS = state.mode === 'run' ? RUN_TABS : WRITE_TABS;

    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }

    // AI response actions (Tab=Apply, Ctrl+S=Save when response is showing)
    if (state.mode === 'run' && state.aiResponse && !state.aiLoading) {
      if (key.name === 'tab') {
        const code = extractCodeFromResponse(state.aiResponse);
        if (code) {
          const existingCode = state.testCode;
          const newCode = existingCode
            ? existingCode + '\n\n// AI Generated:\n' + code
            : '// AI Generated:\n' + code;
          store.setTestCode(newCode);
          store.setAiResponse('');
          store.setMode('write');
          store.setActiveTab('test');
          store.setStatus('Code applied to Test tab');
        } else {
          store.setStatus('No code block found in response');
        }
        return;
      }
      if (key.ctrl && key.name === 's') {
        const code = extractCodeFromResponse(state.aiResponse);
        if (!code) { store.setStatus('No code block found in AI response'); return; }
        let selectedFile = '', selectedTestName = '', selectedTestLine = 0, findIdx = 0;
        for (const file of state.testFiles) {
          if (findIdx === state.testSelectionIndex) { selectedFile = file.path; break; }
          findIdx++;
          for (const test of file.tests) {
            if (findIdx === state.testSelectionIndex) {
              selectedFile = file.path; selectedTestName = test.title; selectedTestLine = test.line; break;
            }
            findIdx++;
          }
          if (selectedFile) break;
        }
        if (!selectedFile) { store.setStatus('No test file selected'); return; }
        const isCompleteTest = code.trim().match(/^test\s*\(/);
        if (isCompleteTest && selectedTestLine > 0) {
          const result = replaceTestInFile(selectedFile, selectedTestLine, code);
          if (result.success) {
            store.setAiResponse(''); aiInputBuffer = '';
            store.setStatus(`✓ Test "${selectedTestName}" updated in ${selectedFile}`);
          } else { store.setStatus(`Error: ${result.error}`); }
        } else {
          try {
            const existingContent = fs.readFileSync(selectedFile, 'utf-8');
            const wrappedCode = `\ntest('${selectedTestName ? `AI: ${selectedTestName}` : 'AI generated test'}', async ({ page }) => {\n${code.split('\n').map(l => '  ' + l).join('\n')}\n});\n`;
            fs.writeFileSync(selectedFile, existingContent + wrappedCode);
            store.setAiResponse(''); aiInputBuffer = '';
            store.setStatus(`✓ New test added to ${selectedFile}`);
          } catch (err: any) { store.setStatus(`Error: ${err.message}`); }
        }
        return;
      }
    }

    // Tab switching with F1-F6 (works anytime)
    const tab = TABS.find(t => t.fkey === key.name);
    if (tab) {
      store.setActiveTab(tab.id);
      return;
    }

    // Mode switching with F7
    if (key.name === 'f7' && !state.isRunning) {
      const newMode: AppMode = state.mode === 'write' ? 'run' : 'write';
      store.setMode(newMode);
      if (newMode === 'run') {
        // Discover tests when entering run mode
        store.setStatus('Discovering tests...');
        render();
        const cwd = process.cwd();
        const testFiles = await discoverTests(cwd);
        store.setTestFiles(testFiles);
        const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
        store.setStatus(`Found ${testFiles.length} files with ${totalTests} tests`);
      }
      return;
    }

    // Refresh tests with F8 (run mode only)
    if (key.name === 'f8' && state.mode === 'run' && !state.isRunning) {
      store.setStatus('Discovering tests...');
      render();
      const cwd = process.cwd();
      const testFiles = await discoverTests(cwd);
      store.setTestFiles(testFiles);
      const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
      store.setStatus(`Found ${testFiles.length} files with ${totalTests} tests`);
      return;
    }

    // Model switching with F9 (write mode only)
    if (key.name === 'f9' && !state.isRunning && state.mode === 'write') {
      const models: ModelId[] = ['haiku', 'opus'];
      const idx = models.indexOf(state.selectedModel);
      store.setSelectedModel(models[(idx + 1) % models.length]);
      return;
    }

    // Base URL editing with F10
    if (key.name === 'f10' && !state.isRunning) {
      if (inputMode === 'task') {
        inputMode = 'baseURL';
        inputBuffer = state.baseURL;
        render();
      }
      return;
    }

    // Full reset with F12 (clears everything including generated code)
    if (key.name === 'f12' && !state.isRunning) {
      store.fullReset();
      inputBuffer = '';
      inputMode = 'task';
      store.setTestSelectionIndex(0);
      render();
      return;
    }

    // Quit with Escape (or clear AI input/response, cancel baseURL, stop tests)
    if (key.name === 'escape') {
      if (state.isRunning) {
        store.requestStop();
        killCurrentTest();
        store.setStatus('Stopping...');
        return;
      }
      // Clear AI input buffer first
      if (aiInputBuffer.length > 0) {
        aiInputBuffer = '';
        render();
        return;
      }
      // Clear AI response next
      if (state.aiResponse) {
        store.setAiResponse('');
        return;
      }
      if (inputMode === 'baseURL') {
        inputMode = 'task';
        inputBuffer = '';
        render();
        return;
      }
      cleanup();
      process.exit(0);
    }

    // Run mode controls
    if (state.mode === 'run' && !state.isRunning) {
      // AI input: Enter sends prompt when buffer has text
      if (key.name === 'return' && aiInputBuffer.trim()) {
        const prompt = aiInputBuffer.trim();
        aiInputBuffer = '';
        store.setAiLoading(true);
        store.setAiResponse('');
        render();
        try {
          const context = getCurrentAiContext();
          const response = await getAiSuggestion(prompt, context);
          store.setAiResponse(response);
        } catch (error: any) {
          store.setAiResponse(`Error: ${error.message}`);
        } finally {
          store.setAiLoading(false);
        }
        return;
      }

      // AI input: Backspace deletes from buffer
      if (key.name === 'backspace' && aiInputBuffer.length > 0) {
        aiInputBuffer = aiInputBuffer.slice(0, -1);
        render();
        return;
      }

      // AI input: Space adds space when buffer has text (otherwise falls through to toggle)
      if (str === ' ' && aiInputBuffer.length > 0) {
        aiInputBuffer += ' ';
        render();
        return;
      }

      const totalItems = state.testFiles.reduce((sum, f) => sum + 1 + f.tests.length, 0);

      // Get selected test's actions count
      let selectedResult: any = null;
      let currentIdx = 0;
      for (const file of state.testFiles) {
        currentIdx++; // file header
        for (const test of file.tests) {
          if (currentIdx === state.testSelectionIndex) {
            selectedResult = state.testResults.find(r => r.testKey === `${file.path}:${test.line}`);
            break;
          }
          currentIdx++;
        }
        if (selectedResult) break;
      }
      const actionsCount = selectedResult?.actions?.length || 0;

      // Panel switching with Tab or Left/Right
      if (key.name === 'tab' || (key.name === 'right' && state.panelFocus === 'tests') || (key.name === 'left' && state.panelFocus === 'actions')) {
        const newFocus = state.panelFocus === 'tests' ? 'actions' : 'tests';
        store.setPanelFocus(newFocus);
        if (newFocus === 'actions') {
          store.setActionScrollIndex(0);
          store.setExpandedActionIndex(-1);
        }
        return;
      }

      // Navigation within panels
      if (state.panelFocus === 'tests') {
        if (key.name === 'up') {
          store.setTestSelectionIndex(Math.max(0, state.testSelectionIndex - 1));
          store.setActionScrollIndex(0);
          store.setExpandedActionIndex(-1);
          return;
        }
        if (key.name === 'down') {
          store.setTestSelectionIndex(Math.min(totalItems - 1, state.testSelectionIndex + 1));
          store.setActionScrollIndex(0);
          store.setExpandedActionIndex(-1);
          return;
        }

        // Toggle selection with space
        if (str === ' ') {
          let currentIndex = 0;
          for (const file of state.testFiles) {
            if (currentIndex === state.testSelectionIndex) {
              const allSelected = file.tests.every(t => state.selectedTests[`${file.path}:${t.line}`]);
              if (allSelected) {
                for (const test of file.tests) {
                  store.toggleTestSelection(`${file.path}:${test.line}`);
                }
              } else {
                for (const test of file.tests) {
                  const testKey = `${file.path}:${test.line}`;
                  if (!state.selectedTests[testKey]) {
                    store.toggleTestSelection(testKey);
                  }
                }
              }
              return;
            }
            currentIndex++;
            for (const test of file.tests) {
              if (currentIndex === state.testSelectionIndex) {
                store.toggleTestSelection(`${file.path}:${test.line}`);
                return;
              }
              currentIndex++;
            }
          }
          return;
        }

        // Select all with Ctrl+A
        if (key.ctrl && key.name === 'a') {
          const totalTests = state.testFiles.reduce((sum, f) => sum + f.tests.length, 0);
          const selectedCount = Object.keys(state.selectedTests).length;
          if (selectedCount === totalTests) {
            store.clearTestSelection();
          } else {
            store.selectAllTests();
          }
          return;
        }

        // Run tests with Enter (when in tests panel)
        if (key.name === 'return') {
          const cwd = process.cwd();
          store.setStatus('Starting tests...');
          try {
            await runSelectedTests(cwd);
          } catch (error: any) {
            store.setStatus(`Error: ${error.message}`);
            store.setIsRunning(false);
          }
          return;
        }
      } else {
        // Actions panel navigation
        const isActionExpanded = state.expandedActionIndex === state.actionScrollIndex;
        const inNetworkMode = state.actionDetailFocus === 'network';
        const networkCount = selectedResult?.actions?.[state.actionScrollIndex]?.network?.requests?.length || 0;

        if (inNetworkMode && isActionExpanded && networkCount > 0) {
          const isNetworkExpanded = state.expandedNetworkIndex >= 0;

          if (isNetworkExpanded) {
            // Response body scrolling mode
            if (key.name === 'up') {
              if (state.responseScrollOffset > 0) {
                store.setResponseScrollOffset(state.responseScrollOffset - 1);
              }
              return;
            }
            if (key.name === 'down') {
              store.setResponseScrollOffset(state.responseScrollOffset + 1);
              return;
            }
            // Collapse with enter/space
            if (key.name === 'return' || str === ' ') {
              store.toggleExpandedNetwork(state.networkScrollIndex);
              return;
            }
            // Escape: collapse expanded request
            if (key.name === 'escape') {
              store.setExpandedNetworkIndex(-1);
              return;
            }
          } else {
            // Network navigation mode
            if (key.name === 'up') {
              if (state.networkScrollIndex > 0) {
                store.setNetworkScrollIndex(state.networkScrollIndex - 1);
              } else {
                store.setActionDetailFocus('actions');
              }
              return;
            }
            if (key.name === 'down') {
              store.setNetworkScrollIndex(Math.min(networkCount - 1, state.networkScrollIndex + 1));
              return;
            }
            // Expand/collapse network request details
            if (key.name === 'return' || str === ' ') {
              store.toggleExpandedNetwork(state.networkScrollIndex);
              return;
            }
            // Escape to go back to action level
            if (key.name === 'escape') {
              store.setActionDetailFocus('actions');
              store.setExpandedNetworkIndex(-1);
              return;
            }
          }
        } else {
          // Action level navigation
          if (key.name === 'up') {
            store.setActionScrollIndex(Math.max(0, state.actionScrollIndex - 1));
            store.resetNetworkDetail();
            return;
          }
          if (key.name === 'down') {
            if (isActionExpanded && networkCount > 0) {
              // Enter network mode
              store.setActionDetailFocus('network');
              store.setNetworkScrollIndex(0);
            } else {
              store.setActionScrollIndex(Math.min(actionsCount - 1, state.actionScrollIndex + 1));
              store.resetNetworkDetail();
            }
            return;
          }

          // Expand/collapse action with Enter or Space
          if (key.name === 'return' || str === ' ') {
            store.toggleExpandedAction(state.actionScrollIndex);
            store.resetNetworkDetail();
            return;
          }
        }
      }

      // Catch-all: printable chars go to AI input buffer
      if (str && str.length === 1 && !key.ctrl && !key.meta) {
        aiInputBuffer += str;
        render();
        return;
      }
    }

    // Write mode controls
    if (state.mode === 'write' && !state.isRunning) {
      // Text input
      if (key.name === 'return') {
        if (inputMode === 'baseURL') {
          const newBaseURL = inputBuffer.trim();
          if (newBaseURL) {
            store.setBaseURL(newBaseURL);
            // Save to playwright.config.ts
            const savedPath = saveBaseURL(newBaseURL);
            store.setConfigPath(savedPath);
            store.setStatus(`Base URL saved to ${savedPath}`);
          }
          inputMode = 'task';
          inputBuffer = '';
          render();
          return;
        }
        if (inputBuffer.trim()) {
          const task = inputBuffer;
          inputBuffer = '';
          // Reset state for new task (keeps generated code for reference)
          store.resetForNewTask();
          await onSubmit(task, getModelId(state.selectedModel), state.baseURL);
        }
      } else if (key.name === 'backspace') {
        inputBuffer = inputBuffer.slice(0, -1);
        render();
      } else if (str && !key.ctrl && !key.meta) {
        inputBuffer += str;
        render();
      }
    }
  });

  const cleanup = () => {
    // Clear progress interval
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    logUpdate.done();
    process.stdout.write('\x1B[?25h'); // Show cursor
    process.stdout.write('\x1B[?1049l'); // Exit alternate screen buffer
    process.stdout.off('resize', render);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };

  return { render, cleanup };
}

function getModelId(model: ModelId): string {
  switch (model) {
    case 'haiku': return 'claude-haiku-4-5-20251001';
    case 'opus': return 'claude-opus-4-5-20251101';
  }
}
