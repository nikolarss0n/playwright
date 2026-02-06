import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme.js';
import { useStore } from '../hooks/useStore.js';

export function Header() {
  const mode = useStore(s => s.mode);
  const baseURL = useStore(s => s.baseURL);

  const modeColor = mode === 'run' ? colors.success : colors.primary;
  const modeLabel = mode === 'run' ? 'RUNNER' : 'WRITER';

  return (
    <Box paddingX={1} gap={1}>
      <Text bold color={modeColor}>[{modeLabel}]</Text>
      <Text bold color={colors.text}>Playwright Test Writer</Text>
      {baseURL && (
        <>
          <Text color={colors.textMuted}>—</Text>
          <Text color={colors.secondary}>{baseURL}</Text>
        </>
      )}
    </Box>
  );
}
