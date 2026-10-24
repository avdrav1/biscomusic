// Biscuits Show Radio (shows/index.html): every full soundboard show in shows.json (shows.py), played from
// archive.org one whole show at a time. Listeners vote for the show after this one (functions/_station.js at
// /api/shows); the winner plays in full, and with no votes the schedule (shows.json order, oldest first) goes on.
// Without the API (server.py) it's the plain clock loop over shows.json. Everyone hears the same moment either way.
// The audio engine is the jam radio's (index.html): two decks for gapless handoffs, drift correction.
const $ = id => document.getElementById(id);
const decks = [$('a'), $('b')];
let audio = decks[0];
let P, T = [], total = 0, epoch = 0;   // T: every track of every show in schedule order, `start` its place on the clock
let listening = false, curIdx = -1, shownIdx = -1, shownShow = -1;

const fmt = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const span = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const day = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const showLine = s => `${day(s.date)} · ${s.venue}${s.place ? ` · ${s.place}` : ''}`;
const showLabel = s => `${day(s.date)} · ${s.venue}`;
const clockAt = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titleOf = t => t.title || `Track ${t.n + 1}`;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// Off biscomusic.com (server.py, a Pages preview) the other sites are paths of this one.
if (!/(^|\.)biscomusic\.com$/.test(location.hostname)) document.querySelectorAll('a[data-local]').forEach(a => { a.href = a.dataset.local; });

function program(p) {
  P = p; epoch = Date.parse(p.epoch); T = []; total = 0;
  p.shows.forEach((s, si) => {
    s.start = total; s.first = T.length;
    s.tracks.forEach((t, n) => {
      T.push({ ...t, si, n, start: total, url: `https://archive.org/download/${s.item}/${t.file}` });
      total += t.duration;
    });
    s.length = total - s.start;
  });
}
const showIndex = id => P.shows.findIndex(s => s.show === id);

// ---- What's on air ----
// With the station: the show the server says (ST), `started_at` it. Without: the clock loop over shows.json.
let ST = null, stationTimers = [], lastFetch = 0;

// Track index and offset `off` seconds into show si.
function inShow(si, off) {
  const s = P.shows[si];
  let i = s.first;
  while (i < s.first + s.tracks.length - 1 && T[i + 1].start - s.start <= off) i++;
  return { i, offset: off - (T[i].start - s.start) };
}

function live() {
  if (ST) {
    let si = ST.si, off = (Date.now() - ST.started_at) / 1000;
    const len = P.shows[si].length;
    if (off >= len) {
      if (ST.nextSi >= 0) { off = Math.min(off - len, P.shows[ST.nextSi].length - 0.001); si = ST.nextSi; }
      else off = len - 0.001;   // hold here until we hear what's next
      refreshStationSoon();
    }
    return inShow(si, off);
  }
  const pos = (((Date.now() - epoch) / 1000) % total + total) % total;
  let lo = 0, hi = T.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid].start <= pos) lo = mid; else hi = mid - 1; }
  return { i: lo, offset: pos - T[lo].start };
}

// The track after track i on air: the next one of its show, else the first of the show after it (the clock's next,
// or the station's locked-in next show; -1 while that isn't known yet).
function nextIndex(i) {
  const t = T[i];
  if (t.n < P.shows[t.si].tracks.length - 1) return i + 1;
  if (!ST) return (i + 1) % T.length;
  return t.si === ST.si && ST.nextSi >= 0 ? P.shows[ST.nextSi].first : -1;
}

// What the listener hears: the deck's track while tuned in (it can trail the clock by a VBR seek's error, see DRIFT),
// else what's on air.
function heard() {
  return listening && curIdx >= 0 && audio.currentTime ? { i: curIdx, offset: audio.currentTime } : live();
}

function setStation(v) {
  const prev = ST, si = showIndex(v.track);
  if (si < 0) { ST = null; return; }   // program and station disagree (mid-deploy): use the clock
  ST = { ...v, si, nextSi: v.next ? showIndex(v.next.track) : -1 };
  stationTimers.forEach(clearTimeout);
  const at = ms => setTimeout(fetchStation, Math.max(500, ms - Date.now()));
  stationTimers = [at(ST.lock_at + 1000), at(ST.end_at + 500)];
  if (!prev || prev.round !== ST.round || prev.next?.track !== ST.next?.track) shownIdx = -1;   // redraw Up next
  renderVote();
  if (listening && !prev && live().i !== curIdx) tune();   // first answer overrides the clock guess
}

