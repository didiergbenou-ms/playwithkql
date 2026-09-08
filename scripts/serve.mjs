import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.argv[2] ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    // decodeURIComponent throws URIError on a malformed target such as `/%`.
    // This used to sit outside the try, and because the handler is async the
    // rejection was unhandled — a single bad request took the whole preview
    // server down rather than returning a client error.
    let url;
    try {
      url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request URL');
      return;
    }

    const rel = normalize(url).replace(/^([/\\])+/, '');
    let file = join(root, rel || 'index.html');

    let body;
    try {
      body = await readFile(file);
    } catch {
      // SPA fallback
      file = join(root, 'index.html');
      body = await readFile(file);
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving dist/ at http://127.0.0.1:${port}/`);
});
