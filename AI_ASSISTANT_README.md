# Playwright AI Assistant - Self-Healing Tests

## Overview

The **AI Assistant** adds Claude-powered self-healing capabilities to Playwright's UI Mode. When tests fail, click the **Self-Heal** button to automatically analyze failures and propose fixes using AI.

## Features

### 🪄 Self-Heal Button
- **One-click fix** for failed tests
- Analyzes error messages, DOM snapshots, and test code
- Suggests fixes following Playwright best practices
- Shows confidence level (High/Medium/Low)

### 🔍 Intelligent Analysis
- **Brittle selectors** → Converts CSS classes to `getByRole()`
- **Timeout errors** → Identifies missing waits or unstable elements
- **Multiple elements** → Adds `.first()` or better specificity
- **Best practices** → Always follows Playwright's recommended patterns

### 💬 Advanced Chat (Optional)
- Collapsible chat interface for complex debugging
- Ask questions about test execution
- Query actions, errors, network requests, console logs
- Generate and test locators

### 🎨 Beautiful UI
- Split diff viewer (old vs new code)
- Animated analysis steps
- Color-coded confidence badges
- VS Code-themed design

## Getting Started

### 1. Install Your Fork

```bash
# Clone your forked version
git clone https://github.com/YOUR_USERNAME/playwright.git
cd playwright

# Install dependencies
npm install

# Build the project
npm run build

# Link it globally (optional)
npm link @playwright/test
```

### 2. Configure API Key

When you first open the AI Assistant tab, you'll see:

```
┌─────────────────────────────────────┐
│ 🔑 Configure API Key                │
│                                     │
│ API key required for AI-powered     │
│ test analysis                       │
└─────────────────────────────────────┘
```

**Option A: Via Settings UI** (Recommended)
1. Click the **gear icon** ⚙️ in the AI Assistant header
2. Enter your Anthropic API key (starts with `sk-ant-`)
3. Click **Save Key**
4. Status will show ✅ **Connected**

**Option B: Via Environment Variable**
```bash
export ANTHROPIC_API_KEY=sk-ant-api03-...
npx playwright test --ui
```

