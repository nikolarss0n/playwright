import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, th, statusDots, miniBar } from '../theme.js';
import { useStore } from '../hooks/useStore.js';
import { formatTime } from './shared/ProgressIndicator.js';

export function StatusBar() {
  const isRunning = useStore(s => s.isRunning);
  const status = useStore(s => s.status);
  const mode = useStore(s => s.mode);
  const progress = useStore(s => s.progress);
  const testResults = useStore(s => s.testResults);

  // Left side: status + results
  const leftParts: string[] = [];

  if (isRunning && progress.testStartTime) {
    const elapsed = Date.now() - progress.testStartTime;
    leftParts.push(`${chalk.hex(colors.running)('●')} ${status}`);
    leftParts.push(chalk.hex(colors.textDim)(`elapsed: ${formatTime(elapsed)}`));
    if (progress.currentAction && progress.actionStartTime && (Date.now() - progress.actionStartTime) > 1000) {
      leftParts.push(chalk.hex(colors.textDim)(`action: ${formatTime(Date.now() - progress.actionStartTime)}`));
    }
  } else if (mode === 'run') {
    // Show results summary
    const passed = testResults.filter(r => r.status === 'passed').length;
    const failed = testResults.filter(r => r.status === 'failed').length;
    if (passed > 0 || failed > 0) {
      leftParts.push(statusDots(testResults));
      leftParts.push(miniBar(passed, testResults.length, 6));
      leftParts.push(chalk.hex(colors.textDim)(`${passed + failed} run`));
    }
    if (status && leftParts.length === 0) {
      leftParts.push(`${chalk.hex(colors.success)('●')} ${status}`);
    }
  } else {
    const icon = isRunning ? chalk.hex(colors.running)('●') : chalk.hex(colors.success)('●');
    leftParts.push(`${icon} ${status}`);
  }

  // Right side: contextual keyboard hints
  const hints: string[] = [];
  if (isRunning) {
    hints.push(chalk.hex(colors.textDim)('Esc=Stop'));
  } else if (mode === 'run') {
    const hasFailed = testResults.some(r => r.status === 'failed');
    if (hasFailed) {
      hints.push(chalk.hex(colors.ai)('f=Fix'));
      hints.push(chalk.hex(colors.running)('r=Rerun'));
      hints.push('c=Copy');
    }
    hints.push(chalk.hex(colors.success)('Enter=Run'));
    hints.push('Space=Toggle');
    hints.push(chalk.hex(colors.primary)('F7=Write'));
    hints.push('Esc');
  } else {
    hints.push(chalk.hex(colors.primary)('F7=Run'));
    hints.push('F9=Model');
    hints.push('F10=URL');
    hints.push('F12=Reset');
    hints.push('Esc');
  }

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">{th.borderDim('─'.repeat(200))}</Text>
      <Box paddingX={1} justifyContent="space-between">
        <Text>{leftParts.join(chalk.hex(colors.textMuted)('  │  '))}</Text>
        <Text color={colors.textMuted}>{hints.join(chalk.hex(colors.borderDim)('  ·  '))}</Text>
      </Box>
    </Box>
  );
}
