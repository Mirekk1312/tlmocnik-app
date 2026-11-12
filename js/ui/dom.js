export const $ = (selector, root = document) => root.querySelector(selector);

/** Krátka správa používateľovi; zobrazí sa aj nad otvoreným dialógom. */
export function toast(message, kind = '') {
  const host = $('#toasts');
  (document.querySelector('dialog[open]') || document.body).append(host);
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  host.append(node);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => node.remove(), kind === 'error' ? 7000 : 3000);
}

const SVG = 'http://www.w3.org/2000/svg';

/** Tlačidlo s čiarovou ikonou. */
export function icon(pathData, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  button.title = title;
  button.setAttribute('aria-label', title);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  button.append(svg);
  return button;
}

/** QR kód ako SVG (bez inline štýlov, kvôli CSP). */
export function qrSvg(qr) {
  const n = qr.getModuleCount();
  const margin = 3;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n + margin * 2} ${n + margin * 2}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(path);
  return svg;
}

export function fillSelect(select, options, value) {
  select.replaceChildren();
  for (const option of options) {
    if (option.group) {
      const group = document.createElement('optgroup');
      group.label = option.group;
      for (const o of option.options) group.append(new Option(o.label, o.value));
      if (option.options.length) select.append(group);
    } else select.append(new Option(option.label, option.value));
  }
  select.value = value;
  if (select.value !== value && value) {
    // Uložená hodnota už v zozname nie je – ukážeme ju, nech sa nestratí.
    select.append(new Option(`${value} (nedostupné)`, value));
    select.value = value;
  }
}
