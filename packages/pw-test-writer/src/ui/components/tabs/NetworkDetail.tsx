import chalk from 'chalk';
import { colors, th, formatBytes } from '../../theme.js';
import type { AppState } from '../../store.js';
import type { NetworkRequestCapture } from 'playwright-core/lib/server/actionCaptureTypes';
import { formatJsonPreview, formatJsonFull, RESPONSE_VISIBLE_LINES } from '../shared/JsonPreview.js';

const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
const visualWidth = (str: string) => stripAnsi(str).length;
const padEndVisual = (str: string, w: number) => str + ' '.repeat(Math.max(0, w - visualWidth(str)));

export function renderNetworkDetail(
  requests: NetworkRequestCapture[],
  state: AppState,
  rightWidth: number,
  maxRemainingLines: number,
  focusRight: boolean,
): string[] {
  const lines: string[] = [];
  const inNetworkMode = state.actionDetailFocus === 'network';
  const networkFocused = inNetworkMode && focusRight;

  const allRequests = requests;
  const completedRequests = allRequests.filter(r => r.status !== null);
  const pendingRequests = allRequests.filter(r => r.status === null);

  const requestsToShow = [
    ...completedRequests.slice(0, 15),
    ...(pendingRequests.length > 0 && completedRequests.length < 10 ? pendingRequests.slice(0, 5) : []),
  ];

  for (let ri = 0; ri < requestsToShow.length && lines.length < maxRemainingLines - 6; ri++) {
    const req = requestsToShow[ri]!;
    const originalIndex = allRequests.indexOf(req);
    const isNetSelected = networkFocused && state.networkScrollIndex === originalIndex;
    const isNetExpanded = state.expandedNetworkIndex === originalIndex;
    const isPending = req.status === null;
    const status = req.status ?? 0;
    const statusColor = isPending ? chalk.hex(colors.warning) :
                        status >= 500 ? chalk.hex(colors.error) :
                        status >= 400 ? chalk.hex(colors.error) :
                        status >= 300 ? chalk.hex(colors.secondary) :
                        chalk.hex(colors.success);
    const statusText = isPending ? '...' : String(req.status);

    const expandIcon = isNetExpanded ? '▾' : '▸';
    const durationText = !isPending && req.durationMs ? th.textDim(` ${req.durationMs.toFixed(0)}ms`) : '';
    const urlSpace = rightWidth - 22 - req.method.length - (durationText ? 8 : 0);
    const urlDisplay = req.url.length > urlSpace ? req.url.slice(0, urlSpace - 3) + '...' : req.url;
    const methodStr = isPending ? th.textDim(req.method) : status >= 400 ? statusColor.bold(req.method) : th.textDim(req.method);
    const urlStr = isPending ? th.textDim(urlDisplay) : status >= 400 ? statusColor(urlDisplay) : th.textDim(urlDisplay);
    const statusStr = isPending ? chalk.hex(colors.warning)('...') : status >= 400 ? statusColor(statusText) : th.textDim(statusText);
    let reqLine = `    ${expandIcon} ${methodStr} ${statusStr} ${urlStr}${durationText}`;

    if (isNetSelected) {
      lines.push(th.selected(padEndVisual(reqLine, rightWidth - 1)));
    } else {
      lines.push(isPending ? th.textDim(reqLine) : reqLine);
    }

    if (isNetExpanded) {
      const boxWidth = rightWidth - 6;
      const borderColor = (req.status ?? 0) >= 400 ? chalk.hex(colors.error) : chalk.hex(colors.success);

      const boxLine = (content: string) => {
        return borderColor(`    │`) + padEndVisual(` ${content}`, boxWidth - 2) + borderColor(`│`);
      };

      lines.push(borderColor(`    ╭${'─'.repeat(boxWidth - 2)}╮`));
      const urlMaxLen = boxWidth - req.method.length - 5;
      const urlDisplay2 = req.url.length > urlMaxLen ? req.url.slice(0, urlMaxLen - 1) + '…' : req.url;
      const urlLine = chalk.bold(` ${req.method} `) + chalk.hex(colors.secondary)(urlDisplay2);
      lines.push(borderColor(`    │`) + padEndVisual(urlLine, boxWidth - 2) + borderColor(`│`));
      lines.push(borderColor(`    ├${'─'.repeat(boxWidth - 2)}┤`));

      const statusEmoji = (req.status ?? 0) >= 400 ? '✗' : '✓';
      const reqSize = (req as any).requestSize ? formatBytes((req as any).requestSize) : '';
      const resSize = (req as any).responseSize ? formatBytes((req as any).responseSize) : '';
      const sizeInfo = (reqSize || resSize) ? ` │ ${reqSize ? reqSize + ' → ' : ''}${resSize || '?'}` : '';
      const statusLine = ` ${statusEmoji} ${statusText} ${(req as any).statusText || ''} │ ${req.durationMs?.toFixed(0) || '?'}ms │ ${(req as any).resourceType || 'fetch'}${sizeInfo}`;
      lines.push(boxLine(statusLine));

      const bodyMaxWidth = boxWidth - 6;

      if ((req as any).requestPostData) {
        lines.push(borderColor(`    ├${'─'.repeat(boxWidth - 2)}┤`));
        lines.push(boxLine(chalk.hex(colors.warning).bold('REQUEST')));
        const postLines = formatJsonPreview((req as any).requestPostData, 6, bodyMaxWidth);
        for (const line of postLines) lines.push(boxLine(line));
      }

      lines.push(borderColor(`    ├${'─'.repeat(boxWidth - 2)}┤`));
      if ((req as any).responseBody) {
        const allBodyLines = formatJsonFull((req as any).responseBody, bodyMaxWidth);
        const totalBodyLines = allBodyLines.length;
        const needsScroll = totalBodyLines > RESPONSE_VISIBLE_LINES;
        const scrollOffset = needsScroll
          ? Math.min(state.responseScrollOffset, Math.max(0, totalBodyLines - RESPONSE_VISIBLE_LINES))
          : 0;
        const visibleCount = Math.min(RESPONSE_VISIBLE_LINES, totalBodyLines);
        const visibleLines = allBodyLines.slice(scrollOffset, scrollOffset + visibleCount);

        const scrollInfo = needsScroll
          ? th.textDim(` ${scrollOffset + 1}-${scrollOffset + visibleLines.length}/${totalBodyLines}`)
          : '';
        const scrollHint = needsScroll ? th.textDim(' ↕') : '';
        lines.push(boxLine(chalk.hex(colors.success).bold('RESPONSE') + scrollInfo + scrollHint));

        if (scrollOffset > 0) lines.push(boxLine(th.textDim(`  ▲ ${scrollOffset} more lines`)));
        for (const line of visibleLines) lines.push(boxLine(line));
        const remaining = totalBodyLines - scrollOffset - visibleLines.length;
        if (remaining > 0) lines.push(boxLine(th.textDim(`  ▼ ${remaining} more lines`)));
      } else if (isPending) {
        lines.push(boxLine(chalk.hex(colors.warning)('Waiting for response...')));
      } else {
        lines.push(boxLine(th.textDim('(no body)')));
      }

      lines.push(borderColor(`    ╰${'─'.repeat(boxWidth - 2)}╯`));
    }
  }

  // Summary of hidden requests
  const hiddenCompleted = Math.max(0, completedRequests.length - 15);
  const hiddenPending = pendingRequests.length - (completedRequests.length < 10 ? Math.min(5, pendingRequests.length) : 0);
  if (hiddenCompleted > 0 || hiddenPending > 0) {
    let hiddenText = '    ';
    if (hiddenCompleted > 0) hiddenText += `+${hiddenCompleted} more`;
    if (hiddenCompleted > 0 && hiddenPending > 0) hiddenText += ', ';
    if (hiddenPending > 0) hiddenText += chalk.hex(colors.warning)(`+${hiddenPending} pending`);
    lines.push(th.textDim(hiddenText));
  }

  return lines;
}
