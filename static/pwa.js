// Installable app: registers the service worker (sw.js), offers "Install app" on the radio page
// (the browser's own prompt on Android/desktop, step-by-step help on iPhone), and shows a banner
// while offline. Loaded by every page after station.js (uses its icon() helper).
(() => {
  const $el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosSafari = ios && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  const SNOOZE_DAYS = 14;

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // ---- Offline banner (every page) ----
  const offline = $el('div', 'offline'); offline.setAttribute('role', 'status'); offline.hidden = true;
  offline.append(icon('wifi-off'), $el('span', null, "You're offline. The radio picks back up when you reconnect."));
  const showOffline = () => { offline.hidden = navigator.onLine; };
  addEventListener('offline', showOffline);
  addEventListener('online', () => {
    showOffline();
    if (typeof window.fetchStation === 'function') window.fetchStation();   // the radio page: catch up right away
  });

  // ---- Install card (radio page only) ----
  let deferred = null;   // Android/desktop: the browser's install prompt, saved for our button
  const isRadio = !!document.getElementById('tune');
  const snoozed = () => Date.now() - Number(store.get('pwa-snoozed') || 0) < SNOOZE_DAYS * 864e5;

  const card = $el('section', 'install'); card.hidden = true;
  card.setAttribute('aria-labelledby', 'install-title');
  const text = $el('div', 'install-text');
  const title = $el('b', null, 'Get Jam Radio on your home screen'); title.id = 'install-title';
  text.append(title, $el('small', null, 'Opens full-screen and keeps playing from your lock screen.'));
  const go = $el('button'); go.append(icon('download'), $el('span', null, 'Install app'));
  const later = $el('button', 'ghost iconbtn'); later.setAttribute('aria-label', 'Not now'); later.append(icon('x'));
  card.append(icon('radio', 'i big'), text, go, later);

  const update = () => { card.hidden = standalone || !isRadio || snoozed() || !(deferred || iosSafari); };

  go.onclick = async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({}));
      deferred = null;
      if (outcome !== 'accepted') store.set('pwa-snoozed', Date.now());
      update();
    } else if (iosSafari) openIosHelp();
  };
  later.onclick = () => { store.set('pwa-snoozed', Date.now()); update(); };

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; update(); });
  addEventListener('appinstalled', () => { deferred = null; card.hidden = true; });

  // iPhone/iPad have no install prompt: show the three taps instead.
  function openIosHelp() {
    let d = document.getElementById('ios-help');
    if (!d) {
      d = $el('dialog', 'sheet ios-help'); d.id = 'ios-help'; d.setAttribute('aria-labelledby', 'ios-title');
      const head = $el('div', 'sheet-head');
      const h = $el('h2', null, 'Add Jam Radio to your Home Screen'); h.id = 'ios-title';
      const close = $el('button', 'ghost iconbtn'); close.setAttribute('aria-label', 'Close'); close.append(icon('x'));
      close.onclick = () => d.close();
      head.append(h, close);
      const steps = $el('ol', 'steps');
      for (const [ic, txt] of [['share', 'Tap the Share button in Safari’s toolbar'],
                               ['square-plus', 'Scroll down and tap “Add to Home Screen”'],
                               ['check', 'Tap “Add”. Jam Radio is now on your Home Screen']]) {
        const li = $el('li'); li.append(icon(ic), $el('span', null, txt)); steps.append(li);
      }
      d.append(head, steps);
      d.addEventListener('click', e => { if (e.target === d) d.close(); });
      document.body.append(d);
    }
    d.showModal();
  }

  const place = () => {
    const header = document.querySelector('main header');
    if (header) header.after(offline, card); else document.body.prepend(offline);
    showOffline(); update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
})();
