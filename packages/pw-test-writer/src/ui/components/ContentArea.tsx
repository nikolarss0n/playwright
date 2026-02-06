import React from 'react';
import { Box } from 'ink';
import { useStore } from '../hooks/useStore.js';
import { StepsTab } from './tabs/StepsTab.js';
import { CodeTab } from './tabs/CodeTab.js';
import { NetworkTab } from './tabs/NetworkTab.js';
import { ConsoleTab } from './tabs/ConsoleTab.js';
import { TestsTab } from './tabs/TestsTab.js';

interface ContentAreaProps {
  maxLines: number;
  width: number;
}

export function ContentArea({ maxLines, width }: ContentAreaProps) {
  const activeTab = useStore(s => s.activeTab);

  switch (activeTab) {
    case 'tests':
      return <TestsTab maxLines={maxLines} width={width} />;
    case 'steps':
      return <StepsTab maxLines={maxLines} width={width} />;
    case 'pom':
    case 'business':
    case 'test':
      return <CodeTab maxLines={maxLines} />;
    case 'network':
      return <NetworkTab maxLines={maxLines} width={width} />;
    case 'console':
      return <ConsoleTab maxLines={maxLines} width={width} />;
    default:
      return null;
  }
}
