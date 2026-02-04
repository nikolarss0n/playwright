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

import { asLocator } from 'playwright-core/lib/utils';

import type * as playwright from 'playwright-core';
import type { Tab } from '../tab';
import type { NetworkRequest } from '../actionCapture';

export type WaitForCompletionResult<R> = {
  result: R;
  requests: NetworkRequest[];
  durationMs: number;
};

export async function waitForCompletion<R>(tab: Tab, callback: () => Promise<R>): Promise<WaitForCompletionResult<R>> {
  const pendingRequests = new Set<playwright.Request>();
  const completedRequests: { request: playwright.Request; startTime: number; endTime: number; status: number | null }[] = [];
  let frameNavigated = false;
  let waitCallback: () => void = () => {};
  const waitBarrier = new Promise<void>(f => { waitCallback = f; });
  const startMs = performance.now();

  const responseListener = (request: playwright.Request) => {
    if (pendingRequests.has(request)) {
      pendingRequests.delete(request);
      const entry = completedRequests.find(r => r.request === request);
      if (entry) {
        entry.endTime = performance.now();
        void request.response().then(response => {
          entry.status = response?.status() ?? null;
        }).catch(() => {});
      }
    }
    if (!pendingRequests.size)
      waitCallback();
  };

  const requestListener = (request: playwright.Request) => {
    pendingRequests.add(request);
    completedRequests.push({
      request,
      startTime: performance.now(),
      endTime: performance.now(),
      status: null,
    });
    void request.response().then(() => responseListener(request)).catch(() => responseListener(request));
  };

  const frameNavigateListener = (frame: playwright.Frame) => {
    if (frame.parentFrame())
      return;
    frameNavigated = true;
    dispose();
    clearTimeout(timeout);
    void tab.waitForLoadState('load').then(waitCallback);
  };

  const onTimeout = () => {
    dispose();
    waitCallback();
  };

  tab.page.on('request', requestListener);
  tab.page.on('requestfailed', responseListener);
  tab.page.on('framenavigated', frameNavigateListener);
  const timeout = setTimeout(onTimeout, 10000);

  const dispose = () => {
    tab.page.off('request', requestListener);
    tab.page.off('requestfailed', responseListener);
    tab.page.off('framenavigated', frameNavigateListener);
    clearTimeout(timeout);
  };

  try {
    const result = await callback();
    if (!pendingRequests.size && !frameNavigated)
      waitCallback();
    await waitBarrier;
    await tab.waitForTimeout(1000);

    const endMs = performance.now();
    const requests: NetworkRequest[] = completedRequests.map(r => ({
      method: r.request.method(),
      url: r.request.url(),
      status: r.status,
      durationMs: Math.round(r.endTime - r.startTime),
    }));

    return {
      result,
      requests,
      durationMs: Math.round(endMs - startMs),
    };
  } finally {
    dispose();
  }
}

export async function generateLocator(locator: playwright.Locator): Promise<string> {
  try {
    const { resolvedSelector } = await (locator as any)._resolveSelector();
    return asLocator('javascript', resolvedSelector);
  } catch (e) {
    throw new Error('Ref not found, likely because element was removed. Use browser_snapshot to see what elements are currently on the page.');
  }
}

export async function callOnPageNoTrace<T>(page: playwright.Page, callback: (page: playwright.Page) => Promise<T>): Promise<T> {
  return await (page as any)._wrapApiCall(() => callback(page), { internal: true });
}

export function dateAsFileName(extension: string): string {
  const date = new Date();
  return `page-${date.toISOString().replace(/[:.]/g, '-')}.${extension}`;
}
