import { chromium, Browser, BrowserContext, Page, Request, Response, ConsoleMessage } from 'playwright';
import { store } from '../ui/store.js';

export interface CollectedRequest {
  method: string;
  url: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  timing?: {
    startTime: number;
    responseEnd: number;
  };
}

export interface CollectedConsole {
  type: string;
  text: string;
  location: {
    url: string;
    lineNumber: number;
  };
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  private requests: Map<string, CollectedRequest> = new Map();
  private consoleMessages: CollectedConsole[] = [];
  private stepRequests: CollectedRequest[] = [];

  async launch(headless = false): Promise<void> {
    this.browser = await chromium.launch({ headless });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();
    this.setupListeners();
  }

  private setupListeners(): void {
    if (!this.page) return;

    // Collect network requests using channel data
    this.page.on('request', (request: Request) => {
      const data: CollectedRequest = {
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        headers: request.headers(),
        postData: request.postData() || undefined,
      };
      this.requests.set(request.url() + request.method(), data);
      this.stepRequests.push(data);

      // Update store
      store.addNetworkRequest({
        method: request.method(),
        url: request.url(),
      });
    });

    this.page.on('response', (response: Response) => {
      const request = response.request();
      const key = request.url() + request.method();
      const data = this.requests.get(key);
      if (data) {
        data.status = response.status();
        data.statusText = response.statusText();
        data.responseHeaders = response.headers();

        // Update timing from channel
        const timing = request.timing();
        data.timing = {
          startTime: timing.startTime,
          responseEnd: timing.responseEnd,
        };
      }
    });

    // Collect console messages
    this.page.on('console', (msg: ConsoleMessage) => {
      const collected: CollectedConsole = {
        type: msg.type(),
        text: msg.text(),
        location: msg.location(),
      };
      this.consoleMessages.push(collected);

      // Update store
      store.addConsoleMessage({
        type: msg.type() as any,
        text: msg.text(),
      });
    });
  }

  getPage(): Page | null {
    return this.page;
  }

  // Get requests since last call (for step-by-step tracking)
  getStepRequests(): CollectedRequest[] {
    const requests = [...this.stepRequests];
    this.stepRequests = [];
    return requests;
  }

  // Get all collected requests
  getAllRequests(): CollectedRequest[] {
    return Array.from(this.requests.values());
  }

  // Get console messages
  getConsoleMessages(): CollectedConsole[] {
    return [...this.consoleMessages];
  }

  // Clear step data (call before each action)
  clearStepData(): void {
    this.stepRequests = [];
  }

  // Get page snapshot using locator-based approach
  async getSnapshot(): Promise<string> {
    if (!this.page) return '';

    // Get page info
    const url = this.page.url();
    const title = await this.page.title();

    // Get interactive elements using Playwright's locator system
    const snapshot = await this.page.evaluate(() => {
      const elements: string[] = [];

      // Get all interactive elements
      const interactiveSelectors = [
        'a[href]',
        'button',
        'input',
        'select',
        'textarea',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[onclick]',
      ];

      const seen = new Set<Element>();

      for (const selector of interactiveSelectors) {
        const els = document.querySelectorAll(selector);
        els.forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);

          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || tag;
          const text = (el.textContent || '').trim().slice(0, 50);
          const name = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || text;
          const type = el.getAttribute('type') || '';
          const value = (el as HTMLInputElement).value || '';

          let desc = `- ${role}`;
          if (name) desc += ` "${name}"`;
          if (type) desc += ` [type=${type}]`;
          if (value && type !== 'password') desc += `: ${value.slice(0, 30)}`;

          elements.push(desc);
        });
      }

      return elements.join('\n');
    });

    return `Page: ${title}\nURL: ${url}\n\nElements:\n${snapshot}`;
  }

  async navigate(url: string): Promise<{ snapshot: string; requests: CollectedRequest[] }> {
    if (!this.page) throw new Error('Browser not launched');
    this.clearStepData();
    await this.page.goto(url, { waitUntil: 'networkidle' });
    return {
      snapshot: await this.getSnapshot(),
      requests: this.getStepRequests(),
    };
  }

  async click(selector: string): Promise<{ snapshot: string; requests: CollectedRequest[] }> {
    if (!this.page) throw new Error('Browser not launched');
    this.clearStepData();
    await this.page.click(selector);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    return {
      snapshot: await this.getSnapshot(),
      requests: this.getStepRequests(),
    };
  }

  async fill(selector: string, value: string): Promise<{ snapshot: string; requests: CollectedRequest[] }> {
    if (!this.page) throw new Error('Browser not launched');
    this.clearStepData();
    await this.page.fill(selector, value);
    return {
      snapshot: await this.getSnapshot(),
      requests: this.getStepRequests(),
    };
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}

// Singleton instance
let session: BrowserSession | null = null;

export function getBrowserSession(): BrowserSession {
  if (!session) {
    session = new BrowserSession();
  }
  return session;
}
