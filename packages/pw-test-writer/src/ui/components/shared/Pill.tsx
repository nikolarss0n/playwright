import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../../theme.js';

interface PillProps {
  label: string;
  active?: boolean;
  color?: string;
}

export function Pill({ label, active = false, color = colors.primary }: PillProps) {
  if (active) {
    return (
      <Box borderStyle="round" borderColor={color} paddingX={1}>
        <Text bold color={color}>{label}</Text>
      </Box>
    );
  }
  return <Text color={colors.textDim}>{label}</Text>;
}
