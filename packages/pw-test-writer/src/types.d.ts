// Type declarations for internal playwright modules
//
// actionCaptureTypes: thin re-export from canonical source to avoid duplicating 87 lines.
// NodeNext can't resolve the bare specifier because lib/server/actionCaptureTypes.js
// doesn't exist (types-only file, no JS emitted). The triple-slash reference lets TS
// see the real types, and the ambient module makes the import specifier valid.
/// <reference path="../../../playwright-core/src/server/actionCaptureTypes.ts" />
declare module 'playwright-core/lib/server/actionCaptureTypes' {
  export {
    NetworkRequestCapture,
    ConsoleMessageCapture,
    SnapshotDiff,
    SnapshotCapture,
    ActionCaptureTiming,
    ActionCapture,
    ActionCaptureCallback,
    ActionStartInfo,
    StreamEventType,
    StreamEvent,
  } from '../../../playwright-core/src/server/actionCaptureTypes';
}

declare module 'playwright/lib/program' {
  import { Command } from 'commander';
  export const program: Command;
}
