const $ = id => document.getElementById(id);
const state = { books: [], cur: null, blocks: [], terms: [], hits: [], reqId: 0, bm: [], notes: [] };
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cache = new Map();

// ---------- Book index ----------
async function init() {
  state.books = await (await fetch('/api/books')).json();
  state.books.forEach(b => BOOK_BY_ALIAS.set(b.name.toLowerCase().replace(/\s/g, ''), b.id)); // full names too
  const box = $('books');
  let html = '';
  state.books.forEach((b, i) => {
    html += `<button class="bk" data-id="${b.id}" data-t="${i < 39 ? 'ot' : 'nt'}">${esc(b.name)}<small>${b.chapters.length || ''}</small></button>`;
  });
  box.innerHTML = html;
  $('testaments').onclick = e => { const t = e.target.closest('button'); if (t) setTestament(t.dataset.t); };
  setTestament('ot');
  box.onclick = e => { const t = e.target.closest('.bk'); if (t) openBook(+t.dataset.id); };
  await Promise.all([loadBookmarks(), loadNotes()]);
  try { document.documentElement.dataset.theme = localStorage.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'); } catch {}
  await route();
}

async function fetchBook(id) {
  if (!cache.has(id)) cache.set(id, await (await fetch('/api/book/' + id)).text());
  return cache.get(id);
}

// ---------- Minimal markdown renderer (every block keeps its source line) ----------
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>');
}
function parse(text) {
  const lines = text.split(/\r?\n/), blocks = [];
  let para = null;
  const flush = () => { if (para) { blocks.push(para); para = null; } };
  lines.forEach((l, n) => {
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { flush(); blocks.push({ line: n, type: 'h' + h[1].length, text: h[2] }); }
    else if (!l.trim()) flush();
    else if (para) para.text += ' ' + l.trim();
    else para = { line: n, type: 'p', text: l.trim() };
  });
  flush();
  return blocks;
}
function blockHtml(b, i) {
  if (b.type === 'p') {
    const v = /^(\d+)[.)]\s+(.*)$/s.exec(b.text);
    return `<p data-i="${i}">${v ? `<span class="vn">${v[1]}</span>${inline(v[2])}` : inline(b.text)}</p>`;
  }
  return `<${b.type} data-i="${i}">${inline(b.text)}</${b.type}>`;
}

async function openBook(id, line = null) {
  const doc = $('doc');
  if (state.cur !== id) {
    const text = await fetchBook(id);
    state.cur = id;
    state.blocks = parse(text);
    const b = state.books[id];
    $('title').textContent = b.name;
    document.title = b.name + ' – Bible Reader';
    doc.innerHTML = state.blocks.map(blockHtml).join('');
    $('chap').innerHTML = '<option value="">Chapter…</option>' + b.chapters.map(c => `<option value="${c.line}">${esc(c.title)}</option>`).join('');
    document.querySelectorAll('.bk').forEach(e => e.classList.toggle('on', +e.dataset.id === id));
    setTestament(id < 39 ? 'ot' : 'nt');
    doc.scrollTop = 0;
    highlightTerms();
    markBookmarks();
    applyNotes();
  }
  if (line != null) goToLine(line);
  history.replaceState(null, '', `#${id}${line != null ? ':' + line : ''}`);
}

function goToLine(line) {
  let idx = 0;
  for (let i = 0; i < state.blocks.length; i++) { if (state.blocks[i].line <= line) idx = i; else break; }
  const el = $('doc').querySelector(`[data-i="${idx}"]`);
  if (!el) return;
  $('doc').querySelectorAll('.target').forEach(e => e.classList.remove('target'));
  el.classList.add('target');
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// highlight current search terms inside the rendered book text
function highlightTerms() {
  const terms = state.terms;
  if (!terms.length) return;
  const whole = $('whole').checked, cs = $('cs').checked;
  const re = new RegExp(terms.map(t => (whole ? '\\b' : '') + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + (whole ? '\\b' : '')).join('|'), cs ? 'g' : 'gi');
  const w = document.createTreeWalker($('doc'), NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    if (n.parentElement.className === 'vn') continue;
    const s = n.nodeValue;
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    const f = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex++; continue; }
      f.append(s.slice(last, m.index));
      const mk = document.createElement('mark');
      mk.textContent = m[0];
      f.append(mk);
      last = m.index + m[0].length;
    }
    f.append(s.slice(last));
    n.replaceWith(f);
  }
}
function clearMarks() { $('doc').querySelectorAll('mark').forEach(m => m.replaceWith(m.textContent)); $('doc').normalize(); }

