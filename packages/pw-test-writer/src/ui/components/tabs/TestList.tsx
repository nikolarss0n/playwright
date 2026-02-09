import React, { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import chalk from 'chalk';
import { colors, th, chars } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';
import { useInterval } from '../../hooks/useInterval.js';
import { store } from '../../store.js';

const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const visualWidth = (str: string) => stripAnsi(str).length;
const padEndVisual = (str: string, w: number) => str + ' '.repeat(Math.max(0, w - visualWidth(str)));

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface TestListProps {
  width: number;
  maxLines: number;
}

interface LineEntry {
  text: string;
  itemIdx: number; // -1 for spacers
}

// Convert file index to letter: 0→A, 1→B, ..., 25→Z, 26→AA, ...
function fileLetter(idx: number): string {
  let s = '';
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function TestList({ width, maxLines }: TestListProps) {
  const testFiles = useStore(s => s.testFiles);
  const selectedTests = useStore(s => s.selectedTests);
  const testResults = useStore(s => s.testResults);
  const testSelectionIndex = useStore(s => s.testSelectionIndex);
  const panelFocus = useStore(s => s.panelFocus);
  const testFilter = useStore(s => s.testFilter);
  const testFilterActive = useStore(s => s.testFilterActive);
  const testHistory = useStore(s => s.testHistory);

  const isRunning = useStore(s => s.isRunning);
  const [frame, setFrame] = useState(0);
  useInterval(() => setFrame(f => f + 1), isRunning ? 80 : null);

  const focusLeft = panelFocus === 'tests';
  const lowerFilter = testFilter.toLowerCase();

  const matchesTest = (title: string) => !testFilter || title.toLowerCase().includes(lowerFilter);
  const matchesFile = (path: string) => !testFilter || path.toLowerCase().includes(lowerFilter);

  const handleFilterChange = useCallback((value: string) => {
    store.setState({ testFilter: value });
    if (!value) return;
    const lower = value.toLowerCase();
    let idx = 0;
    for (const file of store.getState().testFiles) {
      const fileMatch = file.relativePath.toLowerCase().includes(lower);
      idx++;
      for (const test of file.tests) {
        if (fileMatch || test.title.toLowerCase().includes(lower)) {
          store.setTestSelectionIndex(idx);
          return;
        }
        idx++;
      }
    }
  }, []);

  const filterRow = testFilterActive ? (
    <Box key="filter">
      <Text color={colors.primary}>{'/  '}</Text>
      <TextInput defaultValue="" placeholder="Filter tests..." onChange={handleFilterChange} />
    </Box>
  ) : null;

  const availableLines = testFilterActive ? maxLines - 1 : maxLines;

  // First pass: build ALL lines so we can scroll
  const allLines: LineEntry[] = [];

  let itemIndex = 0;
  let renderedFiles = 0;
  for (let fi = 0; fi < testFiles.length; fi++) {
    const file = testFiles[fi]!;
    const fileMatchesPath = matchesFile(file.relativePath);
    const hasMatchingTests = file.tests.some(t => matchesTest(t.title)) || fileMatchesPath;

    if (testFilter && !hasMatchingTests) {
      itemIndex += 1 + file.tests.length;
      continue;
    }

    const fileResults = file.tests.map(t => testResults.find(r => r.testKey === `${file.path}:${t.line}`));
    const allPassed = fileResults.every(r => r?.status === 'passed');
    const anyFailed = fileResults.some(r => r?.status === 'failed');
    const anyRunning = fileResults.some(r => r?.status === 'running');
    const hasResults = fileResults.some(r => r);

    let fileIcon: string;
    if (anyRunning) fileIcon = chalk.hex(colors.running)(spinnerFrames[frame % spinnerFrames.length]);
    else if (hasResults && allPassed) fileIcon = chalk.hex(colors.success)(chars.check);
    else if (anyFailed) fileIcon = chalk.hex(colors.error)(chars.cross);
    else {
      const fileSelected = file.tests.every(t => selectedTests[`${file.path}:${t.line}`]);
      const filePartial = file.tests.some(t => selectedTests[`${file.path}:${t.line}`]) && !fileSelected;
      fileIcon = fileSelected ? chalk.hex(colors.success)('◉') : filePartial ? chalk.hex(colors.warning)('◐') : chalk.hex(colors.textDim)('○');
    }

    const passedCount = fileResults.filter(r => r?.status === 'passed').length;
    const totalFileTests = file.tests.length;
    const passCount = hasResults ? th.textMuted(` (${passedCount}/${totalFileTests})`) : '';

    const isHighlighted = focusLeft && itemIndex === testSelectionIndex;
    const fileName = file.relativePath.length > width - 5 ? '...' + file.relativePath.slice(-(width - 8)) : file.relativePath;
    const fileColor = allPassed ? th.textSecondary : th.secondary;

    if (renderedFiles > 0) allLines.push({ text: '', itemIdx: -1 });
    allLines.push({
      text: `${fileIcon} ${isHighlighted ? th.selected(fileName.padEnd(width - 3)) : fileColor(fileName)}${passCount}`,
      itemIdx: itemIndex,
    });
    itemIndex++;
    renderedFiles++;

    const visibleTests = testFilter
      ? file.tests.filter(t => fileMatchesPath || matchesTest(t.title))
      : file.tests;

    const fLetter = fileLetter(fi);
    let testNum = 0;

    for (let ti = 0; ti < file.tests.length; ti++) {
      const test = file.tests[ti]!;
      testNum++;
      const testVisible = fileMatchesPath || matchesTest(test.title);

      if (testFilter && !testVisible) {
        itemIndex++;
        continue;
      }

      const testKey = `${file.path}:${test.line}`;
      const isSelected = !!selectedTests[testKey];
      const result = testResults.find(r => r.testKey === testKey);
      const isLastVisible = test === visibleTests[visibleTests.length - 1];

      // Test ID label (e.g. A1, B2)
      const testId = `${fLetter}${testNum}`;
      const idLabel = th.textMuted(testId.padEnd(3));

      // History dots: last 5 results from history
      const historyKey = `${file.relativePath}:${test.line}`;
      const historyEntries = testHistory[historyKey]?.slice(0, 5) || [];
      const historyDots = historyEntries.length > 0
        ? ' ' + historyEntries.map(e =>
            e.s === 'passed' ? chalk.hex(colors.success)('●')
            : chalk.hex(colors.error)('●')
          ).join('')
        : '';

      // Selection icon always visible; result shown via name color
      let icon: string;
      if (result?.status === 'running') icon = chalk.hex(colors.running)(spinnerFrames[frame % spinnerFrames.length]);
      else if (isSelected && result?.status === 'passed') icon = chalk.hex(colors.success)('◉');
      else if (isSelected && result?.status === 'failed') icon = chalk.hex(colors.error)('◉');
      else if (isSelected) icon = chalk.hex(colors.success)('◉');
      else if (result?.status === 'passed') icon = chalk.hex(colors.success)(chars.check);
      else if (result?.status === 'failed') icon = chalk.hex(colors.error)(chars.cross);
      else icon = chalk.hex(colors.textDim)('○');

      const isHighlighted2 = focusLeft && itemIndex === testSelectionIndex;
      const maxTestNameLen = width - 12 - historyEntries.length * 1 - (historyEntries.length > 0 ? 1 : 0);
      const testName = test.title.length > maxTestNameLen ? test.title.slice(0, maxTestNameLen - 3) + '...' : test.title;

      let selectedTestKey = '';
      let idx = 0;
      outer: for (const f of testFiles) {
        idx++;
        for (const t of f.tests) {
          if (idx === testSelectionIndex) { selectedTestKey = `${f.path}:${t.line}`; break outer; }
          idx++;
        }
      }
      const isViewingThis = testKey === selectedTestKey;

      const treePre = chalk.hex(colors.borderDim)(isLastVisible ? chars.last : chars.branch);
      const viewMarker = (!focusLeft && isViewingThis) ? chalk.hex(colors.highlight)(chars.arrow + ' ') : '  ';
      const durationText = result?.duration && (result.status === 'passed' || result.status === 'failed')
        ? ` ${(result.duration / 1000).toFixed(1)}s`
        : '';
      const dimTest = result?.status === 'passed';
      const nameDisplay = isHighlighted2
        ? th.selected(testName + th.textMuted(durationText))
        : isViewingThis && !focusLeft
          ? chalk.hex(colors.highlight)(testName) + th.textMuted(durationText)
          : dimTest
            ? th.textSecondary(testName) + th.textMuted(durationText)
            : result?.status === 'failed'
              ? chalk.hex(colors.error)(testName) + th.textMuted(durationText)
              : result?.status === 'running'
                ? chalk.hex(colors.running)(testName) + th.textMuted(durationText)
                : testName + th.textMuted(durationText);
      allLines.push({
        text: `${treePre}${viewMarker}${icon} ${idLabel}${nameDisplay}${historyDots}`,
        itemIdx: itemIndex,
      });
      itemIndex++;
    }
  }

  // Compute scroll window centered on selection
  const selectedLineIdx = allLines.findIndex(l => l.itemIdx === testSelectionIndex);
  const totalLines = allLines.length;
  const needsScroll = totalLines > availableLines;

  let scrollStart = 0;
  if (needsScroll && selectedLineIdx >= 0) {
    // Keep selection roughly centered, but clamp to bounds
    scrollStart = Math.max(0, Math.min(
      selectedLineIdx - Math.floor(availableLines / 3),
      totalLines - availableLines,
    ));
  }

  const visibleLines = allLines.slice(scrollStart, scrollStart + availableLines);

  // Pad to fill available space
  while (visibleLines.length < availableLines) {
    visibleLines.push({ text: '', itemIdx: -1 });
  }

  return (
    <Box flexDirection="column" height={maxLines}>
      {filterRow}
      {visibleLines.map((line, i) => {
        const scrollMark = needsScroll ? getScrollChar(i, availableLines, totalLines, scrollStart) : '';
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