**Where to get an API key:**
- Visit [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- Create a new API key
- Copy and paste into settings

**Security:**
- API key is stored in browser `localStorage`
- Never sent to Playwright servers
- Only used for direct Claude API calls

### 3. Run Tests

```bash
# Run Playwright UI Mode
npx playwright test --ui

# Navigate to a failed test
# Open the "AI Assistant" tab
# Click "Self-Heal" button
```

## Usage Examples

### Example 1: Fix Brittle Selector

**Failed Test:**
```typescript
await page.locator('.submit-btn').click();
// ❌ TimeoutError: locator.click: Timeout 30000ms exceeded
```

**Click Self-Heal →**

```
✅ Proposed Fix [HIGH confidence]

Issue: Brittle selector - CSS class may change
Explanation: CSS classes are fragile and prone to
breaking when styles change. Use getByRole() instead.

- await page.locator('.submit-btn').click();
+ await page.getByRole('button', { name: 'Submit' }).click();

✓ Accept Fix  ↻ Try Another  ✕ Reject
```

### Example 2: Advanced Chat

**Collapsed by default. Click "Advanced Chat" to expand:**

```
You: Why did this test fail?

AI: 🔴 I found 1 error in this test:

Error 1: Timeout exceeded while waiting for locator

Stack trace:
  at handleSubmit (test.spec.ts:24)

Action before error: click
Parameters: { selector: ".submit-btn" }

💡 Suggestions:
- Check if the element selector is still valid
- Use "generate better locator" if the selector is brittle
```

## API Key Management

### Status Indicators

| Icon | Status | Meaning |
|------|--------|---------|
| 🔑 | API key required | No key configured |
| ⚠️ | Invalid key | Key format is incorrect |
| ✅ | Connected | Ready to use |
| ⏳ | Checking... | Validating key |

### Settings Modal

The settings modal provides:
- **Password-masked input** for API key
- **Real-time validation** (checks `sk-ant-` prefix)
- **Clear instructions** with link to get API key
- **Environment variable option** for CI/CD
- **Clear Key button** to remove stored key

### Storage Details

```javascript
// API key is stored as:
localStorage.getItem('anthropic_api_key')

// To clear manually (browser console):
localStorage.removeItem('anthropic_api_key')
```

## MCP Tools Available

The AI Assistant uses these MCP (Model Context Protocol) tools:

### Trace Analysis Tools
- `trace_get_test_info` - Test metadata and duration
- `trace_get_errors` - Errors with stack traces
- `trace_get_actions` - All Playwright actions
- `trace_get_network_requests` - HTTP requests
- `trace_get_console_logs` - Browser console output
- `trace_get_screenshots` - Screenshot information

### Self-Heal Tools
- `trace_get_test_source` - Read test file source
- `trace_propose_fix` - Analyze and generate fix
- `trace_apply_fix` - Apply proposed changes

### Locator Tools
- `trace_generate_locator` - Generate best-practice locators
- `trace_test_locator` - Test locators against DOM
- `trace_suggest_better_locators` - Improve brittle selectors
- `trace_convert_locator_syntax` - Convert CSS/XPath/Playwright

### DOM Query Tools
- `trace_get_dom_snapshot` - Get HTML at timestamp
- `trace_query_dom` - Query using selectors
- `trace_find_element` - Search by text/role/label
- `trace_get_element_properties` - Get element details

## Architecture

```
┌─────────────────────────────────────┐
│  AI Assistant UI (React)            │
│  - Self-Heal Button                 │
│  - Settings Modal                   │
│  - Diff Viewer                      │
│  - Advanced Chat                    │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  TraceAnalysisMCPServer              │
│  - Routes MCP tool calls             │
│  - Trace data access                 │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  MultiTraceModel                     │
│  - Test execution data               │
│  - Actions, errors, network, DOM     │
└─────────────────────────────────────┘

    ┌────────────────────┐
    │ Self-Heal Flow:    │
    └────────────────────┘
           │
           ▼
    /claude-api (Proxy)
           │
           ▼ HTTPS (avoids CORS)
    Claude API (Anthropic)
           │
           ▼
    Real AI Analysis + Vision
```

**Key Components:**

1. **Client-side UI** (`aiAssistantTab.tsx`): React component with Self-Heal button
2. **MCP Server** (`traceAnalysisMCP.ts`): Routes tool calls to trace data
3. **Claude API Proxy** (`traceViewer.ts`): Server-side proxy at `/claude-api` to avoid CORS
4. **Anthropic Claude API**: Real AI with vision capabilities

## QA Expert System

The `proposeFix()` method includes embedded QA expertise:

### Fix Patterns

**Selector Issues:**
```typescript
// Detects: CSS class selectors
// Suggests: Role-based locators
.locator('.btn') → .getByRole('button')
```

**Multiple Elements:**
```typescript
// Detects: Multiple matches
// Suggests: .first() or better specificity
.locator('.item') → .locator('.item').first()
```

**Timeout Errors:**
```typescript
// Detects: Timeout on action
// Suggests: Better selector + explicit waits
await page.locator('.btn').click()
→ await page.getByRole('button').click({ timeout: 5000 })
```

## Development

### File Structure

```
packages/trace-viewer/src/
├── ui/
│   ├── aiAssistantTab.tsx       # Main UI component
│   ├── aiAssistantTab.css       # Styles (self-heal + settings)
│   └── workbench.tsx            # Integration point
├── server/
│   ├── traceAnalysisMCP.ts      # MCP server + QA logic
│   ├── locatorTools.ts          # Locator generation
│   └── domQueryTools.ts         # DOM snapshot queries
```

### Adding New Fix Patterns

Edit `packages/trace-viewer/src/server/traceAnalysisMCP.ts`:

```typescript
private proposeFix(args: any): MCPToolResult {
  const errorMessage = error.message || '';

  // Add new pattern
  if (errorMessage.includes('your-error-pattern')) {
    issue = 'Your issue description';
    explanation = 'Why this happens and how to fix';
    oldCode = 'await page.oldPattern()';
    newCode = 'await page.newPattern()';
    confidence = 'high';
  }

  // ... rest of logic
}
```

### Claude API Integration ✅

The Self-Heal feature now uses **REAL Claude API** with the following capabilities:

**Model:** `claude-3-5-sonnet-20241022` (Claude 3.5 Sonnet with vision)

**What Claude analyzes:**
- 🔴 Error messages and stack traces
- 📝 Test source code
- 📸 Screenshots (up to 3 near failure) - **VISION ANALYSIS**
- 🖥️ Console logs (JavaScript errors, warnings)
- 🌐 Network requests (API calls, status codes)

**How it works:**
1. Collects all trace data (errors, screenshots, logs, network)
2. Sends to Claude API with QA expert system prompt
3. Claude analyzes screenshots visually to understand UI state
4. Returns intelligent fix with Playwright best practices
5. Shows confidence level (high/medium/low)

**Example API call:**
```typescript
await callClaudeAPI({
  apiKey: 'sk-ant-...',
  error: { message: '...', stack: '...' },
  testSource: 'await page.locator(...).click();',
  filePath: 'test.spec.ts',
  screenshots: [{ base64: '...', timestamp: 123 }],  // Vision!
  consoleLogs: [{ type: 'error', text: '...' }],
  networkRequests: [{ method: 'GET', url: '...', status: 404 }],
  model: trace
});
```

**System Prompt includes:**
- Playwright best practices (getByRole > getByLabel > getByTestId > CSS)
- Common error patterns (timeouts, brittle selectors, multiple elements)
- Step-by-step analysis framework
- JSON output format enforcement

## Troubleshooting

### CORS and Proxy Architecture

**Why we need a proxy:**
- Browsers block direct API calls to Anthropic due to CORS (Cross-Origin Resource Sharing)
- The `/claude-api` endpoint acts as a server-side proxy
- All Claude API calls route through the local Playwright server

**Flow:**
1. Browser → `POST /claude-api` (same origin, no CORS)
2. Playwright server → `POST https://api.anthropic.com/v1/messages` (server-to-server, no CORS)
3. Claude response → Playwright server → Browser

**If you see CORS errors:**
- Make sure you're using the updated build
- The proxy is automatically enabled in the trace viewer server
- Check browser console for proxy endpoint errors

### API Key Not Working

**Check format:**
```javascript
// Valid format:
sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

// Invalid:
sk-ant (too short)
api-key-xxx (wrong prefix)
```

**Verify storage:**
```javascript
// Open browser console (F12)
localStorage.getItem('anthropic_api_key')
// Should return your key or null
```

### Self-Heal Button Disabled

**Reasons:**
1. ❌ No API key configured → Click "Configure API Key"
2. ❌ Test passed (no errors) → Only works on failed tests
3. ❌ No trace loaded → Select a test first

### Build Errors

```bash
# Clean rebuild
npm run clean
npm install
npm run build
```

## FAQ

**Q: Is my API key secure?**
A: Yes. It's stored locally in browser localStorage and only used for direct Claude API calls. Never sent to Playwright servers.

**Q: Can I use this in CI/CD?**
A: Yes! Set `ANTHROPIC_API_KEY` environment variable in your CI pipeline.

**Q: Does this use real AI or hardcoded logic?**
A: REAL AI! Uses Claude 3.5 Sonnet with vision capabilities to analyze errors, screenshots, code, logs, and network requests.

**Q: Can Claude actually see the screenshots?**
A: Yes! Claude's vision capabilities analyze up to 3 screenshots near the failure point to understand the UI state visually.

**Q: Does this modify my test files?**
A: Currently simulated. In production, you'd need to implement actual file I/O with user confirmation.

**Q: What if the fix is wrong?**
A: Claude provides confidence levels. For LOW confidence, review carefully. You can also "Reject" and debug manually.

**Q: How much does it cost?**
A: Uses your Anthropic API key. Claude 3.5 Sonnet costs ~$3 per million input tokens. A typical fix analysis with screenshots uses ~10-50k tokens (~$0.03-0.15 per fix).

**Q: Does this work with TypeScript/JavaScript/Python?**
A: The locator generation supports all Playwright languages. Test file modification needs language-specific implementation.

## Contributing

Found a bug or have a suggestion? Please open an issue!

### Testing Changes

```bash
# After making changes
npm run build -- --scope=@playwright/trace-viewer

# Test in UI Mode
npx playwright test --ui
```

## License

This is a fork of Playwright, licensed under Apache 2.0.

---

**Built with Claude** 🤖