// ---------- Search ----------
let timer;
function scheduleSearch() { clearTimeout(timer); timer = setTimeout(runSearch, 180); }
async function runSearch() {
  const q = $('q').value.trim(), id = ++state.reqId;
  if (q.length < 2) { state.terms = []; state.hits = []; $('resCount').textContent = ''; showTab('books'); clearMarks(); return; }
  const p = new URLSearchParams({ q, whole: +$('whole').checked, cs: +$('cs').checked });
  const sc = $('scope').value;
  if (sc === 'cur' && state.cur != null) p.set('book', state.cur);
  else if (sc === 'ot' || sc === 'nt') p.set('t', sc);
  const data = await (await fetch('/api/search?' + p)).json();
  if (id !== state.reqId) return; // stale response
  state.terms = data.terms;
  state.hits = data.results;
  $('resCount').textContent = `(${data.total})`;
  renderResults(data);
  showTab('res');
  if (state.cur != null) { clearMarks(); highlightTerms(); }
}
function renderResults(d) {
  const box = $('results');
  if (!d.total) { box.innerHTML = '<div class="status">No matches.</div>'; return; }
  let html = `<div class="status">${d.total.toLocaleString()} matches in ${Object.keys(d.perBook).length} book(s) · ${d.ms.toFixed(0)} ms${d.truncated ? ' · showing first ' + d.results.length : ''}</div>`;
  let last = -1;
  d.results.forEach((r, i) => {
    if (r.b !== last) { last = r.b; html += `<div class="rbook">${esc(state.books[r.b].name)} <small>${d.perBook[r.b]}</small></div>`; }
    let t = '', pos = 0;
    for (const [a, b] of r.r) {
      if (a < pos) continue;
      t += esc(r.t.slice(pos, a)) + '<mark>' + esc(r.t.slice(a, b)) + '</mark>';
      pos = b;
    }
    t += esc(r.t.slice(pos));
    const v = /^(\d+)[.)]\s/.exec(r.t);
    html += `<button class="hit" data-i="${i}"><div class="ref">${esc(r.c || '')}${v ? ':' + v[1] : ''}</div>${t}</button>`;
  });
  box.innerHTML = html;
  box.scrollTop = 0;
}
$('results').onclick = e => {
  const t = e.target.closest('.hit');
  if (!t) return;
  document.querySelectorAll('.hit.on').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  const r = state.hits[+t.dataset.i];
  openBook(r.b, r.l);
  if (innerWidth <= 800) $('side').classList.add('hide');
};

function setTestament(t) {
  const changed = !document.querySelector(`#testaments button.on[data-t="${t}"]`);
  document.querySelectorAll('#testaments button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('.bk').forEach(b => b.hidden = b.dataset.t !== t);
  if (changed) $('books').scrollTop = 0; // keep scroll position when the testament is unchanged
}
function showTab(t) {
  $('testaments').hidden = t !== 'books';
  $('books').hidden = t !== 'books';
  $('results').hidden = t !== 'res';
  $('bookmarks').hidden = t !== 'bm';
  $('notes').hidden = t !== 'notes';
  $('tabBooks').classList.toggle('on', t === 'books');
  $('tabRes').classList.toggle('on', t === 'res');
  $('tabBm').classList.toggle('on', t === 'bm');
  $('tabNotes').classList.toggle('on', t === 'notes');
}

// ---------- Notes (highlight a passage → private markdown note; saved to data/notes.json) ----------
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const chapterOf = i => { for (let k = i; k >= 0; k--) if (state.blocks[k].type === 'h2') return state.blocks[k].text.replace(/^Chapter\s+/i, ''); return '?'; };
const verseOf = b => (/^(\d+)[.)]\s/.exec(b.text) || [])[1] || '';
const textPs = () => [...$('doc').querySelectorAll('p[data-i]')];
const offsetIn = (p, node, off) => { const r = document.createRange(); r.setStart(p, 0); r.setEnd(node, off); return r.toString().length; };
let pendingAnchor = null, draft = null, editing = null, selTimer;

