/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { MultiTraceModel, ActionTraceEventInContext } from '../ui/modelUtil';
import { DOMQueryTools } from './domQueryTools';
import { LocatorTools } from './locatorTools';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

/**
 * MCP Server for analyzing Playwright test traces
 * Provides tools for Claude to query historical test execution data
 */
export class TraceAnalysisMCPServer {
  private _currentTrace: MultiTraceModel | null = null;
  private _domQueryTools: DOMQueryTools;
  private _locatorTools: LocatorTools;

  constructor() {
    this._domQueryTools = new DOMQueryTools(() => this._currentTrace);
    this._locatorTools = new LocatorTools(() => this._currentTrace);
  }

  /**
   * Update the current trace being analyzed
   */
  setCurrentTrace(trace: MultiTraceModel | undefined) {
    this._currentTrace = trace || null;
  }

  /**
   * List all available MCP tools
   */
  listTools(): MCPTool[] {
    const baseTools: MCPTool[] = [
      {
        name: 'trace_get_test_info',
        description: 'Get basic test execution information including duration, browser, status',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'trace_get_errors',
        description: 'Get all errors that occurred during test execution with stack traces',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'trace_get_actions',
        description: 'Get list of all Playwright actions (clicks, fills, navigations, etc.) with timestamps',
        inputSchema: {
          type: 'object',
          properties: {
            fromTimestamp: {
              type: 'number',
              description: 'Filter actions after this timestamp (ms)',
            },
            toTimestamp: {
              type: 'number',
              description: 'Filter actions before this timestamp (ms)',
            },
            actionType: {
              type: 'string',
              description: 'Filter by action type (click, fill, goto, etc.)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of actions to return',
            },
          },
        },
      },
      {
        name: 'trace_get_action_details',
        description: 'Get detailed information about a specific action including parameters and result',
        inputSchema: {
          type: 'object',
          properties: {
            actionId: {
              type: 'string',
              description: 'Action ID or index',
            },
          },
          required: ['actionId'],
        },
      },
      {
        name: 'trace_get_network_requests',
        description: 'Get network requests made during test execution with filtering options',
        inputSchema: {
          type: 'object',
          properties: {
            urlPattern: {
              type: 'string',
              description: 'Filter by URL pattern (supports wildcards)',
            },
            method: {
              type: 'string',
              description: 'Filter by HTTP method (GET, POST, etc.)',
            },
            statusCode: {
              type: 'number',
              description: 'Filter by response status code',
            },
            failed: {
              type: 'boolean',
              description: 'Show only failed requests',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of requests to return',
            },
          },
        },
      },
      {
        name: 'trace_get_console_logs',
        description: 'Get browser console logs from test execution',
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              description: 'Filter by log level (log, info, warn, error)',
            },
            search: {
              type: 'string',
              description: 'Search logs by text content',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of logs to return',
            },
          },
        },
      },
      {
        name: 'trace_get_screenshots',
        description: 'Get information about screenshots taken during test',
        inputSchema: {
          type: 'object',
          properties: {
            timestamp: {
              type: 'number',
              description: 'Get screenshot closest to this timestamp',
            },
            actionId: {
              type: 'string',
              description: 'Get screenshot for specific action',
            },
          },
        },
      },
      {
        name: 'trace_get_timeline',
        description: 'Get chronological timeline of test events (actions, network, console) at specific timestamp',
        inputSchema: {
          type: 'object',
          properties: {
            timestamp: {
              type: 'number',
              description: 'Get all events up to this timestamp',
            },
            windowMs: {
              type: 'number',
              description: 'Time window in ms (get events within timestamp ± windowMs)',
            },
          },
          required: ['timestamp'],
        },
      },
      {
        name: 'trace_get_test_source',
        description: 'Get the source code of the test file that generated this trace',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'trace_propose_fix',
        description: 'Analyze test failure and propose a code fix with explanation',
        inputSchema: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              description: 'Error object from trace_get_errors',
            },
            testSource: {
              type: 'string',
              description: 'Source code of the test',
            },
            filePath: {
              type: 'string',
              description: 'Path to the test file',
            },
            selectedAction: {
              type: 'object',
              description: 'Currently selected action context',
            },
          },
          required: ['error', 'testSource', 'filePath'],
        },
      },
      {
        name: 'trace_apply_fix',
        description: 'Apply a proposed fix to the test file',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the file to modify',
            },
            oldCode: {
              type: 'string',
              description: 'Code to replace',
            },
            newCode: {
              type: 'string',
              description: 'Replacement code',
            },
          },
          required: ['filePath', 'oldCode', 'newCode'],
        },
      },
    ];

    // Merge tools from all modules
    return [
      ...baseTools,
      ...this._domQueryTools.getTools(),
      ...this._locatorTools.getTools(),
    ];
  }

  /**
   * Execute an MCP tool
   */
  async callTool(name: string, args: any): Promise<MCPToolResult> {
    if (!this._currentTrace) {
      return {
        content: [{
          type: 'text',
          text: 'No trace data available. Please select a test to analyze.',
        }],
        isError: true,
      };
    }

    try {
      // Route to appropriate tool handler
      if (name.startsWith('trace_')) {
        // Base trace data tools
        switch (name) {
          case 'trace_get_test_info':
            return this.getTestInfo();
          case 'trace_get_errors':
            return this.getErrors();
          case 'trace_get_actions':
            return this.getActions(args);
          case 'trace_get_action_details':
            return this.getActionDetails(args);
          case 'trace_get_network_requests':
            return this.getNetworkRequests(args);
          case 'trace_get_console_logs':
            return this.getConsoleLogs(args);
          case 'trace_get_screenshots':
            return this.getScreenshots(args);
          case 'trace_get_timeline':
            return this.getTimeline(args);
          case 'trace_get_test_source':
            return await this.getTestSource();
          case 'trace_propose_fix':
            return this.proposeFix(args);
          case 'trace_apply_fix':
            return this.applyFix(args);
        }
      }

      // Check DOM query tools
      const domTools = this._domQueryTools.getTools().map(t => t.name);
      if (domTools.includes(name)) {
        return await this._domQueryTools.callTool(name, args);
      }

      // Check locator tools
      const locatorToolNames = this._locatorTools.getTools().map(t => t.name);
      if (locatorToolNames.includes(name)) {
        return await this._locatorTools.callTool(name, args);
      }

      // Unknown tool
      return {
        content: [{
          type: 'text',
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  private getTestInfo(): MCPToolResult {
    const trace = this._currentTrace!;
    const duration = trace.endTime - trace.startTime;
    const hasErrors = trace.errorDescriptors.length > 0;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          browserName: trace.browserName,
          channel: trace.channel,
          platform: trace.platform,
          title: trace.title,
          startTime: trace.startTime,
          endTime: trace.endTime,
          duration: duration,
          durationFormatted: `${(duration / 1000).toFixed(2)}s`,
          totalActions: trace.actions.length,
          totalErrors: trace.errorDescriptors.length,
          hasErrors,
          sdkLanguage: trace.sdkLanguage,
        }, null, 2),
      }],
    };
  }

  private getErrors(): MCPToolResult {
    const trace = this._currentTrace!;

    if (trace.errorDescriptors.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify([], null, 2),
        }],
      };
    }

    const errors = trace.errorDescriptors.map((error, index) => ({
      index: index + 1,
      message: error.message,
      stack: error.stack?.map(frame => ({
        file: frame.file,
        line: frame.line,
        column: frame.column,
        function: frame.function,
      })),
      actionBefore: error.action ? {
        type: error.action.method,
        params: error.action.params,
        callId: error.action.callId,
      } : null,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(errors, null, 2),
      }],
    };
  }

  private getActions(args: any): MCPToolResult {
    const trace = this._currentTrace!;
    let actions = [...trace.actions];

    // Filter by timestamp
    if (args.fromTimestamp !== undefined) {
      actions = actions.filter(a => a.startTime >= args.fromTimestamp);
    }
    if (args.toTimestamp !== undefined) {
      actions = actions.filter(a => a.startTime <= args.toTimestamp);
    }

    // Filter by action type
    if (args.actionType) {
      actions = actions.filter(a => a.method === args.actionType);
    }

    // Limit results
    if (args.limit) {
      actions = actions.slice(0, args.limit);
    }

    const result = actions.map((action, index) => ({
      index: index + 1,
      callId: action.callId,
      type: action.method,
      params: action.params,
      startTime: action.startTime,
      endTime: action.endTime,
      duration: action.endTime - action.startTime,
      error: action.error?.error?.message,
      log: action.log,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  private getActionDetails(args: any): MCPToolResult {
    const trace = this._currentTrace!;
    const action = this.findAction(args.actionId);

    if (!action) {
      return {
        content: [{
          type: 'text',
          text: `Action not found: ${args.actionId}`,
        }],
        isError: true,
      };
    }

    const result = {
      callId: action.callId,
      type: action.method,
      params: action.params,
      startTime: action.startTime,
      endTime: action.endTime,
      duration: action.endTime - action.startTime,
      error: action.error,
      log: action.log,
      result: action.result,
      stack: action.stack,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  private getNetworkRequests(args: any): MCPToolResult {
    const trace = this._currentTrace!;
    const events = trace.events.filter((e: any) =>
      e.method === 'Network.requestWillBeSent' ||
      e.method === 'Network.responseReceived'
    );

    // Group by request ID
    const requests = new Map<string, any>();
    for (const event of events) {
      const requestId = (event as any).params?.requestId;
      if (!requestId) continue;

      if (!requests.has(requestId)) {
        requests.set(requestId, {});
      }
      const req = requests.get(requestId)!;

      if ((event as any).method === 'Network.requestWillBeSent') {
        const params = (event as any).params;
        req.url = params.request?.url;
        req.method = params.request?.method;
        req.timestamp = event.time;
      } else if ((event as any).method === 'Network.responseReceived') {
        const params = (event as any).params;
        req.statusCode = params.response?.status;
        req.statusText = params.response?.statusText;
      }
    }

    let result = Array.from(requests.values()).filter(r => r.url);

    // Filter by URL pattern
    if (args.urlPattern) {
      const pattern = args.urlPattern.replace(/\*/g, '.*');
      const regex = new RegExp(pattern);
      result = result.filter(r => regex.test(r.url));
    }

    // Filter by method
    if (args.method) {
      result = result.filter(r => r.method === args.method);
    }

    // Filter by status code
    if (args.statusCode !== undefined) {
      result = result.filter(r => r.statusCode === args.statusCode);
    }

    // Filter failed
    if (args.failed) {
      result = result.filter(r => r.statusCode >= 400);
    }

    // Limit
    if (args.limit) {
      result = result.slice(0, args.limit);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  private getConsoleLogs(args: any): MCPToolResult {
    const trace = this._currentTrace!;
    let logs = trace.events
      .filter((e: any) => e.method === '__console__')
      .map((e: any) => ({
        type: e.params?.type,
        text: e.params?.text,
        timestamp: e.time,
        location: e.params?.location,
      }));

    // Filter by level
    if (args.level && args.level !== 'all') {
      logs = logs.filter(l => l.type === args.level);
    }

    // Search
    if (args.search) {
      logs = logs.filter(l => l.text?.includes(args.search));
    }

    // Limit
    if (args.limit) {
      logs = logs.slice(0, args.limit);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(logs, null, 2),
      }],
    };
  }

  private getScreenshots(args: any): MCPToolResult {
    const trace = this._currentTrace!;
    let screenshots = trace.attachments
      .filter(a => a.name.includes('screenshot'))
      .map(a => ({
        name: a.name,
        path: a.path,
        contentType: a.contentType,
        timestamp: (a as any).timestamp,
      }));

    if (args.timestamp) {
      // Find closest screenshot
      screenshots = screenshots
        .map(s => ({
          ...s,
          distance: Math.abs((s.timestamp || 0) - args.timestamp),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 1);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(screenshots, null, 2),
      }],
    };
  }

  private getTimeline(args: any): MCPToolResult {
    const trace = this._currentTrace!;
    const timestamp = args.timestamp;
    const window = args.windowMs || 0;

    const minTime = timestamp - window;
    const maxTime = timestamp + window;

    const actionsInWindow = trace.actions
      .filter(a => a.startTime >= minTime && a.startTime <= maxTime)
      .map(a => ({
        type: 'action',
        action: a.method,
        params: a.params,
        time: a.startTime,
        error: a.error?.error?.message,
      }));

    const consoleInWindow = trace.events
      .filter((e: any) => e.method === '__console__' && e.time >= minTime && e.time <= maxTime)
      .map((e: any) => ({
        type: 'console',
        level: e.params?.type,
        text: e.params?.text,
        time: e.time,
      }));

    const timeline = [...actionsInWindow, ...consoleInWindow]
      .sort((a, b) => a.time - b.time);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(timeline, null, 2),
      }],
    };
  }

  private findAction(actionId: string): ActionTraceEventInContext | undefined {
    const trace = this._currentTrace!;

    // Try by callId
    let action = trace.actions.find(a => a.callId === actionId);
    if (action) return action;

    // Try by index
    const index = parseInt(actionId);
    if (!isNaN(index) && index > 0 && index <= trace.actions.length) {
      return trace.actions[index - 1];
    }

    return undefined;
  }

  /**
   * Extract just the failing test block from full source
   */
  private extractFailingTest(fullSource: string, testName: string, errorLine?: number): string {
    const lines = fullSource.split('\n');

    // Strategy 1: Find by test name
    if (testName) {
      // Look for test('testName' or test.only('testName' or test.skip('testName'
      const testPattern = new RegExp(`test(?:\\.(?:only|skip|fixme))?\\s*\\(\\s*['"\`]${this.escapeRegex(testName)}['"\`]`);

      for (let i = 0; i < lines.length; i++) {
        if (testPattern.test(lines[i])) {
          // Found the test start - now find the end
          return this.extractTestBlock(lines, i);
        }
      }
    }

    // Strategy 2: Use error line to find containing test
    if (errorLine && errorLine > 0 && errorLine <= lines.length) {
      // Search backwards from error line to find test start
      for (let i = errorLine - 1; i >= 0; i--) {
        if (/test(?:\.(?:only|skip|fixme))?\s*\(\s*['"`]/.test(lines[i])) {
          return this.extractTestBlock(lines, i);
        }
      }
    }

    // Fallback: return full source
    return fullSource;
  }

  /**
   * Extract a test block starting from a given line
   */
  private extractTestBlock(lines: string[], startLine: number): string {
    const result: string[] = [];
    let braceCount = 0;
    let inTest = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      result.push(line);

      // Count braces to find the end of the test
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          inTest = true;
        } else if (char === '}') {
          braceCount--;
          if (inTest && braceCount === 0) {
            // Found the closing brace of the test
            return result.join('\n');
          }
        }
      }
    }

    // If we didn't find a proper end, return what we got
    return result.join('\n');
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async getTestSource(): Promise<MCPToolResult> {
    const trace = this._currentTrace!;

    // Extract test file path from trace metadata
    // The title usually contains "file.spec.ts:line › test name"
    const title = trace.title || '';
    let testFile = 'unknown.spec.ts';
    let testSource = '';
    let fullSource = '';

    // Try to parse file path and test name from title
    const fileMatch = title.match(/^([^›]+\.spec\.[tj]s)/);
    if (fileMatch) {
      testFile = fileMatch[1].trim();
    }

    // Extract test name from title (after the ›)
    const testNameMatch = title.match(/›\s*(.+)$/);
    const testName = testNameMatch ? testNameMatch[1].trim() : '';

    // Try to get source from stack trace
    const firstError = trace.errorDescriptors[0];
    let errorLine: number | undefined;

    if (firstError?.stack && firstError.stack.length > 0) {
      // Get file path and line number from first stack frame
      const stackFrame = firstError.stack[0];
      if (stackFrame.file) {
        testFile = stackFrame.file;
        errorLine = stackFrame.line;
      }
    }

    // Try to fetch the actual source file
    try {
      const response = await fetch(`file?path=${encodeURIComponent(testFile)}`);
      if (response.ok) {
        fullSource = await response.text();

        // Extract just the failing test block
        testSource = this.extractFailingTest(fullSource, testName, errorLine);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              filePath: testFile,
              source: testSource,
              fullSource: fullSource, // Keep full source for reference
              testName: testName,
              errorLine: errorLine,
              hasRealSource: true,
            }, null, 2),
          }],
        };
      }
    } catch (error) {
      // File fetch failed, fall through to extraction
      console.warn('Failed to fetch test source file:', error);
    }

    // Fallback: Try to extract code from the action that failed
    if (firstError?.action) {
      const failedAction = firstError.action;
      const params = failedAction.params;

      // Build approximate source code from the action
      const selector = params?.selector || '';
      const method = failedAction.method || '';

      if (method && selector) {
        testSource = `// Failing action:\nawait ${selector}.${method}();`;
      }
    }

    // If we couldn't extract anything useful, provide the error context
    if (!testSource && firstError) {
      testSource = `// Error: ${firstError.message}\n// Location: ${testFile}`;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          filePath: testFile,
          source: testSource || '// Source code not available from trace',
          hasRealSource: false, // Flag indicating this is extracted, not actual source
        }, null, 2),
      }],
    };
  }

  private proposeFix(args: any): MCPToolResult {
    try {
      const error = args.error;
      const testSource = args.testSource || '';
      const filePath = args.filePath || 'unknown.spec.ts';

      // QA Expert System Prompt (embedded logic)
      // Analyze the error and propose a fix following Playwright best practices

      // Parse error message to determine issue type
      const errorMessage = error?.message || '';
      const errorStack = error?.stack || [];
      let issue = 'Unknown test failure';
      let explanation = '';
      let oldCode = '';
      let newCode = '';
      let confidence: 'high' | 'medium' | 'low' = 'medium';

      // Extract the actual selector that failed from the error message
      // Common patterns:
      // - "waiting for getByRole('button', { name: 'X' })"
      // - "waiting for locator('.class')"
      const selectorMatch = errorMessage.match(/waiting for (getBy\w+\([^)]+\)|locator\([^)]+\))/);
      const failedSelector = selectorMatch ? selectorMatch[1] : null;

      // Selector-related errors
      if (errorMessage.includes('Timeout') || errorMessage.includes('waiting for')) {

        if (failedSelector) {
          // We have the actual failing selector!
          oldCode = `await page.${failedSelector}.click();`;

          // Analyze the selector type
          if (failedSelector.includes('getByRole')) {
            // Role-based selector is ALREADY best practice
            const nameMatch = failedSelector.match(/name:\s*['"]([^'"]+)['"]/);
            const roleName = nameMatch ? nameMatch[1] : 'NonExistentButton';

            issue = `Element not found: Button with name "${roleName}" doesn't exist`;
            explanation = `The test is using the recommended getByRole() locator, which is great! However, the element doesn't exist on the page.

**Root causes:**
1. The button name "${roleName}" is wrong - check the actual text on the button
2. The button doesn't exist at all on this page
3. The button appears after navigation or async loading

**Debugging steps:**
1. Inspect the page manually - does this button exist?
2. Check the button's actual visible text
3. Look for console errors that might prevent the button from rendering
4. Consider if you're on the right page (check URL)`;

            newCode = `// Option 1: Fix the button name if it's wrong\nawait page.getByRole('button', { name: 'CorrectButtonText' }).click();\n\n// Option 2: Wait for navigation first\nawait page.waitForURL(/expected-url/);\nawait page.${failedSelector}.click();\n\n// Option 3: Check if button exists\nawait expect(page.${failedSelector}).toBeVisible();`;

            confidence = 'high';

          } else if (failedSelector.includes('locator')) {
            // CSS/XPath selector - suggest improvement
            const cssMatch = failedSelector.match(/locator\(['"]([^'"]+)['"]\)/);
            const cssSelector = cssMatch ? cssMatch[1] : '.unknown';

            issue = `Brittle CSS selector: "${cssSelector}"`;
            explanation = `You're using a CSS selector which is fragile and prone to breaking when the UI changes.

**Why this is bad:**
• CSS classes change when designers update styles
• IDs might be auto-generated or unstable
• Position-based selectors break easily

**Playwright best practices:**
1. Use getByRole() for interactive elements (buttons, links, inputs)
2. Use getByLabel() for form fields
3. Use getByTestId() if no semantic option exists
4. Only use CSS as a last resort`;

            // Suggest getByRole alternative
            if (cssSelector.includes('button') || cssSelector.includes('btn')) {
              newCode = `await page.getByRole('button', { name: /text on button/i }).click();`;
            } else if (cssSelector.includes('input')) {
              newCode = `await page.getByLabel('Field label').fill('value');`;
            } else {
              newCode = `// Add data-testid="unique-id" to the element\nawait page.getByTestId('unique-id').click();`;
            }

            confidence = 'high';

          } else if (failedSelector.includes('getByText')) {
            // Text-based selector
            const textMatch = failedSelector.match(/getByText\(['"]([^'"]+)['"]\)/);
            const searchText = textMatch ? textMatch[1] : 'text';

            issue = `Text not found: "${searchText}"`;
            explanation = `The text "${searchText}" doesn't exist on the page. This could mean:
1. The text is slightly different (typo, case, extra spaces)
2. The text appears after async loading
3. The text is in a different language/locale
4. You're on the wrong page`;

            newCode = `// Option 1: Use partial match with regex\nawait page.getByText(/${searchText}/i).click();\n\n// Option 2: Use getByRole if it's a button/link\nawait page.getByRole('button', { name: /${searchText}/ }).click();\n\n// Option 3: Wait for it to appear\nawait page.waitForSelector('text=${searchText}');`;

            confidence = 'medium';
          }

        } else {
          // Couldn't extract selector - generic advice
          issue = 'Timeout waiting for element';
          explanation = 'The test timed out while waiting for an element. Use best-practice selectors and verify the element exists.';
          oldCode = testSource || '// Code not available';
          newCode = '// 1. Verify element exists\n// 2. Use getByRole() for interactive elements\n// 3. Add explicit waits if needed';
          confidence = 'low';
        }

      } else if (errorMessage.includes('multiple elements')) {
        issue = 'Selector matches multiple elements';
        explanation = `The locator is matching multiple elements on the page. We should make it more specific by:
1. Using .first() if we want the first match
2. Adding more specific role or text matchers
3. Using data-testid for unique identification`;
        oldCode = "await page.locator('.btn').click()";
        newCode = "await page.locator('.btn').first().click()";
        confidence = 'medium';
      } else {
        // Generic error
        issue = 'Test assertion or action failed';
        explanation = 'The test failed but the root cause needs more investigation. Consider adding explicit waits or improving selectors.';

        // Safely extract last few lines
        if (typeof testSource === 'string' && testSource.length > 0) {
          const lines = testSource.split('\n');
          oldCode = lines.slice(-3).join('\n');
        } else {
          oldCode = '// Test source not available';
        }
        newCode = '// Manual review needed - add appropriate fix';
        confidence = 'low';
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            issue,
            explanation,
            diff: {
              oldCode,
              newCode,
            },
            confidence,
            filePath,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error in proposeFix: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  private applyFix(args: any): MCPToolResult {
    const filePath = args.filePath;
    const oldCode = args.oldCode;
    const newCode = args.newCode;

    // In a real implementation, this would:
    // 1. Read the file from disk
    // 2. Replace oldCode with newCode
    // 3. Write back to disk
    // 4. Return success/failure

    // For prototype, we'll simulate success
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          filePath,
          message: 'Fix applied successfully (simulated)',
          note: 'In production, this would modify the actual test file',
        }, null, 2),
      }],
    };
  }
}
