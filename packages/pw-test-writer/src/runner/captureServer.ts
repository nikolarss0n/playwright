/**
 * Capture Server
 *
 * HTTP server that receives action captures from test processes
 * and forwards them to the store for live UI updates.
 */

import * as http from 'http';
import { store, ActionCapture } from '../ui/store.js';

let server: http.Server | null = null;
let serverPort: number | null = null;

export interface CaptureEvent {
  type: 'session:start' | 'session:end' | 'action:capture' | 'action:start' | 'action:waiting' | 'test:start' | 'test:end' | 'error';
  sessionId: string;
  timestamp: number;
  data: any;
}

/**
 * Start the capture server
 */
export async function startCaptureServer(): Promise<number> {
  if (server) {
    return serverPort!;
  }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // CORS headers for cross-origin requests
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/capture') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            handleCaptureEvents(data.events || [data]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
          } catch (err) {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Listen on random available port
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (typeof addr === 'object' && addr) {
        serverPort = addr.port;
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Stop the capture server
 */
export function stopCaptureServer(): void {
  if (server) {
    server.close();
    server = null;
    serverPort = null;
  }
}

/**
 * Get the capture endpoint URL
 */
export function getCaptureEndpoint(): string | null {
  if (!serverPort) return null;
  return `http://127.0.0.1:${serverPort}/capture`;
}

/**
 * Handle incoming capture events
 */
function handleCaptureEvents(events: CaptureEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'action:start': {
        // New action is starting - update progress indicator
        const { title, method, type: actionType } = event.data || {};
        const actionName = title || `${actionType || 'action'}.${method || 'unknown'}`;
        store.setCurrentAction(actionName);
        break;
      }
      case 'action:waiting': {
        // Action is waiting for something (navigation, element, network)
        const { waitingFor } = event.data || {};
        if (waitingFor) {
          store.setWaitingFor(waitingFor);
        }
        break;
      }
      case 'action:capture': {
        const capture = event.data as ActionCapture;

        // Clear current action (it completed)
        store.setCurrentAction(null);

        // Update store with the capture
        store.addActionCapture(capture);

        // Add as a step for visibility
        const stepId = store.addStep(capture.title || `${capture.type}.${capture.method}`);
        if (capture.error) {
          store.updateStep(stepId, 'error', capture.error.message);
        } else {
          const details = capture.network?.summary || `${capture.timing?.durationMs || 0}ms`;
          store.updateStep(stepId, 'done', details);
        }
        break;
      }
      case 'test:start': {
        const { testKey, file, test } = event.data || {};
        if (testKey) {
          store.setTestRunning(testKey, file || '', test || '');
        }
        // Start the test timer
        store.startTestTimer();
        break;
      }
      case 'test:end': {
        // Clear progress tracking
        store.clearTestTimer();
        break;
      }
      case 'session:start':
      case 'session:end':
        // Session events for debugging
        break;
      case 'error': {
        store.setStatus(`Capture error: ${event.data?.message || 'Unknown error'}`);
        break;
      }
    }
  }
}
