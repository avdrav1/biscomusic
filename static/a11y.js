// Page-wide accessibility helpers, on every page.

// "Pause animations" (WCAG 2.2.2): the header's #motion button stops the decorative motion (the lasers, the
// oil in the header, the EQ bars) and the choice is remembered. Until someone chooses, the system's
// reduce-motion setting decides. Sets <html class="still"> when paused and "moving" when running;
// app.css and static/oil.js follow those, and a "motionchange" event tells scripts to look again.
(() => {
  const KEY = 'motion', root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const chosen = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const paused = () => (chosen() ? chosen() === 'off' : reduced.matches);

  function apply() {
    const still = paused();
    root.classList.toggle('still', still);
    root.classList.toggle('moving', !still);
    const b = document.getElementById('motion');
    if (b) {
      b.setAttribute('aria-pressed', still);
      b.title = still ? 'Play animations' : 'Pause animations';
      b.replaceChildren(icon(still ? 'play' : 'pause'));
    }
    document.dispatchEvent(new Event('motionchange'));
  }

  document.getElementById('motion')?.addEventListener('click', () => {
    try { localStorage.setItem(KEY, paused() ? 'on' : 'off'); } catch (e) {}
    apply();
  });
  reduced.addEventListener('change', apply);
  apply();
})();

// Radio groups made of buttons (role="radio"): the ARIA radio group pattern. Arrow keys, Home and End move
// the choice; only the checked radio is a Tab stop, so Tab skips past the group in one step. Covers
// groups built or re-rendered later too.
(() => {
  const radios = g => [...g.querySelectorAll('[role="radio"]')].filter(r => !r.disabled && !r.closest('[hidden]'));
  const rove = g => {
    const all = radios(g), on = all.find(r => r.getAttribute('aria-checked') === 'true') || all[0];
    all.forEach(r => { r.tabIndex = r === on ? 0 : -1; });
  };
  document.addEventListener('keydown', e => {
    const r = e.target.closest?.('[role="radio"]'), g = r?.closest('[role="radiogroup"]');
    if (!g || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const all = radios(g), i = all.indexOf(r), n = all.length;
    const next = all[e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (/Right|Down/.test(e.key) ? 1 : -1) + n) % n];
    e.preventDefault();
    next.focus();
    next.click();
  });
  const groups = new Set();
  new MutationObserver(ms => {
    for (const m of ms) {
      const g = m.target.closest?.('[role="radiogroup"]');
      if (g) groups.add(g);
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches('[role="radiogroup"]')) groups.add(n);
        n.querySelectorAll('[role="radiogroup"]').forEach(x => groups.add(x));
      }
    }
    groups.forEach(rove); groups.clear();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked', 'hidden'] });
  document.querySelectorAll('[role="radiogroup"]').forEach(rove);
})();
