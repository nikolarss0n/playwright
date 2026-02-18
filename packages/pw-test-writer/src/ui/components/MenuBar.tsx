import React from 'react';
import { Box, Text, Spacer } from 'ink';
import chalk from 'chalk';
import { colors } from '../theme.js';
import { useStore } from '../hooks/useStore.js';
import type { TabId } from '../store.js';

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

export { WRITE_TABS, RUN_TABS };

export function MenuBar() {
  const mode = useStore(s => s.mode);
  const activeTab = useStore(s => s.activeTab);
  const baseURL = useStore(s => s.baseURL);
  const networkCount = useStore(s => s.networkRequests.length);
  const consoleCount = useStore(s => s.consoleMessages.length);

  const TABS = mode === 'run' ? RUN_TABS : WRITE_TABS;

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

  let urlDisplay = '';
  if (baseURL) {
    try {
      urlDisplay = chalk.hex(colors.secondary)(new URL(baseURL).host);
    } catch {
      urlDisplay = chalk.hex(colors.secondary)(baseURL);
    }
  }

  const title = chalk.hex(colors.primary).bold('playwright') + chalk.hex(colors.textMuted)(' test-writer');

  return (
    <Box paddingX={1}>
      <Box width="33%">
        {urlDisplay ? <Text>{urlDisplay}</Text> : null}
      </Box>
      <Box width="34%" justifyContent="center">
        {tabParts.length > 0
          ? <Text>{tabParts.join('  ')}</Text>
          : <Text>{title}</Text>
        }
      </Box>
      <Box width="33%" />
    </Box>
  );
}
