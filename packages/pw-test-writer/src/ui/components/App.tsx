import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import * as fs from 'fs';
import { useScreenSize } from 'fullscreen-ink';
import { useStore, useAppState } from '../hooks/useStore.js';
import { useKeypress, type KeypressEvent } from '../hooks/useKeypress.js';
import { useInterval } from '../hooks/useInterval.js';
import { store, type AppMode, type ModelId } from '../store.js';
import { colors, th } from '../theme.js';
import { logError } from '../index.js';
import { MenuBar, WRITE_TABS, RUN_TABS } from './MenuBar.js';
import { filterActions } from './tabs/ActionPanel.js';
import { InputBar } from './InputBar.js';
import { ContentArea } from './ContentArea.js';
import { AiBar } from './AiBar.js';
import { StatusBar } from './StatusBar.js';
import { saveBaseURL } from '../../config/playwright.js';
import { discoverTests, runSelectedTests, killCurrentTest } from '../../runner/testRunner.js';
import { getAiSuggestion, getCurrentAiContext, extractCodeFromResponse, replaceTestInFile } from '../../ai/assistant.js';

interface AppProps {
  onSubmit: (task: string, model: string, baseURL: string) => Promise<void>;
}

function getModelId(model: ModelId): string {
  switch (model) {
    case 'haiku': return 'claude-haiku-4-5-20251001';
    case 'opus': return 'claude-opus-4-5-20251101';
  }
}

