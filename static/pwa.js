// Installable app: registers the service worker (sw.js), offers "Install app" on the radio page
// (the browser's own prompt where there is one, otherwise a link to the steps on /install), and
// shows a banner while offline. Loaded by every page after station.js (uses its icon() helper).
(() => {
  const $el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'android'
    : /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios'   // iPads say "Macintosh"
    : /macintosh/i.test(ua) ? 'mac' : /windows/i.test(ua) ? 'windows' : 'other';
  const browser = /edg(e|a|ios)?\//i.test(ua) ? 'edge' : /samsungbrowser/i.test(ua) ? 'samsung'
    : /firefox|fxios/i.test(ua) ? 'firefox' : /chrome|crios/i.test(ua) ? 'chrome' : /safari/i.test(ua) ? 'safari' : 'other';
  window.pwa = { os, browser, standalone };   // install.html picks the right steps from these
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

  // ---- Install card (radio page) and Install button (/install) ----
  let deferred = null;   // Chrome/Edge/Samsung: the browser's install prompt, saved for our buttons
  const isRadio = !!document.getElementById('tune');
  const snoozed = () => Date.now() - Number(store.get('pwa-snoozed') || 0) < SNOOZE_DAYS * 864e5;
  const where = { ios: 'Home Screen', android: 'home screen', mac: 'Dock', windows: 'taskbar' }[os];

  const card = $el('section', 'install'); card.hidden = true;
  card.setAttribute('aria-labelledby', 'install-title');
  const text = $el('div', 'install-text');
  const title = $el('b', null, `Get Jam Radio on your ${where || 'device'}`); title.id = 'install-title';
  text.append(title, $el('small', null, 'Opens like an app and keeps playing from your lock screen.'));
  const go = $el('button'); go.append(icon('download'), $el('span', null, 'Install app'));
  const later = $el('button', 'ghost iconbtn'); later.setAttribute('aria-label', 'Not now'); later.append(icon('x'));
  card.append(icon('radio', 'i big'), text, go, later);

  const update = () => {
    card.hidden = standalone || !isRadio || snoozed() || !(deferred || where);
    const now = document.getElementById('now-wrap');
    if (now) now.hidden = standalone || !deferred;
  };

  const install = async () => {
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    deferred = null;
    if (outcome !== 'accepted') store.set('pwa-snoozed', Date.now());
    update();
  };
  // No prompt to offer (Safari, Firefox, or Chrome before it decides): the steps for this device.
  go.onclick = () => { if (deferred) install(); else location.href = '/install'; };
  later.onclick = () => { store.set('pwa-snoozed', Date.now()); update(); };
  document.addEventListener('click', e => { if (deferred && e.target.closest('[data-install]')) install(); });

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; update(); });
  addEventListener('appinstalled', () => { deferred = null; update(); });

  const place = () => {
    const header = document.querySelector('main header');
    if (header) header.after(offline, card); else document.body.prepend(offline);
    showOffline(); update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
})();
