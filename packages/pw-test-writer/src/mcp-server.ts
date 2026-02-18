#!/usr/bin/env node

/**
 * E2E Test Capture MCP Server
 *
 * Exposes Playwright test execution and debug data via MCP protocol.
 * Runs as a stdio server for Claude Code integration.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp/server.js';

const cwd = process.env.PW_PROJECT_DIR || process.cwd();
const server = createMcpServer(cwd);
const transport = new StdioServerTransport();

await server.connect(transport);
