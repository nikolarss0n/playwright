/**
 * AI Assistant for test writing suggestions
 */

import Anthropic from '@anthropic-ai/sdk';
import { store, ActionCapture, NetworkRequestCapture, TestResult } from '../ui/store.js';

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
export function replaceTestInFile(filePath: string, testLine: number, newTestCode: string): { success: boolean; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the test start
    let startLine = testLine - 1; // Convert to 0-indexed
    while (startLine > 0 && !lines[startLine].match(/^\s*test\s*\(/)) {
      startLine--;
    }

    if (startLine < 0 || !lines[startLine].match(/^\s*test\s*\(/)) {
      return { success: false, error: 'Could not find test start' };
    }

    // Find the matching closing bracket
    let braceCount = 0;
    let endLine = startLine;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpen = true;
        } else if (char === '}') {
          braceCount--;
        }
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
- Current action being viewed: ${context.action ? `${context.action.type}.${context.action.method}` : 'None'}
- Network request being viewed: ${context.networkRequest ? `${context.networkRequest.method} ${context.networkRequest.url}` : 'None'}

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

When user says "this request" or "this action", they mean the one shown in the context above.
For network assertions, use: await page.waitForResponse(url => url.includes('...'))
`;

  const contextDetails = buildContextDetails(context);

  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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
    parts.push(`- Duration: ${context.action.timing?.durationMs || '?'}ms`);
    if (context.action.error) {
      parts.push(`- Error: ${context.action.error.message}`);
    }
    if (context.action.snapshot?.diff) {
      const diff = context.action.snapshot.diff;
      if (diff.added.length || diff.removed.length || diff.changed.length) {
        parts.push(`- Page changes: ${diff.summary}`);
      }
    }
  }

  if (context.networkRequest) {
    parts.push(`\n**Network Request:**`);
    parts.push(`- ${context.networkRequest.method} ${context.networkRequest.url}`);
    parts.push(`- Status: ${context.networkRequest.status ?? 'pending'}`);
    if (context.networkRequest.requestPostData) {
      parts.push(`- Request Body:\n\`\`\`json\n${context.networkRequest.requestPostData.slice(0, 500)}\n\`\`\``);
    }
    if (context.networkRequest.responseBody) {
      parts.push(`- Response Body:\n\`\`\`json\n${context.networkRequest.responseBody.slice(0, 1000)}\n\`\`\``);
    }
  }

  if (context.allActions && context.allActions.length > 0) {
    parts.push(`\n**All Actions in this test (${context.allActions.length}):**`);
    for (const action of context.allActions.slice(0, 10)) {
      const status = action.error ? '✗' : '✓';
      parts.push(`- ${status} ${action.type}.${action.method} (${action.timing?.durationMs || '?'}ms)`);
    }
    if (context.allActions.length > 10) {
      parts.push(`- ... and ${context.allActions.length - 10} more`);
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

    // Find the test start (should be around testLine)
    let startLine = testLine - 1; // Convert to 0-indexed
    while (startLine > 0 && !lines[startLine].match(/^\s*test\s*\(/)) {
      startLine--;
    }

    if (startLine < 0 || !lines[startLine].match(/^\s*test\s*\(/)) {
      return undefined;
    }

    // Find the matching closing bracket
    let braceCount = 0;
    let endLine = startLine;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpen = true;
        } else if (char === '}') {
          braceCount--;
        }
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

  return {
    testName: selectedTestName,
    testFilePath: selectedFilePath,
    testSourceCode,
    testLine: selectedTestLine,
    action: currentAction,
    networkRequest,
    allActions,
    testResult,
  };
}
