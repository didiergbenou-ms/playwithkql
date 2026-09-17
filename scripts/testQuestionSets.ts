// Run with: node scripts/run.mjs scripts/testQuestionSets.ts
import { AUTHORING_CASES } from '../src/authoring/catalog';
import { CASE_STARTER, createCaseStarter } from '../src/authoring/caseStarter';
import { validateCase } from '../src/authoring/validateCase';
import { CASES, CASE_VARIANTS, DEFAULT_CASE_ID, getCase, getCaseVariants } from '../src/data/cases';
import { CASE001 } from '../src/data/cases/case001';
import { CASE002 } from '../src/data/cases/case002';
import { CASE003 } from '../src/data/cases/case003';
import type { CaseDefinition } from '../src/data/cases/types';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, caseDifficultyKey, requireDifficulty } from '../src/data/difficulties';
import type { Difficulty } from '../src/data/difficulties';
import { QUESTION_SETS, createCaseVariant, validateQuestionSet } from '../src/data/questions';
import type { QuestionLesson, QuestionSet } from '../src/data/questions';
import type { ChallengeSpec } from '../src/kql/challenge';

let passed = 0;
const failures: string[] = [];
const BASES = [CASE001, CASE002, CASE003];
const ORDER: Difficulty[] = ['beginner', 'intermediate', 'expert'];
const NOTICE = 'Difficulty questions pending; currently reuses existing lessons';

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function eq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function signature(value: unknown): string {
  const encode = (entry: unknown): unknown => {
    if (entry instanceof Date) return ['date', entry.getTime()];
    if (Array.isArray(entry)) return ['array', entry.map(encode)];
    if (entry !== null && typeof entry === 'object') {
      // Optional lesson fields may be absent or explicitly undefined in a seed.
      return ['object', Object.keys(entry).sort()
        .filter(key => (entry as Record<string, unknown>)[key] !== undefined)
        .map(key => [key, encode((entry as Record<string, unknown>)[key])])];
    }
    return [typeof entry, typeof entry === 'function' ? '<function>' : entry];
  };
  return JSON.stringify(encode(value));
}

function same(actual: unknown, expected: unknown, label: string) {
  eq(signature(actual), signature(expected), label);
}

function throws(fn: () => unknown, label: string, message?: RegExp) {
  let caught = false;
  try {
    fn();
  } catch (error) {
    caught = true;
    if (message) assert(message.test(String(error)), `${label}: unexpected error ${String(error)}`);
  }
  assert(caught, `${label}: expected rejection, not silent fallback`);
}

function references(value: unknown, path = 'root', found = new Map<object, string>()): Map<object, string> {
  if (value === null || typeof value !== 'object' || found.has(value)) return found;
  found.set(value, path);
  for (const [key, child] of Object.entries(value)) references(child, `${path}.${key}`, found);
  return found;
}

function disjoint(left: unknown, right: unknown, label: string) {
  const leftRefs = references(left);
  for (const [ref, path] of references(right)) {
    assert(!leftRefs.has(ref), `${label}: ${path} shares ${leftRefs.get(ref)}`);
  }
}

function frozen(value: unknown, label: string) {
  for (const [ref, path] of references(value)) {
    // A clock getter deliberately returns a fresh mutable Date, not a frozen Date.
    if (!(ref instanceof Date)) assert(Object.isFrozen(ref), `${label}: ${path} is not frozen`);
  }
}

function lessonOf(challenge: ChallengeSpec): QuestionLesson {
  const { id, room, unlocksGate, evidenceId, points, ...lesson } = challenge;
  return lesson;
}

function wiringOf(challenge: ChallengeSpec) {
  const { room, unlocksGate, evidenceId, points } = challenge;
  return { room, unlocksGate, evidenceId, points };
}

function sharedContent(item: CaseDefinition) {
  const { difficulty, questionSetStatus, questionSetNotice, questionSetRevision, now, database, tableMeta,
    challenges, evidence, skills, ...content } = item;
  return content;
}

function setFor(base: CaseDefinition, difficulty: Difficulty = DEFAULT_DIFFICULTY): QuestionSet {
  const set = QUESTION_SETS.find(item => item.id === `${base.id}:${difficulty}`);
  assert(set, `missing question set ${base.id}:${difficulty}`);
  return set;
}

