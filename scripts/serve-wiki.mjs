import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

export function previewServer(directory) {
  const root = path.resolve(directory);
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let target;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      target = path.resolve(root, `.${pathname}`);
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        response.writeHead(403).end();
        return;
      }
    } catch {
      response.writeHead(400).end();
      return;
    }
    try {
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
      const body = await readFile(target);
      response.writeHead(200, {
        'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      response.writeHead(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500).end();
    }
  });
}

if (import.meta.main) {
  const server = previewServer(path.join(process.cwd(), 'site'));
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
    console.log(`Wiki preview: http://127.0.0.1:${server.address().port}/`);
  });
}
