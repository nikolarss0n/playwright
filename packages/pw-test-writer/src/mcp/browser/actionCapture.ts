import type { McpActionCapture, NetworkRequest } from './types.js';

export function createEmptyActionCapture(): McpActionCapture {
  return {
    timing: { durationMs: 0 },
    network: { requests: [], summary: '' },
    snapshot: {},
    console: [],
  };
}

export function formatNetworkSummary(requests: NetworkRequest[]): string {
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

  lines.push(`### Action completed in ${capture.timing.durationMs}ms`);
  lines.push('');

  if (capture.network.requests.length > 0) {
    lines.push(`### Network (${capture.network.requests.length} request${capture.network.requests.length !== 1 ? 's' : ''})`);
    for (const req of capture.network.requests) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const status = req.status !== null ? req.status : 'pending';
      lines.push(`- ${req.method} ${pathname} \u2192 ${status} (${req.durationMs}ms)`);
    }
    lines.push('');
  }

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

  if (capture.console.length > 0) {
    lines.push(`### Console during action (${capture.console.length} message${capture.console.length !== 1 ? 's' : ''})`);
    for (const msg of capture.console)
      lines.push(`- ${msg.toString()}`);
    lines.push('');
  }

  return lines;
}
