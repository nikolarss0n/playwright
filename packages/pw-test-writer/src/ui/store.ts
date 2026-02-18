import type { ActionCapture, NetworkRequestCapture } from 'playwright-core/lib/server/actionCaptureTypes';

// Re-export for consumers that import these from store
export type { ActionCapture, NetworkRequestCapture } from 'playwright-core/lib/server/actionCaptureTypes';

export type { HistoryEntry, TestHistory } from '../runner/history.js';
export type { DiffLine } from '../ai/diff.js';

// Simple state store (no external dependencies)
export type TabId = 'steps' | 'pom' | 'business' | 'test' | 'network' | 'console' | 'tests';
export type ModelId = 'haiku' | 'opus';
export type AppMode = 'write' | 'run';

export interface Step {
  id: number;
  action: string;
  status: 'pending' | 'running' | 'done' | 'error';
  details?: string;
}

export interface NetworkRequest {
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
}

export interface ConsoleMessage {
  type: 'log' | 'error' | 'warn' | 'info';
  text: string;
  timestamp: number;
  location?: { url: string; lineNumber: number; columnNumber: number };
}

// Test file discovery
export interface TestFile {
  path: string;
  relativePath: string;
  tests: TestCase[];
}

export interface TestCase {
  title: string;
  line: number;
  fullTitle: string;
}

export interface TestAttachment {
  name: string;
  path: string;
  contentType: string;
}

export interface TestResult {
  file: string;
  test: string;
  testKey: string;  // file:line key for matching
  status: 'passed' | 'failed' | 'skipped' | 'running';
  duration: number;
  actions: ActionCapture[];
  error?: string;
  attachments?: TestAttachment[];
}

export type PanelFocus = 'tests' | 'actions';
export type ActionDetailFocus = 'actions' | 'network' | 'console';

// Progress tracking for live status updates
export interface ProgressState {
  currentAction: string | null;       // Action being executed (e.g., "click button")
  actionStartTime: number | null;     // When current action started
  testStartTime: number | null;       // When current test started
  testTimeoutMs: number;              // Test timeout in ms (default 120000)
  waitingFor: string | null;          // What we're waiting for (e.g., "navigation", "element")
  actionProgress: number;             // 0-100 progress within action (for long operations)
}

export interface AppState {
  mode: AppMode;
  activeTab: TabId;
  selectedModel: ModelId;
  isRunning: boolean;
  stopRequested: boolean;  // Flag to stop running tests
  status: string;
  task: string;
  baseURL: string;
  configPath: string | null;
  steps: Step[];
  pomCode: string;
  businessCode: string;
  testCode: string;
  networkRequests: NetworkRequest[];
  consoleMessages: ConsoleMessage[];
  // Test runner state
  testFiles: TestFile[];
  selectedTests: Record<string, boolean>;  // Use object instead of Set for proper state updates
  testResults: TestResult[];
  currentTestActions: ActionCapture[];
  testSelectionIndex: number;  // Track selection index in store
  // Progress tracking
  progress: ProgressState;
  // Split-pane state for actions panel
  panelFocus: PanelFocus;       // Which panel has focus
  actionScrollIndex: number;    // Selected action in actions panel
  expandedActionIndex: number;  // Expanded action (-1 for none)
  // Network detail drill-down
  actionDetailFocus: ActionDetailFocus;  // What's focused within expanded action
  networkScrollIndex: number;   // Selected network request within action
  expandedNetworkIndex: number; // Expanded network request (-1 for none)
  responseScrollOffset: number; // Scroll offset for expanded response body
  consoleScrollIndex: number;   // Selected console message within action
  // Test filter
  testFilter: string;
  testFilterActive: boolean;
  // AI assistant
  aiPrompt: string;             // Current AI prompt input
  aiResponse: string;           // AI response/suggestion
  aiLoading: boolean;           // Whether AI is processing
  aiStatusText: string;         // Dynamic status during AI tool use (e.g. "Reading playwright.config.ts...")
  showAiPanel: boolean;         // Whether AI panel is visible
  aiCodeDiff: import('../ai/diff.js').DiffLine[] | null;  // Computed diff lines
  aiDiffFilePath: string | null;  // File being modified
  aiDiffScrollIndex: number;      // Scroll offset for diff view
  // Test history
  testHistory: Record<string, import('../runner/history.js').HistoryEntry[]>;
}

