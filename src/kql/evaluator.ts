import type { Expr, NamedExpr, Query, SortItem } from './parser';
import {
  KqlError,
  didYouMean,
  isTimespan,
  timespan,
  type Database,
  type KValue,
  type Row,
  type Table,
} from './types';

/**
 * Bounds on the player-supplied regex used by `matches` and `extract()`.
 *
 * An earlier version blacklisted quantified groups, which stops *exponential*
 * blowup but is not a bound: `a*a*a*a*a*a*a*a*a*a*b` contains no group at all,
 * passes that check, and still backtracks polynomially until the tab freezes.
 * A blacklist can only ever describe the bad shapes someone thought of.
 *
 * These limits come from measurement rather than theory. Against an adversarial
 * all-matching subject, V8 costs roughly O(n^k) for k adjacent unbounded
 * quantifiers:
 *
 *     k=2  n=256     5ms      k=3  n=128   148ms
 *     k=2  n=512   255ms      k=3  n=512  5112ms
 *
 * So: at most two unbounded quantifiers, and a subject capped at 256 — still
 * above the longest string in the case data (209 chars). That keeps the worst
 * *accepted* pattern in single-digit milliseconds, and a test measures it
 * rather than trusting this comment. 512 was tried first and a test caught it
 * at 255ms, which is a visible stall.
 *
 * A *total* quantifier cap is needed as well, because exponential blowup does
 * not require an unbounded quantifier at all: `a?a?a?…a` repeated thirty times
 * against thirty characters already costs 171ms, and it doubles per repeat
 * while staying inside the pattern-length limit. Counting only `*`, `+` and
 * `{n,}` missed that entirely — `?` is bounded but still a branch point.
 *
 * Ordinary patterns are unaffected: `^CONTOSO`, `WEB-0[12]$`, `DC-\d+`,
 * `https?://` and `.*proxy.*` all pass. `.*a.*b.*` is refused, and `contains`
 * is the idiomatic KQL for that anyway.
 *
 * The genuinely correct fix is a non-backtracking engine (RE2) or running the
 * match in a terminable worker. Both are disproportionate here: the evaluator
 * is synchronous and per-row, and this is a teaching game with a small fixed
 * dataset. Bounded inputs are the honest middle.
 */
