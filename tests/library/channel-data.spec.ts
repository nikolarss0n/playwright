/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * These tests verify that channels return correct, usable data.
 * Unlike channels.spec.ts which tests scope/hierarchy, these tests ensure
 * that the data flowing through the channel system is correct and complete.
 */

import { playwrightTest as it, expect } from '../config/browserTest';

it.describe('Page channel data', () => {
  it('should return correct page initializer data', async ({ page }) => {
    // Page initializer contains: mainFrame, viewportSize, isClosed, opener
    expect(page.mainFrame()).toBeTruthy();
    expect(page.isClosed()).toBe(false);
    expect(page.viewportSize()).toBeTruthy();
    expect(page.viewportSize()?.width).toBeGreaterThan(0);
    expect(page.viewportSize()?.height).toBeGreaterThan(0);
  });

  it('should return correct viewport data after resize', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: 800, height: 600 });
  });

  it('should provide usable frame from page', async ({ page, server }) => {
    await page.goto(server.EMPTY_PAGE);
    const frame = page.mainFrame();
    expect(frame.url()).toBe(server.EMPTY_PAGE);
    expect(frame.name()).toBe('');
    expect(frame.parentFrame()).toBeNull();
  });
});

it.describe('Request channel data', () => {
  it('should return correct request initializer data', async ({ page, server }) => {
    const [request] = await Promise.all([
      page.waitForRequest(server.EMPTY_PAGE),
      page.goto(server.EMPTY_PAGE),
    ]);

    // RequestInitializer: frame, url, resourceType, method, headers, isNavigationRequest
    expect(request.url()).toBe(server.EMPTY_PAGE);
    expect(request.method()).toBe('GET');
    expect(request.resourceType()).toBe('document');
    expect(request.isNavigationRequest()).toBe(true);
    expect(request.frame()).toBe(page.mainFrame());
    expect(Object.keys(request.headers()).length).toBeGreaterThan(0);
  });

  it('should return correct POST request data', async ({ page, server }) => {
    await page.goto(server.EMPTY_PAGE);

    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/post-endpoint')),
      page.evaluate(() => {
        return fetch('/post-endpoint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'value' }),
        }).catch(() => {});
      }),
    ]);

    expect(request.method()).toBe('POST');
    expect(request.postData()).toBe('{"key":"value"}');
    expect(request.postDataJSON()).toEqual({ key: 'value' });
  });

  it('should return correct headers data', async ({ page, server }) => {
    await page.setExtraHTTPHeaders({ 'X-Custom-Header': 'custom-value' });
    const [request] = await Promise.all([
      page.waitForRequest(server.EMPTY_PAGE),
      page.goto(server.EMPTY_PAGE),
    ]);

    const headers = request.headers();
    expect(headers['x-custom-header']).toBe('custom-value');
    expect(headers['user-agent']).toBeTruthy();
  });
});