async function fetchStation() {
  lastFetch = Date.now();
  const v = await ShowStation.get();
  if (v) setStation(v);
}
function refreshStationSoon() { if (Date.now() - lastFetch > 2000) fetchStation(); }

// ---- The page ----
const ARTWORK = [{ src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/static/icon-192.png', sizes: '192x192', type: 'image/png' }];

function render() {
  const { i, offset: at } = heard();
  const t = T[i], s = P.shows[t.si];
  if (i !== shownIdx) {
    shownIdx = i;
    $('song').textContent = titleOf(t);
    document.title = `${titleOf(t)} · ${day(s.date)} · Biscuits Show Radio`;
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: titleOf(t), artist: 'The Disco Biscuits', album: showLine(s), artwork: ARTWORK });
    if (t.si !== shownShow) renderShow(t.si);
    [...$('tracks').children].forEach((li, n) => {
      li.classList.toggle('past', n < t.n);
      li.classList.toggle('cur', n === t.n);
      if (n === t.n) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
    });
    [...$('bar').children].forEach((seg, n) => { seg.className = n < t.n ? 'past' : n === t.n ? 'cur' : ''; });
    renderNext(t.si);
  }
  const into = t.start - s.start + at;
  $('bar').children[t.n].style.setProperty('--p', Math.min(1, at / t.duration));
  $('bar').setAttribute('aria-valuemax', Math.round(s.length));
  $('bar').setAttribute('aria-valuenow', Math.round(into));
  $('bar').setAttribute('aria-valuetext', `Track ${t.n + 1} of ${s.tracks.length}, ${fmt(into)} of ${fmt(s.length)} into the show`);
  $('el').textContent = fmt(at);
  $('rem').textContent = '-' + fmt(t.duration - at);
  $('where').textContent = `Track ${t.n + 1} of ${s.tracks.length} · ${fmt(into)} / ${fmt(s.length)}`;
  renderVoteClock();
  if (listening && navigator.mediaSession?.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: t.duration, position: Math.min(at, t.duration), playbackRate: 1 }); } catch (e) {}
  }
}

// The show on air: its line, where the tape came from, the timeline of its tracks and the track list.
function renderShow(si) {
  shownShow = si;
  const s = P.shows[si];
  $('show').textContent = showLine(s);
  $('source').textContent = `Soundboard: ${s.source}`;
  $('tape').href = `https://archive.org/details/${s.item}`;
  $('bip').href = `https://discobiscuits.net/shows/${s.show}`;
  $('bip').replaceChildren(s.rating ? `★ ${s.rating.toFixed(1)} on BIP ` : 'Setlist on BIP ', icon('external-link'));
  $('bip').setAttribute('aria-label', (s.rating ? `Rated ${s.rating.toFixed(1)} of 5 by ${s.ratings} on the Biscuits Internet Project` : 'Setlist on the Biscuits Internet Project') + ' (opens in a new tab)');
  $('about').hidden = false;
  $('bar').innerHTML = s.tracks.map(t => `<i style="flex-grow:${t.duration}"></i>`).join('');
  let at = 0;
  $('tracks').innerHTML = s.tracks.map((t, n) => `<li><span class="t">${fmt((at += t.duration) - t.duration)}</span>` +
    `<span class="s">${esc(t.title || `Track ${n + 1}`)}${t.segue ? '<span class="segue" aria-label="segues into the next track"> &gt;</span>' : ''}</span><span class="d">${fmt(t.duration)}</span></li>`).join('');
  // Untitled tapes: the setlist says what the tracks hold.
  const untitled = s.tracks.some(t => !t.title);
  $('setlist').hidden = !untitled;
  $('setlist').innerHTML = untitled ? s.setlist.map(([set, songs]) => `<b>${esc(set)}:</b> ${esc(songs)}`).join('<br>') : '';
}

const nextRow = (s, when) => `<li${when ? '' : ' class="later"'}>${when ? `<span class="t">${clockAt(when)}</span>` : ''}` +
  `<span class="s">${esc(showLabel(s))}<small>${esc(s.place)} · ${s.tracks.length} tracks</small></span><span class="d">${span(s.length)}</span></li>`;

