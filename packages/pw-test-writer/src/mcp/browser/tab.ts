import { EventEmitter } from 'events';
import type * as playwright from 'playwright-core';

import { computeSnapshotDiff } from './snapshotDiff.js';
import { createEmptyActionCapture, formatNetworkSummary } from './actionCapture.js';
import type { PageEx, ModalState, ConsoleMessage, TabSnapshot, McpActionCapture, NetworkRequest } from './types.js';

const NAV_TIMEOUT = 30000;
const ACTION_TIMEOUT = 5000;

export const TabEvents = {
  modalState: 'modalState'
};

export type TabEventsInterface = {
  [TabEvents.modalState]: [modalState: ModalState];
};

export class Tab extends EventEmitter<TabEventsInterface> {
  readonly page: playwright.Page;
  private _consoleMessages: ConsoleMessage[] = [];
  private _recentConsoleMessages: ConsoleMessage[] = [];
  private _requests: Set<playwright.Request> = new Set();
  private _onPageClose: (tab: Tab) => void;
  private _modalStates: ModalState[] = [];
  private _initializedPromise: Promise<void>;

  constructor(page: playwright.Page, onPageClose: (tab: Tab) => void) {
    super();
    this.page = page;
    this._onPageClose = onPageClose;
    page.on('console', event => this._handleConsoleMessage(messageToConsoleMessage(event)));
    page.on('pageerror', error => this._handleConsoleMessage(pageErrorToConsoleMessage(error)));
    page.on('request', request => this._requests.add(request));
    page.on('close', () => this._onClose());
    page.on('dialog', dialog => this._dialogShown(dialog));
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.setDefaultTimeout(ACTION_TIMEOUT);
    (page as any)[tabSymbol] = this;
    this._initializedPromise = this._initialize();
  }

  static forPage(page: playwright.Page): Tab | undefined {
    return (page as any)[tabSymbol];
  }

  private async _initialize() {
    const requests = await this.page.requests().catch(() => []);
    for (const request of requests)
      this._requests.add(request);
  }

  modalStates(): ModalState[] {
    return this._modalStates;
  }

  setModalState(modalState: ModalState) {
    this._modalStates.push(modalState);
    this.emit(TabEvents.modalState, modalState);
  }

  clearModalState(modalState: ModalState) {
    this._modalStates = this._modalStates.filter(state => state !== modalState);
  }

  modalStatesMarkdown(): string[] {
    const result: string[] = ['### Modal state'];
    if (this._modalStates.length === 0)
      result.push('- There is no modal state present');
    for (const state of this._modalStates)
      result.push(`- [${state.description}]: can be handled by the "${state.clearedBy}" tool`);
    return result;
  }

  private _dialogShown(dialog: playwright.Dialog) {
    this.setModalState({
      type: 'dialog',
      description: `"${dialog.type()}" dialog with message "${dialog.message()}"`,
      dialog,
      clearedBy: 'browser_press_key',
    });
  }

  private _clearCollectedArtifacts() {
    this._consoleMessages.length = 0;
    this._recentConsoleMessages.length = 0;
    this._requests.clear();
  }

  private _handleConsoleMessage(message: ConsoleMessage) {
    this._consoleMessages.push(message);
    this._recentConsoleMessages.push(message);
  }

  private _onClose() {
    this._clearCollectedArtifacts();
    this._onPageClose(this);
  }

