// Simple state store (no external dependencies)
export type TabId = 'steps' | 'pom' | 'business' | 'test' | 'network' | 'console';
export type ModelId = 'haiku' | 'opus';

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
}

export interface ConsoleMessage {
  type: 'log' | 'error' | 'warn' | 'info';
  text: string;
}

export interface AppState {
  activeTab: TabId;
  selectedModel: ModelId;
  isRunning: boolean;
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
}

type Listener = () => void;

class Store {
  private state: AppState = {
    activeTab: 'steps',
    selectedModel: 'haiku',
    isRunning: false,
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
    this.setState({ isRunning: running });
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

  addConsoleMessage(msg: ConsoleMessage) {
    const consoleMessages = [...this.state.consoleMessages.slice(-100), msg];
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
    });
  }
}

export const store = new Store();