// Up next. Without voting: the clock's next shows and when each starts. With voting, the next slot's contenders
// are the vote rows above this list (renderVote), and this is the schedule after them, with no times: votes decide.
function renderNext(si) {
  const rows = [];
  if (!ST) {
    const { i, offset } = heard(), s = P.shows[si];
    let at = Date.now() + (s.start + s.length - (T[i].start + offset)) * 1000;
    for (let k = 1; k <= Math.min(6, P.shows.length - 1); k++) {
      const n = P.shows[(si + k) % P.shows.length];
      rows.push(nextRow(n, at));
      at += n.length * 1000;
    }
  } else {
    const ballot = ballotShows();
    for (const id of ST.rotation.filter(id => !ballot.includes(id)).slice(0, 5)) {
      const n = P.shows[showIndex(id)];
      if (n) rows.push(nextRow(n));
    }
  }
  $('ntitle').textContent = ST ? `Up next at ${clockAt(ST.end_at)}` : 'Coming up';
  $('nsub').hidden = !ST || !rows.length;
  $('next').innerHTML = rows.join('');
  $('count').textContent = `${P.shows.length} full soundboard shows · ${Math.round(total / 3600)} hours`;
}

// ---- Voting: the ballot at the top of Up next, and the request sheet over every show ----
// Rows are built once and updated in place so a tap is never lost to a redraw.
const ballotShows = () => ST.next ? [ST.next.track] : ST.tally.length ? ST.tally.slice(0, 3).map(([id]) => id) : ST.rotation.slice(0, 1);
const voteState = () => ({ counts: new Map(ST.tally), max: ST.tally.length ? ST.tally[0][1] : 0, mine: ShowStation.myVote(ST.round) });
const rated = s => s.rating ? ` · ★ ${s.rating.toFixed(1)}` : '';

function voteRow(s) {
  const li = el('li'); li.dataset.track = s.show;
  const name = el('span', 's');
  name.append(el('span', '', showLabel(s)), el('small', '', `${s.place} · ${s.tracks.length} tracks · ${span(s.length)}${rated(s)}`));
  const meter = el('span', 'meter');
  meter.append(el('i'), el('b'));
  const btn = el('button', 'ghost vbtn');
  btn.onclick = () => castVote(s.show);
  li.append(name, meter, btn);
  return li;
}

function updateVoteRow(li, counts, max, mine) {
  const id = li.dataset.track, n = counts.get(id) || 0, why = ShowStation.blocked(ST, id), label = showLabel(P.shows[showIndex(id)]);
  li.classList.toggle('mine', mine === id);
  li.classList.toggle('lead', n > 0 && n === max);
  li.classList.toggle('blocked', !!why);
  li.querySelector('.meter i').style.width = max ? (100 * n / max) + '%' : '0';
  li.querySelector('.meter b').textContent = n ? n : '';
  const btn = li.querySelector('.vbtn');
  btn.disabled = !!why;
  btn.replaceChildren(...(why ? [why] : mine === id ? [icon('check'), 'Voted'] : ['Vote']));
  btn.setAttribute('aria-label', why ? `${label}: ${why}` : mine === id ? `You voted for ${label}` : `Vote for ${label}`);
}

function renderVote() {
  $('vtop').hidden = $('vreq').hidden = $('vclose').hidden = !ST;
  if (!ST) return;
  const { counts, max, mine } = voteState();
  // Re-rendering the ballot must not drop keyboard focus (WCAG 2.4.3): note which show had it
  const focusShow = $('vote').contains(document.activeElement) ? document.activeElement.closest('[data-track]')?.dataset.track || '' : null;
  const top = ballotShows();
  const key = top.join() + '|' + (ST.next ? 'locked' : ST.tally.length ? 'votes' : 'rotation');
  if ($('vtop').dataset.k !== key) {
    $('vtop').dataset.k = key;
    $('vtop').replaceChildren(...top.map(id => {
      const s = P.shows[showIndex(id)]; if (!s) return document.createTextNode('');
      const li = voteRow(s); li.classList.add('top');
      if (!ST.next && !ST.tally.length) li.querySelector('small').textContent += ' · plays next unless you vote';
      return li;
    }));
  }
  for (const li of $('vtop').children) if (li.dataset.track) updateVoteRow(li, counts, max, mine);
  if ($('sheet').open) updateSheetRows();
  if (focusShow !== null && !$('vote').contains(document.activeElement)) {
    const li = focusShow && $('vtop').querySelector(`li[data-track="${CSS.escape(focusShow)}"]`);
    (li?.querySelector('.vbtn:not(:disabled)') || $('vtop').querySelector('.vbtn:not(:disabled)') || $('vreq')).focus();
  }
  renderVoteClock();
}

