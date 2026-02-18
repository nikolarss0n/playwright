/**
 * Structured workflow for investigating and fixing test failures.
 *
 * The context data is organized into numbered STEP sections that match
 * these investigation steps. The AI follows them in order.
 */

/**
 * Generate the workflow instructions for the AI system prompt.
 * References the numbered STEP sections in the context data.
 */
export function getWorkflowPrompt(): string {
  return `FIX WORKFLOW — Follow these steps using the numbered STEP sections in the context data:

STEP 0: UNDERSTAND THE ARCHITECTURE (MANDATORY before any code change)
- Read the FULL TEST FILE in the context. Look at the imports — what page objects, business layers, helpers, or factories does it use?
- Use list_files to discover the project structure: look for pages/, components/, business/, factories/, helpers/ directories.
- Use read_file to read the relevant page object or business layer class that handles the failing page/feature.
- Identify available methods: if LoginPage has adminLogin(), use it. If AdminHomePage has verifyControlPanelTitleIsVisible(), use it.
- NEVER write raw page.click(), page.fill(), page.locator() calls if a page object method already exists for that action.
- Match the coding style and patterns used in the same test file and other tests.

STEP 1: READ THE ERROR (see "STEP 1: ERROR" in context)
- What action failed? What locator/selector was it trying to use?
- What is the error type? (Timeout → element not found or too slow. Assertion → wrong value. Strict mode → multiple matches.)
- How far did the test get? (check the step number in the timeline)
- Is this test flaky? (check history)

STEP 2: ANALYZE THE PAGE (see "STEP 2: PAGE STATE" in context)
- Read the DOM snapshot at the point of failure. Is the target element there?
- Check the DOM diff: were elements ADDED (new checkbox, modal, consent banner, extra field)?
- Check the DOM diff: were elements REMOVED (button gone, section deleted)?
- Check the DOM diff: were elements CHANGED (text updated, role changed, restructured)?
- If the target locator doesn't match anything in the DOM, look for the closest matching element.
- Is the page URL correct? (wrong page = navigation issue)

STEP 3: CHECK SCREENSHOTS (see "STEP 3: SCREENSHOT" in context)
- Screenshots show the visual state at failure. Note if the page looks different than expected.
- Correlate with the DOM: does the visual state match what the DOM shows?

STEP 4: CHECK NETWORK (see "STEP 4: NETWORK REQUESTS" in context)
- Are there failed requests (4xx, 5xx)? They could explain missing page content.
- Did API response data change? (Different values = assertions need updating)
- Are there new API calls or missing ones compared to what the test expects?
- Did auth/session calls succeed?
- Use actual response values for any new assertions — never guess.

STEP 5: CHECK CONSOLE (see "STEP 5: CONSOLE OUTPUT" if present)
- JavaScript errors could explain broken page behavior.
- Network errors in console confirm API issues.

STEP 6: CHECK TIMELINE (see "STEP 6: TEST TIMELINE" in context)
- What actions succeeded before the failure? This shows how far the test got.
- Did a previous action leave the page in an unexpected state?

AFTER completing all steps, determine the ROOT CAUSE — one of:
- LOCATOR_CHANGED → element exists but with different selector (update the locator from DOM snapshot)
- NEW_PREREQUISITE → new required step added to the page (add the missing interaction before the failing step)
- ELEMENT_REMOVED → element no longer in the page (remove step or use replacement element)
- TIMING_ISSUE → element needs more time to appear (add explicit wait)
- DATA_CHANGED → API returns different values (update assertion expected values from actual network data)
- NAVIGATION_CHANGED → page URL or flow changed (update goto/waitForURL)

State your diagnosis before generating the fix code.
Do NOT skip to fixing without reading all available evidence first.`;
}
