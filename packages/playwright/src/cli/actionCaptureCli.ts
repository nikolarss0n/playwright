#!/usr/bin/env node
/**
 * Action Capture CLI
 *
 * Run Playwright tests with automatic action capture.
 * No test modifications needed - just use this CLI instead of `playwright test`.
 *
 * Usage:
 *   npx pw-capture test [playwright args...]
 *
 * Environment variables:
 *   ACTION_CAPTURE_ENDPOINT  - HTTP endpoint to stream captures
 *   ACTION_CAPTURE_API_KEY   - API key for authentication
 *   ACTION_CAPTURE_WS_URL    - WebSocket URL for real-time streaming
 *   ACTION_CAPTURE_OUTPUT    - File path to write captures
 *   ACTION_CAPTURE_SESSION   - Custom session ID
 *   ACTION_CAPTURE_VERBOSE   - Enable verbose logging
 */

import { setupGlobalCapture, teardownGlobalCapture } from 'playwright-core/lib/server/actionCaptureStream';

// ============================================================================
// Parse Environment Variables
// ============================================================================

function getConfig() {
  return {
    sessionId: process.env.ACTION_CAPTURE_SESSION || `session-${Date.now()}`,
    httpEndpoint: process.env.ACTION_CAPTURE_ENDPOINT,
    httpApiKey: process.env.ACTION_CAPTURE_API_KEY,
    wsUrl: process.env.ACTION_CAPTURE_WS_URL,
    wsApiKey: process.env.ACTION_CAPTURE_WS_API_KEY,
    outputFile: process.env.ACTION_CAPTURE_OUTPUT,
    console: true,
    verbose: process.env.ACTION_CAPTURE_VERBOSE === 'true' || process.env.ACTION_CAPTURE_VERBOSE === '1',
    metadata: {
      cwd: process.cwd(),
      nodeVersion: process.version,
      platform: process.platform,
      startTime: new Date().toISOString(),
    },
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Action Capture CLI - Run Playwright tests with automatic action capture

Usage:
  npx pw-capture test [playwright args...]
  npx pw-capture test tests/login.spec.ts
  npx pw-capture test --project=chromium

Environment Variables:
  ACTION_CAPTURE_ENDPOINT   HTTP endpoint to stream captures to
  ACTION_CAPTURE_API_KEY    API key for HTTP authentication
  ACTION_CAPTURE_WS_URL     WebSocket URL for real-time streaming
  ACTION_CAPTURE_OUTPUT     File path to write captures (JSON)
  ACTION_CAPTURE_SESSION    Custom session ID (default: auto-generated)
  ACTION_CAPTURE_VERBOSE    Enable verbose snapshot logging (true/false)

Examples:
  # Basic usage - logs to console
  npx pw-capture test

  # Stream to your backend
  ACTION_CAPTURE_ENDPOINT=https://api.example.com/captures npx pw-capture test

  # Save to file for later analysis
  ACTION_CAPTURE_OUTPUT=./captures.json npx pw-capture test

  # Full setup
  ACTION_CAPTURE_ENDPOINT=https://api.example.com/captures \\
  ACTION_CAPTURE_API_KEY=your-api-key \\
  ACTION_CAPTURE_OUTPUT=./captures.json \\
  npx pw-capture test
`);
    process.exit(0);
  }

  // Get configuration
  const config = getConfig();

  console.error('╔══════════════════════════════════════════════════════════════╗');
  console.error('║                    Action Capture CLI                        ║');
  console.error('╠══════════════════════════════════════════════════════════════╣');
  console.error(`║ Session: ${config.sessionId.padEnd(51)}║`);
  if (config.httpEndpoint) {
    console.error(`║ HTTP: ${config.httpEndpoint.slice(0, 54).padEnd(54)}║`);
  }
  if (config.wsUrl) {
    console.error(`║ WebSocket: ${config.wsUrl.slice(0, 49).padEnd(49)}║`);
  }
  if (config.outputFile) {
    console.error(`║ Output: ${config.outputFile.slice(0, 52).padEnd(52)}║`);
  }
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error('');

  // Initialize capture
  await setupGlobalCapture(config);

  // Find the command
  const command = args[0];
  const commandArgs = args.slice(1);

  let exitCode = 0;

  try {
    if (command === 'test' || !command) {
      // Run playwright test
      exitCode = await runPlaywrightTest(commandArgs);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error('Use "npx pw-capture test" to run tests');
      exitCode = 1;
    }
  } catch (error) {
    console.error('Error running tests:', error);
    exitCode = 1;
  } finally {
    // Cleanup
    await teardownGlobalCapture();

    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║                    Capture Complete                          ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
  }

  process.exit(exitCode);
}

// ============================================================================
// Run Playwright Test
// ============================================================================

async function runPlaywrightTest(args: string[]): Promise<number> {
  // Import playwright test runner
  const { program } = await import('playwright/lib/program');

  // Run with args
  return new Promise((resolve) => {
    // Override process.exit to capture exit code
    const originalExit = process.exit;
    (process as any).exit = (code: number) => {
      resolve(code || 0);
    };

    // Run playwright
    program.parseAsync(['node', 'playwright', 'test', ...args]).then(() => {
      resolve(0);
    }).catch((error) => {
      console.error(error);
      resolve(1);
    }).finally(() => {
      process.exit = originalExit;
    });
  });
}

// ============================================================================
// Run
// ============================================================================

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
