import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import chalk from 'chalk';
import { colors, th, divider, skeleton } from '../theme.js';
import { useStore } from '../hooks/useStore.js';

interface AiBarProps {
  onSubmitPrompt: (prompt: string) => void;
  onInputActive?: (active: boolean) => void;
  height?: number;
}

export function AiBar({ onSubmitPrompt, onInputActive, height = 30 }: AiBarProps) {
  const mode = useStore(s => s.mode);
  const isRunning = useStore(s => s.isRunning);
  const aiLoading = useStore(s => s.aiLoading);
  const aiResponse = useStore(s => s.aiResponse);
  const [inputValue, setInputValue] = useState('');

  const handleChange = useCallback((value: string) => {
    setInputValue(value);
    if (value.length > 0) onInputActive?.(true);
  }, [onInputActive]);

  const handleSubmit = useCallback((value: string) => {
    if (value.trim()) {
      onSubmitPrompt(value.trim());
      setInputValue('');
    }
    onInputActive?.(false);
  }, [onSubmitPrompt, onInputActive]);

  if (mode !== 'run') return null;

  const hasContent = aiLoading || aiResponse || !isRunning;
  if (!hasContent) return null;

  const lines: React.ReactNode[] = [];

  if (aiLoading) {
    lines.push(
      <Text key="divider-loading">{divider('AI Assistant', undefined, 40)}</Text>
    );
    lines.push(
      <Text key="loading">
        {chalk.hex(colors.ai)('│')} {chalk.hex(colors.running)('Thinking...')}
      </Text>
    );
    lines.push(<Text key="skel1">{chalk.hex(colors.ai)('│')} {skeleton(28)}</Text>);
    lines.push(<Text key="skel2">{chalk.hex(colors.ai)('│')} {skeleton(20)}</Text>);
    lines.push(<Text key="skel3">{chalk.hex(colors.ai)('│')} {skeleton(24)}</Text>);
  } else if (aiResponse) {
    lines.push(<Text key="title">{divider('AI Assistant', undefined, 40)}</Text>);
    const responseLines = aiResponse.split('\n');
    const maxResponseLines = Math.min(Math.max(4, Math.floor(height * 0.25)), responseLines.length);
    for (let i = 0; i < maxResponseLines; i++) {
      lines.push(
        <Text key={`resp-${i}`}>{chalk.hex(colors.ai)('│')} {responseLines[i]!.slice(0, 200)}</Text>
      );
    }
    if (responseLines.length > maxResponseLines) {
      lines.push(
        <Text key="more">{chalk.hex(colors.ai)('│')} {th.textDim(`... ${responseLines.length - maxResponseLines} more lines`)}</Text>
      );
    }
    lines.push(
      <Text key="actions">
        {chalk.hex(colors.ai)('│')}
        {'  '}
        {chalk.hex(colors.success)('Tab=Apply')}
        {chalk.hex(colors.textMuted)('  │  ')}
        {chalk.hex(colors.warning)('^S=Save')}
        {chalk.hex(colors.textMuted)('  │  ')}
        {chalk.hex(colors.textDim)('Esc=Dismiss')}
      </Text>
    );
  }

  if (!isRunning) {
    lines.push(
      <Text key="input-hr" color={colors.borderDim}>{'─'.repeat(40)}</Text>
    );
    lines.push(
      <Box key="input">
        <Text color={colors.ai} bold>{'> '}</Text>
        <TextInput
          placeholder="Ask AI about the test..."
          onSubmit={handleSubmit}
          onChange={handleChange}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {lines}
    </Box>
  );
}
