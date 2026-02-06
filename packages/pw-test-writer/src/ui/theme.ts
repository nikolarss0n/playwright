import chalk from 'chalk';

export const colors = {
  primary:       '#FF9500',  // macOS orange — main accent
  primaryBright: '#FFCC00',  // macOS yellow — bright accent
  secondary:     '#5AC8FA',  // macOS teal
  success:       '#34C759',  // macOS green
  error:         '#FF3B30',  // macOS red
  warning:       '#FF9500',  // macOS orange
  info:          '#007AFF',  // macOS blue
  border:        '#636366',  // macOS gray — bumped for visibility
  borderFocus:   '#FF9500',  // macOS orange
  borderDim:     '#48484A',  // macOS gray 4 — bumped
  text:          '#F2F2F7',  // macOS systemGray6 light
  textSecondary: '#C7C7CC',  // macOS systemGray — bumped for dark/transparent terminals
  textDim:       '#AEAEB2',  // macOS systemGray2 — bumped
  textMuted:     '#8E8E93',  // macOS systemGray3 — bumped
  highlight:     '#FFCC00',  // macOS yellow
  running:       '#5AC8FA',  // macOS teal
  ai:            '#FF2D55',  // macOS pink
  aiBorder:      '#FF2D55',  // macOS pink
  selectBg:      '#0A3A6B',  // macOS blue selection
  pillBg:        '#2C2C2E',  // macOS gray 5 — subtle action pill bg
  pillExpandedBg:'#3A3A3C',  // macOS gray 4 — expanded action bg
};

export const th = {
  primary:       chalk.hex(colors.primary),
  primaryBright: chalk.hex(colors.primaryBright),
  secondary:     chalk.hex(colors.secondary),
  success:       chalk.hex(colors.success),
  error:         chalk.hex(colors.error),
  warning:       chalk.hex(colors.warning),
  info:          chalk.hex(colors.info),
  border:        chalk.hex(colors.border),
  borderFocus:   chalk.hex(colors.borderFocus),
  borderDim:     chalk.hex(colors.borderDim),
  text:          chalk.hex(colors.text),
  textSecondary: chalk.hex(colors.textSecondary),
  textDim:       chalk.hex(colors.textDim),
  textMuted:     chalk.hex(colors.textMuted),
  highlight:     chalk.hex(colors.highlight),
  running:       chalk.hex(colors.running),
  ai:            chalk.hex(colors.ai),
  aiBorder:      chalk.hex(colors.aiBorder),
  selected:      chalk.bgHex(colors.selectBg).hex('#FFFFFF'),
  pill:          chalk.bgHex(colors.pillBg),
  pillExpanded:  chalk.bgHex(colors.pillExpandedBg),
};

export const chars = {
  branch:   '├ ',
  last:     '└ ',
  pipe:     '│ ',
  blank:    '  ',
  expand:   '▸',
  collapse: '▾',
  dot:      '●',
  circle:   '○',
  half:     '◐',
  check:    '✓',
  cross:    '✗',
  filled:   '█',
  empty:    '░',
  arrow:    '▸',
  scrollbar:'▐',
  scrollBg: '░',
};

const sparkCharsArr = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/** Map a value 0–1 to a sparkline char */
export function sparkChar(value: number): string {
  const idx = Math.min(sparkCharsArr.length - 1, Math.max(0, Math.round(value * (sparkCharsArr.length - 1))));
  return sparkCharsArr[idx]!;
}

/** Section divider: `─── Label (N) ───` with dim dashes and bright label */
export function divider(label: string, count?: number, width = 40): string {
  const countStr = count !== undefined ? ` (${count})` : '';
  const inner = ` ${label}${countStr} `;
  const remaining = Math.max(0, width - inner.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return th.borderDim('─'.repeat(left)) + th.textSecondary(inner) + th.borderDim('─'.repeat(right));
}

/** Waterfall bar: `██████░░░░` proportional to ratio (0–1), within `width` chars */
export function waterfall(ratio: number, width = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  const empty = width - filled;
  return th.secondary(chars.filled.repeat(filled)) + th.borderDim(chars.empty.repeat(empty));
}

/** Inline status dots: ✓✓✓✗ — one char per result */
export function statusDots(results: Array<{ status: string }>): string {
  return results.map(r => {
    if (r.status === 'passed') return chalk.hex(colors.success)(chars.check);
    if (r.status === 'failed') return chalk.hex(colors.error)(chars.cross);
    if (r.status === 'running') return chalk.hex(colors.running)(chars.dot);
    return chalk.hex(colors.textMuted)(chars.circle);
  }).join('');
}

/** Mini pass/fail bar: `████░ 3/4` */
export function miniBar(passed: number, total: number, width = 8): string {
  if (total === 0) return '';
  const ratio = passed / total;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return chalk.hex(colors.success)(chars.filled.repeat(filled))
    + chalk.hex(colors.error)(chars.empty.repeat(empty))
    + th.textDim(` ${passed}/${total}`);
}

/** Skeleton loading placeholder */
export function skeleton(width = 20): string {
  return th.borderDim(chars.empty.repeat(width));
}

/** Format bytes to human-readable */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}
