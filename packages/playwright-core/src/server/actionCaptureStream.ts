/**
 * Action Capture Streaming
 *
 * Streams ActionCapture data to your backend in real-time.
 * Supports multiple backends: HTTP API, WebSocket, PostgreSQL, etc.
 */

import type { ActionCapture, StreamEventType, StreamEvent } from './actionCaptureTypes';
import type { BrowserContext } from './browserContext';

// Re-export so existing importers continue to work
export type { StreamEventType, StreamEvent } from './actionCaptureTypes';

// ============================================================================
// Types
// ============================================================================

export interface StreamConfig {
  // Session identification
  sessionId: string;
  testFile?: string;
  testTitle?: string;

  // Metadata
  metadata?: Record<string, any>;
}

export interface StreamBackend {
  name: string;
  connect(): Promise<void>;
  send(event: StreamEvent): Promise<void>;
  disconnect(): Promise<void>;
}

// ============================================================================
// HTTP Backend
// ============================================================================

export interface HttpBackendConfig {
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class HttpBackend implements StreamBackend {
  name = 'http';
  private _config: HttpBackendConfig;
  private _buffer: StreamEvent[] = [];
  private _flushTimer?: NodeJS.Timeout;

  constructor(config: HttpBackendConfig) {
    this._config = {
      batchSize: 10,
      flushIntervalMs: 1000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    // Start flush timer
    this._flushTimer = setInterval(() => this._flush(), this._config.flushIntervalMs);
  }

  async send(event: StreamEvent): Promise<void> {
    this._buffer.push(event);

    if (this._buffer.length >= this._config.batchSize!) {
      await this._flush();
    }
  }

  async disconnect(): Promise<void> {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
    }
    await this._flush();
  }

  private async _flush(): Promise<void> {
    if (this._buffer.length === 0) return;

    const events = this._buffer;
    this._buffer = [];

    try {
      const response = await fetch(this._config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this._config.apiKey ? { 'Authorization': `Bearer ${this._config.apiKey}` } : {}),
          ...this._config.headers,
        },
        body: JSON.stringify({ events }),
      });

      if (!response.ok) {
        console.error(`[ActionCapture] HTTP error: ${response.status} ${response.statusText}`);
        // Re-add events to buffer for retry
        this._buffer.unshift(...events);
      }
    } catch (error) {
      console.error('[ActionCapture] HTTP send failed:', error);
      // Re-add events to buffer for retry
      this._buffer.unshift(...events);
    }
  }
}

// ============================================================================
// WebSocket Backend
// ============================================================================

export interface WebSocketBackendConfig {
  url: string;
  apiKey?: string;
  reconnectIntervalMs?: number;
}

export class WebSocketBackend implements StreamBackend {
  name = 'websocket';
  private _config: WebSocketBackendConfig;
  private _ws?: WebSocket;
  private _buffer: StreamEvent[] = [];
  private _connected = false;

  constructor(config: WebSocketBackendConfig) {
    this._config = {
      reconnectIntervalMs: 5000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this._config.url);
      if (this._config.apiKey) {
        url.searchParams.set('apiKey', this._config.apiKey);
      }

      // Note: WebSocket is not available in Node.js by default
      // You'd need to use 'ws' package or similar
      const WebSocketImpl = (globalThis as any).WebSocket || require('ws');
      this._ws = new WebSocketImpl(url.toString());

      this._ws!.onopen = () => {
        this._connected = true;
        // Flush buffered events
        for (const event of this._buffer) {
          this._ws!.send(JSON.stringify(event));
        }
        this._buffer = [];
        resolve();
      };

      this._ws!.onerror = (error: any) => {
        console.error('[ActionCapture] WebSocket error:', error);
        if (!this._connected) {
          reject(error);
        }
      };

      this._ws!.onclose = () => {
        this._connected = false;
        // Attempt reconnect
        setTimeout(() => this.connect().catch(() => {}), this._config.reconnectIntervalMs);
      };
    });
  }

  async send(event: StreamEvent): Promise<void> {
    if (this._connected && this._ws) {
      this._ws.send(JSON.stringify(event));
    } else {
      this._buffer.push(event);
    }
  }

  async disconnect(): Promise<void> {
    if (this._ws) {
      this._ws.close();
      this._ws = undefined;
    }
  }
}

// ============================================================================
// Console Backend (for debugging)
// ============================================================================

export class ConsoleBackend implements StreamBackend {
  name = 'console';
  private _verbose: boolean;

  constructor(options?: { verbose?: boolean }) {
    this._verbose = options?.verbose ?? false;
  }

  async connect(): Promise<void> {
    console.error('[ActionCapture] Console backend connected');
  }

  async send(event: StreamEvent): Promise<void> {
    const prefix = `[ActionCapture:${event.type}]`;

    switch (event.type) {
      case 'session:start':
        console.error(`${prefix} Session ${event.sessionId} started`);
        break;
      case 'session:end':
        console.error(`${prefix} Session ${event.sessionId} ended`);
        break;
      case 'action:capture':
        const capture = event.data as ActionCapture;
        console.error(`${prefix} ${capture.type}.${capture.method} (${capture.timing.durationMs}ms)`);
        if (capture.network.requests.length > 0) {
          console.error(`  Network: ${capture.network.summary}`);
        }
        if (capture.snapshot.diff && capture.snapshot.diff.summary !== 'no changes') {
          console.error(`  Changes: ${capture.snapshot.diff.summary}`);
        }
        if (capture.error) {
          console.error(`  Error: ${capture.error.message}`);
        }
        if (this._verbose && capture.snapshot.after) {
          console.error(`  Snapshot:\n${capture.snapshot.after}`);
        }
        break;
      case 'error':
        console.error(`${prefix} Error:`, event.data);
        break;
    }
  }

