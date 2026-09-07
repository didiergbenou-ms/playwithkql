/**
 * Engine + content regression harness.
 * Validates that the mini-KQL engine behaves like KQL *and* that every
 * authored challenge in Case 001 is actually solvable by its own solution.
 */
import { runQuery, KqlError, toDisplayString } from '../src/kql/index';
import { gradeChallenge } from '../src/kql/challenge';
import { applyCompletion, completionsFor } from '../src/kql/complete';
import { buildHighlightSchema, highlightKql } from '../src/kql/highlight';
import { formatKql, pipeNeedsNewline, withSourceTable } from '../src/kql/format';
import { parseLevel, TILE } from '../src/game/levels/heartbeatHills';
import { jumpApex } from '../src/game/physics';
import { analyse, buildGrid, reachableSpots } from '../src/game/reach';
import { CHARACTERS } from '../src/game/characters';
import { FLOOR_PROPS } from '../src/game/propSprites';
import { bus } from '../src/game/bus';
import { TRACKS, ROOM_TRACKS, midiToFreq, noteToMidi, parsePattern, trackForRoom } from '../src/game/music';
import { DEFAULT_SETTINGS } from '../src/game/audio';
import {
  buildDatabase,
  CASE_NOW,
  CHALLENGES,
  MACHINES,
  OUTAGE_START,
  PROXY_HOST,
  CULPRIT,
  TABLE_META,
  ROOT_CAUSES,
} from '../src/data/case001';
import { useStore, hintsSeen, solveTier } from '../src/state/store';

const db = buildDatabase();
const opts = { now: CASE_NOW };

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const run = (q: string) => runQuery(q, db, opts).table;

// ---- dataset shape ---------------------------------------------------------

check('dataset: heartbeat row count is deterministic', () => {
  eq(db.Heartbeat.rows.length, 1009, 'Heartbeat rows');
});

check('dataset: 8 machines, 5 silent', () => {
  eq(MACHINES.length, 8, 'machines');
  eq(MACHINES.filter((m) => m.silent).length, 5, 'silent machines');
});

// ---- operators -------------------------------------------------------------

check('distinct returns unique machines', () => {
  const t = run('Heartbeat | distinct Computer');
  eq(t.rows.length, 8, 'rows');
  eq(t.columns.join(','), 'Computer', 'columns');
});

check('where + ago + summarize count() by', () => {
  const t = run('Heartbeat | where TimeGenerated > ago(24h) | summarize count() by Computer');
  eq(t.rows.length, 3, 'live machines');
  eq(t.columns.join(','), 'Computer,count_', 'columns');
  assert(
    t.rows.every((r) => r.count_ === 96),
    'each live machine should have 96 heartbeats in 24h',
  );
});

check('summarize arg_max(TimeGenerated, *) keeps whole row', () => {
  const t = run('Heartbeat | summarize arg_max(TimeGenerated, *) by Computer');
  eq(t.rows.length, 8, 'rows');
  assert(t.columns.includes('Version'), 'arg_max(*) should carry Version through');
  eq(t.columns.filter((c) => c === 'Computer').length, 1, 'Computer must not be duplicated');
  eq(t.columns[0], 'Computer', 'by-column comes first');
  const silent = t.rows.filter((r) => (r.TimeGenerated as Date).getTime() === OUTAGE_START.getTime());
  eq(silent.length, 5, 'machines whose last contact is the outage instant');
});

check('count operator produces a Count column', () => {
  const t = run('Heartbeat | where Computer == "CONTOSO-DC-01" | count');
  eq(t.columns.join(','), 'Count', 'columns');
  eq(t.rows[0].Count as number, 193, 'row count');
});

check('sort defaults to descending, asc is explicit', () => {
  const desc = run('Heartbeat | summarize c = count() by Computer | sort by c');
  const asc = run('Heartbeat | summarize c = count() by Computer | sort by c asc');
  assert((desc.rows[0].c as number) >= (desc.rows[7].c as number), 'sort by should default desc');
  assert((asc.rows[0].c as number) <= (asc.rows[7].c as number), 'asc should ascend');
});

check('top N by', () => {
  const t = run('Heartbeat | summarize c = count() by Computer | top 3 by c');
  eq(t.rows.length, 3, 'rows');
});

check('project renames and reorders columns', () => {
  const t = run('Heartbeat | project Machine = Computer, TimeGenerated | take 1');
  eq(t.columns.join(','), 'Machine,TimeGenerated', 'columns');
});

check('extend adds a computed column', () => {
  const t = run('Heartbeat | take 1 | extend Tag = strcat(Computer, "/", OSType)');
  assert(String(t.rows[0].Tag).includes('/'), 'strcat should join');
});

check('has is token-based, contains is substring', () => {
  const has = run('AmaDiagnostics | where Message has "handshake" | count');
  const contains = run('AmaDiagnostics | where Message contains "handshak" | count');
  assert((has.rows[0].Count as number) > 0, 'has should match a whole word');
  eq(contains.rows[0].Count as number, has.rows[0].Count as number, 'partial-word contains');
  const noHas = run('AmaDiagnostics | where Message has "handshak" | count');
  eq(noHas.rows[0].Count as number, 0, 'has must not match a partial word');
});

