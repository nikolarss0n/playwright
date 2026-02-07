import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import chalk from 'chalk';
import { colors, th, chars, divider, skeleton } from '../theme.js';
import { useStore } from '../hooks/useStore.js';

interface AiBarProps {
  onSubmitPrompt: (prompt: string) => void;
  focused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  initialChar?: string;
  height?: number;
}

export function AiBar({ onSubmitPrompt, focused = false, onFocusChange, initialChar, height = 30 }: AiBarProps) {
  const mode = useStore(s => s.mode);
  const isRunning = useStore(s => s.isRunning);
  const aiLoading = useStore(s => s.aiLoading);
  const aiResponse = useStore(s => s.aiResponse);

  const handleSubmit = useCallback((value: string) => {
    if (value.trim()) {
      onSubmitPrompt(value.trim());
    }
    onFocusChange?.(false);
  }, [onSubmitPrompt, onFocusChange]);

  if (mode !== 'run') return null;

  const hasContent = aiLoading || aiResponse || !isRunning;
  if (!hasContent) return null;

  const lines: React.ReactNode[] = [];

  if (aiLoading) {
    lines.push(
      <Text key="divider-loading">{divider('AI', undefined, 40)}</Text>
    );
    lines.push(
      <Text key="loading">
        {chalk.hex(colors.primary)('│')} {chalk.hex(colors.running)('Thinking...')}
      </Text>
    );
    lines.push(<Text key="skel1">{chalk.hex(colors.primary)('│')} {skeleton(28)}</Text>);
    lines.push(<Text key="skel2">{chalk.hex(colors.primary)('│')} {skeleton(20)}</Text>);
    lines.push(<Text key="skel3">{chalk.hex(colors.primary)('│')} {skeleton(24)}</Text>);
  } else if (aiResponse) {
    lines.push(<Text key="title">{divider('AI', undefined, 40)}</Text>);
    const responseLines = aiResponse.split('\n');
    const maxResponseLines = Math.min(Math.max(4, Math.floor(height * 0.25)), responseLines.length);
    for (let i = 0; i < maxResponseLines; i++) {
      lines.push(
        <Text key={`resp-${i}`}>{chalk.hex(colors.primary)('│')} {responseLines[i]!.slice(0, 200)}</Text>
      );
    }
    if (responseLines.length > maxResponseLines) {
      lines.push(
        <Text key="more">{chalk.hex(colors.primary)('│')} {th.textDim(`... ${responseLines.length - maxResponseLines} more lines`)}</Text>
      );
    }
    lines.push(
      <Text key="actions">
        {chalk.hex(colors.primary)('│')}
        {'  '}
        {chalk.hex(colors.success)('Tab=Apply')}
        {chalk.hex(colors.textMuted)('  │  ')}
        {chalk.hex(colors.primaryBright)('^S=Save')}
        {chalk.hex(colors.textMuted)('  │  ')}
        {chalk.hex(colors.textDim)('Esc=Dismiss')}
      </Text>
    );
  }

  if (!isRunning) {
    lines.push(
      <Text key="input-hr" color={colors.borderDim}>{'─'.repeat(40)}</Text>
    );
    if (focused) {
      lines.push(
        <Box key="input">
          <Text color={colors.primary} bold>{'❯ '}</Text>
          <TextInput
            key={initialChar ?? ''}
            defaultValue={initialChar ?? ''}
            placeholder="Ask AI about this test..."
            onSubmit={handleSubmit}
          />
        </Box>
      );
    } else {
      lines.push(
        <Text key="input-placeholder">
          <Text color={colors.borderDim}>{'❯ '}</Text>
          <Text color={colors.textMuted}>Ask AI about this test...</Text>
          <Text color={colors.textDim}>  (type to start)</Text>
        </Text>
      );
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {lines}
    </Box>
  );
}
