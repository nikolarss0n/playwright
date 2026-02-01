import * as fs from 'fs';
import * as path from 'path';

export interface PlaywrightConfig {
  baseURL?: string;
  testDir?: string;
  configPath?: string;
}

export interface ExistingTest {
  file: string;
  name: string;
  description: string;
}

const CONFIG_FILES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
];

const DEFAULT_CONFIG = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: '{{BASE_URL}}',
  },
});
`;

export function findPlaywrightConfig(cwd: string = process.cwd()): string | null {
  for (const file of CONFIG_FILES) {
    const configPath = path.join(cwd, file);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

export function parsePlaywrightConfig(cwd: string = process.cwd()): PlaywrightConfig {
  const configPath = findPlaywrightConfig(cwd);
  if (!configPath) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config: PlaywrightConfig = { configPath };

    // Extract baseURL using regex (handles both use: { baseURL } and baseURL in use object)
    const baseURLMatch = content.match(/baseURL\s*:\s*['"`]([^'"`]+)['"`]/);
    if (baseURLMatch) {
      config.baseURL = baseURLMatch[1];
    }

    // Also check for environment variable pattern
    const envMatch = content.match(/baseURL\s*:\s*process\.env\.(\w+)/);
    if (envMatch && process.env[envMatch[1]]) {
      config.baseURL = process.env[envMatch[1]];
    }

    // Extract testDir
    const testDirMatch = content.match(/testDir\s*:\s*['"`]([^'"`]+)['"`]/);
    if (testDirMatch) {
      config.testDir = testDirMatch[1];
    }

    return config;
  } catch (error) {
    return { configPath };
  }
}

export function saveBaseURL(baseURL: string, cwd: string = process.cwd()): string {
  const configPath = findPlaywrightConfig(cwd);

  if (configPath) {
    // Update existing config
    let content = fs.readFileSync(configPath, 'utf-8');

    // Check if baseURL already exists
    const baseURLRegex = /baseURL\s*:\s*['"`][^'"`]*['"`]/;
    if (baseURLRegex.test(content)) {
      // Replace existing baseURL
      content = content.replace(baseURLRegex, `baseURL: '${baseURL}'`);
    } else {
      // Add baseURL to use object
      const useRegex = /use\s*:\s*\{/;
      if (useRegex.test(content)) {
        content = content.replace(useRegex, `use: {\n    baseURL: '${baseURL}',`);
      } else {
        // Add use object with baseURL
        const configRegex = /defineConfig\s*\(\s*\{/;
        if (configRegex.test(content)) {
          content = content.replace(configRegex, `defineConfig({\n  use: {\n    baseURL: '${baseURL}',\n  },`);
        }
      }
    }

    fs.writeFileSync(configPath, content, 'utf-8');
    return configPath;
  } else {
    // Create new config
    const newConfigPath = path.join(cwd, 'playwright.config.ts');
    const content = DEFAULT_CONFIG.replace('{{BASE_URL}}', baseURL);
    fs.writeFileSync(newConfigPath, content, 'utf-8');
    return newConfigPath;
  }
}

export function scanExistingTests(cwd: string = process.cwd()): ExistingTest[] {
  const config = parsePlaywrightConfig(cwd);
  const testDir = config.testDir || 'tests';
  const testsPath = path.join(cwd, testDir);

  if (!fs.existsSync(testsPath)) {
    return [];
  }

  const tests: ExistingTest[] = [];

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.test.ts')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relativePath = path.relative(cwd, fullPath);

          // Extract test descriptions
          const testMatches = content.matchAll(/test\s*\(\s*['"`]([^'"`]+)['"`]/g);
          const describeMatches = content.matchAll(/test\.describe\s*\(\s*['"`]([^'"`]+)['"`]/g);

          const descriptions: string[] = [];
          for (const match of describeMatches) {
            descriptions.push(`describe: ${match[1]}`);
          }
          for (const match of testMatches) {
            descriptions.push(`test: ${match[1]}`);
          }

          if (descriptions.length > 0) {
            tests.push({
              file: relativePath,
              name: entry.name,
              description: descriptions.join(', '),
            });
          }
        } catch {}
      }
    }
  }

  scanDir(testsPath);
  return tests;
}
