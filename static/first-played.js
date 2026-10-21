// First time played (the /first-played panel): every Disco Biscuits song on the night it debuted, from the
// song catalog the radio loads (static/songs.js). A song's sheet plays its debut, latest and top rated
// recordings through the radio's clip player, which pauses the radio and rejoins the live point after.
export async function init({ root, $, prefix, songs, ready, schedule, clip, setQuery }) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ext = (href, text, cls) => { const a = el('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };

  const KIND = { original: ['Original', 'Originals'], cover: ['Cover', 'Covers'], improvisation: ['Improvisation', 'Improvisations'], mashup: ['Mashup', 'Mashups'], unknown: ['Unknown', 'Unknown'] };
  const ERAS = ['Sammy', 'Allen', 'Marlon', 'Between'];
  const NONE = '-';   // songwriter filter value: songs with no songwriter listed
  const eraLabel = e => (e === 'Between' ? 'Between eras' : e);
  const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‘’`]/g, "'").toLowerCase().trim();
  const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
  const clock = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const shortDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const where = x => [x.venue, x.place].filter(Boolean).join(', ');
  const dayAfter = iso => new Date(Date.parse(iso + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  const dayBefore = iso => new Date(Date.parse(iso + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);

  const [lib] = await Promise.all([songs(), ready]);
  if (!lib) {
    $('status').replaceChildren('The song catalog isn\'t available right now. Try again in a bit, or browse it on the ',
      ext('https://discobiscuits.net/songs', 'Biscuits Internet Project'), '.');
    return {};
  }
  const C = lib.catalog, { bip, fmtDate, playsText, sinceText } = lib.lib, songList = C.songs;
  let Y0, Y1, kinds, eras, perYear, haveClips = false, filtered = [], cur = null;
  const jams = new Map();    // song slug -> jams of it on the station
  const clips = new Map();   // recording url -> { song, clip }, to show which one is playing
  const st = { q: '', qText: '', eras: new Set(), kinds: new Set(), by: '', from: null, to: null };

  // ---------- filtering ----------
  function matches(s, skip) {
    if (skip !== 'era' && st.eras.size && !st.eras.has(s.era)) return false;
    if (skip !== 'kind' && st.kinds.size && !st.kinds.has(s.kind)) return false;
    if (skip !== 'by' && st.by && (st.by === NONE ? s.authors.length : !s.names.includes(st.by))) return false;
    if (skip !== 'range' && ((st.from && s.year < st.from) || (st.to && s.year > st.to))) return false;
    if (st.q && !s.key.includes(st.q)) return false;
    return true;
  }
  const active = () => !!(st.q || st.eras.size || st.kinds.size || st.by || st.from || st.to);

  // Filters (and the open song) live in the address so a view can be shared: ?era=Marlon&kind=cover&song=...
  function saveUrl() {
    const p = new URLSearchParams();
    if (st.qText) p.set('q', st.qText);
    if (st.eras.size) p.set('era', [...st.eras].join(','));
    if (st.kinds.size) p.set('kind', [...st.kinds].join(','));
    if (st.by) p.set('by', st.by);
    if (st.from) p.set('from', st.from);
    if (st.to) p.set('to', st.to);
    if (cur) p.set('song', cur.slug);
    setQuery(p);
  }

  // Replaces the filters with the ones in the address; returns the song to open, if any.
  function readUrl(p) {
    st.qText = $('q').value = p.get('q') || ''; st.q = norm(st.qText);
    st.eras.clear(); st.kinds.clear();
    for (const e of (p.get('era') || '').split(',')) if (eras.includes(e)) st.eras.add(e);
    for (const k of (p.get('kind') || '').split(',')) if (kinds.includes(k)) st.kinds.add(k);
    const by = p.get('by') || '';
    st.by = by === NONE || songList.some(s => s.names.includes(by)) ? by : '';
    const year = v => (+v >= Y0 && +v <= Y1 ? +v : null);
    st.from = year(p.get('from')); st.to = year(p.get('to'));
    if (st.from && st.to && st.from > st.to) [st.from, st.to] = [st.to, st.from];
    return p.get('song');
  }

  // ---------- controls ----------
  function chips(box, keys, set, label, kindSwatch) {
    for (const k of keys) {
      const b = el('button', 'chipbtn'); b.type = 'button'; b.dataset.k = k;
      b.setAttribute('role', 'checkbox');
      if (kindSwatch) b.append(el('i', `sw k-${k}`));
      b.append(el('span', null, label(k)), el('b', 'n'));
      b.onclick = () => { set.has(k) ? set.delete(k) : set.add(k); render(); };
      box.append(b);
    }
  }

  function eraTitle(name) {
    const e = C.eras.find(x => x.name === name);
    if (!e) return 'Debuts during a drummer change, between two eras';
    return `${e.drummer} on drums, ${eraDates(e)}`;
  }
  const eraDates = e => (e.start ? `${fmtDate(e.start)} – ${e.end ? fmtDate(e.end) : 'today'}` : `through ${fmtDate(e.end)}`);
  // The drummer changes: [first day without a drummer, last day before the next era].
  function eraGaps() {
    const out = [];
    C.eras.forEach((e, k) => { const n = C.eras[k + 1]; if (n && e.end && n.start && dayAfter(e.end) < n.start) out.push([dayAfter(e.end), dayBefore(n.start)]); });
    return out;
  }

  function updateChips(box, set, key, skip) {
    for (const b of box.children) {
      const n = songList.reduce((a, s) => a + (s[key] === b.dataset.k && matches(s, skip) ? 1 : 0), 0);
      b.setAttribute('aria-checked', set.has(b.dataset.k));
      b.querySelector('.n').textContent = n;
    }
  }

  function updateSongwriters() {
    const n = new Map(); let none = 0, all = 0;
    for (const s of songList) {
      if (!matches(s, 'by')) continue;
      all++; if (!s.authors.length) none++;
      for (const a of s.names) n.set(a, (n.get(a) || 0) + 1);
    }
    if (st.by && st.by !== NONE && !n.has(st.by)) n.set(st.by, 0);
    const sel = $('by');
    sel.replaceChildren(new Option(`All songwriters (${all})`, ''),
      ...[...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, c]) => new Option(`${name} (${c})`, name)));
    if (none || st.by === NONE) sel.append(new Option(`No songwriter listed (${none})`, NONE));
    sel.value = st.by;
  }

  function yearSelects() {
    for (const [id, any] of [['from', 'Any year'], ['to', 'Any year']]) {
      const sel = $(id);
      sel.append(new Option(any, ''));
      for (let y = Y0; y <= Y1; y++) sel.append(new Option(y, y));
      sel.onchange = () => {
        st[id] = +sel.value || null;
        if (st.from && st.to && st.from > st.to) { if (id === 'from') st.to = st.from; else st.from = st.to; }
        render();
      };
    }
  }
  const setRange = (a, b) => { st.from = a; st.to = b; render(); };
  // A year on its own, or back to all years when it's already the whole range.
  const pickYear = y => (st.from === y && st.to === y ? setRange(null, null) : setRange(y, y));

  // ---------- debuts per year ----------
  function buildHist() {
    const h = $('hist');
    h.style.setProperty('--n', Y1 - Y0 + 1);
    for (let y = Y0; y <= Y1; y++) {
      const b = el('button', 'yb' + (y % 5 ? '' : ' l5')); b.type = 'button'; b.dataset.y = y;
      const bw = el('span', 'bw'); bw.append(el('span', 'bar'));
      b.append(el('span', 'yn'), bw, el('span', 'yl', `'${String(y).slice(2)}`));
      h.append(b);
    }
    let drag = null;
    const yearAt = x => { const r = h.getBoundingClientRect(); return Math.min(Y1, Math.max(Y0, Y0 + Math.floor((x - r.left) / r.width * (Y1 - Y0 + 1)))); };
    h.addEventListener('pointerdown', e => { if (e.button === 0 && e.target.closest('.yb')) drag = { a: yearAt(e.clientX), b: null }; });
    h.addEventListener('pointermove', e => {
      if (!drag) return;
      const y = yearAt(e.clientX);
      if (drag.b === null && y === drag.a) return;
      if (drag.b === null) h.setPointerCapture(e.pointerId);
      drag.b = y; shade(Math.min(drag.a, y), Math.max(drag.a, y));
    });
    h.addEventListener('pointerup', () => {
      if (!drag) return;
      const { a, b } = drag; drag = null;
      if (b === null) pickYear(a); else setRange(Math.min(a, b), Math.max(a, b));
    });
    // A vertical swipe hands the gesture to scrolling (touch-action: pan-y), which cancels the pointer.
    h.addEventListener('pointercancel', () => { drag = null; shade(st.from, st.to); });
    // Pointers are handled above; keyboard activation (Enter/Space) arrives as a click with detail 0.
    h.addEventListener('click', e => { const b = e.target.closest('.yb'); if (b && e.detail === 0) pickYear(+b.dataset.y); });
    // Keyboard: the chart is one Tab stop; arrow keys, Home and End move between years, Enter or Space picks.
    // (The From/To selects set the same range, with full-size targets.)
    const bars = [...h.children], roam = b => bars.forEach(x => { x.tabIndex = x === b ? 0 : -1; });
    roam(bars[0]);
    h.addEventListener('focusin', e => { const b = e.target.closest('.yb'); if (b) roam(b); });
    h.addEventListener('keydown', e => {
      const i = bars.indexOf(e.target.closest('.yb')), last = bars.length - 1;
      const j = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i + 1, ArrowDown: i - 1, Home: 0, End: last }[e.key];
      if (i < 0 || j === undefined) return;
      e.preventDefault();
      bars[Math.max(0, Math.min(last, j))].focus();
    });
  }

  function shade(from, to) {
    for (const b of $('hist').children) {
      const y = +b.dataset.y, inside = (!from || y >= from) && (!to || y <= to), ranged = !!(from || to);
      b.classList.toggle('out', !inside);
      b.classList.toggle('sel', ranged && inside);
      b.setAttribute('aria-pressed', ranged && inside);
    }
  }

  function renderHist() {
    const per = new Map();
    for (const s of songList) {
      if (!matches(s, 'range')) continue;
      const m = per.get(s.year) || { n: 0 };
      m[s.kind] = (m[s.kind] || 0) + 1; m.n++;
      per.set(s.year, m);
    }
    const max = Math.max(1, ...[...per.values()].map(m => m.n));
    for (const b of $('hist').children) {
      const y = +b.dataset.y, m = per.get(y) || { n: 0 }, bar = b.querySelector('.bar');
      b.querySelector('.yn').textContent = m.n || '';
      bar.style.height = `${(m.n / max) * 100}%`;
      bar.replaceChildren(...kinds.filter(k => m[k]).map(k => { const i = el('i', `k-${k}`); i.style.flexGrow = m[k]; return i; }));
      // The name starts with what the bar shows (its count and '97), so voice control can say it (WCAG 2.5.3)
      const label = `${m.n ? `${m.n} ` : ''}'${String(y).slice(2)}: ${plural(m.n, 'debut')} in ${y}`;
      b.setAttribute('aria-label', label); b.title = `${y}: ${plural(m.n, 'debut')}`;
    }
    shade(st.from, st.to);
  }

  // Era boundaries under the bars, positioned by date within the years.
  function buildBand() {
    const span = Y1 + 1 - Y0;
    const at = iso => { const y = +iso.slice(0, 4), d0 = Date.UTC(y, 0, 1), d1 = Date.UTC(y + 1, 0, 1); return ((y - Y0) + (Date.parse(iso) - d0) / (d1 - d0)) / span * 100; };
    const box = $('band'), list = C.eras;
    list.forEach((e, k) => {
      const a = e.start ? at(e.start) : 0, b = e.end ? at(dayAfter(e.end)) : 100;
      const seg = el('span', k === list.length - 1 && b - a < 15 ? 'end' : null);
      seg.style.left = a + '%'; seg.style.width = (b - a) + '%';
      seg.append(e.name, el('small', null, `\u00a0· ${e.drummer}`));
      seg.title = `${e.name} era · ${eraTitle(e.name)}`;
      box.append(seg);
    });
    for (const [from, to] of eraGaps()) {
      const a = at(from), g = el('span', 'gap');
      g.style.left = a + '%'; g.style.width = (at(dayAfter(to)) - a) + '%'; g.title = 'Between eras';
      box.append(g);
    }
  }

  // ---------- timeline ----------
  function tile(s) {
    const b = el('button', `tile k-${s.kind}`); b.type = 'button'; b.dataset.slug = s.slug;
    const tx = el('span', 'tx');
    // The name is the visible text (title, then date · venue) followed by details only screen readers get,
    // so voice control can say what it sees (WCAG 2.5.3)
    tx.append(el('span', 'tt', s.title), el('small', null, `${shortDate(s.date)} · ${s.venue}`),
      el('span', 'sr', `: ${KIND[s.kind][0].toLowerCase()}, first played ${fmtDate(s.date)}, ${where(s)}`));
    const marks = el('span', 'marks');
    if (s.debut) marks.append(icon('play', s.debut.how === 'later' ? 'i later' : 'i'));
    if (jams.get(s.slug)) marks.append(icon('radio', 'i onair'));
    b.append(tx, marks);
    if (clips.get(current())?.song === s) b.classList.add('playing');
    return b;
  }

  function renderTimeline() {
    if (!filtered.length) return $('timeline').replaceChildren(el('p', 'empty', 'No songs match. Try fewer filters.'));
    const groups = new Map();
    for (const s of filtered) { if (!groups.has(s.year)) groups.set(s.year, []); groups.get(s.year).push(s); }
    $('timeline').replaceChildren(...[...groups].map(([y, list]) => {
      const sec = el('section', 'yr'), h = el('h3'), total = perYear.get(y), id = `${prefix}y${y}`;
      h.id = id; sec.setAttribute('aria-labelledby', id);
      h.append(el('span', 'y', y), el('span', 'n', list.length === total ? plural(total, 'debut') : `${list.length} of ${plural(total, 'debut')}`));
      const grid = el('div', 'tiles');
      grid.append(...list.map(tile));
      sec.append(h, grid);
      return sec;
    }));
  }

  function render() {
    filtered = songList.filter(s => matches(s));
    updateChips($('eras'), st.eras, 'era', 'era');
    updateChips($('kinds'), st.kinds, 'kind', 'kind');
    updateSongwriters();
    $('from').value = st.from || ''; $('to').value = st.to || '';
    renderHist();
    renderTimeline();
    const n = filtered.length, shows = new Set(filtered.map(s => s.show)).size;
    $('count').textContent = active()
      ? `${n.toLocaleString('en-US')} of ${plural(songList.length, 'song')} match${n ? ` · debuted at ${plural(shows, 'show')}` : ''}`
      : `${plural(n, 'song')} · debuted at ${plural(shows, 'show')}, ${Y0}–${Y1}`;
    $('reset').hidden = !active();
    $('csv').title = active() ? `Download the ${plural(n, 'matching song')} as CSV` : `Download all ${plural(n, 'song')} as CSV`;
    $('csv').setAttribute('aria-label', `Download CSV: ${active() ? `the ${plural(n, 'matching song')}` : `all ${plural(n, 'song')}`}`);
    $('csv').disabled = !n;
    saveUrl();
  }

  // ---------- song sheet ----------
  const HEAR = { debut: 'Hear the debut', later: 'Hear the earliest recording', latest: 'Hear the latest', top: 'Hear this version' };
  // which: 'debut', 'latest', or 'top0'..'top2' (one of the song's top rated versions)
  const clipOf = (s, which) => (which.startsWith('top') ? s.top[+which.slice(3)]?.clip : s[which]);
  const hearKey = (s, which) => (which.startsWith('top') ? 'top' : which === 'latest' ? 'latest' : s.debut.how === 'later' ? 'later' : 'debut');

  function howText(s, which) {
    const c = clipOf(s, which);
    if (which === 'latest') {
      return c.show === s.last.show ? 'From the last time it was played.'
        : `It was last played ${fmtDate(s.last.date)}, but no tape of that show on archive.org has it, so this is the newest recording that does.`;
    }
    if (c.how === 'later') return `The debut (${fmtDate(s.date)}) wasn't taped, so this is the earliest recording that exists.`;
    if (c.how === 'setlist') return 'The debut itself. The taper didn\'t title this track as the song; it sits exactly where BIP\'s setlist puts it.';
    return 'The debut itself, from the taper\'s recording.';
  }

  function progress() {
    const p = el('div', 'prog'), r = el('input');
    r.type = 'range'; r.min = 0; r.max = 1000; r.step = 1; r.value = 0; r.setAttribute('aria-label', 'Seek');
    r.oninput = () => { if (audio.duration) audio.currentTime = (r.value / 1000) * audio.duration; };
    p.append(el('span', 't0', '0:00'), r, el('span', 't1', ''));
    return p;
  }

  function hearButton(s, which) {
    const kind = hearKey(s, which);
    const btn = el('button', kind === 'debut' ? 'hear' : 'hear alt'); btn.type = 'button';
    btn.dataset.url = clipOf(s, which).url; btn.dataset.label = HEAR[kind];
    btn.onclick = () => play(s, which);
    return btn;
  }

  function whenLine(x) {
    const when = el('p');
    when.append(el('b', null, fmtDate(x.date)), ' · ', ext(bip(C, 'shows', x.show), x.venue), x.place ? `, ${x.place}` : '');
    return when;
  }

  function trackLine(c) {
    const track = el('p', 'track');
    const ia = ext(`https://archive.org/details/${encodeURIComponent(c.item)}`, 'archive.org'); ia.append(' ', icon('external-link'));
    track.append(`Taper's track: “${c.track}”${c.length ? ` · ${c.length}` : ''} · `, ia);
    return track;
  }

  function recCard(s, which) {
    const c = clipOf(s, which), kind = hearKey(s, which);
    const box = el('div', 'rec'); box.dataset.url = c.url;
    box.append(el('span', 'label', kind === 'latest' ? 'Latest recording' : kind === 'later' ? 'Earliest recording' : 'The debut'),
      hearButton(s, which), whenLine(c), el('p', 'how', howText(s, which)), trackLine(c), progress());
    return box;
  }

  // "★4.9" from a 1-5 mean
  const stars = r => `★${r.toFixed(1)}`;

  // One of the song's best rated performances: who rated it, and its recording when one was found.
  function topCard(s, v, k) {
    const which = `top${k}`;
    const box = el('li', 'rec top');
    const head = el('span', 'label', `#${k + 1}`);
    if (v.all_timer) { const b = el('span', 'chip hot'); b.append(icon('gem'), 'All-timer'); b.title = 'BIP lists this as an all-timer'; head.append(b); }
    const rates = el('p', 'rates');
    if (v.bip) rates.append(el('span', null, `BIP ${stars(v.bip.rating)} · ${plural(v.bip.votes, 'vote')}`));
    if (v.ia) rates.append(el('span', null, `archive.org ${stars(v.ia.rating)} · ${plural(v.ia.reviews, 'review')} of the show`));
    box.append(head, whenLine(v), rates);
    if (v.clip) { box.dataset.url = v.clip.url; box.append(hearButton(s, which), trackLine(v.clip), progress()); }
    else box.append(el('p', 'how', 'No recording of this version on archive.org.'));
    box.setAttribute('aria-label', `Number ${k + 1}: ${fmtDate(v.date)}, ${v.venue}`);
    return box;
  }

  function fact(dl, term, ...nodes) { const dd = el('dd'); dd.append(...nodes); dl.append(el('dt', null, term), dd); }

  function fillSheet(s) {
    $('d-kind').replaceChildren(el('i', `sw k-${s.kind}`), `${KIND[s.kind][0]} · ${eraLabel(s.era)}`);
    const title = el('h2', 'song', s.title);
    title.id = prefix + 'd-title';
    const by = el('p', 'by');
    if (s.authors.length) { by.append('by '); s.authors.forEach((a, k) => by.append(k ? ', ' : '', ext(bip(C, a.href), a.name))); }
    else by.textContent = 'No songwriter listed';

    const dl = el('dl', 'facts');
    fact(dl, 'First played', el('b', null, fmtDate(s.date)), el('br'), ext(bip(C, 'shows', s.show), s.venue), s.place ? `, ${s.place}` : '');
    const era = C.eras.find(e => e.name === s.era);
    fact(dl, 'Era', era ? `${s.era} era · ${era.drummer} on drums` : 'Between eras, during a drummer change');
    fact(dl, 'Times played', playsText(s));
    if (s.last.show === s.show) fact(dl, 'Last played', 'Only at its debut', el('br'), el('small', null, `That was ${sinceText(s)}`));
    else fact(dl, 'Last played', el('b', null, fmtDate(s.last.date)), el('br'), ext(bip(C, 'shows', s.last.show), s.last.venue),
      s.last.place ? `, ${s.last.place}` : '', el('br'), el('small', null, sinceText(s) === 'last show' ? 'At the most recent show' : sinceText(s)[0].toUpperCase() + sinceText(s).slice(1)));

    const parts = [title, by, dl, el('h3', null, 'Recordings')];
    if (!haveClips) parts.push(el('p', 'note', 'Recordings aren\'t available right now. Try again later.'));
    else if (!s.debut && !s.latest) parts.push(el('p', 'note', 'No recording of this song on archive.org yet.'));
    else {
      const recs = el('div', 'recs');
      if (s.debut) recs.append(recCard(s, 'debut'));
      if (s.latest) recs.append(recCard(s, 'latest'));
      parts.push(recs);
      if (!s.latest && s.debut && s.plays > 1 && s.debut.show !== s.last.show) parts.push(el('p', 'note', 'No newer recording on archive.org has a track titled as this song.'));
    }
    if (s.top.length) {
      const tops = el('ol', 'recs tops');
      tops.append(...s.top.map((v, k) => topCard(s, v, k)));
      parts.push(el('h3', null, 'Top rated versions'), tops);
    }

    const links = el('div', 'links'), n = jams.get(s.slug);
    if (n) {
      const a = el('a', 'nom'); a.href = `/?request=${encodeURIComponent(s.slug)}`;
      a.append(icon('radio'), `${plural(n, 'jam')} on Jam Radio`);
      a.setAttribute('aria-label', `${plural(n, 'jam')} on Jam Radio: request one of ${s.title}`);
      links.append(a);
    }
    const b = ext(bip(C, 'songs', s.slug), 'Song history on BIP', 'bipl'); b.append(icon('external-link', 'i ext'));
    links.append(b);
    parts.push(links);

    const night = songList.filter(o => o.show === s.show && o !== s);
    if (night.length) {
      const box = el('div', 'night');
      for (const o of night) { const nb = el('button', null); nb.type = 'button'; nb.append(el('i', `sw k-${o.kind}`), o.title); nb.onclick = () => openSong(o.slug); box.append(nb); }
      parts.push(el('h3', null, `Also debuted that night (${night.length})`), box);
    }
    $('d-body').replaceChildren(...parts);
  }

  function openSong(slug) {
    const s = C.bySlug.get(slug);
    if (!s) return;
    cur = s;
    fillSheet(s);
    if (!$('sheet').open) $('sheet').showModal();
    $('d-body').scrollTop = 0;
    sync(); saveUrl();
  }

  // ---------- playback: the radio's clip player (host.clip) ----------
  const audio = clip.audio;
  const current = () => (clip.on() && audio.getAttribute('src')) || '';

  function play(s, which) {
    const c = clipOf(s, which);
    if (current() === c.url) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); return; }
    clip.play(s, c, which.startsWith('top') ? +which.slice(3) + 1 : which);
  }

  function sync() {
    const url = current(), on = !!url && !audio.paused;
    for (const b of $('d-body').querySelectorAll('button.hear')) {
      const mine = b.dataset.url === url;
      b.replaceChildren(icon(mine && on ? 'pause' : 'play'), mine && on ? 'Pause' : mine && audio.currentTime > 0 && !audio.ended ? 'Resume' : b.dataset.label);
      b.closest('.rec').classList.toggle('on', mine);
    }
    for (const t of root.querySelectorAll('button.tile.playing')) t.classList.remove('playing');
    const s = clips.get(url)?.song;
    if (s) root.querySelector(`button.tile[data-slug="${CSS.escape(s.slug)}"]`)?.classList.add('playing');
    tick();
  }

  function tick() {
    const url = current();
    if (!url) return;
    const d = audio.duration, t = audio.currentTime, len = Number.isFinite(d) && d ? clock(d) : clips.get(url)?.clip.length || '';
    for (const p of $('d-body').querySelectorAll(`.rec[data-url="${CSS.escape(url)}"] .prog`)) {
      const r = p.querySelector('input');
      if (document.activeElement !== r) r.value = d ? Math.round((t / d) * 1000) : 0;
      r.setAttribute('aria-valuetext', `${clock(t)} of ${len}`);
      p.querySelector('.t0').textContent = clock(t);
      p.querySelector('.t1').textContent = len;
    }
  }

  for (const ev of ['play', 'pause', 'ended', 'playing', 'emptied']) audio.addEventListener(ev, sync);
  for (const ev of ['timeupdate', 'durationchange', 'seeked']) audio.addEventListener(ev, tick);

  // ---------- CSV ----------
  const SOURCE = { title: 'debut', setlist: 'debut (by setlist position)', later: 'earliest later recording' };
  const cell = v => { v = v == null ? '' : String(v); return /[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

  function csv(list) {
    const rows = [['song', 'type', 'authors', 'first_played', 'era', 'venue', 'location', 'times_played', 'show_url', 'song_url',
      'last_played', 'last_venue', 'last_location', 'last_show_url', 'shows_since_last_played',
      'audio_url', 'audio_source', 'audio_date', 'latest_audio_url', 'latest_audio_date',
      'top1_date', 'top1_show_url', 'top2_date', 'top2_show_url', 'top3_date', 'top3_show_url']];
    for (const s of list) {
      const a = s.debut, l = s.latest;
      rows.push([s.title, s.kind, s.names.join('; '), s.date, s.era, s.venue, s.place, s.plays, bip(C, 'shows', s.show), bip(C, 'songs', s.slug),
        s.last.date, s.last.venue, s.last.place, bip(C, 'shows', s.last.show), s.since,
        a?.url, a && SOURCE[a.how], a?.date, l?.url, l?.date,
        ...[0, 1, 2].flatMap(k => (s.top[k] ? [s.top[k].date, bip(C, 'shows', s.top[k].show)] : ['', '']))]);
    }
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  $('csv').onclick = () => {
    const url = URL.createObjectURL(new Blob([csv(filtered)], { type: 'text/csv;charset=utf-8' }));
    const a = el('a'); a.href = url; a.download = 'songs_first_played.csv';
    root.append(a); a.click(); a.remove();   // inside the panel: the page behind it is inert
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---------- start ----------
  function about() {
    const fetched = new Date(C.fetched);
    if (!isNaN(fetched)) $('fresh').textContent = `BIP data as of ${fetched.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`;
    $('bip-link').href = bip(C, 'songs');
    $('ranking').hidden = !songList.some(s => s.top.length);
    if (haveClips) {
      const debut = songList.filter(s => s.debut && s.debut.how !== 'later').length, later = songList.filter(s => s.debut?.how === 'later').length;
      $('tapers').append(` ${debut} songs have their debut on tape; ${later} more have a later recording.`);
    }
    const counts = new Map(ERAS.map(e => [e, songList.filter(s => s.era === e).length]));
    const rows = C.eras.map(e => [e.name, e.drummer, eraDates(e), counts.get(e.name)]);
    const gaps = eraGaps().map(([a, b]) => `${fmtDate(a)} – ${fmtDate(b)}`);
    if (counts.get('Between') || gaps.length) rows.push(['Between eras', 'Drummer changes', gaps.join('; '), counts.get('Between')]);
    $('eratable').replaceChildren(...rows.map(([name, drummer, dates, n]) => {
      const li = el('li'), s = el('span', 's', name);
      s.append(el('small', null, drummer));
      li.append(s, el('span', 't', dates), el('span', 'd', plural(n || 0, 'debut')));
      return li;
    }));
    $('legend').replaceChildren(...[
      [icon('play'), 'Debut on tape'], [icon('play', 'i later'), 'Earliest recording'], [icon('radio', 'i onair'), 'On Jam Radio'],
    ].filter((_, k) => haveClips || k === 2).map(([i, t]) => { const s = el('span'); s.append(i, t); return s; }));
  }

  for (const s of songList) {
    s.year = +s.date.slice(0, 4); s.key = norm(s.title); s.names = s.authors.map(a => a.name);
    for (const c of [s.debut, s.latest, ...s.top.map(v => v.clip)]) if (c) clips.set(c.url, { song: s, clip: c });
  }
  for (const t of schedule().tracks) if (t.slug) jams.set(t.slug, (jams.get(t.slug) || 0) + 1);
  haveClips = songList.some(s => s.debut || s.latest);
  Y0 = Math.min(...songList.map(s => s.year)); Y1 = Math.max(...songList.map(s => s.year));
  perYear = new Map(); for (const s of songList) perYear.set(s.year, (perYear.get(s.year) || 0) + 1);
  kinds = Object.keys(KIND).filter(k => songList.some(s => s.kind === k));
  eras = ERAS.filter(e => songList.some(s => s.era === e));
  chips($('eras'), eras, st.eras, eraLabel, false);
  for (const b of $('eras').children) b.title = eraTitle(b.dataset.k);
  chips($('kinds'), kinds, st.kinds, k => KIND[k][1], true);
  yearSelects(); buildHist(); buildBand(); about();
  let timer;
  $('q').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { st.qText = $('q').value; st.q = norm(st.qText); render(); }, 120); };
  $('by').onchange = () => { st.by = $('by').value; render(); };
  $('reset').onclick = () => { st.q = st.qText = $('q').value = ''; st.eras.clear(); st.kinds.clear(); st.by = ''; st.from = st.to = null; render(); };
  $('timeline').onclick = e => { const t = e.target.closest('.tile'); if (t) openSong(t.dataset.slug); };
  // The song leaves the address as the sheet closes. Escape is caught at 'cancel' too: some browsers are
  // late with 'close' (which then finds the sheet open again if another song was picked meanwhile).
  const closedSong = () => { if (!$('sheet').open && cur) { cur = null; saveUrl(); } };
  const closeSheet = () => { $('sheet').close(); closedSong(); };
  $('d-close').onclick = closeSheet;
  $('sheet').addEventListener('cancel', () => setTimeout(closedSong));
  $('sheet').addEventListener('close', closedSong);
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
  $('status').hidden = true; $('app').hidden = false;

  return {
    // The address's filters and song when it has any (a shared link, "Song history" on the radio);
    // otherwise the panel opens as it was left.
    open(p) {
      const keys = ['q', 'era', 'kind', 'by', 'from', 'to', 'song'];
      if (!keys.some(k => p.has(k)) && filtered.length) return saveUrl();
      const song = readUrl(p);
      render();
      if (song) openSong(song);
    },
  };
}
