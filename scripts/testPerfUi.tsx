import { renderToStaticMarkup } from 'react-dom/server';
import { CASES, getCase } from '../src/data/cases';
import { gradeChallenge } from '../src/kql/challenge';
import { runQuery, tableSignature } from '../src/kql/index';
import { CaseMapThumbnail } from '../src/ui/CaseMapThumbnail';
import { getLiveQueryFeatures } from '../src/ui/TerminalModal';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { GameplayLoadError } from '../src/game/GameplayLoadError';
import {
  getCaseMapThumbnailData,
  type CaseMapThumbnailData,
} from '../src/ui/caseMapThumbnailData';
import { ROOM_WIDTH, ROWS, type LevelDefinition } from '../src/game/levels/heartbeatHills';

// Independent copy of the original thumbnail's one-rect-per-marker contract.
function legacyCells(level: LevelDefinition): (string | null)[][] {
  const cells = Array.from({ length: ROWS }, () =>
    Array<string | null>(level.rooms.length * ROOM_WIDTH).fill(null),
  );
  level.rooms.forEach((room, index) => room.rows.forEach((row, y) => {
    [...row].forEach((marker, x) => {
      if (marker === ' ') return;
      cells[y][index * ROOM_WIDTH + x] = marker === '#' ? '#6f6ac4'
        : marker === '=' ? '#f7c948' : marker === '^' ? '#e5404f'
        : marker === 'P' || marker === '@' ? '#4fe6e6'
        : /[1-5V]/.test(marker) ? '#5fd97a' : /[GHJKL]/.test(marker) ? '#e451c8'
        : '#45418c';
    });
  }));
  return cells;
}

function rasterize(data: CaseMapThumbnailData): (string | null)[][] {
  const cells = Array.from({ length: data.height }, () =>
    Array<string | null>(data.width).fill(null),
  );
  for (const rect of data.rects) {
    for (let x = rect.x; x < rect.x + rect.width; x++) cells[rect.y][x] = rect.fill;
  }
  return cells;
}

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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

check('failed gameplay imports require Reload, while other errors retain HQ reset', () => {
  const boundary = new ErrorBoundary({ children: null });
  boundary.state = { error: new GameplayLoadError(new TypeError('Fetch failed')) };
  const failedLoad = renderToStaticMarkup(boundary.render());
  assert(failedLoad.includes('Reload'), 'No page reload offered for cached import failure');
  assert(!failedLoad.includes('Back to HQ'), 'Cached import failure offers an ineffective reset');
  boundary.state = { error: new Error('Unrelated render failure') };
  assert(renderToStaticMarkup(boundary.render()).includes('Back to HQ'), 'Ordinary error reset was removed');
});

check('thumbnail compact geometry preserves every colored cell', () => {
  for (const caseDef of CASES) {
    const expected = legacyCells(caseDef.level);
    const actual = rasterize(getCaseMapThumbnailData(caseDef.level));
    assert(actual.length === expected.length, `${caseDef.id}: row count changed`);
    for (let y = 0; y < expected.length; y++) {
      assert(actual[y].length === expected[y].length, `${caseDef.id}: width changed on row ${y}`);
      for (let x = 0; x < expected[y].length; x++) {
        assert(
          actual[y][x] === expected[y][x],
          `${caseDef.id}: cell ${x},${y} changed from ${expected[y][x]} to ${actual[y][x]}`,
        );
      }
    }
  }
});

check('thumbnail markup keeps aria-hidden and cuts rect count sharply', () => {
  let legacyRects = 0;
  let compactRects = 0;

  for (const caseDef of CASES) {
    const html = renderToStaticMarkup(<CaseMapThumbnail caseDef={caseDef} />);
    assert(html.includes('aria-hidden="true"'), `${caseDef.id}: thumbnail lost aria-hidden`);
    const renderedRects = (html.match(/<rect\b/g) ?? []).length;
    const data = getCaseMapThumbnailData(caseDef.level);
    const legacy = legacyCells(caseDef.level).flat().filter(Boolean).length + 1;
    const compact = data.rects.length + 1;

    assert(renderedRects === compact, `${caseDef.id}: rendered ${renderedRects} rects, expected ${compact}`);
    assert(compact < legacy, `${caseDef.id}: compact thumbnail did not reduce rect count`);

    legacyRects += legacy;
    compactRects += compact;
  }

  assert(
    compactRects < legacyRects / 2,
    `expected compact thumbnails to use less than half the rects, got ${compactRects}/${legacyRects}`,
  );
});

check('live operator detection parses syntax without touching data execution', () => {
  const used = getLiveQueryFeatures('Heartbeat | where TimeGenerated > ago(24h) | take 5');
  for (const feature of ['where', 'take', 'ago']) {
    assert(used.has(feature), `missing ${feature} from live features`);
  }
  const syntaxOnly = getLiveQueryFeatures('NotARegisteredTable | where AbsentColumn == 1 | take 2');
  assert(syntaxOnly.has('where') && syntaxOnly.has('take'), 'Live checks attempted to resolve actual data');
});

check('thumbnail geometry is cached by stable case definition', () => {
  for (const caseDef of CASES) {
    assert(
      getCaseMapThumbnailData(caseDef.level) === getCaseMapThumbnailData(caseDef.level),
      `${caseDef.id}: repeated lookup rebuilt identical geometry`,
    );
  }
});

check('live operator detection keeps malformed queries empty', () => {
  const used = getLiveQueryFeatures('Heartbeat | where');
  assert(used.size === 0, `expected malformed live features to be empty, got ${[...used].join(', ')}`);
});

check('grading still returns the actual interpreter result table on Run', () => {
  const caseDef = getCase('001');
  const spec = caseDef.challenges[4];
  const db = caseDef.database();
  const graded = gradeChallenge(spec, spec.solution, db, caseDef.now);
  const direct = runQuery(spec.solution, db, { now: caseDef.now }).table;

  assert(graded.status === 'correct', `expected correct result, got ${graded.status}`);
  assert(!!graded.table, 'gradeChallenge did not return the executed result table');
  const gradedTable = graded.table;
  if (!gradedTable) throw new Error('gradeChallenge did not return the executed result table');
  assert(
    tableSignature(gradedTable, spec.ordered ?? false) === tableSignature(direct, spec.ordered ?? false),
    'gradeChallenge returned a table different from direct interpreter execution',
  );
});

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
