import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { colors, th, chars, sparkChar, divider } from '../../theme.js';
import { useStore } from '../../hooks/useStore.js';

interface StepsTabProps {
  maxLines: number;
  width: number;
}

const actionBadges: Record<string, { label: string; color: string }> = {
  click:     { label: 'click',  color: colors.secondary },
  fill:      { label: 'fill',   color: colors.info },
  navigate:  { label: 'nav',    color: colors.warning },
  goto:      { label: 'nav',    color: colors.warning },
  assert:    { label: 'assert', color: colors.success },
  expect:    { label: 'assert', color: colors.success },
  check:     { label: 'check',  color: colors.success },
  hover:     { label: 'hover',  color: colors.textDim },
  select:    { label: 'select', color: colors.info },
  type:      { label: 'type',   color: colors.info },
  press:     { label: 'press',  color: colors.info },
  wait:      { label: 'wait',   color: colors.running },
};

function getBadge(action: string): string {
  const lower = action.toLowerCase();
  for (const [key, badge] of Object.entries(actionBadges)) {
    if (lower.includes(key)) return chalk.hex(badge.color).dim(`[${badge.label}]`);
  }
  return '';
}

function formatElapsed(ms: number | undefined): string {
  if (!ms) return '    ';
  if (ms < 1000) return th.textMuted(`${(ms / 1000).toFixed(1)}s`);
  if (ms < 10000) return th.textMuted(`${(ms / 1000).toFixed(1)}s`);
  return th.textMuted(`${(ms / 1000).toFixed(0)}s `);
}

export function StepsTab({ maxLines, width }: StepsTabProps) {
  const steps = useStore(s => s.steps);
  const mode = useStore(s => s.mode);

  const stepsLabel = mode === 'run' ? 'Actions' : 'Steps';

  if (steps.length === 0) {
    const hint = mode === 'run' ? 'Run tests to capture' : 'Enter a task to begin';
    return (
      <Box flexDirection="column">
        <Text>{divider(stepsLabel, 0, width)}</Text>
        <Text> </Text>
        <Text>  {chalk.hex(colors.textMuted)(chars.circle)} {chalk.hex(colors.textDim)(`No ${stepsLabel.toLowerCase()}`)} {chalk.hex(colors.borderDim)('·')} {chalk.hex(colors.textDim)(hint)}</Text>
      </Box>
    );
  }

  // Find max duration for sparkline scaling
  const durations = steps.map(s => {
    if (!s.details) return 0;
    const match = s.details.match(/(\d+)ms/);
    return match ? parseInt(match[1]!, 10) : 0;
  });
  const maxDuration = Math.max(1, ...durations);

  const visible = steps.slice(-maxLines + 1);
  return (
    <Box flexDirection="column">
      <Text>{divider(stepsLabel, steps.length, width)}</Text>
      {visible.map((step, i) => {
        const isLast = i === visible.length - 1;
        const icon = step.status === 'running' ? chalk.hex(colors.running)(chars.dot) :
                     step.status === 'done' ? chalk.hex(colors.success)(chars.check) :
                     step.status === 'error' ? chalk.hex(colors.error)(chars.cross) : chalk.hex(colors.textDim)(chars.circle);

        // Dimming: completed = muted, active = bright, pending = very dim
        const nameColor = step.status === 'error' ? chalk.hex(colors.error) :
                      step.status === 'done' ? chalk.hex(colors.textMuted) :
                      step.status === 'running' ? chalk.hex(colors.running) : chalk.hex(colors.textDim);
        const treePre = chalk.hex(colors.borderDim)(isLast ? chars.last : chars.branch);
        const continuation = chalk.hex(colors.borderDim)(isLast ? chars.blank : chars.pipe);

        // Elapsed time from details
        const durationMs = durations[steps.length - visible.length + i] || 0;
        const elapsed = durationMs > 0 ? formatElapsed(durationMs) : '    ';

        // Semantic badge
        const badge = getBadge(step.action);

        // Sparkline for relative duration
        const spark = durationMs > 0
          ? th.textMuted(' ' + sparkChar(durationMs / maxDuration))
          : '';

        // Parse details into parts for richer display
        const detailParts: string[] = [];
        if (step.details) {
          const parts = step.details.split('  │  ');
          for (const part of parts) {
            if (part.includes('req')) {
              detailParts.push(chalk.hex(colors.secondary)(part));
            } else if (part.includes('err')) {
              detailParts.push(chalk.hex(colors.error)(part));
            } else if (part.match(/^\d+ms$/)) {
              detailParts.push(chalk.hex(colors.textDim)(part));
            } else if (part.startsWith('waiting for')) {
              detailParts.push(chalk.hex(colors.running)(part));
            } else {
              detailParts.push(th.textDim(part));
            }
          }
        }
        const detailLine = detailParts.length > 0
          ? detailParts.join(chalk.hex(colors.textMuted)('  '))
          : null;

        return (
          <Box key={step.id} flexDirection="column">
            <Text>{elapsed} {treePre} {icon} {nameColor(step.action)} {badge}{spark}</Text>
            {detailLine && <Text>     {continuation}   {detailLine}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
