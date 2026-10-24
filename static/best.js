// Best moments (the /best panel): the most-loved 15 seconds on the station (/api/best), each linking to
// its moment on the radio, with a vote to hear it again.
export function init({ $, fmt, showLine, trackId, ready, schedule, station, castVote }) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const label = m => `${m.song}${m.jam ? ` (jam ${m.jam})` : ''}`;
  const starts = new Map();   // track id -> its start in the clock loop (no station API)
  let total = 0, moments = [], timer = 0, shown = false;

  function message(text) { const li = el('li'); li.append(el('span', 'empty', text)); $('list').replaceChildren(li); }

  // Seconds until a moment airs next (0 while it's on), from the same clock the radio uses.
  function wait(m) {
    const S = schedule(), now = ((Date.now() - Date.parse(S.epoch)) / 1000) % total;
    const d = ((starts.get(m.track) + m.pos - now) % total + total) % total;
    return d > total - 15 ? 0 : d;
  }

  function render() {
    if (!moments.length) return message('No reactions yet. Tap the flame while you listen and the best moments will show up here.');
    $('list').replaceChildren(...moments.map((m, k) => {
      const li = el('li');
      const s = el('span', 's');
      const a = el('a', null, `${label(m)} @ ${fmt(m.pos)}`);
      a.href = `/?m=${m.track}@${m.pos}` + (m.comment ? `&c=${m.comment.id}` : '');
      s.append(a, el('small', null, showLine(m)));
      const stats = el('span', 'stats');
      for (const [n, ic, what] of [[m.fire, 'flame', 'reactions'], [m.comments, 'message-circle', 'comments']]) {
        if (!n) continue;
        const c = el('span', 'chip' + (ic === 'flame' ? ' hot' : '')); c.append(icon(ic), String(n)); c.title = `${n} ${what}`;
        stats.append(c);
      }
      s.append(stats);
      if (m.comment) {
        const q = el('span', 'quote');
        q.append(el('b', null, m.comment.nickname || 'anonymous'), document.createTextNode(': ' + m.comment.body));
        s.append(q);
      }
      // Status cell: a Vote button (kept between ticks so a tap isn't lost) or a status line.
      const w = el('span', 'when'); w.dataset.k = k;
      const btn = el('button', 'ghost vbtn', 'Vote'); btn.hidden = true;
      btn.onclick = () => vote(m);
      btn.setAttribute('aria-label', `Vote for ${label(m)} to play next`);
      w.append(el('span', 'status'), btn);
      li.append(el('span', 'rank', k + 1), s, w);
      return li;
    }));
    tick();
  }

  // With voting, when a moment airs next depends on listeners, so each row offers a vote instead.
  function tick() {
    const ST = station();
    for (const w of $('list').querySelectorAll('.when')) {
      const m = moments[w.dataset.k], status = w.querySelector('.status'), btn = w.querySelector('.vbtn');
      let text = '', canVote = false, onAir = false;
      if (!ST) {
        const d = wait(m); onAir = d === 0; text = onAir ? 'on air now' : `airs in ${fmt(d)}`;
      } else if (m.track === ST.track) {
        const off = (Date.now() - ST.started_at) / 1000;
        onAir = true; text = off < m.pos ? `on air · in ${fmt(m.pos - off)}` : 'on air now';
      } else if (ST.next?.track === m.track) { onAir = true; text = 'up next!'; }
      else if (Station.myVote(ST.round) === m.track) text = 'you voted';
      else { const why = Station.blocked(ST, m.track); if (why) text = why.toLowerCase(); else canVote = true; }
      w.classList.toggle('now', onAir);
      // A Vote button that hides while focused (after voting, or when voting closes) hands focus to the
      // moment's link in the same row, so keyboard users aren't dropped (WCAG 2.4.3)
      const refocus = !canVote && document.activeElement === btn;
      status.textContent = text; status.hidden = canVote; btn.hidden = !canVote;
      if (refocus) w.closest('li').querySelector('a').focus();
    }
  }

  async function vote(m) {
    if (!station()) return;
    await castVote(m.track);
    tick();
  }

  const loaded = Promise.all([ready, fetch('/api/best').then(r => r.ok ? r.json() : null).catch(() => null)]).then(([, best]) => {
    schedule().tracks.forEach(t => { starts.set(trackId(t), total); total += t.duration; });
    if (!best) return message('Best moments are only available on jams.biscomusic.com.');
    moments = best.moments;
    render();
  });

  return {
    open() { shown = true; loaded.then(() => { if (shown && moments.length && !timer) { tick(); timer = setInterval(tick, 1000); } }); },
    close() { shown = false; clearInterval(timer); timer = 0; },
  };
}