function fixture(base = CASE001, difficulty: Difficulty = DEFAULT_DIFFICULTY): QuestionSet {
  return {
    id: caseDifficultyKey(base.id, difficulty),
    caseId: base.id,
    difficulty,
    questionSetStatus: 'placeholder',
    questionSetNotice: NOTICE,
    slots: base.challenges.map((challenge, index) => {
      const evidence = base.evidence.find(item => item.id === challenge.evidenceId)!;
      return {
        slot: (index + 1) as 1 | 2 | 3 | 4 | 5,
        source: 'reused',
        lesson: structuredClone(lessonOf(challenge)),
        evidence: { title: evidence.title, detail: evidence.detail, chainIndex: evidence.chainIndex },
      };
    }),
  };
}

function readyFixture(): QuestionSet {
  const set = fixture();
  set.questionSetStatus = 'ready';
  set.questionSetNotice = null;
  for (const slot of set.slots) slot.source = 'authored';
  return set;
}

function valid(set: QuestionSet, base: CaseDefinition) {
  const errors = validateQuestionSet(set, base);
  eq(errors.length, 0, errors.join('\n'));
}

function invalid(set: unknown, label: string, base = CASE001) {
  const errors = validateQuestionSet(set as QuestionSet, base);
  assert(Array.isArray(errors) && errors.length > 0, `${label}: structure validation accepted fixture`);
  assert(errors.every(error => typeof error === 'string' && error.length > 0), `${label}: missing diagnostics`);
  throws(() => createCaseVariant(base, set as QuestionSet), `${label}: composition`);
}

const adapterSignatures = BASES.map(signature);
const questionSignatures = QUESTION_SETS.map(signature);

check('difficulties: explicit ordered identities and strict parsing', () => {
  eq(DEFAULT_DIFFICULTY, 'beginner', 'default difficulty');
  same(DIFFICULTIES.map(item => item.id), ORDER, 'difficulty order');
  frozen(DIFFICULTIES, 'difficulty catalog');
  for (const difficulty of ORDER) {
    eq(requireDifficulty(difficulty), difficulty, 'difficulty parser');
    eq(caseDifficultyKey('001', difficulty), `001:${difficulty}`, 'difficulty key');
  }
  for (const value of ['unknown', '', 'Beginner', ' beginner ', null, 1]) {
    throws(() => requireDifficulty(value as string), `difficulty ${String(value)}`);
    throws(() => caseDifficultyKey('001', value as Difficulty), `key ${String(value)}`);
  }
});

check('question registry: nine unique sets, 45 unique slot identities, truthful content status', () => {
  eq(QUESTION_SETS.length, 9, 'question set count');
  eq(new Set(QUESTION_SETS.map(set => set.id)).size, 9, 'unique question set ids');
  same(QUESTION_SETS.map(set => set.id).sort(),
    BASES.flatMap(base => ORDER.map(difficulty => `${base.id}:${difficulty}`)).sort(), 'complete grid');
  const slotIds: string[] = [];
  for (const set of QUESTION_SETS) {
    const base = BASES.find(item => item.id === set.caseId);
    assert(base, `${set.id}: unknown base`);
    valid(set, base);
    eq(set.id, caseDifficultyKey(set.caseId, set.difficulty), 'set id');
    eq(set.questionSetNotice, set.questionSetStatus === 'placeholder' ? NOTICE : null, `${set.id}: notice`);
    eq(set.slots.length, 5, `${set.id}: slot count`);
    same(set.slots.map(slot => slot.slot).sort(), [1, 2, 3, 4, 5], `${set.id}: slots`);
    for (const slot of set.slots) {
      if (set.questionSetStatus === 'ready') eq(slot.source, 'authored', `${set.id}/${slot.slot}: source`);
      slotIds.push(`${set.id}:${slot.slot}`);
      for (const key of ['id', 'room', 'unlocksGate', 'evidenceId', 'points']) {
        assert(!Object.hasOwn(slot.lesson, key), `${set.id}: lesson contains wiring ${key}`);
      }
      assert(!Object.hasOwn(slot.evidence, 'id'), `${set.id}: evidence contains id`);
    }
  }
  eq(slotIds.length, 45, 'total slots');
  eq(new Set(slotIds).size, 45, 'unique slot identities');
});

