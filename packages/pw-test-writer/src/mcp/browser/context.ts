import type * as playwright from 'playwright-core';
import { Tab } from './tab.js';

export class BrowserContext {
  private _browser: playwright.Browser | undefined;
  private _browserContext: playwright.BrowserContext | undefined;
  private _tabs: Tab[] = [];
  private _currentTab: Tab | undefined;

  tabs(): Tab[] {
    return this._tabs;
  }

  currentTab(): Tab | undefined {
    return this._currentTab;
  }

  currentTabOrDie(): Tab {
    if (!this._currentTab)
      throw new Error('No open pages available. Use the "browser_navigate" tool to navigate to a page first.');
    return this._currentTab;
  }

  async ensureTab(): Promise<Tab> {
    if (!this._browserContext)
      await this._launchBrowser();
    if (!this._currentTab)
      await this._browserContext!.newPage();
    return this._currentTab!;
  }

  async newTab(): Promise<Tab> {
    if (!this._browserContext)
      await this._launchBrowser();
    const page = await this._browserContext!.newPage();
    this._currentTab = this._tabs.find(t => t.page === page)!;
    return this._currentTab;
  }

  async selectTab(index: number) {
    const tab = this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    await tab.page.bringToFront();
    this._currentTab = tab;
    return tab;
  }

  async closeTab(index: number | undefined): Promise<string> {
    const tab = index === undefined ? this._currentTab : this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    const url = tab.page.url();
    await tab.page.close();
    return url;
  }

  private _onPageCreated(page: playwright.Page) {
    const tab = new Tab(page, tab => this._onPageClosed(tab));
    this._tabs.push(tab);
    if (!this._currentTab)
      this._currentTab = tab;
  }

  private _onPageClosed(tab: Tab) {
    const index = this._tabs.indexOf(tab);
    if (index === -1)
      return;
    this._tabs.splice(index, 1);

    if (this._currentTab === tab)
      this._currentTab = this._tabs[Math.min(index, this._tabs.length - 1)];
    if (!this._tabs.length)
      void this._closeBrowser();
  }

  private async _launchBrowser() {
    const pw = await import('playwright-core');
    const headless = process.platform === 'linux' && !process.env.DISPLAY;
    this._browser = await pw.chromium.launch({
      headless,
      channel: 'chrome',
    });
    this._browserContext = await this._browser.newContext({ viewport: null });
    for (const page of this._browserContext.pages())
      this._onPageCreated(page);
    this._browserContext.on('page', page => this._onPageCreated(page));
  }

  private async _closeBrowser() {
    const browser = this._browser;
    this._browser = undefined;
    this._browserContext = undefined;
    this._tabs = [];
    this._currentTab = undefined;
    if (browser)
      await browser.close().catch(() => {});
  }

  async dispose() {
    await this._closeBrowser();
  }
}
