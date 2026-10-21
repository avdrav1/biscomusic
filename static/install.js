// Get the app (the /install panel): the install steps for this device, with the browser in use marked.
// static/pwa.js detects the device and browser, and shows the Install button when the browser offers one.
export function init({ root, $ }) {
  const { os, browser, standalone } = window.pwa;
  $('done').hidden = !standalone;
  const tabs = root.querySelectorAll('.chips [data-os]');
  const show = which => {
    tabs.forEach(t => t.setAttribute('aria-checked', String(t.dataset.os === which)));
    root.querySelectorAll('section.how').forEach(s => { s.hidden = s.dataset.os !== which; });
  };
  tabs.forEach(t => t.onclick = () => show(t.dataset.os));
  show(os === 'other' ? 'ios' : os);
  // Point out the section for the browser they're using right now.
  for (const h of root.querySelectorAll(`section.how[data-os="${os}"] h3[data-browser]`)) {
    if (h.dataset.browser.split(' ').includes(browser)) { h.append(Object.assign(document.createElement('span'), { className: 'you', textContent: 'Your browser' })); break; }
  }
  return {};
}
