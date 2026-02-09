import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import chalk from 'chalk';
import { colors, th, divider, skeleton } from '../theme.js';
import { useStore } from '../hooks/useStore.js';
import type { DiffLine } from '../store.js';

interface AiBarProps {
  onSubmitPrompt: (prompt: string) => void;
  focused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  initialChar?: string;
  height?: number;
}

const bar = chalk.hex(colors.primary)('│');

function renderDiffLine(line: DiffLine, i: number): React.ReactNode {
  if (line.type === 'added')
    return <Text key={`d-${i}`}>{bar} {chalk.hex(colors.success)('+ ' + line.content)}</Text>;
  if (line.type === 'removed')
    return <Text key={`d-${i}`}>{bar} {chalk.hex(colors.error)('- ' + line.content)}</Text>;
  return <Text key={`d-${i}`}>{bar} {chalk.hex(colors.textDim)('  ' + line.content)}</Text>;
}

export function AiBar({ onSubmitPrompt, focused = false, onFocusChange, initialChar, height = 30 }: AiBarProps) {
  const mode = useStore(s => s.mode);
  const isRunning = useStore(s => s.isRunning);
  const aiLoading = useStore(s => s.aiLoading);
  const aiResponse = useStore(s => s.aiResponse);
  const aiCodeDiff = useStore(s => s.aiCodeDiff);

  const handleSubmit = useCallback((value: string) => {
    if (value.trim()) {
      onSubmitPrompt(value.trim());
    }
    onFocusChange?.(false);
  }, [onSubmitPrompt, onFocusChange]);

  if (mode !== 'run') return null;

  const hasContent = aiLoading || aiResponse || !isRunning;
  if (!hasContent) return null;

  const maxLines = Math.max(4, Math.floor(height * 0.25));
  const lines: React.ReactNode[] = [];

  if (aiLoading) {
    lines.push(
      <Text key="divider-loading">{divider('AI', undefined, 40)}</Text>
    );
    lines.push(
      <Text key="loading">
        {bar} {chalk.hex(colors.running)('Thinking...')}
      </Text>
    );
    lines.push(<Text key="skel1">{bar} {skeleton(28)}</Text>);
    lines.push(<Text key="skel2">{bar} {skeleton(20)}</Text>);
    lines.push(<Text key="skel3">{bar} {skeleton(24)}</Text>);
  } else if (aiResponse && aiCodeDiff) {
    // Diff view
    lines.push(<Text key="title">{divider('AI Code Changes', undefined, 40)}</Text>);
    const visibleLines = Math.min(maxLines, aiCodeDiff.length);
    for (let i = 0; i < visibleLines; i++) {
      lines.push(renderDiffLine(aiCodeDiff[i], i));
    }
    if (aiCodeDiff.length > visibleLines) {
      lines.push(
        <Text key="more">{bar} {th.textDim(`... ${aiCodeDiff.length - visibleLines} more lines`)}</Text>
      );
    }
    lines.push(
      <Text key="actions">
        {bar}
        {'  '}
        {chalk.hex(colors.success)('Enter=Save')}
        {chalk.hex(colors.textMuted)('  │  ')}
        {chalk.hex(colors.textDim)('Esc=Dismiss')}
      </Text>
    );
  } else if (aiResponse) {
    // Raw text (no code block detected)
    lines.push(<Text key="title">{divider('AI', undefined, 40)}</Text>);
    const responseLines = aiResponse.split('\n');
    const visibleCount = Math.min(maxLines, responseLines.length);
    for (let i = 0; i < visibleCount; i++) {
      lines.push(
        <Text key={`resp-${i}`}>{bar} {responseLines[i]!.slice(0, 200)}</Text>
      );
    }
    if (responseLines.length > visibleCount) {
      lines.push(
        <Text key="more">{bar} {th.textDim(`... ${responseLines.length - visibleCount} more lines`)}</Text>
      );
    }
    lines.push(
      <Text key="actions">
        {bar}
        {'  '}
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