  async navigate(url: string) {
    this._clearCollectedArtifacts();

    const downloadEvent = this.page.waitForEvent('download').catch(() => {});
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (_e: unknown) {
      const e = _e as Error;
      const mightBeDownload =
        e.message.includes('net::ERR_ABORTED')
        || e.message.includes('Download is starting');
      if (!mightBeDownload)
        throw e;
      const download = await Promise.race([
        downloadEvent,
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
      if (!download)
        throw e;
      await new Promise(resolve => setTimeout(resolve, 500));
      return;
    }

    await this.page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
  }

  async consoleMessages(type?: 'error'): Promise<ConsoleMessage[]> {
    await this._initializedPromise;
    return this._consoleMessages.filter(message => type ? message.type === type : true);
  }

  async captureSnapshot(): Promise<TabSnapshot> {
    let tabSnapshot: TabSnapshot | undefined;
    const modalStates = await this._raceAgainstModalStates(async () => {
      const snapshot = await (this.page as unknown as PageEx)._snapshotForAI();
      tabSnapshot = {
        url: this.page.url(),
        title: await this.page.title(),
        ariaSnapshot: snapshot,
        modalStates: [],
        consoleMessages: [],
      };
    });
    if (tabSnapshot) {
      tabSnapshot.consoleMessages = this._recentConsoleMessages;
      this._recentConsoleMessages = [];
    }
    return tabSnapshot ?? {
      url: this.page.url(),
      title: '',
      ariaSnapshot: '',
      modalStates,
      consoleMessages: [],
    };
  }

  private _javaScriptBlocked(): boolean {
    return this._modalStates.some(state => state.type === 'dialog');
  }

  private async _raceAgainstModalStates(action: () => Promise<void>): Promise<ModalState[]> {
    if (this.modalStates().length)
      return this.modalStates();

    let resolveModal: (states: ModalState[]) => void;
    const modalPromise = new Promise<ModalState[]>(r => { resolveModal = r; });
    const listener = (modalState: ModalState) => resolveModal([modalState]);
    this.once(TabEvents.modalState, listener);

    return await Promise.race([
      action().then(() => {
        this.off(TabEvents.modalState, listener);
        return [];
      }),
      modalPromise,
    ]);
  }

  async waitForCompletion(callback: () => Promise<void>): Promise<McpActionCapture> {
    const consoleCountBefore = this._recentConsoleMessages.length;
    let snapshotBefore: string | undefined;
    try {
      snapshotBefore = await (this.page as unknown as PageEx)._snapshotForAI();
    } catch {
      // Snapshot may fail if page is navigating
    }

    const actionCapture = createEmptyActionCapture();
    actionCapture.snapshot.before = snapshotBefore;

    await this._raceAgainstModalStates(async () => {
      const { requests, durationMs } = await this._trackCompletion(callback);
      actionCapture.timing.durationMs = durationMs;
      actionCapture.network.requests = requests;
      actionCapture.network.summary = formatNetworkSummary(requests);
    });

    // Capture snapshot after action for diff
    try {
      const snapshotAfter = await (this.page as unknown as PageEx)._snapshotForAI();
      actionCapture.snapshot.after = snapshotAfter;
      if (snapshotBefore && snapshotAfter)
        actionCapture.snapshot.diff = computeSnapshotDiff(snapshotBefore, snapshotAfter);
    } catch {
      // Snapshot may fail after navigation
    }

    actionCapture.console = this._recentConsoleMessages.slice(consoleCountBefore);

    return actionCapture;
  }

  private async _trackCompletion(callback: () => Promise<void>): Promise<{ requests: NetworkRequest[]; durationMs: number }> {
    const pendingRequests = new Set<playwright.Request>();
    const completedRequests: { request: playwright.Request; startTime: number; endTime: number; status: number | null }[] = [];
    let frameNavigated = false;
    let waitCallback: () => void = () => {};
    const waitBarrier = new Promise<void>(f => { waitCallback = f; });
    const startMs = performance.now();

    const responseListener = (request: playwright.Request) => {
      if (pendingRequests.has(request)) {
        pendingRequests.delete(request);
        const entry = completedRequests.find(r => r.request === request);
        if (entry) {
          entry.endTime = performance.now();
          void request.response().then(response => {
            entry.status = response?.status() ?? null;
          }).catch(() => {});
        }
      }
      if (!pendingRequests.size)
        waitCallback();
    };

    const requestListener = (request: playwright.Request) => {
      pendingRequests.add(request);
      completedRequests.push({
        request,
        startTime: performance.now(),
        endTime: performance.now(),
        status: null,
      });
      void request.response().then(() => responseListener(request)).catch(() => responseListener(request));
    };

    const frameNavigateListener = (frame: playwright.Frame) => {
      if (frame.parentFrame())
        return;
      frameNavigated = true;
      dispose();
      clearTimeout(timeout);
      void this.page.waitForLoadState('load').then(waitCallback).catch(waitCallback);
    };

    const onTimeout = () => {
      dispose();
      waitCallback();
    };

    this.page.on('request', requestListener);
    this.page.on('requestfailed', responseListener);
    this.page.on('framenavigated', frameNavigateListener);
    const timeout = setTimeout(onTimeout, 10000);

    const dispose = () => {
      this.page.off('request', requestListener);
      this.page.off('requestfailed', responseListener);
      this.page.off('framenavigated', frameNavigateListener);
      clearTimeout(timeout);
    };

    try {
      await callback();
      if (!pendingRequests.size && !frameNavigated)
        waitCallback();
      await waitBarrier;

      // Brief wait for any late-arriving responses
      if (this._javaScriptBlocked())
        await new Promise(f => setTimeout(f, 1000));
      else
        await this.page.evaluate(() => new Promise(f => setTimeout(f, 1000))).catch(() => {});

      const endMs = performance.now();
      const requests: NetworkRequest[] = completedRequests.map(r => ({
        method: r.request.method(),
        url: r.request.url(),
        status: r.status,
        durationMs: Math.round(r.endTime - r.startTime),
      }));

      return { requests, durationMs: Math.round(endMs - startMs) };
    } finally {
      dispose();
    }
  }

  async refLocator(params: { element: string; ref: string }): Promise<playwright.Locator> {
    return (await this.refLocators([params]))[0];
  }

  async refLocators(params: { element: string; ref: string }[]): Promise<playwright.Locator[]> {
    const snapshot = await (this.page as unknown as PageEx)._snapshotForAI();
    return params.map(param => {
      if (!snapshot.includes(`[ref=${param.ref}]`))
        throw new Error(`Ref ${param.ref} not found in the current page snapshot. Try capturing a new snapshot.`);
      return this.page.locator(`aria-ref=${param.ref}`).describe(param.element);
    });
  }
}

function messageToConsoleMessage(message: playwright.ConsoleMessage): ConsoleMessage {
  return {
    type: message.type(),
    text: message.text(),
    toString: () => `[${message.type().toUpperCase()}] ${message.text()} @ ${message.location().url}:${message.location().lineNumber}`,
  };
}

function pageErrorToConsoleMessage(errorOrValue: Error | any): ConsoleMessage {
  if (errorOrValue instanceof Error) {
    return {
      type: 'error',
      text: errorOrValue.message,
      toString: () => errorOrValue.stack || errorOrValue.message,
    };
  }
  return {
    type: 'error',
    text: String(errorOrValue),
    toString: () => String(errorOrValue),
  };
}

const tabSymbol = Symbol('tabSymbol');
