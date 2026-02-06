#!/usr/bin/env node
/**
 * Playwright Action Capture CLI
 *
 * Interactive terminal interface for running Playwright tests
 * with automatic action capture and visualization.
 *
 * Usage:
 *   npx pw-capture          # Interactive mode
 *   npx pw-capture test     # Run all tests
 *   npx pw-capture --help   # Show help
 */

require('./lib/cli/interactiveCli');
