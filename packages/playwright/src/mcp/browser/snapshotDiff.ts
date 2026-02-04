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

import type { SnapshotDiff } from './actionCapture';

type SnapshotElement = {
  ref: string;
  role: string;
  name: string;
  content: string;
};

/**
 * Parse YAML snapshot to extract elements with refs.
 * YAML format: `- role "name" [ref=XXX]: content` or `- role "name" [ref=XXX]`
 */
function parseSnapshot(snapshot: string): Map<string, SnapshotElement> {
  const elements = new Map<string, SnapshotElement>();
  const refRegex = /\[ref=([^\]]+)\]/g;
  const lines = snapshot.split('\n');

  for (const line of lines) {
    const match = refRegex.exec(line);
    if (!match)
      continue;

    const ref = match[1];
    // Extract role and name from the line
    // Format: `- role "name" [ref=XXX]` or `  - role "name" [ref=XXX]: content`
    const beforeRef = line.slice(0, match.index);
    const afterRef = line.slice(match.index + match[0].length);

    // Parse role and name from beforeRef
    const roleMatch = beforeRef.match(/-\s*(\w+)\s*"([^"]*)"/);
    if (roleMatch) {
      const role = roleMatch[1];
      const name = roleMatch[2];
      // Content is after the ref, typically `: content`
      const content = afterRef.replace(/^:\s*/, '').trim();

      elements.set(ref, { ref, role, name, content });
    }

    // Reset regex lastIndex for next iteration
    refRegex.lastIndex = 0;
  }

  return elements;
}

/**
 * Format element for display in diff summary.
 */
function formatElement(el: SnapshotElement): string {
  const name = el.name ? ` "${el.name}"` : '';
  return `${el.role}${name} [ref=${el.ref}]`;
}

/**
 * Compute diff between two YAML snapshots.
 */
export function computeSnapshotDiff(before: string, after: string): SnapshotDiff {
  const beforeElements = parseSnapshot(before);
  const afterElements = parseSnapshot(after);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  // Find removed and changed elements
  for (const [ref, beforeEl] of beforeElements) {
    const afterEl = afterElements.get(ref);
    if (!afterEl) {
      removed.push(formatElement(beforeEl));
    } else if (beforeEl.content !== afterEl.content || beforeEl.name !== afterEl.name) {
      changed.push(formatElement(afterEl));
    }
  }

  // Find added elements
  for (const [ref, afterEl] of afterElements) {
    if (!beforeElements.has(ref))
      added.push(formatElement(afterEl));
  }

  // Build summary
  const summaryParts: string[] = [];
  if (added.length > 0)
    summaryParts.push(`${added.length} added`);
  if (removed.length > 0)
    summaryParts.push(`${removed.length} removed`);
  if (changed.length > 0)
    summaryParts.push(`${changed.length} changed`);

  const summary = summaryParts.length > 0 ? summaryParts.join(', ') : 'no changes';

  return { added, removed, changed, summary };
}
