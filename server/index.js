/**
 * Optional progress API for KQL Quest — LOCAL DEVELOPMENT ONLY.
 *
 * The game is fully playable without this; the React client persists to
 * localStorage and is not wired to this server at all. It exists so a team can
 * move progress server-side later (shared leaderboards, cross-device profiles)
 * without touching game code.
 *
 * ⚠️ It has NO AUTHENTICATION. Every write is anonymous and the profile key
 * comes straight from the URL, so anyone who can reach it can overwrite any
 * profile and post any leaderboard score. That is survivable on a developer's
 * own machine and unacceptable anywhere else, so:
 *
 *   - it binds to 127.0.0.1, not 0.0.0.0
 *   - CORS is restricted to localhost origins
 *   - it refuses to start if NODE_ENV=production
 *
 * Before this is exposed to real users it needs an authenticated identity, the
 * profile key derived from that identity rather than the URL, and leaderboard
 * scores recomputed server-side from trusted run data instead of being taken
 * from the client. Until then the safe move is to keep it local.
 *
 *   node server/index.js
 */
import express from 'express';
import cors from 'cors';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_FILE = join(DATA_DIR, 'profiles.json');
const PORT = Number(process.env.PORT ?? 3001);
const HOST = '127.0.0.1';

if (process.env.NODE_ENV === 'production') {
  console.error(
    'server/index.js is an unauthenticated development tool and refuses to run in production.\n' +
      'It needs real authentication and server-side score validation first — see the file header.',
  );
  process.exit(1);
}

const app = express();
// Only local origins. The default cors() allowed any site on the internet to
// issue credentialed writes against a developer's running instance.
app.use(
  cors({
    origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
  }),
);
app.use(express.json({ limit: '256kb' }));

async function readDb() {
  try {
    return JSON.parse(await readFile(DB_FILE, 'utf8'));
  } catch (err) {
    // Only a missing file means "no data yet". Treating *every* failure as an
    // empty database was destructive: a permission problem or a transient I/O
    // error returned {} and the next mutating request happily persisted that
    // empty snapshot over every existing profile. Atomic writes do not help
    // when the thing being written is already wrong.
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return { profiles: {}, runs: [] };
    }
    throw err;
  }
}

async function writeDb(db) {
  await mkdir(DATA_DIR, { recursive: true });
  // Write to a temp file and rename. Rename is atomic on the same filesystem,
  // so a reader never sees a half-written file — previously an interrupted or
  // overlapping write could leave invalid JSON, which readDb silently treats
  // as an empty database, quietly wiping every profile.
  const tmp = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, DB_FILE);
}

/**
 * Serialises read-modify-write cycles.
 *
 * Every mutating route reads the whole database, edits it and writes it back.
 * Run concurrently, two requests read the same snapshot and the second write
 * discards the first one's changes. Chaining them onto a single promise makes
 * the sequence safe without pulling in a real datastore for what is still an
 * optional side-car.
 */
let queue = Promise.resolve();
function withDb(mutate) {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await mutate(db);
    await writeDb(db);
    return result;
  });
  // Keep the chain alive even if this link rejects, or one failed request
  // would wedge every later one.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const sanitizeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'kql-quest' }));

app.get('/api/profile/:id', async (req, res) => {
  const db = await readDb();
  const id = sanitizeId(req.params.id);
  res.json(
    db.profiles[id] ?? {
      lifetimeScore: 0,
      bestScore: 0,
      casesClosed: 0,
      achievements: [],
      totalQueries: 0,
    },
  );
});

app.put('/api/profile/:id', async (req, res) => {
  const id = sanitizeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const body = req.body ?? {};
  const saved = await withDb((db) => {
    db.profiles[id] = {
      lifetimeScore: Number(body.lifetimeScore) || 0,
      bestScore: Number(body.bestScore) || 0,
      casesClosed: Number(body.casesClosed) || 0,
      achievements: Array.isArray(body.achievements) ? body.achievements.slice(0, 100) : [],
      totalQueries: Number(body.totalQueries) || 0,
      updatedAt: new Date().toISOString(),
    };
    return db.profiles[id];
  });
  res.json(saved);
});

/** Records a completed run so a leaderboard can be built from real plays. */
app.post('/api/runs', async (req, res) => {
  const body = req.body ?? {};
  const run = {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playerId: sanitizeId(body.playerId ?? 'anonymous'),
    caseId: String(body.caseId ?? '001').slice(0, 16),
    score: Number(body.score) || 0,
    durationMs: Number(body.durationMs) || 0,
    queriesRun: Number(body.queriesRun) || 0,
    deaths: Number(body.deaths) || 0,
    at: new Date().toISOString(),
  };
  await withDb((db) => {
    db.runs.push(run);
  });
  res.status(201).json(run);
});

app.get('/api/leaderboard', async (req, res) => {
  const db = await readDb();
  const caseId = req.query.caseId;
  const runs = caseId ? db.runs.filter((r) => r.caseId === caseId) : db.runs;

  // one best run per player
  const best = new Map();
  for (const r of runs) {
    const prev = best.get(r.playerId);
    if (!prev || r.score > prev.score) best.set(r.playerId, r);
  }
  res.json(
    [...best.values()]
      .sort((a, b) => b.score - a.score || a.durationMs - b.durationMs)
      .slice(0, 50),
  );
});

// readDb now rethrows anything that is not a missing file, so a corrupt or
// unreadable store surfaces as a 500 rather than being silently treated as
// empty and then overwritten. Express 5 forwards async rejections here.
app.use((err, _req, res, _next) => {
  // express.json() rejects malformed bodies before any route runs. Reporting
  // that as "storage unavailable" blames the server for a client mistake and
  // would send someone hunting a disk problem that does not exist.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'storage unavailable' });
});

app.listen(PORT, HOST, () => {
  console.log(`KQL Quest API (local dev only, unauthenticated) on http://${HOST}:${PORT}`);
});