check('in operator', () => {
  const t = run('Heartbeat | where Computer in ("CONTOSO-DC-01", "CONTOSO-SQL-01") | distinct Computer');
  eq(t.rows.length, 2, 'rows');
});

check('dcount / min / max aggregates', () => {
  const t = run(
    'Heartbeat | summarize Machines = dcount(Computer), First = min(TimeGenerated), Last = max(TimeGenerated)',
  );
  eq(t.rows[0].Machines as number, 8, 'dcount');
  eq((t.rows[0].Last as Date).getTime(), CASE_NOW.getTime(), 'max TimeGenerated');
});

check('bin() buckets timestamps', () => {
  const t = run('Heartbeat | summarize count() by bin(TimeGenerated, 1h)');
  eq(t.columns[0], 'TimeGenerated', 'bin keeps the source column name');
  eq(t.rows.length, 49, 'hourly buckets across 48h inclusive');
});

check('parse_json walks into dynamic properties', () => {
  const t = run(
    'AzureActivity | extend p = parse_json(Properties) | where isnotempty(p.settings.proxy.url) | project TimeGenerated, Caller, ProxyUrl = p.settings.proxy.url',
  );
  eq(t.rows.length, 1, 'exactly one proxy change');
  eq(t.rows[0].Caller as string, CULPRIT, 'caller');
  eq(t.rows[0].ProxyUrl as string, `http://${PROXY_HOST}`, 'proxy url');
});

// ---- error quality ---------------------------------------------------------

check('unknown column produces a did-you-mean hint', () => {
  try {
    run('Heartbeat | where Compter == "x"');
    throw new Error('should have thrown');
  } catch (err) {
    assert(err instanceof KqlError, 'should be a KqlError');
    eq((err as KqlError).hint, "Did you mean 'Computer'?", 'hint');
  }
});

check('unknown table produces a did-you-mean hint', () => {
  try {
    run('Heartbeet | count');
    throw new Error('should have thrown');
  } catch (err) {
    assert((err as KqlError).hint?.includes('Heartbeat'), 'should suggest Heartbeat');
  }
});

check('aggregate outside summarize is explained', () => {
  try {
    run('Heartbeat | where count() > 1');
    throw new Error('should have thrown');
  } catch (err) {
    assert((err as KqlError).message.includes('summarize'), 'should mention summarize');
  }
});

check('unknown operator is rejected with the supported list', () => {
  try {
    run('Heartbeat | wibble 5');
    throw new Error('should have thrown');
  } catch (err) {
    assert((err as KqlError).hint?.includes('summarize'), 'should list supported operators');
  }
});

// ---- challenge grading -----------------------------------------------------

for (const spec of CHALLENGES) {
  check(`challenge ${spec.id}: reference solution grades as correct`, () => {
    const r = gradeChallenge(spec, spec.solution, db, CASE_NOW);
    if (r.status !== 'correct') {
      throw new Error(`${r.status}: ${r.message}${r.diff ? ` | ${r.diff.join(' ')}` : ''}`);
    }
  });

  check(`challenge ${spec.id}: final hint contains a working query`, () => {
    const last = spec.hints[spec.hints.length - 1];
    const r = gradeChallenge(spec, last, db, CASE_NOW);
    eq(r.status, 'correct', `grading last hint of ${spec.id}`);
  });

  check(`challenge ${spec.id}: starter query is not already the answer`, () => {
    const r = gradeChallenge(spec, spec.starter, db, CASE_NOW);
    assert(r.status !== 'correct', 'starter must not solve the challenge for free');
  });
}

check('grading rejects the right answer via the wrong operator', () => {
  const spec = CHALLENGES.find((c) => c.id === 't3-alive')!;
  // correct machines, but reached with summarize instead of the required distinct
  const r = gradeChallenge(
    spec,
    'Heartbeat | where TimeGenerated > ago(24h) | summarize count() by Computer',
    db,
    CASE_NOW,
  );
  eq(r.status, 'incorrect', 'status');
});

check('grading reports a syntax error rather than crashing', () => {
  const r = gradeChallenge(CHALLENGES[0], 'Heartbeat | where |', db, CASE_NOW);
  eq(r.status, 'error', 'status');
  assert(r.message.length > 0, 'should carry a message');
});

check('grading explains a shape mismatch', () => {
  // uses the required operator, runs fine, but returns the wrong columns
  const spec = CHALLENGES.find((c) => c.id === 't2-fleet')!;
  const r = gradeChallenge(spec, 'Heartbeat | distinct Computer, OSType', db, CASE_NOW);
  eq(r.status, 'incorrect', 'status');
  assert((r.diff ?? []).length > 0, 'should describe the difference');
});

check('empty terminal is handled', () => {
  eq(gradeChallenge(CHALLENGES[0], '   ', db, CASE_NOW).status, 'error', 'status');
});

// ---- display ---------------------------------------------------------------

check('dates render readably', () => {
  assert(toDisplayString(OUTAGE_START).startsWith('2026-08-13 09:15'), 'date formatting');
});

// ---- autocomplete ----------------------------------------------------------