export function App({ onSubmit }: AppProps) {
  const { exit } = useApp();
  const { width, height } = useScreenSize();
  const state = useAppState();
  const [inputMode, setInputMode] = useState<'task' | 'baseURL'>(
    store.getState().baseURL ? 'task' : 'baseURL'
  );
  const busyRef = useRef(false);
  const aiInputActiveRef = useRef(false);
  const handleAiInputActive = useCallback((active: boolean) => {
    aiInputActiveRef.current = active;
  }, []);

  // Tick for progress timer
  const isRunning = useStore(s => s.isRunning);
  const [, setTick] = useState(0);
  useInterval(() => setTick(t => t + 1), isRunning ? 500 : null);

  const handleSubmitTask = useCallback(async (task: string) => {
    store.resetForNewTask();
    await onSubmit(task, getModelId(state.selectedModel), state.baseURL);
  }, [onSubmit, state.selectedModel, state.baseURL]);

  const handleSubmitBaseURL = useCallback((url: string) => {
    if (url) {
      store.setBaseURL(url);
      const savedPath = saveBaseURL(url);
      store.setConfigPath(savedPath);
      store.setStatus(`Base URL saved to ${savedPath}`);
    }
  }, []);

  const handleAiPrompt = useCallback(async (prompt: string) => {
    store.setAiLoading(true);
    store.setAiResponse('');
    try {
      const context = getCurrentAiContext();
      const response = await getAiSuggestion(prompt, context);
      store.setAiResponse(response);
    } catch (error: any) {
      store.setAiResponse(`Error: ${error.message}`);
    } finally {
      store.setAiLoading(false);
    }
  }, []);

  // Find selected test info (used by AI actions)
  const findSelectedTest = useCallback(() => {
    let selectedFile = '', selectedTestName = '', selectedTestLine = 0, findIdx = 0;
    for (const file of state.testFiles) {
      if (findIdx === state.testSelectionIndex) { selectedFile = file.path; break; }
      findIdx++;
      for (const test of file.tests) {
        if (findIdx === state.testSelectionIndex) {
          selectedFile = file.path; selectedTestName = test.title; selectedTestLine = test.line; break;
        }
        findIdx++;
      }
      if (selectedFile) break;
    }
    return { selectedFile, selectedTestName, selectedTestLine };
  }, [state.testFiles, state.testSelectionIndex]);

  // Find selected test result (used by action panel navigation)
  const getSelectedResult = useCallback(() => {
    let currentIdx = 0;
    for (const file of state.testFiles) {
      currentIdx++;
      for (const test of file.tests) {
        if (currentIdx === state.testSelectionIndex) {
          return state.testResults.find(r => r.testKey === `${file.path}:${test.line}`) ?? null;
        }
        currentIdx++;
      }
    }
    return null;
  }, [state.testFiles, state.testSelectionIndex, state.testResults]);

  useKeypress(useCallback((key: KeypressEvent) => {
    try {
    if (busyRef.current) return;
    const s = store.getState();
    const TABS = s.mode === 'run' ? RUN_TABS : WRITE_TABS;

    // Ctrl+C: exit
    if (key.ctrl && key.name === 'c') {
      exit();
      return;
    }

    // AI response actions (Tab=Apply, Ctrl+S=Save)
    if (s.mode === 'run' && s.aiResponse && !s.aiLoading) {
      if (key.name === 'tab') {
        const code = extractCodeFromResponse(s.aiResponse);
        if (code) {
          const existingCode = s.testCode;
          const newCode = existingCode
            ? existingCode + '\n\n// AI Generated:\n' + code
            : '// AI Generated:\n' + code;
          store.setTestCode(newCode);
          store.setAiResponse('');
          store.setMode('write');
          store.setActiveTab('test');
          store.setStatus('Code applied to Test tab');
        } else {
          store.setStatus('No code block found in response');
        }
        return;
      }
      if (key.ctrl && key.name === 's') {
        const code = extractCodeFromResponse(s.aiResponse);
        if (!code) { store.setStatus('No code block found in AI response'); return; }
        const { selectedFile, selectedTestName, selectedTestLine } = findSelectedTest();
        if (!selectedFile) { store.setStatus('No test file selected'); return; }
        const isCompleteTest = code.trim().match(/^test\s*\(/);
        if (isCompleteTest && selectedTestLine > 0) {
          const result = replaceTestInFile(selectedFile, selectedTestLine, code);
          if (result.success) {
            store.setAiResponse('');
            store.setStatus(`Test "${selectedTestName}" updated in ${selectedFile}`);
          } else { store.setStatus(`Error: ${result.error}`); }
        } else {
          try {
            const existingContent = fs.readFileSync(selectedFile, 'utf-8');
            const wrappedCode = `\ntest('${selectedTestName ? `AI: ${selectedTestName}` : 'AI generated test'}', async ({ page }) => {\n${code.split('\n').map((l: string) => '  ' + l).join('\n')}\n});\n`;
            fs.writeFileSync(selectedFile, existingContent + wrappedCode);
            store.setAiResponse('');
            store.setStatus(`New test added to ${selectedFile}`);
          } catch (err: any) { store.setStatus(`Error: ${err.message}`); }
        }
        return;
      }
    }

    // Tab switching with F-keys
    const tab = TABS.find(t => t.fkey.toLowerCase() === key.name);
    if (tab) {
      store.setActiveTab(tab.id);
      return;
    }

    // Mode toggle with F7
    if (key.name === 'f7' && !s.isRunning) {
      const newMode: AppMode = s.mode === 'write' ? 'run' : 'write';
      store.setMode(newMode);
      if (newMode === 'run') {
        busyRef.current = true;
        store.setStatus('Discovering tests...');
        const cwd = process.cwd();
        discoverTests(cwd).then(testFiles => {
          store.setTestFiles(testFiles);
          const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
          store.setStatus(`Found ${testFiles.length} files with ${totalTests} tests`);
        }).finally(() => { busyRef.current = false; });
      }
      return;
    }

    // Refresh tests with F8
    if (key.name === 'f8' && s.mode === 'run' && !s.isRunning) {
      busyRef.current = true;
      store.setStatus('Discovering tests...');
      const cwd = process.cwd();
      discoverTests(cwd).then(testFiles => {
        store.setTestFiles(testFiles);
        const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
        store.setStatus(`Found ${testFiles.length} files with ${totalTests} tests`);
      }).finally(() => { busyRef.current = false; });
      return;
    }

    // Model switching with F9
    if (key.name === 'f9' && !s.isRunning && s.mode === 'write') {
      const models: ModelId[] = ['haiku', 'opus'];
      const idx = models.indexOf(s.selectedModel);
      store.setSelectedModel(models[(idx + 1) % models.length]!);
      return;
    }

    // Base URL editing with F10
    if (key.name === 'f10' && !s.isRunning) {
      setInputMode('baseURL');
      return;
    }

    // Full reset with F12
    if (key.name === 'f12' && !s.isRunning) {
      store.fullReset();
      store.setTestSelectionIndex(0);
      setInputMode('task');
      return;
    }

    // Escape handling
    if (key.name === 'escape') {
      if (aiInputActiveRef.current) {
        aiInputActiveRef.current = false;
        return;
      }
      if (s.isRunning) {
        store.requestStop();
        killCurrentTest();
        store.setStatus('Stopping...');
        return;
      }
      if (s.aiResponse) {
        store.setAiResponse('');
        return;
      }
      if (inputMode === 'baseURL') {
        setInputMode('task');
        return;
      }
      exit();
      return;
    }

    // Run mode navigation (skip when typing in AI input)
    if (s.mode === 'run' && !s.isRunning && !aiInputActiveRef.current) {
      const totalItems = s.testFiles.reduce((sum, f) => sum + 1 + f.tests.length, 0);

      if ((key.name === 'right' && s.panelFocus === 'tests') || (key.name === 'left' && s.panelFocus === 'actions')) {
        const newFocus = s.panelFocus === 'tests' ? 'actions' : 'tests';
        store.setPanelFocus(newFocus);
        if (newFocus === 'actions') {
          store.setActionScrollIndex(0);
          store.setExpandedActionIndex(-1);
        }
        return;
      }

      if (s.panelFocus === 'tests') {
        if (key.name === 'up') {
          store.setTestSelectionIndex(Math.max(0, s.testSelectionIndex - 1));
          store.setActionScrollIndex(0);
          store.setExpandedActionIndex(-1);
          return;
        }
        if (key.name === 'down') {
          store.setTestSelectionIndex(Math.min(totalItems - 1, s.testSelectionIndex + 1));
          store.setActionScrollIndex(0);
          store.setExpandedActionIndex(-1);
          return;
        }
        if (key.name === 'space') {
          let currentIndex = 0;
          for (const file of s.testFiles) {
            if (currentIndex === s.testSelectionIndex) {
              const allSelected = file.tests.every(t => s.selectedTests[`${file.path}:${t.line}`]);
              if (allSelected) {
                for (const test of file.tests) store.toggleTestSelection(`${file.path}:${test.line}`);
              } else {
                for (const test of file.tests) {
                  const testKey = `${file.path}:${test.line}`;
                  if (!s.selectedTests[testKey]) store.toggleTestSelection(testKey);
                }
              }
              return;
            }
            currentIndex++;
            for (const test of file.tests) {
              if (currentIndex === s.testSelectionIndex) {
                store.toggleTestSelection(`${file.path}:${test.line}`);
                return;
              }
              currentIndex++;
            }
          }
          return;
        }
        if (key.ctrl && key.name === 'a') {
          const totalTests = s.testFiles.reduce((sum, f) => sum + f.tests.length, 0);
          const selectedCount = Object.keys(s.selectedTests).length;
          if (selectedCount === totalTests) store.clearTestSelection();
          else store.selectAllTests();
          return;
        }
        if (key.name === 'return') {
          busyRef.current = true;
          store.setStatus('Starting tests...');
          runSelectedTests(process.cwd()).catch((error: any) => {
            store.setStatus(`Error: ${error.message}`);
            store.setIsRunning(false);
          }).finally(() => { busyRef.current = false; });
          return;
        }
      } else {
        // Actions panel navigation (use filtered actions to match ActionPanel rendering)
        const selectedResult = getSelectedResult();
        const actions = selectedResult ? filterActions(selectedResult.actions) : [];
        const actionsCount = actions.length;
        const isActionExpanded = s.expandedActionIndex === s.actionScrollIndex;
        const inNetworkMode = s.actionDetailFocus === 'network';
        const networkCount = actions[s.actionScrollIndex]?.network?.requests?.length || 0;

        if (inNetworkMode && isActionExpanded && networkCount > 0) {
          const isNetworkExpanded = s.expandedNetworkIndex >= 0;

          if (isNetworkExpanded) {
            if (key.name === 'up') {
              if (s.responseScrollOffset > 0) store.setResponseScrollOffset(s.responseScrollOffset - 1);
              return;
            }
            if (key.name === 'down') { store.setResponseScrollOffset(s.responseScrollOffset + 1); return; }
            if (key.name === 'return' || key.name === 'space') { store.toggleExpandedNetwork(s.networkScrollIndex); return; }
            if (key.name === 'escape') {
              // Single network request: collapse all the way back to action level
              if (networkCount === 1) { store.toggleExpandedAction(s.actionScrollIndex); store.resetNetworkDetail(); }
              else { store.setExpandedNetworkIndex(-1); }
              return;
            }
          } else {
            if (key.name === 'up') {
              if (s.networkScrollIndex > 0) store.setNetworkScrollIndex(s.networkScrollIndex - 1);
              else store.setActionDetailFocus('actions');
              return;
            }
            if (key.name === 'down') { store.setNetworkScrollIndex(Math.min(networkCount - 1, s.networkScrollIndex + 1)); return; }
            if (key.name === 'return' || key.name === 'space') { store.toggleExpandedNetwork(s.networkScrollIndex); return; }
            if (key.name === 'escape') { store.setActionDetailFocus('actions'); store.setExpandedNetworkIndex(-1); return; }
          }
        } else {
          if (key.name === 'up') { store.setActionScrollIndex(Math.max(0, s.actionScrollIndex - 1)); store.resetNetworkDetail(); return; }
          if (key.name === 'down') {
            if (isActionExpanded && networkCount > 0) {
              store.setActionDetailFocus('network');
              store.setNetworkScrollIndex(0);
            } else {
              store.setActionScrollIndex(Math.min(actionsCount - 1, s.actionScrollIndex + 1));
              store.resetNetworkDetail();
            }
            return;
          }
          if (key.name === 'return' || key.name === 'space') {
            store.toggleExpandedAction(s.actionScrollIndex);
            store.resetNetworkDetail();
            // Auto-expand single network request (skip double drill-down for API actions)
            if (s.expandedActionIndex !== s.actionScrollIndex && networkCount === 1) {
              store.setActionDetailFocus('network');
              store.setNetworkScrollIndex(0);
              store.setExpandedNetworkIndex(0);
            }
            return;
          }
        }
      }
    }
    } catch (err) { logError('keypress handler', err); }
  }, [exit, inputMode, findSelectedTest, getSelectedResult]));

  // Centered splash layout: write mode idle with no content yet
  const hasContent = state.steps.length > 0 || state.pomCode || state.businessCode || state.testCode;
  const showSplash = state.mode === 'write' && !state.isRunning && !hasContent;

  if (showSplash) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <MenuBar />
        <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" gap={1}>
          <Box flexDirection="column" alignItems="center">
            <Text>{th.primary.bold('playwright')}{th.textMuted(' test-writer')}</Text>
            <Text color={colors.borderDim}>{'─'.repeat(30)}</Text>
          </Box>
          <InputBar
            onSubmitTask={handleSubmitTask}
            onSubmitBaseURL={handleSubmitBaseURL}
            inputMode={inputMode}
            onInputModeChange={setInputMode}
          />
          <Box flexDirection="column" alignItems="center" marginTop={1}>
            <Text color={colors.textMuted}>F7 Runner  F9 Model  F10 URL  Esc Quit</Text>
          </Box>
        </Box>
        <StatusBar />
      </Box>
    );
  }

  // Normal layout with content area
  // Chrome: menubar(1) + inputbar(0-2) + statusbar(1) + content border(2) = 4-6
  const inputBarLines = state.mode === 'write' ? 2 : state.isRunning ? 1 : 0;
  const maxAiLines = Math.max(4, Math.floor(height * 0.25));
  const aiBarHeight = state.mode === 'run' ? (
    state.aiLoading ? 2 : state.aiResponse ? Math.min(maxAiLines, state.aiResponse.split('\n').length) + 2 : 0
  ) + (!state.isRunning ? 2 : 0) : 0;
  const topPad = 1;
  const contentHeight = Math.max(5, height - (4 + inputBarLines + topPad) - aiBarHeight);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <MenuBar />
      <InputBar
        onSubmitTask={handleSubmitTask}
        onSubmitBaseURL={handleSubmitBaseURL}
        inputMode={inputMode}
        onInputModeChange={setInputMode}
      />
      <Box borderStyle="round" borderColor={colors.borderDim} paddingX={1} flexGrow={1} marginTop={topPad}>
        <ContentArea maxLines={contentHeight} width={width - 4} />
      </Box>
      <AiBar onSubmitPrompt={handleAiPrompt} onInputActive={handleAiInputActive} height={height} />
      <StatusBar />
    </Box>
  );
}