it.describe('Response channel data', () => {
  it('should return correct response initializer data', async ({ page, server }) => {
    const response = await page.goto(server.EMPTY_PAGE);

    // ResponseInitializer: request, url, status, statusText, headers, timing
    expect(response).toBeTruthy();
    expect(response!.url()).toBe(server.EMPTY_PAGE);
    expect(response!.status()).toBe(200);
    expect(response!.statusText()).toBeTruthy();
    expect(response!.ok()).toBe(true);
    expect(response!.request()).toBeTruthy();
    expect(response!.request().url()).toBe(server.EMPTY_PAGE);
  });

  it('should return correct response headers', async ({ page, server }) => {
    server.setRoute('/headers', (req, res) => {
      res.setHeader('X-Custom-Response', 'response-value');
      res.setHeader('Content-Type', 'text/plain');
      res.end('Hello');
    });

    const response = await page.goto(server.PREFIX + '/headers');
    const headers = response!.headers();
    expect(headers['x-custom-response']).toBe('response-value');
    expect(headers['content-type']).toBe('text/plain');
  });

  it('should return usable response body', async ({ page, server }) => {
    server.setRoute('/body', (req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('Response body content');
    });

    const response = await page.goto(server.PREFIX + '/body');
    const text = await response!.text();
    expect(text).toBe('Response body content');
  });

  it('should return correct JSON body', async ({ page, server }) => {
    server.setRoute('/json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: 'hello', count: 42 }));
    });

    const response = await page.goto(server.PREFIX + '/json');
    const json = await response!.json();
    expect(json).toEqual({ message: 'hello', count: 42 });
  });

  it('should return correct binary body', async ({ page, server }) => {
    const response = await page.goto(server.PREFIX + '/digits/1.png');
    const body = await response!.body();
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('should return correct timing data', async ({ page, server }) => {
    const response = await page.goto(server.EMPTY_PAGE);
    const request = response!.request();
    const timing = request.timing();
    // startTime is an absolute timestamp
    expect(timing.startTime).toBeGreaterThan(0);
    // responseEnd is relative to startTime (in milliseconds)
    expect(timing.responseEnd).toBeGreaterThanOrEqual(0);
    // The timing object should have all the expected properties
    expect(typeof timing.domainLookupStart).toBe('number');
    expect(typeof timing.domainLookupEnd).toBe('number');
    expect(typeof timing.connectStart).toBe('number');
    expect(typeof timing.connectEnd).toBe('number');
    expect(typeof timing.requestStart).toBe('number');
    expect(typeof timing.responseStart).toBe('number');
  });
});

it.describe('Frame channel data', () => {
  it('should return correct frame initializer data', async ({ page, server }) => {
    // Use two-frames.html which has named iframes
    await page.goto(server.PREFIX + '/frames/two-frames.html');
    const frames = page.frames();
    expect(frames.length).toBe(3);

    const mainFrame = frames[0];
    expect(mainFrame.url()).toContain('two-frames.html');
    expect(mainFrame.name()).toBe('');
    expect(mainFrame.parentFrame()).toBeNull();

    // Find the 'uno' frame by name
    const unoFrame = page.frame('uno');
    expect(unoFrame).toBeTruthy();
    expect(unoFrame!.name()).toBe('uno');
    expect(unoFrame!.url()).toContain('frame.html');
    expect(unoFrame!.parentFrame()).toBe(mainFrame);
  });

  it('should allow working with frame content', async ({ page, server }) => {
    await page.goto(server.PREFIX + '/frames/one-frame.html');
    const frame = page.frames()[1];

    const content = await frame.content();
    expect(content).toContain('</html>');

    const title = await frame.title();
    expect(typeof title).toBe('string');
  });
});

it.describe('BrowserContext channel data', () => {
  it('should return correct browser context data', async ({ context }) => {
    // BrowserContext initializer contains tracing and requestContext
    expect(context.tracing).toBeTruthy();
    expect(context.request).toBeTruthy();
    expect(context.browser()).toBeTruthy();
  });

  it('should allow setting and getting cookies via channel', async ({ context, page, server }) => {
    await context.addCookies([{
      name: 'test-cookie',
      value: 'test-value',
      url: server.EMPTY_PAGE,
    }]);

    const cookies = await context.cookies();
    expect(cookies.length).toBe(1);
    expect(cookies[0].name).toBe('test-cookie');
    expect(cookies[0].value).toBe('test-value');
  });
});

it.describe('Browser channel data', () => {
  it('should return correct browser data', async ({ browser }) => {
    expect(browser.version()).toBeTruthy();
    expect(typeof browser.version()).toBe('string');
    expect(browser.isConnected()).toBe(true);
  });

  it('should list contexts correctly', async ({ browser }) => {
    const context = await browser.newContext();
    const contexts = browser.contexts();
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts).toContain(context);
    await context.close();
  });
});

it.describe('ElementHandle channel data', () => {
  it('should return correct element handle data', async ({ page, server }) => {
    await page.goto(server.PREFIX + '/dom.html');
    const element = await page.$('#outer');
    expect(element).toBeTruthy();

    // Verify we can work with the element data
    const box = await element!.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    const tagName = await element!.evaluate(el => el.tagName);
    expect(tagName).toBe('DIV');
  });

  it('should return correct content from elements', async ({ page }) => {
    await page.setContent('<div id="test">Hello World</div>');
    const element = await page.$('#test');
    const text = await element!.textContent();
    expect(text).toBe('Hello World');

    const innerHTML = await element!.innerHTML();
    expect(innerHTML).toBe('Hello World');
  });
});