const labels = (src: string, caret = src.length) =>
  completionsFor(src, caret, TABLE_META, 20).items.map((i) => i.label);

check('completion: table names at the start', () => {
  const l = labels('');
  assert(l.includes('Heartbeat'), 'should offer Heartbeat');
  assert(l.includes('AzureActivity'), 'should offer AzureActivity');
  assert(!l.includes('where'), 'operators are not valid before a table');
});

check('completion: prefix filters tables', () => {
  eq(labels('Heart').join(','), 'Heartbeat', 'filtered tables');
});

check('completion: operators straight after a pipe', () => {
  const l = labels('Heartbeat | ');
  assert(l.includes('where'), 'should offer where');
  assert(l.includes('summarize'), 'should offer summarize');
  assert(!l.includes('Computer'), 'columns are not operators');
  eq(l[0], 'where', 'most common operator should rank first');
});

check('completion: columns after where — the context colleague-style lists miss', () => {
  const l = labels('Heartbeat | where ');
  assert(l.includes('Computer'), 'should offer Computer');
  assert(l.includes('TimeGenerated'), 'should offer TimeGenerated');
  assert(!l.includes('where'), 'should not re-offer the operator');
});

check('completion: aggregations after summarize', () => {
  const l = labels('Heartbeat | summarize ');
  assert(l.includes('arg_max'), 'should offer arg_max');
  assert(l.includes('dcount'), 'should offer dcount');
});

check('completion: grouping columns after by', () => {
  const l = labels('Heartbeat | summarize count() by ');
  assert(l.includes('Computer'), 'should offer Computer after by');
});

check('completion: only the queried table contributes columns', () => {
  const l = labels('AzureActivity | where ');
  assert(l.includes('Caller'), 'should offer Caller');
  assert(!l.includes('OSType'), 'Heartbeat columns must not leak in');
});

check('completion: functions insert an open paren', () => {
  const item = completionsFor('Heartbeat | where ago', 20, TABLE_META, 20).items.find(
    (i) => i.label === 'ago',
  );
  assert(item?.insert === 'ago(', 'ago should insert "ago("');
});

check('completion: applying an item replaces the partial word', () => {
  const src = 'Heartbeat | where Comp';
  const item = completionsFor(src, src.length, TABLE_META, 20).items[0];
  const out = applyCompletion(src, src.length, item);
  eq(out.text, 'Heartbeat | where Computer', 'applied text');
  eq(out.caret, out.text.length, 'caret lands at the end');
});

check('completion: a pipe inside a string does not shift context', () => {
  const l = labels('Heartbeat | where Computer == "a | b" and ');
  assert(l.includes('Computer'), 'still an expression context');
  assert(!l.includes('summarize'), 'must not think it is after a real pipe');
});

// ---- highlighter -----------------------------------------------------------

const hlSchema = buildHighlightSchema(TABLE_META);

check('highlighter: classifies the main token types', () => {
  const html = highlightKql('Heartbeat | where TimeGenerated > ago(24h) // note', hlSchema);
  assert(html.includes('tk-table'), 'table');
  assert(html.includes('tk-pipe'), 'pipe');
  assert(html.includes('tk-operator'), 'operator');
  assert(html.includes('tk-column'), 'column');
  assert(html.includes('tk-function'), 'function');
  assert(html.includes('tk-timespan'), 'timespan');
  assert(html.includes('tk-comment'), 'comment');
});

check('highlighter: never throws on partial or broken input', () => {
  for (const bad of ['Heartbeat | where "unclosed', '|||', 'summarize count(', '', '   ', '\\']) {
    highlightKql(bad, hlSchema);
  }
});

check('highlighter: escapes HTML so input cannot inject markup', () => {
  const html = highlightKql('where x == "<img src=x onerror=alert(1)>"', hlSchema);
  assert(!html.includes('<img'), 'raw tag must be escaped');
  assert(html.includes('&lt;img'), 'should be escaped form');
});

// ---- level integrity -------------------------------------------------------

check('level: no character can jump over a locked gate', () => {
  const level = parseLevel();
  const perColumn = new Map<number, { top: number; tiles: number }>();
  for (const g of level.gates) {
    const e = perColumn.get(g.col);
    if (e) {
      e.top = Math.min(e.top, g.row);
      e.tiles++;
    } else perColumn.set(g.col, { top: g.row, tiles: 1 });
  }
  assert(perColumn.size > 0, 'level should have gates');

  const maxApex = Math.max(...CHARACTERS.map((c) => jumpApex(c.stats.jump)));
  const surfaces = [...level.platforms, ...level.solids];
  const CEILING_Y = 0; // the physics world has a solid top edge

  for (const [col, gate] of perColumn) {
    // An earlier version of this test only considered a jump from the floor,
    // which missed the real bug: you can jump from a nearby platform.
    const near = surfaces.filter((s) => Math.abs(s.col - col) <= 10);
    const highestSurfaceRow = Math.min(...near.map((s) => s.row));
    const feetY = highestSurfaceRow * TILE;
    const reachY = Math.max(CEILING_Y, feetY - maxApex);

    assert(
      reachY >= gate.top * TILE,
      `gate at column ${col} (top row ${gate.top}) can be cleared: a jump from row ` +
        `${highestSurfaceRow} reaches y=${Math.round(reachY)}, above the gate top ` +
        `y=${gate.top * TILE}. Gates must run to the ceiling.`,
    );
  }
});