check('case registry: canonical beginner defaults and nine stable variants', () => {
  eq(DEFAULT_CASE_ID, '001', 'default case');
  eq(CASES.length, 3, 'selectable case count');
  eq(CASE_VARIANTS.length, 9, 'variant count');
  same(CASES.map(item => item.id), BASES.map(item => item.id), 'case order');
  eq(new Set(CASE_VARIANTS).size, 9, 'distinct canonical definitions');
  same(CASE_VARIANTS.map(item => `${item.id}:${item.difficulty}`).sort(),
    QUESTION_SETS.map(item => item.id).sort(), 'variant grid');
  for (const base of BASES) {
    const beginner = getCase(base.id);
    eq(beginner, getCase(base.id, DEFAULT_DIFFICULTY), `${base.id}: default lookup`);
    eq(beginner, CASES.find(item => item.id === base.id)!, `${base.id}: CASES canonical`);
    assert(beginner !== base, `${base.id}: adapter used as mutable canonical`);
    for (const difficulty of ORDER) {
      const variant = getCase(base.id, difficulty);
      eq(variant, getCase(base.id, difficulty), `${base.id}/${difficulty}: stable identity`);
      eq(variant, CASE_VARIANTS.find(item => item.id === base.id && item.difficulty === difficulty)!,
        `${base.id}/${difficulty}: canonical variant`);
    }
  }
  assert(!CASES.some(item => item.id === CASE_STARTER.id), 'starter must not ship in registry');
});

check('case registry: unknown ids and difficulties never fall back', () => {
  for (const id of ['999', '', ' 001', CASE_STARTER.id]) {
    throws(() => getCase(id), `unknown case ${id}`, /Unknown case id/i);
    throws(() => getCaseVariants(id), `unknown variants ${id}`, /Unknown case id/i);
    for (const difficulty of ORDER) throws(() => getCase(id, difficulty), `${id}/${difficulty}`);
  }
  for (const base of BASES) {
    for (const value of ['unknown', '', 'Beginner', ' beginner ', null, 1]) {
      throws(() => getCase(base.id, value as Difficulty), `${base.id}/${String(value)}`, /Unknown difficulty/i);
    }
  }
});

