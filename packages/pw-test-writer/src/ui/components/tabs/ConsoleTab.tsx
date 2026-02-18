import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, chars, divider } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';

interface ConsoleTabProps {
  maxLines: number;
  width: number;
}

const typeColors: Record<string, { color: string; label: string }> = {
  error: { color: colors.error, label: '[ERR]' },
  warn:  { color: colors.warning, label: '[WRN]' },
  info:  { color: colors.info, label: '[INF]' },
  log:   { color: colors.textDim, label: '[LOG]' },
};

export function ConsoleTab({ maxLines, width }: ConsoleTabProps) {
  const consoleMessages = useStore(s => s.consoleMessages);

  if (consoleMessages.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>{divider('Console', 0, width)}</Text>
        <Text> </Text>
        <Text>  {chalk.hex(colors.textMuted)(chars.circle)} {chalk.hex(colors.textDim)('No messages')} {chalk.hex(colors.borderDim)('·')} {chalk.hex(colors.textDim)('Run tests to capture')}</Text>
      </Box>
    );
  }

  const visible = consoleMessages.slice(-(maxLines - 1));
  return (
    <Box flexDirection="column">
      <Text>{divider('Console', consoleMessages.length, width)}</Text>
      {visible.map((msg, i) => {
        const t = typeColors[msg.type] || typeColors.log!;
        return (
          <Text key={i}>{chalk.hex(t.color)(`${t.label} ${msg.text.slice(0, width - 8)}`)}</Text>
        );
      })}
    </Box>
  );
}