check('level: every gate runs from the ceiling down', () => {
  const level = parseLevel();
  const tops = new Map<number, number>();
  for (const g of level.gates) tops.set(g.col, Math.min(tops.get(g.col) ?? 99, g.row));
  for (const [col, top] of tops) {
    eq(top, 0, `gate column ${col} must start at row 0`);
  }
});

check('sprites: no trailing blank rows, which would make props hover', () => {
  // Props are drawn with origin (0.5, 1); a transparent bottom row lifts the
  // visible art off the floor.
  const blank = (row: string) => /^[.\s]*$/.test(row);
  for (const p of FLOOR_PROPS) {
    assert(p.rows.length > 0, `${p.name} has no rows`);
    assert(!blank(p.rows[p.rows.length - 1]), `${p.name} ends with a blank row and will hover`);
    const width = p.rows[0].length;
    assert(
      p.rows.every((r) => r.length === width),
      `${p.name} has ragged rows, which shifts the art sideways`,
    );
  }
});

check('level: every challenge has a terminal placed in the world', () => {
  const level = parseLevel();
  eq(level.terminals.length, CHALLENGES.length, 'terminal count');
  const indices = level.terminals.map((t) => t.challengeIndex).sort();
  eq(indices.join(','), CHALLENGES.map((_, i) => i).join(','), 'each challenge appears once');
});

check('level: every gate a challenge unlocks actually exists', () => {
  const level = parseLevel();
  const placed = new Set(level.gates.map((g) => g.gateId));
  for (const c of CHALLENGES) {
    if (!c.unlocksGate) continue;
    assert(placed.has(c.unlocksGate), `${c.id} unlocks ${c.unlocksGate}, which is not in the level`);
  }
});

check('level: spawn and verdict console exist', () => {
  const level = parseLevel();
  assert(level.verdict !== null, 'verdict console must be placed');
  assert(level.spawn.x > 0, 'spawn must be set');
});

check('level: teaching content is present for every challenge', () => {
  for (const c of CHALLENGES) {
    assert(c.concept.title.length > 0, `${c.id} needs a concept title`);
    assert(c.concept.body.length > 40, `${c.id} needs a real explanation`);
    assert(c.concept.example.query.length > 0, `${c.id} needs a worked example`);
  }
});

check('level: every worked example actually runs', () => {
  for (const c of CHALLENGES) {
    const t = run(c.concept.example.query);
    assert(t.columns.length > 0, `${c.id} example produced no columns`);
  }
});

// ---- formatting ------------------------------------------------------------

check('format: puts every pipe on its own line', () => {
  eq(
    formatKql('Heartbeat | where OSType == "Linux" | summarize count() by Computer'),
    'Heartbeat\n| where OSType == "Linux"\n| summarize count() by Computer',
    'formatted',
  );
});

check('format: leaves a pipe inside a string alone', () => {
  eq(
    formatKql('AmaDiagnostics | where Message has "a | b"'),
    'AmaDiagnostics\n| where Message has "a | b"',
    'string-safe',
  );
});

check('format: leaves a pipe inside a comment alone', () => {
  eq(
    formatKql('Heartbeat // a | b\n| count'),
    'Heartbeat // a | b\n| count',
    'comment-safe',
  );
});

check('format: is idempotent', () => {
  const once = formatKql('Heartbeat | where true | count');
  eq(formatKql(once), once, 'second pass changes nothing');
});

check('format: collapses messy whitespace but keeps a trailing pipe', () => {
  eq(formatKql('Heartbeat   |    count'), 'Heartbeat\n| count', 'collapsed');
  eq(formatKql('Heartbeat | '), 'Heartbeat\n|', 'trailing pipe survives');
});

check('format: a query with no pipe is untouched apart from trimming', () => {
  eq(formatKql('  Heartbeat  '), 'Heartbeat', 'no pipe');
});

check('format: formatted queries still parse and grade correctly', () => {
  for (const spec of CHALLENGES) {
    const r = gradeChallenge(spec, formatKql(spec.solution), db, CASE_NOW);
    eq(r.status, 'correct', `formatted solution for ${spec.id}`);
  }
});

check('format: formatted worked examples still run', () => {
  for (const spec of CHALLENGES) {
    const t = run(formatKql(spec.concept.example.query));
    assert(t.columns.length > 0, `${spec.id} example`);
  }
});

check('format: never throws on broken or partial input', () => {
  for (const bad of ['', '|', '||', 'Heartbeat | where "unclosed', '// only a comment', '\\', '😀 |']) {
    formatKql(bad);
  }
});

check('pipeNeedsNewline: only when the line already has content', () => {
  eq(pipeNeedsNewline('Heartbeat ', 10), true, 'after content');
  eq(pipeNeedsNewline('Heartbeat\n', 10), false, 'at start of a fresh line');
  eq(pipeNeedsNewline('Heartbeat\n  ', 12), false, 'only whitespace on the line');
  eq(pipeNeedsNewline('', 0), false, 'empty editor');
});