it.describe('JSHandle channel data', () => {
  it('should return correct JS handle data', async ({ page }) => {
    const handle = await page.evaluateHandle(() => ({ nested: { value: 42 } }));
    expect(handle).toBeTruthy();

    const json = await handle.jsonValue();
    expect(json).toEqual({ nested: { value: 42 } });

    const properties = await handle.getProperties();
    expect(properties.size).toBe(1);
    expect(properties.has('nested')).toBe(true);

    await handle.dispose();
  });

  it('should handle primitive values correctly', async ({ page }) => {
    const stringHandle = await page.evaluateHandle(() => 'hello');
    expect(await stringHandle.jsonValue()).toBe('hello');

    const numberHandle = await page.evaluateHandle(() => 123.45);
    expect(await numberHandle.jsonValue()).toBe(123.45);

    const boolHandle = await page.evaluateHandle(() => true);
    expect(await boolHandle.jsonValue()).toBe(true);

    const nullHandle = await page.evaluateHandle(() => null);
    expect(await nullHandle.jsonValue()).toBe(null);
  });
});

it.describe('Route channel data', () => {
  it('should provide correct route request data', async ({ page, server }) => {
    let routeRequest: any;
    await page.route('**/intercept', route => {
      routeRequest = route.request();
      route.fulfill({ body: 'intercepted' });
    });

    await page.goto(server.EMPTY_PAGE);
    await page.evaluate(() => fetch('/intercept'));

    expect(routeRequest).toBeTruthy();
    expect(routeRequest.url()).toContain('/intercept');
    expect(routeRequest.method()).toBe('GET');
  });

  it('should allow modifying request via route', async ({ page, server }) => {
    let serverReceivedHeaders: any;
    server.setRoute('/modified', (req, res) => {
      serverReceivedHeaders = req.headers;
      res.end('ok');
    });

    await page.route('**/modified', route => {
      route.continue({
        headers: {
          ...route.request().headers(),
          'X-Modified': 'true',
        },
      });
    });

    await page.goto(server.EMPTY_PAGE);
    await page.evaluate(() => fetch('/modified'));

    expect(serverReceivedHeaders['x-modified']).toBe('true');
  });
});

it.describe('WebSocket channel data', () => {
  it('should provide correct websocket data', async ({ page, server }) => {
    const wsPromise = page.waitForEvent('websocket');
    await page.goto(server.EMPTY_PAGE);

    // Start a websocket connection (will fail but we can still verify the channel data)
    page.evaluate((port) => {
      new WebSocket(`ws://localhost:${port}/ws`);
    }, server.PORT).catch(() => {});

    const ws = await wsPromise;
    expect(ws).toBeTruthy();
    expect(ws.url()).toContain('/ws');
  });
});

it.describe('Tracing channel data', () => {
  it('should produce tracing data', async ({ context, page, server }, testInfo) => {
    const tracePath = testInfo.outputPath('trace.zip');

    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(server.EMPTY_PAGE);
    await page.setContent('<div>Traced content</div>');
    await context.tracing.stop({ path: tracePath });

    // Verify trace file was created and has content
    const fs = require('fs');
    expect(fs.existsSync(tracePath)).toBe(true);
    const stats = fs.statSync(tracePath);
    expect(stats.size).toBeGreaterThan(0);
  });
});

it.describe('Download channel data', () => {
  it('should provide correct download data', async ({ page, server }) => {
    server.setRoute('/download-file', (req, res) => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="file.txt"');
      res.end('Download content');
    });

    await page.goto(server.EMPTY_PAGE);
    await page.setContent(`<a href="${server.PREFIX}/download-file" download>Download</a>`);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('a'),
    ]);

    expect(download).toBeTruthy();
    expect(download.url()).toContain('/download-file');
    expect(download.suggestedFilename()).toBe('file.txt');

    // Verify we can work with the downloaded file
    const path = await download.path();
    expect(path).toBeTruthy();
  });
});

it.describe('Dialog channel data', () => {
  it('should provide correct dialog data', async ({ page }) => {
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('alert');
      expect(dialog.message()).toBe('Hello dialog');
      expect(dialog.defaultValue()).toBe('');
      dialog.accept();
    });

    await page.evaluate(() => alert('Hello dialog'));
  });

  it('should handle prompt with default value', async ({ page }) => {
    page.on('dialog', dialog => {
      expect(dialog.type()).toBe('prompt');
      expect(dialog.message()).toBe('Enter value');
      expect(dialog.defaultValue()).toBe('default');
      dialog.accept('custom');
    });

    const result = await page.evaluate(() => prompt('Enter value', 'default'));
    expect(result).toBe('custom');
  });
});

