import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, th, chars, divider, skeleton } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';
import { renderNetworkDetail } from './NetworkDetail.js';
import { formatTestError } from '../shared/JsonPreview.js';
import { formatTime } from '../shared/ProgressIndicator.js';
import type { TestResult, ActionCapture } from '../../store.js';

const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const visualWidth = (str: string) => stripAnsi(str).length;
const padEndVisual = (str: string, w: number) => str + ' '.repeat(Math.max(0, w - visualWidth(str)));

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const getSpinner = (): string => {
  const frame = Math.floor(Date.now() / 80) % spinnerFrames.length;
  return chalk.hex(colors.running)(spinnerFrames[frame]!);
};

interface ActionNameParts {
  prefix: string;    // e.g. "goto ", "expect(selector).", "click "
  highlight: string; // colored in orange — e.g. URL, matcher, expected text
}

function formatActionName(action: { type: string; method: string; title?: string; params?: any }): ActionNameParts {
  const p = action.params;
  if (action.method === 'expect' && p) {
    const matcher = p.expression?.replace(/^to\./, '').replace(/\./g, ' ') || action.title || 'expect';
    const target = p.selector || '';
    const expectedText = p.expectedText?.[0]?.string || p.expectedText?.[0]?.regexSource;
    if (expectedText && target) return { prefix: `expect(${target}).`, highlight: `${matcher}: "${expectedText}"` };
    if (expectedText) return { prefix: 'expect.', highlight: `${matcher}: "${expectedText}"` };
    if (target) return { prefix: `expect(${target}).`, highlight: matcher };
    return { prefix: 'expect.', highlight: matcher };
  }
  if (!p) return { prefix: action.title || `${action.type}.${action.method}`, highlight: '' };
  if (action.method === 'goto' && p.url) return { prefix: 'goto ', highlight: p.url };
  if (action.method === 'click' && p.selector) return { prefix: 'click ', highlight: p.selector };
  if (action.method === 'fill' && p.selector) return { prefix: 'fill ', highlight: p.selector };
  if (action.method === 'type' && p.selector) return { prefix: 'type ', highlight: p.selector };
  if (action.method === 'press' && p.key) return { prefix: 'press ', highlight: p.key };
  if (action.method === 'selectOption' && p.selector) return { prefix: 'select ', highlight: p.selector };
  if (action.method === 'check' && p.selector) return { prefix: 'check ', highlight: p.selector };
  return { prefix: action.title || `${action.type}.${action.method}`, highlight: '' };
}

export function filterActions(actions: ActionCapture[]): ActionCapture[] {
  return actions.filter(a => !(a.type === 'BrowserContext' && (a.method === 'newPage' || a.method === 'close')));
}

interface ActionPanelProps {
  selectedResult: TestResult | null;
  selectedTestName: string;
  width: number;
  maxLines: number;
}