for (const base of BASES) {
  check(`${base.id}: getCaseVariants returns three ordered stable definitions in fresh arrays`, () => {
    const first = getCaseVariants(base.id);
    const second = getCaseVariants(base.id);
    assert(first !== second && first !== CASE_VARIANTS && first !== CASES, 'returned registry array');
    same(first.map(item => item.difficulty), ORDER, 'variant order');
    eq(first.length, 3, 'per-case count');
    first.forEach((item, index) => {
      eq(item.id, base.id, 'per-case filter');
      eq(item, second[index], 'stable definition across fresh arrays');
      eq(item, getCase(base.id, ORDER[index]), 'canonical lookup');
    });
    const before = signature(CASE_VARIANTS);
    first.reverse();
    first.pop();
    first.push(CASE_STARTER);
    same(getCaseVariants(base.id).map(item => item.difficulty), ORDER, 'no result-array pollution');
    eq(signature(CASE_VARIANTS), before, 'no registry pollution');
    eq(CASES.length, 3, 'beginner registry unchanged');
  });

  for (const difficulty of ORDER) {
    const label = `${base.id}:${difficulty}`;
    check(`${label}: preserve story, maps, notes, gates, root causes and scoring`, () => {
      const variant = getCase(base.id, difficulty);
      const set = setFor(base, difficulty);
      eq(variant.id, base.id, 'case identity');
      eq(variant.difficulty, difficulty, 'difficulty identity');
      eq(variant.questionSetStatus, set.questionSetStatus, 'question status');
      eq(variant.questionSetNotice, set.questionSetNotice, 'question notice independent of case placeholder notice');
      same(sharedContent(variant), sharedContent(base), 'complete shared story and level content');
      const data = set.dataset ?? base;
      same(variant.tableMeta, data.tableMeta, 'selected schema');
      eq(variant.now.getTime(), data.now.getTime(), 'selected reference clock');
      same(variant.skills, [...new Set(variant.challenges.flatMap(c => c.requiredOperators ?? []))], 'selected skills');
      same(variant.evidence.map(e => e.id), base.evidence.map(e => e.id), 'evidence identity');
      eq(variant.challenges.length, base.challenges.length, 'challenge count');
      variant.challenges.forEach((challenge, index) => {
        const original = base.challenges[index];
        const slot = set.slots.find(item => item.slot === index + 1)!;
        eq(challenge.id, difficulty === 'beginner' ? original.id : `${original.id}-${difficulty}`, 'challenge id');
        same(wiringOf(challenge), wiringOf(original), 'room/gate/evidence/points');
        same(lessonOf(challenge), slot.lesson, 'selected slot lesson');
        const evidence = variant.evidence.find(e => e.id === challenge.evidenceId)!;
        same({ title: evidence.title, detail: evidence.detail, chainIndex: evidence.chainIndex }, slot.evidence, 'selected evidence');
        if (slot.source === 'reused') same(lessonOf(challenge), lessonOf(original), 'reused lesson preservation');
      });
      eq(variant.challenges.reduce((total, challenge) => total + challenge.points, 0),
        base.challenges.reduce((total, challenge) => total + challenge.points, 0), 'total available points');
    });

    check(`${label}: all reference answers, worked examples and final hints validate`, () => {
      const variant = getCase(base.id, difficulty);
      const before = signature(variant);
      const errors = validateCase(variant);
      eq(errors.length, 0, errors.join('\n'));
      eq(signature(variant), before, 'validation is read-only');
    });

    check(`${label}: frozen nested canonical content and mutation-safe clock`, () => {
      const variant = getCase(base.id, difficulty);
      frozen(variant, label);
      const before = signature(variant);
      assert(!Reflect.set(variant, 'title', 'changed'), 'canonical root is writable');
      assert(!Reflect.set(variant.challenges[0].concept.example, 'query', 'changed'), 'worked example is writable');
      assert(!Reflect.set(variant.challenges[0].hints, '0', 'changed'), 'hints are writable');
      assert(!Reflect.set(variant.level.rooms[0].rows, '0', 'changed'), 'map rows are writable');
      assert(!Reflect.set(variant.tableMeta[0].columns[0], 'doc', 'changed'), 'schema column is writable');
      const first = variant.now;
      const second = variant.now;
      assert(first !== second && first !== base.now, 'now must be a fresh Date');
      const timestamp = second.getTime();
      first.setUTCFullYear(1999);
      second.setTime(NaN);
      eq(variant.now.getTime(), timestamp, 'clock survives Date setters');
      eq(signature(variant), before, 'canonical content survives mutation attempts');
    });

    check(`${label}: database snapshots clone all nested values and preserve adapters`, () => {
      const variant = getCase(base.id, difficulty);
      const first = variant.database();
      const second = variant.database();
      const baseBefore = signature(base.database());
      const source = (setFor(base, difficulty).dataset ?? base).database();
      same(first, source, 'dataset matches selected source');
      same(second, first, 'deterministic snapshots');
      disjoint(first, second, 'snapshot isolation including Dates and dynamic objects');
      disjoint(first, source, 'adapter snapshot isolation');
      const before = signature(second);
      for (const ref of references(first).keys()) {
        if (ref instanceof Date) ref.setTime(0);
        else if (Array.isArray(ref)) ref.pop();
        else Reflect.set(ref, '__questionSetMutationProbe', true);
      }
      eq(signature(second), before, 'existing sibling snapshot unaffected');
      eq(signature(variant.database()), before, 'future snapshot unaffected');
      eq(signature(base.database()), baseBefore, 'adapter dataset unaffected');
    });
  }
}

check('all 45 challenge ids are unique across the nine variants', () => {
  const ids = CASE_VARIANTS.flatMap(item => item.challenges.map(challenge => challenge.id));
  eq(ids.length, 45, 'total challenges');
  eq(new Set(ids).size, 45, 'globally unique challenge ids');
});

