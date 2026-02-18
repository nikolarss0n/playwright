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
  const totalRequests = allRequests.length;

  // Compute scroll window for network requests
  const maxVisibleRequests = Math.max(3, maxRemainingLines - 8);
  const needsNetScroll = totalRequests > maxVisibleRequests;
  let netScrollStart = 0;
  if (needsNetScroll) {
    netScrollStart = Math.max(0, Math.min(
      state.networkScrollIndex - Math.floor(maxVisibleRequests / 3),
      totalRequests - maxVisibleRequests,
    ));
  }
  const requestsToShow = allRequests.slice(netScrollStart, netScrollStart + maxVisibleRequests);

  if (needsNetScroll && netScrollStart > 0) {
    lines.push(th.textDim(`    ▲ ${netScrollStart} more`));
  }

  for (let ri = 0; ri < requestsToShow.length && lines.length < maxRemainingLines - 4; ri++) {
    const req = requestsToShow[ri]!;
    const originalIndex = netScrollStart + ri;
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
    const methodColors: Record<string, string> = {
      GET: colors.success, POST: colors.warning, PUT: colors.warning,
      PATCH: colors.warning, DELETE: colors.error,
    };
    const mColor = methodColors[req.method] || colors.textDim;
    const methodStr = isPending ? th.textDim(req.method) : chalk.hex(mColor).bold(req.method);
    const urlStr = isPending ? th.textDim(urlDisplay) : status >= 400 ? statusColor(urlDisplay) : th.textDim(urlDisplay);
    const statusStr = isPending ? chalk.hex(colors.warning)('...') : statusColor(statusText);
    let reqLine = `    ${expandIcon} ${methodStr} ${statusStr} ${urlStr}${durationText}`;

    if (isNetSelected) {
      lines.push(th.selected(padEndVisual(reqLine, rightWidth - 1)));
    } else {
      lines.push(reqLine);
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

  // Summary of items below scroll window
  const belowCount = totalRequests - netScrollStart - requestsToShow.length;
  if (needsNetScroll && belowCount > 0) {
    const pendingBelow = allRequests.slice(netScrollStart + requestsToShow.length).filter(r => r.status === null).length;
    let belowText = `    ▼ ${belowCount} more`;
    if (pendingBelow > 0) belowText += chalk.hex(colors.warning)(` (${pendingBelow} pending)`);
    lines.push(th.textDim(belowText));
  }

  return lines;
}
