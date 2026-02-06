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

import { eventsHelper } from './utils/eventsHelper';
import { BrowserContext } from './browserContext';

import type { ActionStartInfo } from './actionCaptureTypes';
import type { RegisteredListener } from './utils/eventsHelper';
import type { InstrumentationListener, SdkObject } from './instrumentation';
import type { CallMetadata } from '@protocol/callMetadata';
import type { Page } from './page';
import type { Request, Response } from './network';
import type { ConsoleMessage } from './console';
import type { Dialog } from './dialog';
import type { Download } from './download';
import type { ActionCapture, ActionCaptureCallback, NetworkRequestCapture, ConsoleMessageCapture, SnapshotCapture } from './actionCaptureTypes';

// Re-export types so existing importers of this module continue to work
export type { ActionCapture, ActionCaptureCallback, NetworkRequestCapture, ConsoleMessageCapture, SnapshotCapture } from './actionCaptureTypes';

// ============================================================================
// Pending Action State
// ============================================================================

type PendingRequestInfo = {
  startTime: number;
  responseBody?: string;
  postData?: string;
};

type PendingAction = {
  callId: string;
  metadata: CallMetadata;
  startTime: number;
  snapshotBefore?: string;
  networkRequests: Map<Request, PendingRequestInfo>;
  completedRequests: NetworkRequestCapture[];
  consoleMessages: ConsoleMessageCapture[];
  pageId?: string;
  page?: Page;
};

// ============================================================================
// ActionCaptureListener - Implements InstrumentationListener
// ============================================================================

// Methods that are read-only getters - don't represent user actions
const readOnlyMethods = new Set([
  // Frame/Page getters
  'title', 'url', 'content', 'viewportSize', 'opener',
  // Query/selector methods (read-only DOM queries)
  'querySelector', 'querySelectorAll', '$', '$$',
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder',
  'getByAltText', 'getByTitle', 'getByTestId', 'frameLocator',
  // Locator getters
  'textContent', 'innerText', 'innerHTML', 'getAttribute',
  'inputValue', 'isChecked', 'isDisabled', 'isEditable',
  'isEnabled', 'isHidden', 'isVisible', 'count', 'all',
  'first', 'last', 'nth', 'boundingBox', 'allTextContents',
  'allInnerTexts',
  // ElementHandle getters
  'ownerFrame', 'contentFrame',
  // JSHandle / evaluation (internal, not user actions)
  'evaluate', 'evaluateHandle', 'getProperties', 'getProperty', 'jsonValue',
  'evaluateExpression', 'evaluateExpressionHandle',
  // Wait methods (internal polling, not user actions)
  'waitForSelector', 'waitForFunction', 'waitForLoadState', 'waitForURL',
  'waitForTimeout', 'waitForEvent',
  // Frame internal methods
  'childFrames', 'parentFrame', 'name', 'isDetached',
]);

// Types that should be filtered entirely (internal infrastructure)
const filteredTypes = new Set([
  'Tracing', 'Artifact', 'JsonPipe', 'LocalUtils',
]);

export class ActionCaptureListener implements InstrumentationListener {
  private _context: BrowserContext;
  private _callback: ActionCaptureCallback;
  private _pendingActions = new Map<string, PendingAction>();
  private _eventListeners: RegisteredListener[] = [];
  private _captureSnapshots: boolean;

  constructor(context: BrowserContext, callback: ActionCaptureCallback, options?: { captureSnapshots?: boolean }) {
    this._context = context;
    this._callback = callback;
    this._captureSnapshots = options?.captureSnapshots ?? true;
  }

  private _shouldCapture(metadata: CallMetadata): boolean {
    // Skip internal calls
    if (metadata.internal)
      return false;
    // Skip filtered types
    if (filteredTypes.has(metadata.type))
      return false;
    // Skip read-only getter methods
    if (readOnlyMethods.has(metadata.method))
      return false;
    return true;
  }

  start() {
    // Register as instrumentation listener
    this._context.instrumentation.addListener(this, this._context);

    // Listen to network events
    this._eventListeners.push(
      eventsHelper.addEventListener(this._context, BrowserContext.Events.Request, (request: Request) => this._onRequest(request)),
      eventsHelper.addEventListener(this._context, BrowserContext.Events.Response, (response: Response) => this._onResponse(response)),
      eventsHelper.addEventListener(this._context, BrowserContext.Events.RequestFinished, (request: Request) => this._onRequestFinished(request)),
      eventsHelper.addEventListener(this._context, BrowserContext.Events.RequestFailed, (request: Request) => this._onRequestFailed(request)),
      eventsHelper.addEventListener(this._context, BrowserContext.Events.Console, (message: ConsoleMessage) => this._onConsoleMessage(message)),
    );
  }

