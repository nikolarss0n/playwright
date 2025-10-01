import { test, expect } from '@playwright/test';

test.describe('Self-Heal Demo Tests', () => {
  // EASY: Wrong selector - brittle CSS class
  test('test 1 - brittle CSS selector', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    // Better: Using stable placeholder selector
    await page.getByPlaceholder('What needs to be done?').fill('Buy groceries');
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    // Verify the todo was added
    await expect(page.locator('.todo-list li')).toHaveText('Buy groceries');
  });

  // MEDIUM: Missing wait for navigation
  test('test 2 - race condition, no wait for navigation', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    // Add a todo
    await page.getByPlaceholder('What needs to be done?').fill('Task 1');
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    // Problem: Clicking too fast, should wait for element to be ready
    await page.locator('.toggle').click(); // No wait, might be too fast

    // Verify todo is completed
    await expect(page.locator('.todo-list li')).toHaveClass(/completed/);
  });

  // HARD: Wrong page state - trying to act before data loads
  test('test 3 - acting before page is ready', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    // First create some todos
    await page.getByPlaceholder('What needs to be done?').fill('Task 1');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await page.getByPlaceholder('What needs to be done?').fill('Task 2');
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    // Now toggle all todos to complete
    await page.locator('.toggle-all').click();

    // Verify all items are complete (0 items left)
    await expect(page.locator('.todo-count')).toContainText('0 items left');
  });

  // MEDIUM: Multiple elements matched, need specificity
  test('test 4 - selector matches multiple elements', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    // Add multiple todos
    await page.getByPlaceholder('What needs to be done?').fill('Task 1');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await page.getByPlaceholder('What needs to be done?').fill('Task 2');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await page.getByPlaceholder('What needs to be done?').fill('Task 3');
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    // Click specifically on the first todo item using role and text
    await page.getByRole('listitem').filter({ hasText: 'Task 1' }).click();

    await expect(page.locator('.todo-list li')).toHaveCount(3);
  });

  // HARD: Wrong assertion expectation
  test('test 5 - wrong expected state', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    await page.getByPlaceholder('What needs to be done?').fill('Buy milk');
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    // Problem: Wrong expectation - it says "1 item left" not "1 items left"
    await expect(page.locator('.todo-count')).toHaveText('1 item left');
  });

  // EASY: Element doesn't exist at all
  test('test 6 - element does not exist', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    // First add and complete a todo
    await page.getByPlaceholder('What needs to be done?').fill('Task to delete');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    await page.locator('.toggle').click();

    // Use the correct "Clear completed" button
    await page.getByRole('button', { name: 'Clear completed' }).click();

    await expect(page.locator('.todo-list')).not.toBeVisible();
  });

  // HARD: Wrong navigation - trying to use element from wrong page
  test('test 7 - wrong URL/page', async ({ page }) => {
    // Problem: Going to wrong URL (missing #/)
    await page.goto('https://demo.playwright.dev/todomvc');

    // The app might not load correctly without the hash
    await page.getByPlaceholder('What needs to be done?').fill('Test task');
    await page.getByPlaceholder('What needs to be done?').press('Enter');

    await expect(page.locator('.todo-list li')).toHaveCount(1);
  });

  // MEDIUM: Timing - acting on element that's animating/transitioning
  test('test 8 - element not yet visible', async ({ page }) => {
    await page.goto('https://demo.playwright.dev/todomvc/');

    await page.getByPlaceholder('What needs to be done?').fill('Task 1');
    await page.getByPlaceholder('What needs to be done?').press('Enter');
    
    // Complete the todo first
    await page.locator('.toggle').click();
    
    // Wait for the clear-completed button to be visible and click it
    await page.getByRole('button', { name: 'Clear completed' }).click();

    // Verify the todo is removed (list should be empty)
    await expect(page.locator('.todo-list li')).toHaveCount(0);
  });
});