// ---- event bus -------------------------------------------------------------

check('bus: delivers to every listener', () => {
  const seen: string[] = [];
  const offA = bus.on('game:verdict', () => seen.push('a'));
  const offB = bus.on('game:verdict', () => seen.push('b'));
  bus.emit('game:verdict');
  offA();
  offB();
  eq(seen.join(','), 'a,b', 'both listeners ran');
});

check('bus: one throwing listener cannot block the others', () => {
  // This is what left the player on a black screen: a stale handler from a
  // destroyed scene threw and killed the rest of the emit chain.
  const seen: string[] = [];
  const originalError = console.error;
  console.error = () => {};
  const offBad = bus.on('game:verdict', () => {
    throw new Error('stale scene');
  });
  const offGood = bus.on('game:verdict', () => seen.push('good'));
  bus.emit('game:verdict');
  console.error = originalError;
  offBad();
  offGood();
  eq(seen.join(','), 'good', 'the healthy listener still ran');
});

check('bus: off() actually unsubscribes', () => {
  let hits = 0;
  const off = bus.on('game:verdict', () => hits++);
  bus.emit('game:verdict');
  off();
  bus.emit('game:verdict');
  eq(hits, 1, 'listener stopped after off()');
});

// ---- music -----------------------------------------------------------------

check('music: note names convert to the right MIDI numbers', () => {
  eq(noteToMidi('a4'), 69, 'a4');
  eq(noteToMidi('c4'), 60, 'c4');
  eq(noteToMidi('c#4'), 61, 'c sharp 4');
  eq(noteToMidi('bb3'), 58, 'b flat 3');
  eq(noteToMidi('.'), null, 'rest is not a note');
  eq(noteToMidi('-'), null, 'hold is not a note');
  eq(noteToMidi('zz9'), null, 'nonsense is not a note');
});

check('music: a440 and octave ratios are exact', () => {
  eq(Math.round(midiToFreq(69)), 440, 'a4');
  eq(Math.round(midiToFreq(81)), 880, 'a5 is an octave up');
  assert(Math.abs(midiToFreq(81) / midiToFreq(69) - 2) < 1e-9, 'octave is exactly 2:1');
});

check('music: patterns expand holds into note lengths', () => {
  const { events, steps } = parsePattern('a4 - - . c5 .');
  eq(steps, 6, 'step count');
  eq(events.length, 2, 'two notes');
  eq(events[0].len, 3, 'held note spans three steps');
  eq(events[1].step, 4, 'second note position');
  eq(events[1].len, 1, 'unheld note is one step');
});

check('music: rests break a hold', () => {
  const { events } = parsePattern('a4 . - -');
  eq(events.length, 1, 'one note');
  eq(events[0].len, 1, 'a rest ends the note, later holds do not revive it');
});

check('music: every track parses and loops on a whole number of bars', () => {
  const ids = Object.keys(TRACKS);
  assert(ids.length >= 6, 'expected a track per room plus menu and debrief');
  for (const id of ids) {
    const t = TRACKS[id];
    assert(t.bpm > 40 && t.bpm < 220, `${id} has an implausible tempo`);
    assert(t.channels.length > 0, `${id} has no channels`);
    for (const ch of t.channels) {
      const { events, steps } = parsePattern(ch.pattern);
      assert(steps % 16 === 0, `${id} channel is ${steps} steps — not a whole number of bars`);
      assert(events.length > 0, `${id} channel is silent`);
      for (const e of events) {
        if (e.drum) continue; // percussion carries no pitch
        assert(e.midi >= 12 && e.midi <= 108, `${id} note ${e.midi} is outside a sane range`);
        assert(e.step + e.len <= steps + 1, `${id} note runs past the end of the loop`);
      }
    }
  }
});

check('music: in-game loops are long enough not to grate', () => {
  // A four-bar loop at 128bpm repeats roughly every 7 seconds, which is what
  // made the first version annoying. Bar count is the real guard — it is what
  // measures how much distinct music exists. The seconds floor is secondary and
  // deliberately loose, because a fast track legitimately has a shorter loop in
  // wall-clock time while containing exactly as much material: the finale runs
  // at 146bpm, so its 16 bars come round in 26s rather than 40.
  for (const id of ROOM_TRACKS) {
    const t = TRACKS[id];
    const steps = parsePattern(t.channels[0].pattern).steps;
    const bars = steps / 16;
    const seconds = (steps * 60) / t.bpm / 4;
    assert(bars >= 16, `${id} is only ${bars} bars`);
    assert(seconds >= 24, `${id} loops every ${seconds.toFixed(1)}s — too short`);
  }
});

check('music: every track has drums', () => {
  // The first version had no percussion at all, which is the main reason it
  // sounded like a music box rather than a game soundtrack — on the NES the
  // noise channel carries most of a track's energy.
  for (const [id, t] of Object.entries(TRACKS)) {
    const noise = t.channels.filter((c) => c.voice === 'noise');
    assert(noise.length > 0, `${id} has no percussion channel`);
    const hits = noise.flatMap((c) => parsePattern(c.pattern).events);
    assert(hits.length > 0, `${id} has a drum channel but never hits anything`);
    assert(
      hits.every((h) => h.drum !== undefined),
      `${id} has pitched notes on a noise channel`,
    );
  }
});

