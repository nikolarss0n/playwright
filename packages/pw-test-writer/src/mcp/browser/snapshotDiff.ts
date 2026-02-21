import type { SnapshotDiff } from './types.js';

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

export function computeSnapshotDiff(before: string, after: string): SnapshotDiff {
  const beforeElements = parseSnapshot(before);
  const afterElements = parseSnapshot(after);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [ref, beforeEl] of beforeElements) {
    const afterEl = afterElements.get(ref);
    if (!afterEl)
      removed.push(formatElement(beforeEl));
    else if (beforeEl.content !== afterEl.content || beforeEl.name !== afterEl.name)
      changed.push(formatElement(afterEl));
  }

  for (const [ref, afterEl] of afterElements) {
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

  const summary = summaryParts.length > 0 ? summaryParts.join(', ') : 'no changes';

  return { added, removed, changed, summary };
}
