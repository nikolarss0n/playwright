/**
 * Example Backend Server for Action Capture
 *
 * This is a simple example showing how to receive and store captured action data.
 * In production, you'd integrate this with your database and AI system.
 *
 * Run:
 *   npx ts-node server.ts
 *
 * Then run tests:
 *   ACTION_CAPTURE_ENDPOINT=http://localhost:3000/captures npx pw-capture test
 */

import http from 'http';
import { URL } from 'url';

// ============================================================================
// Types
//
// Canonical definitions live in:
//   packages/playwright-core/src/server/actionCaptureTypes.ts
//
// This example inlines them to avoid a build-time dependency on the monorepo.
// Keep in sync with the canonical source.
// ============================================================================

interface ActionCapture {
  callId: string;
  type: string;
  method: string;
  title?: string;
  params: any;
  timing: {
    startTime: number;
    endTime: number;
    durationMs: number;
  };
  network: {
    requests: Array<{
      method: string;
      url: string;
      status: number | null;
      statusText: string;
      startTime: number;
      endTime: number;
      durationMs: number;
      resourceType: string;
      responseHeaders?: Record<string, string>;
      responseBody?: string;
      requestPostData?: string;
    }>;
    summary: string;
  };
  console: Array<{
    type: string;
    text: string;
    timestamp: number;
    location?: { url: string; lineNumber: number; columnNumber: number };
  }>;
  snapshot: {
    before?: string;
    after?: string;
    diff?: {
      added: string[];
      removed: string[];
      changed: string[];
      summary: string;
    };
  };
  error?: { message: string; stack?: string };
  result?: any;
  pageId?: string;
  pageUrl?: string;
}

interface StreamEvent {
  type: 'session:start' | 'session:end' | 'action:capture' | 'action:start' | 'action:waiting' | 'test:start' | 'test:end' | 'error';
  sessionId: string;
  timestamp: number;
  data: any;
}

// ============================================================================
// In-Memory Storage (replace with your database)
// ============================================================================

const sessions = new Map<string, {
  startTime: number;
  endTime?: number;
  metadata: any;
  actions: ActionCapture[];
}>();

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // ============================================================================
  // POST /captures - Receive captured events
  // ============================================================================
  if (url.pathname === '/captures' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const { events } = JSON.parse(body) as { events: StreamEvent[] };

      for (const event of events) {
        handleEvent(event);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, received: events.length }));
    } catch (error) {
      console.error('Error processing events:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
    return;
  }

  // ============================================================================
  // GET /sessions - List all sessions
  // ============================================================================
  if (url.pathname === '/sessions' && req.method === 'GET') {
    const sessionList = Array.from(sessions.entries()).map(([id, session]) => ({
      id,
      startTime: session.startTime,
      endTime: session.endTime,
      actionCount: session.actions.length,
      metadata: session.metadata,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessionList, null, 2));
    return;
  }

  // ============================================================================
  // GET /sessions/:id - Get session details
  // ============================================================================
  const sessionMatch = url.pathname.match(/^\/sessions\/([^\/]+)$/);
  if (sessionMatch && req.method === 'GET') {
    const sessionId = sessionMatch[1];
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session, null, 2));
    return;
  }

  // ============================================================================
  // GET /sessions/:id/ai-format - Get session formatted for AI
  // ============================================================================
  const aiFormatMatch = url.pathname.match(/^\/sessions\/([^\/]+)\/ai-format$/);
  if (aiFormatMatch && req.method === 'GET') {
    const sessionId = aiFormatMatch[1];
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    const formatted = formatForAI(session.actions);

    res.writeHead(200, { 'Content-Type': 'text/markdown' });
    res.end(formatted);
    return;
  }

  // ============================================================================
  // 404
  // ============================================================================
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ============================================================================
// Event Handlers
// ============================================================================

