// Shared helpers for all KQL Detective dataset seeds.
// Everything here must be deterministic — no Date.now(), no Math.random().
// See KQL-Detective-Implementation-Spec.md §14.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
/** Output root. Mirrors the shipped game layout: content/datasets/<datasetId>/ (spec §9). */
export const DATASETS_ROOT = resolve(HERE, '..', '..', 'content', 'datasets');

/** Campaign-wide simulated "now". The engine must resolve now()/ago() against this (spec §1.1). */
export const QUERY_TIME = '2026-03-11T12:00:00Z';

/** Seeded PRNG. Same seed always yields the same sequence, across machines and Node versions. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO-8601 UTC, seconds precision, no milliseconds (spec §14 rule 4). */
export function iso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseUtc(s) {
  return new Date(s);
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Inclusive slot list from `start` to `end` stepping `stepMinutes`. */
export function timeSlots(startIso, endIso, stepMinutes) {
  const out = [];
  const end = parseUtc(endIso).getTime();
  for (let t = parseUtc(startIso); t.getTime() <= end; t = addMinutes(t, stepMinutes)) {
    out.push(new Date(t));
  }
  return out;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Writes only data.json and schema.json; Markdown assets are managed by the main integration.
 * @param {object} opts
 * @param {string} opts.datasetId
 * @param {Record<string, object[]>} opts.tables        table name -> rows
 * @param {Record<string, {name:string,type:string}[]>} opts.columns  table name -> column defs
 */
export function writeDataset({ datasetId, tables, columns }) {
  const dir = resolve(DATASETS_ROOT, datasetId);
  mkdirSync(dir, { recursive: true });

  const schema = {
    datasetId,
    queryTime: QUERY_TIME,
    tables: Object.keys(tables).map((name) => ({
      name,
      columns: columns[name],
      rowCount: tables[name].length, // CI tripwire, spec §12.8
    })),
  };

  writeFileSync(resolve(dir, 'data.json'), JSON.stringify(tables, null, 2) + '\n');
  writeFileSync(resolve(dir, 'schema.json'), JSON.stringify(schema, null, 2) + '\n');

  const counts = Object.entries(tables)
    .map(([t, rows]) => `${t}=${rows.length}`)
    .join(', ');
  console.log(`[seed] ${datasetId}: ${counts}`);
}

/** Assertion helper used by verify.mjs. Throws with a readable message. */
export function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
  console.log(`  ok  ${label}`);
}
