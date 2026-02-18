import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import chalk from 'chalk';
import { colors, th, divider, skeleton, chars } from '../theme.js';
import { useStore } from '../hooks/useStore.js';
import type { DiffLine } from '../store.js';

const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const visualWidth = (str: string) => stripAnsi(str).length;
const padEndVisual = (str: string, w: number) => str + ' '.repeat(Math.max(0, w - visualWidth(str)));

interface AiBarProps {
  onSubmitPrompt: (prompt: string) => void;
  focused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  initialChar?: string;
  height?: number;
  width?: number;
}

const bar = chalk.hex(colors.primary)('│');

function getScrollChar(visibleIdx: number, visibleCount: number, totalCount: number, scrollStart: number): string {
  if (totalCount <= visibleCount) return '';
  const thumbSize = Math.max(1, Math.round(visibleCount * visibleCount / totalCount));
  const thumbStart = Math.round(scrollStart * visibleCount / totalCount);
  if (visibleIdx >= thumbStart && visibleIdx < thumbStart + thumbSize) {
    return th.textMuted(chars.scrollbar);
  }
  return ' ';
}

function formatLineNo(n: number | undefined, w: number): string {
  if (n === undefined) return ' '.repeat(w);
  const s = String(n);
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

/** Render a diff line's content (opening │ + gutter + code), WITHOUT closing │. */
function renderDiffLineContent(line: DiffLine, contentWidth: number, lineNoWidth: number): string {
  const b = chalk.hex(colors.ai)('│');
  if (line.type === 'separator') {
    const gutter = th.textDim(' '.repeat(lineNoWidth) + '   ');
    return b + gutter + th.textDim('...') + ' '.repeat(Math.max(0, contentWidth - lineNoWidth - 3 - 3));
  }

  const oldNo = formatLineNo(line.oldLineNo, lineNoWidth);
  const newNo = formatLineNo(line.newLineNo, lineNoWidth);
  const gutterLen = lineNoWidth * 2 + 2;
  const codeMax = contentWidth - gutterLen - 2; // 1 prefix + 1 space

  if (line.type === 'added') {
    const prefix = chalk.hex(colors.success)('+');
    const gutter = th.textDim(oldNo + ' ') + chalk.hex(colors.success)(newNo) + ' ';
    const code = line.content.length > codeMax
      ? chalk.hex(colors.success)(line.content.slice(0, codeMax))
      : chalk.hex(colors.success)(line.content);
    return b + gutter + prefix + ' ' + padEndVisual(code, codeMax);
  }

  if (line.type === 'removed') {
    const prefix = chalk.hex(colors.error)('-');
    const gutter = chalk.hex(colors.error)(oldNo) + ' ' + th.textDim(newNo + ' ');
    const code = line.content.length > codeMax
      ? chalk.hex(colors.error)(line.content.slice(0, codeMax))
      : chalk.hex(colors.error)(line.content);
    return b + gutter + prefix + ' ' + padEndVisual(code, codeMax);
  }

  // unchanged
  const gutter = th.textDim(oldNo + ' ' + newNo + ' ');
  const code = line.content.length > codeMax
    ? th.textDim(line.content.slice(0, codeMax))
    : th.textDim(line.content);
  return b + gutter + '  ' + padEndVisual(code, codeMax);
}

export function AiBar({ onSubmitPrompt, focused = false, onFocusChange, initialChar, height = 30, width = 80 }: AiBarProps) {
  const mode = useStore(s => s.mode);
  const isRunning = useStore(s => s.isRunning);
  const aiLoading = useStore(s => s.aiLoading);
  const aiResponse = useStore(s => s.aiResponse);
  const aiCodeDiff = useStore(s => s.aiCodeDiff);
  const aiDiffFilePath = useStore(s => s.aiDiffFilePath);
  const aiDiffScrollIndex = useStore(s => s.aiDiffScrollIndex);
  const aiStatusText = useStore(s => s.aiStatusText);

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
    const loadingText = aiStatusText || 'Thinking...';
    lines.push(
      <Text key="loading">
        {bar} {chalk.hex(colors.running)(loadingText)}
      </Text>
    );
    lines.push(<Text key="skel1">{bar} {skeleton(28)}</Text>);
    lines.push(<Text key="skel2">{bar} {skeleton(20)}</Text>);
    lines.push(<Text key="skel3">{bar} {skeleton(24)}</Text>);
  } else if (aiResponse && aiCodeDiff) {
    const b = chalk.hex(colors.ai);
    const boxW = Math.min(width - 2, 100); // inner width between outer borders
    const innerW = boxW - 2; // content area between │ │

    // Chrome: top border + file path + separator + footer separator + footer + bottom = 6
    const chromeLinesCount = 6;
    const maxDiffLines = Math.max(3, Math.floor(height * 0.4) - chromeLinesCount);
    const totalDiffLines = aiCodeDiff.length;
    const visibleCount = Math.min(maxDiffLines, totalDiffLines);

    // Compute stats
    const added = aiCodeDiff.filter(l => l.type === 'added').length;
    const removed = aiCodeDiff.filter(l => l.type === 'removed').length;

    // Line number width
    const maxLineNo = Math.max(
      ...aiCodeDiff.map(l => Math.max(l.oldLineNo ?? 0, l.newLineNo ?? 0)),
      1
    );
    const lineNoWidth = Math.max(3, String(maxLineNo).length);

    // Scroll window
    const scrollStart = aiDiffScrollIndex;
    const hasScroll = totalDiffLines > visibleCount;
    // Reserve 1 char for scrollbar when content overflows
    const contentW = hasScroll ? innerW - 1 : innerW;

    // Top border
    const titleText = ' AI Code Changes ';
    const topRemaining = Math.max(0, boxW - 2 - titleText.length);
    const topLeft = Math.floor(topRemaining / 2);
    const topRight = topRemaining - topLeft;
    lines.push(
      <Text key="box-top">{b('╭' + '─'.repeat(topLeft) + titleText + '─'.repeat(topRight) + '╮')}</Text>
    );

    // File path sub-header
    const filePath = aiDiffFilePath ?? 'unknown file';
    const fileDisplay = filePath.length > innerW ? '...' + filePath.slice(-(innerW - 3)) : filePath;
    lines.push(
      <Text key="box-file">{b('│') + ' ' + th.textDim(fileDisplay) + ' '.repeat(Math.max(0, innerW - 1 - fileDisplay.length)) + b('│')}</Text>
    );

    // Separator
    lines.push(
      <Text key="box-sep1">{b('├' + '─'.repeat(boxW - 2) + '┤')}</Text>
    );

    // Diff lines
    for (let vi = 0; vi < visibleCount; vi++) {
      const di = scrollStart + vi;
      if (di >= totalDiffLines) {
        const scrollMark = hasScroll ? (getScrollChar(vi, visibleCount, totalDiffLines, scrollStart) || ' ') : '';
        lines.push(
          <Text key={`d-pad-${vi}`}>{b('│') + ' '.repeat(contentW) + scrollMark + b('│')}</Text>
        );
      } else {
        const diffLine = aiCodeDiff[di]!;
        const content = renderDiffLineContent(diffLine, contentW, lineNoWidth);
        const scrollMark = hasScroll ? (getScrollChar(vi, visibleCount, totalDiffLines, scrollStart) || ' ') : '';
        lines.push(
          <Text key={`d-${vi}`}>{content}{scrollMark}{b('│')}</Text>
        );
      }
    }

    // Footer separator
    lines.push(
      <Text key="box-sep2">{b('├' + '─'.repeat(boxW - 2) + '┤')}</Text>
    );

    // Footer: stats + actions
    const statsText = `+${added} -${removed}`;
    const actionsText = 'Enter=Save  Esc=Dismiss';
    const statsColored = chalk.hex(colors.success)(`+${added}`) + ' ' + chalk.hex(colors.error)(`-${removed}`);
    const spaceBetween = Math.max(2, innerW - statsText.length - 1 - actionsText.length - 1);
    const footerContent = ' ' + statsColored + ' '.repeat(spaceBetween) + th.textDim(actionsText) + ' ';
    lines.push(
      <Text key="box-footer">{b('│') + padEndVisual(footerContent, innerW) + b('│')}</Text>
    );

    // Bottom border
    lines.push(
      <Text key="box-bottom">{b('╰' + '─'.repeat(boxW - 2) + '╯')}</Text>
    );
  } else if (aiResponse) {
    const maxLines = Math.max(4, Math.floor(height * 0.25));
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
