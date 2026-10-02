// Read-only Bible markdown reader. No dependencies: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BOOK_DIR = path.join(__dirname, 'Bible_Books');
const PUB_DIR = path.join(__dirname, 'public');
const MAX_RESULTS = 3000;

// ---- Load everything into memory once (files are only ever read) ----
const books = [];
function load() {
  books.length = 0;
  const files = fs.readdirSync(BOOK_DIR).filter(f => /\.md$/i.test(f)).sort();
  files.forEach((file, i) => {
    const text = fs.readFileSync(path.join(BOOK_DIR, file), 'utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);
    const chapters = [];
    let name = file.replace(/\.md$/i, '').replace(/^\d+_/, '').replace(/_/g, ' ');
    lines.forEach((l, n) => {
      const m = /^(#{1,6})\s+(.*)$/.exec(l);
      if (!m) return;
      if (m[1].length === 1) name = m[2].trim();
      else if (m[1].length === 2) chapters.push({ line: n, title: m[2].trim() });
    });
    books.push({ id: i, file, name, text, lines, chapters, lower: lines.map(l => l.toLowerCase()), bytes: Buffer.byteLength(text) });
  });
  console.log(`Loaded ${books.length} books`);
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "exact phrase" terms; unquoted words must ALL appear in the same line (verse).
function parseQuery(q) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) terms.push((m[1] || m[2]).trim().toLowerCase());
  return terms.filter(Boolean);
}

function search(q, { bookId = null, whole = false, cs = false, testament = "" }) {
  const terms = parseQuery(q);
  if (!terms.length) return { terms, total: 0, results: [], perBook: {}, truncated: false };
  const flags = cs ? 'g' : 'gi';
  const res = terms.map(t => new RegExp((whole ? '\\b' : '') + esc(t).replace(/\s+/g, '\\s+') + (whole ? '\\b' : ''), flags));
  const results = [], perBook = {};
  let total = 0, truncated = false;
  const targets = bookId != null ? books.filter(b => b.id === bookId) : testament === "ot" ? books.filter(b => b.id < 39) : testament === "nt" ? books.filter(b => b.id >= 39) : books;
  for (const b of targets) {
    let chapter = '';
    for (let n = 0; n < b.lines.length; n++) {
      const line = b.lines[n];
      if (!line) continue;
      if (/^##\s/.test(line)) chapter = line.replace(/^##\s+/, '');
      // cheap substring pre-filter before the regexes
      if (!cs && !terms.every(t => b.lower[n].includes(t.split(/\s+/)[0]))) continue;
      const ranges = [];
      let all = true;
      for (const r of res) {
        r.lastIndex = 0;
        let m, found = false;
        while ((m = r.exec(line))) { found = true; ranges.push([m.index, m.index + m[0].length]); if (!m[0].length) r.lastIndex++; }
        if (!found) { all = false; break; }
      }
      if (!all) continue;
      total++;
      perBook[b.id] = (perBook[b.id] || 0) + 1;
      if (results.length >= MAX_RESULTS) { truncated = true; continue; }
      ranges.sort((a, c) => a[0] - c[0]);
      let start = 0, end = line.length, text = line;
      if (line.length > 260) {
        start = Math.max(0, ranges[0][0] - 90);
        end = Math.min(line.length, start + 260);
        text = (start ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '');
      }
      const off = (start ? 1 : 0) - start;
      const rs = ranges.filter(r => r[0] >= start && r[1] <= end).map(r => [r[0] + off, r[1] + off]);
      results.push({ b: b.id, l: n, c: chapter, t: text, r: rs });
    }
  }
  return { terms, total, results, perBook, truncated };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  // Strictly read-only: only GET/HEAD are served.
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Read-only'); }
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (p === '/api/books') return json(res, books.map(b => ({ id: b.id, name: b.name, chapters: b.chapters, bytes: b.bytes })));
    const m = /^\/api\/book\/(\d+)$/.exec(p);
    if (m) {
      const b = books[+m[1]];
      if (!b) return json(res, { error: 'not found' }, 404);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(b.text);
    }
    if (p === '/api/search') {
      const q = (u.searchParams.get('q') || '').slice(0, 300);
      const bk = u.searchParams.get('book');
      const t0 = process.hrtime.bigint();
      const out = search(q, { bookId: bk === null || bk === '' ? null : +bk, testament: u.searchParams.get("t") || "", whole: u.searchParams.get("whole") === "1", cs: u.searchParams.get('cs') === '1' });
      out.ms = Number(process.hrtime.bigint() - t0) / 1e6;
      return json(res, out);
    }
    // static files, confined to /public
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const fp = path.normalize(path.join(PUB_DIR, rel));
    if (!fp.startsWith(PUB_DIR + path.sep) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { json(res, { error: String(e) }, 500); }
}).listen(PORT, '127.0.0.1', () => console.log(`Bible reader: http://localhost:${PORT}`));

load();
