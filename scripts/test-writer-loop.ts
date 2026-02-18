#!/usr/bin/env npx tsx
/**
 * Test Writer Loop - Iterative Playwright test generation
 *
 * This script helps you generate high-quality Playwright tests by:
 * 1. Providing a structured workflow for test creation
 * 2. Checking generated code against quality rules
 * 3. Running tests to verify they pass
 *
 * Usage via Claude Code (recommended):
 *   claude --agent playwright-test-test-writer "Your test description"
 *
 * Usage via this script (manual iteration):
 *   npx tsx scripts/test-writer-loop.ts --prompt "Test login" --check tests/login.spec.ts
 *
 * The script can:
 *   - Check existing test files for quality issues
 *   - Generate a test template with proper structure
 *   - Run quality checks on generated tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface QualityRule {
  name: string;
  check: (code: string) => boolean;
  message: string;
  fix: string;
}

const QUALITY_RULES: QualityRule[] = [
  {
    name: 'no-if-else',
    check: (code) => {
      // Allow if/else in comments or factory functions
      const testBody = extractTestBody(code);
      return !testBody || !/\bif\s*\(/.test(testBody);
    },
    message: 'Test body contains if/else statements',
    fix: 'Extract conditionals to helper functions or create separate tests for each scenario',
  },
  {
    name: 'accessible-locators',
    check: (code) => {
      const hasFragile = /page\.(locator|\$|\$\$)\(['"](#|\.|\[)/.test(code);
      const hasAccessible = /page\.getBy(Role|Label|Text|TestId|Placeholder|AltText)/.test(code);
      return !hasFragile || hasAccessible;
    },
    message: 'Uses fragile CSS/XPath selectors instead of accessible locators',
    fix: 'Replace page.locator(".class") with page.getByRole("button", { name: "..." })',
  },
  {
    name: 'has-assertions',
    check: (code) => /expect\(/.test(code) && /\.(toBe|toHave|toContain|toBeVisible|toEqual)/.test(code),
    message: 'Test has no assertions',
    fix: 'Add expect() assertions to verify expected behavior',
  },
  {
    name: 'no-hardcoded-waits',
    check: (code) => !/waitForTimeout\(\d+\)/.test(code) && !/setTimeout/.test(code),
    message: 'Uses hardcoded timeouts instead of explicit waits',
    fix: 'Replace waitForTimeout with waitForResponse, waitForSelector, or expect().toBeVisible()',
  },
  {
    name: 'aaa-pattern',
    check: (code) => {
      const hasArrange = /page\.goto/.test(code) || /\/\/ Arrange/.test(code);
      const hasAct = /\.(click|fill|type|press|check|select)/.test(code) || /\/\/ Act/.test(code);
      const hasAssert = /expect/.test(code) || /\/\/ Assert/.test(code);
      return hasArrange && hasAct && hasAssert;
    },
    message: 'Test does not follow Arrange/Act/Assert pattern',
    fix: 'Structure test with // Arrange (setup), // Act (action), // Assert (verification)',
  },
  {
    name: 'no-console-log',
    check: (code) => !/console\.(log|debug|info)\(/.test(code),
    message: 'Test contains console.log statements',
    fix: 'Remove console.log statements from production tests',
  },
  {
    name: 'single-test',
    check: (code) => {
      const matches = code.match(/\btest\s*\(/g);
      return matches === null || matches.length === 1;
    },
    message: 'File contains multiple test blocks',
    fix: 'Split into separate files or use one test per file',
  },
  {
    name: 'no-page-locator',
    check: (code: string) => !/page\.locator\s*\(\s*['"](?!body)/.test(code),
    message: 'Uses page.locator() instead of accessible locators',
    fix: 'Replace page.locator() with getByRole, getByLabel, or getByText',
  },
  {
    name: 'has-test-describe',
    check: (code: string) => /test\.describe\s*\(/.test(code),
    message: 'Test is not wrapped in test.describe()',
    fix: 'Add test.describe("Feature Name", () => { ... })',
  },
];

function extractTestBody(code: string): string | null {
  const match = code.match(/test\([^,]+,\s*async[^{]*\{([\s\S]*?)\n\s*\}\s*\)/);
  return match ? match[1] : null;
}

function runQualityCheck(code: string): { score: number; total: number; issues: string[]; fixes: string[] } {
  const issues: string[] = [];
  const fixes: string[] = [];

  for (const rule of QUALITY_RULES) {
    if (!rule.check(code)) {
      issues.push(`[${rule.name}] ${rule.message}`);
      fixes.push(`  Fix: ${rule.fix}`);
    }
  }

  return {
    score: QUALITY_RULES.length - issues.length,
    total: QUALITY_RULES.length,
    issues,
    fixes,
  };
}

function generateTemplate(prompt: string): string {
  const testName = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  return `import { test, expect } from '@playwright/test';

test.describe('${prompt.split(' ').slice(0, 3).join(' ')}', () => {
  test('${testName}', async ({ page }) => {
    // Arrange - Navigate to the page
    await page.goto('/');

    // Act - Perform the user action
    // TODO: Add your actions here
    // await page.getByRole('button', { name: 'Submit' }).click();

    // Assert - Verify the expected outcome
    // TODO: Add your assertions here
    // await expect(page.getByRole('heading', { name: 'Success' })).toBeVisible();
  });
});
`;
}

function printBanner(title: string) {
  const line = '═'.repeat(60);
  console.log(`╔${line}╗`);
  console.log(`║ ${title.padEnd(58)} ║`);
  console.log(`╚${line}╝`);
}

function printScore(score: number, total: number) {
  const bar = '█'.repeat(score) + '░'.repeat(total - score);
  const pct = Math.round((score / total) * 100);
  console.log(`\nQuality Score: [${bar}] ${score}/${total} (${pct}%)`);

  if (score === total) {
    console.log('✅ All quality checks passed!');
  } else {
    console.log('⚠️  Quality issues found - see below for fixes');
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Test Writer Loop - Quality checker for Playwright tests

Usage:
  npx tsx scripts/test-writer-loop.ts [options]

Options:
  --check <file>      Check an existing test file for quality issues
  --template <prompt> Generate a test template with proper structure
  --batch <dir>       Run quality checks on all .spec.ts files in a directory
  --help, -h          Show this help message

Examples:
  # Check quality of existing test
  npx tsx scripts/test-writer-loop.ts --check tests/login.spec.ts

  # Generate a template
  npx tsx scripts/test-writer-loop.ts --template "Test login with invalid credentials"

  # Batch check all spec files in a directory
  npx tsx scripts/test-writer-loop.ts --batch tests/e2e/

Recommended: Use Claude Code agent for full iterative test generation:
  claude --agent playwright-test-test-writer "Write a test for login validation"
`);
    process.exit(0);
  }

  // Check mode
  const checkIndex = args.indexOf('--check');
  if (checkIndex !== -1) {
    const filePath = args[checkIndex + 1];
    if (!filePath) {
      console.error('Error: --check requires a file path');
      process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    printBanner('Test Quality Check');
    console.log(`\nFile: ${filePath}\n`);

    const code = fs.readFileSync(filePath, 'utf-8');
    const { score, total, issues, fixes } = runQualityCheck(code);

    printScore(score, total);

    if (issues.length > 0) {
      console.log('\nIssues:');
      issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue}`);
        console.log(`     ${fixes[i]}`);
      });
    }

    // Try to run the test
    console.log('\n' + '─'.repeat(60));
    console.log('Running test...\n');

    try {
      const output = execSync(`npx playwright test ${filePath} --reporter=line`, {
        encoding: 'utf-8',
        timeout: 60000,
      });
      console.log('✅ Test passed!');
      console.log(output);
    } catch (error: any) {
      console.log('❌ Test failed:');
      console.log(error.stdout || error.message);
    }

    process.exit(score === total ? 0 : 1);
  }

  // Batch mode
  const batchIndex = args.indexOf('--batch');
  if (batchIndex !== -1) {
    const dirPath = args[batchIndex + 1];
    if (!dirPath) {
      console.error('Error: --batch requires a directory path');
      process.exit(1);
    }

    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      console.error(`Error: Directory not found: ${dirPath}`);
      process.exit(1);
    }

    function findSpecFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findSpecFiles(fullPath));
        } else if (entry.name.endsWith('.spec.ts')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const files = findSpecFiles(dirPath).sort();
    if (files.length === 0) {
      console.error(`No .spec.ts files found in ${dirPath}`);
      process.exit(1);
    }

    let passCount = 0;
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf-8');
      const { score, total, issues } = runQualityCheck(code);
      const failedNames = issues.map(i => i.match(/^\[([^\]]+)\]/)?.[1]).filter(Boolean);

      if (score === total) {
        console.log(`${file}: ${score}/${total} PASS`);
        passCount++;
      } else {
        console.log(`${file}: ${score}/${total} FAIL (${failedNames.join(', ')})`);
      }
    }

    console.log(`\nSummary: ${passCount}/${files.length} files pass all rules`);
    process.exit(passCount === files.length ? 0 : 1);
  }

  // Template mode
  const templateIndex = args.indexOf('--template');
  if (templateIndex !== -1) {
    const prompt = args[templateIndex + 1];
    if (!prompt) {
      console.error('Error: --template requires a prompt');
      process.exit(1);
    }

    printBanner('Test Template Generator');

    const template = generateTemplate(prompt);
    const fileName = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40) + '.spec.ts';

    console.log(`\nTemplate for: "${prompt}"`);
    console.log(`Suggested filename: ${fileName}\n`);
    console.log('─'.repeat(60));
    console.log(template);
    console.log('─'.repeat(60));

    console.log('\nNext steps:');
    console.log('1. Copy this template to your tests directory');
    console.log('2. Fill in the TODO sections');
    console.log('3. Run: npx tsx scripts/test-writer-loop.ts --check <file>');
    console.log('\nOr use Claude Code for full iterative generation:');
    console.log(`  claude --agent playwright-test-test-writer "${prompt}"`);

    process.exit(0);
  }

  console.error('Unknown command. Use --help for usage information.');
  process.exit(1);
}

main().catch(console.error);
