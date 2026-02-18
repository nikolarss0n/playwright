import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, th, chars, divider, skeleton } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';
import { renderNetworkDetail } from './NetworkDetail.js';
import { formatTestError } from '../shared/JsonPreview.js';
import { formatTime } from '../shared/ProgressIndicator.js';
import type { TestResult, TestAttachment, ActionCapture } from '../../store.js';

const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const visualWidth = (str: string) => stripAnsi(str).length;
const padEndVisual = (str: string, w: number) => str + ' '.repeat(Math.max(0, w - visualWidth(str)));

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const getSpinner = (): string => {
  const frame = Math.floor(Date.now() / 80) % spinnerFrames.length;
  return chalk.hex(colors.running)(spinnerFrames[frame]!);
};

interface ActionNameParts {
  prefix: string;
  highlight: string;
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

interface PanelLine {
  text: string;
  actionIdx: number; // -1 for spacers/non-action lines
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

  const allLines: PanelLine[] = [];

  const title = selectedTestName ? selectedTestName.slice(0, width - 5) : 'Actions';
  const expandedAction = (selectedResult && state.expandedActionIndex >= 0)
    ? selectedResult.actions[state.expandedActionIndex] : null;
  const inNetworkMode = state.actionDetailFocus === 'network' && expandedAction;
  const expandedNetReq = inNetworkMode && state.expandedNetworkIndex >= 0
    ? expandedAction?.network?.requests?.[state.expandedNetworkIndex] : null;

  allLines.push({ text: th.primaryBright.bold(title), actionIdx: -1 });
  allLines.push({ text: '', actionIdx: -1 });

