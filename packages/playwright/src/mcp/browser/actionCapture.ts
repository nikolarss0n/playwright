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

import type { SnapshotDiff } from 'playwright-core/lib/server/actionCaptureTypes';
import type { ConsoleMessage } from './tab';

// Re-export SnapshotDiff for consumers that import it from here
export type { SnapshotDiff } from 'playwright-core/lib/server/actionCaptureTypes';

export type McpNetworkRequest = {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
};

/** @deprecated Use McpNetworkRequest instead */
export type NetworkRequest = McpNetworkRequest;

export type McpActionCapture = {
  timing: {
    durationMs: number;
  };
  network: {
    requests: McpNetworkRequest[];
    summary: string;
  };
  snapshot: {
    before?: string;
    after?: string;
    diff?: SnapshotDiff;
  };
  console: ConsoleMessage[];
};

/** @deprecated Use McpActionCapture instead */
export type ActionCapture = McpActionCapture;

export function createEmptyActionCapture(): McpActionCapture {
  return {
    timing: { durationMs: 0 },
    network: { requests: [], summary: '' },
    snapshot: {},
    console: [],
  };
}

export function formatNetworkSummary(requests: McpNetworkRequest[]): string {
  if (requests.length === 0)
    return '';
  return requests
    .map(r => {
      const pathname = new URL(r.url, 'http://localhost').pathname;
      const status = r.status !== null ? ` (${r.status})` : ' (pending)';
      return `${r.method} ${pathname}${status}`;
    })
    .join(', ');
}

export function renderActionCapture(capture: McpActionCapture): string[] {
  const lines: string[] = [];

  // Timing
  lines.push(`### Action completed in ${capture.timing.durationMs}ms`);
  lines.push('');

  // Network
  if (capture.network.requests.length > 0) {
    lines.push(`### Network (${capture.network.requests.length} request${capture.network.requests.length !== 1 ? 's' : ''})`);
    for (const req of capture.network.requests) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const status = req.status !== null ? req.status : 'pending';
      lines.push(`- ${req.method} ${pathname} \u2192 ${status} (${req.durationMs}ms)`);
    }
    lines.push('');
  }

  // Snapshot diff
  if (capture.snapshot.diff) {
    const diff = capture.snapshot.diff;
    const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
    if (hasChanges) {
      lines.push('### Page changes');
      if (diff.added.length > 0)
        lines.push(`- Added: ${diff.added.join(', ')}`);
      if (diff.removed.length > 0)
        lines.push(`- Removed: ${diff.removed.join(', ')}`);
      if (diff.changed.length > 0)
        lines.push(`- Changed: ${diff.changed.join(', ')}`);
      lines.push('');
    }
  }

  // Console messages during action
  if (capture.console.length > 0) {
    lines.push(`### Console during action (${capture.console.length} message${capture.console.length !== 1 ? 's' : ''})`);
    for (const msg of capture.console)
      lines.push(`- ${msg.toString()}`);
    lines.push('');
  }

  return lines;
}
