/**
 * Example: How to use ActionCaptureListener
 *
 * This shows how to capture action data from ANY Playwright test or script
 * and stream it to your database/AI system.
 */

import { ActionCaptureListener } from './actionCaptureListener';
import type { ActionCapture } from './actionCaptureListener';
import type { BrowserContext } from './browserContext';

// ============================================================================
// Example 1: Simple console logging
// ============================================================================

export function attachSimpleLogger(context: BrowserContext) {
  const listener = new ActionCaptureListener(context, (capture: ActionCapture) => {
    console.log('\n========================================');
    console.log(`Action: ${capture.type}.${capture.method}`);
    console.log(`Duration: ${capture.timing.durationMs}ms`);

    if (capture.network.requests.length > 0) {
      console.log(`Network: ${capture.network.summary}`);
      for (const req of capture.network.requests) {
        console.log(`  - ${req.method} ${req.url} → ${req.status} (${req.durationMs}ms)`);
      }
    }

    if (capture.snapshot.diff) {
      const diff = capture.snapshot.diff;
      if (diff.added.length > 0)
        console.log(`Added: ${diff.added.join(', ')}`);
      if (diff.removed.length > 0)
        console.log(`Removed: ${diff.removed.join(', ')}`);
      if (diff.changed.length > 0)
        console.log(`Changed: ${diff.changed.join(', ')}`);
    }

    if (capture.error)
      console.log(`Error: ${capture.error.message}`);

    console.log('========================================\n');
  });

  listener.start();
  return listener;
}

// ============================================================================
// Example 2: Stream to database
// ============================================================================

export function attachDatabaseStreamer(context: BrowserContext, options: {
  sessionId: string;
  apiEndpoint: string;
  apiKey: string;
}) {
  const listener = new ActionCaptureListener(context, async (capture: ActionCapture) => {
    // Stream to your database/API
    try {
      await fetch(options.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          sessionId: options.sessionId,
          timestamp: Date.now(),
          capture,
        }),
      });
    } catch (error) {
      console.error('Failed to stream action capture:', error);
    }
  });

  listener.start();
  return listener;
}

// ============================================================================
// Example 3: Collect for AI analysis
// ============================================================================

export class ActionCaptureCollector {
  private _listener: ActionCaptureListener;
  private _captures: ActionCapture[] = [];

  constructor(context: BrowserContext) {
    this._listener = new ActionCaptureListener(context, (capture) => {
      this._captures.push(capture);
    });
  }

  start() {
    this._listener.start();
  }

  stop() {
    this._listener.stop();
  }

  getCaptures(): ActionCapture[] {
    return this._captures;
  }

  /**
   * Format captures for AI consumption
   */
  formatForAI(): string {
    const lines: string[] = [];

    for (let i = 0; i < this._captures.length; i++) {
      const capture = this._captures[i];
      lines.push(`## Action ${i + 1}: ${capture.title || `${capture.type}.${capture.method}`}`);
      lines.push(`Duration: ${capture.timing.durationMs}ms`);
      lines.push('');

      if (capture.network.requests.length > 0) {
        lines.push(`### Network (${capture.network.requests.length} requests)`);
        for (const req of capture.network.requests) {
          lines.push(`- ${req.method} ${req.url} → ${req.status} (${req.durationMs}ms)`);
        }
        lines.push('');
      }

      if (capture.console.length > 0) {
        lines.push(`### Console (${capture.console.length} messages)`);
        for (const msg of capture.console) {
          lines.push(`- [${msg.type.toUpperCase()}] ${msg.text}`);
        }
        lines.push('');
      }

      if (capture.snapshot.diff) {
        const diff = capture.snapshot.diff;
        const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
        if (hasChanges) {
          lines.push('### Page Changes');
          if (diff.added.length > 0)
            lines.push(`- Added: ${diff.added.join(', ')}`);
          if (diff.removed.length > 0)
            lines.push(`- Removed: ${diff.removed.join(', ')}`);
          if (diff.changed.length > 0)
            lines.push(`- Changed: ${diff.changed.join(', ')}`);
          lines.push('');
        }
      }

      if (capture.error) {
        lines.push('### Error');
        lines.push(`${capture.error.message}`);
        lines.push('');
      }

      if (capture.snapshot.after) {
        lines.push('### Page State After Action');
        lines.push('```yaml');
        lines.push(capture.snapshot.after);
        lines.push('```');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get summary for quick overview
   */
  getSummary(): {
    totalActions: number;
    totalDurationMs: number;
    totalNetworkRequests: number;
    errors: number;
    pageChanges: { added: number; removed: number; changed: number };
  } {
    let totalDurationMs = 0;
    let totalNetworkRequests = 0;
    let errors = 0;
    const pageChanges = { added: 0, removed: 0, changed: 0 };

    for (const capture of this._captures) {
      totalDurationMs += capture.timing.durationMs;
      totalNetworkRequests += capture.network.requests.length;
      if (capture.error)
        errors++;
      if (capture.snapshot.diff) {
        pageChanges.added += capture.snapshot.diff.added.length;
        pageChanges.removed += capture.snapshot.diff.removed.length;
        pageChanges.changed += capture.snapshot.diff.changed.length;
      }
    }

    return {
      totalActions: this._captures.length,
      totalDurationMs,
      totalNetworkRequests,
      errors,
      pageChanges,
    };
  }
}

// ============================================================================
// Example 4: Integration with test runner (Playwright Test)
// ============================================================================

/*
// In your playwright.config.ts or test setup:

import { test as base } from '@playwright/test';
import { ActionCaptureCollector } from './actionCaptureListener.example';

export const test = base.extend<{ actionCaptures: ActionCaptureCollector }>({
  actionCaptures: async ({ context }, use) => {
    const collector = new ActionCaptureCollector(context._context); // Access internal context
    collector.start();

    await use(collector);

    collector.stop();

    // Attach captures to test report
    const captures = collector.getCaptures();
    if (captures.length > 0) {
      await test.info().attach('action-captures.json', {
        body: JSON.stringify(captures, null, 2),
        contentType: 'application/json',
      });

      await test.info().attach('action-captures-for-ai.md', {
        body: collector.formatForAI(),
        contentType: 'text/markdown',
      });
    }
  },
});

// Then in your test:
test('login flow', async ({ page, actionCaptures }) => {
  await page.goto('/login');
  await page.fill('#username', 'user@example.com');
  await page.fill('#password', 'password');
  await page.click('button[type="submit"]');

  // After test, actionCaptures will have all the data
  // formatted and ready for AI analysis
});
*/
