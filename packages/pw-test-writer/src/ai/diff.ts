export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed' | 'separator';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export function computeLineDiff(oldCode: string, newCode: string): DiffLine[] {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');
  const m = oldLines.length, n = newLines.length;

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'unchanged', content: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', content: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', content: oldLines[i - 1] });
      i--;
    }
  }
  result.reverse();

  // Forward pass: assign line numbers
  let oldLine = 1, newLine = 1;
  for (const line of result) {
    if (line.type === 'unchanged') {
      line.oldLineNo = oldLine++;
      line.newLineNo = newLine++;
    } else if (line.type === 'removed') {
      line.oldLineNo = oldLine++;
    } else if (line.type === 'added') {
      line.newLineNo = newLine++;
    }
  }

  return result;
}

export function contextDiff(diff: DiffLine[], context = 2): DiffLine[] {
  const changed = new Set<number>();
  diff.forEach((line, i) => { if (line.type !== 'unchanged') changed.add(i); });

  const visible = new Set<number>();
  for (const idx of changed)
    for (let c = Math.max(0, idx - context); c <= Math.min(diff.length - 1, idx + context); c++)
      visible.add(c);

  const result: DiffLine[] = [];
  let lastShown = -1;
  for (let i = 0; i < diff.length; i++) {
    if (!visible.has(i)) continue;
    if (lastShown >= 0 && i - lastShown > 1)
      result.push({ type: 'separator', content: '...' });
    result.push(diff[i]);
    lastShown = i;
  }
  return result;
}
