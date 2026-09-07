/**
 * Optional progress API for KQL Detective.
 *
 * The game is fully playable without this — the React client persists to
 * localStorage. This exists so a team can move progress server-side later
 * (shared leaderboards, cross-device profiles) without touching game code.
 *
 *   node server/index.js
 */
import express from 'express';
import cors from 'cors';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
  await writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

const sanitizeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'kql-detective' }));

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

  const db = await readDb();
  const body = req.body ?? {};
  db.profiles[id] = {
    lifetimeScore: Number(body.lifetimeScore) || 0,
    bestScore: Number(body.bestScore) || 0,
    casesClosed: Number(body.casesClosed) || 0,
    achievements: Array.isArray(body.achievements) ? body.achievements.slice(0, 100) : [],
    totalQueries: Number(body.totalQueries) || 0,
    updatedAt: new Date().toISOString(),
  };
  await writeDb(db);
  res.json(db.profiles[id]);
});

/** Records a completed run so a leaderboard can be built from real plays. */
app.post('/api/runs', async (req, res) => {
  const db = await readDb();
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
  db.runs.push(run);
  await writeDb(db);
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
  console.log(`KQL Detective API on http://127.0.0.1:${PORT}`);
});