check('canonical registries and every nested content object are frozen', () => {
  frozen(CASES, 'CASES');
  frozen(CASE_VARIANTS, 'CASE_VARIANTS');
  assert(!Reflect.set(CASES, '0', CASE_STARTER), 'CASES entries can be replaced');
  assert(!Reflect.set(CASE_VARIANTS, 'length', 0), 'CASE_VARIANTS can be truncated');
});

check('all question sets, slots, variants and adapters have disjoint content graphs', () => {
  for (let i = 0; i < QUESTION_SETS.length; i++) {
    const set = QUESTION_SETS[i];
    for (let j = i + 1; j < QUESTION_SETS.length; j++) {
      disjoint(set, QUESTION_SETS[j], `${set.id} / ${QUESTION_SETS[j].id}`);
    }
    for (let a = 0; a < set.slots.length; a++) {
      for (let b = a + 1; b < set.slots.length; b++) {
        disjoint(set.slots[a], set.slots[b], `${set.id}: slots ${a + 1}/${b + 1}`);
      }
    }
    for (const base of BASES) disjoint(set, base, `${set.id} / adapter ${base.id}`);
    for (const variant of CASE_VARIANTS) disjoint(set, variant, `${set.id} / variant ${variant.id}:${variant.difficulty}`);
  }
  for (let i = 0; i < CASE_VARIANTS.length; i++) {
    for (let j = i + 1; j < CASE_VARIANTS.length; j++) {
      disjoint(CASE_VARIANTS[i], CASE_VARIANTS[j], `variant graphs ${i}/${j}`);
    }
    for (const base of BASES) disjoint(CASE_VARIANTS[i], base, `variant ${i} / adapter ${base.id}`);
  }
});

check('authoring catalog stays unique: three cases plus the unregistered starter', () => {
  eq(AUTHORING_CASES.length, 4, 'authoring catalog count');
  eq(new Set(AUTHORING_CASES.map(item => item.id)).size, 4, 'unique authoring case ids');
  same(AUTHORING_CASES.map(item => item.id).sort(), [...BASES.map(item => item.id), CASE_STARTER.id].sort(),
    'authoring catalog membership');
  for (const item of AUTHORING_CASES) {
    const errors = validateCase(item);
    eq(errors.length, 0, errors.join('\n'));
  }
});

check('authoring fixtures remain valid with optional difficulty absent or explicit', () => {
  const starter = createCaseStarter({ id: 'question-set-authoring-fixture' });
  delete starter.difficulty;
  for (const difficulty of [undefined, ...ORDER]) {
    const item = difficulty === undefined ? starter : { ...starter, difficulty };
    const errors = validateCase(item);
    eq(errors.length, 0, `${String(difficulty)}: ${errors.join('\n')}`);
  }
});

check('ready requires authored declarations, not an inferred increase in difficulty', () => {
  const ready = readyFixture();
  valid(ready, CASE001);
  const variant = createCaseVariant(CASE001, ready);
  eq(variant.questionSetStatus, 'ready', 'ready status');
  eq(variant.questionSetNotice, null, 'ready notice');
  same(lessonOf(variant.challenges[0]), lessonOf(CASE001.challenges[0]), 'structural validation does not infer difficulty');
  for (let index = 0; index < ready.slots.length; index++) {
    const reused = structuredClone(ready);
    reused.slots[index].source = 'reused';
    invalid(reused, `ready reused slot ${index + 1}`);
  }
});

for (const field of ['prompt', 'teaches', 'starter', 'solution', 'hints', 'concept']) {
  check(`ready rejects missing explicit lesson.${field}`, () => {
    const set = readyFixture();
    delete (set.slots[0].lesson as unknown as Record<string, unknown>)[field];
    invalid(set, `missing ${field}`);
  });
}

for (const field of ['title', 'body', 'pattern', 'example']) {
  check(`ready rejects missing explicit concept.${field}`, () => {
    const set = readyFixture();
    delete (set.slots[0].lesson.concept as unknown as Record<string, unknown>)[field];
    invalid(set, `missing concept.${field}`);
  });
}