it.describe('Console channel data', () => {
  it('should provide correct console message data', async ({ page }) => {
    const messagePromise = page.waitForEvent('console');
    await page.evaluate(() => console.log('Test message', 42, { obj: true }));

    const message = await messagePromise;
    expect(message.type()).toBe('log');
    // Console text representation varies by browser - just verify it contains key parts
    expect(message.text()).toContain('Test message');
    expect(message.text()).toContain('42');
    // Location may or may not have url depending on how evaluate runs
    expect(message.location()).toBeTruthy();

    const args = message.args();
    expect(args.length).toBe(3);
    expect(await args[0].jsonValue()).toBe('Test message');
    expect(await args[1].jsonValue()).toBe(42);
    expect(await args[2].jsonValue()).toEqual({ obj: true });
  });
});

it.describe('Worker channel data', () => {
  it('should provide correct worker data', async ({ page, server }) => {
    const workerPromise = page.waitForEvent('worker');
    await page.goto(server.PREFIX + '/worker/worker.html');

    const worker = await workerPromise;
    expect(worker.url()).toContain('worker.js');

    // Verify we can evaluate in the worker
    const result = await worker.evaluate(() => 1 + 1);
    expect(result).toBe(2);
  });
});

it.describe('Complex channel data flows', () => {
  it('should handle request-response chain correctly', async ({ page, server }) => {
    server.setRedirect('/redirect', '/final');
    server.setRoute('/final', (req, res) => {
      res.setHeader('X-Final', 'true');
      res.end('Final destination');
    });

    const response = await page.goto(server.PREFIX + '/redirect');

    // Verify response chain
    expect(response!.url()).toContain('/final');
    expect(response!.status()).toBe(200);
    expect(response!.headers()['x-final']).toBe('true');

    // Verify request chain
    const request = response!.request();
    expect(request.url()).toContain('/final');

    const redirectedFrom = request.redirectedFrom();
    expect(redirectedFrom).toBeTruthy();
    expect(redirectedFrom!.url()).toContain('/redirect');

    const redirectedTo = redirectedFrom!.redirectedTo();
    expect(redirectedTo).toBe(request);
  });

  it('should handle frame hierarchy correctly', async ({ page, server }) => {
    await page.goto(server.PREFIX + '/frames/nested-frames.html');

    const frames = page.frames();
    expect(frames.length).toBeGreaterThan(2);

    // Verify frame hierarchy is correct
    const mainFrame = page.mainFrame();
    for (const frame of frames) {
      if (frame !== mainFrame) {
        let current = frame;
        while (current.parentFrame()) {
          current = current.parentFrame()!;
        }
        expect(current).toBe(mainFrame);
      }
    }
  });
});

it.describe('APIRequestContext channel data', () => {
  it('should return correct API response data', async ({ playwright, server }) => {
    const request = await playwright.request.newContext();
    try {
      server.setRoute('/api-test', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-API-Header', 'api-value');
        res.end(JSON.stringify({ success: true, data: [1, 2, 3] }));
      });

      const response = await request.get(server.PREFIX + '/api-test');

      expect(response.ok()).toBe(true);
      expect(response.status()).toBe(200);
      expect(response.url()).toContain('/api-test');
      expect(response.headers()['x-api-header']).toBe('api-value');
      expect(response.headers()['content-type']).toBe('application/json');

      const json = await response.json();
      expect(json).toEqual({ success: true, data: [1, 2, 3] });
    } finally {
      await request.dispose();
    }
  });

  it('should handle POST request data correctly', async ({ playwright, server }) => {
    const request = await playwright.request.newContext();
    try {
      let receivedBody = '';
      let receivedHeaders: any = {};
      server.setRoute('/api-post', (req, res) => {
        receivedHeaders = req.headers;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          receivedBody = body;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ received: true }));
        });
      });

      const response = await request.post(server.PREFIX + '/api-post', {
        data: { key: 'value', number: 42 },
        headers: { 'X-Custom': 'custom-value' },
      });

      expect(response.status()).toBe(200);
      expect(receivedBody).toContain('key');
      expect(receivedBody).toContain('value');
      expect(receivedHeaders['x-custom']).toBe('custom-value');
    } finally {
      await request.dispose();
    }
  });

  it('should return binary data correctly', async ({ playwright, server }) => {
    const request = await playwright.request.newContext();
    try {
      const response = await request.get(server.PREFIX + '/digits/1.png');
      const body = await response.body();
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    } finally {
      await request.dispose();
    }
  });
});

