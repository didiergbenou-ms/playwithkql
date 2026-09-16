import { isTimespan, type KValue, type Row } from './types';

/** Comparison-only limits: never truncate an answer or fall back to display text. */
const MAX_VALUE_DEPTH = 128;

export class ResultComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResultComparisonError';
  }
}

type Encoded = string | boolean | Encoded[];

function numberKey(value: number): string {
  // NaN and infinities must not become JSON null. Numeric zero has one value,
  // regardless of its JavaScript sign bit.
  return String(value);
}

function isComparisonTimespan(value: unknown): boolean {
  // Timespan is structural in this engine. Its exact {kind, ms} shape is
  // reserved, even inside dynamic data; there is no provenance/brand to inspect.
  // Extra properties belong to a property bag and must not be discarded.
  return isTimespan(value) && typeof value.ms === 'number'
    && Object.keys(value).length === 2
    && Object.hasOwn(value, 'kind') && Object.hasOwn(value, 'ms');
}

/** Runtime types, not a schema inferred from the first row (tables may be mixed). */
export function comparisonType(value: KValue): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'datetime';
  if (Array.isArray(value)) return 'dynamic array';
  if (isComparisonTimespan(value)) return 'timespan';
  if (typeof value === 'object') return 'dynamic object';
  return typeof value;
}

/**
 * JSON frames every type, key and value, so user strings cannot inject separators.
 * Property bags ignore key order; arrays preserve element order. Invalid dates
 * have a stable datetime/NaN encoding, distinct from numbers, strings and null.
 * Nested undefined/unsupported values are rejected, not silently erased.
 */
export function valueSignature(value: KValue): string {
  const ancestors = new Set<object>();
  const encode = (v: unknown, depth: number): Encoded => {
    if (depth > MAX_VALUE_DEPTH) {
      throw new ResultComparisonError('Result values are nested too deeply to compare safely.');
    }
    if (v === null) return ['null'];
    switch (typeof v) {
      case 'boolean': return ['boolean', v];
      case 'number': return ['number', numberKey(v)];
      case 'string': return ['string', v];
      case 'object': break;
      default:
        throw new ResultComparisonError('Result contains an unsupported value type.');
    }
    if (v instanceof Date) return ['datetime', numberKey(v.getTime())];
    if (isTimespan(v) && isComparisonTimespan(v)) {
      return ['timespan', numberKey(v.ms)];
    }
    if (ancestors.has(v)) {
      throw new ResultComparisonError('Result contains a cyclic dynamic value.');
    }
    ancestors.add(v);
    try {
      if (Array.isArray(v)) {
        return ['array', ...Array.from(v, item => encode(item, depth + 1))];
      }
      const prototype = Object.getPrototypeOf(v);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new ResultComparisonError('Result contains an unsupported dynamic object.');
      }
      const bag = v as Record<string, unknown>;
      return ['object', ...Object.keys(bag).sort().map(key => [key, encode(bag[key], depth + 1)])];
    } finally {
      // Repeated references in separate branches are valid; only ancestors cycle.
      ancestors.delete(v);
    }
  };
  return JSON.stringify(encode(value, 0));
}

/** Missing/undefined table cells retain the existing null semantics. */
export function rowSignature(row: Row, columns: string[]): string {
  return JSON.stringify(columns.map(column => valueSignature(row[column] ?? null)));
}
