import type * as playwright from 'playwright-core';

export type PageEx = playwright.Page & {
  _snapshotForAI: () => Promise<string>;
};

export type SnapshotDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  summary: string;
};

export type NetworkRequest = {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
};

export type McpActionCapture = {
  timing: {
    durationMs: number;
  };
  network: {
    requests: NetworkRequest[];
    summary: string;
  };
  snapshot: {
    before?: string;
    after?: string;
    diff?: SnapshotDiff;
  };
  console: ConsoleMessage[];
};

export type ModalState = {
  type: 'dialog' | 'fileChooser';
  description: string;
  dialog?: playwright.Dialog;
  fileChooser?: playwright.FileChooser;
  clearedBy: string;
};

export type ConsoleMessage = {
  type: string | undefined;
  text: string;
  toString(): string;
};

export type TabSnapshot = {
  url: string;
  title: string;
  ariaSnapshot: string;
  modalStates: ModalState[];
  consoleMessages: ConsoleMessage[];
};
