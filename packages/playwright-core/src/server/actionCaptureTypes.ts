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

// ============================================================================
// Canonical ActionCapture Types
//
// Pure type definitions — no runtime imports.
// All consumers should import types from this file.
// ============================================================================

export type NetworkRequestCapture = {
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
};

export type ConsoleMessageCapture = {
  type: string;
  text: string;
  timestamp: number;
  location?: { url: string; lineNumber: number; columnNumber: number };
};

export type SnapshotDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  summary: string;
};

export type SnapshotCapture = {
  before?: string;
  after?: string;
  diff?: SnapshotDiff;
};

export type ActionCaptureTiming = {
  startTime: number;
  endTime: number;
  durationMs: number;
};

export type ActionCapture = {
  callId: string;
  type: string;
  method: string;
  title?: string;
  params: any;

  timing: ActionCaptureTiming;

  network: {
    requests: NetworkRequestCapture[];
    summary: string;
  };
  console: ConsoleMessageCapture[];
  snapshot: SnapshotCapture;

  error?: { message: string; stack?: string };
  result?: any;

  pageId?: string;
  pageUrl?: string;
};

export type ActionCaptureCallback = (capture: ActionCapture) => void;

export type ActionStartInfo = {
  callId: string;
  type: string;
  method: string;
  title?: string;
  params: any;
  startTime: number;
};

// ============================================================================
// Stream Event Types
// ============================================================================

export type StreamEventType =
  | 'session:start'
  | 'session:end'
  | 'action:capture'
  | 'action:start'
  | 'action:waiting'
  | 'test:start'
  | 'test:end'
  | 'error';

export interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  timestamp: number;
  data: any;
}
