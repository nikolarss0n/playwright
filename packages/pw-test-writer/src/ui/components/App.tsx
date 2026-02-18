import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { useScreenSize } from 'fullscreen-ink';
import { useStore, useAppState } from '../hooks/useStore.js';
import { useKeypress, type KeypressEvent } from '../hooks/useKeypress.js';
import { useInterval } from '../hooks/useInterval.js';
import { store, type AppMode, type ModelId, type TestFile, type TestCase } from '../store.js';
import { colors, th } from '../theme.js';
import { logError } from '../index.js';
import { MenuBar, WRITE_TABS, RUN_TABS } from './MenuBar.js';
import { filterActions } from './tabs/ActionPanel.js';
import { InputBar } from './InputBar.js';
import { ContentArea } from './ContentArea.js';
import { AiBar } from './AiBar.js';
import { StatusBar } from './StatusBar.js';
import { saveBaseURL } from '../../config/playwright.js';
import { exec } from 'child_process';
import { discoverTests, runSelectedTests, killCurrentTest } from '../../runner/testRunner.js';
import { loadHistory } from '../../runner/history.js';
import { getAiSuggestion, getCurrentAiContext, extractCodeFromResponse, separateImports, replaceTestInFile, buildClipboardReport } from '../../ai/assistant.js';
import { computeLineDiff, contextDiff } from '../../ai/diff.js';

/** Flat indices of tests matching a filter string (skips file headers). */
function getMatchingTestIndices(testFiles: TestFile[], filter: string): number[] {
  if (!filter) {
    const indices: number[] = [];
    let idx = 0;
    for (const file of testFiles) {
      indices.push(idx++);
      for (const _test of file.tests) indices.push(idx++);
    }
    return indices;
  }
  const lower = filter.toLowerCase();
  const indices: number[] = [];
  let idx = 0;
  for (const file of testFiles) {
    const fileMatch = file.relativePath.toLowerCase().includes(lower);
    idx++; // file header
    for (const test of file.tests) {
      if (fileMatch || test.title.toLowerCase().includes(lower)) indices.push(idx);
      idx++;
    }
  }
  return indices;
}

interface AppProps {
  onSubmit: (task: string, model: string, baseURL: string) => Promise<void>;
}

function getModelId(model: ModelId): string {
  switch (model) {
    case 'haiku': return 'claude-haiku-4-5-20251001';
    case 'opus': return 'claude-opus-4-5-20251101';
  }
}

function openFile(filePath: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${filePath}"`);
}

