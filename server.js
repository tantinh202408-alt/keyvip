import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const cleanUrl = (req.url || '/').split('?')[0];
  let filePath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');

  // Fallback về index.html cho bất kỳ đường dẫn nào để không bao giờ bị lỗi 404
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = 'index.html';
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream('index.html').pipe(res);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✔ Server sangdev đang hoạt động tại cổng ${PORT} (0.0.0.0:3000)`);
});
