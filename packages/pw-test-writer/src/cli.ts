#!/usr/bin/env node
import { startUI } from './ui/live.js';
import { runAgent } from './agent/loop.js';

console.clear();
startUI(async (task, model, baseURL) => {
  await runAgent(task, { model, baseURL: baseURL || undefined });
});
