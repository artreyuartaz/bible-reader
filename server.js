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

// ---- Dictionary: Dictionary/A.md … Z.md, "## Name" headings followed by the definition ----
const DICT_DIR = path.join(__dirname, 'Dictionary');
const MAX_DEFS = 12;
const dict = []; // { name, key, tokens, letter, text }
const tokenize = s => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function loadDict() {
  dict.length = 0;
  if (!fs.existsSync(DICT_DIR)) return console.log('No Dictionary folder found');
  for (const file of fs.readdirSync(DICT_DIR).filter(f => /^[A-Z]\.md$/i.test(f)).sort()) {
    const letter = file[0].toUpperCase();
    let cur = null;
    const push = () => { if (cur) { cur.text = cur.body.join('\n').trim(); delete cur.body; dict.push(cur); } };
    for (const l of fs.readFileSync(path.join(DICT_DIR, file), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = /^##\s+(.*)$/.exec(l);
      if (m) { push(); const name = m[1].trim(); cur = { name, key: name.toLowerCase(), tokens: tokenize(name), letter, body: [] }; }
      else if (cur && !/^#\s/.test(l)) cur.body.push(l);
    }
    push();
  }
  console.log(`Loaded ${dict.length} dictionary entries`);
}

// Entries whose heading is the word (first), then headings that contain it as a whole word.
// Falls back to de-possessived / de-pluralised forms only when nothing matches.
function define(word) {
  const w = word.toLowerCase().replace(/[`’]/g, "'").trim();
  const forms = [w];
  for (const re of [/'s$/, /es$/, /s$/]) { const f = w.replace(re, ''); if (f !== w && f.length > 2 && !forms.includes(f)) forms.push(f); }
  for (const f of forms) {
    const exact = dict.filter(d => d.key === f);
    const part = dict.filter(d => d.key !== f && d.tokens.includes(f));
    const all = exact.concat(part);
    if (all.length) return { word: f, total: all.length, entries: all.slice(0, MAX_DEFS).map(d => ({ name: d.name, text: d.text })) };
  }
  return { word: w, total: 0, entries: [] };
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

// ---- Bookmarks: the ONLY thing the server ever writes (data/bookmarks.json, never the Bible/Dictionary files) ----
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data'); // DATA_DIR=… lets tests avoid touching real data
const BM_FILE = path.join(DATA_DIR, 'bookmarks.json');
const MAX_BOOKMARKS = 5000;
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
function cleanBookmarks(a) {
  if (!Array.isArray(a) || a.length > MAX_BOOKMARKS) return null;
  const out = [];
  for (const x of a) {
    if (!x || !Number.isInteger(x.book) || x.book < 0 || x.book >= books.length || !Number.isInteger(x.line) || x.line < 0) return null;
    out.push({ book: x.book, line: x.line, label: str(x.label, 120), text: str(x.text, 300), created: Number.isFinite(x.created) ? x.created : Date.now() });
  }
  return out;
}
// Notes: one markdown file per note in data/notes/ (front matter = passage reference + anchor, body = quote + note),
// plus a generated data/notes/index.md linking to all of them. The .md files are the source of truth.
const NOTES_DIR = path.join(DATA_DIR, 'notes');
const OLD_NOTES_JSON = path.join(DATA_DIR, 'notes.json'); // read once for migration if present
const NOTE_FILE_RE = /^(.+)__([a-z0-9]{1,40})\.md$/;
const nonNeg = v => Number.isInteger(v) && v >= 0;
function cleanNotes(a) {
  if (!Array.isArray(a) || a.length > MAX_BOOKMARKS) return null;
  const out = [], ids = new Set();
  for (const x of a) {
    if (!x || !Number.isInteger(x.book) || x.book < 0 || x.book >= books.length || ![x.sl, x.so, x.el, x.eo].every(nonNeg) || typeof x.id !== 'string' || !/^[a-z0-9]{1,40}$/.test(x.id) || ids.has(x.id)) return null;
    ids.add(x.id);
    out.push({ id: str(x.id, 40), book: x.book, sl: x.sl, so: x.so, el: x.el, eo: x.eo, label: str(x.label, 120), quote: str(x.quote, 2000), note: str(x.note, 20000),
      created: Number.isFinite(x.created) ? x.created : Date.now(), updated: Number.isFinite(x.updated) ? x.updated : Date.now() });
  }
  return out;
}
function readJsonList(file) {
  try { const a = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
}
const noteFileName = n => (n.label || 'note').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) + '__' + n.id + '.md';
const iso = ms => new Date(ms).toISOString();
function noteToMd(n) {
  const fm = { id: n.id, book: n.book, book_name: books[n.book].name, reference: n.label, start_line: n.sl, start_offset: n.so, end_line: n.el, end_offset: n.eo, quote: n.quote, created: iso(n.created), updated: iso(n.updated) };
  const head = Object.entries(fm).map(([k, v]) => `${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`).join('\n');
  return `---\n${head}\n---\n\n# ${n.label}\n\n${n.quote.split('\n').map(l => '> ' + l).join('\n')}\n\n${n.note.trim()}\n`;
}
function mdToNote(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ''));
  if (!m) return null;
  const fm = {};
  for (const l of m[1].split(/\r?\n/)) {
    const k = /^(\w+):\s*(.*)$/.exec(l);
    if (k) { try { fm[k[1]] = JSON.parse(k[2]); } catch { fm[k[1]] = k[2]; } }
  }
  // body: "# reference", then the "> quote" block, then the note itself
  const body = m[2].replace(/^\s*#[^\n]*\n/, '').replace(/^\s*(?:>[^\n]*\n?)+/, '').trim();
  const t = s => { const v = Date.parse(s); return Number.isFinite(v) ? v : Date.now(); };
  return { id: fm.id, book: fm.book, sl: fm.start_line, so: fm.start_offset, el: fm.end_line, eo: fm.end_offset, label: fm.reference, quote: fm.quote, note: body, created: t(fm.created), updated: t(fm.updated) };
}
function readNotes() {
  let files;
  try { files = fs.readdirSync(NOTES_DIR).filter(f => NOTE_FILE_RE.test(f)); } catch { return readJsonList(OLD_NOTES_JSON); }
  const byId = new Map();
  for (const f of files) { // a hand-edited file that no longer parses is skipped, not fatal
    try { const n = mdToNote(fs.readFileSync(path.join(NOTES_DIR, f), 'utf8')); const c = n && cleanNotes([n]); if (c) byId.set(c[0].id, c[0]); } catch {}
  }
  return [...byId.values()].sort((a, b) => a.book - b.book || a.sl - b.sl || a.so - b.so);
}
function writeFileAtomic(file, content) {
  try { if (fs.readFileSync(file, 'utf8') === content) return; } catch {}
  fs.writeFileSync(file + '.tmp', content);
  fs.renameSync(file + '.tmp', file);
}
function writeNotes(list) {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const keep = new Set(['index.md']);
  let index = '# Notes\n\n', last = -1;
  for (const n of list.slice().sort((a, b) => a.book - b.book || a.sl - b.sl || a.so - b.so)) {
    const f = noteFileName(n);
    keep.add(f);
    writeFileAtomic(path.join(NOTES_DIR, f), noteToMd(n));
    if (n.book !== last) { last = n.book; index += `\n## ${books[n.book].name}\n\n`; }
    const q = n.quote.length > 120 ? n.quote.slice(0, 120) + '…' : n.quote;
    index += `- [${n.label}](${encodeURI(f)}) — “${q}”\n`;
  }
  writeFileAtomic(path.join(NOTES_DIR, 'index.md'), index);
  // remove only note files this app created (…__id.md) that are no longer in the list
  for (const f of fs.readdirSync(NOTES_DIR)) if (NOTE_FILE_RE.test(f) && !keep.has(f)) fs.unlinkSync(path.join(NOTES_DIR, f));
}
function writeJsonList(file) {
  return list => { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n'); };
}
function saveList(req, res, clean, write) {
  // Only same-origin JSON from the page itself (blocks cross-site writes to localhost).
  const origin = req.headers.origin;
  if ((origin && origin !== `http://${req.headers.host}`) || !/^application\/json/i.test(req.headers['content-type'] || '')) { res.writeHead(403); return res.end('Forbidden'); }
  let body = '', size = 0;
  req.on('data', c => { size += c.length; if (size > 2e6) req.destroy(); else body += c; });
  req.on('end', () => {
    try {
      const list = clean(JSON.parse(body));
      if (!list) return json(res, { error: 'invalid data' }, 400);
      write(list);
      json(res, { ok: true, count: list.length });
    } catch (e) { console.error(e); json(res, { error: 'bad request' }, 400); }
  });
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  // Read-only except PUT /api/bookmarks and PUT /api/notes (each writes only its own file in data/).
  if (req.method === 'PUT' && p === '/api/bookmarks') return saveList(req, res, cleanBookmarks, writeJsonList(BM_FILE));
  if (req.method === 'PUT' && p === '/api/notes') return saveList(req, res, cleanNotes, writeNotes);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Read-only'); }
  try {
    if (p === '/api/bookmarks') return json(res, readJsonList(BM_FILE));
    if (p === '/api/notes') return json(res, readNotes());
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
    if (p === '/api/define') return json(res, define((u.searchParams.get('w') || '').slice(0, 60)));
    // static files, confined to /public
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const fp = path.normalize(path.join(PUB_DIR, rel));
    if (!fp.startsWith(PUB_DIR + path.sep) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { json(res, { error: String(e) }, 500); }
}).listen(PORT, '127.0.0.1', () => console.log(`Bible reader: http://localhost:${PORT}`));

load();
loadDict();
