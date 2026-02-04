// Type declarations for internal playwright modules

declare module 'playwright-core/lib/server/browserContext' {
  export class BrowserContext {
    static onActionCapture?: (capture: any, context: any) => void | Promise<void>;
  }
}

declare module 'playwright/lib/program' {
  import { Command } from 'commander';
  export const program: Command;
}

declare module 'playwright-core/lib/server/actionCaptureStream' {
  export function setupGlobalCapture(options: any): Promise<void>;
  export function teardownGlobalCapture(): Promise<void>;
}