  if (!selectedResult || selectedResult.actions.length === 0) {
    if (selectedResult?.status === 'running') {
      const { progress } = state;
      if (progress.currentAction) {
        allLines.push({ text: `${getSpinner()} ${th.warning(progress.currentAction)}`, actionIdx: -1 });
        if (progress.waitingFor) allLines.push({ text: th.textDim(`  ${chars.last} waiting for ${progress.waitingFor}...`), actionIdx: -1 });
        if (progress.actionStartTime) {
          const actionElapsed = Date.now() - progress.actionStartTime;
          if (actionElapsed > 500) allLines.push({ text: th.textDim(`  ${chars.last} ${formatTime(actionElapsed)} elapsed`), actionIdx: -1 });
        }
      } else {
        allLines.push({ text: `${getSpinner()} ${th.running('Running test...')}`, actionIdx: -1 });
        allLines.push({ text: '', actionIdx: -1 });
        allLines.push({ text: skeleton(Math.min(width - 4, 30)), actionIdx: -1 });
        allLines.push({ text: skeleton(Math.min(width - 4, 22)), actionIdx: -1 });
        allLines.push({ text: skeleton(Math.min(width - 4, 26)), actionIdx: -1 });
      }
    } else if (selectedResult?.status === 'failed' && selectedResult?.error) {
      const errBorder = chalk.hex(colors.error);
      const boxW = width - 4;
      const errBoxLine = (content: string) =>
        errBorder(`  │`) + padEndVisual(` ${content}`, boxW - 2) + errBorder(`│`);
      allLines.push({ text: errBorder(`  ╭${'─'.repeat(boxW - 2)}╮`), actionIdx: -1 });
      allLines.push({ text: errBoxLine(chalk.hex(colors.error).bold(`${chars.cross} Test Failed`)), actionIdx: -1 });
      allLines.push({ text: errBorder(`  ├${'─'.repeat(boxW - 2)}┤`), actionIdx: -1 });
      for (const line of formatTestError(selectedResult.error, boxW - 4, 15)) {
        allLines.push({ text: errBoxLine(line), actionIdx: -1 });
      }
      allLines.push({ text: errBorder(`  ╰${'─'.repeat(boxW - 2)}╯`), actionIdx: -1 });
    } else if (selectedTestName) {
      allLines.push({ text: th.textDim('No actions captured for this test.'), actionIdx: -1 });
      allLines.push({ text: th.textDim('Run the test to see actions.'), actionIdx: -1 });
    } else {
      allLines.push({ text: th.textDim('Select a test to see its actions.'), actionIdx: -1 });
      allLines.push({ text: th.textDim('Use ↑ ↓ to navigate, Enter to run.'), actionIdx: -1 });
    }
  } else {
    const actions = filterActions(selectedResult.actions);

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      const isExpanded = state.expandedActionIndex === i;
      const isActionSelected = focusRight && state.actionScrollIndex === i;
      const actionIcon = action.error ? chalk.hex(colors.error)(chars.cross) : chalk.hex(colors.success)(chars.check);
      const netCount = action.network?.requests?.length || 0;
      const conCount = action.console?.length || 0;
      const errCount = action.console?.filter((c: { type: string }) => c.type === 'error').length || 0;
      const badges: string[] = [];
      if (netCount > 0) badges.push(th.secondary(`⇅${netCount}`));
      if (errCount > 0) badges.push(chalk.hex(colors.error)(`●${errCount}`));
      else if (conCount > 0) badges.push(th.textDim(`○${conCount}`));
      const badgeStr = badges.length > 0 ? ' ' + badges.join(' ') : '';
      const badgeVisualLen = badges.length > 0 ? 1 + badges.reduce((s, b) => s + stripAnsi(b).length + 1, -1) : 0;

      const durationStr = action.timing?.durationMs ? `${Math.round(action.timing.durationMs)}ms` : '';
      const overhead = 3 + 1 + durationStr.length + badgeVisualLen + 2 + 1;
      const maxNameLen = Math.max(10, width - overhead);
      const { prefix, highlight } = formatActionName(action);
      const fullName = prefix + highlight;
      const truncName = fullName.length > maxNameLen ? fullName.slice(0, maxNameLen - 1) + '…' : fullName;
      const truncPrefix = truncName.slice(0, Math.min(prefix.length, truncName.length));
      const truncHighlight = truncName.slice(prefix.length);
      const coloredName = th.textSecondary(truncPrefix) + (truncHighlight ? th.primary(truncHighlight) : '');
      const duration = durationStr ? th.textDim(durationStr) : '';

      const expandHint = isExpanded
        ? th.textDim(` ${chars.collapse}`)
        : th.borderDim(` ${chars.expand}`);
      const inner = ` ${actionIcon} ${coloredName} ${duration}${badgeStr}`;
      const rowContent = inner + expandHint;

      const rowBg = isActionSelected ? chalk.bgHex(colors.selectBg) : (s: string) => s;
      allLines.push({ text: rowBg(padEndVisual(rowContent, width - 1)), actionIdx: i });

      if (!isExpanded) {
        allLines.push({ text: '', actionIdx: -1 });
      }

      if (isExpanded) {
        const hasNetwork = action.network?.requests?.length > 0;
        const hasConsole = action.console?.length > 0;
        const hasDiff = action.snapshot?.diff;
        const boxW = width - 4;

        if (hasNetwork) {
          const netBorder = chalk.hex(colors.secondary);
          const netReqCount = action.network.requests.length;
          const netContentW = boxW - 2;
          const netLines = renderNetworkDetail(action.network.requests, state, netContentW, 50, focusRight);

          allLines.push({ text: '', actionIdx: -1 });
          const netTitle = ` Network (${netReqCount}) `;
          const netTopFill = Math.max(0, boxW - 3 - netTitle.length);
          allLines.push({ text: `  ${netBorder('╭─' + netTitle + '─'.repeat(netTopFill) + '╮')}`, actionIdx: -1 });
          for (const line of netLines) {
            allLines.push({ text: netBorder(`  │`) + padEndVisual(line, netContentW) + netBorder(`│`), actionIdx: -1 });
          }
          allLines.push({ text: `  ${netBorder('╰' + '─'.repeat(boxW - 2) + '╯')}`, actionIdx: -1 });
        }

        if (hasConsole) {
          const conBorder = th.border;
          const consoleErrCount = action.console.filter((c: { type: string }) => c.type === 'error').length;
          const consoleWarnCount = action.console.filter((c: { type: string }) => c.type === 'warn').length;
          const inConsoleMode = state.actionDetailFocus === 'console';
          const consoleFocused = inConsoleMode && focusRight;
          const conContentW = boxW - 2;
          const conBoxLine = (content: string) =>
            conBorder(`  │`) + padEndVisual(` ${content}`, conContentW) + conBorder(`│`);

          allLines.push({ text: '', actionIdx: -1 });
          const conTitle = ` Console (${action.console.length}) `;
          const conTopFill = Math.max(0, boxW - 3 - conTitle.length);
          allLines.push({ text: `  ${conBorder('╭─' + conTitle + '─'.repeat(conTopFill) + '╮')}`, actionIdx: -1 });

          if (consoleErrCount > 0) allLines.push({ text: conBoxLine(chalk.hex(colors.error)(`${consoleErrCount} errors`)), actionIdx: -1 });
          if (consoleWarnCount > 0) allLines.push({ text: conBoxLine(chalk.hex(colors.warning)(`${consoleWarnCount} warnings`)), actionIdx: -1 });

          const totalConsole = action.console.length;
          const maxVisibleConsole = Math.max(3, maxLines - 3);
          const needsConsoleScroll = totalConsole > maxVisibleConsole;
          let consoleStart = 0;
          if (needsConsoleScroll) {
            consoleStart = Math.max(0, Math.min(
              state.consoleScrollIndex - Math.floor(maxVisibleConsole / 3),
              totalConsole - maxVisibleConsole,
            ));
          }
          if (needsConsoleScroll && consoleStart > 0) {
            allLines.push({ text: conBoxLine(th.textDim(`▲ ${consoleStart} more`)), actionIdx: -1 });
          }
          const consoleSlice = action.console.slice(consoleStart, consoleStart + maxVisibleConsole);
          for (let ci = 0; ci < consoleSlice.length; ci++) {
            const msg = consoleSlice[ci]!;
            const consoleIdx = consoleStart + ci;
            const color = msg.type === 'error' ? chalk.hex(colors.error) : msg.type === 'warn' ? chalk.hex(colors.warning) : chalk.hex(colors.textDim);
            const msgContent = color(msg.text.slice(0, conContentW - 2));
            if (consoleFocused && state.consoleScrollIndex === consoleIdx) {
              allLines.push({ text: conBorder(`  │`) + chalk.bgHex(colors.selectBg)(padEndVisual(` ${msgContent}`, conContentW)) + conBorder(`│`), actionIdx: -1 });
            } else {
              allLines.push({ text: conBoxLine(msgContent), actionIdx: -1 });
            }
          }
          const consoleBelow = totalConsole - consoleStart - consoleSlice.length;
          if (needsConsoleScroll && consoleBelow > 0) {
            allLines.push({ text: conBoxLine(th.textDim(`▼ ${consoleBelow} more`)), actionIdx: -1 });
          }
          allLines.push({ text: `  ${conBorder('╰' + '─'.repeat(boxW - 2) + '╯')}`, actionIdx: -1 });
        }

        if (hasDiff && action.snapshot.diff) {
          allLines.push({ text: divider('DOM', undefined, width - 4), actionIdx: -1 });
          allLines.push({ text: `  ${action.snapshot.diff.summary}`, actionIdx: -1 });
          if (action.snapshot.diff.added.length > 0) allLines.push({ text: chalk.hex(colors.success)(`    + ${action.snapshot.diff.added.slice(0, 2).join(', ')}`), actionIdx: -1 });
          if (action.snapshot.diff.removed.length > 0) allLines.push({ text: chalk.hex(colors.error)(`    - ${action.snapshot.diff.removed.slice(0, 2).join(', ')}`), actionIdx: -1 });
        }

        allLines.push({ text: '', actionIdx: -1 });
      }
    }

