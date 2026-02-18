/*
  Copyright (c) Microsoft Corporation.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import type { ActionTraceEvent, AfterActionTraceEventAttachment } from '@trace/trace';
import { clsx, msToString } from '@web/uiUtils';
import * as React from 'react';
import './actionList.css';
import * as modelUtil from './modelUtil';
import { asLocatorDescription, type Language } from '@isomorphic/locatorGenerators';
import type { TreeState } from '@web/components/treeView';
import { TreeView } from '@web/components/treeView';
import type { ActionTraceEventInContext, ActionTreeItem } from './modelUtil';
import type { Boundaries } from './geometry';
import { ToolbarButton } from '@web/components/toolbarButton';
import { testStatusIcon } from './testUtils';
import { methodMetainfo } from '@isomorphic/protocolMetainfo';
import { formatProtocolParam } from '@isomorphic/protocolFormatter';

export interface ActionListProps {
  actions: ActionTraceEventInContext[],
  selectedAction: ActionTraceEventInContext | undefined,
  selectedTime: Boundaries | undefined,
  setSelectedTime: (time: Boundaries | undefined) => void,
  sdkLanguage: Language | undefined;
  onSelected?: (action: ActionTraceEventInContext) => void,
  onHighlighted?: (action: ActionTraceEventInContext | undefined) => void,
  revealConsole?: () => void,
  revealAttachment(attachment: AfterActionTraceEventAttachment): void,
  isLive?: boolean,
  resources?: any[],
}

const ActionTreeView = TreeView<ActionTreeItem>;

export const ActionList: React.FC<ActionListProps> = ({
  actions,
  selectedAction,
  selectedTime,
  setSelectedTime,
  sdkLanguage,
  onSelected,
  onHighlighted,
  revealConsole,
  revealAttachment,
  isLive,
  resources,
}) => {
  const [treeState, setTreeState] = React.useState<TreeState>({ expandedItems: new Map() });
  const { rootItem, itemMap } = React.useMemo(() => modelUtil.buildActionTree(actions, resources), [actions, resources]);

  const { selectedItem } = React.useMemo(() => {
    const selectedItem = selectedAction ? itemMap.get(selectedAction.callId) : undefined;
    return { selectedItem };
  }, [itemMap, selectedAction]);

  const isError = React.useCallback((item: ActionTreeItem) => {
    if (item.networkRequest) {
      return item.networkRequest.response.status >= 400;
    }
    return !!item.action?.error?.message;
  }, []);

  const onAccepted = React.useCallback((item: ActionTreeItem) => {
    if (item.action) {
      return setSelectedTime({ minimum: item.action.startTime, maximum: item.action.endTime });
    }
    if (item.networkRequest && item.networkRequest._monotonicTime) {
      return setSelectedTime({ minimum: item.networkRequest._monotonicTime, maximum: item.networkRequest._monotonicTime });
    }
  }, [setSelectedTime]);

  const render = React.useCallback((item: ActionTreeItem) => {
    // Render network request item
    if (item.networkRequest) {
      const resource = item.networkRequest;
      let resourceName: string;
      try {
        const url = new URL(resource.request.url);
        resourceName = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
        if (!resourceName)
          resourceName = url.host;
      } catch {
        resourceName = resource.request.url;
      }

      const status = resource.response.status;
      let statusClass = '';
      if (status >= 500) statusClass = 'status-5xx';
      else if (status >= 400) statusClass = 'status-4xx';
      else if (status >= 300) statusClass = 'status-3xx';
      else if (status >= 200) statusClass = 'status-2xx';
      else if (status >= 100) statusClass = 'status-1xx';

      const method = resource.request.method;
      const methodClass = `method-${method.toLowerCase()}`;

      return <div className='action-network-item'>
        <span className={`action-network-method ${methodClass}`}>{method}</span>
        <span className={`action-network-status ${statusClass}`}>{status > 0 ? status : ''}</span>
        <span className='action-network-name' title={resource.request.url}>{resourceName}</span>
      </div>;
    }

    // Render action item
    if (!item.action) return null;

    const networkCount = item.children.filter(c => c.networkRequest).length;
    return renderAction(item.action, { sdkLanguage, revealConsole, revealAttachment, isLive, showDuration: true, showBadges: true, networkCount });
  }, [isLive, revealConsole, revealAttachment, sdkLanguage]);

  const isVisible = React.useCallback((item: ActionTreeItem) => {
    return !selectedTime || !item.action || (item.action!.startTime <= selectedTime.maximum && item.action!.endTime >= selectedTime.minimum);
  }, [selectedTime]);

  const onSelectedAction = React.useCallback((item: ActionTreeItem) => {
    if (item.action) {
      onSelected?.(item.action);
    }
  }, [onSelected]);

  const onHighlightedAction = React.useCallback((item: ActionTreeItem | undefined) => {
    if (item?.action) {
      onHighlighted?.(item.action);
    }
  }, [onHighlighted]);

  return <div className='vbox'>
    {selectedTime && <div className='action-list-show-all' onClick={() => setSelectedTime(undefined)}><span className='codicon codicon-triangle-left'></span>Show all</div>}
    <ActionTreeView
      name='actions'
      rootItem={rootItem}
      treeState={treeState}
      setTreeState={setTreeState}
      selectedItem={selectedItem}
      onSelected={onSelectedAction}
      onHighlighted={onHighlightedAction}
      onAccepted={onAccepted}
      isError={isError}
      isVisible={isVisible}
      render={render}
    />
  </div>;
};

export const renderAction = (
  action: ActionTraceEvent,
  options: {
    sdkLanguage?: Language,
    revealConsole?: () => void,
    revealAttachment?(attachment: AfterActionTraceEventAttachment): void,
    isLive?: boolean,
    showDuration?: boolean,
    showBadges?: boolean,
    networkCount?: number,
  }) => {
  const { sdkLanguage, revealConsole, revealAttachment, isLive, showDuration, showBadges, networkCount } = options;
  const { errors, warnings } = modelUtil.stats(action);
  const showAttachments = !!action.attachments?.length && !!revealAttachment;

  const locator = action.params.selector ? asLocatorDescription(sdkLanguage || 'javascript', action.params.selector) : undefined;

  const isSkipped = action.class === 'Test' && action.method === 'test.step' && action.annotations?.some(a => a.type === 'skip');
  let time: string = '';
  if (action.endTime)
    time = msToString(action.endTime - action.startTime);
  else if (action.error)
    time = 'Timed out';
  else if (!isLive)
    time = '-';
  const { elements, title } = renderTitleForCall(action);
  return <div className='action-title hbox'>
    <div className='vbox' style={{ flex: 'auto' }}>
      <div className='hbox'>
        <span className='action-title-method' title={title}>{elements}</span>
        {(showBadges || showAttachments || isSkipped || networkCount) && <div className='spacer'></div>}
        {showAttachments && <ToolbarButton icon='attach' title='Open Attachment' onClick={() => revealAttachment(action.attachments![0])} />}
        {isSkipped && <span className={clsx('action-skipped', 'codicon', testStatusIcon('skipped'))} title='skipped'></span>}
        {showBadges && <div className='action-icons' onClick={() => revealConsole?.()}>
          {!!errors && <div className='action-icon'><span className='codicon codicon-error'></span><span className='action-icon-value'>{errors}</span></div>}
          {!!warnings && <div className='action-icon'><span className='codicon codicon-warning'></span><span className='action-icon-value'>{warnings}</span></div>}
        </div>}
        {!!networkCount && <span className='action-network-indicator'><span className='codicon codicon-globe'></span>{networkCount}</span>}
      </div>
      {locator && <div className='action-title-selector' title={locator}>{locator}</div>}
    </div>
    {showDuration && !isSkipped && <div className='action-duration'>{time || <span className='codicon codicon-loading'></span>}</div>}
  </div>;
};

export function renderTitleForCall(action: ActionTraceEvent): { elements: React.ReactNode[], title: string } {
  const titleFormat = action.title ?? methodMetainfo.get(action.class + '.' + action.method)?.title ?? action.method;

  const elements: React.ReactNode[] = [];
  const title: string[] = [];
  let currentIndex = 0;
  const regex = /\{([^}]+)\}/g;
  let match;

  while ((match = regex.exec(titleFormat)) !== null) {
    const [fullMatch, quotedText] = match;
    const chunk = titleFormat.slice(currentIndex, match.index);

    elements.push(chunk);
    title.push(chunk);

    const param = formatProtocolParam(action.params, quotedText);
    if (param === undefined) {
      elements.push(fullMatch);
      title.push(fullMatch);
    } else if (match.index === 0) {
      elements.push(param);
      title.push(param);
    } else {
      elements.push(<span className='action-title-param'>{param}</span>);
      title.push(param);
    }
    currentIndex = match.index + fullMatch.length;
  }

  if (currentIndex < titleFormat.length) {
    const chunk = titleFormat.slice(currentIndex);
    elements.push(chunk);
    title.push(chunk);
  }

  return { elements, title: title.join('') };
}
