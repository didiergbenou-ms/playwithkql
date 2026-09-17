import { KqlError } from './types';

export type TokenKind = 'num' | 'str' | 'datetime' | 'ident' | 'punc' | 'timespan' | 'eof';

export interface Token {
  kind: TokenKind;
  /** Raw text for idents/punc, decoded text for strings. */
  value: string;
  num?: number;
  /** Milliseconds, for timespan literals like 24h. */
  ms?: number;
  pos: number;
}

const PUNCT2 = ['..', '==', '!=', '<=', '>=', '=~', '!~', '&&', '||'];
const PUNCT1 = ['<', '>', '=', '+', '-', '*', '/', '%', '|', '(', ')', ',', '.', '[', ']', '!'];

const TIMESPAN_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    // whitespace
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // line comments
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    const start = i;

    // Only the argument of datetime(...) admits an unquoted date/time.
    // Do not rewrite the source: strings, comments and diagnostic offsets stay intact.
    if (isDigit(c) && tokens.at(-1)?.value === '(' &&
        tokens.at(-2)?.kind === 'ident' && tokens.at(-2)?.value.toLowerCase() === 'datetime') {
      const literal = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?(?=\s*(?:\)|\/\/))/.exec(src.slice(i));
      if (!literal) {
        throw new KqlError('Invalid bare datetime literal.', start, 'Use datetime(2026-03-11 09:15:00) or a quoted ISO datetime.');
      }
      i += literal[0].length;
      tokens.push({ kind: 'datetime', value: literal[0], pos: start });
      continue;
    }

    // strings
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let out = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const esc = src[i + 1];
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          i += 2;
        } else {
          out += src[i++];
        }
      }
      if (i >= src.length) {
        throw new KqlError('Unterminated string literal.', start, 'Did you forget a closing quote?');
      }
      i++; // closing quote
      tokens.push({ kind: 'str', value: out, pos: start });
      continue;
    }

    // numbers (and timespan literals like 24h, 7d, 30m)
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      while (i < src.length && isDigit(src[i])) i++;
      if (src[i] === '.' && isDigit(src[i + 1] ?? '')) {
        i++;
        while (i < src.length && isDigit(src[i])) i++;
      }
      const numText = src.slice(start, i);

      // a unit suffix glued to the number makes it a timespan
      let u = i;
      while (u < src.length && /[A-Za-z]/.test(src[u])) u++;
      const unit = src.slice(i, u).toLowerCase();
      if (unit && unit in TIMESPAN_UNITS) {
        i = u;
        tokens.push({
          kind: 'timespan',
          value: src.slice(start, i),
          ms: Number(numText) * TIMESPAN_UNITS[unit],
          pos: start,
        });
        continue;
      }

      tokens.push({ kind: 'num', value: numText, num: Number(numText), pos: start });
      continue;
    }

    // identifiers / keywords
    if (isIdentStart(c) || (c === '$' && isIdentStart(src[i + 1] ?? ''))) {
      if (c === '$') i++;
      while (i < src.length && isIdentPart(src[i])) i++;
      tokens.push({ kind: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }

    // punctuation
    const two = src.slice(i, i + 2);
    if (PUNCT2.includes(two)) {
      i += 2;
      tokens.push({ kind: 'punc', value: two, pos: start });
      continue;
    }
    if (PUNCT1.includes(c)) {
      i += 1;
      tokens.push({ kind: 'punc', value: c, pos: start });
      continue;
    }

    throw new KqlError(`Unexpected character '${c}'.`, start);
  }

  tokens.push({ kind: 'eof', value: '<end>', pos: src.length });
  return tokens;
}
