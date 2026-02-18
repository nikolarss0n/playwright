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
import { execSync } from 'child_process';
import { getWorkflowPrompt } from './fix-workflow.js';

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
  fullFileContent?: string;  // entire test file (imports, helpers, beforeEach, all tests)
  fileHeader?: string;       // imports and top-level code before the test
  testLine?: number;
  action?: ActionCapture;
  networkRequest?: NetworkRequestCapture;
  allActions?: ActionCapture[];
  testResult?: TestResult;
  history?: Array<{ ts: number; s: string; d: number }>;
}

// ── AI Tool definitions (read-only project exploration) ──

const projectRoot = process.cwd();

function safePath(requestedPath: string): string {
  const resolved = path.resolve(projectRoot, requestedPath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error('Path outside project root');
  }
  return resolved;
}

const aiTools: Anthropic.Messages.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a project file. Path is relative to the project root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List directory contents. Returns [DIR] and [FILE] markers. Path is relative to project root (use "." for root).',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative directory path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep_files',
    description: 'Search file contents with a pattern (regex or literal). Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        path: { type: 'string', description: 'Directory to search in (relative, default ".")' },
        glob: { type: 'string', description: 'File glob filter (e.g. "*.ts", "*.config.*")' },
      },
      required: ['pattern'],
    },
  },
];