check('music: leads use the narrow pulse timbres, not just square', () => {
  // A 50% square was the only lead tone before. The 12.5%/25% duty pulses are
  // the recognisable NES lead colours, and having two lets parts separate.
  for (const [id, t] of Object.entries(TRACKS)) {
    const pulses = t.channels.filter((c) => c.voice === 'pulse12' || c.voice === 'pulse25');
    assert(pulses.length > 0, `${id} uses no pulse voice`);
  }
});

check('music: drum patterns only contain real drums', () => {
  for (const [id, t] of Object.entries(TRACKS)) {
    for (const c of t.channels) {
      if (c.voice !== 'noise') continue;
      for (const tok of c.pattern.trim().split(/\s+/)) {
        assert(
          ['k', 's', 'h', 'o', '.', '-'].includes(tok),
          `${id} drum pattern has an unplayable token "${tok}"`,
        );
      }
    }
  }
});

check('music: the A and B halves of a room track actually differ', () => {
  // Doubling the bar count achieves nothing if the second half repeats the
  // first — the ear would still hear an 8-bar loop.
  for (const id of ROOM_TRACKS) {
    const t = TRACKS[id];
    const differs = t.channels.some((ch) => {
      const toks = ch.pattern.trim().split(/\s+/);
      const half = toks.length / 2;
      return toks.slice(0, half).join(' ') !== toks.slice(half).join(' ');
    });
    assert(differs, `${id} has identical halves — it is really an 8-bar loop`);
  }
});

check('music: each room has its own track', () => {
  eq(ROOM_TRACKS.length, 4, 'one per room');
  eq(new Set(ROOM_TRACKS).size, 4, 'all four must be different');
  for (const id of ROOM_TRACKS) assert(TRACKS[id] !== undefined, `${id} is not a real track`);
  eq(trackForRoom(0), 'office', 'first room');
  eq(trackForRoom(3), 'core', 'last room');
  eq(trackForRoom(99), 'core', 'out of range clamps');
  eq(trackForRoom(-1), 'office', 'negative clamps');
});

check('music: channels within a track share a loop length', () => {
  for (const id of Object.keys(TRACKS)) {
    const lengths = TRACKS[id].channels.map((c) => parsePattern(c.pattern).steps);
    const first = lengths[0];
    assert(
      lengths.every((l) => l === first),
      `${id} channels are ${lengths.join('/')} steps — they would drift apart`,
    );
  }
});

check('music: levels stay low enough to sit under the effects', () => {
  for (const id of Object.keys(TRACKS)) {
    const total = TRACKS[id].channels.reduce((t, c) => t + c.gain, 0);
    assert(total <= 0.45, `${id} channels sum to ${total.toFixed(2)} — too loud for background`);
  }
});

check('audio: default music volume is well below effects', () => {
  assert(
    DEFAULT_SETTINGS.musicVolume < DEFAULT_SETTINGS.sfxVolume,
    'music must not drown out feedback cues',
  );
  assert(DEFAULT_SETTINGS.musicVolume <= 0.4, 'music default should be quiet');
});

check('content: every evidence claim is visible in the query result', () => {
  // The terminal must never assert something the player cannot read on screen.
  for (const spec of CHALLENGES) {
    if (!spec.evidenceTokens?.length) continue;
    const t = run(spec.solution);
    const rendered = [
      t.columns.join(' '),
      ...t.rows.map((r) => t.columns.map((c) => toDisplayString(r[c] ?? null)).join(' ')),
    ].join('\n');

    for (const token of spec.evidenceTokens) {
      assert(
        rendered.includes(token),
        `${spec.id}: evidence mentions "${token}" but the result never shows it`,
      );
    }
  }
});

check('content: the case can be solved from the terminals alone', () => {
  // Everything the *verdict* rests on must be visible across the five results.
  // The culprit's name is deliberately NOT here: identifying who pushed the
  // change needs parse_json, which is Case 002 material. Level 1 ends at
  // "what broke", and the debrief reveals "who".
  const all = CHALLENGES.map((spec) => {
    const t = run(spec.solution);
    return t.rows
      .map((r) => t.columns.map((c) => toDisplayString(r[c] ?? null)).join(' '))
      .join('\n');
  }).join('\n');

  for (const needed of [PROXY_HOST, 'TLS handshake failed', '2026-08-13 09:15', '1.24.1']) {
    assert(all.includes(needed), `nothing in the case surfaces "${needed}" to the player`);
  }
});

check('content: Level 1 stays beginner-level', () => {
  // A pilot first level should not reach for the advanced operators. If these
  // appear here, the ramp has crept again.
  const advanced = ['arg_max', 'arg_min', 'parse_json', 'todynamic', 'join', 'make_set'];
  for (const spec of CHALLENGES) {
    for (const op of advanced) {
      assert(
        !spec.solution.toLowerCase().includes(op),
        `${spec.id} uses ${op}, which belongs in a later case`,
      );
    }
  }
});