  async disconnect(): Promise<void> {
    console.error('[ActionCapture] Console backend disconnected');
  }
}

// ============================================================================
// File Backend (writes to JSON file)
// ============================================================================

export interface FileBackendConfig {
  outputPath: string;
  pretty?: boolean;
}

export class FileBackend implements StreamBackend {
  name = 'file';
  private _config: FileBackendConfig;
  private _events: StreamEvent[] = [];

  constructor(config: FileBackendConfig) {
    this._config = config;
  }

  async connect(): Promise<void> {
    this._events = [];
  }

  async send(event: StreamEvent): Promise<void> {
    this._events.push(event);
  }

  async disconnect(): Promise<void> {
    const fs = await import('fs');
    const content = this._config.pretty
      ? JSON.stringify(this._events, null, 2)
      : JSON.stringify(this._events);
    await fs.promises.writeFile(this._config.outputPath, content);
    console.error(`[ActionCapture] Wrote ${this._events.length} events to ${this._config.outputPath}`);
  }
}

// ============================================================================
// Action Capture Streamer
// ============================================================================

export class ActionCaptureStreamer {
  private _backends: StreamBackend[] = [];
  private _config: StreamConfig;
  private _actionCount = 0;

  constructor(config: StreamConfig) {
    this._config = config;
  }

  addBackend(backend: StreamBackend): this {
    this._backends.push(backend);
    return this;
  }

  async start(): Promise<void> {
    // Connect all backends
    await Promise.all(this._backends.map(b => b.connect()));

    // Send session start event
    await this._send({
      type: 'session:start',
      sessionId: this._config.sessionId,
      timestamp: Date.now(),
      data: {
        testFile: this._config.testFile,
        testTitle: this._config.testTitle,
        metadata: this._config.metadata,
      },
    });
  }

  async captureAction(capture: ActionCapture, context: BrowserContext): Promise<void> {
    this._actionCount++;

    await this._send({
      type: 'action:capture',
      sessionId: this._config.sessionId,
      timestamp: Date.now(),
      data: {
        ...capture,
        actionIndex: this._actionCount,
        contextId: context.guid,
      },
    });
  }

  async stop(): Promise<void> {
    // Send session end event
    await this._send({
      type: 'session:end',
      sessionId: this._config.sessionId,
      timestamp: Date.now(),
      data: {
        totalActions: this._actionCount,
      },
    });

    // Disconnect all backends
    await Promise.all(this._backends.map(b => b.disconnect()));
  }

  private async _send(event: StreamEvent): Promise<void> {
    await Promise.all(this._backends.map(b => b.send(event).catch(error => {
      console.error(`[ActionCapture] ${b.name} backend error:`, error);
    })));
  }
}

// ============================================================================
// Easy Setup Function
// ============================================================================

export interface SetupOptions {
  sessionId?: string;

  // HTTP backend
  httpEndpoint?: string;
  httpApiKey?: string;

  // WebSocket backend
  wsUrl?: string;
  wsApiKey?: string;

  // File backend
  outputFile?: string;

  // Console logging
  console?: boolean;
  verbose?: boolean;

  // Additional metadata
  metadata?: Record<string, any>;
}

export function createStreamer(options: SetupOptions): ActionCaptureStreamer {
  const sessionId = options.sessionId || `session-${Date.now()}`;

  const streamer = new ActionCaptureStreamer({
    sessionId,
    metadata: options.metadata,
  });

  // Add backends based on options
  if (options.httpEndpoint) {
    streamer.addBackend(new HttpBackend({
      endpoint: options.httpEndpoint,
      apiKey: options.httpApiKey,
    }));
  }

  if (options.wsUrl) {
    streamer.addBackend(new WebSocketBackend({
      url: options.wsUrl,
      apiKey: options.wsApiKey,
    }));
  }

  if (options.outputFile) {
    streamer.addBackend(new FileBackend({
      outputPath: options.outputFile,
      pretty: true,
    }));
  }

  if (options.console !== false) {
    streamer.addBackend(new ConsoleBackend({
      verbose: options.verbose,
    }));
  }

  return streamer;
}

// ============================================================================
// Global Setup (call this once at startup)
// ============================================================================

let globalStreamer: ActionCaptureStreamer | undefined;

export async function setupGlobalCapture(options: SetupOptions): Promise<void> {
  const { BrowserContext } = await import('./browserContext');

  globalStreamer = createStreamer(options);
  await globalStreamer.start();

  // Set the global callback
  BrowserContext.onActionCapture = (capture, context) => {
    globalStreamer?.captureAction(capture, context);
  };
}

export async function teardownGlobalCapture(): Promise<void> {
  const { BrowserContext } = await import('./browserContext');

  BrowserContext.onActionCapture = undefined;

  if (globalStreamer) {
    await globalStreamer.stop();
    globalStreamer = undefined;
  }
}