type Listener = () => void;

class Store {
  private state: AppState = {
    mode: 'run',
    activeTab: 'tests',
    selectedModel: 'haiku',
    isRunning: false,
    stopRequested: false,
    status: 'Ready',
    task: '',
    baseURL: '',
    configPath: null,
    steps: [],
    pomCode: '',
    businessCode: '',
    testCode: '',
    networkRequests: [],
    consoleMessages: [],
    // Test runner state
    testFiles: [],
    selectedTests: {},
    testResults: [],
    currentTestActions: [],
    testSelectionIndex: 0,
    // Progress tracking
    progress: {
      currentAction: null,
      actionStartTime: null,
      testStartTime: null,
      testTimeoutMs: 120000,  // 2 minutes default
      waitingFor: null,
      actionProgress: 0,
    },
    // Split-pane state
    panelFocus: 'tests',
    actionScrollIndex: 0,
    expandedActionIndex: -1,
    // Network detail state
    actionDetailFocus: 'actions',
    networkScrollIndex: 0,
    expandedNetworkIndex: -1,
    responseScrollOffset: 0,
    consoleScrollIndex: 0,
    // Test filter
    testFilter: '',
    testFilterActive: false,
    // AI assistant
    aiPrompt: '',
    aiResponse: '',
    aiLoading: false,
    aiStatusText: '',
    showAiPanel: false,
    aiCodeDiff: null,
    aiDiffFilePath: null,
    aiDiffScrollIndex: 0,
    // Test history
    testHistory: {},
  };

  private listeners: Set<Listener> = new Set();

  getState(): AppState {
    return this.state;
  }