check('content: each terminal adds at most one new idea', () => {
  // The whole point of the ramp: nothing should introduce two unfamiliar
  // concepts at once. Aggregations count as part of `summarize` rather than
  // separately — you cannot use one without the other, so "summarize max()"
  // is a single new idea, not two.
  const AGGREGATIONS = new Set(['count', 'max', 'min', 'sum', 'avg', 'dcount']);
  const concept = (op: string) => (AGGREGATIONS.has(op) ? 'summarize' : op);

  const seen = new Set<string>();
  for (const spec of CHALLENGES) {
    const ideas = [
      ...new Set((spec.requiredOperators ?? []).map((o) => concept(o.toLowerCase()))),
    ];
    const fresh = ideas.filter((o) => !seen.has(o));
    assert(
      fresh.length <= 1,
      `${spec.id} introduces ${fresh.length} new ideas at once (${fresh.join(', ')})`,
    );
    ideas.forEach((o) => seen.add(o));
  }
});

// ---- level reachability ----------------------------------------------------

/**
 * Characters have different jump multipliers, so a level that works as one
 * recruit can be impossible as another. Sparky's apex is ~47px against Vell's
 * ~66px, and the Data Center's final platform used to sit a 64px climb off the
 * floor — reachable only as Vell, with no way to tell as anyone else.
 */
check('level: every collectible and terminal is reachable by every character', () => {
  for (const c of CHARACTERS) {
    const report = analyse(c.id, c.stats.jump, c.stats.speed);
    assert(
      report.unreachableItems.length === 0,
      `${c.id} (apex ${jumpApex(c.stats.jump).toFixed(1)}px) cannot reach: ` +
        report.unreachableItems.map((i) => i.label).join(', '),
    );
  }
});

check('level: reachability has margin, not pixel-perfect jumps', () => {
  // "Technically reachable" is not good enough. Before this was fixed the level
  // needed a 0.97 multiplier and Sparky shipped at exactly 0.97 — every climb
  // was frame-perfect, which is why it felt broken rather than hard. Requiring
  // a weaker-than-shipping character to clear it keeps real headroom.
  const weakestShipped = Math.min(...CHARACTERS.map((c) => c.stats.jump));
  const slowestShipped = Math.min(...CHARACTERS.map((c) => c.stats.speed));
  const margin = 0.9;

  const report = analyse('margin-probe', weakestShipped * margin, slowestShipped * margin);
  assert(
    report.unreachableItems.length === 0,
    `no headroom: at ${(margin * 100).toFixed(0)}% of the weakest character these are unreachable: ` +
      report.unreachableItems.map((i) => i.label).join(', '),
  );
});

check('level: closed gates cannot be jumped, even by the best jumper', () => {
  // The counterpart to the test above. Making things reachable must not make
  // the locked doors optional — a player who can hop a gate skips the KQL
  // challenge, which is the entire game.
  const level = parseLevel();
  const grid = buildGrid(level, false);
  const firstGateX = Math.min(...level.gates.map((g) => g.x));
  const bestJump = Math.max(...CHARACTERS.map((c) => c.stats.jump));
  const bestSpeed = Math.max(...CHARACTERS.map((c) => c.stats.speed));

  const reached = reachableSpots(grid, bestJump, bestSpeed, {
    col: Math.floor(level.spawn.x / TILE),
    row: Math.floor(level.spawn.y / TILE),
    x: level.spawn.x,
    y: level.spawn.y,
  });

  const past = [...reached]
    .map((k) => Number(k.split(',')[0]) * TILE)
    .filter((x) => x > firstGateX);
  assert(past.length === 0, `${past.length} spots reachable beyond a closed gate`);
});


// ---- regressions from code review -----------------------------------------

check('format: string literals survive formatting untouched', () => {
  // A blanket whitespace collapse also rewrote the inside of quotes, so
  // pressing Format silently changed which rows a query matched.
  for (const [src, keep] of [
    ['Heartbeat | where C == "a  b"', '"a  b"'],
    ['Heartbeat | where C has "x   y"', '"x   y"'],
    ['Heartbeat|where C == "p  |  q"', '"p  |  q"'],
    ['Heartbeat | where C == "  edges  "', '"  edges  "'],
  ] as const) {
    const out = formatKql(src);
    assert(out.includes(keep), `formatting ${src} lost the literal ${keep} -> ${out}`);
  }
});

check('format: switching source table replaces it rather than prepending', () => {
  // The schema buttons used to produce `Heartbeat Heartbeat | take 10`, which
  // cannot parse - a baffling thing to hand a learner.
  //
  // Only the *parse* is asserted. Pointing a query at a table that lacks the
  // columns it references is a legitimate outcome of switching source, and the
  // engine is right to complain about that; what must never happen is a query
  // with two table names in it.
  for (const spec of CHALLENGES) {
    for (const table of TABLE_META.map((t) => t.name)) {
      const out = withSourceTable(formatKql(spec.starter), table);
      assert(out.startsWith(table), `${spec.id}: expected source ${table}, got ${out}`);
      try {
        runQuery(out, db, opts);
      } catch (err) {
        const msg = (err as Error).message;
        assert(
          !/after the query/i.test(msg),
          `${spec.id} + ${table}: produced an unparseable query (${msg}) -> ${out}`,
        );
      }
    }
  }
  eq(withSourceTable('', 'Heartbeat'), 'Heartbeat', 'empty query takes the table');
  assert(
    withSourceTable('| take 5', 'Heartbeat').startsWith('Heartbeat'),
    'a leading pipe means there is no source yet, so one is added',
  );
});

