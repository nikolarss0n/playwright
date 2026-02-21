import { renderActionCapture } from './actionCapture.js';
import type { BrowserContext } from './context.js';
import type { ToolDef, ToolResult } from '../tools.js';
import type { McpActionCapture, TabSnapshot } from './types.js';

// ── Tool definitions ──

export const browserToolDefs: ToolDef[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the browser. Launches the browser if not already open.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_navigate_back',
    description: 'Navigate back in browser history.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Capture an ARIA accessibility snapshot of the current page. Returns the page structure with [ref=X] markers that can be used with other browser tools to interact with elements.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page using its ref from a snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Human-readable description of the element to click' },
        ref: { type: 'string', description: 'Element ref from the page snapshot' },
      },
      required: ['element', 'ref'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input field.',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Human-readable description of the element to type into' },
        ref: { type: 'string', description: 'Element ref from the page snapshot' },
        text: { type: 'string', description: 'Text to type' },
        submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
      },
      required: ['element', 'ref', 'text'],
    },
  },
  {
    name: 'browser_fill_form',
    description: 'Fill multiple form fields in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        values: {
          type: 'array',
          description: 'Array of field values to fill',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Element ref from the page snapshot' },
              element: { type: 'string', description: 'Human-readable description of the field' },
              value: { type: 'string', description: 'Value to fill' },
            },
            required: ['ref', 'element', 'value'],
          },
        },
      },
      required: ['values'],
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select an option from a dropdown element.',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Human-readable description of the dropdown' },
        ref: { type: 'string', description: 'Element ref from the page snapshot' },
        value: { type: 'string', description: 'Value or label of the option to select' },
      },
      required: ['element', 'ref', 'value'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a key or key combination (e.g. Enter, Escape, Tab, ArrowDown, Control+a).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g. "Enter", "Escape", "Tab", "ArrowDown", "Control+a")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Human-readable description of the element to hover over' },
        ref: { type: 'string', description: 'Element ref from the page snapshot' },
      },
      required: ['element', 'ref'],
    },
  },
  {
    name: 'browser_take_screenshot',
    description: 'Take a screenshot of the current page.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser and clean up resources.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Handlers ──

export async function handleBrowserTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BrowserContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'browser_navigate': return await handleNavigate(args, ctx);
      case 'browser_navigate_back': return await handleNavigateBack(ctx);
      case 'browser_snapshot': return await handleSnapshot(ctx);
      case 'browser_click': return await handleClick(args, ctx);
      case 'browser_type': return await handleType(args, ctx);
      case 'browser_fill_form': return await handleFillForm(args, ctx);
      case 'browser_select_option': return await handleSelectOption(args, ctx);
      case 'browser_press_key': return await handlePressKey(args, ctx);
      case 'browser_hover': return await handleHover(args, ctx);
      case 'browser_take_screenshot': return await handleScreenshot(ctx);
      case 'browser_close': return await handleClose(ctx);
      default: return error(`Unknown browser tool: ${name}`);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return error(message);
  }
}

// ── Individual handlers ──

async function handleNavigate(args: Record<string, unknown>, ctx: BrowserContext): Promise<ToolResult> {
  const url = args.url as string;
  if (!url)
    return error('url is required');

  const tab = await ctx.ensureTab();
  await tab.navigate(url);
  const snapshot = await tab.captureSnapshot();
  return buildSnapshotResult(`Navigated to ${url}`, snapshot);
}

async function handleNavigateBack(ctx: BrowserContext): Promise<ToolResult> {
  const tab = ctx.currentTabOrDie();
  const capture = await tab.waitForCompletion(async () => {
    await tab.page.goBack();
  });
  const snapshot = await tab.captureSnapshot();
  return buildActionResult('Navigated back', capture, snapshot);
}

async function handleSnapshot(ctx: BrowserContext): Promise<ToolResult> {
  const tab = ctx.currentTabOrDie();
  const snapshot = await tab.captureSnapshot();
  return buildSnapshotResult('Page snapshot captured', snapshot);
}

async function handleClick(args: Record<string, unknown>, ctx: BrowserContext): Promise<ToolResult> {
  const element = args.element as string;
  const ref = args.ref as string;
  if (!element || !ref)
    return error('element and ref are required');

  const tab = ctx.currentTabOrDie();
  const locator = await tab.refLocator({ element, ref });
  const capture = await tab.waitForCompletion(async () => {
    await locator.click();
  });
  const snapshot = await tab.captureSnapshot();
  return buildActionResult(`Clicked ${element}`, capture, snapshot);
}

async function handleType(args: Record<string, unknown>, ctx: BrowserContext): Promise<ToolResult> {
  const element = args.element as string;
  const ref = args.ref as string;
  const text = args.text as string;
  const submit = args.submit as boolean | undefined;
  if (!element || !ref || text === undefined)
    return error('element, ref, and text are required');

  const tab = ctx.currentTabOrDie();
  const locator = await tab.refLocator({ element, ref });
  const capture = await tab.waitForCompletion(async () => {
    await locator.fill(text);
    if (submit)
      await locator.press('Enter');
  });
  const snapshot = await tab.captureSnapshot();
  const desc = submit ? `Typed "${text}" and submitted` : `Typed "${text}"`;
  return buildActionResult(desc, capture, snapshot);
}