for (const field of ['query', 'explain']) {
  check(`ready rejects missing explicit example.${field}`, () => {
    const set = readyFixture();
    delete (set.slots[0].lesson.concept.example as unknown as Record<string, unknown>)[field];
    invalid(set, `missing example.${field}`);
  });
}

const malformed: [string, (set: QuestionSet) => void][] = [
  ['mismatched id', set => { set.id = '001:expert'; }],
  ['unknown difficulty', set => { set.difficulty = 'legendary' as Difficulty; set.id = '001:legendary'; }],
  ['wrong base case', set => { set.caseId = '002'; set.id = '002:beginner'; }],
  ['empty case id', set => { set.caseId = ''; set.id = ':beginner'; }],
  ['padded case id', set => { set.caseId = ' 001'; set.id = ' 001:beginner'; }],
  ['missing slot', set => { set.slots.pop(); }],
  ['extra slot', set => { set.slots.push(structuredClone(set.slots[0])); }],
  ['colliding slots', set => { set.slots[4].slot = set.slots[0].slot; }],
  ['out-of-range slot', set => { set.slots[0].slot = 0 as never; }],
  ['noninteger slot', set => { set.slots[0].slot = 1.5 as never; }],
  ['string slot', set => { set.slots[0].slot = '1' as never; }],
  ['missing slots', set => { delete (set as Partial<QuestionSet>).slots; }],
  ['null slot', set => { set.slots[0] = null as never; }],
  ['unknown source', set => { set.slots[0].source = 'generated' as never; }],
  ['unknown status', set => { set.questionSetStatus = 'draft' as never; }],
  ['hidden placeholder notice', set => { set.questionSetNotice = null; }],
  ['inexact placeholder notice', set => { set.questionSetNotice = `${NOTICE}.`; }],
  ['ready notice not null', set => {
    set.questionSetStatus = 'ready';
    set.slots.forEach(slot => { slot.source = 'authored'; });
  }],
  ['null lesson', set => { set.slots[0].lesson = null as never; }],
  ['blank prompt', set => { set.slots[0].lesson.prompt = ' '; }],
  ['nonstring starter', set => { set.slots[0].lesson.starter = null as never; }],
  ['insufficient hints', set => { set.slots[0].lesson.hints = ['one', 'two']; }],
  ['empty hint', set => { set.slots[0].lesson.hints[0] = ''; }],
  ['null evidence', set => { set.slots[0].evidence = null as never; }],
  ['blank evidence title', set => { set.slots[0].evidence.title = ' '; }],
  ['missing evidence detail', set => { delete (set.slots[0].evidence as Partial<{ detail: string }>).detail; }],
  ['negative chain index', set => { set.slots[0].evidence.chainIndex = -1; }],
  ['fractional chain index', set => { set.slots[0].evidence.chainIndex = 0.5; }],
  ['chain index beyond base', set => { set.slots[0].evidence.chainIndex = CASE001.causalChain.length; }],
  ['evidence id override', set => { Object.assign(set.slots[0].evidence, { id: 'foreign-evidence' }); }],
];

for (const key of ['id', 'room', 'unlocksGate', 'evidenceId', 'points']) {
  malformed.push([`lesson wiring override ${key}`, set => { Object.assign(set.slots[0].lesson, { [key]: 'foreign' }); }]);
}
for (const [label, change] of malformed) {
  check(`malformed question set: ${label}`, () => {
    const set = fixture();
    change(set);
    invalid(set, label);
  });
}
for (const value of [null, undefined, {}, [], 'not a question set']) {
  check(`malformed top-level structure: ${String(value)}`, () => invalid(value, 'top-level structure'));
}

check('structure-only validation can omit the base but composition rejects mismatched wiring', () => {
  eq(validateQuestionSet(fixture()).length, 0, 'standalone structural validation');
  const broken = { ...CASE001, evidence: CASE001.evidence.filter(item => item.id !== CASE001.challenges[0].evidenceId) };
  invalid(fixture(), 'missing base evidence link', broken);
  const extraTerminal = { ...CASE001, challenges: [...CASE001.challenges, CASE001.challenges[0]] };
  invalid(fixture(), 'extra base challenge', extraTerminal);
});