check('engine: absurdly long queries fail friendly, not with a RangeError', () => {
  // The depth guard only covered recursive descent. Flat chains build a
  // left-deep tree the evaluator recurses down, and unary chains bypassed the
  // guard entirely, so both escaped as a raw RangeError.
  const nasty = [
    `Heartbeat | where ${'!'.repeat(5000)}true`,
    `Heartbeat | where Version == ${'-'.repeat(5000)}1`,
    `Heartbeat | where 1 == ${Array(20000).fill('1').join(' + ')}`,
    `Heartbeat | where ${Array(20000).fill('true').join(' and ')}`,
    `Heartbeat | where ${'('.repeat(5000)}1${')'.repeat(5000)} == 1`,
  ];
  for (const q of nasty) {
    try {
      runQuery(q, db, opts);
    } catch (err) {
      assert(
        err instanceof KqlError,
        `expected a friendly error, got ${(err as Error).constructor.name}`,
      );
    }
  }
});

check('engine: the token budget leaves room for real queries', () => {
  // A guard that also refuses real queries is worse than no guard, so prove
  // there is headroom rather than assuming it.
  for (const spec of CHALLENGES) runQuery(spec.solution, db, opts);
  runQuery(`Heartbeat | where 1 == ${Array(500).fill('1').join(' + ')} | take 1`, db, opts);
});

check('engine: catastrophic regex is refused, ordinary regex still works', () => {
  // Pattern and subject are both player-supplied, so a backtracking blow-up
  // freezes the tab with no error and no way out.
  const subject = 'a'.repeat(46) + '!';
  for (const p of ['(a+)+$', '(a*)*$', '(a|aa)+$', '([a-z]+)*$', '((a)*)*$']) {
    const started = Date.now();
    runQuery(`Heartbeat | extend X = "${subject}" | where X matches "${p}" | take 1`, db, opts);
    const ms = Date.now() - started;
    assert(ms < 500, `pattern ${p} took ${ms}ms - backtracking is not bounded`);
  }
  const hits = runQuery('Heartbeat | where Computer matches "WEB-0[12]$" | distinct Computer', db, opts);
  assert(hits.table.rows.length > 0, 'an ordinary anchored pattern stopped matching');
});

check('scoring: a crystal-bought hint still counts as a hint', () => {
  // A crystal buys the hint free of *score*, not free of consequence - the
  // player still read it, so clean-solve and No Hints Needed must not apply.
  useStore.getState().resetProfile();
  useStore.getState().startRun(10, 3);
  // Crystals have to be picked up in the world; a fresh run has none.
  useStore.getState().setHud({ crystals: 3 });

  const id = CHALLENGES[0].id;
  useStore.getState().registerAttempt(id);
  assert(useStore.getState().spendCrystal(id), 'crystal should have been available');

  const prog = useStore.getState().run.challenges[id];
  eq(prog.hintsUsed, 0, 'score must not be penalised for a crystal hint');
  eq(prog.crystalHints, 1, 'the crystal hint must persist so it survives reopening');
  eq(hintsSeen(prog), 1, 'the player has seen a hint');
  assert(solveTier(prog) < 3, 'a hinted solve cannot be a perfect solve');
});

check('dev shortcuts: a dev run unlocks no achievements at all', () => {
  // devUsed guarded the verdict path only, but solving a challenge awards
  // achievements too, so dev solves still unlocked first-try and kusto-master.
  useStore.getState().resetProfile();
  useStore.getState().startRun(10, 3);
  useStore.getState().devSolve('all');

  const winner = ROOT_CAUSES.find((o) => o.correct);
  assert(!!winner, 'case has no correct root cause');
  useStore.getState().submitVerdict(winner!.id, true);

  const profile = useStore.getState().profile;
  eq(profile.achievements.length, 0, `dev run unlocked ${profile.achievements.join(', ')}`);
  eq(profile.casesClosed, 0, 'dev run closed a case');
  eq(profile.lifetimeScore, 0, 'dev run scored');
});

check('a clean run still earns achievements', () => {
  // The guard above must be conditional, not a blanket block.
  useStore.getState().resetProfile();
  useStore.getState().startRun(10, 3);
  for (const c of CHALLENGES) {
    useStore.getState().registerAttempt(c.id);
    useStore.getState().solveChallenge(c.id, c.solution);
  }
  const winner = ROOT_CAUSES.find((o) => o.correct)!;
  useStore.getState().submitVerdict(winner.id, true);

  const profile = useStore.getState().profile;
  assert(profile.achievements.length > 0, 'a real run earned nothing');
  eq(profile.casesClosed, 1, 'a real run should close the case');
});
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
