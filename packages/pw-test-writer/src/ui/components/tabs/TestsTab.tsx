import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, chars } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';
import { TestList } from './TestList.js';
import { ActionPanel } from './ActionPanel.js';
import type { TestResult } from '../../store.js';

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

  if (testFiles.length === 0) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>  {chalk.hex(colors.textMuted)(chars.circle)} {chalk.hex(colors.textDim)('No test files')} {chalk.hex(colors.borderDim)('·')} {chalk.hex(colors.textDim)('Press F8 to scan')}</Text>
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

  // Header row with selection count
  const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
  const selectedCount = Object.keys(selectedTests).length;
  const headerTitle = chalk.hex(colors.text).bold(`Tests (${totalTests})`);
  const headerSelection = selectedCount > 0
    ? chalk.hex(colors.secondary)(` · ${selectedCount} selected`)
    : '';

  const panelLines = maxLines - 1;

  // Build separator column — alternating chars for subtle dotted effect
  const sepLines = Array.from({ length: panelLines }, (_, i) => (
    <Text key={i} color={colors.borderDim}>{i % 3 === 0 ? '┊' : '│'}</Text>
  ));

  return (
    <Box flexDirection="column">
      <Text>{headerTitle}{headerSelection}</Text>
      <Box>
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
