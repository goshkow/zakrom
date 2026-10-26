// помощник для DOM: текст из данных попадает на страницу только через textContent, innerHTML не используем
const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(node, props, isSvg) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') {
      if (isSvg) node.setAttribute('class', value);
      else node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'on') {
      for (const [type, handler] of Object.entries(value)) if (handler) node.addEventListener(type, handler);
    } else if (key === 'dataset') {
      for (const [name, data] of Object.entries(value)) node.dataset[name] = String(data);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [name, data] of Object.entries(value)) {
        if (name.startsWith('--')) node.style.setProperty(name, data);
        else node.style[name] = data;
      }
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  apply(node, props, false);
  append(node, children);
  return node;
}

export function svg(tag, props = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, props, true);
  append(node, children);
  return node;
}

export function icon(name, cls = '') {
  const node = svg('svg', { class: `icon ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  node.append(svg('use', { href: `assets/icons.svg#i-${name}` }));
  return node;
}

// ссылки из внешних данных: только http(s), иначе javascript: и прочее не пройдут
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function safeTel(phone) {
  if (typeof phone !== 'string') return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return /^\+?\d{6,15}$/.test(digits) ? `tel:${digits}` : null;
}

export function safeMail(mail) {
  if (typeof mail !== 'string') return null;
  const value = mail.trim();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(value) ? `mailto:${value}` : null;
}

export function debounce(fn, ms = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    const hash = globalThis.location?.hash;
    // отложенный поиск не должен менять уже открытый раздел или карточку
    timer = setTimeout(() => { if (globalThis.location?.hash === hash) fn(...args); }, ms);
  };
}
