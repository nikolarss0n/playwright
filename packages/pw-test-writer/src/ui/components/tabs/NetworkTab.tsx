import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, th, chars, divider, waterfall, formatBytes } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';

interface NetworkTabProps {
  maxLines: number;
  width: number;
}

const methodColors: Record<string, string> = {
  GET: colors.success,
  POST: colors.warning,
  PUT: colors.warning,
  PATCH: colors.warning,
  DELETE: colors.error,
};

export function NetworkTab({ maxLines, width }: NetworkTabProps) {
  const networkRequests = useStore(s => s.networkRequests);

  if (networkRequests.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>{divider('Network', 0, width)}</Text>
        <Text> </Text>
        <Text>  {chalk.hex(colors.textMuted)(chars.circle)} {chalk.hex(colors.textDim)('No requests')} {chalk.hex(colors.borderDim)('·')} {chalk.hex(colors.textDim)('Run tests to capture')}</Text>
      </Box>
    );
  }

  const visible = networkRequests.slice(-(maxLines - 1));
  const maxDuration = Math.max(1, ...networkRequests.map(r => r.durationMs || 0));

  return (
    <Box flexDirection="column">
      <Text>{divider('Network', networkRequests.length, width)}</Text>
      {visible.map((req, i) => {
        const mColor = methodColors[req.method] || colors.textSecondary;
        const statusColor = !req.status ? colors.textDim :
                            req.status < 300 ? colors.success :
                            req.status < 400 ? colors.warning : colors.error;
        const statusText = String(req.status || '...');
        const statusPill = chalk.hex(statusColor).bold(`[${statusText.padEnd(3)}]`);
        const duration = req.durationMs ? th.textDim(` ${req.durationMs}ms`) : '';
        const size = (req as any).responseSize
          ? th.textDim(` → ${formatBytes((req as any).responseSize)}`)
          : '';
        const bar = req.durationMs ? ' ' + waterfall(req.durationMs / maxDuration, 8) : '';
        const overhead = 6 + 6 + (req.durationMs ? 8 : 0) + (bar ? 10 : 0) + ((req as any).responseSize ? 12 : 0);
        const maxUrlLen = Math.max(10, width - overhead);
        const urlDisplay = req.url.length > maxUrlLen ? req.url.slice(0, maxUrlLen - 3) + '...' : req.url;
        return (
          <Text key={i}>
            {chalk.hex(mColor).bold(req.method.padEnd(6))} {statusPill} {urlDisplay}{bar}{duration}{size}
          </Text>
        );
      })}
    </Box>
  );
}
