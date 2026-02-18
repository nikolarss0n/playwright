import React, { useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, chars } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';
import { useInterval } from '../../hooks/useInterval.js';
import { TestList } from './TestList.js';
import { ActionPanel } from './ActionPanel.js';
import type { TestResult } from '../../store.js';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const dots = ['   ', '.  ', '.. ', '...'];

interface TestsTabProps {
  maxLines: number;
  width: number;
}

export function TestsTab({ maxLines, width }: TestsTabProps) {
  const testFiles = useStore(s => s.testFiles);
  const testResults = useStore(s => s.testResults);
  const selectedTests = useStore(s => s.selectedTests);
  const testSelectionIndex = useStore(s => s.testSelectionIndex);
  const panelFocus = useStore(s => s.panelFocus);
  const status = useStore(s => s.status);

  const isDiscovering = status.includes('Discovering');
  const [frame, setFrame] = useState(0);
  useInterval(() => setFrame(f => f + 1), isDiscovering ? 80 : null);

  if (testFiles.length === 0) {
    const midY = Math.floor(maxLines / 2) - 1;
    const pad = (n: number) => Array.from({ length: n }, () => <Text key={`p${n}${Math.random()}`}>{' '}</Text>);

    if (isDiscovering) {
      const spinner = chalk.hex(colors.primary)(spinnerFrames[frame % spinnerFrames.length]);
      const dotAnim = chalk.hex(colors.textDim)(dots[Math.floor(frame / 4) % dots.length]);
      const label = chalk.hex(colors.textSecondary)('Discovering tests');
      return (
        <Box flexDirection="column" alignItems="center" width={width}>
          {pad(midY)}
          <Text>{spinner} {label}{dotAnim}</Text>
          <Text> </Text>
          <Text color={colors.textMuted}>Scanning playwright config...</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" alignItems="center" width={width}>
        {pad(midY)}
        <Text>  {chalk.hex(colors.primary)(chars.circle)} {chalk.hex(colors.textSecondary)('No tests found')} {chalk.hex(colors.borderDim)('·')} {chalk.hex(colors.textMuted)('F8 Refresh')}</Text>
        <Text>  {chalk.hex(colors.textDim)('  Use the prompt below to generate tests')}</Text>
      </Box>
    );
  }

  // Responsive left panel width — scales with terminal
  const leftWidth = width < 60
    ? Math.floor(width * 0.45)
    : width < 100
      ? Math.floor(width * 0.38)
      : Math.max(40, Math.floor(width * 0.3));
  const separatorWidth = 1;
  const rightWidth = width - leftWidth - separatorWidth - 1; // 1 for paddingLeft

  // Find selected test info
  let selectedTestKey = '';
  let selectedTestName = '';
  let findIdx = 0;
  findLoop: for (const file of testFiles) {
    findIdx++;
    for (const test of file.tests) {
      if (findIdx === testSelectionIndex) {
        selectedTestKey = `${file.path}:${test.line}`;
        selectedTestName = test.title;
        break findLoop;
      }
      findIdx++;
    }
  }
  const selectedResult: TestResult | null = selectedTestKey ? testResults.find(r => r.testKey === selectedTestKey) ?? null : null;

  // Header row with selection count and URL
  const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
  const selectedCount = Object.keys(selectedTests).length;
  const headerTitle = chalk.hex(colors.primary).bold(`Tests`) + chalk.hex(colors.textMuted)(` (${totalTests})`);
  const headerSelection = selectedCount > 0
    ? chalk.hex(colors.textDim)(` · ${selectedCount} selected`)
    : '';
  const panelLines = maxLines - 1;

  // Build separator column — alternating chars for subtle dotted effect
  const sepLines = Array.from({ length: panelLines }, (_, i) => (
    <Text key={i} color={colors.borderDim}>{i % 3 === 0 ? '┊' : '│'}</Text>
  ));

  return (
    <Box flexDirection="column" height={maxLines}>
      <Text>{headerTitle}{headerSelection}</Text>
      <Box height={panelLines}>
        <Box width={leftWidth} flexDirection="column">
          <TestList width={leftWidth} maxLines={panelLines} />
        </Box>
        <Box width={separatorWidth} flexDirection="column">
          {sepLines}
        </Box>
        <Box flexGrow={1} flexDirection="column" paddingLeft={1}>
          <ActionPanel selectedResult={selectedResult} selectedTestName={selectedTestName} width={rightWidth} maxLines={panelLines} />
        </Box>
      </Box>
    </Box>
  );
}