function executeTool(name: string, input: Record<string, unknown>): string {
  try {
    switch (name) {
      case 'read_file': {
        const filePath = safePath(String(input.path));
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.length > 30_000) {
          return content.slice(0, 30_000) + '\n... (truncated at 30k chars)';
        }
        return content;
      }
      case 'list_files': {
        const dirPath = safePath(String(input.path));
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines: string[] = [];
        for (const entry of entries.slice(0, 100)) {
          lines.push(`${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`);
        }
        if (entries.length > 100) {
          lines.push(`... and ${entries.length - 100} more entries`);
        }
        return lines.join('\n');
      }
      case 'grep_files': {
        const pattern = String(input.pattern);
        const searchPath = safePath(String(input.path || '.'));
        const globArg = input.glob ? ` --include='${String(input.glob)}'` : '';
        const cmd = `grep -rn --max-count=10 ${globArg} -e ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>/dev/null | head -50`;
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
        return output || '(no matches)';
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

/**
 * Extract the best code block from AI response.
 * Prefers blocks that look like a test function; falls back to the longest block.
 * Never joins multiple blocks (that corrupts output when AI includes example snippets).
 */
export function extractCodeFromResponse(response: string): string | null {
  const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/g;
  const blocks: string[] = [];

  let match;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const trimmed = match[1].trim();
    if (trimmed) blocks.push(trimmed);
  }

  if (blocks.length === 0) return null;
  if (blocks.length === 1) return blocks[0];

  // Multiple blocks: prefer the one that looks like a test function
  const testBlock = blocks.find(b => TEST_START_PATTERN.test(b));
  if (testBlock) return testBlock;

  // Next: prefer blocks that contain a test()-like call anywhere
  const containsTest = blocks.find(b => /\btest\s*(\.\w+\s*)?\(/.test(b));
  if (containsTest) return containsTest;

  // Fallback: the longest block (most likely the full test)
  return blocks.reduce((a, b) => a.length > b.length ? a : b);
}

/**
 * Separate import lines from test code in AI output.
 * The AI is instructed to put new imports at the top of its code block.
 */
export function separateImports(code: string): { testCode: string; newImports: string[] } {
  const lines = code.split('\n');
  const imports: string[] = [];
  let testStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Lines with // NEW IMPORT: marker
    if (line.startsWith('// NEW IMPORT:')) {
      imports.push(line.replace('// NEW IMPORT:', '').trim());
      testStart = i + 1;
      continue;
    }
    // Raw import lines before the test function
    if (line.startsWith('import ')) {
      imports.push(lines[i]); // preserve original indentation
      testStart = i + 1;
      continue;
    }
    // Skip blank lines between imports and test
    if (line === '' && testStart === i) {
      testStart = i + 1;
      continue;
    }
    break;
  }

  return {
    testCode: lines.slice(testStart).join('\n'),
    newImports: imports,
  };
}

/**
 * Replace a test in a file with new code, optionally inserting new imports.
 */
// Matches: test(, test.skip(, test.only(, setup(, setup.skip(, it(, it.only(, etc.
const TEST_START_PATTERN = /^\s*(test|setup|it)\s*(\.\w+\s*)?\(/;

/** Parse brace-balanced block boundaries (string/comment-aware). */
function findTestBounds(lines: string[], testLine: number): { startLine: number; endLine: number } | null {
  let startLine = testLine - 1; // Convert to 0-indexed
  while (startLine > 0 && !TEST_START_PATTERN.test(lines[startLine])) {
    startLine--;
  }

  if (startLine < 0 || !TEST_START_PATTERN.test(lines[startLine])) {
    return null;
  }

  let braceCount = 0;
  let endLine = startLine;
  let foundOpen = false;
  let inMultiLineComment = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      // Multi-line comment tracking
      if (inMultiLineComment) {
        if (ch === '*' && line[j + 1] === '/') { inMultiLineComment = false; j += 2; continue; }
        j++;
        continue;
      }
      if (ch === '/' && line[j + 1] === '*') { inMultiLineComment = true; j += 2; continue; }
      // Skip single-line comments
      if (ch === '/' && line[j + 1] === '/') break;
      // Skip string literals (handles template literals spanning multiple chars on one line)
      if (ch === '\'' || ch === '"' || ch === '`') {
        const quote = ch;
        j++;
        while (j < line.length) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === quote) break;
          // Template literal: skip ${...} expressions (with nested string awareness)
          if (quote === '`' && line[j] === '$' && line[j + 1] === '{') {
            let depth = 1;
            j += 2;
            while (j < line.length && depth > 0) {
              const c = line[j];
              // Skip strings inside ${} expressions
              if (c === '\'' || c === '"') {
                const q = c;
                j++;
                while (j < line.length && line[j] !== q) {
                  if (line[j] === '\\') j++;
                  j++;
                }
                j++; // skip closing quote
                continue;
              }
              if (c === '{') depth++;
              else if (c === '}') depth--;
              j++;
            }
            continue;
          }
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

  // Include closing ");  on same or next line
  if (endLine < lines.length - 1 && /^\s*\);/.test(lines[endLine + 1])) {
    endLine++;
  }

  return { startLine, endLine };
}

export function replaceTestInFile(
  filePath: string,
  testLine: number,
  newTestCode: string,
  newImports?: string[],
): { success: boolean; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const bounds = findTestBounds(lines, testLine);
    if (!bounds) {
      return { success: false, error: 'Could not find test start' };
    }

    let { startLine, endLine } = bounds;

    // Insert new imports (after existing imports, before first test)
    if (newImports && newImports.length > 0) {
      // Find last import line
      let lastImportLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*import\s/.test(lines[i])) lastImportLine = i;
        if (TEST_START_PATTERN.test(lines[i])) break;
      }
      const insertAt = lastImportLine >= 0 ? lastImportLine + 1 : 0;

      // Deduplicate: don't add imports that already exist
      const existingImports = new Set(
        lines.slice(0, Math.max(startLine, insertAt)).map(l => l.trim())
      );
      const unique = newImports.filter(imp => !existingImports.has(imp.trim()));

      if (unique.length > 0) {
        lines.splice(insertAt, 0, ...unique);
        // Adjust test bounds for inserted lines
        if (startLine >= insertAt) {
          startLine += unique.length;
          endLine += unique.length;
        }
      }
    }

    // Replace the test block
    const newLines = [
      ...lines.slice(0, startLine),
      newTestCode,
      ...lines.slice(endLine + 1),
    ];

    fs.writeFileSync(filePath, newLines.join('\n'));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getAiSuggestion(
  prompt: string,
  context: AiContext,
  onStatus?: (status: string) => void,
): Promise<string> {
  const hasTestSource = !!context.testSourceCode;

  const systemPrompt = `You are a Playwright test-fixing assistant embedded in a test runner TUI. You help users understand failures and modify their tests.

CURRENT CONTEXT:
- Test name: ${context.testName || 'Unknown'}
- Test file: ${context.testFilePath || 'Unknown'}
- Page URL: ${context.action?.pageUrl || 'Unknown'}
- Current action: ${context.action ? `${context.action.type}.${context.action.method}` : 'None'}
- Network request in focus: ${context.networkRequest ? `${context.networkRequest.method} ${context.networkRequest.url}` : 'None'}
${context.history && context.history.length > 0 ? `- Test history: ${context.history.slice(0, 10).map(h => `${h.s}(${(h.d / 1000).toFixed(1)}s)`).join(', ')}${context.history.filter(h => h.s === 'failed').length > 0 ? ` — FLAKY: ${context.history.filter(h => h.s === 'failed').length}/${context.history.length} failures` : ''}` : ''}

${hasTestSource ? `CURRENT TEST (the one to modify):
\`\`\`typescript
${context.testSourceCode}
\`\`\`` : ''}

FULL FILE CONTEXT:
The complete test file is provided in the context data (section "FULL TEST FILE"). It contains:
- All imports and dependencies
- Setup/teardown (beforeEach, afterEach, beforeAll, afterAll)
- Helper functions and constants
- All tests in the file (the failing test is highlighted)
Use this to understand the business logic, shared fixtures, and patterns used across tests.

TOOLS:
You have read-only tools to explore the project. Use them PROACTIVELY — especially:
- **read_file**: Read page objects, business layer files, helper classes, fixtures, config files
- **list_files**: Browse project structure to find page objects, components, factories, layers
- **grep_files**: Find method definitions, locator patterns, existing helpers

CRITICAL — PROJECT ARCHITECTURE:
Before writing any code change, you MUST understand the project's architecture:
1. Use list_files and read_file to discover the project's structure (look for pages/, components/, business/, factories/, helpers/, fixtures/ directories)
2. Read the relevant page object or business layer file that handles the page/feature being tested
3. Use EXISTING methods from page objects and business layers — NEVER write raw Playwright calls (page.click, page.fill, page.locator) if a page object method already exists for that action
4. If the test file imports page objects or business layer classes, read those files to see available methods
5. Match the patterns used in other tests in the same file

RESPONSE FORMAT — CRITICAL RULES:

Determine whether the user is asking a QUESTION or requesting a CODE CHANGE.

**QUESTION** ("why does this fail?", "explain", "is this flaky?"):
- Respond with concise text (2-5 sentences). NO code blocks.
- Reference specific actions, errors, network data, or lines from the context.

**CODE CHANGE** ("fix", "add assertion", "update selector", "check for X"):
${hasTestSource ? `- Output EXACTLY ONE fenced code block containing the COMPLETE modified test function.
- The code block MUST contain the full \`test('...', async (...) => { ... });\` block — nothing else.
- Do NOT output multiple code blocks, inline code examples, or explanation code. ONE block only.
- Do NOT add explanation text before or after the code block. Just the code.
- If you need NEW imports that don't exist in the file header, put them as the first lines of your code block before the test() call:
  \`\`\`typescript
  import { something } from 'somewhere';

  test('my test', async ({ page }) => {
    // ...
  });
  \`\`\`
  Only add imports that are genuinely missing from the existing file header shown in context.
- Keep the same test signature (name, fixtures, annotations like .skip/.only).
- Preserve the test's overall structure — only change what's needed to fix the issue.` : `- Suggest code using Playwright's modern locator API (getByRole, getByText, etc.)
- Use web-first assertions (expect(locator).toBeVisible(), etc.)`}

ASSERTION QUALITY:
- Use STRICT assertions: .toBe() for primitives, .toStrictEqual() for objects, .toEqual() for deep equality.
- NEVER use loose checks like .some(), .includes(), or truthiness checks when an exact value is available.
- When captured network response data is available, use the ACTUAL values from it for assertions — not placeholders.
- For API assertions, prefer:
  \`const response = await page.waitForResponse(url => url.includes('/api/endpoint'));\`
  \`expect(response.status()).toBe(200);\`
  \`const data = await response.json(); expect(data.field).toBe(actualValue);\`

${getWorkflowPrompt()}

CONTEXT NOTES:
- "this request" or "this action" means the one highlighted in the context above.
- Page snapshots show the DOM state — use these to find correct locators.
- Network request bodies show actual API data — use these for assertion values.
- DOM diffs show what changed between actions — key for spotting new/removed elements.
`;

  const contextDetails = buildContextDetails(context);
  const MAX_ITERATIONS = 10;

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content: `${prompt}\n\nContext:\n${contextDetails}`,
    },
  ];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await getClient().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16384,
        system: systemPrompt,
        tools: aiTools,
        messages,
      });

      // Collect text from this response
      if (response.stop_reason === 'end_turn' || response.stop_reason !== 'tool_use') {
        const textBlocks = response.content.filter(
          (b): b is Anthropic.Messages.TextBlock => b.type === 'text'
        );
        return textBlocks.map(b => b.text).join('\n') || 'No response generated';
      }

      // Handle tool use
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );

      // Append the assistant's response (with tool_use blocks) to conversation
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool and build results
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const displayName = toolUse.name === 'read_file'
          ? `Reading ${(toolUse.input as any).path}...`
          : toolUse.name === 'list_files'
            ? `Listing ${(toolUse.input as any).path}...`
            : `Searching for "${(toolUse.input as any).pattern}"...`;
        onStatus?.(displayName);

        const result = executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return 'Reached maximum tool iterations. Please try a more specific question.';
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

  // ── STEP 0: FULL TEST FILE ──
  if (context.fullFileContent) {
    parts.push(`## FULL TEST FILE (${context.testFilePath || 'unknown'})`);
    parts.push(`This is the complete test file — imports, setup (beforeEach/afterEach), helpers, all tests.`);
    parts.push(`The failing test "${context.testName}" starts at line ${context.testLine || '?'}.`);
    parts.push(`\`\`\`typescript\n${context.fullFileContent}\n\`\`\``);
    parts.push('');
  } else if (context.fileHeader) {
    parts.push(`## FILE HEADER (imports & setup)`);
    parts.push(`\`\`\`typescript\n${context.fileHeader}\n\`\`\``);
    parts.push('');
  }

  // ── STEP 1: THE ERROR — What failed and why? ──
  parts.push(`## STEP 1: ERROR`);
  if (context.testResult) {
    parts.push(`- Test: ${context.testResult.test}`);
    parts.push(`- File: ${context.testResult.file}`);
    parts.push(`- Status: **${context.testResult.status}**`);
    if (context.testResult.error) {
      parts.push(`- Error message:\n\`\`\`\n${context.testResult.error}\n\`\`\``);
    }
  }
  if (context.action) {
    parts.push(`- Failing action: \`${context.action.type}.${context.action.method}\``);
    if (context.action.title) parts.push(`- Action title: ${context.action.title}`);
    if (context.action.params) {
      const paramStr = typeof context.action.params === 'string'
        ? context.action.params
        : JSON.stringify(context.action.params, null, 2).slice(0, 500);
      parts.push(`- Locator/params: \`${paramStr}\``);
    }
    if (context.action.pageUrl) parts.push(`- Page URL: ${context.action.pageUrl}`);
    parts.push(`- Duration: ${context.action.timing?.durationMs || '?'}ms`);
    if (context.action.error) {
      parts.push(`- Action error: ${context.action.error.message}`);
      if (context.action.error.stack) {
        parts.push(`- Stack trace:\n\`\`\`\n${context.action.error.stack.slice(0, 800)}\n\`\`\``);
      }
    }
  }
  if (context.history && context.history.length > 0) {
    const passes = context.history.filter(h => h.s === 'passed').length;
    const fails = context.history.filter(h => h.s === 'failed').length;
    parts.push(`- History: ${passes} passed, ${fails} failed in last ${context.history.length} runs${fails > 1 ? ' (FLAKY)' : ''}`);
  }
  parts.push('');

  // ── STEP 2: PAGE STATE — What does the DOM look like? ──
  parts.push(`## STEP 2: PAGE STATE (DOM)`);
  if (context.action?.snapshot?.diff) {
    const diff = context.action.snapshot.diff;
    const hasChanges = diff.added.length || diff.removed.length || diff.changed.length;
    if (hasChanges) {
      parts.push(`DOM changes between previous action and this one:`);
      if (diff.added.length > 0)
        parts.push(`- **ADDED elements**: ${diff.added.slice(0, 15).join(', ')}${diff.added.length > 15 ? ` (+${diff.added.length - 15} more)` : ''}`);
      if (diff.removed.length > 0)
        parts.push(`- **REMOVED elements**: ${diff.removed.slice(0, 15).join(', ')}${diff.removed.length > 15 ? ` (+${diff.removed.length - 15} more)` : ''}`);
      if (diff.changed.length > 0)
        parts.push(`- **CHANGED elements**: ${diff.changed.slice(0, 15).join(', ')}${diff.changed.length > 15 ? ` (+${diff.changed.length - 15} more)` : ''}`);
    } else {
      parts.push(`No DOM changes detected between actions.`);
    }
  } else {
    parts.push(`(no DOM diff available)`);
  }

  if (context.action?.snapshot?.after) {
    parts.push(`\nPage DOM at point of failure:`);
    parts.push(`\`\`\`\n${context.action.snapshot.after.slice(0, 3000)}\n\`\`\``);
  } else if (context.action?.snapshot?.before) {
    parts.push(`\nPage DOM before failing action:`);
    parts.push(`\`\`\`\n${context.action.snapshot.before.slice(0, 3000)}\n\`\`\``);
  } else {
    parts.push(`(no page snapshot available — use read_file tool to check page objects)`);
  }
  parts.push('');

  // ── STEP 3: SCREENSHOT ──
  parts.push(`## STEP 3: SCREENSHOT`);
  if (context.testResult?.attachments?.length) {
    const screenshots = context.testResult.attachments.filter(a => a.contentType.startsWith('image/'));
    if (screenshots.length > 0) {
      parts.push(`${screenshots.length} screenshot(s) captured at failure:`);
      for (const s of screenshots) {
        parts.push(`- ${s.name} (${s.path})`);
      }
      parts.push(`(screenshots are available in the UI — use the DOM snapshot above for element analysis)`);
    } else {
      parts.push(`No screenshots captured.`);
    }
  } else {
    parts.push(`No screenshots available.`);
  }
  parts.push('');

  // ── STEP 4: NETWORK REQUESTS — API state at and around the failure ──
  parts.push(`## STEP 4: NETWORK REQUESTS`);

  // Network for the failing action specifically
  if (context.action?.network?.requests?.length) {
    const actionReqs = context.action.network.requests;
    parts.push(`\n### Requests during failing action (${actionReqs.length}):`);
    for (const r of actionReqs.slice(0, 8)) {
      const statusIcon = !r.status ? '⏳' : r.status >= 400 ? '✗' : '✓';
      parts.push(`- ${statusIcon} ${r.method} ${r.url} → ${r.status ?? 'pending'} (${r.durationMs}ms)`);
      if (r.requestPostData) {
        const limit = isApiResource(r.resourceType) ? 2000 : 500;
        parts.push(`  Request body:\n\`\`\`json\n${truncateBody(r.requestPostData, limit)}\n\`\`\``);
      }
      if (r.responseBody) {
        const limit = isApiResource(r.resourceType) ? 3000 : 1000;
        const { text, lang } = formatResponseBody(r.responseBody, limit);
        parts.push(`  Response body:\n\`\`\`${lang}\n${text}\n\`\`\``);
      }
    }
  }

  // Focused network request (user selected)
  if (context.networkRequest) {
    parts.push(`\n### Focused network request (user-selected):`);
    parts.push(`- ${context.networkRequest.method} ${context.networkRequest.url}`);
    parts.push(`- Status: ${context.networkRequest.status ?? 'pending'}`);
    if (context.networkRequest.resourceType) parts.push(`- Type: ${context.networkRequest.resourceType}`);
    if (context.networkRequest.requestPostData) {
      const limit = isApiResource(context.networkRequest.resourceType) ? 2000 : 500;
      parts.push(`- Request body:\n\`\`\`json\n${truncateBody(context.networkRequest.requestPostData, limit)}\n\`\`\``);
    }
    if (context.networkRequest.responseBody) {
      const limit = isApiResource(context.networkRequest.resourceType) ? 3000 : 1000;
      const { text, lang } = formatResponseBody(context.networkRequest.responseBody, limit);
      parts.push(`- Response body:\n\`\`\`${lang}\n${text}\n\`\`\``);
    }
  }

  // All network across the test run
  if (context.allActions && context.allActions.length > 0) {
    const allRequests = context.allActions.flatMap(a => a.network?.requests || []);
    const failedRequests = allRequests.filter(r => r.status && r.status >= 400);
    const apiRequests = allRequests.filter(r => isApiResource(r.resourceType));

    if (failedRequests.length > 0) {
      parts.push(`\n### Failed requests across entire test (${failedRequests.length}):`);
      for (const r of failedRequests.slice(0, 5)) {
        parts.push(`- ✗ ${r.method} ${r.url} → ${r.status}`);
        if (r.responseBody) {
          parts.push(`  Response: ${truncateBody(r.responseBody, 500)}`);
        }
      }
    }

    if (apiRequests.length > 0) {
      parts.push(`\n### All API requests in test (${apiRequests.length}):`);
      for (const r of apiRequests.slice(0, 12)) {
        const statusIcon = !r.status ? '⏳' : r.status >= 400 ? '✗' : '✓';
        parts.push(`- ${statusIcon} ${r.method} ${r.url} → ${r.status ?? 'pending'} (${r.durationMs}ms)`);
      }
      if (apiRequests.length > 12) {
        parts.push(`- ... and ${apiRequests.length - 12} more`);
      }
    }
  }
  parts.push('');

  // ── STEP 5: CONSOLE ERRORS ──
  if (context.action?.console?.length) {
    const errors = context.action.console.filter((c: { type: string }) => c.type === 'error');
    const warnings = context.action.console.filter((c: { type: string }) => c.type === 'warn' || c.type === 'warning');
    if (errors.length > 0 || warnings.length > 0) {
      parts.push(`## STEP 5: CONSOLE OUTPUT`);
      if (errors.length > 0) {
        parts.push(`Console errors (${errors.length}):`);
        for (const err of errors.slice(0, 5)) {
          const text = err.text.length > 500 ? err.text.slice(0, 500) + '...' : err.text;
          const loc = err.location ? ` (${err.location})` : '';
          parts.push(`- ERROR: ${text}${loc}`);
        }
      }
      if (warnings.length > 0) {
        parts.push(`Console warnings (${warnings.length}):`);
        for (const w of warnings.slice(0, 3)) {
          const text = w.text.length > 500 ? w.text.slice(0, 500) + '...' : w.text;
          parts.push(`- WARN: ${text}`);
        }
      }
      parts.push('');
    }
  }

  // ── STEP 6: ALL ACTIONS TIMELINE — What happened in the test? ──
  if (context.allActions && context.allActions.length > 0) {
    parts.push(`## STEP 6: TEST TIMELINE (${context.allActions.length} actions)`);
    for (let i = 0; i < Math.min(context.allActions.length, 20); i++) {
      const action = context.allActions[i];
      const status = action.error ? '✗ FAILED' : '✓';
      const netCount = action.network?.requests?.length || 0;
      const netSummary = netCount > 0 ? ` [${netCount} req]` : '';
      const isCurrent = action === context.action ? ' ◄ CURRENT' : '';
      parts.push(`${i + 1}. ${status} ${action.type}.${action.method}${netSummary} (${action.timing?.durationMs || '?'}ms)${isCurrent}`);
    }
    if (context.allActions.length > 20) {
      parts.push(`   ... and ${context.allActions.length - 20} more actions`);
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
 * Extract file header (imports + top-level setup) before the first test.
 */
function extractFileHeader(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let headerEnd = 0;

    for (let i = 0; i < lines.length; i++) {
      if (TEST_START_PATTERN.test(lines[i])) {
        headerEnd = i;
        break;
      }
      // Also stop at describe blocks
      if (/^\s*(test\.)?describe\s*\(/.test(lines[i])) {
        headerEnd = i;
        break;
      }
      headerEnd = i + 1;
    }

    // Trim trailing empty lines
    while (headerEnd > 0 && lines[headerEnd - 1].trim() === '') headerEnd--;

    if (headerEnd === 0) return undefined;
    return lines.slice(0, headerEnd).join('\n');
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

  // Extract test source code, file header, and full file
  const testSourceCode = selectedFilePath && selectedTestLine
    ? extractTestSource(selectedFilePath, selectedTestLine)
    : undefined;
  const fileHeader = selectedFilePath
    ? extractFileHeader(selectedFilePath)
    : undefined;
  let fullFileContent: string | undefined;
  if (selectedFilePath) {
    try {
      const raw = fs.readFileSync(selectedFilePath, 'utf-8');
      // Cap at 15k chars to avoid blowing up the context window
      fullFileContent = raw.length > 15_000
        ? raw.slice(0, 15_000) + '\n// ... (file truncated at 15k chars)'
        : raw;
    } catch { /* ignore */ }
  }

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
    fullFileContent,
    fileHeader,
    testLine: selectedTestLine,
    action: currentAction,
    networkRequest,
    allActions,
    testResult,
    history,
  };
}

/**
 * Build a full debug report with all captured data for clipboard export.
 * Includes: test file, error, DOM, screenshots, network (with full bodies), console, timeline.
 * Uses higher truncation limits than the AI context since this is for human use.
 */
export function buildClipboardReport(): string {
  const context = getCurrentAiContext();
  const parts: string[] = [];

  parts.push(`# Test Debug Report`);
  parts.push(`Generated: ${new Date().toISOString()}`);
  parts.push('');

  // ── Test Info ──
  parts.push(`## Test Info`);
  parts.push(`- **Name:** ${context.testName || 'Unknown'}`);
  parts.push(`- **File:** ${context.testFilePath || 'Unknown'}`);
  parts.push(`- **Line:** ${context.testLine || '?'}`);
  if (context.testResult) {
    parts.push(`- **Status:** ${context.testResult.status}`);
    parts.push(`- **Duration:** ${context.testResult.duration}ms`);
    if (context.testResult.error) {
      parts.push(`- **Error:**\n\`\`\`\n${context.testResult.error}\n\`\`\``);
    }
  }
  if (context.history && context.history.length > 0) {
    const passes = context.history.filter(h => h.s === 'passed').length;
    const fails = context.history.filter(h => h.s === 'failed').length;
    parts.push(`- **History:** ${passes} passed, ${fails} failed in last ${context.history.length} runs`);
  }
  parts.push('');

  // ── Full Test File ──
  if (context.fullFileContent) {
    parts.push(`## Full Test File`);
    parts.push(`\`\`\`typescript\n${context.fullFileContent}\n\`\`\``);
    parts.push('');
  }

  // ── Failing Action (find the actual error, don't rely on scroll position) ──
  const allActions = context.allActions || [];
  const failingAction = allActions.find(a => a.error) || context.action;
  const failingActionIdx = failingAction ? allActions.indexOf(failingAction) : -1;
  if (failingAction) {
    parts.push(`## Failing Action (step ${failingActionIdx >= 0 ? failingActionIdx + 1 : '?'} of ${allActions.length})`);
    parts.push(`- **Action:** \`${failingAction.type}.${failingAction.method}\``);
    if (failingAction.title) parts.push(`- **Title:** ${failingAction.title}`);
    if (failingAction.params) {
      const paramStr = typeof failingAction.params === 'string'
        ? failingAction.params
        : JSON.stringify(failingAction.params, null, 2);
      parts.push(`- **Params:** \`${paramStr}\``);
    }
    if (failingAction.pageUrl) parts.push(`- **Page URL:** ${failingAction.pageUrl}`);
    parts.push(`- **Duration:** ${failingAction.timing?.durationMs || '?'}ms`);
    if (failingAction.error) {
      parts.push(`- **Error:** ${failingAction.error.message}`);
      if (failingAction.error.stack) {
        parts.push(`- **Stack:**\n\`\`\`\n${failingAction.error.stack}\n\`\`\``);
      }
    }
    // Include DOM snapshot from the failing action
    if (failingAction.snapshot?.after) {
      parts.push(`\n### DOM at failure\n\`\`\`\n${failingAction.snapshot.after}\n\`\`\``);
    }
    if (failingAction.snapshot?.diff) {
      const diff = failingAction.snapshot.diff;
      if (diff.added.length || diff.removed.length || diff.changed.length) {
        parts.push(`\n### DOM changes`);
        if (diff.added.length) parts.push(`**Added:** ${diff.added.join(', ')}`);
        if (diff.removed.length) parts.push(`**Removed:** ${diff.removed.join(', ')}`);
        if (diff.changed.length) parts.push(`**Changed:** ${diff.changed.join(', ')}`);
      }
    }
    // Network requests during the failing action
    if (failingAction.network?.requests?.length) {
      parts.push(`\n### Network during failing action (${failingAction.network.requests.length} requests)`);
      for (const r of failingAction.network.requests) {
        parts.push(`- ${r.method} ${r.url} → ${r.status ?? 'pending'} (${r.durationMs}ms)`);
        if (r.responseBody) {
          const { text, lang } = formatResponseBody(r.responseBody, 50_000);
          parts.push(`  Response:\n\`\`\`${lang}\n${text}\n\`\`\``);
        }
      }
    }
    // Console errors during the failing action
    if (failingAction.console?.length) {
      const errors = failingAction.console.filter((c: { type: string }) => c.type === 'error');
      if (errors.length) {
        parts.push(`\n### Console errors during failing action`);
        for (const e of errors as Array<{ text: string }>) parts.push(`- ${e.text}`);
      }
    }
    parts.push('');
  }

  // (DOM snapshot and diff are included in the Failing Action section above)

  // ── Screenshots ──
  if (context.testResult?.attachments?.length) {
    parts.push(`## Screenshots`);
    for (const att of context.testResult.attachments) {
      parts.push(`- **${att.name}**: \`${att.path}\` (${att.contentType})`);
    }
    parts.push('');
  }

  // ── Network Requests (full bodies, no truncation) ──
  const allRequests = allActions.flatMap(a => a.network?.requests || []);
  if (allRequests.length > 0) {
    parts.push(`## Network Requests (${allRequests.length} total)`);

    // Failing action requests first
    if (context.action?.network?.requests?.length) {
      parts.push(`\n### Requests during failing action`);
      for (const r of context.action.network.requests) {
        parts.push(`\n#### ${r.method} ${r.url}`);
        parts.push(`- Status: ${r.status ?? 'pending'} | Duration: ${r.durationMs}ms | Type: ${r.resourceType || '?'}`);
        if (r.requestPostData) {
          const { text, lang } = formatResponseBody(r.requestPostData, 50_000);
          parts.push(`- **Request Body:**\n\`\`\`${lang}\n${text}\n\`\`\``);
        }
        if (r.responseBody) {
          const { text, lang } = formatResponseBody(r.responseBody, 50_000);
          parts.push(`- **Response Body:**\n\`\`\`${lang}\n${text}\n\`\`\``);
        }
      }
    }

    // All API requests
    const apiRequests = allRequests.filter(r => isApiResource(r.resourceType));
    if (apiRequests.length > 0) {
      parts.push(`\n### All API Requests`);
      for (const r of apiRequests) {
        parts.push(`\n#### ${r.method} ${r.url}`);
        parts.push(`- Status: ${r.status ?? 'pending'} | Duration: ${r.durationMs}ms`);
        if (r.requestPostData) {
          const { text, lang } = formatResponseBody(r.requestPostData, 50_000);
          parts.push(`- **Request Body:**\n\`\`\`${lang}\n${text}\n\`\`\``);
        }
        if (r.responseBody) {
          const { text, lang } = formatResponseBody(r.responseBody, 50_000);
          parts.push(`- **Response Body:**\n\`\`\`${lang}\n${text}\n\`\`\``);
        }
      }
    }

    // Failed requests
    const failedRequests = allRequests.filter(r => r.status && r.status >= 400);
    if (failedRequests.length > 0) {
      parts.push(`\n### Failed Requests`);
      for (const r of failedRequests) {
        parts.push(`- ✗ ${r.method} ${r.url} → ${r.status}`);
        if (r.responseBody) parts.push(`  Response: ${r.responseBody.slice(0, 2000)}`);
      }
    }
    parts.push('');
  }

  // ── Console Output ──
  const consoleMessages = allActions.flatMap(a => a.console || []);
  if (consoleMessages.length > 0) {
    const errors = consoleMessages.filter(c => c.type === 'error');
    const warnings = consoleMessages.filter(c => c.type === 'warn' || c.type === 'warning');

    if (errors.length > 0 || warnings.length > 0) {
      parts.push(`## Console Output`);
      if (errors.length > 0) {
        parts.push(`\n### Errors (${errors.length})`);
        for (const e of errors) {
          const loc = e.location ? ` — ${e.location}` : '';
          parts.push(`- ${e.text}${loc}`);
        }
      }
      if (warnings.length > 0) {
        parts.push(`\n### Warnings (${warnings.length})`);
        for (const w of warnings) {
          parts.push(`- ${w.text}`);
        }
      }
      parts.push('');
    }
  }

  // ── Action Timeline ──
  if (allActions.length > 0) {
    parts.push(`## Action Timeline (${allActions.length} actions)`);
    for (let i = 0; i < allActions.length; i++) {
      const a = allActions[i];
      const status = a.error ? '✗ FAILED' : '✓';
      const netCount = a.network?.requests?.length || 0;
      const net = netCount > 0 ? ` [${netCount} req]` : '';
      const current = a === context.action ? ' ◄ FAILING' : '';
      parts.push(`${i + 1}. ${status} ${a.type}.${a.method}${net} (${a.timing?.durationMs || '?'}ms)${current}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
