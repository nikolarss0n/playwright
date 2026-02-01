import chalk from 'chalk';
import logUpdate from 'log-update';
import * as readline from 'readline';
import { store, TabId, ModelId } from './store.js';
import { parsePlaywrightConfig, saveBaseURL } from '../config/playwright.js';

type InputMode = 'task' | 'baseURL';

const TABS: { id: TabId; label: string; fkey: string }[] = [
  { id: 'steps', label: 'Steps', fkey: 'f1' },
  { id: 'pom', label: 'POM', fkey: 'f2' },
  { id: 'business', label: 'Business', fkey: 'f3' },
  { id: 'test', label: 'Test', fkey: 'f4' },
  { id: 'network', label: 'Network', fkey: 'f5' },
  { id: 'console', label: 'Console', fkey: 'f6' },
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
      const keyLabel = tab.fkey.toUpperCase();
      const label = `${keyLabel} ${tab.label}${badge}`;
      if (isActive) {
        menuBar += chalk.bgCyan.black(` ${label} `) + ' ';
      } else {
        menuBar += chalk.gray(`(${label})`) + ' ';
      }
    }
    // Add other F-key options as pills
    menuBar += chalk.bgBlue.white(` F9 ${model.label} `) + ' ';
    menuBar += chalk.bgGreen.black(` F10 URL `) + ' ';
    menuBar += chalk.bgYellow.black(` F12 Reset `) + ' ';
    menuBar += chalk.bgRed.white(` Esc Quit `) + ' ';
    output += menuBar + '\n';
    output += chalk.gray('─'.repeat(width - 1)) + '\n';

    // Header with title and base URL
    output += chalk.magenta.bold('🎭 Playwright Test Writer');
    if (state.baseURL) {
      output += chalk.gray(' │ ') + chalk.green(state.baseURL);
      if (state.configPath) {
        output += chalk.gray(' [config]');
      }
    }
    output += '\n';

    // Input field
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
    output += chalk.gray('─'.repeat(width - 1)) + '\n';

    // Content - reserve lines for menu (2), header (2-3), input (2), status (2)
    const contentHeight = Math.max(5, height - 10);
    output += renderContent(state, width, contentHeight) + '\n';

    output += chalk.gray('─'.repeat(width - 1)) + '\n';

    // Status bar
    const statusIcon = state.isRunning ? chalk.cyan('●') : chalk.green('○');
    output += `${statusIcon} ${state.status}`;

    logUpdate(output);
  };

  const renderContent = (state: ReturnType<typeof store.getState>, termWidth: number, maxLines: number): string => {
    const lines: string[] = [];
    const contentWidth = termWidth - 2;

    switch (state.activeTab) {
      case 'steps': {
        if (state.steps.length === 0) {
          lines.push(chalk.gray('No steps yet. Enter a task and press Enter.'));
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
            lines.push(`${methodColor(req.method.padEnd(6))} ${statusColor(String(req.status || '...').padEnd(4))} ${req.url.slice(0, contentWidth - 12)}`);
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

  // Handle keyboard input
  process.stdin.on('keypress', async (str, key) => {
    const state = store.getState();

    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }

    // Tab switching with F1-F6 (works anytime)
    const tab = TABS.find(t => t.fkey === key.name);
    if (tab) {
      store.setActiveTab(tab.id);
      return;
    }

    // Model switching with F9 (works anytime when not running)
    if (key.name === 'f9' && !state.isRunning) {
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
      render();
      return;
    }

    // Quit with Escape (or cancel baseURL input)
    if (key.name === 'escape') {
      if (inputMode === 'baseURL') {
        inputMode = 'task';
        inputBuffer = '';
        render();
        return;
      }
      cleanup();
      process.exit(0);
    }

    if (!state.isRunning) {
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