// The current text selection as a passage: start/end block (source line) + char offsets within each block.
function getAnchor() {
  const sel = getSelection();
  if (state.cur == null || !sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!$('doc').contains(r.commonAncestorContainer)) return null;
  let ps = textPs().filter(p => r.intersectsNode(p));
  if (!ps.length) return null;
  let so = ps[0].contains(r.startContainer) ? offsetIn(ps[0], r.startContainer, r.startOffset) : 0;
  let eo = ps[ps.length - 1].contains(r.endContainer) ? offsetIn(ps[ps.length - 1], r.endContainer, r.endOffset) : ps[ps.length - 1].textContent.length;
  if (ps.length > 1 && eo === 0) { ps.pop(); eo = ps[ps.length - 1].textContent.length; }            // triple-click spills into next block
  if (ps.length > 1 && so >= ps[0].textContent.length) { ps.shift(); so = 0; }
  const first = ps[0], last = ps[ps.length - 1];
  if (first === last && eo <= so) return null;
  const bi = +first.dataset.i, bj = +last.dataset.i, v1 = verseOf(state.blocks[bi]), v2 = verseOf(state.blocks[bj]);
  let label = state.books[state.cur].name + ' ' + chapterOf(bi) + (v1 ? ':' + v1 : '');
  if (bi !== bj && v2) label += '–' + (chapterOf(bi) === chapterOf(bj) ? v2 : chapterOf(bj) + ':' + v2);
  return { book: state.cur, sl: state.blocks[bi].line, so, el: state.blocks[bj].line, eo, label, quote: sel.toString().replace(/\s+/g, ' ').trim().slice(0, 2000) };
}
function updateNoteBtn() {
  if ($('noteDlg').open) return; // focusing the textarea fires selectionchange; keep the captured passage
  const btn = $('noteBtn'), a = getAnchor();
  pendingAnchor = a;
  if (!a) { btn.hidden = true; return; }
  const rect = getSelection().getRangeAt(0).getBoundingClientRect();
  btn.hidden = false;
  btn.style.top = Math.min(innerHeight - 44, rect.bottom + 6) + 'px';
  btn.style.left = Math.max(8, Math.min(innerWidth - 130, rect.left)) + 'px';
}
document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(updateNoteBtn, 200); });
$('doc').addEventListener('scroll', () => { $('noteBtn').hidden = true; });
$('noteBtn').onmousedown = e => e.preventDefault(); // keep the selection
$('noteBtn').onclick = () => { if (pendingAnchor) openNote(null, pendingAnchor); };

