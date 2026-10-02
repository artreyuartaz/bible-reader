const $ = id => document.getElementById(id);
const state = { books: [], cur: null, blocks: [], terms: [], hits: [], reqId: 0 };
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cache = new Map();

// ---------- Book index ----------
async function init() {
  state.books = await (await fetch('/api/books')).json();
  const box = $('books');
  let html = '';
  state.books.forEach((b, i) => {
    html += `<button class="bk" data-id="${b.id}" data-t="${i < 39 ? 'ot' : 'nt'}">${esc(b.name)}<small>${b.chapters.length || ''}</small></button>`;
  });
  box.innerHTML = html;
  $('testaments').onclick = e => { const t = e.target.closest('button'); if (t) setTestament(t.dataset.t); };
  setTestament('ot');
  box.onclick = e => { const t = e.target.closest('.bk'); if (t) openBook(+t.dataset.id); };
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
  document.querySelectorAll('#testaments button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('.bk').forEach(b => b.hidden = b.dataset.t !== t);
  $('books').scrollTop = 0;
}
function showTab(t) {
  $('testaments').hidden = t !== 'books';
  $('books').hidden = t !== 'books';
  $('results').hidden = t !== 'res';
  $('tabBooks').classList.toggle('on', t === 'books');
  $('tabRes').classList.toggle('on', t === 'res');
}

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
