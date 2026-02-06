import React from 'react';
import { Box, Text, Spacer } from 'ink';
import chalk from 'chalk';
import { colors } from '../theme.js';
import { useStore } from '../hooks/useStore.js';
import type { TabId, ModelId } from '../store.js';

const WRITE_TABS: { id: TabId; label: string; fkey: string }[] = [
  { id: 'steps', label: 'Steps', fkey: 'F1' },
  { id: 'pom', label: 'POM', fkey: 'F2' },
  { id: 'business', label: 'Business', fkey: 'F3' },
  { id: 'test', label: 'Test', fkey: 'F4' },
  { id: 'network', label: 'Network', fkey: 'F5' },
  { id: 'console', label: 'Console', fkey: 'F6' },
];

const RUN_TABS: { id: TabId; label: string; fkey: string }[] = [
  { id: 'tests', label: 'Tests', fkey: 'F1' },
];

const MODELS: { id: ModelId; label: string }[] = [
  { id: 'haiku', label: 'Haiku 4.5' },
  { id: 'opus', label: 'Opus 4.5' },
];

export { WRITE_TABS, RUN_TABS, MODELS };

export function MenuBar() {
  const mode = useStore(s => s.mode);
  const activeTab = useStore(s => s.activeTab);
  const selectedModel = useStore(s => s.selectedModel);
  const baseURL = useStore(s => s.baseURL);
  const networkCount = useStore(s => s.networkRequests.length);
  const consoleCount = useStore(s => s.consoleMessages.length);
  const testFiles = useStore(s => s.testFiles);

  const TABS = mode === 'run' ? RUN_TABS : WRITE_TABS;
  const model = MODELS.find(m => m.id === selectedModel)!;

  // Mode badge
  const modeColor = mode === 'run' ? colors.success : colors.primary;
  const modeLabel = mode === 'run' ? 'RUNNER' : 'WRITER';
  const modeBadge = chalk.hex(modeColor).bold(`[${modeLabel}]`);

  // Tabs (hidden in runner mode — single view)
  const tabParts: string[] = [];
  if (mode !== 'run') {
    for (const tab of TABS) {
      let badge = '';
      if (tab.id === 'network' && networkCount > 0) badge = chalk.hex(colors.highlight)(` ${networkCount}`);
      if (tab.id === 'console' && consoleCount > 0) badge = chalk.hex(colors.highlight)(` ${consoleCount}`);
      if (activeTab === tab.id) {
        tabParts.push(chalk.hex(colors.primary).bold.underline(`${tab.fkey} ${tab.label}`) + badge);
      } else {
        tabParts.push(chalk.hex(colors.textMuted)(`${tab.fkey} ${tab.label}`) + badge);
      }
    }
  }

  // Right side: model (write mode) + URL
  const rightParts: string[] = [];
  if (mode === 'write') rightParts.push(chalk.hex(colors.info)(model.label));
  if (baseURL) {
    try {
      const host = new URL(baseURL).host;
      rightParts.push(chalk.hex(colors.secondary)(host));
    } catch {
      rightParts.push(chalk.hex(colors.secondary)(baseURL));
    }
  }

  return (
    <Box paddingX={1}>
      <Text>{modeBadge}{tabParts.length > 0 ? '  ' + tabParts.join('  ') : ''}</Text>
      <Spacer />
      {rightParts.length > 0 && <Text>{rightParts.join(chalk.hex(colors.textMuted)('  │  '))}</Text>}
    </Box>
  );
}