export function App({ onSubmit }: AppProps) {
  const { exit } = useApp();
  const { width, height } = useScreenSize();
  const state = useAppState();
  const [inputMode, setInputMode] = useState<'task' | 'baseURL'>(
    store.getState().baseURL ? 'task' : 'baseURL'
  );
  const busyRef = useRef(false);
  const [aiInputFocused, setAiInputFocused] = useState(false);
  const [aiInitialChar, setAiInitialChar] = useState<string | undefined>(undefined);
  const aiInputFocusedRef = useRef(false);
  const handleAiFocusChange = useCallback((focused: boolean) => {
    aiInputFocusedRef.current = focused;
    setAiInputFocused(focused);
    if (!focused) setAiInitialChar(undefined);
  }, []);

  // Auto-discover tests and load history on startup
  useEffect(() => {
    const cwd = process.cwd();
    // Load history synchronously (fast, local JSON)
    try { store.setState({ testHistory: loadHistory(cwd) }); } catch {}

    store.setStatus('Discovering tests...');
    discoverTests(cwd).then(testFiles => {
      store.setTestFiles(testFiles);
      const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
      store.setStatus(`Found ${testFiles.length} files with ${totalTests} tests`);
    }).catch((err: any) => {
      logError('discoverTests', err);
      store.setStatus(`Discovery failed: ${err.message}`);
    });
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
    store.setAiDiffScrollIndex(0);
    try {
      const context = getCurrentAiContext();
      const response = await getAiSuggestion(prompt, context, (status) => {
        store.setAiStatusText(status);
      });
      store.setAiResponse(response);
      const rawCode = extractCodeFromResponse(response);
      if (rawCode) {
        // Separate imports from test code so the diff shows only test changes
        const { testCode } = separateImports(rawCode);
        const diff = context.testSourceCode
          ? contextDiff(computeLineDiff(context.testSourceCode, testCode))
          : testCode.split('\n').map(content => ({ type: 'added' as const, content }));
        store.setState({ aiCodeDiff: diff, aiDiffFilePath: context.testFilePath ?? null });
      }
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
    const s = store.getState();

    // Ctrl+C: always works
    if (key.ctrl && key.name === 'c') {
      exit();
      return;
    }

    // Escape to stop running tests: must be before busyRef check
    if (key.name === 'escape' && s.isRunning) {
      store.requestStop();
      killCurrentTest();
      store.setStatus('Stopping...');
      return;
    }

    if (busyRef.current) return;
    const TABS = s.mode === 'run' ? RUN_TABS : WRITE_TABS;

    // Test filter active — navigation + close, all other keys go to TextInput
    if (s.testFilterActive) {
      if (key.name === 'escape' || key.name === 'return') {
        store.setState({ testFilter: '', testFilterActive: false });
        return;
      }
      if (s.panelFocus === 'tests' && (key.name === 'up' || key.name === 'down')) {
        const filtered = getMatchingTestIndices(s.testFiles, s.testFilter);
        if (filtered.length === 0) return;
        const curPos = filtered.indexOf(s.testSelectionIndex);
        if (key.name === 'up') {
          store.setTestSelectionIndex(filtered[Math.max(0, curPos - 1)]!);
        } else {
          const next = curPos === -1 ? 0 : Math.min(filtered.length - 1, curPos + 1);
          store.setTestSelectionIndex(filtered[next]!);
        }
        store.setActionScrollIndex(0);
        store.setExpandedActionIndex(-1);
        return;
      }
      return;
    }

    // AI diff actions: scroll, Enter=Save to file, Esc=Dismiss
    if (s.mode === 'run' && s.aiCodeDiff && !s.aiLoading && !aiInputFocusedRef.current) {
      if (key.name === 'up') {
        store.setAiDiffScrollIndex(Math.max(0, s.aiDiffScrollIndex - 1));
        return;
      }
      if (key.name === 'down') {
        const chromeLinesCount = 6;
        const maxDiffLines = Math.max(3, Math.floor(height * 0.4) - chromeLinesCount);
        const maxScroll = Math.max(0, s.aiCodeDiff.length - maxDiffLines);
        store.setAiDiffScrollIndex(Math.min(maxScroll, s.aiDiffScrollIndex + 1));
        return;
      }
      if (key.name === 'return') {
        const rawCode = extractCodeFromResponse(s.aiResponse);
        if (!rawCode) { store.setStatus('No code block found'); return; }
        const { selectedFile, selectedTestName, selectedTestLine } = findSelectedTest();
        if (!selectedFile || selectedTestLine <= 0) { store.setStatus('No test selected'); return; }
        // Separate imports from test code
        const { testCode, newImports } = separateImports(rawCode);
        const result = replaceTestInFile(selectedFile, selectedTestLine, testCode, newImports.length > 0 ? newImports : undefined);
        if (result.success) {
          store.setAiResponse('');
          const importNote = newImports.length > 0 ? ` (+${newImports.length} import${newImports.length > 1 ? 's' : ''})` : '';
          store.setStatus(`Saved: "${selectedTestName}"${importNote}`);
          // Re-discover tests to pick up changes
          const cwd = process.cwd();
          discoverTests(cwd).then(testFiles => {
            store.setTestFiles(testFiles);
            const totalTests = testFiles.reduce((sum, f) => sum + f.tests.length, 0);
            store.setStatus(`Saved. ${testFiles.length} files, ${totalTests} tests`);
          }).catch(() => {});
        } else {
          store.setStatus(`Error: ${result.error}`);
        }
        return;
      }
      if (key.name === 'escape') {
        store.setAiResponse('');
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

    // Escape handling (running case already handled above)
    if (key.name === 'escape') {
      if (aiInputFocusedRef.current) {
        handleAiFocusChange(false);
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

    // Action shortcuts in run mode (before generic char → AI input handler)
    if (s.mode === 'run' && !aiInputFocusedRef.current && !s.aiLoading && !s.aiCodeDiff) {
      // 'f' = instant AI fix for the current test/action
      if (key.sequence === 'f' && !key.ctrl && !key.meta) {
        const result = getSelectedResult();
        if (result && result.status === 'failed') {
          // Auto-navigate to the failing action so the AI gets the right context
          const failingIdx = result.actions.findIndex(a => a.error);
          if (failingIdx >= 0) {
            store.setActionScrollIndex(failingIdx);
            store.setPanelFocus('actions');
          }
          const failingAction = failingIdx >= 0 ? result.actions[failingIdx] : undefined;
          const prompt = failingAction
            ? `Fix the failing action: ${failingAction.type}.${failingAction.method}. Error: ${failingAction.error?.message?.slice(0, 200)}`
            : `Fix this failing test. Error: ${result.error?.slice(0, 200)}`;
          handleAiPrompt(prompt);
          return;
        }
        store.setStatus('No failed test selected — select a failed test first');
        return;
      }
      // 'r' = re-run tests after applying a fix
      if (key.sequence === 'r' && !key.ctrl && !key.meta && !s.isRunning) {
        store.setStatus('Re-running tests...');
        runSelectedTests(process.cwd()).catch((error: any) => {
          store.setStatus(`Error: ${error.message}`);
          store.setIsRunning(false);
        });
        return;
      }
      // 'c' = copy all debug data to clipboard
      if (key.sequence === 'c' && !key.ctrl && !key.meta) {
        try {
          // Auto-navigate to failing action so the report captures the right context
          const result = getSelectedResult();
          if (result && result.status === 'failed') {
            const failingIdx = result.actions.findIndex(a => a.error);
            if (failingIdx >= 0) store.setActionScrollIndex(failingIdx);
          }
          const report = buildClipboardReport();
          const clipCmd = process.platform === 'darwin' ? 'pbcopy'
            : process.platform === 'win32' ? 'clip' : 'xclip -selection clipboard';
          const child = exec(clipCmd);
          child.stdin?.write(report);
          child.stdin?.end();
          const lines = report.split('\n').length;
          const size = (report.length / 1024).toFixed(1);
          store.setStatus(`Copied ${lines} lines (${size}KB) to clipboard`);
        } catch (err: any) {
          store.setStatus(`Copy failed: ${err.message}`);
        }
        return;
      }
    }

    // Activate AI input on printable character in run mode
    if (s.mode === 'run' && !aiInputFocusedRef.current) {
      if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1 && key.sequence >= '!' && key.sequence <= '~') {
        // '/' activates test filter when focus is on test list
        if (key.sequence === '/' && s.panelFocus === 'tests') {
          store.setState({ testFilterActive: true, testFilter: '' });
          return;
        }
        setAiInitialChar(key.sequence);
        aiInputFocusedRef.current = true;
        setAiInputFocused(true);
        return;
      }
    }

    // Run mode navigation (skip when typing in AI input)
    if (s.mode === 'run' && !aiInputFocusedRef.current) {
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
          const selectedCount = Object.keys(s.selectedTests).length;
          if (selectedCount > 0) store.clearTestSelection();
          else store.selectAllTests();
          return;
        }
        if (key.name === 'return' && !s.isRunning) {
          store.setStatus('Starting tests...');
          runSelectedTests(process.cwd()).catch((error: any) => {
            store.setStatus(`Error: ${error.message}`);
            store.setIsRunning(false);
          });
          return;
        }
      } else {
        // Actions panel navigation (use filtered actions to match ActionPanel rendering)
        const selectedResult = getSelectedResult();
        const actions = selectedResult ? filterActions(selectedResult.actions) : [];
        const attachments = selectedResult?.attachments ?? [];
        const actionsCount = actions.length + attachments.length;
        const isInAttachmentRange = s.actionScrollIndex >= actions.length;
        const isActionExpanded = !isInAttachmentRange && s.expandedActionIndex === s.actionScrollIndex;
        const inNetworkMode = s.actionDetailFocus === 'network';
        const inConsoleMode = s.actionDetailFocus === 'console';
        const expandedAction = isInAttachmentRange ? undefined : actions[s.actionScrollIndex];
        const networkCount = expandedAction?.network?.requests?.length || 0;
        const consoleCount = expandedAction?.console?.length || 0;

        if (inConsoleMode && isActionExpanded && consoleCount > 0) {
          if (key.name === 'up') {
            if (s.consoleScrollIndex > 0) store.setConsoleScrollIndex(s.consoleScrollIndex - 1);
            else if (networkCount > 0) { store.setActionDetailFocus('network'); store.setNetworkScrollIndex(networkCount - 1); }
            else store.setActionDetailFocus('actions');
            return;
          }
          if (key.name === 'down') {
            if (s.consoleScrollIndex < consoleCount - 1) {
              store.setConsoleScrollIndex(s.consoleScrollIndex + 1);
            } else {
              // Past last console item — exit expanded action, move to next
              store.resetNetworkDetail();
              store.setActionScrollIndex(Math.min(actionsCount - 1, s.actionScrollIndex + 1));
            }
            return;
          }
          if (key.name === 'escape') { store.setActionDetailFocus('actions'); store.setState({ consoleScrollIndex: 0 }); return; }
        } else if (inNetworkMode && isActionExpanded && networkCount > 0) {
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
            if (key.name === 'down') {
              if (s.networkScrollIndex < networkCount - 1) { store.setNetworkScrollIndex(s.networkScrollIndex + 1); }
              else if (consoleCount > 0) { store.setActionDetailFocus('console'); store.setConsoleScrollIndex(0); }
              else {
                // Past last network item (no console) — exit expanded action, move to next
                store.resetNetworkDetail();
                store.setActionScrollIndex(Math.min(actionsCount - 1, s.actionScrollIndex + 1));
              }
              return;
            }
            if (key.name === 'return' || key.name === 'space') { store.toggleExpandedNetwork(s.networkScrollIndex); return; }
            if (key.name === 'escape') { store.setActionDetailFocus('actions'); store.setExpandedNetworkIndex(-1); return; }
          }
        } else {
          if (key.name === 'up') { store.setActionScrollIndex(Math.max(0, s.actionScrollIndex - 1)); store.resetNetworkDetail(); return; }
          if (key.name === 'down') {
            if (isActionExpanded && networkCount > 0) {
              store.setActionDetailFocus('network');
              store.setNetworkScrollIndex(0);
            } else if (isActionExpanded && consoleCount > 0) {
              store.setActionDetailFocus('console');
              store.setConsoleScrollIndex(0);
            } else {
              store.setActionScrollIndex(Math.min(actionsCount - 1, s.actionScrollIndex + 1));
              store.resetNetworkDetail();
            }
            return;
          }
          if (key.name === 'return' || key.name === 'space') {
            // Attachment line: open the file
            if (isInAttachmentRange) {
              const attIdx = s.actionScrollIndex - actions.length;
              const att = attachments[attIdx];
              if (att) {
                store.setStatus(`Opening: ${att.name}`);
                openFile(att.path);
              } else {
                store.setStatus(`[debug] att null: scrollIdx=${s.actionScrollIndex} actions=${actions.length} att=${attachments.length} attIdx=${attIdx}`);
              }
              return;
            }
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
    // Debug: catch unhandled space
    if (key.name === 'space') {
      store.setStatus(`[debug] space unhandled: panel=${s.panelFocus} mode=${s.mode} aiDiff=${!!s.aiCodeDiff} aiFocus=${aiInputFocusedRef.current} filter=${s.testFilterActive}`);
    }
    } catch (err) { logError('keypress handler', err); }
  }, [exit, inputMode, findSelectedTest, getSelectedResult]));

  // Calculate content height from terminal height minus all chrome elements
  // MenuBar: 1, marginTop: 1, border: 2 (top+bottom), StatusBar: 2 (hr+row)
  const chromeLines = 1 + 1 + 2 + 2;

  // InputBar: run mode not-running=0, run mode running=1, write mode=2
  const inputBarLines = state.mode !== 'run' ? 2 : state.isRunning ? 1 : 0;

  // AiBar: only shows in run mode
  let aiBarLines = 0;
  if (state.mode === 'run') {
    const hasAiContent = state.aiLoading || state.aiResponse || !state.isRunning;
    if (hasAiContent) {
      if (state.aiLoading) {
        aiBarLines = 5;
      } else if (state.aiCodeDiff) {
        // Bordered box: top + filepath + sep + diff lines + sep + footer + bottom = 6 chrome + diff
        const chromeLinesCount = 6;
        const maxDiffLines = Math.max(3, Math.floor(height * 0.4) - chromeLinesCount);
        aiBarLines = Math.min(maxDiffLines, state.aiCodeDiff.length) + chromeLinesCount;
      } else if (state.aiResponse) {
        const maxAiLines = Math.max(4, Math.floor(height * 0.25));
        aiBarLines = Math.min(maxAiLines, state.aiResponse.split('\n').length) + 2;
      }
      if (!state.isRunning) aiBarLines += 2; // hr + input
    }
  }

  const contentHeight = Math.max(5, height - chromeLines - inputBarLines - aiBarLines);

  // Debug layout — writes once per unique value change
  const debugKey = `${height}|${contentHeight}|${chromeLines}|${inputBarLines}|${aiBarLines}`;
  const debugRef = useRef('');
  if (debugRef.current !== debugKey) {
    debugRef.current = debugKey;
    logError('LAYOUT', `terminal=${height}x${width} chrome=${chromeLines} input=${inputBarLines} ai=${aiBarLines} → content=${contentHeight} boxH=${contentHeight + 2}`);
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <MenuBar />
      <InputBar
        onSubmitTask={handleSubmitTask}
        onSubmitBaseURL={handleSubmitBaseURL}
        inputMode={inputMode}
        onInputModeChange={setInputMode}
      />
      <Box borderStyle="round" borderColor={colors.borderDim} paddingX={1} height={contentHeight + 2} marginTop={1}>
        <ContentArea maxLines={contentHeight} width={width - 4} />
      </Box>
      <AiBar onSubmitPrompt={handleAiPrompt} focused={aiInputFocused} onFocusChange={handleAiFocusChange} initialChar={aiInitialChar} height={height} width={width} />
      <StatusBar />
    </Box>
  );
}