function handleEvent(event: StreamEvent) {
  console.log(`[${event.type}] Session: ${event.sessionId}`);

  switch (event.type) {
    case 'session:start':
      sessions.set(event.sessionId, {
        startTime: event.timestamp,
        metadata: event.data,
        actions: [],
      });
      console.log(`  Started new session`);
      break;

    case 'session:end':
      const session = sessions.get(event.sessionId);
      if (session) {
        session.endTime = event.timestamp;
        console.log(`  Session ended with ${session.actions.length} actions`);
      }
      break;

    case 'action:capture':
      const actionSession = sessions.get(event.sessionId);
      if (actionSession) {
        actionSession.actions.push(event.data);
        const capture = event.data as ActionCapture;
        console.log(`  ${capture.type}.${capture.method} (${capture.timing.durationMs}ms)`);
        if (capture.network.requests.length > 0) {
          console.log(`    Network: ${capture.network.summary}`);
        }
        if (capture.snapshot.diff && capture.snapshot.diff.summary !== 'no changes') {
          console.log(`    Changes: ${capture.snapshot.diff.summary}`);
        }
        if (capture.error) {
          console.log(`    ERROR: ${capture.error.message}`);
        }
      }
      break;

    case 'error':
      console.error(`  Error:`, event.data);
      break;
  }
}

// ============================================================================
// Format for AI
// ============================================================================

function formatForAI(actions: ActionCapture[]): string {
  const lines: string[] = [];

  lines.push('# Test Execution Trace');
  lines.push('');
  lines.push(`Total Actions: ${actions.length}`);
  lines.push(`Total Duration: ${actions.reduce((sum, a) => sum + a.timing.durationMs, 0)}ms`);
  lines.push(`Errors: ${actions.filter(a => a.error).length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    lines.push(`## Action ${i + 1}: ${action.title || `${action.type}.${action.method}`}`);
    lines.push('');
    lines.push(`- **Duration:** ${action.timing.durationMs}ms`);
    lines.push(`- **Page:** ${action.pageUrl || 'unknown'}`);
    lines.push('');

    if (action.network.requests.length > 0) {
      lines.push('### Network Requests');
      lines.push('');
      for (const req of action.network.requests) {
        const status = req.status !== null ? req.status : 'pending';
        lines.push(`- \`${req.method} ${req.url}\` → ${status} (${req.durationMs}ms)`);
      }
      lines.push('');
    }

    if (action.console.length > 0) {
      lines.push('### Console Output');
      lines.push('');
      for (const msg of action.console) {
        lines.push(`- [${msg.type.toUpperCase()}] ${msg.text}`);
      }
      lines.push('');
    }

    if (action.snapshot.diff) {
      const diff = action.snapshot.diff;
      const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
      if (hasChanges) {
        lines.push('### Page Changes');
        lines.push('');
        if (diff.added.length > 0) {
          lines.push('**Added:**');
          for (const el of diff.added) {
            lines.push(`- ${el}`);
          }
        }
        if (diff.removed.length > 0) {
          lines.push('**Removed:**');
          for (const el of diff.removed) {
            lines.push(`- ${el}`);
          }
        }
        if (diff.changed.length > 0) {
          lines.push('**Changed:**');
          for (const el of diff.changed) {
            lines.push(`- ${el}`);
          }
        }
        lines.push('');
      }
    }

    if (action.error) {
      lines.push('### ⚠️ Error');
      lines.push('');
      lines.push('```');
      lines.push(action.error.message);
      if (action.error.stack) {
        lines.push('');
        lines.push(action.error.stack);
      }
      lines.push('```');
      lines.push('');
    }

    if (action.snapshot.after) {
      lines.push('<details>');
      lines.push('<summary>Page Snapshot After Action</summary>');
      lines.push('');
      lines.push('```yaml');
      lines.push(action.snapshot.after);
      lines.push('```');
      lines.push('</details>');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Start Server
// ============================================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Action Capture Backend Server                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Listening on: http://localhost:${String(PORT).padEnd(27)}║
║                                                              ║
║  Endpoints:                                                  ║
║    POST /captures           - Receive captured events        ║
║    GET  /sessions           - List all sessions              ║
║    GET  /sessions/:id       - Get session details            ║
║    GET  /sessions/:id/ai-format - Get AI-formatted trace     ║
║                                                              ║
║  Run your tests with:                                        ║
║    ACTION_CAPTURE_ENDPOINT=http://localhost:${String(PORT).padEnd(5)}             ║
║    npx pw-capture test                                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
});
