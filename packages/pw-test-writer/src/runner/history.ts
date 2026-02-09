import * as fs from 'fs';
import * as path from 'path';

export interface HistoryEntry {
  ts: number;   // unix timestamp (seconds)
  s: string;    // status: 'passed' | 'failed'
  d: number;    // duration ms
}

export type TestHistory = Record<string, HistoryEntry[]>;

const DIR_NAME = '.pw-test-writer';
const FILE_NAME = 'history.json';
const MAX_ENTRIES = 20;

function historyPath(cwd: string): string {
  return path.join(cwd, DIR_NAME, FILE_NAME);
}

export function loadHistory(cwd: string): TestHistory {
  try {
    const data = fs.readFileSync(historyPath(cwd), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveTestResult(
  cwd: string,
  relPath: string,
  line: number,
  status: string,
  duration: number,
): void {
  const key = `${relPath}:${line}`;
  const history = loadHistory(cwd);
  const entries = history[key] || [];

  entries.unshift({
    ts: Math.floor(Date.now() / 1000),
    s: status,
    d: duration,
  });

  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  history[key] = entries;

  const dir = path.join(cwd, DIR_NAME);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Atomic write via temp file
  const tmp = historyPath(cwd) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(history, null, 2));
  fs.renameSync(tmp, historyPath(cwd));

  ensureGitignore(cwd);
}

export function ensureGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '.pw-test-writer/';

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (content.includes(entry)) return;
      const newline = content.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${newline}${entry}\n`);
    } else {
      fs.writeFileSync(gitignorePath, `${entry}\n`);
    }
  } catch {
    // Best-effort — don't break the app if gitignore can't be updated
  }
}
