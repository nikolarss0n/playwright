/**
 * Capture Server
 *
 * HTTP server that receives action captures from test processes
 * and forwards them to a CaptureTarget for processing.
 */

import * as http from 'http';
import { store } from '../ui/store.js';
import type { ActionCapture, StreamEvent, NetworkRequestCapture } from 'playwright-core/lib/server/actionCaptureTypes';

/**
 * Interface for receiving capture events.
 * The TUI passes the store; the MCP server passes an in-memory accumulator.
 */
export interface CaptureTarget {
  addActionCapture(capture: ActionCapture): void;
  setCurrentAction(name: string | null): void;
  setWaitingFor?(waiting: string | null): void;
  addStep?(action: string): number;
  updateStep?(id: number, status: 'pending' | 'running' | 'done' | 'error', details?: string): void;
  setTestRunning?(testKey: string, file: string, test: string): void;
  startTestTimer?(): void;
  clearTestTimer?(): void;
  setStatus?(status: string): void;
}

/**
 * Adapter that wraps the TUI store as a CaptureTarget.
 */
function storeTarget(): CaptureTarget {
  return {
    addActionCapture: (c) => store.addActionCapture(c),
    setCurrentAction: (n) => store.setCurrentAction(n),
    setWaitingFor: (w) => store.setWaitingFor(w),
    addStep: (a) => store.addStep(a),
    updateStep: (id, s, d) => store.updateStep(id, s, d),
    setTestRunning: (k, f, t) => store.setTestRunning(k, f, t),
    startTestTimer: () => store.startTestTimer(),
    clearTestTimer: () => store.clearTestTimer(),
    setStatus: (s) => store.setStatus(s),
  };
}

// ── Module-level singleton (used by TUI) ──

let singletonInstance: CaptureServerInstance | null = null;

export async function startCaptureServer(): Promise<number> {
  if (singletonInstance) return (await singletonInstance.start());
  singletonInstance = createCaptureServer(storeTarget());
  return singletonInstance.start();
}

export function stopCaptureServer(): void {
  if (singletonInstance) {
    singletonInstance.stop();
    singletonInstance = null;
  }
}

export function getCaptureEndpoint(): string | null {
  return singletonInstance?.getEndpoint() ?? null;
}

// ── Factory for standalone capture servers ──

export interface CaptureServerInstance {
  start(): Promise<number>;
  stop(): void;
  getEndpoint(): string | null;
}

export function createCaptureServer(target: CaptureTarget): CaptureServerInstance {
  let httpServer: http.Server | null = null;
  let port: number | null = null;
  let stepId: number | null = null;

  function handleEvents(events: StreamEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'action:start': {
          const { title, method, type: actionType } = event.data || {};
          const actionName = title || `${actionType || 'action'}.${method || 'unknown'}`;
          target.setCurrentAction(actionName);
          if (target.addStep) {
            stepId = target.addStep(actionName);
            target.updateStep?.(stepId, 'running');
          }
          break;
        }
        case 'action:waiting': {
          const { waitingFor } = event.data || {};
          if (waitingFor) {
            target.setWaitingFor?.(waitingFor);
            if (stepId != null) {
              target.updateStep?.(stepId, 'running', `waiting for ${waitingFor}…`);
            }
          }
          break;
        }
        case 'action:capture': {
          const capture = event.data as ActionCapture;
          target.setCurrentAction(null);
          target.addActionCapture(capture);

          const parts: string[] = [];
          if (capture.timing?.durationMs) parts.push(`${capture.timing.durationMs}ms`);
          if (capture.network?.requests?.length > 0) {
            const reqs = capture.network.requests;
            const methods = reqs.map((r: NetworkRequestCapture) => `${r.method} ${r.status || '…'}`).slice(0, 2).join(', ');
            parts.push(`${reqs.length} req (${methods})`);
          }
          if (capture.console?.length > 0) {
            const errs = capture.console.filter((c: { type: string }) => c.type === 'error').length;
            if (errs > 0) parts.push(`${errs} err`);
          }
          const details = parts.join('  │  ') || undefined;

          if (stepId != null) {
            const status = capture.error ? 'error' as const : 'done' as const;
            const stepDetails = capture.error ? capture.error.message : details;
            target.updateStep?.(stepId, status, stepDetails);
            stepId = null;
          } else if (target.addStep) {
            const sid = target.addStep(capture.title || `${capture.type}.${capture.method}`);
            if (capture.error) {
              target.updateStep?.(sid, 'error', capture.error.message);
            } else {
              target.updateStep?.(sid, 'done', details);
            }
          }
          break;
        }
        case 'test:start': {
          const { testKey, file, test } = event.data || {};
          if (testKey) target.setTestRunning?.(testKey, file || '', test || '');
          stepId = null;
          target.startTestTimer?.();
          break;
        }
        case 'test:end': {
          stepId = null;
          target.clearTestTimer?.();
          break;
        }
        case 'session:start':
        case 'session:end':
          break;
        case 'error': {
          target.setStatus?.(`Capture error: ${event.data?.message || 'Unknown error'}`);
          break;
        }
      }
    }
  }

  return {
    start(): Promise<number> {
      if (httpServer) return Promise.resolve(port!);
      return new Promise((resolve, reject) => {
        httpServer = http.createServer((req, res) => {
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
            req.on('data', (chunk: string) => body += chunk);
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                handleEvents(data.events || [data]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"ok":true}');
              } catch {
                res.writeHead(400);
                res.end('Invalid JSON');
              }
            });
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        });

        httpServer.listen(0, '127.0.0.1', () => {
          const addr = httpServer!.address();
          if (typeof addr === 'object' && addr) {
            port = addr.port;
            resolve(port);
          } else {
            reject(new Error('Failed to get server port'));
          }
        });

        httpServer.on('error', reject);
      });
    },

    stop(): void {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
        port = null;
      }
    },

    getEndpoint(): string | null {
      if (!port) return null;
      return `http://127.0.0.1:${port}/capture`;
    },
  };
}
