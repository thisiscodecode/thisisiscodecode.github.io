const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const port = Number(process.env.PORT || 4176);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end('Bad request'); return; }
  const filename = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (filename !== root && !filename.startsWith(root + path.sep) || pathname.split('/').some((part) => part.startsWith('.'))) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(filename, (error,data) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type':mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('Mohlat preview: http://localhost:' + port));

