// Installable app: registers the service worker (sw.js), offers the browser's own install prompt on the
// Install button of the /install panel when the browser has one, and shows a banner while offline.
// Loaded by index.html after icon.js (uses its icon() helper).
(() => {
  const $el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'android'
    : /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios'   // iPads say "Macintosh"
    : /macintosh/i.test(ua) ? 'mac' : /windows/i.test(ua) ? 'windows' : 'other';
  const browser = /edg(e|a|ios)?\//i.test(ua) ? 'edge' : /samsungbrowser/i.test(ua) ? 'samsung'
    : /firefox|fxios/i.test(ua) ? 'firefox' : /chrome|crios/i.test(ua) ? 'chrome' : /safari/i.test(ua) ? 'safari' : 'other';
  window.pwa = { os, browser, standalone };   // static/install.js picks the right steps from these

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // ---- Offline banner ----
  const offline = $el('div', 'offline'); offline.setAttribute('role', 'status'); offline.hidden = true;
  offline.append(icon('wifi-off'), $el('span', null, "You're offline. The radio picks back up when you reconnect."));
  const showOffline = () => { offline.hidden = navigator.onLine; };
  addEventListener('offline', showOffline);
  addEventListener('online', () => {
    showOffline();
    if (typeof window.fetchStation === 'function') window.fetchStation();   // catch up right away
  });

  // ---- Install button (/install panel) ----
  let deferred = null;   // Chrome/Edge/Samsung: the browser's install prompt, saved for our button
  const update = () => {
    const now = document.getElementById('i-now');
    if (now) now.hidden = standalone || !deferred;
  };
  const install = async () => {
    deferred.prompt();
    await deferred.userChoice.catch(() => ({}));
    deferred = null;
    update();
  };
  document.addEventListener('click', e => { if (deferred && e.target.closest('[data-install]')) install(); });

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; update(); });
  addEventListener('appinstalled', () => { deferred = null; update(); });

  const place = () => {
    const header = document.querySelector('main header');
    if (header) header.after(offline); else document.body.prepend(offline);
    showOffline(); update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
})();
