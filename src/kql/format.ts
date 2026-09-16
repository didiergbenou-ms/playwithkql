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
 *
 * Whitespace is collapsed *during* the scan rather than afterwards. Doing it
 * afterwards with a blanket `\s+ -> ' '` also rewrites the inside of string
 * literals, so formatting `where Message == "a  b"` silently changed the
 * literal to `"a b"` and with it the query's results. The scanner already
 * knows when it is inside a quote or a comment, so that knowledge is used
 * instead of being thrown away.
 */
export function formatKql(src: string): string {
  if (!src.includes('|')) return collapseOutsideStrings(src).trim();

  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let i = 0;

  /** Appends a space unless one is already pending, so runs collapse. */
  const pushSpace = () => {
    if (cur.length > 0 && !/\s$/.test(cur)) cur += ' ';
  };

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

    // Keep the newline so following code cannot become part of the comment.
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const stop = nl === -1 ? src.length : nl + 1;
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

    if (/\s/.test(c)) {
      pushSpace();
      i++;
      continue;
    }

    cur += c;
    i++;
  }
  parts.push(cur);

  const head = parts[0].trim();
  const rest = parts.slice(1).map((p) => `| ${p.trim()}`.trimEnd());
  return [head, ...rest].join('\n');
}

/**
 * Collapses whitespace runs outside string literals and comments, leaving the
 * contents of both untouched. Used for queries with no pipe to split on.
 */
function collapseOutsideStrings(src: string): string {
  let out = '';
  let quote: string | null = null;
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (quote) {
      if (c === '\\' && i + 1 < src.length) {
        out += c + src[i + 1];
        i += 2;
        continue;
      }
      out += c;
      if (c === quote) quote = null;
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      i++;
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const stop = nl === -1 ? src.length : nl + 1;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }

    if (/\s/.test(c)) {
      if (out.length > 0 && !/\s$/.test(out)) out += ' ';
      i++;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/**
 * True when the caret sits after real content on its line, meaning a freshly
 * typed pipe should start a new line instead.
 */
export function pipeNeedsNewline(value: string, caret: number): boolean {
  const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  return value.slice(lineStart, caret).trim().length > 0;
}

/**
 * Points a query at a different source table.
 *
 * The schema buttons used to prepend the name, which turned `Heartbeat | take
 * 10` into `Heartbeat Heartbeat | take 10` — not a valid query, and a
 * confusing thing to hand someone who is still learning the syntax. A query
 * has one source (a table or a search), so switching it means replacing that
 * source rather than adding another.
 */
export function withSourceTable(query: string, table: string): string {
  const trimmed = query.trim();
  if (!trimmed) return table;

  const skipTrivia = (start: number): number => {
    let i = start;
    while (i < trimmed.length) {
      if (/\s/.test(trimmed[i])) i++;
      else if (trimmed.startsWith('//', i)) {
        const end = trimmed.indexOf('\n', i);
        i = end === -1 ? trimmed.length : end + 1;
      } else break;
    }
    return i;
  };
  const start = skipTrivia(0);
  const leading = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed.slice(start));
  if (!leading) return formatKql(`${table}\n${trimmed}`);

  let end = start + leading[0].length;
  let trivia = '';
  if (leading[0].toLowerCase() === 'search') {
    const literalStart = skipTrivia(end);
    const quote = trimmed[literalStart];
    if (quote === '"' || quote === "'") {
      trivia = trimmed.slice(end, literalStart);
      end = literalStart + 1;
      while (end < trimmed.length && trimmed[end] !== quote) {
        end += trimmed[end] === '\\' ? 2 : 1;
      }
      if (end < trimmed.length) end++;
    }
  }
  return formatKql(trimmed.slice(0, start) + table + trivia + trimmed.slice(end));
}
