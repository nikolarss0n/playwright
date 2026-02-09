import chalk from 'chalk';
import { colors } from '../../theme.js';

const RESPONSE_VISIBLE_LINES = 10;

export { RESPONSE_VISIBLE_LINES };

export function formatValue(value: unknown, maxWidth: number): string {
  if (value === null) return chalk.hex('#FF453A').italic('null');
  if (value === undefined) return chalk.hex(colors.textMuted)('undefined');
  if (typeof value === 'boolean') return chalk.hex('#BF5AF2')(String(value));
  if (typeof value === 'number') return chalk.hex('#FFD60A')(String(value));
  if (typeof value === 'string') {
    const escaped = value.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
    if (escaped.length > maxWidth - 2) {
      return chalk.hex('#30D158')(`"${escaped.slice(0, maxWidth - 5)}..."`);
    }
    return chalk.hex('#30D158')(`"${escaped}"`);
  }
  if (Array.isArray(value)) {
    return chalk.hex(colors.text)('[') + chalk.hex(colors.textDim)(`${value.length} items`) + chalk.hex(colors.text)(']');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return chalk.hex(colors.text)('{') + chalk.hex(colors.textDim)(`${keys.length} fields`) + chalk.hex(colors.text)('}');
  }
  return chalk.hex(colors.textDim)(String(value).slice(0, maxWidth));
}

function formatJsonOneLiner(obj: Record<string, unknown>, maxWidth: number): string {
  const parts: string[] = [];
  const keys = Object.keys(obj);
  let totalLen = 2;
  for (const key of keys) {
    const val = typeof obj[key] === 'string'
      ? `"${(obj[key] as string).slice(0, 20)}${(obj[key] as string).length > 20 ? '...' : ''}"`
      : JSON.stringify(obj[key]);
    const part = `${key}: ${val}`;
    totalLen += part.length + 2;
    if (totalLen > maxWidth) {
      parts.push(chalk.hex(colors.textDim)('...'));
      break;
    }
    parts.push(chalk.hex('#64D2FF')(key) + chalk.hex(colors.textMuted)(': ') + chalk.hex(colors.text)(val));
  }
  return chalk.hex(colors.text)('{') + ' ' + parts.join(chalk.hex(colors.textDim)(', ')) + ' ' + chalk.hex(colors.text)('}');
}

export function formatJsonPreview(jsonStr: string, maxLines: number, maxWidth: number): string[] {
  try {
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed)) {
      const lines: string[] = [];
      const itemCount = parsed.length;
      if (itemCount === 0) { lines.push(chalk.hex(colors.textDim)('[]')); return lines; }
      lines.push(chalk.hex(colors.text)('[') + chalk.hex(colors.textDim)(` ${itemCount} items`));
      const previewCount = Math.min(2, itemCount);
      for (let i = 0; i < previewCount; i++) {
        const item = parsed[i];
        if (typeof item === 'object' && item !== null) {
          const keys = Object.keys(item);
          const oneLiner = JSON.stringify(item);
          if (oneLiner.length <= maxWidth - 4) {
            lines.push(chalk.hex(colors.textDim)('  ') + formatJsonOneLiner(item, maxWidth - 4));
          } else {
            lines.push(chalk.hex(colors.textDim)('  {'));
            for (let k = 0; k < Math.min(keys.length, 4); k++) {
              const key = keys[k]!;
              const val = formatValue(item[key], maxWidth - key.length - 10);
              lines.push(chalk.hex(colors.textDim)('    ') + chalk.hex('#64D2FF')(key) + chalk.hex(colors.textMuted)(': ') + val + (k < keys.length - 1 ? chalk.hex(colors.textDim)(',') : ''));
            }
            if (keys.length > 4) lines.push(chalk.hex(colors.textDim)(`    ... +${keys.length - 4} fields`));
            lines.push(chalk.hex(colors.textDim)('  }'));
          }
        } else {
          lines.push(chalk.hex(colors.textDim)('  ') + formatValue(item, maxWidth - 4));
        }
      }
      if (itemCount > previewCount) lines.push(chalk.hex(colors.textDim)(`  ... +${itemCount - previewCount} more items`));
      lines.push(chalk.hex(colors.text)(']'));
      return lines.slice(0, maxLines);
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const lines: string[] = [];
      const keys = Object.keys(parsed);
      lines.push(chalk.hex(colors.text)('{'));
      for (let k = 0; k < Math.min(keys.length, maxLines - 2); k++) {
        const key = keys[k]!;
        const val = formatValue(parsed[key], maxWidth - key.length - 8);
        lines.push(chalk.hex(colors.textDim)('  ') + chalk.hex('#64D2FF')(key) + chalk.hex(colors.textMuted)(': ') + val + (k < keys.length - 1 ? chalk.hex(colors.textDim)(',') : ''));
      }
      if (keys.length > maxLines - 2) lines.push(chalk.hex(colors.textDim)(`  ... +${keys.length - (maxLines - 2)} more fields`));
      lines.push(chalk.hex(colors.text)('}'));
      return lines.slice(0, maxLines);
    }

    return [formatValue(parsed, maxWidth)];
  } catch {
    const lines = jsonStr.split('\n').slice(0, maxLines);
    return lines.map(l => {
      if (l.length > maxWidth) l = l.slice(0, maxWidth - 3) + '...';
      return styleJsonLine(l);
    });
  }
}

