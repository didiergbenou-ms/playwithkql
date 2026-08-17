import { rolldown } from 'rolldown';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const entry = process.argv[2] ?? 'scripts/testKql.ts';
const out = '.tmp/test.mjs';

mkdirSync('.tmp', { recursive: true });
const bundle = await rolldown({ input: entry, platform: 'node' });
await bundle.write({ file: out, format: 'esm' });
await bundle.close();

const res = spawnSync(process.execPath, [out], { stdio: 'inherit' });
rmSync('.tmp', { recursive: true, force: true });
process.exit(res.status ?? 1);
