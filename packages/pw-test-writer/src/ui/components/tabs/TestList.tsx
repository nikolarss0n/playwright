import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, th, chars } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';

interface TestListProps {
  width: number;
  maxLines: number;
}

export function TestList({ width, maxLines }: TestListProps) {
  const testFiles = useStore(s => s.testFiles);
  const selectedTests = useStore(s => s.selectedTests);
  const testResults = useStore(s => s.testResults);
  const testSelectionIndex = useStore(s => s.testSelectionIndex);
  const panelFocus = useStore(s => s.panelFocus);

  const focusLeft = panelFocus === 'tests';
  const lines: string[] = [];

  let itemIndex = 0;
  for (let fi = 0; fi < testFiles.length; fi++) {
    const file = testFiles[fi]!;
    const fileResults = file.tests.map(t => testResults.find(r => r.testKey === `${file.path}:${t.line}`));
    const allPassed = fileResults.every(r => r?.status === 'passed');
    const anyFailed = fileResults.some(r => r?.status === 'failed');
    const anyRunning = fileResults.some(r => r?.status === 'running');
    const hasResults = fileResults.some(r => r);

    let fileIcon: string;
    if (anyRunning) fileIcon = chalk.hex(colors.running)(chars.dot);
    else if (hasResults && allPassed) fileIcon = chalk.hex(colors.success)(chars.check);
    else if (anyFailed) fileIcon = chalk.hex(colors.error)(chars.cross);
    else {
      const fileSelected = file.tests.every(t => selectedTests[`${file.path}:${t.line}`]);
      const filePartial = file.tests.some(t => selectedTests[`${file.path}:${t.line}`]) && !fileSelected;
      fileIcon = fileSelected ? chalk.hex(colors.success)('◉') : filePartial ? chalk.hex(colors.warning)('◐') : chalk.hex(colors.textDim)('○');
    }

    // File-level pass count
    const passedCount = fileResults.filter(r => r?.status === 'passed').length;
    const totalFileTests = file.tests.length;
    const passCount = hasResults ? th.textMuted(` (${passedCount}/${totalFileTests})`) : '';

    const isHighlighted = focusLeft && itemIndex === testSelectionIndex;
    const fileName = file.relativePath.length > width - 5 ? '...' + file.relativePath.slice(-(width - 8)) : file.relativePath;
    const fileColor = allPassed ? th.textSecondary : th.secondary;
    // Visual spacing between file groups (not before first)
    if (fi > 0 && lines.length < maxLines - 2) lines.push('');

    lines.push(`${fileIcon} ${isHighlighted ? th.selected(fileName.padEnd(width - 3)) : fileColor(fileName)}${passCount}`);
    itemIndex++;

    for (let ti = 0; ti < file.tests.length; ti++) {
      const test = file.tests[ti]!;
      const testKey = `${file.path}:${test.line}`;
      const isSelected = !!selectedTests[testKey];
      const result = testResults.find(r => r.testKey === testKey);
      const isLast = ti === file.tests.length - 1;

      let icon: string;
      if (result?.status === 'running') icon = chalk.hex(colors.running)(chars.dot);
      else if (result?.status === 'passed') icon = chalk.hex(colors.success)(chars.check);
      else if (result?.status === 'failed') icon = chalk.hex(colors.error)(chars.cross);
      else icon = isSelected ? chalk.hex(colors.success)('◉') : chalk.hex(colors.textDim)('○');

      const isHighlighted2 = focusLeft && itemIndex === testSelectionIndex;
      const testName = test.title.length > width - 8 ? test.title.slice(0, width - 11) + '...' : test.title;

      // Find selected test key for view marker
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

      const treePre = chalk.hex(colors.borderDim)(isLast ? chars.last : chars.branch);
      const viewMarker = (!focusLeft && isViewingThis) ? chalk.hex(colors.highlight)(chars.arrow + ' ') : '  ';
      // Duration suffix for completed tests
      const durationText = result?.duration && (result.status === 'passed' || result.status === 'failed')
        ? ` ${(result.duration / 1000).toFixed(1)}s`
        : '';
      // Dim passed, keep running/failed bright
      const dimTest = result?.status === 'passed';
      const contentWidth = testName.length + durationText.length;
      const pad = ' '.repeat(Math.max(0, width - 7 - contentWidth));
      const nameDisplay = isHighlighted2
        ? th.selected(testName + th.textMuted(durationText) + pad)
        : isViewingThis && !focusLeft
          ? chalk.hex(colors.highlight)(testName) + th.textMuted(durationText)
          : dimTest
            ? th.textSecondary(testName) + th.textMuted(durationText)
            : result?.status === 'failed'
              ? chalk.hex(colors.error)(testName) + th.textMuted(durationText)
              : result?.status === 'running'
                ? chalk.hex(colors.running)(testName) + th.textMuted(durationText)
                : testName + th.textMuted(durationText);
      lines.push(`${treePre}${viewMarker}${icon} ${nameDisplay}`);
      itemIndex++;
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
