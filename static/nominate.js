// Nominate jams (the /nominate panel): every Disco Biscuits performance on Nugs (nominees.json, searched by
// static/nominees.js), with an upvote for the ones listeners want on the station (/api/nominations).
export async function init({ root, $, fmt, showLine, toast, nominees, setQuery }) {
  const { load, search } = await nominees();
  const PAGE = 50;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  let tracks = [], votes = new Map(), mine = new Set(), online = false, results = [], shown = PAGE;
  const opts = { query: '', sort: 'top', minMinutes: 0, mineOnly: false };

  // Keep the search in the address so a list can be shared ("/nominate?q=tron&sort=long").
  function saveUrl() {
    const p = new URLSearchParams();
    if (opts.query) p.set('q', opts.query);
    if (opts.sort !== 'top') p.set('sort', opts.sort);
    if (opts.minMinutes) p.set('long', '1');
    setQuery(p);
  }

  function refresh() {
    results = search(tracks, opts, votes);
    if (opts.mineOnly) results = results.filter(t => mine.has(t.id));
    shown = PAGE; render(); saveUrl();
  }

  function row(t) {
    const li = el('li'); li.dataset.id = t.id;
    li.classList.toggle('mine', mine.has(t.id));
    const left = el('span');
    if (t.onAir) {
      left.append(el('span', 'aired', 'On the radio'));
    } else {
      const up = el('button', 'ghost up');
      up.setAttribute('aria-pressed', mine.has(t.id));
      up.setAttribute('aria-label', upLabel(t, votes.get(t.id) || 0));
      up.append(icon('arrow-big-up'), el('b', null, String(votes.get(t.id) || 0)));
      up.disabled = !online;
      up.onclick = () => toggle(t, up);
      left.append(up);
    }
    const s = el('span', 's');
    s.append(el('span', null, t.title), el('small', null, showLine(t.show)));
    const meta = el('span', 'meta');
    const nugs = el('a'); nugs.href = `https://play.nugs.net/release/${t.show.id}`; nugs.target = '_blank'; nugs.rel = 'noopener';
    nugs.append('Nugs', icon('external-link')); nugs.setAttribute('aria-label', `Listen on Nugs: ${showLine(t.show)}`);
    meta.append(el('span', null, fmt(t.seconds)), nugs);
    li.append(left, s, meta);
    return li;
  }

  function render() {
    const n = results.length;
    $('count').textContent = n === tracks.length
      ? `${n.toLocaleString()} performances · ${new Set(tracks.map(t => t.show.id)).size.toLocaleString()} shows`
      : `${n.toLocaleString()} match${n === 1 ? '' : 'es'}`;
    if (!n) {
      const li = el('li'); li.append(el('span', 'empty', opts.mineOnly ? 'No picks yet. Upvote a few jams and they\'ll show up here.' : 'Nothing matches. Try fewer words.'));
      $('list').replaceChildren(li);
    } else {
      $('list').replaceChildren(...results.slice(0, shown).map(row));
    }
    $('more').hidden = shown >= n;
    $('more').textContent = `Show more (${(n - shown).toLocaleString()} left)`;
  }

  // Starts with the count the button shows, so voice control can say what it sees (WCAG 2.5.3).
  const upLabel = (t, n) => `${n} ${n === 1 ? 'vote' : 'votes'}: upvote ${t.title}, ${showLine(t.show)}`;

  async function toggle(t, btn) {
    const on = !mine.has(t.id), before = votes.get(t.id) || 0;
    // Optimistic: flip it now, undo if the server says no.
    const set = (isOn, count) => {
      isOn ? mine.add(t.id) : mine.delete(t.id); votes.set(t.id, count);
      btn.setAttribute('aria-pressed', isOn); btn.querySelector('b').textContent = count; btn.setAttribute('aria-label', upLabel(t, count));
      btn.closest('li').classList.toggle('mine', isOn);
    };
    if (btn.getAttribute('aria-disabled') === 'true') return;
    set(on, Math.max(0, before + (on ? 1 : -1)));
    // aria-disabled, not disabled: a disabled button drops keyboard focus to the page (WCAG 2.4.3)
    btn.setAttribute('aria-disabled', 'true');
    try {
      const r = await fetch('/api/nominations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track: t.id, on }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Couldn\'t save that vote');
      set(body.on, body.votes);
      if (on) toast(`Nominated ${t.title} (${t.show.date})`, 'arrow-big-up');
    } catch (e) {
      set(!on, before); toast(e.message);
    } finally { btn.removeAttribute('aria-disabled'); }
  }

  const sorts = root.querySelectorAll('[data-sort]');
  const pickSort = sort => { opts.sort = sort; sorts.forEach(x => x.setAttribute('aria-checked', x.dataset.sort === sort)); };
  const setCheck = (id, on) => $(id).setAttribute('aria-checked', on);

  // A search from the address (/nominate?q=…, as the request sheet links here) replaces the current one.
  function apply(p) {
    opts.query = $('q').value = p.get('q') || '';
    pickSort(['top', 'long', 'new', 'old'].includes(p.get('sort')) ? p.get('sort') : 'top');
    opts.minMinutes = p.get('long') ? 20 : 0; setCheck('long', !!opts.minMinutes);
  }

  let timer;
  $('q').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { opts.query = $('q').value; refresh(); }, 120); };
  sorts.forEach(b => b.onclick = () => { pickSort(b.dataset.sort); refresh(); });
  $('long').onclick = () => { opts.minMinutes = opts.minMinutes ? 0 : 20; setCheck('long', !!opts.minMinutes); refresh(); };
  $('minef').onclick = () => { opts.mineOnly = !opts.mineOnly; setCheck('minef', opts.mineOnly); refresh(); };
  $('more').onclick = () => { shown += PAGE; render(); };

  const loaded = Promise.all([
    fetch('/nominees.json').then(r => r.json()),
    fetch('/api/nominations').then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([data, noms]) => {
    tracks = load(data);
    online = !!noms;
    if (noms) { votes = new Map(noms.votes); mine = new Set(noms.mine); }
    $('offline').hidden = online;
  }).catch(() => { tracks = null; $('list').replaceChildren(el('li')); $('list').firstChild.append(el('span', 'empty', 'Couldn\'t load the catalog. Try reloading.')); });

  return {
    async open(p) {
      if (['q', 'sort', 'long'].some(k => p.has(k))) apply(p);
      await loaded;
      if (tracks) refresh();
    },
  };
}