function styleValue(val: string): string {
  if (!val) return '';
  if (val.startsWith('"')) return chalk.hex('#30D158')(val);         // bright green — strings
  if (val === 'null') return chalk.hex('#FF453A').italic('null');    // red — null
  if (val === 'true' || val === 'false') return chalk.hex('#BF5AF2')(val); // purple — booleans
  if (/^-?\d/.test(val)) return chalk.hex('#FFD60A')(val);          // bright yellow — numbers
  if (val === '[' || val === ']' || val === '{' || val === '}') return chalk.hex(colors.text)(val);
  return chalk.hex(colors.textDim)(val);
}

function styleJsonLine(line: string): string {
  const m = line.match(/^(\s*)(.*)/);
  if (!m) return chalk.hex(colors.textDim)(line);
  const [, indent, content] = m;
  const kvMatch = content!.match(/^("(?:[^"\\]|\\.)*")\s*:\s*(.*)/);
  if (kvMatch) {
    let [, key, rest] = kvMatch;
    const comma = rest!.endsWith(',') ? ',' : '';
    if (comma) rest = rest!.slice(0, -1);
    return indent + chalk.hex('#64D2FF')(key) + chalk.hex(colors.textMuted)(': ') + styleValue(rest!.trim()) + chalk.hex(colors.textMuted)(comma);
  }
  const comma = content!.endsWith(',') ? ',' : '';
  const val = comma ? content!.slice(0, -1) : content!;
  return indent + styleValue(val.trim()) + chalk.hex(colors.textMuted)(comma);
}

export function formatJsonFull(jsonStr: string, maxWidth: number): string[] {
  try {
    const parsed = JSON.parse(jsonStr);
    const formatted = JSON.stringify(parsed, null, 2);
    return formatted.split('\n').map((line: string) => {
      if (line.length > maxWidth) line = line.slice(0, maxWidth - 3) + '...';
      return styleJsonLine(line);
    });
  } catch {
    // Body may be truncated (5KB limit) — still apply syntax colors line by line
    const lines = jsonStr.split('\n');
    return lines.map((line: string) => {
      if (line.length > maxWidth) line = line.slice(0, maxWidth - 3) + '...';
      return styleJsonLine(line);
    });
  }
}

// Lines that are reporter noise, not actual error content
const NOISE = /^\d+ (passed|failed|skipped)|^Running \d|^npx |^\[.+\] ›|^reports\//;
// Separator lines: repeated ─, ═, -, =, or _ (at least 3 chars)
const SEPARATOR = /^[─═\-=_]{3,}$/;

export function formatTestError(error: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  const errorLines = error.split('\n');
  for (const raw of errorLines) {
    if (lines.length >= maxLines) break;
    const trimmed = raw.trim();
    if (!trimmed || NOISE.test(trimmed) || SEPARATOR.test(trimmed)) continue;

    if (trimmed.startsWith('Error:') || trimmed.startsWith('TimeoutError:'))
      lines.push(chalk.hex(colors.error).bold(trimmed.slice(0, maxWidth)));
    else if (trimmed.match(/^Timeout \d+ms exceeded/))
      lines.push(chalk.hex(colors.error).bold(trimmed.slice(0, maxWidth)));
    else if (trimmed.startsWith('Expected:'))
      { const val = trimmed.replace('Expected:', '').trim(); lines.push(chalk.hex(colors.success)('  Expected: ') + chalk.hex(colors.success).bold(val.slice(0, maxWidth - 14))); }
    else if (trimmed.startsWith('Received:'))
      { const val = trimmed.replace('Received:', '').trim(); lines.push(chalk.hex(colors.error)('  Received: ') + chalk.hex(colors.error).bold(val.slice(0, maxWidth - 14))); }
    else if (trimmed.startsWith('Call log:'))
      lines.push(chalk.hex(colors.textDim)('  Call log:'));
    else if (trimmed.startsWith('- waiting for') || trimmed.startsWith('waiting for'))
      lines.push(chalk.hex(colors.warning)('  ' + trimmed.slice(0, maxWidth - 4)));
    else if (trimmed.startsWith('-  ') || trimmed.startsWith('- '))
      lines.push(chalk.hex(colors.textDim)('  ' + trimmed.slice(0, maxWidth - 4)));
    else if (trimmed.startsWith('>'))
      lines.push(chalk.hex(colors.error)('  ' + trimmed.slice(0, maxWidth - 4)));
    else if (trimmed.match(/^\d+\s*\|/))
      lines.push(chalk.hex(colors.textDim)('  ' + trimmed.slice(0, maxWidth - 4)));
    else if (trimmed.match(/^\|?\s*\^/))
      lines.push(chalk.hex(colors.error)('  ' + trimmed.slice(0, maxWidth - 4)));
    else if (trimmed.startsWith('at '))
      lines.push(chalk.hex(colors.textMuted)('  ' + trimmed.slice(0, maxWidth - 4)));
    else
      lines.push(chalk.hex(colors.text)('  ' + trimmed.slice(0, maxWidth - 4)));
  }
  return lines;
}