export function ActionPanel({ selectedResult, selectedTestName, width, maxLines }: ActionPanelProps) {
  const state = useStore(s => s);
  const focusRight = state.panelFocus === 'actions';

  const lines: string[] = [];

  const title = selectedTestName ? selectedTestName.slice(0, width - 5) : 'Actions';
  const expandedAction = (selectedResult && state.expandedActionIndex >= 0)
    ? selectedResult.actions[state.expandedActionIndex] : null;
  const inNetworkMode = state.actionDetailFocus === 'network' && expandedAction;
  const expandedNetReq = inNetworkMode && state.expandedNetworkIndex >= 0
    ? expandedAction?.network?.requests?.[state.expandedNetworkIndex] : null;

  lines.push(th.primaryBright.bold(title));

  if (!selectedResult || selectedResult.actions.length === 0) {
    if (selectedResult?.status === 'running') {
      const { progress } = state;
      if (progress.currentAction) {
        lines.push(`${getSpinner()} ${th.warning(progress.currentAction)}`);
        if (progress.waitingFor) lines.push(th.textDim(`  ${chars.last} waiting for ${progress.waitingFor}...`));
        if (progress.actionStartTime) {
          const actionElapsed = Date.now() - progress.actionStartTime;
          if (actionElapsed > 500) lines.push(th.textDim(`  ${chars.last} ${formatTime(actionElapsed)} elapsed`));
        }
      } else {
        // Loading skeleton
        lines.push(`${getSpinner()} ${th.running('Running test...')}`);
        lines.push('');
        lines.push(skeleton(Math.min(width - 4, 30)));
        lines.push(skeleton(Math.min(width - 4, 22)));
        lines.push(skeleton(Math.min(width - 4, 26)));
      }
    } else if (selectedResult?.status === 'failed' && selectedResult?.error) {
      lines.push(chalk.hex(colors.error).bold(`${chars.cross} Test Failed`));
      lines.push('');
      lines.push(...formatTestError(selectedResult.error, width - 2, 15));
    } else if (selectedTestName) {
      lines.push(th.textDim('No actions captured for this test.'));
      lines.push(th.textDim('Run the test to see actions.'));
    } else {
      lines.push(th.textDim('Select a test to see its actions.'));
      lines.push(th.textDim('Use ↑ ↓ to navigate, Enter to run.'));
    }
  } else {
    const actions = filterActions(selectedResult.actions);
    const scrollStart = Math.max(0, state.actionScrollIndex - Math.floor((maxLines - 4) / 4));

    const totalActions = actions.length;
    const visibleActions = maxLines - 4;
    const needsScroll = totalActions > visibleActions;

    for (let i = scrollStart; i < actions.length && lines.length < maxLines - 2; i++) {
      const action = actions[i]!;
      const isExpanded = state.expandedActionIndex === i;
      const isActionSelected = focusRight && state.actionScrollIndex === i;
      const isCompleted = !isExpanded && !isActionSelected && action.timing?.durationMs;
      const actionIcon = action.error ? chalk.hex(colors.error)(chars.cross) : chalk.hex(colors.success)(chars.check);
      const netCount = action.network?.requests?.length || 0;
      const conCount = action.console?.length || 0;
      const errCount = action.console?.filter((c: { type: string }) => c.type === 'error').length || 0;
      // Inline badges: network and console counts
      const badges: string[] = [];
      if (netCount > 0) badges.push(th.secondary(`⇅${netCount}`));
      if (errCount > 0) badges.push(chalk.hex(colors.error)(`●${errCount}`));
      else if (conCount > 0) badges.push(th.textDim(`○${conCount}`));
      const badgeStr = badges.length > 0 ? ' ' + badges.join(' ') : '';
      const badgeVisualLen = badges.length > 0 ? 1 + badges.reduce((s, b) => s + stripAnsi(b).length + 1, -1) : 0;

      const durationStr = action.timing?.durationMs ? `${Math.round(action.timing.durationMs)}ms` : '';
      // Budget: " ✓ " (3) + " " before duration (1) + duration + badges + " ▸" (2) + scrollbar (1)
      const overhead = 3 + 1 + durationStr.length + badgeVisualLen + 2 + 1;
      const maxNameLen = Math.max(10, width - overhead);
      const { prefix, highlight } = formatActionName(action);
      const fullName = prefix + highlight;
      const truncName = fullName.length > maxNameLen ? fullName.slice(0, maxNameLen - 1) + '…' : fullName;
      // Apply colors after truncation: highlight part gets orange
      const truncPrefix = truncName.slice(0, Math.min(prefix.length, truncName.length));
      const truncHighlight = truncName.slice(prefix.length);
      const dim = isCompleted && !isActionSelected;
      const coloredName = dim
        ? th.textMuted(truncPrefix) + (truncHighlight ? th.textMuted(truncHighlight) : '')
        : truncPrefix + (truncHighlight ? th.primary(truncHighlight) : '');
      const duration = durationStr ? th.textDim(durationStr) : '';

      const expandHint = isExpanded
        ? th.textDim(` ${chars.collapse}`)
        : th.borderDim(` ${chars.expand}`);
      const inner = ` ${actionIcon} ${coloredName} ${duration}${badgeStr}`;
      const rowContent = inner + expandHint;

      // Scrollbar indicator on right edge
      const scrollMark = needsScroll ? getScrollChar(i - scrollStart, visibleActions, totalActions, scrollStart) : '';

      if (isActionSelected) {
        lines.push(th.selected(padEndVisual(rowContent, width - 2)) + scrollMark);
      } else {
        lines.push(padEndVisual(rowContent, width - 2) + scrollMark);
      }

      if (!isExpanded && lines.length < maxLines - 2) {
        lines.push('');
      }

      if (isExpanded) {
        const hasNetwork = action.network?.requests?.length > 0;
        const hasConsole = action.console?.length > 0;
        const hasDiff = action.snapshot?.diff;

        if (hasNetwork) {
          const netReqCount = action.network.requests.length;
          // Skip divider + collapsed row for single-request actions (auto-expanded)
          if (netReqCount === 1 && state.expandedNetworkIndex === 0) {
            lines.push(...renderNetworkDetail(action.network.requests, state, width, maxLines - lines.length, focusRight));
          } else {
            lines.push(divider('Network', netReqCount, width - 4));
            lines.push(...renderNetworkDetail(action.network.requests, state, width, maxLines - lines.length, focusRight));
          }
        }

        if (hasConsole) {
          const errCount = action.console.filter((c: { type: string }) => c.type === 'error').length;
          const warnCount = action.console.filter((c: { type: string }) => c.type === 'warn').length;
          lines.push(divider('Console', action.console.length, width - 4));
          if (errCount > 0) lines.push(chalk.hex(colors.error)(`  ${errCount} errors`));
          if (warnCount > 0) lines.push(chalk.hex(colors.warning)(`  ${warnCount} warnings`));
          for (const msg of action.console.slice(0, 3)) {
            const color = msg.type === 'error' ? chalk.hex(colors.error) : msg.type === 'warn' ? chalk.hex(colors.warning) : chalk.hex(colors.textDim);
            lines.push(`    ${color(msg.text.slice(0, width - 6))}`);
          }
          lines.push(th.borderDim('─'.repeat(width - 4)));
        }

        if (hasDiff && action.snapshot.diff) {
          lines.push(divider('DOM', undefined, width - 4));
          lines.push(`  ${action.snapshot.diff.summary}`);
          if (action.snapshot.diff.added.length > 0) lines.push(chalk.hex(colors.success)(`    + ${action.snapshot.diff.added.slice(0, 2).join(', ')}`));
          if (action.snapshot.diff.removed.length > 0) lines.push(chalk.hex(colors.error)(`    - ${action.snapshot.diff.removed.slice(0, 2).join(', ')}`));
        }

        lines.push('');
      }
    }

    // Running action at end
    if (selectedResult.status === 'running' && state.progress.currentAction) {
      lines.push('');
      lines.push(`${getSpinner()} ${th.warning(state.progress.currentAction)}`);
      if (state.progress.waitingFor) lines.push(th.textDim(`  ${chars.last} waiting for ${state.progress.waitingFor}...`));
      if (state.progress.actionStartTime) {
        const actionElapsed = Date.now() - state.progress.actionStartTime;
        if (actionElapsed > 500) lines.push(th.textDim(`  ${chars.last} ${formatTime(actionElapsed)} elapsed`));
      }
    }

    // Error at end
    if (selectedResult.status === 'failed' && selectedResult.error) {
      lines.push('');
      lines.push(chalk.hex(colors.error).bold(`${chars.cross} Test Failed`));
      lines.push(...formatTestError(selectedResult.error, width - 2, 10));
    }
  }

  while (lines.length < maxLines) lines.push('');

  return (
    <Box flexDirection="column">
      {lines.slice(0, maxLines).map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

function getScrollChar(visibleIdx: number, visibleCount: number, totalCount: number, _scrollStart: number): string {
  if (totalCount <= visibleCount) return '';
  const thumbSize = Math.max(1, Math.floor(visibleCount * visibleCount / totalCount));
  const thumbStart = Math.floor(visibleIdx * visibleCount / totalCount);
  if (visibleIdx >= thumbStart && visibleIdx < thumbStart + thumbSize) {
    return th.textMuted(chars.scrollbar);
  }
  return th.borderDim(' ');
}