function renderVoteClock() {
  if (!ST) return;
  const left = (ST.lock_at - Date.now()) / 1000;
  const next = ST.next && P.shows[ST.nextSi];
  const text = next ? `Locked in: ${showLabel(next)}` : left > 0 ? `voting closes in ${fmt(left)}` : 'closing…';
  $('vclose').textContent = text; $('sclock').textContent = text;
  if (left <= 0 && !ST.next && !$('vote').classList.contains('closed')) { $('vote').classList.add('closed'); renderVote(); }
  else if (left > 0) $('vote').classList.remove('closed');
}

let toastTimer;
function toast(msg, ic) {
  // Inside the open sheet, or it would sit under the sheet's backdrop
  ($('sheet').open ? $('sheet') : document.body).append($('toast'));
  $('toast').replaceChildren(...(ic ? [icon(ic)] : []), msg); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2200);
}

async function castVote(id) {
  if (!ST) return;
  const { view, error, stale } = await ShowStation.vote(ST.round, id);
  if (error) { toast(error); if (stale) fetchStation(); return; }
  setStation(view);
  toast(`Voted for ${showLabel(P.shows[showIndex(id)])}`, 'vote');
}

// The request sheet: search (venue, city, date, any song in the setlist) and an order over every show.
const SHEET = { order: 'all', q: '', shown: 0, rows: new Map(), hay: null };
const PAGE = 30;
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = s => norm(s).split(/[^a-z0-9']+/).filter(Boolean);

function sheetResults() {
  // Every typed word must start a word of the show ("26" finds "Sep 26", not "2026"; "basis" finds Basis for a Day).
  SHEET.hay ||= new Map(P.shows.map(s => [s.show, words(`${s.venue} ${s.place} ${s.date} ${day(s.date)} ${s.setlist.map(x => x[1]).join(' ')}`)]));
  const q = words(SHEET.q);
  const all = P.shows.filter(s => { const toks = SHEET.hay.get(s.show); return q.every(w => toks.some(k => k.startsWith(w))); });
  if (SHEET.order === 'rated') return all.filter(s => s.rating).sort((a, b) => b.rating - a.rating || b.ratings - a.ratings);
  if (SHEET.order === 'long') return [...all].sort((a, b) => b.length - a.length);
  return all;
}

// Under a matching row: the setlist's songs the search found ("Basis for a Day · Set 2").
function songHint(li, s) {
  const q = words(SHEET.q);
  const songs = q.length ? s.setlist.flatMap(([set, line]) => line.split(/, | > /).map(song => [set, song]))
    .filter(([, song]) => { const toks = words(song); return q.some(w => toks.some(k => k.startsWith(w))); }) : [];
  let h = li.querySelector('.hint');
  if (!songs.length) { h?.remove(); return; }
  if (!h) { h = el('small', 'hint'); li.querySelector('.s').append(h); }
  h.textContent = [...new Set(songs.map(([set, song]) => `${song} (${set})`))].slice(0, 3).join(' · ');
}

function renderSheet() {
  const list = sheetResults(), n = list.length;
  $('slist').replaceChildren(...list.slice(0, SHEET.shown).map(s => {
    if (!SHEET.rows.has(s.show)) SHEET.rows.set(s.show, voteRow(s));
    const li = SHEET.rows.get(s.show);
    songHint(li, s);
    return li;
  }));
  $('scount').replaceChildren(n ? `${n} show${n === 1 ? '' : 's'}` : SHEET.q ? `No shows match “${SHEET.q}”. ` : 'No rated shows yet.');
  if (!n && SHEET.q) {
    const clear = el('button', 'linkbtn', 'Clear search');
    clear.onclick = () => { $('sq').value = SHEET.q = ''; SHEET.shown = PAGE; renderSheet(); $('sq').focus(); };
    $('scount').append(clear);
  }
  $('smore').hidden = n <= SHEET.shown;
  $('smore').textContent = `Show more (${n - SHEET.shown} left)`;
  updateSheetRows();
}

function updateSheetRows() {
  if (!ST) return;
  const { counts, max, mine } = voteState();
  for (const li of $('slist').children) updateVoteRow(li, counts, max, mine);
}

function openSheet() {
  if (!ST) return;
  SHEET.shown = PAGE;
  renderSheet();
  $('sheet').showModal();
  if (matchMedia('(pointer: fine)').matches) $('sq').focus();   // don't pop the keyboard on phones
}

let searchTimer;
$('vreq').onclick = openSheet;
$('sclose').onclick = () => $('sheet').close();
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').close(); });   // tap the backdrop
$('sq').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { SHEET.q = $('sq').value; SHEET.shown = PAGE; renderSheet(); }, 100); };
$('smore').onclick = () => { SHEET.shown += PAGE; renderSheet(); };
document.querySelectorAll('#sheet [data-f]').forEach(b => b.onclick = () => {
  document.querySelectorAll('#sheet [data-f]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
  SHEET.order = b.dataset.f; SHEET.shown = PAGE; renderSheet();
});

// ---- Audio: two decks, `audio` on air and the spare preloading the next track so the handoff is gapless ----
const PRELOAD_SECONDS = 45;
let gen = 0, retryDelay = 1000, cued = -1;   // cued = track index loaded on the spare deck
const spare = () => decks[audio === decks[0] ? 1 : 0];
const clear = d => { d.pause(); d.removeAttribute('src'); d.load(); };

function loaded(d) {
  return new Promise((ok, fail) => {
    if (d.readyState >= 1) return ok();
    const done = f => () => { d.removeEventListener('loadedmetadata', yes); d.removeEventListener('error', no); f(); };
    const yes = done(ok), no = done(() => fail(new Error('load failed')));
    d.addEventListener('loadedmetadata', yes); d.addEventListener('error', no);
  });
}

// (Re)join the live point. Each call bumps `gen`, so a stale load or retry can't take over.
async function tune() {
  const g = ++gen;
  const { i } = live();
  if (cued === i) { const old = audio; audio = spare(); clear(old); }
  else { clear(spare()); audio.src = T[i].url; }
  cued = -1; curIdx = i;
  try {
    await loaded(audio);
    if (g !== gen) return;
    audio.currentTime = live().offset;
    await audio.play();
    retryDelay = 1000;
    $('status').hidden = true;
  } catch (e) {
    if (g !== gen || !listening) return;
    if (e.name === 'NotAllowedError') return stop();
    $('status').hidden = false;
    setTimeout(() => g === gen && listening && tune(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  }
  render();
}

// Track ended: start the cued spare right away; fall back to a normal tune if it isn't ready.
async function handoff() {
  const n = nextIndex(curIdx), next = spare();
  if (n < 0) { await fetchStation(); return tune(); }   // the show ended before we heard what's next
  if (cued !== n || next.readyState < 3) return tune();
  const old = audio, g = ++gen;
  audio = next; curIdx = n; cued = -1;
  try { next.currentTime = 0; await next.play(); clear(old); render(); }
  catch (e) { if (g === gen) { audio = old; tune(); } }
}

function preloadNext() {
  if (!listening || audio.paused || !audio.duration) return;
  const n = nextIndex(curIdx);
  if (n < 0 || cued === n || audio.duration - audio.currentTime > PRELOAD_SECONDS) return;
  const d = spare(); d.src = T[n].url; d.preload = 'auto'; d.load(); cued = n;
}

function setTune(ic, label) { $('tune').replaceChildren(icon(ic), Object.assign(document.createElement('span'), { textContent: label })); $('tune').setAttribute('aria-label', label); }
function start() { listening = true; if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; setTune('square', 'Stop'); $('tune').className = 'stop'; $('live').classList.add('on'); $('eq').classList.add('on'); tune(); heartbeat(); }
function stop() { listening = false; if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; gen++; decks.forEach(clear); cued = -1; curIdx = -1; setTune('play', 'Tune in'); $('tune').className = ''; $('live').classList.remove('on'); $('eq').classList.remove('on'); $('status').hidden = true; heartbeat(true); }

// Listener count: tuned-in tabs check in every minute with a random per-tab id (no IP), as on the jam radio.
// Only with the station API (`on` once it answers); server.py has none.
const LISTENERS = { on: false, id: [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''), n: 0 };
function showListeners(n) {
  LISTENERS.n = n;
  $('listeners').textContent = `${n} listening`;
  $('listeners').hidden = !n;
}
async function heartbeat(leaving) {
  if (!LISTENERS.on) return;
  const body = JSON.stringify({ id: LISTENERS.id, leaving: !!leaving });
  if (leaving) {
    showListeners(Math.max(0, LISTENERS.n - 1));
    if (navigator.sendBeacon && navigator.sendBeacon('/api/shows/presence', body)) return;
  }
  try {
    const r = await fetch('/api/shows/presence', { method: 'POST', body, keepalive: true });
    if (r.ok) showListeners((await r.json()).listening);
  } catch (e) {}
}
async function pollListeners() {
  if (!LISTENERS.on) return;
  if (listening) return heartbeat();   // background tabs keep counting while they play
  if (document.visibilityState !== 'visible') return;
  try { const r = await fetch('/api/shows/presence'); if (r.ok) showListeners((await r.json()).listening); } catch (e) {}
}
addEventListener('pagehide', () => listening && heartbeat(true));

decks.forEach(d => {
  d.addEventListener('ended', e => listening && e.target === audio && handoff());
  d.addEventListener('error', e => {
    if (e.target !== audio) { if (!e.target.getAttribute('src')) return; cued = -1; return; }
    // Load failures are retried by tune(); this only handles errors after the track loaded.
    if (listening && audio.readyState >= 1) { const g = gen; setTimeout(() => g === gen && listening && tune(), retryDelay); retryDelay = Math.min(retryDelay * 2, 15000); }
  });
  d.addEventListener('timeupdate', e => e.target === audio && preloadNext());
  d.volume = 0.9;
});
$('tune').onclick = () => listening ? stop() : start();
$('vol').oninput = e => decks.forEach(d => { d.volume = e.target.value; });

// Space plays and pauses, as in any player; left alone while typing, on controls Space already presses, and in the sheet.
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !P || $('sheet').open) return;
  if (e.target.closest?.('input, textarea, select, button, a[href], summary, [contenteditable], [role="radio"]')) return;
  e.preventDefault();
  if (listening) stop(); else start();
});