    // Running action at end
    if (selectedResult.status === 'running' && state.progress.currentAction) {
      allLines.push({ text: '', actionIdx: -1 });
      allLines.push({ text: `${getSpinner()} ${th.warning(state.progress.currentAction)}`, actionIdx: -1 });
      if (state.progress.waitingFor) allLines.push({ text: th.textDim(`  ${chars.last} waiting for ${state.progress.waitingFor}...`), actionIdx: -1 });
      if (state.progress.actionStartTime) {
        const actionElapsed = Date.now() - state.progress.actionStartTime;
        if (actionElapsed > 500) allLines.push({ text: th.textDim(`  ${chars.last} ${formatTime(actionElapsed)} elapsed`), actionIdx: -1 });
      }
    }

    // Error at end — bordered box
    if (selectedResult.status === 'failed' && selectedResult.error) {
      const errBorder = chalk.hex(colors.error);
      const boxW = width - 4;
      const errBoxLine = (content: string) =>
        errBorder(`  │`) + padEndVisual(` ${content}`, boxW - 2) + errBorder(`│`);

      allLines.push({ text: '', actionIdx: -1 });
      allLines.push({ text: errBorder(`  ╭${'─'.repeat(boxW - 2)}╮`), actionIdx: -1 });
      allLines.push({ text: errBoxLine(chalk.hex(colors.error).bold(`${chars.cross} Test Failed`)), actionIdx: -1 });
      allLines.push({ text: errBorder(`  ├${'─'.repeat(boxW - 2)}┤`), actionIdx: -1 });
      for (const line of formatTestError(selectedResult.error, boxW - 4, 10)) {
        allLines.push({ text: errBoxLine(line), actionIdx: -1 });
      }
      allLines.push({ text: errBorder(`  ╰${'─'.repeat(boxW - 2)}╯`), actionIdx: -1 });
    }

