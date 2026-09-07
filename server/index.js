/**
 * Optional progress API for KQL Quest.
 *
 * The game is fully playable without this — the React client persists to
 * localStorage. This exists so a team can move progress server-side later
 * (shared leaderboards, cross-device profiles) without touching game code.
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

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

async function readDb() {
  try {
    return JSON.parse(await readFile(DB_FILE, 'utf8'));
  } catch {
    return { profiles: {}, runs: [] };
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

app.listen(PORT, () => {
  console.log(`KQL Quest API on http://127.0.0.1:${PORT}`);
});