check('slot order is not terminal order; evidence overrides retain the base causal chain and wiring', () => {
  const set = readyFixture();
  const changed = set.slots[0];
  changed.evidence = {
    title: 'Fixture: independent evidence title',
    detail: 'Fixture evidence explains the same shared incident without changing its wiring.',
    chainIndex: (changed.evidence.chainIndex + 1) % CASE001.causalChain.length,
  };
  set.slots.reverse();
  valid(set, CASE001);
  const variant = createCaseVariant(CASE001, set);
  same(sharedContent(variant), sharedContent(CASE001), 'story/maps/causal chain/root causes retained');
  same(variant.challenges.map(wiringOf), CASE001.challenges.map(wiringOf), 'terminal wiring retained');
  variant.challenges.forEach((challenge, index) => {
    same(lessonOf(challenge), set.slots.find(slot => slot.slot === index + 1)!.lesson, 'slot lookup by identity');
  });
  const evidenceId = CASE001.challenges[0].evidenceId!;
  same(variant.evidence.find(item => item.id === evidenceId), { id: evidenceId, ...changed.evidence }, 'evidence override');
  same(variant.evidence.filter(item => item.id !== evidenceId),
    CASE001.evidence.filter(item => item.id !== evidenceId), 'other evidence retained');
  disjoint(variant, set, 'evidence and lesson fixture isolated');
  const errors = validateCase(variant);
  eq(errors.length, 0, errors.join('\n'));
});

check('composition and structure validation never invoke a database factory or execute KQL', () => {
  let calls = 0;
  const base = { ...CASE001, database: () => { calls++; return CASE001.database(); } };
  const set = fixture();
  set.slots[0].lesson.solution = 'MissingQuestionSetTable | unsupported_question_operator';
  set.slots[0].lesson.concept.example.query = set.slots[0].lesson.solution;
  set.slots[0].lesson.hints[2] = set.slots[0].lesson.solution;
  valid(set, base);
  const variant = createCaseVariant(base, set);
  eq(calls, 0, 'no eager database or query execution');
  eq(variant.challenges[0].solution, set.slots[0].lesson.solution, 'invalid KQL is composed without execution');
  const errors = validateCase(variant);
  assert(calls > 0, 'validateCase must request the database');
  assert(errors.some(error => /solution|worked example|final hint/.test(error)), 'executable validation must catch invalid queries');
});

check('atomic dataset override supplies data, schema and clock lazily with deep snapshot isolation', () => {
  const set = fixture();
  let overrideCalls = 0;
  let baseCalls = 0;
  const source = CASE001.database();
  source.QuestionSetFixture = {
    name: 'QuestionSetFixture',
    columns: ['Payload', 'At'],
    rows: [{ Payload: { nested: [{ label: 'independent fixture' }] }, At: new Date(CASE001.now.getTime()) }],
  };
  const meta = structuredClone(CASE001.tableMeta);
  meta.push({
    name: 'QuestionSetFixture', doc: 'Extra fixture table demonstrates an atomic override.',
    columns: [
      { name: 'Payload', type: 'dynamic', doc: 'Nested payload for snapshot isolation.' },
      { name: 'At', type: 'datetime', doc: 'Independent fixture timestamp.' },
    ],
  });
  const clock = new Date(CASE001.now.getTime());
  const timestamp = clock.getTime();
  set.dataset = { database: () => { overrideCalls++; return source; }, tableMeta: meta, now: clock };
  const base = { ...CASE001, now: new Date(timestamp - 86400000), database: () => {
    baseCalls++;
    throw new Error('Atomic override must not use the base database');
  } };
  valid(set, base);
  const variant = createCaseVariant(base, set);
  eq(overrideCalls, 0, 'override factory not called while composing');
  eq(baseCalls, 0, 'base factory not called while composing');
  same(variant.tableMeta, meta, 'override schema selected');
  eq(variant.now.getTime(), timestamp, 'override clock selected');
  disjoint(variant.tableMeta, meta, 'override schema cloned');
  const first = variant.database();
  eq(overrideCalls, 1, 'one explicit database use');
  const second = variant.database();
  eq(overrideCalls, 2, 'second explicit database use');
  same(first, source, 'override database selected');
  disjoint(first, source, 'factory-owned data cloned');
  disjoint(first, second, 'all nested snapshot objects cloned');
  const before = signature(source);
  const row = first.QuestionSetFixture.rows[0];
  (row.At as Date).setTime(0);
  (row.Payload as { nested: { label: string }[] }).nested[0].label = 'changed';
  first.QuestionSetFixture.columns.pop();
  eq(signature(source), before, 'factory-owned data survives snapshot edits');
  eq(signature(second), before, 'second snapshot survives snapshot edits');
  eq(signature(variant.database()), before, 'future snapshot survives snapshot edits');
  const contentBefore = signature(variant);
  clock.setTime(0);
  meta[0].columns[0].doc = 'changed source schema';
  eq(signature(variant), contentBefore, 'source clock and schema edits cannot change canonical');
  const errors = validateCase(variant);
  eq(errors.length, 0, errors.join('\n'));
  eq(baseCalls, 0, 'atomic override never falls back to base database');
  assert(overrideCalls > 3, 'validateCase uses the selected dataset factory');
});

