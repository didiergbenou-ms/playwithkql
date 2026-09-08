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
    if (cur.length > 0 && !cur.endsWith(' ')) cur += ' ';
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
      const stop = nl === -1 ? src.length : nl;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }

    if (/\s/.test(c)) {
      if (out.length > 0 && !out.endsWith(' ')) out += ' ';
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
 * has exactly one source table, so switching it means replacing the leading
 * identifier rather than adding another.
 */
export function withSourceTable(query: string, table: string): string {
  const trimmed = query.trim();
  if (!trimmed) return table;

  // The source is the leading identifier, before any pipe. A query that
  // already starts with a pipe has no source yet, so the table goes in front.
  const leading = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed);
  if (!leading) return formatKql(`${table}\n${trimmed}`);

  return formatKql(table + trimmed.slice(leading[0].length));
}
