import React from 'react';
import * as fs from 'fs';
import { withFullScreen } from 'fullscreen-ink';
import { App } from './components/App.js';
import { store } from './store.js';
import { parsePlaywrightConfig } from '../config/playwright.js';

const LOG_FILE = '/tmp/pw-test-writer.log';

export function logError(context: string, err: unknown) {
  const msg = `[${new Date().toISOString()}] ${context}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`;
  try { fs.appendFileSync(LOG_FILE, msg); } catch {}
}

export function startUI(onSubmit: (task: string, model: string, baseURL: string) => Promise<void>) {
  // Load Playwright config on startup
  const pwConfig = parsePlaywrightConfig();
  if (pwConfig.baseURL) store.setBaseURL(pwConfig.baseURL);
  if (pwConfig.configPath) store.setConfigPath(pwConfig.configPath);

  // Catch unhandled errors so we can see them after exit
  process.on('uncaughtException', (err) => logError('uncaughtException', err));
  process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

  const { instance, start } = withFullScreen(<App onSubmit={onSubmit} />);

  start().catch((err: Error) => {
    logError('start', err);
    process.exit(1);
  });

  instance.waitUntilExit().then(() => {
    process.exit(0);
  });
}
