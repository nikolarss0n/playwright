import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, chars, divider } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';

interface CodeTabProps {
  maxLines: number;
}

export function CodeTab({ maxLines }: CodeTabProps) {
  const activeTab = useStore(s => s.activeTab);
  const pomCode = useStore(s => s.pomCode);
  const businessCode = useStore(s => s.businessCode);
  const testCode = useStore(s => s.testCode);

  const code = activeTab === 'pom' ? pomCode :
               activeTab === 'business' ? businessCode : testCode;
  const title = activeTab === 'pom' ? 'Page Object Model' :
                activeTab === 'business' ? 'Business Layer' : 'Test Specification';

  if (!code) {
    return (
      <Box flexDirection="column">
        <Text>{divider(title, undefined, 40)}</Text>
        <Text> </Text>
        <Text>  {chalk.hex(colors.textMuted)(chars.circle)} {chalk.hex(colors.textDim)(`No ${title.toLowerCase()}`)} {chalk.hex(colors.borderDim)('·')} {chalk.hex(colors.textDim)('Write a test to generate')}</Text>
      </Box>
    );
  }

  const codeLines = code.split('\n');
  const visibleLines = codeLines.slice(0, maxLines - 2);
  const totalLines = codeLines.length;

  return (
    <Box flexDirection="column">
      <Text>{divider(`${title} · ${totalLines} lines`, undefined, 40)}</Text>
      {visibleLines.map((line, i) => (
        <Text key={i}>{chalk.hex(colors.textMuted)(`${String(i + 1).padStart(3)}`)} {chalk.hex(colors.borderDim)('│')} {line}</Text>
      ))}
      {totalLines > maxLines - 2 && (
        <Text color={colors.textDim}>    ... {totalLines - (maxLines - 2)} more lines</Text>
      )}
    </Box>
  );
}
