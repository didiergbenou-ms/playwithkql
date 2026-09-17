/**
 * Display-only syntax highlighting.
 *
 * Deliberately NOT the real lexer: that one throws on malformed input, and a
 * highlighter runs on every keystroke over text that is almost always
 * half-finished. This tokenizer never throws — worst case it colours
 * something as plain text.
 */

const OPERATORS = new Set([
  'where',
  'project',
  'project-away',
  'project-keep',
  'project-rename',
  'search',
  'render',
  'extend',
  'summarize',
  'distinct',
  'take',
  'limit',
  'count',
  'sort',
  'order',
  'top',
  'filter',
]);

const KEYWORDS = new Set([
  'by',
  'asc',
  'desc',
  'and',
  'or',
  'not',
  'contains',
  'contains_cs',
  'has',
  'has_cs',
  'startswith',
  'endswith',
  'in',
  'matches',
  'between',
  'timechart',
  'columnchart',
  'true',
  'false',
  'null',
]);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const span = (cls: string, text: string) => `<span class="tk-${cls}">${escapeHtml(text)}</span>`;

export interface HighlightSchema {
  tables: Set<string>;
  columns: Set<string>;
}

export function buildHighlightSchema(
  meta: { name: string; columns: { name: string }[] }[],
): HighlightSchema {
  return {
    tables: new Set(meta.map((t) => t.name.toLowerCase())),
    columns: new Set(['$table', ...meta.flatMap((t) => t.columns.map((c) => c.name.toLowerCase()))]),
  };
}

export function highlightKql(src: string, schema: HighlightSchema): string {
  let out = '';
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    // line comment
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += span('comment', src.slice(i, stop));
      i = stop;
      continue;
    }

    // string (tolerant of a missing closing quote)
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, src.length);
      out += span('string', src.slice(i, j));
      i = j;
      continue;
    }

    // number, possibly with a timespan suffix
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === '.' && src[j + 1] !== '.') {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      let k = j;
      while (k < src.length && /[a-zA-Z]/.test(src[k])) k++;
      const unit = src.slice(j, k);
      if (unit && /^(ms|s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)$/i.test(unit)) {
        out += span('timespan', src.slice(i, k));
        i = k;
      } else {
        out += span('number', src.slice(i, j));
        i = j;
      }
      continue;
    }

    if (c === '!' && /^!between\b/i.test(src.slice(i))) {
      out += span('keyword', src.slice(i, i + 8));
      i += 8;
      continue;
    }

    // Only project operators include a hyphen; subtraction remains separate.
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      if (src.slice(i, j).toLowerCase() === 'project') {
        const suffix = /^-(away|keep|rename)\b/i.exec(src.slice(j));
        if (suffix) j += suffix[0].length;
      }
      const word = src.slice(i, j);
      const lower = word.toLowerCase();

      // A following '(' makes non-keyword identifiers look like calls.
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      const isCall = src[k] === '(';

      if (lower === 'datetime' && isCall) {
        const literal = /^\(\s*\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?\s*\)/.exec(src.slice(k));
        if (literal) {
          out += span('function', word) + escapeHtml(src.slice(j, k + 1));
          out += span('string', literal[0].slice(1, -1)) + ')';
          i = k + literal[0].length;
          continue;
        }
      }

      if (KEYWORDS.has(lower)) out += span('keyword', word);
      else if (isCall) out += span('function', word);
      else if (OPERATORS.has(lower)) out += span('operator', word);
      else if (schema.tables.has(lower)) out += span('table', word);
      else if (schema.columns.has(lower)) out += span('column', word);
      else out += escapeHtml(word);

      i = j;
      continue;
    }

    if (c === '|') {
      out += span('pipe', c);
      i++;
      continue;
    }

    if (c === '.' && src[i + 1] === '.') {
      out += span('op', '..');
      i += 2;
      continue;
    }

    if ('=<>!+-*/%'.includes(c)) {
      let j = i;
      while (j < src.length && '=<>!+-*/%~'.includes(src[j])) j++;
      out += span('op', src.slice(i, j));
      i = j;
      continue;
    }

    out += escapeHtml(c);
    i++;
  }

  // a trailing newline needs a placeholder or the <pre> loses the last line
  return out + '\n';
}