function openNote(note, anchor) {
  editing = note;
  draft = anchor;
  const d = note || anchor;
  $('noteLabel').textContent = d.label;
  $('noteQuote').textContent = d.quote;
  $('noteText').value = note ? note.note : '';
  $('noteDel').hidden = !note;
  $('noteBtn').hidden = true;
  $('noteDlg').showModal();
  $('noteText').focus();
}
$('noteText').required = true;
$('noteText').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('noteForm').requestSubmit(); };
$('noteCancel').onclick = () => $('noteDlg').close();
$('noteForm').onsubmit = () => {
  const text = $('noteText').value.trim();
  if (!text) return;
  if (editing) { editing.note = text; editing.updated = Date.now(); }
  else if (draft) { state.notes.push({ id: newId(), ...draft, note: text, created: Date.now(), updated: Date.now() }); getSelection().removeAllRanges(); }
  afterNotesChange();
};
$('noteDel').onclick = () => {
  if (!editing || !confirm('Delete this note?')) return;
  state.notes.splice(state.notes.indexOf(editing), 1);
  $('noteDlg').close();
  afterNotesChange();
};
function afterNotesChange() {
  state.notes.sort((a, c) => a.book - c.book || a.sl - c.sl || a.so - c.so);
  renderNotes();
  applyNotes();
  saveNotes();
}
async function loadNotes() {
  try {
    const r = await fetch('/api/notes');
    if (!r.ok) throw new Error(r.status);
    state.notes = await r.json();
    state.notesOK = true;
  } catch { state.notes = []; }
  renderNotes();
}
async function saveNotes() {
  try {
    if (!state.notesOK) throw new Error('notes were not loaded; refusing to overwrite');
    const r = await fetch('/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.notes) });
    if (!r.ok) throw new Error(r.status);
  } catch { $('notes').insertAdjacentHTML('afterbegin', '<div class="status err">Could not save notes to file.</div>'); }
}

// wrap chars [from,to) of a block's text in <span class="nh"> (one span per text node; verse numbers skipped)
function wrapText(p, from, to, id) {
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  let pos = 0;
  for (const t of nodes) {
    const len = t.nodeValue.length, a = Math.max(from - pos, 0), b = Math.min(to - pos, len);
    pos += len;
    if (b <= a || t.parentElement.classList.contains('vn')) continue;
    const mid = t.splitText(a);
    mid.splitText(b - a);
    const s = document.createElement('span');
    s.className = 'nh';
    s.dataset.n = id;
    mid.replaceWith(s);
    s.append(mid);
  }
}
function applyNotes() {
  const doc = $('doc');
  doc.querySelectorAll('span.nh').forEach(s => s.replaceWith(...s.childNodes));
  doc.normalize();
  const mine = state.notes.filter(n => n.book === state.cur);
  if (!mine.length) return;
  const ps = textPs().map(p => [state.blocks[+p.dataset.i].line, p]);
  for (const n of mine) for (const [line, p] of ps) if (line >= n.sl && line <= n.el) wrapText(p, line === n.sl ? n.so : 0, line === n.el ? n.eo : Infinity, n.id);
}
$('doc').addEventListener('click', e => {
  const h = e.target.closest('.nh');
  if (h && getSelection().isCollapsed) openNote(state.notes.find(n => n.id === h.dataset.n));
});

function mdHtml(src) {
  return src.split(/\n\s*\n/).map(b => {
    const lines = b.split('\n'), h = /^#{1,6}\s+(.*)$/.exec(b);
    if (lines.every(l => /^\s*[-*]\s+/.test(l))) return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') + '</ul>';
    if (h && lines.length === 1) return `<h5>${inline(h[1])}</h5>`;
    return '<p>' + lines.map(inline).join('<br>') + '</p>';
  }).join('');
}
function renderNotes() {
  $('noteCount').textContent = state.notes.length ? `(${state.notes.length})` : '';
  const box = $('notes');
  if (!state.notes.length) { box.innerHTML = '<div class="status">No notes yet. Highlight a passage in the text, then click “Add note”.</div>'; return; }
  let html = '<div class="status"><button id="noteExport">Export all as .md</button></div>', last = -1;
  state.notes.forEach((n, i) => {
    if (n.book !== last) { last = n.book; html += `<div class="rbook">${esc(state.books[n.book].name)}</div>`; }
    html += `<div class="noteitem"><button class="hit go" data-i="${i}"><div class="ref">${esc(n.label)}</div><div class="nq">${esc(n.quote)}</div></button>`
      + `<div class="nbody">${mdHtml(n.note)}</div><div class="nact"><button class="ed" data-i="${i}">Edit</button><button class="rm" data-i="${i}">Delete</button></div></div>`;
  });
  box.innerHTML = html;
}
$('notes').onclick = e => {
  if (e.target.closest('#noteExport')) {
    const md = '# Notes\n\n' + state.notes.map(n => `## ${n.label}\n\n> ${n.quote.replace(/\n/g, '\n> ')}\n\n${n.note}\n`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = 'bible-notes.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const n = state.notes[+b.dataset.i];
  if (b.classList.contains('go')) { openBook(n.book, n.sl); if (innerWidth <= 800) $('side').classList.add('hide'); }
  else if (b.classList.contains('ed')) openNote(n);
  else if (b.classList.contains('rm') && confirm('Delete this note?')) { state.notes.splice(+b.dataset.i, 1); afterNotesChange(); }
};
$('tabNotes').onclick = () => showTab('notes');

// ---------- Bookmarks (click a verse number; saved to data/bookmarks.json via the server) ----------
const bmKey = (b, l) => b + ':' + l;
function sortBm() { state.bm.sort((a, c) => a.book - c.book || a.line - c.line); }
async function loadBookmarks() {
  try {
    const r = await fetch('/api/bookmarks');
    if (!r.ok) throw new Error(r.status);
    state.bm = await r.json();
    state.bmOK = true;
  } catch { state.bm = []; }
  sortBm();
  renderBookmarks();
}
async function saveBookmarks() {
  try {
    if (!state.bmOK) throw new Error('bookmarks were not loaded; refusing to overwrite');
    const r = await fetch('/api/bookmarks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.bm) });
    if (!r.ok) throw new Error(r.status);
  } catch { $('bookmarks').insertAdjacentHTML('afterbegin', '<div class="status err">Could not save bookmarks to file.</div>'); }
}
function renderBookmarks() {
  $('bmCount').textContent = state.bm.length ? `(${state.bm.length})` : '';
  const box = $('bookmarks');
  if (!state.bm.length) { box.innerHTML = '<div class="status">No bookmarks yet. Click a verse number in the text to add one.</div>'; return; }
  let html = '', last = -1;
  state.bm.forEach((m, i) => {
    if (m.book !== last) { last = m.book; html += `<div class="rbook">${esc(state.books[m.book].name)}</div>`; }
    html += `<div class="bmi"><button class="hit" data-i="${i}"><div class="ref">${esc(m.label)}</div>${esc(m.text)}</button><button class="del" data-i="${i}" title="Remove bookmark">✕</button></div>`;
  });
  box.innerHTML = html;
}
function markBookmarks() {
  const set = new Set(state.bm.filter(m => m.book === state.cur).map(m => m.line));
  $('doc').querySelectorAll('p[data-i]').forEach(p => p.classList.toggle('bm', set.has(state.blocks[+p.dataset.i].line)));
}
function toggleBookmark(p) {
  const i = +p.dataset.i, blk = state.blocks[i], v = /^(\d+)[.)]\s+(.*)$/s.exec(blk.text);
  if (!v) return;
  const at = state.bm.findIndex(m => m.book === state.cur && m.line === blk.line);
  if (at >= 0) state.bm.splice(at, 1);
  else {
    let ch = '';
    for (let k = i; k >= 0; k--) if (state.blocks[k].type === 'h2') { ch = state.blocks[k].text; break; }
    const ref = (ch.replace(/^Chapter\s+/i, '') || '?') + ':' + v[1];
    state.bm.push({ book: state.cur, line: blk.line, label: `${state.books[state.cur].name} ${ref}`, text: v[2].slice(0, 160), created: Date.now() });
    sortBm();
  }
  renderBookmarks();
  markBookmarks();
  saveBookmarks();
}
$('doc').addEventListener('click', e => {
  const n = e.target.closest('.vn');
  if (n) toggleBookmark(n.closest('p'));
});
$('bookmarks').onclick = e => {
  const d = e.target.closest('.del'), h = e.target.closest('.hit');
  if (d) { state.bm.splice(+d.dataset.i, 1); renderBookmarks(); markBookmarks(); saveBookmarks(); }
  else if (h) {
    const m = state.bm[+h.dataset.i];
    openBook(m.book, m.line);
    if (innerWidth <= 800) $('side').classList.add('hide');
  }
};
$('tabBm').onclick = () => showTab('bm');

// ---------- Scripture references in definitions become links ----------
// Aliases (lowercase, no dots/spaces) per book id, in canonical file order. Only these are linked.
const BOOK_ALIASES = ['gen ge gn', 'ex exod exo', 'lev le lv', 'num nu numb', 'deut de dt', 'josh jos', 'judg judge jdg', 'ruth', '1sam 1sa 1sm', '2sam 2sa 2sm', '1kings 1king 1ki 1kgs', '2kings 2king 2ki 2kgs', '1chr 1chron 1ch', '2chr 2chron 2ch', 'ezra', 'neh', 'esther esth est', 'job', 'ps psa psalm psalms pss', 'prov pro pr', 'eccl eccles ecc ec', 'song cant canticles sos', 'isa', 'jer', 'lam', 'ezek eze', 'dan', 'hos', 'joel', 'amos', 'obad ob', 'jonah', 'micah mic', 'nahum nah', 'hab', 'zeph zep', 'hag', 'zech zec', 'mal', 'matt mat mt', 'mark mk', 'luke lk', 'john jn', 'acts act', 'rom', '1cor', '2cor', 'gal', 'eph', 'phil php', 'col', '1thess 1th', '2thess 2th', '1tim', '2tim', 'titus', 'philem phm', 'heb', 'james jas', '1pet', '2pet', '1john', '2john', '3john', 'jude', 'rev'].map(s => s.split(' '));
const BOOK_BY_ALIAS = new Map();
BOOK_ALIASES.forEach((as, id) => as.forEach(a => BOOK_BY_ALIAS.set(a, id)));
// "Book ch:v" + optional verse range/list, then optional "; ch:v…" continuations (same book)
const VERSES = '\\d+(?:[-–]\\d+(?::\\d+)?)?(?:,\\s*\\d+(?:[-–]\\d+)?(?![\\d:]))*';
const REF_RE = new RegExp(`(?<![\\w.])((?:[1-3]|I{1,3})\\s?)?([A-Z][a-z]+)\\.?\\s+(\\d+):(${VERSES})((?:;\\s*\\d+:${VERSES})*)`, 'g');
const REF_TAIL_RE = /(\d+):(\d+)/;
const ROMAN = { I: '1', II: '2', III: '3' };
const refLink = (b, ch, v, text) => `<a class="ref" href="#${b}" data-b="${b}" data-c="${ch}" data-v="${v}">${text}</a>`;
function linkRefs(escaped) {
  return escaped.replace(REF_RE, (all, pre, word, ch, verses, tail) => {
    const num = pre ? (ROMAN[pre.trim()] || pre.trim()) : '';
    const b = BOOK_BY_ALIAS.get((num + word).toLowerCase());
    if (b === undefined) return all;
    const head = all.slice(0, all.length - tail.length);
    let out = refLink(b, ch, /^\d+/.exec(verses)[0], head);
    for (const seg of tail.split(';').slice(1)) {
      const m = REF_TAIL_RE.exec(seg);
      out += ';' + seg.slice(0, m.index) + refLink(b, m[1], m[2], seg.slice(m.index));
    }
    return out;
  });
}
// source line of chapter:verse in a book's markdown (falls back to the chapter heading, then the top)
function findVerseLine(text, ch, v) {
  const lines = text.split(/\r?\n/);
  const c = lines.findIndex(l => new RegExp(`^##\\s+.*\\b${ch}\\s*$`).test(l));
  if (c < 0) return null;
  for (let n = c + 1; n < lines.length && !/^##\s/.test(lines[n]); n++) if (lines[n].startsWith(v + '. ')) return n;
  return c;
}
$('dictBody').addEventListener('click', async e => {
  const a = e.target.closest('a.ref');
  if (!a) return;
  e.preventDefault();
  const id = +a.dataset.b;
  const line = findVerseLine(await fetchBook(id), a.dataset.c, a.dataset.v);
  await openBook(id, line);
  if (innerWidth <= 800) $('dict').hidden = true;
});

// ---------- Dictionary lookup (select a word in the reader) ----------
let lastWord = '', defId = 0;
function selectedWord() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !$('doc').contains(sel.anchorNode)) return '';
  const w = sel.toString().trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/[’`]s$/, "'s");
  return w.length > 1 && w.length <= 40 && /^[\p{L}'’`-]+( [\p{L}'’`-]+){0,2}$/u.test(w) ? w : '';
}
async function lookup() {
  const w = selectedWord();
  if (!w || w.toLowerCase() === lastWord) return;
  lastWord = w.toLowerCase();
  const id = ++defId;
  const data = await (await fetch('/api/define?w=' + encodeURIComponent(w))).json();
  if (id !== defId) return;
  $('dictTitle').textContent = w;
  const body = $('dictBody');
  if (!data.total) body.innerHTML = `<div class="status">No dictionary entry for “${esc(w)}”.</div>`;
  else {
    body.innerHTML = (data.total > data.entries.length ? `<div class="status">Showing ${data.entries.length} of ${data.total} entries</div>` : '')
      + data.entries.map(e => `<h3>${esc(e.name)}</h3>` + e.text.split(/\n\s*\n/).map(p => `<p>${linkRefs(esc(p.trim()))}</p>`).join('')).join('');
  }
  body.scrollTop = 0;
  $('dict').hidden = false;
}
$('doc').addEventListener('mouseup', () => setTimeout(lookup, 0));
$('doc').addEventListener('touchend', () => setTimeout(lookup, 400));
$('doc').addEventListener('mousedown', () => { lastWord = ''; });
$('dictClose').onclick = () => { $('dict').hidden = true; lastWord = ''; };

// ---------- Wiring ----------
$('q').oninput = scheduleSearch;
$('q').onkeydown = e => {
  if (e.key === 'Enter') { clearTimeout(timer); runSearch(); }
  if (e.key === 'Escape') { $('q').value = ''; runSearch(); }
};
['scope', 'whole', 'cs'].forEach(i => $(i).onchange = runSearch);
$('tabBooks').onclick = () => showTab('books');
$('tabRes').onclick = () => showTab('res');
$('menu').onclick = () => $('side').classList.toggle('hide');
$('chap').onchange = e => { if (e.target.value !== '') goToLine(+e.target.value); e.target.value = ''; };
$('prev').onclick = () => state.cur > 0 && openBook(state.cur - 1);
$('next').onclick = () => state.cur != null && state.cur < state.books.length - 1 && openBook(state.cur + 1);
$('theme').onclick = () => {
  const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = d;
  try { localStorage.theme = d; } catch {}
};
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('side').classList.remove('hide'); $('q').focus(); $('q').select(); }
});
async function route() {
  const m = /^#(\d+)(?::(\d+))?$/.exec(location.hash);
  if (m) await openBook(+m[1], m[2] != null ? +m[2] : null);
}
init();
