import React from 'react';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { withFullScreen } from 'fullscreen-ink';
import { App } from './components/App.js';
import { store } from './store.js';
import { parsePlaywrightConfig } from '../config/playwright.js';
import { killCurrentTest } from '../runner/testRunner.js';
import { stopCaptureServer } from '../runner/captureServer.js';

const LOG_FILE = '/tmp/pw-test-writer.log';

export function logError(context: string, err: unknown) {
  const msg = `[${new Date().toISOString()}] ${context}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`;
  try { fs.appendFileSync(LOG_FILE, msg); } catch {}
}

function cleanup() {
  try { killCurrentTest(); } catch {}
  try { stopCaptureServer(); } catch {}
}

function validateStartup(): string[] {
  const warnings: string[] = [];

  // Check for Anthropic API key
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY ||
    ['.anthropic/api_key', '.config/anthropic/api_key'].some(f => {
      try { return fs.existsSync(`${process.env.HOME}/${f}`); } catch { return false; }
    }) ||
    (() => { try { const env = fs.readFileSync('.env', 'utf-8'); return env.includes('ANTHROPIC_API_KEY'); } catch { return false; } })();

  if (!hasApiKey) {
    warnings.push('No ANTHROPIC_API_KEY found — AI features will not work. Set via: export ANTHROPIC_API_KEY=your-key');
  }

  // Check for Playwright installation
  try {
    execSync('npx playwright --version', { stdio: 'pipe', timeout: 10000 });
  } catch {
    warnings.push('Playwright not found — test discovery and execution will fail. Run: npm init playwright@latest');
  }

  return warnings;
}

export function startUI(onSubmit: (task: string, model: string, baseURL: string) => Promise<void>) {
  // Load Playwright config on startup
  const pwConfig = parsePlaywrightConfig();
  if (pwConfig.baseURL) store.setBaseURL(pwConfig.baseURL);
  if (pwConfig.configPath) store.setConfigPath(pwConfig.configPath);

  // Validate environment and show warnings
  const warnings = validateStartup();
  if (warnings.length > 0) {
    store.setStatus(warnings[0]);
  }

  // Catch unhandled errors so we can see them after exit
  process.on('uncaughtException', (err) => logError('uncaughtException', err));
  process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

  // Clean up child processes on exit signals
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('exit', cleanup);

  const { instance, start } = withFullScreen(<App onSubmit={onSubmit} />);

  start().catch((err: Error) => {
    logError('start', err);
    cleanup();
    process.exit(1);
  });

  instance.waitUntilExit().then(() => {
    cleanup();
    process.exit(0);
  });
}
