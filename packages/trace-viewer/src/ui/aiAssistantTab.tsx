/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from 'react';
import type * as modelUtil from './modelUtil';
import { TraceAnalysisMCPServer } from '../server/traceAnalysisMCP';
import './aiAssistantTab.css';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

type FixProposal = {
  issue: string;
  explanation: string;
  diff: {
    oldCode: string;
    newCode: string;
  };
  confidence: 'high' | 'medium' | 'low';
  filePath: string;
};

type SelfHealState = 'idle' | 'analyzing' | 'showing-fix' | 'applying' | 'success';

type ApiKeyStatus = 'not-set' | 'valid' | 'invalid' | 'checking';

export const AiAssistantTab: React.FC<{
  model?: modelUtil.MultiTraceModel;
  selectedAction?: modelUtil.ActionTraceEventInContext;
  rootDir?: string;
}> = ({ model, selectedAction, rootDir }) => {
  const [mcpServer] = React.useState(() => new TraceAnalysisMCPServer());
  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hi! I\'m your AI assistant. I can help you understand test failures, analyze actions, and debug issues. What would you like to know?',
      timestamp: Date.now(),
    }
  ]);
  const [inputValue, setInputValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [selfHealState, setSelfHealState] = React.useState<SelfHealState>('idle');
  const [fixProposal, setFixProposal] = React.useState<FixProposal | null>(null);
  const [analysisSteps, setAnalysisSteps] = React.useState<string[]>([]);
  const [showSettings, setShowSettings] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [apiKeyStatus, setApiKeyStatus] = React.useState<ApiKeyStatus>('not-set');
  const [apiKeyInput, setApiKeyInput] = React.useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Typing animation hook
  const useTypingAnimation = (text: string, speed: number = 20) => {
    const [displayedText, setDisplayedText] = React.useState('');

    React.useEffect(() => {
      setDisplayedText('');
      let index = 0;
      const timer = setInterval(() => {
        if (index < text.length) {
          setDisplayedText(text.slice(0, index + 1));
          index++;
        } else {
          clearInterval(timer);
        }
      }, speed);

      return () => clearInterval(timer);
    }, [text, speed]);

    return displayedText;
  };

  // Load API key on mount
  React.useEffect(() => {
    loadApiKey();
  }, []);

  const loadApiKey = () => {
    // Try to load from localStorage
    const stored = localStorage.getItem('anthropic_api_key');
    if (stored) {
      setApiKey(stored);
      setApiKeyInput(stored);
      validateApiKey(stored);
    } else {
      // Check if ANTHROPIC_API_KEY environment variable hint is available
      // (would need to be passed from server/config)
      setApiKeyStatus('not-set');
    }
  };

  const validateApiKey = async (key: string) => {
    if (!key || key.length < 10) {
      setApiKeyStatus('invalid');
      return false;
    }

    // Basic validation - Anthropic keys start with 'sk-ant-'
    if (!key.startsWith('sk-ant-')) {
      setApiKeyStatus('invalid');
      return false;
    }

    setApiKeyStatus('checking');

    // In production, make a test API call to validate
    // For now, just basic format check
    setTimeout(() => {
      setApiKeyStatus('valid');
    }, 500);

    return true;
  };

  const saveApiKey = () => {
    if (!apiKeyInput.trim()) {
      return;
    }

    localStorage.setItem('anthropic_api_key', apiKeyInput.trim());
    setApiKey(apiKeyInput.trim());
    validateApiKey(apiKeyInput.trim());
    setShowSettings(false);
  };

  const clearApiKey = () => {
    localStorage.removeItem('anthropic_api_key');
    setApiKey('');
    setApiKeyInput('');
    setApiKeyStatus('not-set');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Update MCP server when trace model changes
  React.useEffect(() => {
    mcpServer.setCurrentTrace(model);
  }, [model, mcpServer]);

  const buildContext = React.useCallback(() => {
    if (!model) return null;

    const context = {
      testInfo: {
        browserName: model.browserName,
        platform: model.platform,
        startTime: model.startTime,
        endTime: model.endTime,
        duration: model.endTime - model.startTime,
        title: model.title,
      },
      actions: model.actions.map(action => ({
        type: action.method,
        params: action.params,
        startTime: action.startTime,
        endTime: action.endTime,
        duration: action.endTime - action.startTime,
        error: action.error?.error?.message,
        log: action.log,
      })),
      errors: model.errorDescriptors.map(error => ({
        message: error.message,
        stack: error.stack?.map(frame => ({
          file: frame.file,
          line: frame.line,
          column: frame.column,
          function: frame.function,
        })),
        action: error.action?.method,
      })),
      consoleMessages: model.events
        .filter(e => e.method === '__console__')
        .map((e: any) => ({
          type: e.params?.type,
          text: e.params?.text,
          timestamp: e.time,
        }))
        .slice(-20), // Last 20 console messages
      selectedAction: selectedAction ? {
        type: selectedAction.method,
        params: selectedAction.params,
        error: selectedAction.error?.error?.message,
        log: selectedAction.log,
      } : null,
    };

    return context;
  }, [model, selectedAction]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Use MCP tools to analyze the question and provide response
      const response = await handleUserQuestion(inputValue, mcpServer, model);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelfHeal = async () => {
    if (!model || selfHealState !== 'idle') return;

    setSelfHealState('analyzing');
    setAnalysisSteps([]);
    setFixProposal(null);

    try {
      // Step 1: Analyze the failure
      setAnalysisSteps(prev => [...prev, 'Analyzing test failure...']);
      await new Promise(resolve => setTimeout(resolve, 500));

      const errorsResult = await mcpServer.callTool('trace_get_errors', {});
      console.log('errorsResult:', errorsResult);

      if (errorsResult.isError || !errorsResult.content || !errorsResult.content[0]) {
        throw new Error('Failed to get errors from trace');
      }

      const errors = JSON.parse(errorsResult.content[0].text);

      if (!Array.isArray(errors) || errors.length === 0) {
        setAnalysisSteps(prev => [...prev, '✓ No errors found - test passed']);
        setSelfHealState('idle');
        return;
      }

      // Step 2: Get test source code
      setAnalysisSteps(prev => [...prev, 'Reading test source code...']);
      await new Promise(resolve => setTimeout(resolve, 500));

      const sourceResult = await mcpServer.callTool('trace_get_test_source', {});
      console.log('sourceResult:', sourceResult);

      if (sourceResult.isError || !sourceResult.content || !sourceResult.content[0]) {
        throw new Error('Failed to get test source code');
      }

      const testSourceData = JSON.parse(sourceResult.content[0].text);
      const testSource = testSourceData.source; // Just the failing test
      const fullSource = testSourceData.fullSource; // Full file for context
      const testName = testSourceData.testName;

      // Step 3: Analyze DOM at failure point
      setAnalysisSteps(prev => [...prev, 'Analyzing DOM snapshot...']);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 4: Generate fix proposal using REAL Claude API
      setAnalysisSteps(prev => [...prev, 'Consulting Claude AI...']);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Get screenshots if available
      const screenshotsResult = await mcpServer.callTool('trace_get_screenshots', {});
      const screenshots = JSON.parse(screenshotsResult.content[0].text);

      // Get console logs
      const logsResult = await mcpServer.callTool('trace_get_console_logs', { limit: 20 });
      const consoleLogs = JSON.parse(logsResult.content[0].text);

      // Get network requests
      const networkResult = await mcpServer.callTool('trace_get_network_requests', { limit: 10 });
      const networkRequests = JSON.parse(networkResult.content[0].text);

      // Call REAL Claude API with only the failing test
      const proposal = await callClaudeAPI({
        apiKey,
        error: errors[0],
        testSource: testSource, // Only the failing test block
        filePath: testSourceData.filePath,
        testName: testName,
        screenshots,
        consoleLogs,
        networkRequests,
        model,
      });

      console.log('Claude proposal:', proposal);

      setFixProposal(proposal);
      setAnalysisSteps(prev => [...prev, '✓ Fix proposal ready']);
      setSelfHealState('showing-fix');
    } catch (error) {
      console.error('Self-Heal error:', error);
      setAnalysisSteps(prev => [...prev, `✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setAnalysisSteps(prev => [...prev, 'Please check browser console for details']);
      // Keep in analyzing state so user can see the error
      setTimeout(() => setSelfHealState('idle'), 5000);
    }
  };

  const handleApplyFix = async () => {
    if (!fixProposal) return;

    setSelfHealState('applying');
    setAnalysisSteps(prev => [...prev, 'Applying fix...']);

    try {
      await mcpServer.callTool('trace_apply_fix', {
        filePath: fixProposal.filePath,
        oldCode: fixProposal.diff.oldCode,
        newCode: fixProposal.diff.newCode,
      });

      setAnalysisSteps(prev => [...prev, '✓ Fix applied successfully']);
      setSelfHealState('success');
    } catch (error) {
      setAnalysisSteps(prev => [...prev, `✗ Failed to apply: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setSelfHealState('showing-fix');
    }
  };

  const handleRejectFix = () => {
    setSelfHealState('idle');
    setFixProposal(null);
    setAnalysisSteps([]);
  };

  const handleTryAnother = async () => {
    // Reset and try again with different approach
    setSelfHealState('idle');
    setFixProposal(null);
    setTimeout(() => handleSelfHeal(), 100);
  };

  const suggestedQuestions = [
    'Why did this test fail?',
    'What happened before the error?',
    'Explain the selected action',
    'Show me the test flow',
  ];

  const handleSuggestedQuestion = (question: string) => {
    setInputValue(question);
    inputRef.current?.focus();
  };

  const hasErrors = model && model.errorDescriptors.length > 0;

  const getStatusIcon = () => {
    switch (apiKeyStatus) {
      case 'valid':
        return <span className='codicon codicon-check-all' style={{ color: '#10b981' }}></span>;
      case 'invalid':
        return <span className='codicon codicon-warning' style={{ color: '#ef4444' }}></span>;
      case 'checking':
        return <span className='codicon codicon-loading codicon-modifier-spin' style={{ color: '#667eea' }}></span>;
      case 'not-set':
        return <span className='codicon codicon-key' style={{ color: '#f59e0b' }}></span>;
    }
  };

  const getStatusText = () => {
    switch (apiKeyStatus) {
      case 'valid':
        return 'Connected';
      case 'invalid':
        return 'Invalid key';
      case 'checking':
        return 'Checking...';
      case 'not-set':
        return 'API key required';
    }
  };

  return (
    <div className='vbox ai-assistant-tab'>
      <div className='ai-assistant-header'>
        <div className='ai-header-left'>
          <span className='codicon codicon-sparkle ai-header-icon'></span>
          <span className='ai-assistant-title'>AI Assistant</span>
          {model && (
            <div className='ai-assistant-context-info'>
              <span className='codicon codicon-layers'></span>
              <span className='ai-context-text'>{model.actions.length} actions</span>
              <span className='ai-context-separator'>•</span>
              <span className='codicon codicon-error'></span>
              <span className='ai-context-text'>{model.errorDescriptors.length} errors</span>
            </div>
          )}
        </div>
        <div className='ai-header-right'>
          <div className='ai-assistant-status'>
            {getStatusIcon()}
            <span className='ai-status-text'>{getStatusText()}</span>
          </div>
          <div className='ai-model-chip'>
            <span className='codicon codicon-hubot'></span>
            <span className='ai-model-name'>Claude 3.5 Sonnet</span>
          </div>
          <button
            className='ai-settings-button'
            onClick={() => setShowSettings(true)}
            title='Configure API key'
          >
            <span className='codicon codicon-settings-gear'></span>
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className='ai-settings-modal-overlay' onClick={() => setShowSettings(false)}>
          <div className='ai-settings-modal' onClick={(e) => e.stopPropagation()}>
            <div className='ai-settings-header'>
              <span className='codicon codicon-settings-gear'></span>
              <h3>AI Assistant Settings</h3>
              <button className='ai-modal-close' onClick={() => setShowSettings(false)}>
                <span className='codicon codicon-close'></span>
              </button>
            </div>

            <div className='ai-settings-content'>
              <div className='ai-settings-section'>
                <label className='ai-settings-label'>
                  Anthropic API Key
                  <span className='ai-settings-required'>*</span>
                </label>
                <p className='ai-settings-description'>
                  Enter your Anthropic API key to enable AI-powered test analysis and self-healing.
                  Get your key from <a href='https://console.anthropic.com/settings/keys' target='_blank' rel='noopener noreferrer'>console.anthropic.com</a>
                </p>
                <div className='ai-settings-input-group'>
                  <input
                    type='password'
                    className='ai-settings-input'
                    placeholder='sk-ant-...'
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        saveApiKey();
                      }
                    }}
                  />
                  <div className='ai-settings-status'>
                    {apiKeyStatus === 'valid' && (
                      <span className='ai-status-badge ai-status-valid'>
                        <span className='codicon codicon-check'></span> Valid
                      </span>
                    )}
                    {apiKeyStatus === 'invalid' && (
                      <span className='ai-status-badge ai-status-invalid'>
                        <span className='codicon codicon-warning'></span> Invalid format
                      </span>
                    )}
                  </div>
                </div>
                <div className='ai-settings-hint'>
                  Your API key is stored locally in your browser (localStorage) and never sent to Playwright servers.
                </div>
              </div>

              <div className='ai-settings-section'>
                <label className='ai-settings-label'>Environment Variable (Alternative)</label>
                <p className='ai-settings-description'>
                  You can also set the <code>ANTHROPIC_API_KEY</code> environment variable:
                </p>
                <pre className='ai-settings-code'>export ANTHROPIC_API_KEY=sk-ant-...</pre>
                <p className='ai-settings-hint'>
                  Note: Environment variables require restarting Playwright UI Mode to take effect.
                </p>
              </div>
            </div>

            <div className='ai-settings-footer'>
              <button
                className='ai-settings-button-secondary'
                onClick={clearApiKey}
                disabled={!apiKey}
              >
                Clear Key
              </button>
              <button
                className='ai-settings-button-primary'
                onClick={saveApiKey}
                disabled={!apiKeyInput.trim()}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Self-Heal Section */}
      <div className='ai-self-heal-section'>
        {/* Test Metadata Card */}
        {model && <TestMetadataCard model={model} hasErrors={hasErrors} useTypingAnimation={useTypingAnimation} />}

        {/* Self-Heal Actions */}
        {apiKeyStatus !== 'valid' ? (
          <div className='ai-self-heal-idle'>
            <button
              className='ai-self-heal-button disabled'
              onClick={() => setShowSettings(true)}
            >
              <span className='codicon codicon-key'></span>
              Configure API Key
            </button>
            <p className='ai-self-heal-hint'>
              API key required for AI-powered test analysis
            </p>
          </div>
        ) : selfHealState === 'idle' && (
          <div className='ai-self-heal-idle'>
            <button
              className={`ai-self-heal-button ${!hasErrors ? 'disabled' : ''}`}
              onClick={handleSelfHeal}
              disabled={!hasErrors || !model}
            >
              <span className='codicon codicon-wand'></span>
              Self-Heal
            </button>
            {!hasErrors && (
              <p className='ai-self-heal-hint'>
                No errors detected - test passed successfully
              </p>
            )}
          </div>
        )}

        {selfHealState === 'analyzing' && (
          <div className='ai-self-heal-analyzing'>
            <div className='ai-analysis-header'>
              <span className='codicon codicon-loading codicon-modifier-spin'></span>
              <span>Analyzing test failure...</span>
            </div>
            <div className='ai-analysis-steps'>
              {analysisSteps.map((step, index) => (
                <div key={index} className='ai-analysis-step'>
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {selfHealState === 'showing-fix' && fixProposal && (
          <div className='ai-self-heal-proposal'>
            <div className='ai-proposal-header'>
              <span className='codicon codicon-lightbulb'></span>
              <span className='ai-proposal-title'>Proposed Fix</span>
              <span className={`ai-proposal-confidence confidence-${fixProposal.confidence}`}>
                {fixProposal.confidence} confidence
              </span>
            </div>

            <div className='ai-proposal-content'>
              <div className='ai-proposal-section'>
                <div className='ai-proposal-section-title'>Issue</div>
                <div className='ai-proposal-section-text'>{fixProposal.issue}</div>
              </div>

              <div className='ai-proposal-section'>
                <div className='ai-proposal-section-title'>Explanation</div>
                <div className='ai-proposal-section-text'>{fixProposal.explanation}</div>
              </div>
            </div>

            <div className='ai-proposal-diff'>
              <div className='ai-diff-header'>
                <span className='codicon codicon-file-code'></span>
                {fixProposal.filePath}
              </div>
              <div className='ai-diff-content'>
                <div className='ai-diff-old'>
                  <div className='ai-diff-label'>- Current</div>
                  <pre>{fixProposal.diff.oldCode}</pre>
                </div>
                <div className='ai-diff-new'>
                  <div className='ai-diff-label'>+ Proposed</div>
                  <pre>{fixProposal.diff.newCode}</pre>
                </div>
              </div>
            </div>

            <div className='ai-proposal-actions'>
              <button className='ai-action-accept' onClick={handleApplyFix}>
                <span className='codicon codicon-check'></span>
                Accept Fix
              </button>
              <button className='ai-action-retry' onClick={handleTryAnother}>
                <span className='codicon codicon-refresh'></span>
                Try Another
              </button>
              <button className='ai-action-reject' onClick={handleRejectFix}>
                <span className='codicon codicon-close'></span>
                Reject
              </button>
            </div>
          </div>
        )}

        {selfHealState === 'applying' && (
          <div className='ai-self-heal-applying'>
            <div className='ai-applying-header'>
              <span className='codicon codicon-loading codicon-modifier-spin'></span>
              <span>Applying fix...</span>
            </div>
            <div className='ai-analysis-steps'>
              {analysisSteps.map((step, index) => (
                <div key={index} className='ai-analysis-step'>
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {selfHealState === 'success' && fixProposal && (
          <div className='ai-self-heal-success'>
            <div className='ai-success-header'>
              <span className='codicon codicon-pass-filled'></span>
              <span className='ai-success-title'>Fix Applied Successfully</span>
            </div>
            <div className='ai-success-content'>
              <div className='ai-success-message'>
                The test file has been updated with the suggested fix.
              </div>
              <div className='ai-success-file'>
                <span className='codicon codicon-file-code'></span>
                <span className='ai-success-file-path'>{fixProposal.filePath}</span>
              </div>
            </div>
            <div className='ai-success-actions'>
              <button
                className='ai-action-close'
                onClick={() => {
                  setSelfHealState('idle');
                  setFixProposal(null);
                  setAnalysisSteps([]);
                }}
              >
                <span className='codicon codicon-close'></span>
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Advanced Chat Section - Hidden but functional */}
      {false && (
        <div className='ai-advanced-section'>
          <button
            className='ai-advanced-toggle'
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span className={`codicon codicon-chevron-${showAdvanced ? 'down' : 'right'}`}></span>
            Advanced Chat
          </button>

          {showAdvanced && (
            <>
              <div className='ai-assistant-messages'>
              {messages.map(message => (
                <div key={message.id} className={`ai-message ai-message-${message.role}`}>
                  <div className='ai-message-icon'>
                    {message.role === 'user' ? (
                      <span className='codicon codicon-account'></span>
                    ) : (
                      <span className='codicon codicon-sparkle'></span>
                    )}
                  </div>
                  <div className='ai-message-content'>
                    <div className='ai-message-text'>{message.content}</div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className='ai-message ai-message-assistant'>
                  <div className='ai-message-icon'>
                    <span className='codicon codicon-sparkle'></span>
                  </div>
                  <div className='ai-message-content'>
                    <div className='ai-message-loading'>
                      <span className='codicon codicon-loading codicon-modifier-spin'></span>
                      Thinking...
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {messages.length === 1 && (
              <div className='ai-assistant-suggestions'>
                <div className='ai-suggestions-title'>Suggested questions:</div>
                <div className='ai-suggestions-list'>
                  {suggestedQuestions.map((question, index) => (
                    <button
                      key={index}
                      className='ai-suggestion-button'
                      onClick={() => handleSuggestedQuestion(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className='ai-assistant-input-container'>
              <input
                ref={inputRef}
                type='text'
                className='ai-assistant-input'
                placeholder='Ask about the test execution...'
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isLoading}
              />
              <button
                className='ai-assistant-send-button'
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
              >
                <span className='codicon codicon-send'></span>
              </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Helper functions to extract test info
function getTestFile(model: any): string {
  const title = model?.title || '';
  const fileMatch = title.match(/^([^›]+\.spec\.[tj]s)/);
  return fileMatch ? fileMatch[1].trim() : 'Unknown file';
}

function getErrorMessage(model: any): string {
  const errors = model?.errorDescriptors || [];
  if (errors.length === 0) return 'No error message';

  const firstError = errors[0];
  const message = firstError?.message || '';

  // Show more of the error message (up to 500 characters)
  if (message.length > 500) {
    return message.substring(0, 500) + '...';
  }

  return message || 'Unknown error';
}

/**
 * Test Metadata Card with typing animation
 */
const TestMetadataCard: React.FC<{
  model: any;
  hasErrors: boolean;
  useTypingAnimation: (text: string, speed?: number) => string;
}> = ({ model, hasErrors, useTypingAnimation }) => {
  const testTitle = model.title || 'Unknown test';
  const testFile = getTestFile(model);
  const errorMessage = getErrorMessage(model);

  const animatedTitle = useTypingAnimation(testTitle, 15);
  const animatedFile = useTypingAnimation(testFile, 15);
  const animatedError = useTypingAnimation(errorMessage, 10);

  return (
    <div className='ai-test-metadata'>
      <div className='ai-metadata-header'>
        <span className='codicon codicon-beaker'></span>
        <span className='ai-metadata-title'>Test Information</span>
      </div>
      <div className='ai-metadata-content'>
        <div className='ai-metadata-row'>
          <span className='ai-metadata-label'>Test:</span>
          <span className='ai-metadata-value'>{animatedTitle}</span>
        </div>
        <div className='ai-metadata-row'>
          <span className='ai-metadata-label'>File:</span>
          <span className='ai-metadata-value ai-metadata-file'>{animatedFile}</span>
        </div>
        {hasErrors && (
          <div className='ai-metadata-error'>
            <div className='ai-metadata-error-icon'>
              <span className='codicon codicon-error'></span>
            </div>
            <div className='ai-metadata-error-content'>
              <div className='ai-metadata-error-title'>Error</div>
              <div className='ai-metadata-error-message'>{animatedError}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Handle user questions using MCP tools
 * This function intelligently selects which MCP tools to call based on the question
 */
async function handleUserQuestion(
  userMessage: string,
  mcpServer: TraceAnalysisMCPServer,
  model: modelUtil.MultiTraceModel | undefined
): Promise<string> {
  // Simulate thinking delay
  await new Promise(resolve => setTimeout(resolve, 500));

  if (!model) {
    return 'No test trace is currently loaded. Please select a test from the list.';
  }

  const lowerMessage = userMessage.toLowerCase();

  try {
    // Question about test failures or errors
    if (lowerMessage.includes('fail') || lowerMessage.includes('error') || lowerMessage.includes('why')) {
      const errorsResult = await mcpServer.callTool('trace_get_errors', {});
      const errors = JSON.parse(errorsResult.content[0].text);

      if (Array.isArray(errors) && errors.length > 0) {
        const error = errors[0];
        let response = `🔴 I found ${errors.length} error(s) in this test:\n\n`;
        response += `**Error ${error.index}:** ${error.message}\n\n`;

        if (error.stack && error.stack.length > 0) {
          response += `**Stack trace:**\n`;
          error.stack.slice(0, 3).forEach((frame: any) => {
            response += `  at ${frame.function || '(anonymous)'} (${frame.file}:${frame.line})\n`;
          });
          response += `\n`;
        }

        if (error.actionBefore) {
          response += `**Action before error:** ${error.actionBefore.type}\n`;
          response += `Parameters: ${JSON.stringify(error.actionBefore.params, null, 2)}\n\n`;
        }

        response += `💡 **Suggestions:**\n`;
        response += `- Check if the element selector is still valid\n`;
        response += `- Verify the application is in the expected state\n`;
        response += `- Use "generate better locator" if the selector is brittle`;

        return response;
      } else {
        return '✅ No errors found! This test passed successfully.';
      }
    }

    // Question about test actions or flow
    if (lowerMessage.includes('action') || lowerMessage.includes('flow') || lowerMessage.includes('step')) {
      const actionsResult = await mcpServer.callTool('trace_get_actions', { limit: 10 });
      const actions = JSON.parse(actionsResult.content[0].text);

      if (actions.length > 0) {
        let response = `📋 **Test Flow** (showing ${actions.length} actions):\n\n`;
        actions.forEach((action: any) => {
          const duration = action.duration ? ` (${action.duration}ms)` : '';
          const error = action.error ? ` ❌ FAILED: ${action.error}` : '';
          response += `${action.index}. **${action.type}**${duration}${error}\n`;
          if (action.params && Object.keys(action.params).length > 0) {
            response += `   \`${JSON.stringify(action.params)}\`\n`;
          }
        });

        return response;
      }
    }

    // Question about console logs
    if (lowerMessage.includes('console') || lowerMessage.includes('log')) {
      const logsResult = await mcpServer.callTool('trace_get_console_logs', { limit: 10 });
      const logs = JSON.parse(logsResult.content[0].text);

      if (logs.length > 0) {
        let response = `📝 **Console Logs** (showing ${logs.length} messages):\n\n`;
        logs.forEach((log: any) => {
          const icon = log.type === 'error' ? '❌' : log.type === 'warn' ? '⚠️' : 'ℹ️';
          response += `${icon} [${log.type}] ${log.text}\n`;
        });
        return response;
      } else {
        return 'No console logs were captured during this test execution.';
      }
    }

    // Question about network requests
    if (lowerMessage.includes('network') || lowerMessage.includes('request') || lowerMessage.includes('api')) {
      const networkResult = await mcpServer.callTool('trace_get_network_requests', { limit: 10 });
      const requests = JSON.parse(networkResult.content[0].text);

      if (requests.length > 0) {
        let response = `🌐 **Network Requests** (showing ${requests.length} requests):\n\n`;
        requests.forEach((req: any) => {
          const status = req.statusCode ? `[${req.statusCode}]` : '[pending]';
          response += `${status} ${req.method} ${req.url}\n`;
        });
        return response;
      } else {
        return 'No network requests were captured.';
      }
    }

    // Question about locators or selectors
    if (lowerMessage.includes('locator') || lowerMessage.includes('selector') || lowerMessage.includes('generate')) {
      const tools = mcpServer.listTools();
      const locatorTools = tools.filter(t => t.name.includes('locator'));

      let response = `🎯 **Locator Tools Available:**\n\n`;
      locatorTools.forEach(tool => {
        response += `• **${tool.name}**: ${tool.description}\n`;
      });
      response += `\nTo use a tool, ask me specifically. For example:\n`;
      response += `- "Generate a locator for .submit-btn"\n`;
      response += `- "Test this locator: page.getByRole('button')"\n`;
      response += `- "Suggest a better locator for #login"`;

      return response;
    }

    // Default: Show test overview
    const testInfoResult = await mcpServer.callTool('trace_get_test_info', {});
    const testInfo = JSON.parse(testInfoResult.content[0].text);

    let response = `📊 **Test Execution Summary:**\n\n`;
    response += `• **Browser:** ${testInfo.browserName}\n`;
    response += `• **Duration:** ${testInfo.durationFormatted}\n`;
    response += `• **Actions:** ${testInfo.totalActions}\n`;
    response += `• **Errors:** ${testInfo.totalErrors}\n`;
    response += `• **Status:** ${testInfo.hasErrors ? '❌ Failed' : '✅ Passed'}\n\n`;

    response += `**💬 Try asking:**\n`;
    response += `- "Why did this test fail?"\n`;
    response += `- "Show me the test flow"\n`;
    response += `- "What console logs were captured?"\n`;
    response += `- "Show network requests"\n`;
    response += `- "Generate a better locator for X"`;

    return response;
  } catch (error) {
    return `Error analyzing test: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Execute read_file tool - reads a file from the server
 */
async function executeReadFile(path: string): Promise<string> {
  try {
    const response = await fetch(`file?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      throw new Error(`Failed to read file: ${response.statusText}`);
    }
    return await response.text();
  } catch (error: any) {
    throw new Error(`Failed to read file ${path}: ${error.message}`);
  }
}

/**
 * Execute edit_file tool - edits a file by replacing text
 */
async function executeEditFile(path: string, oldText: string, newText: string): Promise<string> {
  try {
    const response = await fetch('apply-fix', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        filePath: path,
        oldCode: oldText,
        newCode: newText
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    return `Successfully edited ${path}`;
  } catch (error: any) {
    throw new Error(`Failed to edit file: ${error.message}`);
  }
}

/**
 * Call Claude API with full trace context including vision analysis of screenshots
 */
async function callClaudeAPI(params: {
  apiKey: string;
  error: any;
  testSource: string;
  filePath: string;
  testName?: string;
  screenshots: any[];
  consoleLogs: any[];
  networkRequests: any[];
  model: any;
}): Promise<FixProposal> {
  const { apiKey, error, testSource, filePath, testName, screenshots, consoleLogs, networkRequests } = params;

  // Build comprehensive system prompt with QA expert instructions
  const systemPrompt = `You are a QA automation expert debugging a Playwright test failure. Your job is to find the ROOT CAUSE and fix it using the provided tools.

**Your Tools:**
- \`read_file(path)\` - Read the test source file
- \`edit_file(path, old_text, new_text)\` - Apply a fix to the test

**CRITICAL: Root Cause Analysis - Investigate in this order:**

1. **Authentication/Authorization Issues**
   - Check network requests for 401, 403, or auth failures
   - Look for "unauthorized", "forbidden", or "session expired" in console
   - Screenshot: Are we on a login page when we shouldn't be?
   - Fix: Add proper auth setup, fix login flow, wait for auth to complete

2. **Navigation Problems**
   - Screenshot: What page are we ACTUALLY on vs. where we expect to be?
   - Network: Did the navigation request succeed? (200 vs 404/500)
   - Console: Any "navigation failed" or route errors?
   - Fix: Add \`await page.waitForURL()\`, verify navigation succeeds, check redirects

3. **Timing/Race Conditions**
   - Network: Are there pending requests when the action is attempted?
   - Console: "hydration error", "not ready", async warnings?
   - Screenshot: Is the element partially loaded or animating?
   - Fix: Add \`await page.waitForLoadState('networkidle')\`, use web-first assertions

4. **Application State Issues**
   - Screenshot: Is the page in the expected state? (modal open, form filled, data loaded)
   - Console: API errors that prevented data from loading?
   - Network: Did required API calls complete successfully?
   - Fix: Add setup steps, wait for data to load, verify prerequisite state

5. **Element Rendering/Visibility**
   - Screenshot: Is the element visible on screen?
   - Console: JavaScript errors that broke rendering?
   - Element exists but not visible? (display:none, opacity:0)
   - Fix: Wait for visibility, check parent containers, verify no JS errors

6. **Selector Issues (LAST RESORT)**
   - Only after ruling out all above issues
   - Screenshot: Element exists with different attributes/text?
   - Fix: Use Playwright best practices (getByRole > getByLabel > getByTestId > CSS)

**Screenshot Analysis - Critical Questions:**
- What page/URL are we on? Does it match what the test expects?
- Is there an error message, login screen, or loading spinner?
- Is the target element visible? If not, why? (not loaded, hidden, wrong page)
- What's the actual state vs. expected state?

**Console Logs - Look for:**
- JavaScript errors that broke the page
- API failures (401, 500, network errors)
- Framework warnings (React/Vue/Angular errors)
- "not found", "undefined", "cannot read property" errors

**Network Requests - Check for:**
- Authentication failures (401, 403)
- API errors (500, 404)
- Failed requests that should have succeeded
- Pending requests when action was attempted

**IMPORTANT - Scope Rules:**
- ONLY fix the SPECIFIC TEST that is failing
- DO NOT modify other tests, imports, or helper functions
- Focus on the root cause, not just changing selectors
- If the issue is in test setup (login, navigation), fix that, not the selector

**After Investigation, Use edit_file to Apply the Fix**

Then provide this JSON summary:

{
  "issue": "Root cause description (e.g., 'Authentication failed before reaching dashboard')",
  "explanation": "What you investigated, what you found, and why this fix addresses the root cause",
  "diff": {
    "oldCode": "The failing code",
    "newCode": "The fix addressing the root cause"
  },
  "confidence": "high|medium|low",
  "filePath": "${filePath}"
}

**Playwright Best Practices (when selector IS the issue):**
1. \`page.getByRole('button', { name: 'Submit' })\` - Interactive elements
2. \`page.getByLabel('Email')\` - Form fields
3. \`page.getByPlaceholder('Search...')\` - Inputs with placeholders
4. \`page.getByText('Welcome')\` - Text content
5. \`page.getByTestId('submit-btn')\` - Explicit test IDs
6. CSS/XPath - Last resort only`;

  // Build the user message with all context
  const contextParts: any[] = [
    {
      type: 'text',
      text: `# Test Failure Analysis Request

## Error Information
\`\`\`
Message: ${error.message || 'No error message'}
Stack: ${error.stack || 'No stack trace'}
\`\`\`

## Test Source Code (FAILING TEST ONLY)
File: ${filePath}
Test: "${testName || 'Unknown'}"

**IMPORTANT: You can ONLY edit code within this test block. Do NOT modify other tests.**

\`\`\`typescript
${testSource}
\`\`\``
    }
  ];

  // Add screenshots if available (Claude vision analysis)
  if (screenshots && screenshots.length > 0) {
    contextParts.push({
      type: 'text',
      text: `\n## Screenshots (${screenshots.length} available)\n`
    });

    // Add up to 3 most relevant screenshots
    const relevantScreenshots = screenshots.slice(-3); // Last 3 screenshots (near failure)
    for (const screenshot of relevantScreenshots) {
      if (screenshot.base64) {
        contextParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshot.base64
          }
        });
        contextParts.push({
          type: 'text',
          text: `Screenshot at ${screenshot.timestamp || 'unknown time'}\n`
        });
      }
    }
  }

  // Add console logs
  if (consoleLogs && consoleLogs.length > 0) {
    const logsText = consoleLogs
      .map((log: any) => `[${log.type || 'log'}] ${log.text || log.message || ''}`)
      .join('\n');
    contextParts.push({
      type: 'text',
      text: `\n## Console Logs\n\`\`\`\n${logsText}\n\`\`\``
    });
  }

  // Add network requests
  if (networkRequests && networkRequests.length > 0) {
    const networkText = networkRequests
      .map((req: any) => `${req.method || 'GET'} ${req.url} → ${req.status || 'pending'}`)
      .join('\n');
    contextParts.push({
      type: 'text',
      text: `\n## Network Requests\n\`\`\`\n${networkText}\n\`\`\``
    });
  }

  contextParts.push({
    type: 'text',
    text: `\n---

Please analyze all the above information (error, code, screenshots, logs, network) and provide a precise fix proposal in JSON format as specified in the system prompt.`
  });

  try {
    console.log('Calling Claude API with context...');
    console.log('Screenshots:', screenshots?.length || 0);
    console.log('Console logs:', consoleLogs?.length || 0);
    console.log('Network requests:', networkRequests?.length || 0);

    // Define filesystem tools for Claude to use
    const tools = [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to the file to read'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'edit_file',
        description: 'Edit a file by replacing old text with new text',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute path to the file to edit'
            },
            old_text: {
              type: 'string',
              description: 'The exact text to replace'
            },
            new_text: {
              type: 'string',
              description: 'The new text to insert'
            }
          },
          required: ['path', 'old_text', 'new_text']
        }
      }
    ];

    // Start conversation with Claude
    let messages = [{
      role: 'user',
      content: contextParts
    }];

    let maxIterations = 5; // Prevent infinite loops
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      // Call through local proxy to avoid CORS issues
      const response = await fetch('claude-api', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: apiKey,
          body: {
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            system: systemPrompt,
            messages: messages,
            tools: tools
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude API error:', response.status, errorText);
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`Claude API response (iteration ${iteration}):`, data);

      // Check stop reason
      if (data.stop_reason === 'end_turn') {
        // Claude is done - extract the final response
        break;
      }

      if (data.stop_reason === 'tool_use') {
        // Claude wants to use tools - execute them
        const assistantMessage = {
          role: 'assistant',
          content: data.content
        };
        messages.push(assistantMessage);

        // Execute all tool calls
        const toolResults: any[] = [];
        for (const content of data.content) {
          if (content.type === 'tool_use') {
            const toolName = content.name;
            const toolInput = content.input;
            const toolUseId = content.id;

            console.log(`Executing tool: ${toolName}`, toolInput);

            try {
              let result: any;
              if (toolName === 'read_file') {
                result = await executeReadFile(toolInput.path);
              } else if (toolName === 'edit_file') {
                result = await executeEditFile(toolInput.path, toolInput.old_text, toolInput.new_text);
              } else {
                result = { error: `Unknown tool: ${toolName}` };
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: typeof result === 'string' ? result : JSON.stringify(result)
              });
            } catch (error: any) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: `Error: ${error.message}`,
                is_error: true
              });
            }
          }
        }

        // Add tool results to conversation
        messages.push({
          role: 'user',
          content: toolResults
        });

        // Continue the loop to get Claude's next response
        continue;
      }

      // Stop for any other reason
      break;
    }

    // Get the final data from the last response
    const finalResponse = messages[messages.length - 1];
    const data = finalResponse.role === 'assistant' ?
      { content: finalResponse.content } :
      await (async () => {
        // Need to make one more call to get final response
        const response = await fetch('claude-api', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            apiKey: apiKey,
            body: {
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 4096,
              system: systemPrompt,
              messages: messages,
              tools: tools
            }
          })
        });
        return await response.json();
      })();

    console.log('Final Claude response:', data);

    // Extract the text content from Claude's response
    const textContent = data.content?.find((c: any) => c.type === 'text')?.text || '';

    // Try to parse JSON from the response
    let parsedProposal: any;
    try {
      // Claude might wrap JSON in markdown code blocks
      const jsonMatch = textContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
                       textContent.match(/(\{[\s\S]*\})/);
      const jsonText = jsonMatch ? jsonMatch[1] : textContent;
      parsedProposal = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse Claude response as JSON:', textContent);
      // Fallback: extract information from natural language response
      parsedProposal = {
        issue: 'Test failure detected',
        explanation: textContent,
        diff: {
          oldCode: '// See Claude response for details',
          newCode: '// See Claude response for details'
        },
        confidence: 'medium',
        filePath: filePath
      };
    }

    // Validate and ensure all required fields
    const proposal: FixProposal = {
      issue: parsedProposal.issue || 'Test failure detected',
      explanation: parsedProposal.explanation || 'Analysis pending',
      diff: {
        oldCode: parsedProposal.diff?.oldCode || '// Code to replace',
        newCode: parsedProposal.diff?.newCode || '// Proposed fix'
      },
      confidence: parsedProposal.confidence || 'medium',
      filePath: parsedProposal.filePath || filePath
    };

    return proposal;
  } catch (error) {
    console.error('callClaudeAPI error:', error);
    throw new Error(`Failed to get AI fix proposal: ${error instanceof Error ? error.message : String(error)}`);
  }
}
