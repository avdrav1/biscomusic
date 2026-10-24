// Lucide icon from the sprite (its versioned URL comes from <meta name="icons">), on every page.
const ICONS = document.querySelector('meta[name="icons"]')?.content || 'static/icons.svg';
window.icon = (name, cls = 'i') => {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), use = document.createElementNS(ns, 'use');
  svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', `${ICONS}#${name}`); svg.append(use);
  return svg;
};
// Same, as markup for HTML strings.
window.iconHtml = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#${name}"/></svg>`;
