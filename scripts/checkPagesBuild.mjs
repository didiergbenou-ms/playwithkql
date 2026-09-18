import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const base = process.env.BASE_PATH;
assert.ok(base && /^\/[^/?#]+\/$/.test(base), 'Set BASE_PATH to a project prefix such as /playwithkql/');
const root = resolve('dist');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((url) => !/^(?:https?:|data:|#)/.test(url));
assert.ok(references.some((url) => url.endsWith('.js')), 'No entry module in the built HTML');
assert.ok(references.some((url) => url.endsWith('.css')), 'No stylesheet in the built HTML');
for (const url of references) {
  assert.ok(url.startsWith(base), `Asset escapes the project prefix: ${url}`);
  const file = resolve(root, url.slice(base.length));
  assert.ok(file.startsWith(`${root}${sep}`), `Asset escapes dist: ${url}`);
  assert.ok((await stat(file)).isFile(), `Missing built asset: ${url}`);
}

const assets = await readdir(resolve(root, 'assets'));
assert.ok(assets.some((file) => /^PhaserGame-.*\.js$/.test(file)), 'Missing lazy game module');
const worker = assets.find((file) => /^query\.worker-.*\.js$/.test(file));
assert.ok(worker, 'Missing query worker');
let workerLinked = false;
for (const name of assets.filter((file) => file.endsWith('.js'))) {
  const source = await readFile(resolve(root, 'assets', name), 'utf8');
  assert.ok(!/["'`]\/assets\//.test(source), `${name} contains a root-only asset URL`);
  if (source.includes(`${base}assets/${worker}`)) workerLinked = true;
}
assert.ok(workerLinked, 'The query worker URL does not include the Pages project prefix');
console.log(`Pages entry, stylesheet, lazy game and query worker use ${base}`);
