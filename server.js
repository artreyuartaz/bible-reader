// Read-only Bible markdown reader. No dependencies: node server.js
// (data loading, search, dictionary, bookmarks and notes live in core.js, shared with the desktop app)
const http = require('http');
const { handle } = require('./core');

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > 2e6) req.destroy(); else chunks.push(c); });
  req.on('end', () => {
    const origin = req.headers.origin;
    const out = handle({
      method: req.method,
      url: req.url,
      contentType: req.headers['content-type'],
      sameOrigin: !origin || origin === `http://${req.headers.host}`,
      body: Buffer.concat(chunks),
    });
    res.writeHead(out.status, out.headers);
    res.end(req.method === 'HEAD' ? undefined : out.body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Bible reader: http://localhost:${PORT}`));