// Lock screen / headset / car controls. It's radio: pause stops, play rejoins the live point, no seeking.
const msSet = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
if ('mediaSession' in navigator) {
  msSet('play', () => !listening && start());
  msSet('pause', () => listening && stop());
  msSet('stop', () => listening && stop());
  ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'].forEach(a => msSet(a, null));
}

// Drift correction: stay within DRIFT seconds of the live point. Looser than the jam radio's 2s: archive.org's MP3s
// are VBR, which browsers seek into by estimate, so joining mid-track can land a few seconds off, and correcting
// that at the next track would jump. A handoff due within DRIFT, or done a moment early, is left alone.
const DRIFT = 10;
setInterval(() => {
  if (!listening || audio.paused || audio.seeking || curIdx < 0) return;
  const { i, offset } = live();
  if (i === curIdx) { if (Math.abs(audio.currentTime - offset) > DRIFT) audio.currentTime = offset; return; }
  const finishing = nextIndex(curIdx) === i && audio.duration - audio.currentTime < DRIFT;
  const early = nextIndex(i) === curIdx && T[i].duration - offset < DRIFT;
  if (!finishing && !early) tune();
}, 10000);

fetch('/shows.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(p => {
  program(p);
  $('tune').disabled = false;
  render();
  setInterval(render, 1000);
  // Poll only while the page is on screen. A tab playing in the background still hands off on time:
  // setStation() schedules a fetch for the vote lock and the show's end (plus a check once a minute).
  const visible = () => document.visibilityState === 'visible';
  fetchStation().then(() => {
    if (!ST) return;
    setInterval(() => visible() && fetchStation(), 10000);
    setInterval(() => !visible() && listening && fetchStation(), 60000);   // safety net if a scheduled fetch failed
    LISTENERS.on = true;
    pollListeners(); setInterval(pollListeners, 60000);
  });
}).catch(() => { $('song').textContent = 'The program didn’t load. Reload to try again.'; });
