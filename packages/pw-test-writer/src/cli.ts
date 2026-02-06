#!/usr/bin/env node
import { startUI } from './ui/index.js';
import { runAgent } from './agent/loop.js';

startUI(async (task, model, baseURL) => {
  await runAgent(task, { model, baseURL: baseURL || undefined });
});
