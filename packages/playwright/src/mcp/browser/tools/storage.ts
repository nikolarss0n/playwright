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

const getStorageState = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_get_storage_state',
    title: 'Get storage state',
    description: 'Get cookies and localStorage for the current page. Useful for inspecting authentication state, session data, and stored preferences.',
    inputSchema: z.object({}),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const cookies = await tab.page.context().cookies();
    const localStorage = await tab.page.evaluate(() => {
      const entries: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key !== null)
          entries[key] = window.localStorage.getItem(key) ?? '';
      }
      return entries;
    });

    const result: string[] = [];

    result.push('## Cookies');
    if (cookies.length === 0) {
      result.push('No cookies found.');
    } else {
      for (const cookie of cookies) {
        const parts = [`  name: ${cookie.name}`, `  value: ${cookie.value}`, `  domain: ${cookie.domain}`, `  path: ${cookie.path}`];
        if (cookie.secure)
          parts.push('  secure: true');
        if (cookie.httpOnly)
          parts.push('  httpOnly: true');
        if (cookie.sameSite !== 'None')
          parts.push(`  sameSite: ${cookie.sameSite}`);
        if (cookie.expires !== -1)
          parts.push(`  expires: ${new Date(cookie.expires * 1000).toISOString()}`);
        result.push(`- ${cookie.name}\n${parts.join('\n')}`);
      }
    }

    result.push('');
    result.push('## localStorage');
    const keys = Object.keys(localStorage);
    if (keys.length === 0) {
      result.push('No localStorage entries found.');
    } else {
      for (const key of keys) {
        const value = localStorage[key];
        const displayValue = value.length > 200 ? value.substring(0, 200) + '...' : value;
        result.push(`- ${key}: ${displayValue}`);
      }
    }

    response.addResult(result.join('\n'));
  },
});

const verifyCookie = defineTabTool({
  capability: 'testing',
  schema: {
    name: 'browser_verify_cookie',
    title: 'Verify cookie',
    description: 'Verify that a cookie exists with expected properties. Generates Playwright assertion code.',
    inputSchema: z.object({
      name: z.string().describe('Cookie name to verify'),
      expectedValue: z.string().optional().describe('Expected cookie value'),
      shouldExist: z.boolean().optional().describe('Whether cookie should exist (default: true)'),
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const shouldExist = params.shouldExist !== false;
    const cookies = await tab.page.context().cookies();
    const cookie = cookies.find(c => c.name === params.name);

    if (shouldExist) {
      if (!cookie) {
        response.addError(`Cookie "${params.name}" not found`);
        return;
      }
      if (params.expectedValue !== undefined && cookie.value !== params.expectedValue) {
        response.addError(`Cookie "${params.name}" has value "${cookie.value}", expected "${params.expectedValue}"`);
        return;
      }
      if (params.expectedValue !== undefined) {
        response.addCode(`const cookies = await context.cookies();\nconst cookie = cookies.find(c => c.name === ${javascript.quote(params.name)});\nawait expect(cookie).toBeTruthy();\nawait expect(cookie!.value).toBe(${javascript.quote(params.expectedValue)});`);
      } else {
        response.addCode(`const cookies = await context.cookies();\nconst cookie = cookies.find(c => c.name === ${javascript.quote(params.name)});\nawait expect(cookie).toBeTruthy();`);
      }
    } else {
      if (cookie) {
        response.addError(`Cookie "${params.name}" exists but was expected not to`);
        return;
      }
      response.addCode(`const cookies = await context.cookies();\nconst cookie = cookies.find(c => c.name === ${javascript.quote(params.name)});\nawait expect(cookie).toBeUndefined();`);
    }

    response.addResult('Done');
  },
});

const verifyLocalStorage = defineTabTool({
  capability: 'testing',
  schema: {
    name: 'browser_verify_localstorage',
    title: 'Verify localStorage',
    description: 'Verify a localStorage key exists with expected value. Generates Playwright assertion code.',
    inputSchema: z.object({
      key: z.string().describe('localStorage key to verify'),
      expectedValue: z.string().optional().describe('Expected value'),
      shouldExist: z.boolean().optional().describe('Whether key should exist (default: true)'),
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const shouldExist = params.shouldExist !== false;
    const value = await tab.page.evaluate((key: string) => window.localStorage.getItem(key), params.key);

    if (shouldExist) {
      if (value === null) {
        response.addError(`localStorage key "${params.key}" not found`);
        return;
      }
      if (params.expectedValue !== undefined && value !== params.expectedValue) {
        response.addError(`localStorage key "${params.key}" has value "${value}", expected "${params.expectedValue}"`);
        return;
      }
      if (params.expectedValue !== undefined) {
        response.addCode(`const value = await page.evaluate(() => window.localStorage.getItem(${javascript.quote(params.key)}));\nawait expect(value).toBe(${javascript.quote(params.expectedValue)});`);
      } else {
        response.addCode(`const value = await page.evaluate(() => window.localStorage.getItem(${javascript.quote(params.key)}));\nawait expect(value).not.toBeNull();`);
      }
    } else {
      if (value !== null) {
        response.addError(`localStorage key "${params.key}" exists but was expected not to`);
        return;
      }
      response.addCode(`const value = await page.evaluate(() => window.localStorage.getItem(${javascript.quote(params.key)}));\nawait expect(value).toBeNull();`);
    }

    response.addResult('Done');
  },
});

export default [
  getStorageState,
  verifyCookie,
  verifyLocalStorage,
];