  setState(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  // Actions
  setActiveTab(tab: TabId) {
    this.setState({ activeTab: tab });
  }

  setSelectedModel(model: ModelId) {
    this.setState({ selectedModel: model });
  }

  setIsRunning(running: boolean) {
    this.setState({ isRunning: running, stopRequested: false });
  }

  requestStop() {
    this.setState({ stopRequested: true });
  }

  isStopRequested(): boolean {
    return this.state.stopRequested;
  }

  setStatus(status: string) {
    this.setState({ status });
  }

  setTask(task: string) {
    this.setState({ task });
  }

  setBaseURL(baseURL: string) {
    this.setState({ baseURL });
  }

  setConfigPath(configPath: string | null) {
    this.setState({ configPath });
  }

  addStep(action: string): number {
    const id = Date.now();
    const steps = [...this.state.steps, { id, action, status: 'pending' as const }];
    this.setState({ steps });
    return id;
  }

  updateStep(id: number, status: Step['status'], details?: string) {
    const steps = this.state.steps.map(s =>
      s.id === id ? { ...s, status, details } : s
    );
    this.setState({ steps });
  }

  setPomCode(code: string) {
    this.setState({ pomCode: code });
  }

  setBusinessCode(code: string) {
    this.setState({ businessCode: code });
  }

  setTestCode(code: string) {
    this.setState({ testCode: code });
  }

  addNetworkRequest(req: NetworkRequest) {
    const networkRequests = [...this.state.networkRequests.slice(-50), req];
    this.setState({ networkRequests });
  }

  addConsoleMessage(msg: Omit<ConsoleMessage, 'timestamp'> & { timestamp?: number }) {
    const consoleMessages = [...this.state.consoleMessages.slice(-100), { ...msg, timestamp: msg.timestamp ?? Date.now() }];
    this.setState({ consoleMessages });
  }

  reset() {
    this.setState({
      isRunning: false,
      status: 'Ready',
      task: '',
      steps: [],
      networkRequests: [],
      consoleMessages: [],
    });
  }

  // Reset for new task but keep generated code for reference
  resetForNewTask() {
    this.setState({
      isRunning: false,
      status: 'Ready',
      task: '',
      steps: [],
      networkRequests: [],
      consoleMessages: [],
    });
  }

  // Full reset including generated code
  fullReset() {
    this.setState({
      isRunning: false,
      status: 'Ready',
      task: '',
      steps: [],
      pomCode: '',
      businessCode: '',
      testCode: '',
      networkRequests: [],
      consoleMessages: [],
      testResults: [],
      currentTestActions: [],
      aiCodeDiff: null,
      aiDiffFilePath: null,
      aiDiffScrollIndex: 0,
    });
  }

  clearAiDiff() {
    this.setState({ aiCodeDiff: null, aiDiffFilePath: null, aiDiffScrollIndex: 0 });
  }

  setAiDiffScrollIndex(index: number) {
    this.setState({ aiDiffScrollIndex: Math.max(0, index) });
  }

  // Mode switching
  setMode(mode: AppMode) {
    this.setState({
      mode,
      activeTab: mode === 'run' ? 'tests' : 'steps',
    });
  }

  // Test runner actions
  setTestFiles(testFiles: TestFile[]) {
    this.setState({ testFiles });
  }

  toggleTestSelection(testKey: string) {
    const selectedTests = { ...this.state.selectedTests };
    if (selectedTests[testKey]) {
      delete selectedTests[testKey];
    } else {
      selectedTests[testKey] = true;
    }
    this.setState({ selectedTests });
  }

  selectAllTests() {
    const selectedTests: Record<string, boolean> = {};
    for (const file of this.state.testFiles) {
      for (const test of file.tests) {
        selectedTests[`${file.path}:${test.line}`] = true;
      }
    }
    this.setState({ selectedTests });
  }

  clearTestSelection() {
    this.setState({ selectedTests: {} });
  }

  setTestSelectionIndex(index: number) {
    this.setState({ testSelectionIndex: index });
  }

  getSelectedTestCount(): number {
    return Object.keys(this.state.selectedTests).length;
  }

  isTestSelected(key: string): boolean {
    return !!this.state.selectedTests[key];
  }

  addTestResult(result: TestResult) {
    // Update existing or add new
    const existingIndex = this.state.testResults.findIndex(r => r.testKey === result.testKey);
    if (existingIndex >= 0) {
      const testResults = [...this.state.testResults];
      testResults[existingIndex] = result;
      this.setState({ testResults });
    } else {
      const testResults = [...this.state.testResults, result];
      this.setState({ testResults });
    }
  }

  getTestResult(testKey: string): TestResult | undefined {
    return this.state.testResults.find(r => r.testKey === testKey);
  }

  setTestRunning(testKey: string, file: string, test: string) {
    this.addTestResult({
      file,
      test,
      testKey,
      status: 'running',
      duration: 0,
      actions: [],
    });
  }

  addActionCapture(capture: ActionCapture) {
    const currentTestActions = [...this.state.currentTestActions, capture];

    // Also update the running test result's actions so the UI can display them live
    const testResults = [...this.state.testResults];
    const runningIdx = testResults.findIndex(r => r.status === 'running');
    if (runningIdx >= 0) {
      testResults[runningIdx] = {
        ...testResults[runningIdx],
        actions: currentTestActions,
      };
    }

    this.setState({ currentTestActions, testResults });

    // Also add to network requests and console for display in those tabs
    for (const req of capture.network.requests) {
      this.addNetworkRequest({
        method: req.method,
        url: req.url,
        status: req.status ?? undefined,
        durationMs: req.durationMs,
      });
    }
    for (const msg of capture.console) {
      this.addConsoleMessage({
        type: msg.type as ConsoleMessage['type'],
        text: msg.text,
        location: msg.location,
      });
    }
  }

  clearCurrentTestActions() {
    this.setState({ currentTestActions: [] });
  }

  resetTestRunner() {
    this.setState({
      testResults: [],
      currentTestActions: [],
      networkRequests: [],
      consoleMessages: [],
      steps: [],
      actionScrollIndex: 0,
      expandedActionIndex: -1,
    });
  }

  // Split-pane actions
  setPanelFocus(focus: PanelFocus) {
    this.setState({ panelFocus: focus });
  }

  setActionScrollIndex(index: number) {
    this.setState({ actionScrollIndex: index });
  }

  toggleExpandedAction(index: number) {
    const current = this.state.expandedActionIndex;
    this.setState({ expandedActionIndex: current === index ? -1 : index });
  }

  setExpandedActionIndex(index: number) {
    this.setState({ expandedActionIndex: index });
  }

  // Network detail actions
  setActionDetailFocus(focus: ActionDetailFocus) {
    this.setState({ actionDetailFocus: focus });
  }

  setNetworkScrollIndex(index: number) {
    this.setState({ networkScrollIndex: index });
  }

  toggleExpandedNetwork(index: number) {
    const current = this.state.expandedNetworkIndex;
    this.setState({ expandedNetworkIndex: current === index ? -1 : index, responseScrollOffset: 0 });
  }

  setExpandedNetworkIndex(index: number) {
    this.setState({ expandedNetworkIndex: index, responseScrollOffset: 0 });
  }

  setResponseScrollOffset(offset: number) {
    this.setState({ responseScrollOffset: Math.max(0, offset) });
  }

  setConsoleScrollIndex(index: number) {
    this.setState({ consoleScrollIndex: index });
  }

  // Reset network detail state when changing actions
  resetNetworkDetail() {
    this.setState({
      actionDetailFocus: 'actions',
      networkScrollIndex: 0,
      expandedNetworkIndex: -1,
      responseScrollOffset: 0,
      consoleScrollIndex: 0,
    });
  }

  // AI assistant actions
  setAiPrompt(prompt: string) {
    this.setState({ aiPrompt: prompt });
  }

  setAiResponse(response: string) {
    this.setState({ aiResponse: response, ...(response === '' ? { aiCodeDiff: null, aiDiffFilePath: null, aiDiffScrollIndex: 0, aiStatusText: '' } : {}) });
  }

  setAiLoading(loading: boolean) {
    this.setState({ aiLoading: loading, ...(loading ? {} : { aiStatusText: '' }) });
  }

  setAiStatusText(text: string) {
    this.setState({ aiStatusText: text });
  }

  toggleAiPanel() {
    this.setState({ showAiPanel: !this.state.showAiPanel });
  }

  showAi() {
    this.setState({ showAiPanel: true, aiPrompt: '', aiResponse: '' });
  }

  hideAi() {
    this.setState({ showAiPanel: false });
  }

  // Progress tracking actions
  setCurrentAction(action: string | null) {
    this.setState({
      progress: {
        ...this.state.progress,
        currentAction: action,
        actionStartTime: action ? Date.now() : null,
        waitingFor: null,
        actionProgress: 0,
      },
    });
  }

  setWaitingFor(waiting: string | null) {
    this.setState({
      progress: {
        ...this.state.progress,
        waitingFor: waiting,
      },
    });
  }

  setActionProgress(percent: number) {
    this.setState({
      progress: {
        ...this.state.progress,
        actionProgress: Math.min(100, Math.max(0, percent)),
      },
    });
  }

  startTestTimer() {
    this.setState({
      progress: {
        ...this.state.progress,
        testStartTime: Date.now(),
        currentAction: null,
        actionStartTime: null,
        waitingFor: null,
        actionProgress: 0,
      },
    });
  }

  clearTestTimer() {
    this.setState({
      progress: {
        ...this.state.progress,
        testStartTime: null,
        currentAction: null,
        actionStartTime: null,
        waitingFor: null,
        actionProgress: 0,
      },
    });
  }

  getElapsedTestTime(): number {
    const { testStartTime } = this.state.progress;
    if (!testStartTime) return 0;
    return Date.now() - testStartTime;
  }

  getRemainingTestTime(): number {
    const { testStartTime, testTimeoutMs } = this.state.progress;
    if (!testStartTime) return testTimeoutMs;
    const elapsed = Date.now() - testStartTime;
    return Math.max(0, testTimeoutMs - elapsed);
  }

  getElapsedActionTime(): number {
    const { actionStartTime } = this.state.progress;
    if (!actionStartTime) return 0;
    return Date.now() - actionStartTime;
  }
}

export const store = new Store();