    // Screenshots section — bordered box
    if (selectedResult.attachments && selectedResult.attachments.length > 0) {
      const attBorder = chalk.hex(colors.primary);
      const boxW = width - 4;
      const attBoxLine = (content: string) =>
        attBorder(`  │`) + padEndVisual(` ${content}`, boxW - 2) + attBorder(`│`);

      allLines.push({ text: '', actionIdx: -1 });
      allLines.push({ text: attBorder(`  ╭${'─'.repeat(boxW - 2)}╮`), actionIdx: -1 });
      allLines.push({ text: attBoxLine(chalk.hex(colors.primary).bold(`Screenshots (${selectedResult.attachments.length})`)), actionIdx: -1 });
      allLines.push({ text: attBorder(`  ├${'─'.repeat(boxW - 2)}┤`), actionIdx: -1 });
      for (let ai = 0; ai < selectedResult.attachments.length; ai++) {
        const att = selectedResult.attachments[ai]!;
        const attachIdx = actions.length + ai;
        const isFocused = focusRight && state.actionScrollIndex === attachIdx;
        const hint = isFocused ? th.textDim(' ⏎ open') : '';
        const icon = chalk.hex(colors.primary)('■');
        const content = `${icon} ${th.textSecondary(att.name)}${hint}`;
        if (isFocused) {
          allLines.push({ text: attBorder(`  │`) + chalk.bgHex(colors.selectBg)(padEndVisual(` ${content}`, boxW - 2)) + attBorder(`│`), actionIdx: attachIdx });
        } else {
          allLines.push({ text: attBoxLine(content), actionIdx: attachIdx });
        }
      }
      allLines.push({ text: attBorder(`  ╰${'─'.repeat(boxW - 2)}╯`), actionIdx: -1 });
    }
  }

  // Compute scroll window centered on selected action (same pattern as TestList)
  const selectedLineIdx = allLines.findIndex(l => l.actionIdx === state.actionScrollIndex);
  const totalLines = allLines.length;
  const needsScroll = totalLines > maxLines;

  let scrollStart = 0;
  if (needsScroll) {
    if (selectedResult?.status === 'running') {
      // Auto-follow: keep the latest action/progress visible at the bottom
      scrollStart = Math.max(0, totalLines - maxLines);
    } else if (selectedLineIdx >= 0) {
      scrollStart = Math.max(0, Math.min(
        selectedLineIdx - Math.floor(maxLines / 3),
        totalLines - maxLines,
      ));
    }
  }

  const visibleLines = allLines.slice(scrollStart, scrollStart + maxLines);

  // Pad to fill available space
  while (visibleLines.length < maxLines) {
    visibleLines.push({ text: '', actionIdx: -1 });
  }

  return (
    <Box flexDirection="column" height={maxLines}>
      {visibleLines.map((line, i) => {
        const scrollMark = needsScroll ? getScrollChar(i, maxLines, totalLines, scrollStart) : '';
        const padded = scrollMark ? padEndVisual(line.text, width - 1) + scrollMark : line.text;
        return <Text key={i}>{padded}</Text>;
      })}
    </Box>
  );
}

function getScrollChar(visibleIdx: number, visibleCount: number, totalCount: number, scrollStart: number): string {
  if (totalCount <= visibleCount) return '';
  const thumbSize = Math.max(1, Math.round(visibleCount * visibleCount / totalCount));
  const thumbStart = Math.round(scrollStart * visibleCount / totalCount);
  if (visibleIdx >= thumbStart && visibleIdx < thumbStart + thumbSize) {
    return th.textMuted(chars.scrollbar);
  }
  return ' ';
}
