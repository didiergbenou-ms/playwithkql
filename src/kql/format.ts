/**
 * Query formatting.
 *
 * House style — and real Kusto convention — is one operator per line, so the
 * pipeline reads as a sequence of steps:
 *
 *   Heartbeat
 *   | where TimeGenerated > ago(24h)
 *   | summarize count() by Computer
 *
 * Everything the game puts into the editor goes through here, so authored
 * content can stay on one line in the source where it is easier to read and
 * diff.
 */

/**
 * Splits on top-level pipes and puts each on its own line.
 *
 * Pipes inside string literals and comments are left alone — `where Msg has
 * "a | b"` must not be broken in half.
 */
export function formatKql(src: string): string {
  if (!src.includes('|')) return src.trim();

  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (quote) {
      if (c === '\\' && i + 1 < src.length) {
        cur += c + src[i + 1];
        i += 2;
        continue;
      }
      cur += c;
      if (c === quote) quote = null;
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      i++;
      continue;
    }

    // line comment runs to the end of the line
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const stop = nl === -1 ? src.length : nl;
      cur += src.slice(i, stop);
      i = stop;
      continue;
    }

    if (c === '|') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }

    cur += c;
    i++;
  }
  parts.push(cur);

  const head = parts[0].replace(/\s+/g, ' ').trim();
  const rest = parts.slice(1).map((p) => `| ${p.replace(/\s+/g, ' ').trim()}`.trimEnd());
  return [head, ...rest].join('\n');
}

/**
 * True when the caret sits after real content on its line, meaning a freshly
 * typed pipe should start a new line instead.
 */
export function pipeNeedsNewline(value: string, caret: number): boolean {
  const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  return value.slice(lineStart, caret).trim().length > 0;
}
