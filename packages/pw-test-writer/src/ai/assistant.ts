/**
 * AI Assistant for test writing suggestions
 */

import Anthropic from '@anthropic-ai/sdk';
import { store } from '../ui/store.js';
import type { ActionCapture, NetworkRequestCapture } from 'playwright-core/lib/server/actionCaptureTypes';
import type { TestResult } from '../ui/store.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Lazily create client only when needed
let client: Anthropic | null = null;

function findApiKey(): string | undefined {
  // 1. Check environment variable first
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // 2. Try common locations for API keys
  const possibleFiles = [
    path.join(os.homedir(), '.anthropic', 'api_key'),
    path.join(os.homedir(), '.config', 'anthropic', 'api_key'),
    path.join(os.homedir(), '.interview-master-keys'),
    path.join(process.cwd(), '.env'),
  ];

  for (const filePath of possibleFiles) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Try to find ANTHROPIC_API_KEY=... pattern
        const match = content.match(/ANTHROPIC_API_KEY=([^\s\n]+)/);
        if (match) {
          return match[1].trim();
        }
        // If file contains just the key (no = pattern)
        const trimmed = content.trim();
        if (trimmed.startsWith('sk-ant-')) {
          return trimmed;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return undefined;
}

function getClient(): Anthropic {
  if (!client) {
    const apiKey = findApiKey();
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY not found.\n\n' +
        'Options:\n' +
        '1. export ANTHROPIC_API_KEY=your-key\n' +
        '2. Add to ~/.anthropic/api_key\n' +
        '3. Add ANTHROPIC_API_KEY=... to .env file'
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface AiContext {
  testName: string;
  testFilePath?: string;
  testSourceCode?: string;
  testLine?: number;
  action?: ActionCapture;
  networkRequest?: NetworkRequestCapture;
  allActions?: ActionCapture[];
  testResult?: TestResult;
  history?: Array<{ ts: number; s: string; d: number }>;
}

/**
 * Extract code blocks from AI response
 */
export function extractCodeFromResponse(response: string): string | null {
  // Match ```typescript or ```js or just ``` code blocks
  const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/g;
  const matches: string[] = [];

  let match;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    matches.push(match[1].trim());
  }

  if (matches.length === 0) return null;

  // Join all code blocks
  return matches.join('\n\n');
}

/**
 * Replace a test in a file with new code
 */
const TEST_START_PATTERN = /^\s*test\s*(\.\w+\s*)?\(/;

export function replaceTestInFile(filePath: string, testLine: number, newTestCode: string): { success: boolean; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the test start (matches test(, test.skip(, test.only(, test.fixme(, etc.)
    let startLine = testLine - 1; // Convert to 0-indexed
    while (startLine > 0 && !TEST_START_PATTERN.test(lines[startLine])) {
      startLine--;
    }

    if (startLine < 0 || !TEST_START_PATTERN.test(lines[startLine])) {
      return { success: false, error: 'Could not find test start' };
    }

    // Find the matching closing bracket (string/comment-aware)
    let braceCount = 0;
    let endLine = startLine;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      let j = 0;
      while (j < line.length) {
        const ch = line[j];
        // Skip single-line comments
        if (ch === '/' && line[j + 1] === '/') break;
        // Skip string literals
        if (ch === '\'' || ch === '"' || ch === '`') {
          const quote = ch;
          j++;
          while (j < line.length) {
            if (line[j] === '\\') { j += 2; continue; }
            if (line[j] === quote) break;
            j++;
          }
          j++;
          continue;
        }
        if (ch === '{') { braceCount++; foundOpen = true; }
        else if (ch === '}') { braceCount--; }
        j++;
      }
      if (foundOpen && braceCount === 0) {
        endLine = i;
        break;
      }
    }

    // Check if next line has ");
    if (endLine < lines.length - 1 && lines[endLine + 1].trim() === ');') {
      endLine++;
    }

    // Replace the test
    const newLines = [
      ...lines.slice(0, startLine),
      newTestCode,
      ...lines.slice(endLine + 1)
    ];

    fs.writeFileSync(filePath, newLines.join('\n'));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getAiSuggestion(prompt: string, context: AiContext): Promise<string> {
  const hasTestSource = !!context.testSourceCode;

  const systemPrompt = `You are a Playwright test modification assistant. You help users modify their existing tests based on what they observe in the test runner.

CURRENT CONTEXT:
- Test name: ${context.testName || 'Unknown'}
- Test file: ${context.testFilePath || 'Unknown'}
- Page URL: ${context.action?.pageUrl || 'Unknown'}
- Current action being viewed: ${context.action ? `${context.action.type}.${context.action.method}` : 'None'}
- Network request being viewed: ${context.networkRequest ? `${context.networkRequest.method} ${context.networkRequest.url}` : 'None'}
${context.history && context.history.length > 0 ? `- Test history (recent runs): ${context.history.slice(0, 10).map(h => `${h.s}(${(h.d / 1000).toFixed(1)}s)`).join(', ')}${context.history.filter(h => h.s === 'failed').length > 0 ? `\n- Flakiness: ${context.history.filter(h => h.s === 'failed').length}/${context.history.length} failures` : ''}` : ''}

${hasTestSource ? `CURRENT TEST SOURCE CODE:
\`\`\`typescript
${context.testSourceCode}
\`\`\`` : ''}

INSTRUCTIONS:
${hasTestSource ? `
- When the user asks to modify the test, output the COMPLETE modified test function
- Keep the same test signature (name, fixtures)
- Output ONLY the modified test in a code block - no explanation needed
- The code block should contain the full test('...', async (...) => { ... }); block
- When the user asks to "check for X" or "assert X", use STRICT assertions that verify specific values directly (e.g., expect(data[0].userId).toBe(2)), not loose checks like .some() or .includes() that might accidentally pass
- Prefer .toBe() for exact value checks, .toEqual() for object equality, .toStrictEqual() for strict comparison
- When modifying an assertion value, change the assertion to target the specific field directly
` : `
- Suggest code snippets that can be added to the test
- Use Playwright's modern locator API (getByRole, getByText, etc.)
- Use web-first assertions (expect(locator).toBeVisible(), etc.)
`}

NETWORK-AWARE TESTING:
- You have access to all network requests captured during the test run (URLs, methods, status codes, request/response bodies)
- Use this data to write precise assertions — assert on actual response values you can see, not guesses
- For API response assertions, intercept with page.route() or capture with page.waitForResponse():
  \`\`\`
  const response = await page.waitForResponse(url => url.includes('/api/endpoint'));
  const data = await response.json();
  expect(data.field).toBe(expectedValue);
  \`\`\`
- For verifying requests were made: use page.waitForResponse() or page.waitForRequest()
- For mocking API responses: use page.route() to intercept and fulfill with controlled data
- Check response status codes: expect(response.status()).toBe(200)
- When the user mentions "this request" or "this action", they mean the one shown in the context above
- Use actual values from the captured response bodies to write concrete assertions, not placeholder values
`;

  const contextDetails = buildContextDetails(context);

  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nContext:\n${contextDetails}`,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    return textBlock?.text || 'No response generated';
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

/** Check if a resource type represents an API/data request (not static assets). */
function isApiResource(resourceType?: string): boolean {
  if (!resourceType) return false;
  return ['xhr', 'fetch', 'websocket', 'other'].includes(resourceType.toLowerCase());
}

/** Truncate a body string with indicator */
function truncateBody(body: string, limit: number): string {
  if (body.length <= limit) return body;
  return body.slice(0, limit) + '\n... (truncated)';
}

/** Format a response body: pretty-print JSON if valid, detect language, truncate safely */
function formatResponseBody(body: string, limit: number): { text: string; lang: string } {
  let formatted = body;
  let lang = 'text';
  try {
    const parsed = JSON.parse(body);
    formatted = JSON.stringify(parsed, null, 2);
    lang = 'json';
  } catch {
    // Check if it looks like HTML
    if (body.trimStart().startsWith('<')) lang = 'html';
  }
  return { text: truncateBody(formatted, limit), lang };
}

function buildContextDetails(context: AiContext): string {
  const parts: string[] = [];

  // Test info
  if (context.testResult) {
    parts.push(`**Test:**`);
    parts.push(`- Name: ${context.testResult.test}`);
    parts.push(`- File: ${context.testResult.file}`);
    parts.push(`- Status: ${context.testResult.status}`);
    if (context.testResult.error) {
      parts.push(`- Error: ${context.testResult.error}`);
    }
    parts.push('');
  }

  if (context.action) {
    parts.push(`**Current Action:**`);
    parts.push(`- Type: ${context.action.type}.${context.action.method}`);
    if (context.action.title) {
      parts.push(`- Title: ${context.action.title}`);
    }
    if (context.action.params) {
      const paramStr = typeof context.action.params === 'string'
        ? context.action.params
        : JSON.stringify(context.action.params, null, 2).slice(0, 300);
      parts.push(`- Params: ${paramStr}`);
    }
    if (context.action.pageUrl) {
      parts.push(`- Page URL: ${context.action.pageUrl}`);
    }
    parts.push(`- Duration: ${context.action.timing?.durationMs || '?'}ms`);
    if (context.action.error) {
      parts.push(`- Error: ${context.action.error.message}`);
      if (context.action.error.stack) {
        parts.push(`- Stack:\n\`\`\`\n${context.action.error.stack.slice(0, 500)}\n\`\`\``);
      }
    }
    if (context.action.snapshot?.diff) {
      const diff = context.action.snapshot.diff;
      if (diff.added.length || diff.removed.length || diff.changed.length) {
        parts.push(`- Page changes:`);
        if (diff.added.length > 0)
          parts.push(`  - Added: ${diff.added.slice(0, 10).join(', ')}`);
        if (diff.removed.length > 0)
          parts.push(`  - Removed: ${diff.removed.slice(0, 10).join(', ')}`);
        if (diff.changed.length > 0)
          parts.push(`  - Changed: ${diff.changed.slice(0, 10).join(', ')}`);
      }
    }
    if (context.action.error && context.action.snapshot?.after) {
      parts.push(`- Page state after failure:\n\`\`\`\n${context.action.snapshot.after.slice(0, 2000)}\n\`\`\``);
    }
    if (context.action.console?.length > 0) {
      const errors = context.action.console.filter((c: { type: string }) => c.type === 'error');
      const warnings = context.action.console.filter((c: { type: string }) => c.type === 'warn' || c.type === 'warning');
      if (errors.length > 0) {
        parts.push(`\n**Console Errors (${errors.length}):**`);
        for (const err of errors.slice(0, 5)) {
          const text = err.text.length > 500 ? err.text.slice(0, 500) + '...' : err.text;
          const loc = err.location ? ` (${err.location})` : '';
          parts.push(`- ${text}${loc}`);
        }
      }
      if (warnings.length > 0) {
        parts.push(`\n**Console Warnings (${warnings.length}):**`);
        for (const w of warnings.slice(0, 3)) {
          const text = w.text.length > 500 ? w.text.slice(0, 500) + '...' : w.text;
          parts.push(`- ${text}`);
        }
      }
    }
  }

  if (context.networkRequest) {
    parts.push(`\n**Focused Network Request:**`);
    parts.push(`- ${context.networkRequest.method} ${context.networkRequest.url}`);
    parts.push(`- Status: ${context.networkRequest.status ?? 'pending'}`);
    if (context.networkRequest.resourceType) {
      parts.push(`- Type: ${context.networkRequest.resourceType}`);
    }
    if (context.networkRequest.requestPostData) {
      const limit = isApiResource(context.networkRequest.resourceType) ? 2000 : 500;
      parts.push(`- Request Body:\n\`\`\`json\n${truncateBody(context.networkRequest.requestPostData, limit)}\n\`\`\``);
    }
    if (context.networkRequest.responseBody) {
      const limit = isApiResource(context.networkRequest.resourceType) ? 3000 : 1000;
      const { text, lang } = formatResponseBody(context.networkRequest.responseBody, limit);
      parts.push(`- Response Body:\n\`\`\`${lang}\n${text}\n\`\`\``);
    }
  }

  if (context.history && context.history.length > 0) {
    const passes = context.history.filter(h => h.s === 'passed').length;
    const fails = context.history.filter(h => h.s === 'failed').length;
    parts.push(`\n**Test History (last ${context.history.length} runs):** ${passes} passed, ${fails} failed`);
    parts.push(context.history.slice(0, 5).map(h =>
      `- ${h.s} (${(h.d / 1000).toFixed(1)}s) — ${new Date(h.ts * 1000).toLocaleDateString()}`
    ).join('\n'));
    parts.push('');
  }

  if (context.allActions && context.allActions.length > 0) {
    parts.push(`\n**All Actions in this test (${context.allActions.length}):**`);
    for (const action of context.allActions.slice(0, 15)) {
      const status = action.error ? '✗' : '✓';
      const netSummary = action.network?.requests?.length
        ? ` [${action.network.requests.length} req]`
        : '';
      parts.push(`- ${status} ${action.type}.${action.method}${netSummary} (${action.timing?.durationMs || '?'}ms)`);
    }
    if (context.allActions.length > 15) {
      parts.push(`- ... and ${context.allActions.length - 15} more`);
    }

    // Collect all network requests across all actions
    const allRequests = context.allActions.flatMap(a => a.network?.requests || []);
    const apiRequests = allRequests.filter(r => isApiResource(r.resourceType));
    const failedRequests = allRequests.filter(r => r.status && r.status >= 400);

    if (apiRequests.length > 0) {
      parts.push(`\n**API Requests (${apiRequests.length} total):**`);
      for (const r of apiRequests.slice(0, 10)) {
        const statusIcon = !r.status ? '⏳' : r.status >= 400 ? '✗' : '✓';
        parts.push(`- ${statusIcon} ${r.method} ${r.url} → ${r.status ?? 'pending'} (${r.durationMs}ms)`);
        if (r.requestPostData) {
          parts.push(`  Request: ${truncateBody(r.requestPostData, 500)}`);
        }
        if (r.responseBody) {
          parts.push(`  Response: ${truncateBody(r.responseBody, 1500)}`);
        }
      }
      if (apiRequests.length > 10) {
        parts.push(`- ... and ${apiRequests.length - 10} more API requests`);
      }
    }

    if (failedRequests.length > 0 && apiRequests.length === 0) {
      parts.push(`\n**Failed Network Requests:**`);
      for (const r of failedRequests.slice(0, 5)) {
        parts.push(`- ${r.method} ${r.url} → ${r.status}`);
        if (r.responseBody) {
          parts.push(`  Response: ${r.responseBody.slice(0, 500)}`);
        }
      }
    }
  }

  return parts.join('\n');
}

/**
 * Extract test source code from file
 */
function extractTestSource(filePath: string, testLine: number): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the test start (matches test(, test.skip(, test.only(, etc.)
    let startLine = testLine - 1; // Convert to 0-indexed
    while (startLine > 0 && !TEST_START_PATTERN.test(lines[startLine])) {
      startLine--;
    }

    if (startLine < 0 || !TEST_START_PATTERN.test(lines[startLine])) {
      return undefined;
    }

    // Find the matching closing bracket (string/comment-aware)
    let braceCount = 0;
    let endLine = startLine;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      let j = 0;
      while (j < line.length) {
        const ch = line[j];
        if (ch === '/' && line[j + 1] === '/') break;
        if (ch === '\'' || ch === '"' || ch === '`') {
          const quote = ch;
          j++;
          while (j < line.length) {
            if (line[j] === '\\') { j += 2; continue; }
            if (line[j] === quote) break;
            j++;
          }
          j++;
          continue;
        }
        if (ch === '{') { braceCount++; foundOpen = true; }
        else if (ch === '}') { braceCount--; }
        j++;
      }
      if (foundOpen && braceCount === 0) {
        endLine = i;
        break;
      }
    }

    // Include the closing ");
    if (endLine < lines.length - 1 && lines[endLine + 1].trim().startsWith(');')) {
      endLine++;
    } else if (lines[endLine].trim().endsWith('});')) {
      // Already included
    }

    return lines.slice(startLine, endLine + 1).join('\n');
  } catch {
    return undefined;
  }
}

/**
 * Get current context from store for AI
 */
export function getCurrentAiContext(): AiContext {
  const state = store.getState();

  // Find selected test
  let selectedTestName = '';
  let selectedTestKey = '';
  let selectedFilePath = '';
  let selectedTestLine = 0;
  let findIdx = 0;

  for (const file of state.testFiles) {
    findIdx++;
    for (const test of file.tests) {
      if (findIdx === state.testSelectionIndex) {
        selectedTestKey = `${file.path}:${test.line}`;
        selectedTestName = test.title;
        selectedFilePath = file.path;
        selectedTestLine = test.line;
        break;
      }
      findIdx++;
    }
    if (selectedTestName) break;
  }

  // Extract test source code
  const testSourceCode = selectedFilePath && selectedTestLine
    ? extractTestSource(selectedFilePath, selectedTestLine)
    : undefined;

  const testResult = selectedTestKey ? state.testResults.find(r => r.testKey === selectedTestKey) : undefined;
  const allActions = testResult?.actions || [];

  // Get current action based on scroll index (not just when expanded)
  const currentAction = allActions.length > 0 && state.actionScrollIndex < allActions.length
    ? allActions[state.actionScrollIndex]
    : undefined;

  // Get network request if in actions panel and action has network requests
  const networkRequest = currentAction?.network?.requests?.length
    ? currentAction.network.requests[state.networkScrollIndex] || currentAction.network.requests[0]
    : undefined;

  // Look up history for this test
  const selectedFile = state.testFiles.find(f => f.path === selectedFilePath);
  const historyKey = selectedFile ? `${selectedFile.relativePath}:${selectedTestLine}` : '';
  const history = historyKey ? state.testHistory[historyKey] : undefined;

  return {
    testName: selectedTestName,
    testFilePath: selectedFilePath,
    testSourceCode,
    testLine: selectedTestLine,
    action: currentAction,
    networkRequest,
    allActions,
    testResult,
    history,
  };
}
