import assert from 'node:assert/strict';
import { CASE_STARTER, createCaseStarter } from '../src/authoring/caseStarter';
import { validateCase } from '../src/authoring/validateCase';
import { AUTHORING_CASES } from '../src/authoring/catalog';
import type { CaseDefinition } from '../src/data/cases/types';
import { CASES } from '../src/data/cases';
import { createPlaceholderCase } from '../src/data/cases/placeholder';
import { GATE_CHARS, HEARTBEAT_HILLS } from '../src/game/levels/heartbeatHills';
import { SIGNAL_HARBOR } from '../src/game/levels/signalHarbor';
import { RELAY_RUINS } from '../src/game/levels/relayRuins';
import { runQuery } from '../src/kql/index';
import type { Database, Table } from '../src/kql/types';

let passed = 0;
const failures: string[] = [];
function check(name: string, test: () => void) {
  try { test(); passed++; } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function rejects(name: string, mutate: (item: CaseDefinition) => void, expected: string) {
  check(name, () => {
    const item = createCaseStarter({ id: 'negative' });
    mutate(item);
    const errors = validateCase(item);
    assert.ok(errors.length > 0, 'invalid case was accepted');
    assert.ok(errors.every(error => error.startsWith('Case negative:')), errors.join('\n'));
    assert.ok(errors.some(error => error.includes(expected)), `missing "${expected}":\n${errors.join('\n')}`);
  });
}
function editDatabase(item: CaseDefinition, edit: (db: Database) => void) {
  const original = item.database;
  item.database = () => {
    const db = original();
    edit(db);
    return db;
  };
}

for (const item of AUTHORING_CASES) check(`${item.id}: valid authored content`, () => {
  assert.deepEqual(validateCase(item), []);
});

check('starter is independent content, never a selectable case', () => {
  assert.equal(CASE_STARTER.placeholder, false);
  assert.equal(CASE_STARTER.placeholderNotice, null);
  assert.equal(CASE_STARTER.now.toISOString(), '2026-09-01T12:00:00.000Z');
  assert.deepEqual(Object.keys(CASE_STARTER.database()), ['DeliveryLog', 'ConfigLog']);
  assert.ok(!('Heartbeat' in CASE_STARTER.database()));
  assert.ok(!CASES.some(item => item.id === CASE_STARTER.id));
});

for (const [id, level] of [['002', SIGNAL_HARBOR], ['003', RELAY_RUINS]] as const) {
  check(`independent ${id}: existing map with non-Heartbeat data and no placeholder requirement`, () => {
    const before = JSON.stringify(level);
    const item = createCaseStarter({ id, level });
    assert.equal(item.id, id);
    assert.equal(item.placeholder, false);
    assert.deepEqual(validateCase(item), []);
    assert.deepEqual(item.level.rooms.map(r => r.rows), level.rooms.map(r => r.rows));
    assert.ok(item.challenges.every(c => c.id.startsWith(`${id}-`)));
    assert.ok(item.level.notes.every(n => n.id.startsWith(`${id}-`)));
    assert.equal(JSON.stringify(level), before, 'factory changed the source map');
    assert.notEqual(item, CASES.find(c => c.id === id), 'factory touched the registry');
  });
}

// These are hand-written expected results, not answers computed from another query.
const expected: Pick<Table, 'columns' | 'rows'>[] = [
  {
    columns: ['TimeGenerated', 'Device', 'Route', 'Outcome', 'Detail'],
    rows: [
      { TimeGenerated: new Date('2026-09-01T11:20:00Z'), Device: 'packer-1', Route: 'Live', Outcome: 'Sent', Detail: 'Delivery accepted' },
      { TimeGenerated: new Date('2026-09-01T11:25:00Z'), Device: 'packer-2', Route: 'Live', Outcome: 'Sent', Detail: 'Delivery accepted' },
    ],
  },
  { columns: ['Device'], rows: [{ Device: 'packer-1' }, { Device: 'packer-2' }, { Device: 'cart-1' }] },
  {
    columns: ['Device', 'Detail'],
    rows: [
      { Device: 'packer-1', Detail: 'Unknown destination: Archive' },
      { Device: 'packer-2', Detail: 'Unknown destination: Archive' },
      { Device: 'packer-1', Detail: 'Unknown destination: Archive' },
    ],
  },
  { columns: ['Route', 'Failures'], rows: [{ Route: 'Archive', Failures: 3 }] },
  {
    columns: ['TimeGenerated', 'Scope', 'Value', 'Actor'],
    rows: [
      { TimeGenerated: new Date('2026-09-01T11:35:00Z'), Scope: 'packers', Value: 'Archive', Actor: 'ops-demo' },
      { TimeGenerated: new Date('2026-09-01T11:00:00Z'), Scope: 'packers', Value: 'Live', Actor: 'setup-demo' },
    ],
  },
];
for (const [index, lesson] of CASE_STARTER.challenges.entries()) {
  check(`${lesson.id}: solution and final hint match explicit result fixture`, () => {
    for (const query of [lesson.solution, lesson.hints.at(-1)!]) {
      const result = runQuery(query, CASE_STARTER.database(), { now: CASE_STARTER.now }).table;
      assert.deepEqual(result.columns, expected[index].columns);
      assert.deepEqual(result.rows, expected[index].rows);
    }
  });
}

check('starter worked examples have the advertised results', () => {
  const examples = CASE_STARTER.challenges.map(c =>
    runQuery(c.concept.example.query, CASE_STARTER.database(), { now: CASE_STARTER.now }).table);
  assert.equal(examples[0].rows[0].Value, 'Live');
  assert.deepEqual(examples[1].rows, [{ Outcome: 'Sent' }, { Outcome: 'Failed' }]);
  assert.deepEqual(examples[2].rows, [{ Device: 'cart-1', Detail: 'Delivery accepted' }]);
  assert.deepEqual(examples[3].rows, [{ Outcome: 'Sent', Attempts: 3 }, { Outcome: 'Failed', Attempts: 3 }]);
  assert.deepEqual(examples[4].rows.map(r => r.Device), ['packer-1', 'packer-2']);
});

check('fresh factories and database snapshots isolate all mutable authoring state', () => {
  const source = JSON.stringify(HEARTBEAT_HILLS);
  const left = createCaseStarter();
  const right = createCaseStarter();
  const before = JSON.stringify(right);
  left.now.setUTCFullYear(1999);
  left.challenges[0].concept.example.query = 'broken';
  left.challenges[0].hints.pop();
  left.challenges[0].requiredOperators!.push('broken');
  left.challenges[0].evidenceTokens!.push('broken');
  left.tableMeta[0].columns[0].doc = 'changed';
  left.level.rooms[0].rows[0] = '';
  left.level.notes[0].body = 'changed';
  left.level.gateChars.G = 'changed';
  left.evidence[0].detail = 'changed';
  left.rootCauses[0].label = 'changed';
  left.causalChain[0] = 'changed';
  left.email.body = 'changed';
  left.skills.pop();
  left.debrief.body = 'changed';
  left.musicTracks.pop();
  assert.equal(JSON.stringify(right), before);
  assert.equal(JSON.stringify(HEARTBEAT_HILLS), source);
  const a = right.database();
  const original = JSON.stringify(a);
  (a.DeliveryLog.rows[0].TimeGenerated as Date).setUTCFullYear(1999);
  a.DeliveryLog.rows[0].Device = 'mutated';
  a.DeliveryLog.rows.pop();
  a.DeliveryLog.columns.pop();
  delete a.ConfigLog;
  assert.equal(JSON.stringify(right.database()), original);
  assert.equal(JSON.stringify(CASE_STARTER.database()), original);
});

check('validation itself does not mutate content or registry', () => {
  const before = JSON.stringify(CASE_STARTER);
  const registry = CASES.slice();
  assert.deepEqual(validateCase(CASE_STARTER), []);
  assert.equal(JSON.stringify(CASE_STARTER), before);
  assert.deepEqual(CASES, registry);
});

check('placeholder behavior belongs to an explicit factory fixture', () => {
  const level = structuredClone(SIGNAL_HARBOR);
  level.gateChars = Object.fromEntries(Object.entries(GATE_CHARS).map(([char, id]) => [char, `casefixture-${id}`]));
  level.notes.forEach((note, index) => { note.id = `casefixture-note-${index}`; });
  const options = {
    id: 'fixture', title: 'Explicit placeholder', customer: 'Training fixture',
    summary: 'Reuses Case 001 for factory regression only.',
    placeholderNotice: 'Reuses Case 001 tasks and data; not an independent incident.',
    level, emailSubject: 'Case 001 training', emailBody: 'Factory fixture, not customer data.',
    debriefTitle: 'Reused proxy training', debriefBody: 'Case 001 content is intentionally reused.',
    debriefFollowUp: 'Author independent content before removing the placeholder notice.',
  };
  const item = createPlaceholderCase(options);
  assert.equal(item.placeholder, true);
  assert.match(item.placeholderNotice!, /Case 001/);
  assert.deepEqual(validateCase(item), []);
  assert.ok(item.challenges.every(c => c.id.startsWith('casefixture-')));
  assert.ok('Heartbeat' in item.database(), 'only the explicit placeholder fixture requires Heartbeat');
  assert.throws(() => createPlaceholderCase({ ...options, placeholderNotice: '' }), /notice/);
  assert.throws(() => createPlaceholderCase({ ...options, placeholderNotice: 'Independent incident' }), /Case 001/);
});

rejects('duplicate challenge ids', c => { c.challenges[1].id = c.challenges[0].id; }, 'challenge ids must be unique');
rejects('blank challenge id', c => { c.challenges[0].id = ''; }, 'challenge ids entry');
rejects('duplicate evidence ids', c => { c.evidence[1].id = c.evidence[0].id; }, 'evidence ids must be unique');
rejects('duplicate root cause ids', c => { c.rootCauses[1].id = c.rootCauses[0].id; }, 'root cause ids must be unique');
rejects('wrong evidence link', c => { c.challenges[0].evidenceId = 'missing'; }, 'negative-lesson-1 evidenceId');
rejects('bad causal link', c => { c.evidence[0].chainIndex = 99; }, 'chainIndex');
rejects('wrong challenge room', c => { c.challenges[0].room = 2; }, 'negative-lesson-1 room must match');
rejects('missing gate link', c => { c.challenges[0].unlocksGate = 'missing'; }, 'negative-lesson-1 unlocksGate');
rejects('wrong same-room gate', c => {
  [c.challenges[2].unlocksGate, c.challenges[3].unlocksGate] = [c.challenges[3].unlocksGate, c.challenges[2].unlocksGate];
}, 'negative-lesson-3 must unlock the next gate');
rejects('gate cannot be shared', c => { c.challenges[1].unlocksGate = c.challenges[0].unlocksGate; }, 'exactly one challenge');
rejects('gate cannot shadow a terminal', c => { c.level.gateChars['1'] = 'shadow'; }, 'nonreserved');
rejects('mapped gate needs cells', c => { c.level.gateChars.Z = 'unused'; }, 'gate unused has no map cells');
rejects('duplicate gate ids', c => { c.level.gateChars.H = c.level.gateChars.G; }, 'gate ids must be unique');
rejects('five lessons are mandatory', c => { c.challenges.pop(); }, 'exactly five challenges');
rejects('sixth lesson is unsupported', c => { c.challenges.push({ ...c.challenges[0], id: 'sixth' }); }, 'exactly five challenges');
rejects('duplicate terminal marker', c => { c.level.rooms[0].rows[0] = '1'; }, 'exactly one of each terminal');
rejects('missing terminal marker', c => {
  c.level.rooms[0].rows = c.level.rooms[0].rows.map(row => row.replace('1', ' '));
}, 'exactly one of each terminal');
rejects('unsupported map digit', c => { c.level.rooms[0].rows[0] = '6'; }, 'unsupported map character "6"');
rejects('missing note definition', c => { c.level.notes.pop(); }, 'note markers');
rejects('missing verdict', c => {
  c.level.rooms.forEach(room => { room.rows = room.rows.map(row => row.replace('V', ' ')); });
}, 'exactly one verdict');
rejects('invalid clock', c => { c.now = new Date('invalid'); }, 'now must be a valid Date');
rejects('blank objective', c => { c.challenges[0].prompt = ' '; }, 'negative-lesson-1 prompt');
rejects('missing wrong-verdict rebuttal', c => { delete c.rootCauses[1].rebuttal; }, 'rebuttal');
rejects('two correct verdicts', c => { c.rootCauses[1].correct = true; }, 'exactly one root cause');
rejects('no wrong verdict', c => { c.rootCauses = c.rootCauses.slice(0, 1); }, 'incorrect root cause');
rejects('too few progressive hints', c => { c.challenges[0].hints = [c.challenges[0].solution]; }, 'progressive hints');
rejects('broken solution', c => { c.challenges[0].solution = 'MissingTable | take 2'; }, 'negative-lesson-1 solution');
rejects('malformed worked example', c => { c.challenges[0].concept.example.query = 'DeliveryLog | where ('; }, 'negative-lesson-1 worked example');
rejects('unsupported KQL', c => { c.challenges[0].concept.example.query = 'DeliveryLog | join ConfigLog on Device'; }, 'negative-lesson-1 worked example');
rejects('incorrect final hint', c => { c.challenges[0].hints[2] = 'DeliveryLog | take 1'; }, 'negative-lesson-1 final hint is not accepted');
rejects('final hint needs required features', c => { c.challenges[0].hints[2] = 'DeliveryLog | top 2 by TimeGenerated asc'; }, 'negative-lesson-1 final hint is not accepted');
rejects('starter must not solve lesson', c => { c.challenges[0].starter = c.challenges[0].solution; }, 'negative-lesson-1 starter is already accepted');
rejects('equivalent starter must not solve lesson', c => { c.challenges[0].starter = 'DeliveryLog | take 2 | take 2'; }, 'starter is already accepted');
rejects('required features must be present', c => { c.challenges[0].requiredOperators = ['summarize']; }, 'solution is not accepted');
rejects('evidence must be a real output value', c => { c.challenges[0].evidenceTokens = ['not in this fixture']; }, 'absent from solution output');
rejects('column header alone is not evidence', c => { c.challenges[0].evidenceTokens = ['Device']; }, 'absent from solution output');
rejects('empty example is unhelpful', c => { c.challenges[0].concept.example.query = 'DeliveryLog | take 0'; }, 'worked example must return rows');
rejects('missing schema table', c => { c.tableMeta.pop(); }, 'tableMeta must describe every');
rejects('duplicate schema column', c => { c.tableMeta[0].columns[1].name = c.tableMeta[0].columns[0].name; }, 'metadata columns must be unique');
rejects('schema column mismatch', c => { c.tableMeta[0].columns[0].name = 'Other'; }, 'metadata columns must match');
rejects('empty database', c => { c.database = () => ({}); }, 'database must contain');
rejects('throwing database reports useful error', c => { c.database = () => { throw new Error('fixture factory failed'); }; }, 'database/schema: fixture factory failed');
rejects('table name mismatch', c => editDatabase(c, db => { db.DeliveryLog.name = 'Other'; }), 'name must match');
rejects('missing row column', c => editDatabase(c, db => { delete db.DeliveryLog.rows[0].Device; }), 'keys must match');
rejects('invalid Date cell', c => editDatabase(c, db => { db.DeliveryLog.rows[0].TimeGenerated = new Date('invalid'); }), 'expected datetime');
rejects('date strings are not Date cells', c => editDatabase(c, db => { db.DeliveryLog.rows[0].TimeGenerated = '2026-09-01T11:20:00Z'; }), 'expected datetime');
rejects('schema scalar type mismatch', c => editDatabase(c, db => { db.DeliveryLog.rows[0].Device = 42; }), 'expected string');
rejects('cached database snapshot', c => { const db = c.database(); c.database = () => db; }, 'fresh snapshots');
rejects('shallow cloned rows', c => {
  const db = c.database();
  c.database = () => Object.fromEntries(Object.entries(db).map(([name, t]) =>
    [name, { ...t, columns: [...t.columns], rows: [...t.rows] }]));
}, 'fresh snapshots');
rejects('shared Date hidden in otherwise fresh rows', c => {
  const date = new Date('2026-09-01T11:20:00Z');
  editDatabase(c, db => { db.DeliveryLog.rows[0].TimeGenerated = date; });
}, 'fresh snapshots');
rejects('changing data snapshots', c => {
  let count = 0;
  editDatabase(c, db => { db.DeliveryLog.rows[0].Device = `changing-${count++}`; });
}, 'deterministic snapshots');
rejects('JSON cloning must not erase Date types on alternate calls', c => {
  const original = c.database;
  let calls = 0;
  c.database = () => ++calls % 2 === 1 ? original() : JSON.parse(JSON.stringify(original()));
}, 'deterministic snapshots');

check('nested dynamic values and Dates are supported and cloned', () => {
  const item = createCaseStarter({ id: 'dynamic' });
  item.tableMeta[0].columns.push({ name: 'Payload', type: 'dynamic', doc: 'Synthetic nested payload.' });
  editDatabase(item, db => {
    db.DeliveryLog.columns.push('Payload');
    db.DeliveryLog.rows.forEach(row => { row.Payload = { tags: ['toy'], nested: { checked: true }, when: new Date('2026-09-01T11:00:00Z') }; });
  });
  assert.deepEqual(validateCase(item), []);
  const shared = { tags: ['toy'] };
  editDatabase(item, db => { db.DeliveryLog.rows.forEach(row => { row.Payload = shared; }); });
  assert.ok(validateCase(item).some(error => error.includes('fresh snapshots')));
});

console.log(`Authoring: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