it.describe('Locator channel data', () => {
  it('should return correct locator element data', async ({ page }) => {
    await page.setContent(`
      <div id="container">
        <button class="btn" data-testid="submit">Submit</button>
        <input type="text" value="initial" placeholder="Enter text" />
        <select><option value="a">A</option><option value="b" selected>B</option></select>
      </div>
    `);

    const button = page.locator('button.btn');
    expect(await button.textContent()).toBe('Submit');
    expect(await button.getAttribute('data-testid')).toBe('submit');
    expect(await button.isVisible()).toBe(true);
    expect(await button.isEnabled()).toBe(true);

    const input = page.locator('input[type="text"]');
    expect(await input.inputValue()).toBe('initial');
    expect(await input.getAttribute('placeholder')).toBe('Enter text');

    const select = page.locator('select');
    expect(await select.inputValue()).toBe('b');
  });

  it('should handle multiple elements correctly', async ({ page }) => {
    await page.setContent(`
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
        <li>Item 3</li>
      </ul>
    `);

    const items = page.locator('li');
    expect(await items.count()).toBe(3);

    const texts = await items.allTextContents();
    expect(texts).toEqual(['Item 1', 'Item 2', 'Item 3']);

    expect(await items.first().textContent()).toBe('Item 1');
    expect(await items.last().textContent()).toBe('Item 3');
    expect(await items.nth(1).textContent()).toBe('Item 2');
  });

  it('should return correct bounding box data', async ({ page }) => {
    await page.setContent('<div style="width: 100px; height: 50px; margin: 10px;">Box</div>');
    const box = await page.locator('div').boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBe(100);
    expect(box!.height).toBe(50);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
  });

  it('should filter and chain locators correctly', async ({ page }) => {
    await page.setContent(`
      <div class="parent">
        <span class="child status-active">Active Child</span>
        <span class="child status-inactive">Inactive Child</span>
      </div>
    `);

    const parent = page.locator('.parent');
    const activeChild = parent.locator('.child.status-active');
    expect(await activeChild.textContent()).toBe('Active Child');

    // Filter by exact text to avoid partial matches
    const filtered = page.locator('.child').filter({ hasText: /^Active Child$/ });
    expect(await filtered.count()).toBe(1);
    expect(await filtered.textContent()).toBe('Active Child');
  });
});

it.describe('BrowserType channel data', () => {
  it('should return correct browser type data', async ({ browserType }) => {
    expect(browserType.name()).toBeTruthy();
    expect(['chromium', 'firefox', 'webkit']).toContain(browserType.name());
    expect(browserType.executablePath()).toBeTruthy();
  });

  it('should launch browser with correct options', async ({ browserType }) => {
    const browser = await browserType.launch({ headless: true });
    try {
      expect(browser.isConnected()).toBe(true);
      expect(browser.version()).toBeTruthy();
      expect(browser.browserType()).toBe(browserType);
    } finally {
      await browser.close();
    }
  });
});

it.describe('CDPSession channel data @chromium', () => {
  it('should return correct CDP data', async ({ page, browserName }) => {
    it.skip(browserName !== 'chromium', 'CDP is Chromium only');

    const client = await page.context().newCDPSession(page);
    try {
      // Get page info via CDP
      const { result } = await client.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      });
      expect(result.value).toBeDefined();

      // Get DOM info
      const { root } = await client.send('DOM.getDocument');
      expect(root.nodeId).toBeGreaterThan(0);
      expect(root.nodeName).toBe('#document');
    } finally {
      await client.detach();
    }
  });

  it('should receive CDP events', async ({ page, browserName }) => {
    it.skip(browserName !== 'chromium', 'CDP is Chromium only');

    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Network.enable');

      const requestPromise = new Promise<any>(resolve => {
        client.on('Network.requestWillBeSent', resolve);
      });

      await page.setContent('<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">');

      // Page navigation triggers network events
      const event = await requestPromise;
      expect(event.requestId).toBeTruthy();
    } finally {
      await client.detach();
    }
  });
});