  stop() {
    this._context.instrumentation.removeListener(this);
    eventsHelper.removeEventListeners(this._eventListeners);
    this._pendingActions.clear();
  }

  // ============================================================================
  // InstrumentationListener Implementation
  // ============================================================================

  async onBeforeCall(sdkObject: SdkObject, metadata: CallMetadata): Promise<void> {
    if (!this._shouldCapture(metadata))
      return;

    const page = sdkObject.attribution.page;
    const pending: PendingAction = {
      callId: metadata.id,
      metadata,
      startTime: metadata.startTime,
      networkRequests: new Map(),
      completedRequests: [],
      consoleMessages: [],
      pageId: page?.guid,
      page,
    };

    // Emit action start event
    if (BrowserContext.onActionStart) {
      const startInfo: ActionStartInfo = {
        callId: metadata.id,
        type: metadata.type,
        method: metadata.method,
        title: metadata.title,
        params: metadata.params,
        startTime: metadata.startTime,
      };
      BrowserContext.onActionStart(startInfo, this._context);
    }

    // Capture snapshot before action
    if (this._captureSnapshots && page) {
      try {
        pending.snapshotBefore = await this._captureAriaSnapshot(page);
      } catch {
        // Snapshot may fail during navigation
      }
    }

    this._pendingActions.set(metadata.id, pending);
  }

  async onAfterCall(sdkObject: SdkObject, metadata: CallMetadata): Promise<void> {
    const pending = this._pendingActions.get(metadata.id);
    if (!pending)
      return;

    this._pendingActions.delete(metadata.id);

    const page = sdkObject.attribution.page;
    let snapshotAfter: string | undefined;

    // Capture snapshot after action
    if (this._captureSnapshots && page) {
      try {
        snapshotAfter = await this._captureAriaSnapshot(page);
      } catch {
        // Snapshot may fail
      }
    }

    // Compute snapshot diff
    const snapshotDiff = pending.snapshotBefore && snapshotAfter
      ? computeSnapshotDiff(pending.snapshotBefore, snapshotAfter)
      : undefined;

    // Include both completed and still-pending network requests
    const allNetworkRequests = [...pending.completedRequests];

    // Add pending requests that haven't completed yet (mark status as null)
    const now = Date.now();
    for (const [request, info] of pending.networkRequests.entries()) {
      allNetworkRequests.push({
        method: request.method(),
        url: request.url(),
        status: null, // Still pending
        statusText: 'pending',
        startTime: info.startTime,
        endTime: now,
        durationMs: now - info.startTime,
        resourceType: request.resourceType(),
      });
    }

    // Build the ActionCapture
    const capture: ActionCapture = {
      callId: metadata.id,
      type: metadata.type,
      method: metadata.method,
      title: metadata.title,
      params: metadata.params,

      timing: {
        startTime: metadata.startTime,
        endTime: metadata.endTime,
        durationMs: metadata.endTime - metadata.startTime,
      },

      network: {
        requests: allNetworkRequests,
        summary: formatNetworkSummary(allNetworkRequests),
      },
      console: pending.consoleMessages,
      snapshot: {
        before: pending.snapshotBefore,
        after: snapshotAfter,
        diff: snapshotDiff,
      },

      pageId: pending.pageId,
      pageUrl: page?.mainFrame().url(),
    };

    if (metadata.error)
      capture.error = { message: metadata.error.error?.message || 'Unknown error', stack: metadata.error.error?.stack };
    if (metadata.result)
      capture.result = metadata.result;

    // Emit the capture
    this._callback(capture);
  }

  onDialog(dialog: Dialog): void {
    // Could capture dialog events if needed
  }

  onDownload(page: Page, download: Download): void {
    // Could capture download events if needed
  }

  // ============================================================================
  // Network Event Handlers
  // ============================================================================

  private _onRequest(request: Request) {
    const now = Date.now();

    // Get POST data if present
    const postData = request.postDataBuffer()?.toString('utf-8')?.slice(0, 2000);

    // Associate request with all pending actions
    for (const pending of Array.from(this._pendingActions.values())) {
      pending.networkRequests.set(request, { startTime: now, postData });
    }
  }

  private _onResponse(response: Response) {
    // Try to capture response body for JSON/text responses
    const request = response.request();
    const contentType = response.headers()['content-type'] || '';
    const isTextual = contentType.includes('json') ||
                      contentType.includes('text') ||
                      contentType.includes('javascript') ||
                      contentType.includes('xml');

    if (isTextual) {
      // Capture body asynchronously - will be available when request finishes
      response.body().then(buffer => {
        const body = buffer.toString('utf-8').slice(0, 5000); // Limit to 5KB
        for (const pending of Array.from(this._pendingActions.values())) {
          const info = pending.networkRequests.get(request);
          if (info) {
            info.responseBody = body;
          }
        }
      }).catch(() => {
        // Body not available, that's OK
      });
    }
  }

