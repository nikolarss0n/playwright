import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { colors } from '../../theme.js';

interface ProgressIndicatorProps {
  elapsed: number;
  total: number;
  width?: number;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function ProgressIndicator({ elapsed, total, width = 20 }: ProgressIndicatorProps) {
  const percent = Math.min(1, elapsed / total);
  const filled = Math.floor(percent * width);
  const empty = width - filled;
  const bar = chalk.hex(colors.primary)('█'.repeat(filled)) + chalk.hex(colors.borderDim)('░'.repeat(empty));
  const remaining = total - elapsed;
  const timeColor = remaining < 30000 ? chalk.hex(colors.error) : remaining < 60000 ? chalk.hex(colors.warning) : chalk.hex(colors.success);
  return <Text>{bar} {timeColor(formatTime(remaining))}</Text>;
}

export { formatTime };