it.describe('Artifact channel data', () => {
  it('should handle video artifact correctly', async ({ browser, server }, testInfo) => {
    const context = await browser.newContext({
      recordVideo: { dir: testInfo.outputPath('videos') },
    });
    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);
    await page.setContent('<div style="background: red; width: 100px; height: 100px;">Video content</div>');
    await page.waitForTimeout(100);
    await context.close();

    const video = page.video();
    expect(video).toBeTruthy();

    const videoPath = await video!.path();
    expect(videoPath).toBeTruthy();

    const fs = require('fs');
    expect(fs.existsSync(videoPath!)).toBe(true);
    const stats = fs.statSync(videoPath!);
    expect(stats.size).toBeGreaterThan(0);
  });

  it('should handle HAR artifact correctly', async ({ browser, server }, testInfo) => {
    const harPath = testInfo.outputPath('test.har');

    const context = await browser.newContext({
      recordHar: { path: harPath },
    });
    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);
    await context.close();

    const fs = require('fs');
    expect(fs.existsSync(harPath)).toBe(true);

    const harContent = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
    expect(harContent.log).toBeTruthy();
    expect(harContent.log.entries.length).toBeGreaterThan(0);
    expect(harContent.log.entries[0].request.url).toContain(server.PREFIX);
  });
});

it.describe('BindingCall channel data', () => {
  it('should provide correct binding call data', async ({ page }) => {
    let bindingArgs: any[] = [];
    let bindingSource: any = null;

    await page.exposeBinding('testBinding', (source, ...args) => {
      bindingSource = source;
      bindingArgs = args;
      return 'binding result';
    });

    await page.setContent('<div>test</div>');
    const result = await page.evaluate(() => (window as any).testBinding('arg1', 42, { nested: true }));

    expect(result).toBe('binding result');
    expect(bindingArgs).toEqual(['arg1', 42, { nested: true }]);
    expect(bindingSource.context).toBeTruthy();
    expect(bindingSource.page).toBe(page);
    expect(bindingSource.frame).toBe(page.mainFrame());
  });

  it('should handle binding with element handle', async ({ page }) => {
    let receivedHandle: any = null;

    await page.exposeBinding('getElement', (source, element) => {
      receivedHandle = element;
      return 'got element';
    }, { handle: true });

    await page.setContent('<button id="btn">Click me</button>');
    await page.evaluate(() => (window as any).getElement(document.getElementById('btn')));

    expect(receivedHandle).toBeTruthy();
    const tagName = await receivedHandle.evaluate((el: any) => el.tagName);
    expect(tagName).toBe('BUTTON');
  });
});

it.describe('SecurityDetails channel data', () => {
  it('should return security details for HTTPS', async ({ browser, httpsServer }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    const response = await page.goto(httpsServer.EMPTY_PAGE);
    expect(response).toBeTruthy();

    const securityDetails = await response!.securityDetails();
    if (securityDetails) {
      // SecurityDetails is a plain object with properties
      expect(typeof securityDetails.protocol).toBe('string');
      expect(typeof securityDetails.subjectName).toBe('string');
      expect(typeof securityDetails.issuer).toBe('string');
      expect(typeof securityDetails.validFrom).toBe('number');
      expect(typeof securityDetails.validTo).toBe('number');
    }

    await context.close();
  });
});

it.describe('Network timing channel data', () => {
  it('should return detailed request sizes', async ({ page, server }) => {
    server.setRoute('/sized-response', (req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('x'.repeat(1000));
    });

    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/sized-response')),
      page.goto(server.PREFIX + '/sized-response'),
    ]);

    const sizes = await response.request().sizes();
    expect(sizes.requestBodySize).toBeGreaterThanOrEqual(0);
    expect(sizes.requestHeadersSize).toBeGreaterThan(0);
    expect(sizes.responseBodySize).toBeGreaterThanOrEqual(1000);
    expect(sizes.responseHeadersSize).toBeGreaterThan(0);
  });
});

it.describe('Storage state channel data', () => {
  it('should return correct storage state data', async ({ context, page, server }) => {
    await page.goto(server.EMPTY_PAGE);

    // Add cookies
    await context.addCookies([{
      name: 'storage-cookie',
      value: 'cookie-value',
      url: server.EMPTY_PAGE,
    }]);

    // Add localStorage via page
    await page.evaluate(() => {
      localStorage.setItem('storage-key', 'storage-value');
    });

    const storageState = await context.storageState();

    expect(storageState.cookies).toBeTruthy();
    expect(storageState.cookies.length).toBeGreaterThan(0);
    expect(storageState.cookies.find(c => c.name === 'storage-cookie')).toBeTruthy();

    expect(storageState.origins).toBeTruthy();
    expect(storageState.origins.length).toBeGreaterThan(0);
    const origin = storageState.origins.find(o => o.origin.includes('localhost'));
    expect(origin).toBeTruthy();
    expect(origin!.localStorage.find(item => item.name === 'storage-key')).toBeTruthy();
  });
});
