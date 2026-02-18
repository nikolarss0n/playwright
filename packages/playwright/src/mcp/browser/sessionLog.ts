/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';

import { Response } from './response';
import { logUnhandledError } from '../log';
import { outputFile  } from './config';

import type { FullConfig } from './config';
import type * as actions from './actions';
import type { Tab, TabSnapshot } from './tab';
import type * as mcpServer from '../sdk/server';
import type { ActionCapture } from './actionCapture';

type LogEntry = {
  timestamp: number;
  toolCall?: {
    toolName: string;
    toolArgs: Record<string, any>;
    result: string;
    isError?: boolean;
  };
  userAction?: actions.Action;
  code: string;
  tabSnapshot?: TabSnapshot;
  actionCapture?: ActionCapture;
};

export class SessionLog {
  private _folder: string;
  private _file: string;
  private _ordinal = 0;
  private _pendingEntries: LogEntry[] = [];
  private _sessionFileQueue = Promise.resolve();
  private _flushEntriesTimeout: NodeJS.Timeout | undefined;

  constructor(sessionFolder: string) {
    this._folder = sessionFolder;
    this._file = path.join(this._folder, 'session.md');
  }

  static async create(config: FullConfig, clientInfo: mcpServer.ClientInfo): Promise<SessionLog> {
    const sessionFolder = await outputFile(config, clientInfo, `session-${Date.now()}`, { origin: 'code', reason: 'Saving session' });
    await fs.promises.mkdir(sessionFolder, { recursive: true });
    // eslint-disable-next-line no-console
    console.error(`Session: ${sessionFolder}`);
    return new SessionLog(sessionFolder);
  }

  logResponse(response: Response) {
    const entry: LogEntry = {
      timestamp: performance.now(),
      toolCall: {
        toolName: response.toolName,
        toolArgs: response.toolArgs,
        result: response.result(),
        isError: response.isError(),
      },
      code: response.code(),
      tabSnapshot: response.tabSnapshot(),
      actionCapture: response.actionCapture(),
    };
    this._appendEntry(entry);
  }

  logUserAction(action: actions.Action, tab: Tab, code: string, isUpdate: boolean) {
    code = code.trim();
    if (isUpdate) {
      const lastEntry = this._pendingEntries[this._pendingEntries.length - 1];
      if (lastEntry?.userAction?.name === action.name) {
        lastEntry.userAction = action;
        lastEntry.code = code;
        return;
      }
    }
    if (action.name === 'navigate') {
      // Already logged at this location.
      const lastEntry = this._pendingEntries[this._pendingEntries.length - 1];
      if (lastEntry?.tabSnapshot?.url === action.url)
        return;
    }
    const entry: LogEntry = {
      timestamp: performance.now(),
      userAction: action,
      code,
      tabSnapshot: {
        url: tab.page.url(),
        title: '',
        ariaSnapshot: action.ariaSnapshot || '',
        modalStates: [],
        consoleMessages: [],
        downloads: [],
      },
    };
    this._appendEntry(entry);
  }

  private _appendEntry(entry: LogEntry) {
    this._pendingEntries.push(entry);
    if (this._flushEntriesTimeout)
      clearTimeout(this._flushEntriesTimeout);
    this._flushEntriesTimeout = setTimeout(() => this._flushEntries(), 1000);
  }

  private async _flushEntries() {
    clearTimeout(this._flushEntriesTimeout);
    const entries = this._pendingEntries;
    this._pendingEntries = [];
    const lines: string[] = [''];

    for (const entry of entries) {
      const ordinal = (++this._ordinal).toString().padStart(3, '0');
      if (entry.toolCall) {
        lines.push(
            `### Tool call: ${entry.toolCall.toolName}`,
            `- Args`,
            '```json',
            JSON.stringify(entry.toolCall.toolArgs, null, 2),
            '```',
        );
        if (entry.toolCall.result) {
          lines.push(
              entry.toolCall.isError ? `- Error` : `- Result`,
              '```',
              entry.toolCall.result,
              '```',
          );
        }
      }

      if (entry.userAction) {
        const actionData = { ...entry.userAction } as any;
        delete actionData.ariaSnapshot;
        delete actionData.selector;
        delete actionData.signals;

        lines.push(
            `### User action: ${entry.userAction.name}`,
            `- Args`,
            '```json',
            JSON.stringify(actionData, null, 2),
            '```',
        );
      }

      if (entry.code) {
        lines.push(
            `- Code`,
            '```js',
            entry.code,
            '```');
      }

      if (entry.tabSnapshot) {
        const fileName = `${ordinal}.snapshot.yml`;
        fs.promises.writeFile(path.join(this._folder, fileName), entry.tabSnapshot.ariaSnapshot).catch(logUnhandledError);
        lines.push(`- Snapshot: ${fileName}`);
      }

      if (entry.actionCapture) {
        const actionFileName = `${ordinal}.action.json`;
        const actionData = {
          timing: entry.actionCapture.timing,
          network: entry.actionCapture.network,
          snapshot: {
            diff: entry.actionCapture.snapshot.diff,
          },
          console: entry.actionCapture.console.map(c => ({ type: c.type, text: c.text })),
        };
        fs.promises.writeFile(path.join(this._folder, actionFileName), JSON.stringify(actionData, null, 2)).catch(logUnhandledError);

        // Add action capture summary to markdown
        if (entry.actionCapture.timing.durationMs > 0)
          lines.push(`- Duration: ${entry.actionCapture.timing.durationMs}ms`);
        if (entry.actionCapture.network.requests.length > 0)
          lines.push(`- Network: ${entry.actionCapture.network.summary}`);
        if (entry.actionCapture.snapshot.diff) {
          const diff = entry.actionCapture.snapshot.diff;
          if (diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0)
            lines.push(`- Page changes: ${diff.summary}`);
        }
        lines.push(`- Action capture: ${actionFileName}`);
      }

      lines.push('', '');
    }

    this._sessionFileQueue = this._sessionFileQueue.then(() => fs.promises.appendFile(this._file, lines.join('\n')));
  }
}
