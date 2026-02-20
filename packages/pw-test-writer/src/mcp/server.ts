/**
 * MCP Server Backend
 *
 * Wires tool definitions and handlers to the MCP SDK Server.
 * Stores test run results in memory for the lifetime of the server process.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefs, handleTool, type RunsMap, type ToolContext } from './tools.js';
import { discoverTests, discoverProjects, runTest, runProject } from './captureRunner.js';
import type { TestRunResult } from './types.js';

export function createMcpServer(cwd: string): Server {
  const runs: RunsMap = new Map<string, TestRunResult>();

  const server = new Server(
    { name: 'playwright-autopilot', version: '0.4.0' },
    {
      capabilities: { tools: {} },
      instructions: `E2E Test Capture — Playwright test runner with deep debugging.

Use this server to run and debug Playwright E2E tests. Prefer these tools over running tests manually via bash.

## Workflow
0. e2e_get_context — load stored flows + page object index (do this FIRST before debugging)
1. e2e_list_projects — see available Playwright projects from the config
2. e2e_list_tests — discover tests (use "project" param to filter, e.g. "e2e", "admin")
3. e2e_run_test — run a specific test (by file:line) with action capture, or run all tests (omit location) for a pass/fail summary. Returns runId
4. Diagnose failures using the runId:
   - e2e_get_failure_report — comprehensive error report with DOM, network, console, timeline
   - e2e_get_actions — step-by-step action timeline
   - e2e_get_action_detail — deep dive into a single action (params, timing, error)
   - e2e_get_dom_snapshot — aria tree before/after an action (use "which": "both")
   - e2e_get_dom_diff — what changed in the DOM between before/after
   - e2e_get_network — network requests (filter by urlPattern, method, statusMin)
   - e2e_get_console — console output (filter by type: error, warn, log)
   - e2e_get_screenshot — failure screenshot as image
   - e2e_get_test_source — read the test file with the failing test highlighted
5. Fix the test code, then re-run with e2e_run_test to verify

## Context Loading
- **Always call \`e2e_get_context\` before debugging.** It returns stored application flows and a page object index in one call.
- Cross-reference stored flows against the test's action timeline to identify missing steps.
- Use the page object index to find existing methods instead of writing raw Playwright calls.

## Flow Discovery (when no flows are stored)

When \`e2e_get_context\` returns no stored flows, you must understand the application's user journey before debugging. Do NOT skip this — debugging without understanding the intended flow leads to wrong fixes.

**Priority order for discovering flows:**

1. **Search external documentation.** If you have access to Confluence, wiki, or documentation search tools (e.g. Atlassian MCP, WebFetch, WebSearch), use them to find specs or flow descriptions for the feature under test. Search for the feature name, page name, or test description.

2. **Read the test source.** Use \`e2e_get_test_source\` to understand what the test intends to do. Read the page objects and service files it imports to understand the available interactions.

3. **Run and observe.** Run the test with \`e2e_run_test\` and use \`e2e_get_actions\` to see what actually executed. This gives you ground truth of the current flow.

4. **Scan all specs.** Use \`e2e_discover_flows\` to get a draft flow map from static analysis of all spec files — this shows you how similar features are tested.

5. **Save confirmed flows.** After fixing, propose the complete flow to the user with \`e2e_save_app_flow\` so future sessions start with full context.

## Debugging Tips
- Start with e2e_get_failure_report for a quick overview of what went wrong
- Use e2e_get_dom_snapshot to see actual page state when an assertion fails
- Use e2e_get_network with statusMin=400 to find failed API calls
- The "project" param maps to Playwright config projects (check playwright.config.ts)

## How to Fix Tests — Think Like a Senior QA Engineer

When a test fails, follow this mental model. You are a QA engineer, not a developer. You fix tests through the UI, never by hacking browser internals.

### Step 1: Understand the User Flow
Before touching any code, ask: "What would a real user do on this page?" Walk through the expected user journey step by step. If the test skips a step that a real user would perform (selecting a dropdown, clicking a radio button, filling a required field), that is the bug.

### Step 2: Analyze the DOM Snapshot
Use e2e_get_dom_snapshot with "which": "both" on the failing action. Look for:
- Interactive elements (dropdowns, buttons, checkboxes, radio buttons) that are PRESENT in the DOM but NOT interacted with by the test
- Form fields that have default/empty values when they should have been set
- Required selections (like category, country, payment method) that the test never made
- Error messages or validation warnings visible in the DOM
- Some elements appear dynamically — they may not be in the initial snapshot but appear after interacting with other elements

The DOM snapshot is your most powerful diagnostic tool. It shows you exactly what the page looks like — if you see a dropdown with options that the test never selected, that is almost certainly the missing step.

### Step 3: Search Existing Page Objects and Services
Use \`e2e_get_context\` or \`e2e_scan_page_objects\` to see all available methods. BEFORE writing any new code, search the project's page objects and service files for methods that already handle the interaction you identified:
- Search for method names matching the UI element (e.g., "selectCategory", "setCountry", "choosePaymentMethod")
- Look at similar flows in the codebase — if a similar flow selects a category, the new flow probably needs the same step
- Check the page object for the current page — it likely already has locators and methods for every interactive element

### Step 4: Try It — Don't Overthink
When you find an existing page object method that matches the missing interaction, USE IT immediately. Do not theorize about whether the element exists or whether it will work — add the call and run the test. The test result is the truth, not your assumptions. Some elements render dynamically or appear after other interactions, so the only way to know is to try.

### Step 5: Add the Missing Step in the Right Place
Add the missing UI interaction in the SERVICE or TEST file, not in shared page objects. Prefer the minimal change:
- Add one line calling the existing page object method in the service file's step method
- Do NOT modify the page object's core methods (like navigation or button clicks) — those are shared across many tests
- Do NOT rewrite the test flow — just insert the missing step where it belongs

### Step 6: Iterate on Failure
After making a change, re-run the test immediately. If it fails at a DIFFERENT point, that is progress — the first issue is fixed, now diagnose the next one. Keep iterating: fix one step at a time, re-run, check the new failure. Do not try to fix everything in one shot.

### Important: Solve from First Principles
Do NOT look at git history, git blame, or previous commits to find fixes. Solve the problem using the DOM snapshot, page objects, and your understanding of the user flow. The codebase has everything you need — previous commits may contain abandoned approaches or partial fixes that will mislead you.

## ABSOLUTE PROHIBITIONS — Never Do These

These are developer hacks, NOT how QA engineers fix tests. Using any of these to fix a test failure is ALWAYS wrong:

- page.evaluate() to modify page state, inject parameters, or manipulate the DOM
- page.addInitScript() to patch browser APIs before page load
- page.route() to intercept, modify, or mock network requests as a workaround
- Monkey-patching window.fetch or XMLHttpRequest to inject missing parameters
- Any form of JavaScript injection to work around a missing UI step
- Modifying API request/response payloads to make tests pass

If you find yourself reaching for page.evaluate, page.route, or addInitScript to fix a test, STOP. You are solving the wrong problem. Go back to Step 1 and find the missing UI interaction.

## Playwright Best Practices

NEVER do:
- try/catch around Playwright actions or assertions — Playwright has built-in retry and timeout
- Manual waits (setTimeout, page.waitForTimeout) — use locator assertions instead
- Catching errors to retry or fallback — this hides real failures
- Adding defensive checks like "if element exists, then click" — use expect().toBeVisible()

ALWAYS do:
- Use Playwright's auto-waiting locators: page.getByRole(), page.getByText(), page.getByTestId()
- Use web-first assertions: expect(locator).toBeVisible(), .toHaveText(), .toContainText()
- Use expect(locator).toBeVisible() before interacting if timing is an issue
- Use page.waitForURL() or page.waitForLoadState() for navigation
- Keep tests linear and declarative — no branching, no error recovery logic

## Diagnosing Root Cause: Four Categories

When a test fails, the root cause falls into one of four categories:

### 1. Missing Test Step (most common)
The test skips a UI interaction that the application requires. Signs:
- API call fails because a required parameter is missing (but the parameter comes from a UI element the test never interacted with)
- The DOM shows interactive elements (dropdowns, buttons, checkboxes) that were never used
- A similar flow elsewhere in the tests DOES interact with that element
Fix: Find the existing page object method and add the missing interaction.

### 2. Test Code Bug
The test has wrong selectors, outdated assertions, bad test data, or missing waits. Signs:
- The locator doesn't match any element in the DOM snapshot
- The assertion expects text that differs from what's actually rendered
- The test data is stale or invalid
Fix: Update the selector, assertion, or test data to match the current application.

### 3. Application Bug
The application itself is broken — not something the test should work around. Signs:
- Network requests return 500 errors regardless of test input
- Console shows unhandled exceptions in application code
- The DOM shows the app in a broken/error state even when all test steps are correct
- The bug reproduces when manually following the same user flow
Action: Report as an application bug with evidence. Do NOT modify tests to work around it.

### 4. Dirty State (leftover from previous test run)
The application has state from a previous test run that interferes with the current flow. Signs:
- A dialog appears at flow entry asking "Continue?" / "Resume?" or "Start fresh?"
- The flow fails at step 1 or 2 — very early, before the main flow logic even starts
- The stored flow has a \`pre_conditions\` field like "no draft exists" and the DOM shows a draft continuation dialog
- The test was recently fixed and passes in isolation but fails when the whole suite runs
Fix: Add a \`beforeEach\` cleanup (API call to delete draft/session state) so the test always starts clean.
IMPORTANT: If a "continue draft?" dialog exists, it is ALSO a feature that needs its own test. Save a separate flow variant using the naming convention \`{flowName}--continue-draft\` that tests the continuation path end-to-end.

## Flow Variants and Pre-conditions

When saving flows with \`e2e_save_app_flow\`, capture the full picture:
- Use \`pre_conditions\` to document what app state this flow requires (e.g. "no draft exists", "user is logged in")
- Use \`notes\` to record edge cases and observations discovered during debugging — these accumulate over time like memory entries
- Use \`related_flows\` to link variants: "checkout", "checkout--continue-draft", "checkout--validation"

**Naming convention for variants:** append \`--{variant}\` to the base flow name.
- \`checkout\` → clean-start flow (pre_condition: no draft exists)
- \`checkout--continue-draft\` → tests that a partial draft can be resumed
- \`checkout--validation\` → tests form validation errors

When you encounter a dirty-state failure, save two flows: the clean-start flow with the fix noted, and the continuation flow as a separate confirmed variant.

## Reporting & Evidence

- **e2e_get_evidence_bundle** — Get ALL failure evidence in one call (error, steps to reproduce, action timeline, network with bodies, console, DOM snapshot, screenshots). Pass \`outputFile: true\` to write a markdown file for Jira attachments.
- **e2e_generate_report** — Generate a self-contained HTML or JSON report file. HTML includes inline styles, base64 screenshots, and collapsible per-test sections. Great for sharing with non-technical stakeholders.

## Flaky Detection

Two modes for detecting flaky tests:

**\`retries: N\`** — Run N+1 separate Playwright processes. Each gets its own runId with full action capture. Best for debugging (2-3 retries). Returns FLAKY/CONSISTENT PASS/CONSISTENT FAIL verdict.

**\`repeatEach: N\`** — Native Playwright \`--repeat-each\`. All N iterations in one process. Fast stress-test for confirming flakiness (use 30-100). Returns pass/fail counts.

Combine both: use \`repeatEach: 40\` to confirm flakiness, then \`retries: 2\` to capture detailed failure data for investigation.

## Coverage Analysis

- **e2e_suggest_tests** — Scans page objects, spec files, and stored flows to identify coverage gaps: untested page object methods, missing flow variants (e.g. "checkout" exists but "checkout--continue-draft" doesn't), and flow steps that no spec exercises.`,
    },
  );

  const sendProgress = (message: string) => {
    try { server.sendLoggingMessage({ level: 'info', data: message }); } catch {}
  };

  const ctx: ToolContext = {
    cwd,
    runs,
    discoverTests: (cwd: string, project?: string) => discoverTests(cwd, project),
    discoverProjects: (cwd: string) => discoverProjects(cwd),
    runTest: (location: string, cwd: string, options?: { project?: string; grep?: string; timeoutMs?: number; repeatEach?: number }) =>
      runTest(location, cwd, { project: options?.project, grep: options?.grep, timeoutMs: options?.timeoutMs, repeatEach: options?.repeatEach, onProgress: sendProgress }),
    runProject: (cwd: string, options?: { project?: string; repeatEach?: number }) =>
      runProject(cwd, { project: options?.project, repeatEach: options?.repeatEach, onProgress: sendProgress }),
    sendProgress,
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefs.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleTool(name, (args as Record<string, unknown>) || {}, ctx);
    return result as unknown as CallToolResult;
  });

  return server;
}