  private _onRequestFinished(request: Request) {
    this._completeRequest(request, false);
  }

  private _onRequestFailed(request: Request) {
    this._completeRequest(request, true);
  }

  private _completeRequest(request: Request, failed: boolean) {
    const now = Date.now();

    for (const pending of Array.from(this._pendingActions.values())) {
      const requestInfo = pending.networkRequests.get(request);
      if (!requestInfo)
        continue;

      pending.networkRequests.delete(request);

      const response = (request as any)._existingResponse() as Response | null;
      const capture: NetworkRequestCapture = {
        method: request.method(),
        url: request.url(),
        status: failed ? 0 : (response?.status() ?? null),
        statusText: failed ? 'failed' : (response?.statusText() ?? ''),
        startTime: requestInfo.startTime,
        endTime: now,
        durationMs: now - requestInfo.startTime,
        resourceType: request.resourceType(),
        responseBody: requestInfo.responseBody,
        requestPostData: requestInfo.postData,
      };

      pending.completedRequests.push(capture);
    }
  }

  // ============================================================================
  // Console Event Handler
  // ============================================================================

  private _onConsoleMessage(message: ConsoleMessage) {
    const now = Date.now();

    const capture: ConsoleMessageCapture = {
      type: message.type(),
      text: message.text(),
      timestamp: now,
      location: message.location(),
    };

    // Add to all pending actions
    for (const pending of Array.from(this._pendingActions.values())) {
      pending.consoleMessages.push(capture);
    }
  }

  // ============================================================================
  // Snapshot Helpers
  // ============================================================================

  private async _captureAriaSnapshot(page: Page): Promise<string> {
    // Use the internal snapshot API
    return await (page as any)._snapshotForAI();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatNetworkSummary(requests: NetworkRequestCapture[]): string {
  if (requests.length === 0)
    return '';

  return requests
    .map(r => {
      try {
        const pathname = new URL(r.url).pathname;
        const status = r.status !== null ? ` (${r.status})` : ' (pending)';
        return `${r.method} ${pathname}${status}`;
      } catch {
        return `${r.method} ${r.url}`;
      }
    })
    .join(', ');
}

type SnapshotElement = {
  ref: string;
  role: string;
  name: string;
  content: string;
};

function parseSnapshot(snapshot: string): Map<string, SnapshotElement> {
  const elements = new Map<string, SnapshotElement>();
  const refRegex = /\[ref=([^\]]+)\]/g;
  const lines = snapshot.split('\n');

  for (const line of lines) {
    const match = refRegex.exec(line);
    if (!match)
      continue;

    const ref = match[1];
    const beforeRef = line.slice(0, match.index);
    const afterRef = line.slice(match.index + match[0].length);

    const roleMatch = beforeRef.match(/-\s*(\w+)\s*"([^"]*)"/);
    if (roleMatch) {
      const role = roleMatch[1];
      const name = roleMatch[2];
      const content = afterRef.replace(/^:\s*/, '').trim();
      elements.set(ref, { ref, role, name, content });
    }

    refRegex.lastIndex = 0;
  }

  return elements;
}

function formatElement(el: SnapshotElement): string {
  const name = el.name ? ` "${el.name}"` : '';
  return `${el.role}${name} [ref=${el.ref}]`;
}

function computeSnapshotDiff(before: string, after: string): ActionCapture['snapshot']['diff'] {
  const beforeElements = parseSnapshot(before);
  const afterElements = parseSnapshot(after);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [ref, beforeEl] of Array.from(beforeElements.entries())) {
    const afterEl = afterElements.get(ref);
    if (!afterEl)
      removed.push(formatElement(beforeEl));
    else if (beforeEl.content !== afterEl.content || beforeEl.name !== afterEl.name)
      changed.push(formatElement(afterEl));
  }

  for (const [ref, afterEl] of Array.from(afterElements.entries())) {
    if (!beforeElements.has(ref))
      added.push(formatElement(afterEl));
  }

  const summaryParts: string[] = [];
  if (added.length > 0)
    summaryParts.push(`${added.length} added`);
  if (removed.length > 0)
    summaryParts.push(`${removed.length} removed`);
  if (changed.length > 0)
    summaryParts.push(`${changed.length} changed`);

  return {
    added,
    removed,
    changed,
    summary: summaryParts.length > 0 ? summaryParts.join(', ') : 'no changes',
  };
}
