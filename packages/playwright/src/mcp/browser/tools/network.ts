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

import { z } from '../../sdk/bundle';
import { defineTabTool } from './tool';
import * as javascript from '../codegen';

import type * as playwright from 'playwright-core';
import type { Request } from '../../../../../playwright-core/src/client/network';

const requests = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_network_requests',
    title: 'List network requests',
    description: 'Returns all network requests since loading the page',
    inputSchema: z.object({}),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const requests = await tab.requests();
    for (const request of requests)
      response.addResult(await renderRequest(request));
  },
});

async function renderRequest(request: playwright.Request) {
  const result: string[] = [];
  result.push(`[${request.method().toUpperCase()}] ${request.url()}`);
  const hasResponse = (request as Request)._hasResponse;
  if (hasResponse) {
    const response = await request.response();
    if (response)
      result.push(`=> [${response.status()}] ${response.statusText()}`);
  }
  return result.join(' ');
}

const discoverApiEndpoints = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_discover_api_endpoints',
    title: 'Discover API endpoints',
    description: 'Analyze network requests to discover API patterns. Groups by base URL and shows methods, status codes, and content types.',
    inputSchema: z.object({
      filterPattern: z.string().optional().describe('URL pattern to filter (e.g., "/api/")'),
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const allRequests = await tab.requests();
    const filtered = [...allRequests].filter(request => {
      if (!params.filterPattern)
        return true;
      return request.url().includes(params.filterPattern);
    });

    if (filtered.length === 0) {
      response.addResult(params.filterPattern ? `No requests matching "${params.filterPattern}" found.` : 'No requests captured.');
      return;
    }

    const groups = new Map<string, { method: string; status: number | null; contentType: string | null }[]>();
    for (const request of filtered) {
      const url = new URL(request.url());
      const basePath = url.origin + url.pathname;
      const hasResponse = (request as Request)._hasResponse;
      let status: number | null = null;
      let contentType: string | null = null;
      if (hasResponse) {
        const resp = await request.response();
        if (resp) {
          status = resp.status();
          contentType = resp.headers()['content-type'] ?? null;
        }
      }
      if (!groups.has(basePath))
        groups.set(basePath, []);
      groups.get(basePath)!.push({ method: request.method().toUpperCase(), status, contentType });
    }

    const lines: string[] = [];
    for (const [basePath, entries] of groups) {
      lines.push(`## ${basePath}`);
      for (const entry of entries) {
        const parts = [`  [${entry.method}]`];
        if (entry.status !== null)
          parts.push(`=> ${entry.status}`);
        if (entry.contentType)
          parts.push(`(${entry.contentType})`);
        lines.push(parts.join(' '));
      }
    }
    response.addResult(lines.join('\n'));
  },
});

const waitForRequest = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_wait_for_request',
    title: 'Wait for network request',
    description: 'Wait for a specific network request matching URL pattern and method. Returns request/response details.',
    inputSchema: z.object({
      urlPattern: z.string().describe('URL substring to match'),
      method: z.string().optional().describe('HTTP method to match (GET, POST, etc.)'),
      timeout: z.number().optional().describe('Timeout in milliseconds (default: 10000)'),
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const timeout = params.timeout ?? 10000;
    const upperMethod = params.method?.toUpperCase();
    let matchedResponse: playwright.Response;
    try {
      matchedResponse = await tab.page.waitForResponse(resp => {
        if (!resp.url().includes(params.urlPattern))
          return false;
        if (upperMethod && resp.request().method().toUpperCase() !== upperMethod)
          return false;
        return true;
      }, { timeout });
    } catch {
      response.addError(`No response matching URL "${params.urlPattern}"${upperMethod ? ` and method ${upperMethod}` : ''} within ${timeout}ms.`);
      return;
    }

    const matchedRequest = matchedResponse.request();
    const lines: string[] = [];
    lines.push(`[${matchedRequest.method().toUpperCase()}] ${matchedRequest.url()}`);
    lines.push(`Status: ${matchedResponse.status()} ${matchedResponse.statusText()}`);

    const responseHeaders = matchedResponse.headers();
    const contentType = responseHeaders['content-type'] ?? '';
    lines.push(`Content-Type: ${contentType}`);

    if (contentType.includes('application/json')) {
      try {
        const body = await matchedResponse.json();
        lines.push(`Body: ${JSON.stringify(body, null, 2)}`);
      } catch {
        lines.push('Body: (could not parse JSON)');
      }
    } else {
      try {
        const text = await matchedResponse.text();
        if (text.length <= 2000)
          lines.push(`Body: ${text}`);
        else
          lines.push(`Body: ${text.substring(0, 2000)}... (truncated)`);
      } catch {
        lines.push('Body: (could not read body)');
      }
    }

    const methodArg = upperMethod ? `, { method: ${javascript.quote(upperMethod)} }` : '';
    response.addCode(`const response = await page.waitForResponse(response => response.url().includes(${javascript.quote(params.urlPattern)})${methodArg ? ` && response.request().method() === ${javascript.quote(upperMethod!)}` : ''});`);
    response.addResult(lines.join('\n'));
  },
});