for (const missing of ['database', 'tableMeta', 'now'] as const) {
  check(`atomic dataset rejects missing ${missing} without invoking a factory`, () => {
    const set = fixture();
    let calls = 0;
    set.dataset = {
      database: () => { calls++; return CASE001.database(); },
      tableMeta: structuredClone(CASE001.tableMeta), now: new Date(CASE001.now.getTime()),
    };
    delete (set.dataset as Partial<NonNullable<QuestionSet['dataset']>>)[missing];
    invalid(set, `incomplete dataset missing ${missing}`);
    eq(calls, 0, 'invalid override must not execute');
  });
}

for (const [label, dataset] of [
  ['null', null],
  ['empty', {}],
  ['nonfunction database', { database: {}, tableMeta: CASE001.tableMeta, now: CASE001.now }],
  ['empty metadata', { database: CASE001.database, tableMeta: [], now: CASE001.now }],
  ['invalid Date', { database: CASE001.database, tableMeta: CASE001.tableMeta, now: new Date(NaN) }],
  ['string clock', { database: CASE001.database, tableMeta: CASE001.tableMeta, now: CASE001.now.toISOString() }],
] as const) {
  check(`atomic dataset rejects ${label}`, () => {
    const set = fixture();
    set.dataset = dataset as QuestionSet['dataset'];
    invalid(set, `invalid dataset ${label}`);
  });
}

check('editing cloned authoring sources never changes existing canonical variants or adapters', () => {
  const set = readyFixture();
  set.dataset = { database: CASE001.database, tableMeta: structuredClone(CASE001.tableMeta), now: new Date(CASE001.now.getTime()) };
  const first = createCaseVariant(CASE001, set);
  const second = createCaseVariant(CASE001, set);
  disjoint(first, second, 'repeated composition clones independently');
  disjoint(first, set, 'authoring source content is not retained');
  const before = signature(first);
  set.slots[0].lesson.prompt = 'Edited fixture prompt';
  set.slots[0].lesson.concept.example.explain = 'Edited fixture explanation';
  set.slots[0].lesson.hints[0] = 'Edited fixture hint';
  set.slots[0].lesson.requiredOperators?.push('take');
  set.slots[0].lesson.evidenceTokens?.push('fixture-token');
  set.slots[0].evidence.title = 'Edited fixture evidence';
  set.dataset.tableMeta[0].columns[0].doc = 'Edited fixture schema';
  set.dataset.now.setTime(0);
  set.slots.reverse();
  eq(signature(first), before, 'first canonical unchanged');
  eq(signature(second), before, 'second canonical unchanged');
  frozen(first, 'composed fixture');
  // Structural composition accepts edits; executable correctness is a separate authoring check.
  const revised = createCaseVariant(CASE001, set);
  eq(revised.challenges[0].prompt, 'Edited fixture prompt', 'new composition sees edited source');
  assert(signature(revised) !== before, 'new composition should reflect source edits');
});

check('tests leave every shipped adapter and authored question set unchanged', () => {
  same(BASES.map(signature), adapterSignatures, 'base adapters unchanged');
  same(QUESTION_SETS.map(signature), questionSignatures, 'source question sets unchanged');
});

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
