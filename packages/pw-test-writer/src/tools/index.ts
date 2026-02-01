import Anthropic from '@anthropic-ai/sdk';
import { getBrowserSession } from '../browser/context.js';
import { store } from '../ui/store.js';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type Tool = Anthropic.Tool;

export const tools: Tool[] = [
  {
    name: 'browser_launch',
    description: 'Launch the browser. Call this first before any browser interactions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        headless: {
          type: 'boolean',
          description: 'Run in headless mode (default: false for visibility)',
        },
      },
      required: [],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL. Returns the page accessibility snapshot and all network requests made during navigation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element. Returns updated snapshot and any network requests triggered.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector or text selector (e.g., "text=Login", "button.submit")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill a text input field.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the input field',
        },
        value: {
          type: 'string',
          description: 'The value to fill',
        },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Get the current accessibility snapshot of the page.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_network_requests',
    description: 'Get all network requests collected so far, including method, URL, status, headers, and timing.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_console_messages',
    description: 'Get all console messages from the browser.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'write_pom',
    description: 'Write Page Object Model code. This defines locators and page-level methods.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Filename for the POM (e.g., "login.page.ts")',
        },
        code: {
          type: 'string',
          description: 'The Page Object Model TypeScript code',
        },
      },
      required: ['filename', 'code'],
    },
  },
  {
    name: 'write_business_layer',
    description: 'Write business layer code. This defines reusable action flows.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Filename for the business layer (e.g., "login.actions.ts")',
        },
        code: {
          type: 'string',
          description: 'The business layer TypeScript code',
        },
      },
      required: ['filename', 'code'],
    },
  },
  {
    name: 'write_test',
    description: 'Write the test specification file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Filename for the test (e.g., "login.spec.ts")',
        },
        code: {
          type: 'string',
          description: 'The test specification TypeScript code',
        },
      },
      required: ['filename', 'code'],
    },
  },
  {
    name: 'run_test',
    description: 'Run the generated test and return the results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Test file to run',
        },
      },
      required: ['filename'],
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to examine existing test files before writing new ones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file to read (relative to project root)',
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory. Useful to see existing test structure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Directory path to list (relative to project root)',
        },
      },
      required: ['directory'],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, any>
): Promise<string> {
  const s = store;
  const session = getBrowserSession();

  switch (name) {
    case 'browser_launch': {
      await session.launch(input.headless ?? false);
      return 'Browser launched successfully.';
    }

    case 'browser_navigate': {
      const { snapshot, requests } = await session.navigate(input.url);
      return formatNavigationResult(input.url, snapshot, requests);
    }

    case 'browser_click': {
      const { snapshot, requests } = await session.click(input.selector);
      return formatClickResult(input.selector, snapshot, requests);
    }

    case 'browser_fill': {
      const { snapshot, requests } = await session.fill(input.selector, input.value);
      return `Filled "${input.selector}" with "${input.value}"\n\nSnapshot:\n${snapshot}`;
    }

    case 'browser_snapshot': {
      const snapshot = await session.getSnapshot();
      return `Current page snapshot:\n${snapshot}`;
    }

    case 'get_network_requests': {
      const requests = session.getAllRequests();
      return formatAllRequests(requests);
    }

    case 'get_console_messages': {
      const messages = session.getConsoleMessages();
      return formatConsoleMessages(messages);
    }

    case 'write_pom': {
      const dir = 'tests/pages';
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, input.filename), input.code);
      s.setPomCode(input.code);
      return `POM written to ${dir}/${input.filename}`;
    }

    case 'write_business_layer': {
      const dir = 'tests/actions';
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, input.filename), input.code);
      s.setBusinessCode(input.code);
      return `Business layer written to ${dir}/${input.filename}`;
    }

    case 'write_test': {
      const dir = 'tests';
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, input.filename), input.code);
      s.setTestCode(input.code);
      return `Test written to ${dir}/${input.filename}`;
    }

    case 'run_test': {
      try {
        const { stdout, stderr } = await execAsync(
          `npx playwright test ${input.filename} --reporter=list`,
          { cwd: process.cwd() }
        );
        return `Test results:\n${stdout}\n${stderr}`;
      } catch (error: any) {
        return `Test failed:\n${error.stdout || ''}\n${error.stderr || ''}\n${error.message}`;
      }
    }

    case 'browser_close': {
      await session.close();
      return 'Browser closed.';
    }

    case 'read_file': {
      try {
        const content = await fs.promises.readFile(input.filepath, 'utf-8');
        return `File: ${input.filepath}\n\n${content}`;
      } catch (error: any) {
        return `Error reading file: ${error.message}`;
      }
    }

    case 'list_files': {
      try {
        const entries = await fs.promises.readdir(input.directory, { withFileTypes: true });
        let result = `Contents of ${input.directory}:\n\n`;
        for (const entry of entries) {
          const type = entry.isDirectory() ? '[DIR]' : '[FILE]';
          result += `${type} ${entry.name}\n`;
        }
        return result;
      } catch (error: any) {
        return `Error listing directory: ${error.message}`;
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

function formatNavigationResult(url: string, snapshot: string, requests: any[]): string {
  let result = `Navigated to: ${url}\n\n`;
  result += `## Network Requests (${requests.length})\n`;
  for (const req of requests.slice(0, 10)) {
    result += `- ${req.method} ${req.url} → ${req.status || 'pending'}\n`;
  }
  if (requests.length > 10) {
    result += `... and ${requests.length - 10} more\n`;
  }
  result += `\n## Page Snapshot\n${snapshot}`;
  return result;
}

function formatClickResult(selector: string, snapshot: string, requests: any[]): string {
  let result = `Clicked: ${selector}\n\n`;
  if (requests.length > 0) {
    result += `## Network Requests Triggered (${requests.length})\n`;
    for (const req of requests) {
      result += `- ${req.method} ${req.url} → ${req.status || 'pending'}\n`;
    }
  }
  result += `\n## Page Snapshot\n${snapshot}`;
  return result;
}

function formatAllRequests(requests: any[]): string {
  if (requests.length === 0) return 'No network requests captured.';

  let result = `## All Network Requests (${requests.length})\n\n`;
  for (const req of requests) {
    result += `### ${req.method} ${req.url}\n`;
    result += `- Status: ${req.status || 'pending'} ${req.statusText || ''}\n`;
    result += `- Type: ${req.resourceType}\n`;
    if (req.postData) {
      result += `- POST Data: ${req.postData.slice(0, 200)}${req.postData.length > 200 ? '...' : ''}\n`;
    }
    if (req.timing) {
      result += `- Duration: ${Math.round(req.timing.responseEnd)}ms\n`;
    }
    result += '\n';
  }
  return result;
}

function formatConsoleMessages(messages: any[]): string {
  if (messages.length === 0) return 'No console messages.';

  let result = `## Console Messages (${messages.length})\n\n`;
  for (const msg of messages) {
    result += `[${msg.type.toUpperCase()}] ${msg.text}\n`;
    if (msg.location?.url) {
      result += `  at ${msg.location.url}:${msg.location.lineNumber}\n`;
    }
  }
  return result;
}