async function handleFillForm(args: Record<string, unknown>, ctx: BrowserContext): Promise<ToolResult> {
  const values = args.values as Array<{ ref: string; element: string; value: string }>;
  if (!values || !Array.isArray(values) || values.length === 0)
    return error('values array is required and must not be empty');

  const tab = ctx.currentTabOrDie();
  const capture = await tab.waitForCompletion(async () => {
    for (const field of values) {
      const locator = await tab.refLocator({ element: field.element, ref: field.ref });
      await locator.fill(field.value);
    }
  });
  const snapshot = await tab.captureSnapshot();
  return buildActionResult(`Filled ${values.length} field(s)`, capture, snapshot);
}

async function handleSelectOption(args: Record<string, unknown>, ctx: BrowserContext): Promise<ToolResult> {
  const element = args.element as string;
  const ref = args.ref as string;
  const value = args.value as string;
  if (!element || !ref || !value)
    return error('element, ref, and value are required');

  const tab = ctx.currentTabOrDie();
  const locator = await tab.refLocator({ element, ref });
  const capture = await tab.waitForCompletion(async () => {
    await locator.selectOption(value);
  });
  const snapshot = await tab.captureSnapshot();
  return buildActionResult(`Selected "${value}" in ${element}`, capture, snapshot);
}

async function handlePressKey(args: Record<string, unknown>, ctx: BrowserContext): Promise<ToolResult> {
  const key = args.key as string;
  if (!key)
    return error('key is required');

  const tab = ctx.currentTabOrDie();

  // Handle dialog dismissal
  const dialogState = tab.modalStates().find(s => s.type === 'dialog');
  if (dialogState?.dialog) {
    const dialog = dialogState.dialog;
    if (key === 'Enter')
      await dialog.accept();
    else
      await dialog.dismiss();
    tab.clearModalState(dialogState);
    const snapshot = await tab.captureSnapshot();
    return buildSnapshotResult(`Dismissed dialog with ${key}`, snapshot);
  }

  const capture = await tab.waitForCompletion(async () => {
    await tab.page.keyboard.press(key);
  });
  const snapshot = await tab.captureSnapshot();
  return buildActionResult(`Pressed ${key}`, capture, snapshot);
}

async function handleHover(args: Record<string, unknown>, ctx: BrowserContext): Promise<ToolResult> {
  const element = args.element as string;
  const ref = args.ref as string;
  if (!element || !ref)
    return error('element and ref are required');

  const tab = ctx.currentTabOrDie();
  const locator = await tab.refLocator({ element, ref });
  const capture = await tab.waitForCompletion(async () => {
    await locator.hover();
  });
  const snapshot = await tab.captureSnapshot();
  return buildActionResult(`Hovered over ${element}`, capture, snapshot);
}

async function handleScreenshot(ctx: BrowserContext): Promise<ToolResult> {
  const tab = ctx.currentTabOrDie();
  const buffer = await tab.page.screenshot({ type: 'png' });
  const base64 = buffer.toString('base64');
  return {
    content: [
      { type: 'image', data: base64, mimeType: 'image/png' },
      { type: 'text', text: `Screenshot of ${tab.page.url()}` },
    ],
  };
}

async function handleClose(ctx: BrowserContext): Promise<ToolResult> {
  await ctx.dispose();
  return text('Browser closed.');
}

// ── Response builders ──

function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] };
}

function error(msg: string): ToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function buildSnapshotResult(resultText: string, snapshot: TabSnapshot): ToolResult {
  const lines: string[] = [];
  lines.push(`### Result`);
  lines.push(resultText);
  lines.push('');

  appendPageState(lines, snapshot);

  return text(lines.join('\n'));
}

function buildActionResult(resultText: string, capture: McpActionCapture, snapshot: TabSnapshot): ToolResult {
  const lines: string[] = [];
  lines.push(`### Result`);
  lines.push(resultText);
  lines.push('');

  lines.push(...renderActionCapture(capture));
  appendPageState(lines, snapshot);

  return text(lines.join('\n'));
}

function appendPageState(lines: string[], snapshot: TabSnapshot) {
  lines.push('### Page state');
  lines.push(`- URL: ${snapshot.url}`);
  lines.push(`- Title: ${snapshot.title}`);
  lines.push('');

  if (snapshot.modalStates.length > 0) {
    lines.push('### Modal state');
    for (const state of snapshot.modalStates)
      lines.push(`- [${state.description}]: can be handled by the "${state.clearedBy}" tool`);
    lines.push('');
  }

  if (snapshot.ariaSnapshot) {
    lines.push('```yaml');
    lines.push(snapshot.ariaSnapshot);
    lines.push('```');
  }
}