const MAX_REGEX_PATTERN = 200;
const MAX_REGEX_SUBJECT = 256;
const MAX_UNBOUNDED_QUANTIFIERS = 2;
/** Total branch points, whatever their form. Real patterns use one or two. */
const MAX_QUANTIFIERS = 4;
const QUANTIFIED_GROUP = /\)\s*[+*{?]/;
/** `*`, `+` and open-ended `{n,}` — the quantifiers with no upper limit. */
const UNBOUNDED_QUANTIFIER = /(?<!\\)[*+]|(?<!\\)\{\d*,\}/g;
/** Every quantifier form, including `?` and bounded `{n,m}`. */
const ANY_QUANTIFIER = /(?<!\\)[*+?]|(?<!\\)\{\d*(?:,\d*)?\}/g;

/**
 * Compiles a player-supplied regex, or returns null if it is unsafe.
 *
 * Every regex built from player input must go through here. The guards were
 * originally inlined at the `matches` operator, which left `extract()`
 * compiling patterns with no protection at all — the same bug, one function
 * away. A shared helper means adding a third regex site cannot silently
 * reintroduce it.
 */
export function safeRegex(pattern: string, subject: string): RegExp | null {
  if (pattern.length > MAX_REGEX_PATTERN || subject.length > MAX_REGEX_SUBJECT) return null;
  if (QUANTIFIED_GROUP.test(pattern)) return null;
  if ((pattern.match(ANY_QUANTIFIER) ?? []).length > MAX_QUANTIFIERS) return null;
  if ((pattern.match(UNBOUNDED_QUANTIFIER) ?? []).length > MAX_UNBOUNDED_QUANTIFIERS) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

const AGGREGATES = new Set([
  'count',
  'countif',
  'dcount',
  'sum',
  'avg',
  'min',
  'max',
  'arg_max',
  'arg_min',
  'make_set',
  'make_list',
]);

export interface EvalOptions {
  /** Fixed "now" so cases are deterministic and replayable. */
  now?: Date;
  /** Safety valve against runaway queries. */
  maxRows?: number;
}

interface Ctx {
  now: Date;
  columns: string[];
}

// ---- value helpers ---------------------------------------------------------

const isDate = (v: unknown): v is Date => v instanceof Date;

function toNumber(v: KValue): number {
  if (v === null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isDate(v)) return v.getTime();
  if (isTimespan(v)) return v.ms;
  if (typeof v === 'string') return Number(v);
  return NaN;
}

export function toDisplayString(v: KValue): string {
  if (v === null || v === undefined) return '';
  if (isDate(v)) {
    // toISOString throws RangeError on an Invalid Date, which would escape the
    // friendly-error path and surface as an internal crash while merely
    // *rendering* an otherwise valid result. Guarded at the single point where
    // dates get formatted rather than at every site that builds one.
    return Number.isNaN(v.getTime())
      ? 'Invalid datetime'
      : v.toISOString().replace('T', ' ').replace('.000Z', 'Z');
  }
  if (isTimespan(v)) return `${v.ms}ms`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function truthy(v: KValue): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return true;
}

/** Ordering comparison. null sorts lowest. */
function cmp(a: KValue, b: KValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (isDate(a) || isDate(b)) return toNumber(a) - toNumber(b);
  if (typeof a === 'number' || typeof b === 'number') return toNumber(a) - toNumber(b);
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const sa = toDisplayString(a);
  const sb = toDisplayString(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function eq(a: KValue, b: KValue): boolean {
  if (a === null || b === null) return a === b;
  if (isDate(a) || isDate(b)) return toNumber(a) === toNumber(b);
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

const s = (v: KValue) => toDisplayString(v);

/** KQL `has` is a whole-token, case-insensitive match. */
function hasToken(haystack: string, needle: string, caseSensitive: boolean): boolean {
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  if (!n) return false;
  return h.split(/[^A-Za-z0-9_]+/).includes(n);
}

/** This subset counts UTC period boundaries, not truncated elapsed durations. */
const DATETIME_PERIODS = new Map([
  ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000],
  ['second', 1000], ['millisecond', 1],
]);

function parseDatetime(text: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?([Zz]|[+-]\d{2}:\d{2})?)?$/.exec(text);
  let normalized = text;
  if (parts) {
    const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone = 'Z'] = parts;
    const y = Number(year);
    const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 ||
        Number(day) > days[Number(month) - 1] || Number(hour) > 23 ||
        Number(minute) > 59 || Number(second) > 59) return null;
    normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, '0').slice(0, 3)}${zone.toUpperCase()}`;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---- scalar function library ----------------------------------------------

function callScalar(name: string, args: KValue[], ctx: Ctx, pos: number): KValue {
  const a0 = args[0];

  switch (name) {
    case 'now':
      return ctx.now;
    case 'ago': {
      const ms = isTimespan(a0) ? a0.ms : toNumber(a0);
      return new Date(ctx.now.getTime() - ms);
    }
    case 'bin':
    case 'floor_bin': {
      const step = isTimespan(args[1]) ? args[1].ms : toNumber(args[1]);
      if (!step) return a0;
      if (isDate(a0)) return new Date(Math.floor(a0.getTime() / step) * step);
      return Math.floor(toNumber(a0) / step) * step;
    }
    case 'startofday': {
      const d = new Date(toNumber(a0));
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case 'startofhour': {
      const d = new Date(toNumber(a0));
      d.setUTCMinutes(0, 0, 0);
      return d;
    }
    case 'hourofday':
      return new Date(toNumber(a0)).getUTCHours();
    case 'datetime':
    case 'todatetime': {
      return parseDatetime(s(a0));
    }
    case 'datetime_diff': {
      if (args.length !== 3) {
        throw new KqlError("'datetime_diff()' needs exactly three arguments: period, end, start.", pos);
      }
      const step = typeof a0 === 'string' ? DATETIME_PERIODS.get(a0.toLowerCase()) : undefined;
      if (step === undefined) {
        throw new KqlError("'datetime_diff()' supports only day, hour, minute, second and millisecond.", pos);
      }
      const [, end, start] = args;
      if (end === null || start === null) return null;
      if (!isDate(end) || !isDate(start)) {
        throw new KqlError("'datetime_diff()' requires datetime end and start values.", pos);
      }
      if (!Number.isFinite(end.getTime()) || !Number.isFinite(start.getTime())) return null;
      return Math.floor(end.getTime() / step) - Math.floor(start.getTime() / step);
    }
    case 'totimespan':
      return isTimespan(a0) ? a0 : timespan(toNumber(a0));
    case 'isempty':
      return a0 === null || a0 === '';
    case 'isnotempty':
      return !(a0 === null || a0 === '');
    case 'isnull':
      return a0 === null;
    case 'isnotnull':
      return a0 !== null;
    case 'not':
      return !truthy(a0);
    case 'strcat':
      return args.map(s).join('');
    case 'strlen':
      return s(a0).length;
    case 'tolower':
      return s(a0).toLowerCase();
    case 'toupper':
      return s(a0).toUpperCase();
    case 'tostring':
      return s(a0);
    case 'toint':
    case 'tolong':
      return Math.trunc(toNumber(a0));
    case 'todouble':
    case 'toreal':
      return toNumber(a0);
    case 'tobool':
      return truthy(a0);
    case 'substring': {
      const str = s(a0);
      const start = toNumber(args[1]);
      return args.length > 2 ? str.substr(start, toNumber(args[2])) : str.substring(start);
    }
    case 'indexof':
      return s(a0).indexOf(s(args[1]));
    case 'split': {
      const parts = s(a0).split(s(args[1]));
      return args.length > 2 ? (parts[toNumber(args[2])] ?? null) : parts;
    }
    case 'array_length':
      return Array.isArray(a0) ? a0.length : 0;
    case 'parse_json':
    case 'todynamic': {
      if (typeof a0 !== 'string') return a0;
      try {
        return JSON.parse(a0) as KValue;
      } catch {
        return null;
      }
    }
    case 'extract': {
      try {
        const subject = s(args[2]);
        const re = safeRegex(s(a0), subject);
        if (!re) return null;
        const m = re.exec(subject);
        if (!m) return null;
        return m[toNumber(args[1])] ?? null;
      } catch {
        return null;
      }
    }
    case 'iff':
    case 'iif':
      return truthy(a0) ? args[1] : args[2];
    case 'coalesce':
      return args.find((v) => v !== null && v !== '') ?? null;
    case 'abs':
      return Math.abs(toNumber(a0));
    case 'floor':
      return Math.floor(toNumber(a0));
    case 'round': {
      const digits = args.length > 1 ? toNumber(args[1]) : 0;
      const f = 10 ** digits;
      return Math.round(toNumber(a0) * f) / f;
    }
    case 'min_of':
    case 'max_of': {
      // reduce() on an empty array throws a raw TypeError, which escapes the
      // friendly-error contract and reaches the player as an internal crash.
      if (args.length === 0) {
        throw new KqlError(`'${name}()' needs at least one value.`, pos, `Try ${name}(a, b).`);
      }
      return name === 'min_of'
        ? args.reduce((m, v) => (cmp(v, m) < 0 ? v : m))
        : args.reduce((m, v) => (cmp(v, m) > 0 ? v : m));
    }
    default:
      throw new KqlError(
        `Unknown function '${name}()'.`,
        pos,
        AGGREGATES.has(name)
          ? `'${name}()' is an aggregation — use it inside 'summarize'.`
          : undefined,
      );
  }
}

// ---- expression evaluation -------------------------------------------------

function evalExpr(e: Expr, row: Row, ctx: Ctx): KValue {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'str':
      return e.v;
    case 'bool':
      return e.v;
    case 'null':
      return null;
    case 'ts':
      return timespan(e.ms);
    case 'star':
      return null;

    case 'col': {
      if (e.name in row) return row[e.name];
      const suggestion = didYouMean(e.name, ctx.columns);
      throw new KqlError(
        `Unknown column '${e.name}'.`,
        e.pos,
        suggestion
          ? `Did you mean '${suggestion}'?`
          : `Available columns: ${ctx.columns.join(', ')}.`,
      );
    }

    case 'call': {
      if (AGGREGATES.has(e.name)) {
        throw new KqlError(
          `'${e.name}()' can only be used inside 'summarize'.`,
          e.pos,
          `Try: | summarize ${e.name}(...) by SomeColumn`,
        );
      }
      if (e.name === 'case') {
        if (e.args.length < 3 || e.args.length % 2 !== 1) {
          throw new KqlError("'case()' needs condition/value pairs followed by one else value.", e.pos);
        }
        for (let i = 0; i < e.args.length - 1; i += 2) {
          const predicate = evalExpr(e.args[i], row, ctx);
          if (predicate !== null && typeof predicate !== 'boolean') {
            throw new KqlError("'case()' conditions must be boolean.", e.pos);
          }
          if (predicate === true) return evalExpr(e.args[i + 1], row, ctx);
        }
        return evalExpr(e.args[e.args.length - 1], row, ctx);
      }
      const args = e.args.map((a) => evalExpr(a, row, ctx));
      return callScalar(e.name, args, ctx, e.pos);
    }

    case 'un': {
      const v = evalExpr(e.e, row, ctx);
      return e.op === '-' ? -toNumber(v) : !truthy(v);
    }

    case 'member': {
      const obj = evalExpr(e.obj, row, ctx);
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && !isDate(obj)) {
        return (obj as Record<string, KValue>)[e.name] ?? null;
      }
      return null;
    }

    case 'index': {
      const obj = evalExpr(e.obj, row, ctx);
      const idx = evalExpr(e.idx, row, ctx);
      if (Array.isArray(obj)) return obj[toNumber(idx)] ?? null;
      if (obj && typeof obj === 'object' && !isDate(obj)) {
        return (obj as Record<string, KValue>)[s(idx)] ?? null;
      }
      return null;
    }

    case 'list':
      return e.items.map((it) => evalExpr(it, row, ctx));

    case 'between': {
      const values = [e.expr, e.lo, e.hi].map((value) => evalExpr(value, row, ctx));
      if (values.some((value) => value === null)) return null;
      if (!values.every((value) => typeof value === 'number') && !values.every(isDate)) {
        throw new KqlError("'between' requires all numeric values or all datetime values; timespan bounds are not supported.", e.pos);
      }
      const [value, lo, hi] = values.map(toNumber);
      if (![value, lo, hi].every(Number.isFinite)) return null;
      const inside = value >= lo && value <= hi;
      return e.negated ? !inside : inside;
    }

    case 'bin':
      return evalBinary(e, row, ctx);
  }
}

function evalBinary(e: Extract<Expr, { k: 'bin' }>, row: Row, ctx: Ctx): KValue {
  // short-circuit logical operators
  if (e.op === 'and') {
    return truthy(evalExpr(e.l, row, ctx)) && truthy(evalExpr(e.r, row, ctx));
  }
  if (e.op === 'or') {
    return truthy(evalExpr(e.l, row, ctx)) || truthy(evalExpr(e.r, row, ctx));
  }

  const l = evalExpr(e.l, row, ctx);
  const r = evalExpr(e.r, row, ctx);

  switch (e.op) {
    case '==':
      return eq(l, r);
    case '!=':
      return !eq(l, r);
    case '<':
      return cmp(l, r) < 0;
    case '<=':
      return cmp(l, r) <= 0;
    case '>':
      return cmp(l, r) > 0;
    case '>=':
      return cmp(l, r) >= 0;
    case '=~':
      return s(l).toLowerCase() === s(r).toLowerCase();
    case '!~':
      return s(l).toLowerCase() !== s(r).toLowerCase();
    case 'contains':
      return s(l).toLowerCase().includes(s(r).toLowerCase());
    case '!contains':
      return !s(l).toLowerCase().includes(s(r).toLowerCase());
    case 'contains_cs':
      return s(l).includes(s(r));
    case 'has':
      return hasToken(s(l), s(r), false);
    case '!has':
      return !hasToken(s(l), s(r), false);
    case 'has_cs':
      return hasToken(s(l), s(r), true);
    case 'startswith':
      return s(l).toLowerCase().startsWith(s(r).toLowerCase());
    case 'endswith':
      return s(l).toLowerCase().endsWith(s(r).toLowerCase());
    case 'matches': {
      // Both the pattern and the subject come from the player, so a
      // catastrophically backtracking pattern like `(a+)+$` against a long
      // near-match can lock the browser tab solid. See safeRegex.
      const subject = s(l);
      const re = safeRegex(s(r), subject);
      return re ? re.test(subject) : false;
    }
    case 'in':
      return Array.isArray(r) && r.some((v) => eq(l, v));
    case 'in~':
      return Array.isArray(r) && r.some((v) => s(l).toLowerCase() === s(v).toLowerCase());
    case '!in':
      return Array.isArray(r) && !r.some((v) => eq(l, v));
    case '+': {
      if (typeof l === 'string' || typeof r === 'string') return s(l) + s(r);
      if (isDate(l) && isTimespan(r)) return new Date(l.getTime() + r.ms);
      return toNumber(l) + toNumber(r);
    }
    case '-': {
      if (isDate(l) && isDate(r)) return timespan(l.getTime() - r.getTime());
      if (isDate(l) && isTimespan(r)) return new Date(l.getTime() - r.ms);
      return toNumber(l) - toNumber(r);
    }
    case '*':
      return toNumber(l) * toNumber(r);
    case '/': {
      const d = toNumber(r);
      return d === 0 ? null : toNumber(l) / d;
    }
    case '%':
      return toNumber(l) % toNumber(r);
    default:
      throw new KqlError(`Unsupported operator '${e.op}'.`, e.pos);
  }
}

// ---- naming ----------------------------------------------------------------

function defaultName(e: Expr, index: number): string {
  switch (e.k) {
    case 'col':
      return e.name;
    case 'member':
      return e.name;
    case 'call': {
      // bin(TimeGenerated, 1h) keeps the source column name, like real KQL
      if ((e.name === 'bin' || e.name === 'startofday' || e.name === 'startofhour') && e.args[0]) {
        return defaultName(e.args[0], index);
      }
      const inner = e.args[0] ? defaultName(e.args[0], index) : '';
      switch (e.name) {
        case 'count':
          return 'count_';
        case 'countif':
          return 'countif_';
        case 'dcount':
          return `dcount_${inner}`;
        case 'sum':
          return `sum_${inner}`;
        case 'avg':
          return `avg_${inner}`;
        case 'min':
          return `min_${inner}`;
        case 'max':
          return `max_${inner}`;
        case 'make_set':
          return `set_${inner}`;
        case 'make_list':
          return `list_${inner}`;
        default:
          return `${e.name}_${inner || index}`;
      }
    }
    default:
      return `Column${index + 1}`;
  }
}

const nameOf = (item: NamedExpr, index: number) => item.name ?? defaultName(item.expr, index);

// ---- aggregation -----------------------------------------------------------

interface AggOutput {
  columns: string[];
  compute: (group: Row[], out: Row) => void;
}

function buildAggregate(
  item: NamedExpr,
  index: number,
  ctx: Ctx,
  sourceCols: string[],
  byNames: string[],
): AggOutput {
  const e = item.expr;
  if (e.k !== 'call' || !AGGREGATES.has(e.name)) {
    throw new KqlError(
      `'summarize' expects an aggregation function, e.g. count() or arg_max().`,
      e.k === 'col' ? e.pos : -1,
      "Did you mean to put this after 'by'?",
    );
  }

  const argVals = (group: Row[], arg: Expr) => group.map((r) => evalExpr(arg, r, ctx));

  // Every aggregate except count() needs a value to aggregate. Without this
  // check, `summarize dcount()` reached evalExpr(undefined, ...) and surfaced
  // a raw TypeError instead of a diagnostic message.
  if (e.name !== 'count' && e.args.length === 0) {
    throw new KqlError(
      `'${e.name}()' needs a column to work on.`,
      e.pos,
      `Try ${e.name}(Computer). Only count() can be used with no arguments.`,
    );
  }

  // arg_max / arg_min expand into several columns
  if (e.name === 'arg_max' || e.name === 'arg_min') {
    if (e.args.length < 1) {
      throw new KqlError(`'${e.name}' needs at least one argument.`, e.pos, `Try: ${e.name}(TimeGenerated, *)`);
    }
    const keyExpr = e.args[0];
    const keyName = item.name ?? defaultName(keyExpr, index);
    const rest = e.args.slice(1);
    const star = rest.some((a) => a.k === 'star') || rest.length === 0;
    const explicit = rest.filter((a) => a.k !== 'star');
    const explicitNames = explicit.map((a, i) => defaultName(a, i));
    // `*` carries every other column through, minus the key and the by-columns
    const projected = star
      ? sourceCols.filter((c) => c !== keyName && !byNames.includes(c))
      : explicitNames;
    const sign = e.name === 'arg_max' ? 1 : -1;

    return {
      columns: [keyName, ...projected],
      compute: (group, out) => {
        let bestRow: Row | null = null;
        let bestKey: KValue = null;
        for (const r of group) {
          const k = evalExpr(keyExpr, r, ctx);
          if (k === null) continue;
          if (bestRow === null || cmp(k, bestKey) * sign > 0) {
            bestRow = r;
            bestKey = k;
          }
        }
        out[keyName] = bestKey;
        if (star) {
          for (const c of projected) out[c] = bestRow ? (bestRow[c] ?? null) : null;
        } else {
          explicit.forEach((a, i) => {
            out[explicitNames[i]] = bestRow ? evalExpr(a, bestRow, ctx) : null;
          });
        }
      },
    };
  }

  const outName = nameOf(item, index);

  const compute: AggOutput['compute'] = (group, out) => {
    switch (e.name) {
      case 'count':
        out[outName] = group.length;
        return;
      case 'countif':
        out[outName] = group.filter((r) => truthy(evalExpr(e.args[0], r, ctx))).length;
        return;
      case 'dcount': {
        const seen = new Set(argVals(group, e.args[0]).map((v) => s(v)));
        out[outName] = seen.size;
        return;
      }
      case 'sum':
        out[outName] = argVals(group, e.args[0]).reduce<number>((t, v) => t + (toNumber(v) || 0), 0);
        return;
      case 'avg': {
        const nums = argVals(group, e.args[0]).map(toNumber).filter((n) => !isNaN(n));
        out[outName] = nums.length ? nums.reduce((t, v) => t + v, 0) / nums.length : null;
        return;
      }
      case 'min':
      case 'max': {
        const vals = argVals(group, e.args[0]).filter((v) => v !== null);
        if (!vals.length) {
          out[outName] = null;
          return;
        }
        const sign = e.name === 'max' ? 1 : -1;
        out[outName] = vals.reduce((m, v) => (cmp(v, m) * sign > 0 ? v : m));
        return;
      }
      case 'make_set': {
        const seen = new Map<string, KValue>();
        for (const v of argVals(group, e.args[0])) if (v !== null) seen.set(s(v), v);
        out[outName] = [...seen.values()];
        return;
      }
      case 'make_list':
        out[outName] = argVals(group, e.args[0]).filter((v) => v !== null);
        return;
      default:
        throw new KqlError(`Unsupported aggregation '${e.name}'.`, e.pos);
    }
  };

  return { columns: [outName], compute };
}

// ---- pipeline --------------------------------------------------------------

/** Star-only matching with bounded O(pattern length * column length) work, no user regex. */
function matchesColumn(pattern: string, column: string): boolean {
  let matches = Array<boolean>(column.length + 1).fill(false);
  matches[0] = true;
  for (const char of pattern) {
    const next = Array<boolean>(column.length + 1).fill(false);
    next[0] = char === '*' && matches[0];
    for (let i = 1; i <= column.length; i++) {
      next[i] = char === '*' ? matches[i] || next[i - 1] : matches[i - 1] && char === column[i - 1];
    }
    matches = next;
  }
  return matches[column.length];
}

function searchDatabase(term: string, db: Database, pos: number): Table {
  if (!/^[A-Za-z0-9_]+$/.test(term)) {
    throw new KqlError('search supports only one non-empty quoted term (letters, digits and underscores).', pos);
  }
  const columns = ['$table', ...new Set(Object.values(db).flatMap((table) => table.columns).filter((c) => c !== '$table'))];
  const rows: Row[] = [];
  // Search only supplied tables. Existing has-token semantics deliberately include underscores.
  for (const [name, table] of Object.entries(db)) {
    const declared = new Set(table.columns);
    for (const row of table.rows) {
      if (!table.columns.some((column) =>
        Object.hasOwn(row, column) && hasToken(s(row[column] ?? null), term, false))) continue;
      rows.push(Object.fromEntries(columns.map((column) =>
        [column, column === '$table' ? name :
          (declared.has(column) && Object.hasOwn(row, column) ? row[column] ?? null : null)])));
    }
  }
  return { name: 'search', columns, rows };
}

function applySort(rows: Row[], items: SortItem[], ctx: Ctx): Row[] {
  return [...rows].sort((a, b) => {
    for (const it of items) {
      const c = cmp(evalExpr(it.expr, a, ctx), evalExpr(it.expr, b, ctx));
      if (c !== 0) return it.desc ? -c : c;
    }
    return 0;
  });
}

export function evaluate(query: Query, db: Database, opts: EvalOptions = {}): Table {
  const now = opts.now ?? new Date();
  const maxRows = opts.maxRows ?? 20_000;

  const sourceKey = Object.keys(db).find(
    (k) => k.toLowerCase() === query.table.toLowerCase(),
  );
  if (query.search === undefined && !sourceKey) {
    const suggestion = didYouMean(query.table, Object.keys(db));
    throw new KqlError(
      `Unknown table '${query.table}'.`,
      query.tablePos,
      suggestion
        ? `Did you mean '${suggestion}'?`
        : `Available tables: ${Object.keys(db).join(', ')}.`,
    );
  }

  const source = query.search === undefined
    ? db[sourceKey!]
    : searchDatabase(query.search, db, query.tablePos);
  let rows: Row[] = source.rows;
  let columns: string[] = [...source.columns];
  const ctx: Ctx = { now, columns };

  const setColumns = (cols: string[]) => {
    columns = cols;
    ctx.columns = cols;
  };

  for (const [opIndex, op] of query.ops.entries()) {
    switch (op.kind) {
      case 'where':
        rows = rows.filter((r) => truthy(evalExpr(op.expr, r, ctx)));
        break;

      case 'take':
        rows = rows.slice(0, Math.max(0, op.n));
        break;

      case 'count':
        rows = [{ Count: rows.length }];
        setColumns(['Count']);
        break;

      case 'project-away':
      case 'project-keep': {
        // Missing names/patterns match nothing. Keep and away are complements,
        // both preserving the original schema order and every input row.
        const names = columns.filter((column) => {
          const matched = op.patterns.some((pattern) => matchesColumn(pattern, column));
          return op.kind === 'project-keep' ? matched : !matched;
        });
        rows = rows.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null])));
        setColumns(names);
        break;
      }

      case 'project-rename': {
        const renames = new Map<string, string>();
        for (const item of op.items) {
          if (!columns.includes(item.oldName)) {
            throw new KqlError(`Unknown column '${item.oldName}' in project-rename.`, item.pos);
          }
          if (renames.has(item.oldName)) {
            throw new KqlError(`Column '${item.oldName}' is renamed more than once.`, item.pos);
          }
          renames.set(item.oldName, item.name);
        }
        const names = columns.map((name) => renames.get(name) ?? name);
        if (new Set(names).size !== names.length) {
          throw new KqlError('project-rename would produce duplicate column names.', op.items[0]?.pos);
        }
        rows = rows.map((row) => Object.fromEntries(columns.map((name, i) => [names[i], row[name] ?? null])));
        setColumns(names);
        break;
      }

      case 'render':
        if (opIndex !== query.ops.length - 1 ||
            !['timechart', 'columnchart'].includes(op.visualization)) {
          throw new KqlError("'render' supports only a final timechart or columnchart without properties.");
        }
        break;

      case 'project': {
        const names = op.items.map(nameOf);
        rows = rows.map((r) => {
          const out: Row = {};
          op.items.forEach((it, i) => {
            out[names[i]] = evalExpr(it.expr, r, ctx);
          });
          return out;
        });
        setColumns(names);
        break;
      }

      case 'extend': {
        const names = op.items.map(nameOf);
        rows = rows.map((r) => {
          const out: Row = { ...r };
          op.items.forEach((it, i) => {
            out[names[i]] = evalExpr(it.expr, out, ctx);
          });
          return out;
        });
        setColumns([...columns, ...names.filter((n) => !columns.includes(n))]);
        break;
      }

      case 'distinct': {
        const names = op.items.map(nameOf);
        const seen = new Set<string>();
        const out: Row[] = [];
        for (const r of rows) {
          const projected: Row = {};
          op.items.forEach((it, i) => {
            projected[names[i]] = evalExpr(it.expr, r, ctx);
          });
          const key = names.map((n) => s(projected[n])).join('\u0001');
          if (!seen.has(key)) {
            seen.add(key);
            out.push(projected);
          }
        }
        rows = out;
        setColumns(names);
        break;
      }

      case 'summarize': {
        const byNames = op.by.map(nameOf);
        const sourceCols = columns;
        const aggs = op.aggs.map((it, i) => buildAggregate(it, i, ctx, sourceCols, byNames));

        const groups = new Map<string, { key: Row; rows: Row[] }>();
        for (const r of rows) {
          const key: Row = {};
          op.by.forEach((it, i) => {
            key[byNames[i]] = evalExpr(it.expr, r, ctx);
          });
          const k = byNames.map((n) => s(key[n])).join('\u0001');
          const existing = groups.get(k);
          if (existing) existing.rows.push(r);
          else groups.set(k, { key, rows: [r] });
        }

        // no `by` clause means one implicit group over everything
        if (op.by.length === 0 && groups.size === 0) {
          groups.set('', { key: {}, rows: [] });
        }

        const out: Row[] = [];
        for (const g of groups.values()) {
          const row: Row = { ...g.key };
          for (const agg of aggs) agg.compute(g.rows, row);
          out.push(row);
        }
        rows = out;
        setColumns([...byNames, ...aggs.flatMap((a) => a.columns)]);
        break;
      }

      case 'sort':
        rows = applySort(rows, op.items, ctx);
        break;

      case 'top':
        rows = applySort(rows, op.items, ctx).slice(0, Math.max(0, op.n));
        break;
    }

    if (rows.length > maxRows) {
      throw new KqlError(`Query produced more than ${maxRows} rows. Add a filter or 'take'.`);
    }
  }

  if (query.search !== undefined && rows.length > maxRows) {
    throw new KqlError(`Query produced more than ${maxRows} rows. Add a filter or 'take'.`);
  }
  return { name: source.name, columns, rows };
}
