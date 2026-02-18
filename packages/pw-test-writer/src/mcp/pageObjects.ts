/**
 * Page Object Index — live scanner for .page.ts and .service.ts files.
 *
 * Extracts class names, parent classes, methods (with @step decorators),
 * getters, and basic locator patterns from the target E2E project.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface PageObjectMethod {
  name: string;
  params: string;
  stepLabel?: string;
  isAsync: boolean;
}

export interface PageObjectGetter {
  name: string;
}

export interface PageObjectInfo {
  filePath: string;
  relativePath: string;
  className: string;
  parentClass?: string;
  methods: PageObjectMethod[];
  getters: PageObjectGetter[];
}

const CLASS_RE = /export\s+(?:default\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/;
const STEP_METHOD_RE = /@step\(([^)]*)\)\s*\n\s*(?:async\s+)?(\w+)\(([^)]*)\)/g;
const ASYNC_METHOD_RE = /^\s+async\s+(\w+)\(([^)]*)\)/gm;
const GETTER_RE = /^\s+(?:private\s+)?get\s+(\w+)\s*\(\s*\)/gm;

function parsePageObject(content: string, filePath: string, relativePath: string): PageObjectInfo | null {
  const classMatch = content.match(CLASS_RE);
  if (!classMatch) return null;

  const className = classMatch[1];
  const parentClass = classMatch[2];

  const methods: PageObjectMethod[] = [];
  const seenMethods = new Set<string>();

  // Extract @step-decorated methods first (higher priority)
  let m;
  while ((m = STEP_METHOD_RE.exec(content)) !== null) {
    const stepLabel = m[1].replace(/['"]/g, '').trim() || undefined;
    const name = m[2];
    const params = m[3].trim();
    if (!seenMethods.has(name)) {
      seenMethods.add(name);
      methods.push({ name, params, stepLabel, isAsync: true });
    }
  }

  // Extract remaining async methods (not already captured by @step)
  while ((m = ASYNC_METHOD_RE.exec(content)) !== null) {
    const name = m[1];
    const params = m[2].trim();
    if (!seenMethods.has(name) && !name.startsWith('_')) {
      seenMethods.add(name);
      methods.push({ name, params, isAsync: true });
    }
  }

  // Extract getters
  const getters: PageObjectGetter[] = [];
  while ((m = GETTER_RE.exec(content)) !== null) {
    getters.push({ name: m[1] });
  }

  return { filePath, relativePath, className, parentClass, methods, getters };
}

export async function scanPageObjects(cwd: string): Promise<PageObjectInfo[]> {
  const patterns = ['**/*.page.ts', '**/*.service.ts'];
  const ignore = ['**/node_modules/**', '**/dist/**', '**/build/**'];

  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd, ignore });
    files.push(...matches);
  }

  // Deduplicate and sort
  const uniqueFiles = [...new Set(files)].sort();

  const results: PageObjectInfo[] = [];
  for (const relPath of uniqueFiles) {
    const absPath = path.resolve(cwd, relPath);
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const info = parsePageObject(content, absPath, relPath);
      if (info) results.push(info);
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Compact summary for e2e_get_context — class names, file paths, method count only.
 * Use e2e_scan_page_objects for full method signatures when you need them.
 */
export function formatPageObjectSummary(objects: PageObjectInfo[]): string {
  if (objects.length === 0) return 'No page objects or services found.';

  const lines: string[] = [
    `## Page Object Index (${objects.length} classes) — call \`e2e_scan_page_objects\` for full method signatures`,
    '',
  ];

  for (const obj of objects) {
    const ext = obj.parentClass ? ` extends ${obj.parentClass}` : '';
    const methodCount = obj.methods.length;
    const getterCount = obj.getters.length;
    const counts = [
      methodCount > 0 ? `${methodCount} methods` : '',
      getterCount > 0 ? `${getterCount} getters` : '',
    ].filter(Boolean).join(', ');
    lines.push(`- **${obj.className}${ext}** \`${obj.relativePath}\`${counts ? ` — ${counts}` : ''}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Full detail index for e2e_scan_page_objects — all methods with params and step labels.
 */
export function formatPageObjectIndex(objects: PageObjectInfo[]): string {
  if (objects.length === 0) return 'No page objects or services found.';

  const lines: string[] = [`## Page Object Index (${objects.length} classes)`, ''];

  for (const obj of objects) {
    const ext = obj.parentClass ? ` extends ${obj.parentClass}` : '';
    lines.push(`### ${obj.className}${ext}`);
    lines.push(`File: \`${obj.relativePath}\``);

    if (obj.methods.length > 0) {
      lines.push('Methods:');
      for (const m of obj.methods) {
        const label = m.stepLabel ? ` [@step("${m.stepLabel}")]` : '';
        const params = m.params ? `(${m.params})` : '()';
        lines.push(`  - ${m.name}${params}${label}`);
      }
    }

    if (obj.getters.length > 0) {
      lines.push('Getters:');
      for (const g of obj.getters) {
        lines.push(`  - ${g.name}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
