import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import chalk from 'chalk';
import { colors, th, chars } from '../theme.js';
import { useStore } from '../hooks/useStore.js';
import { store } from '../store.js';
import { ProgressIndicator } from './shared/ProgressIndicator.js';

interface InputBarProps {
  onSubmitTask: (task: string) => void;
  onSubmitBaseURL: (url: string) => void;
  inputMode: 'task' | 'baseURL';
  onInputModeChange: (mode: 'task' | 'baseURL') => void;
}

export function InputBar({ onSubmitTask, onSubmitBaseURL, inputMode, onInputModeChange }: InputBarProps) {
  const mode = useStore(s => s.mode);
  const isRunning = useStore(s => s.isRunning);
  const task = useStore(s => s.task);
  const baseURL = useStore(s => s.baseURL);
  const progress = useStore(s => s.progress);

  if (mode === 'run') {
    return <RunModeInput isRunning={isRunning} progress={progress} />;
  }

  return <WriteModeInput
    isRunning={isRunning}
    task={task}
    baseURL={baseURL}
    inputMode={inputMode}
    onSubmitTask={onSubmitTask}
    onSubmitBaseURL={onSubmitBaseURL}
    onInputModeChange={onInputModeChange}
  />;
}

function RunModeInput({ isRunning, progress }: {
  isRunning: boolean;
  progress: ReturnType<typeof store.getState>['progress'];
}) {
  if (!isRunning) return null;

  const elapsed = progress.testStartTime ? Date.now() - progress.testStartTime : 0;
  const percent = progress.testTimeoutMs ? Math.min(100, Math.round((elapsed / progress.testTimeoutMs) * 100)) : 0;

  return (
    <Box paddingX={1} gap={1}>
      <Text>{chalk.hex(colors.running)(chars.dot)} {chalk.hex(colors.running).bold('Running')}</Text>
      {progress.currentAction && (
        <Text>{th.textMuted('│')} {th.warning(progress.currentAction)}</Text>
      )}
      {progress.waitingFor && (
        <Text>{th.textDim(`(${progress.waitingFor})`)}</Text>
      )}
      {progress.testStartTime && (
        <>
          <Text>{th.textMuted('│')}</Text>
          <ProgressIndicator elapsed={elapsed} total={progress.testTimeoutMs} width={12} />
          <Text>{th.textDim(`${percent}%`)}</Text>
        </>
      )}
      <Text>{th.textMuted('│')} {th.textDim('Esc stop')}</Text>
    </Box>
  );
}

function WriteModeInput({ isRunning, task, baseURL, inputMode, onSubmitTask, onSubmitBaseURL, onInputModeChange }: {
  isRunning: boolean;
  task: string;
  baseURL: string;
  inputMode: 'task' | 'baseURL';
  onSubmitTask: (task: string) => void;
  onSubmitBaseURL: (url: string) => void;
  onInputModeChange: (mode: 'task' | 'baseURL') => void;
}) {
  const [taskValue, setTaskValue] = useState('');
  const [urlValue, setUrlValue] = useState(baseURL);

  const handleTaskSubmit = useCallback((value: string) => {
    if (value.trim()) {
      onSubmitTask(value.trim());
      setTaskValue('');
    }
  }, [onSubmitTask]);

  const handleUrlSubmit = useCallback((value: string) => {
    onSubmitBaseURL(value.trim());
    setUrlValue('');
    onInputModeChange('task');
  }, [onSubmitBaseURL, onInputModeChange]);

  if (isRunning) {
    return <Box paddingX={1}><Text color={colors.primary}>Task: </Text><Text color={colors.textDim}>{task}</Text></Box>;
  }

  if (inputMode === 'baseURL') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={colors.warning} bold>Base URL  </Text>
          <Text color={colors.textDim}>(Enter=save, Esc=cancel)</Text>
        </Box>
        <Box>
          <Text color={colors.warning}>{'> '}</Text>
          <TextInput defaultValue={baseURL} onSubmit={handleUrlSubmit} onChange={setUrlValue} placeholder="https://..." />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center" paddingX={1}>
      {!baseURL && <Text color={colors.warning}>No base URL set. Press F10 to configure.</Text>}
      <Box>
        <Text color={colors.primary} bold>{'> '}</Text>
        <TextInput defaultValue="" onSubmit={handleTaskSubmit} onChange={setTaskValue} placeholder="Describe the test to write..." />
      </Box>
    </Box>
  );
}
