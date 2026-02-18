import type { ActionCapture } from 'playwright-core/lib/server/actionCaptureTypes';

export interface TestAttachment {
  name: string;
  path: string;
  contentType: string;
}

export interface TestRunTestEntry {
  file: string;
  test: string;
  location: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string;
  actions: ActionCapture[];
  attachments: TestAttachment[];
}

export interface TestRunResult {
  runId: string;
  timestamp: number;
  tests: TestRunTestEntry[];
}