const verifyApiResponse = defineTabTool({
  capability: 'testing',

  schema: {
    name: 'browser_verify_api_response',
    title: 'Verify API response',
    description: 'Verify that a network response matches expected status, body content, or headers. Generates Playwright assertion code.',
    inputSchema: z.object({
      urlPattern: z.string().describe('URL substring to match'),
      method: z.string().optional().describe('HTTP method filter'),
      expectedStatus: z.number().optional().describe('Expected HTTP status code'),
      expectedBodyContains: z.string().optional().describe('Expected string in response body'),
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const allRequests = await tab.requests();
    const upperMethod = params.method?.toUpperCase();
    let matchedRequest: playwright.Request | undefined;
    for (const request of allRequests) {
      if (!request.url().includes(params.urlPattern))
        continue;
      if (upperMethod && request.method().toUpperCase() !== upperMethod)
        continue;
      const hasResponse = (request as Request)._hasResponse;
      if (!hasResponse)
        continue;
      matchedRequest = request;
    }

    if (!matchedRequest) {
      response.addError(`No request matching URL "${params.urlPattern}"${upperMethod ? ` with method ${upperMethod}` : ''} found.`);
      return;
    }

    const matchedResponse = await matchedRequest.response();
    if (!matchedResponse) {
      response.addError('Request found but response is not available.');
      return;
    }

    const errors: string[] = [];
    const codeLines: string[] = [];

    const predicateParts = [`response.url().includes(${javascript.quote(params.urlPattern)})`];
    if (upperMethod)
      predicateParts.push(`response.request().method() === ${javascript.quote(upperMethod)}`);
    const predicate = predicateParts.join(' && ');

    codeLines.push(`const response = await page.waitForResponse(response => ${predicate});`);

    if (params.expectedStatus !== undefined) {
      const actualStatus = matchedResponse.status();
      if (actualStatus !== params.expectedStatus)
        errors.push(`Expected status ${params.expectedStatus}, got ${actualStatus}`);
      codeLines.push(`expect(response.status()).toBe(${params.expectedStatus});`);
    }

    if (params.expectedBodyContains !== undefined) {
      let bodyText = '';
      try {
        bodyText = await matchedResponse.text();
      } catch {
        errors.push('Could not read response body');
      }
      if (bodyText && !bodyText.includes(params.expectedBodyContains))
        errors.push(`Response body does not contain "${params.expectedBodyContains}"`);
      codeLines.push(`expect(await response.text()).toContain(${javascript.quote(params.expectedBodyContains)});`);
    }

    if (errors.length) {
      response.addError(errors.join('\n'));
      return;
    }

    response.addCode(codeLines.join('\n'));
    response.addResult('Done');
  },
});

export default [
  requests,
  discoverApiEndpoints,
  waitForRequest,
  verifyApiResponse,
];
