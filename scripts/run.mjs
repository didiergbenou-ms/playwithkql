import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2] ?? 'scripts/testKql.ts';
const out = '.tmp/test.mjs';

mkdirSync('.tmp', { recursive: true });
const bundle = await rolldown({ input: entry, platform: 'node' });
await bundle.write({ file: out, format: 'esm' });
await bundle.close();

// Preload browser storage shims into the child process. They must be in place
// before the bundle evaluates, because zustand's persist middleware resolves
// its storage once at store-creation time and caches a failure permanently.
const shim = pathToFileURL(resolve('scripts/domShim.mjs')).href;
const res = spawnSync(process.execPath, ['--import', shim, out], { stdio: 'inherit' });
rmSync('.tmp', { recursive: true, force: true });
process.exit(res.status ?? 1);
