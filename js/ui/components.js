// базовые элементы интерфейса: всё собирается через el(), текст из данных - только как текст
import { el, icon } from '../core/dom.js';
import { pct } from '../core/format.js';
import { sparkline } from './charts.js';
import { inkAfterMount, animate } from './motion.js';

export function button(label, { variant = '', size = '', iconName = null, onClick = null, disabled = false, title = null, type = 'button', ariaLabel = null } = {}) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`].filter(Boolean).join(' ');
  return el(
    'button',
    { class: cls, type, disabled: disabled || null, title, 'aria-label': ariaLabel, on: onClick ? { click: onClick } : null },
    iconName ? icon(iconName) : null,
    label ? el('span', { text: label }) : null,
  );
}

export function linkBtn(label, href, { variant = '', size = '', iconName = null, external = false } = {}) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`].filter(Boolean).join(' ');
  return el('a', { class: cls, href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, iconName ? icon(iconName) : null, el('span', { text: label }), external ? icon('external') : null);
}

export function iconBtn(name, label, onClick, { plain = false, dot = false } = {}) {
  return el('button', { class: `icon-btn${plain ? ' plain' : ''}`, type: 'button', 'aria-label': label, title: label, on: { click: onClick } }, icon(name), dot ? el('span', { class: 'dot' }) : null);
}

// tone: good | warn | serious | bad | info | accent | sandbox | outline
export function badge(text, tone = '', { dot = false, iconName = null } = {}) {
  return el('span', { class: `badge${tone ? ` badge-${tone}` : ''}${dot ? ' dot' : ''}` }, iconName ? icon(iconName) : null, text);
}

export function card({ title = null, sub = null, actions = null, body = null, foot = null, flush = false, cls = '' } = {}) {
  return el(
    'section',
    { class: `card ${cls}`.trim() },
    title || actions
      ? el('header', { class: 'card-head' }, el('div', { class: 'card-titles' }, title ? el('h2', { class: 'card-title' }, title) : null, sub ? el('p', { class: 'card-sub', text: sub }) : null), actions ? el('div', { class: 'row' }, actions) : null)
      : null,
    body ? el('div', { class: `card-body${flush ? ' flush' : ''}` }, body) : null,
    foot ? el('footer', { class: 'card-foot' }, foot) : null,
  );
}

/**
 * плитка показателя: label, value, delta (доля, например 0.12), upIsGood, meta, spark (массив), sparkColor
 */
export function kpi({ label, value, delta = null, upIsGood = true, meta = null, spark = null, sparkColor = 'var(--text-2)', hint = null }) {
  return el(
    'div',
    { class: `kpi${animate() ? ' kpi-enter' : ''}` },
    el('div', { class: 'kpi-label' }, label, hint ? el('span', { title: hint, class: 'faint', 'aria-label': hint }, icon('info')) : null),
    el('div', { class: 'kpi-value', text: value }),
    el('div', { class: 'kpi-meta' }, delta === null ? null : deltaTag(delta, upIsGood), meta ? el('span', { text: meta }) : null),
    spark ? sparkline(spark, { color: sparkColor }) : null,
  );
}

export function deltaTag(delta, upIsGood = true) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.0005) return el('span', { class: 'delta flat', text: '— 0 %' });
  const up = delta > 0;
  const good = up === upIsGood;
  return el('span', { class: `delta ${up ? 'up' : 'down'}-${good ? 'good' : 'bad'}` }, icon(up ? 'arrow-up' : 'arrow-down'), pct(Math.abs(delta)));
}

export function meter(share, { tone = '', width = null } = {}) {
  const fill = el('span');
  fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  const node = el('div', { class: `meter${tone ? ` ${tone}` : ''}${animate() ? ' grow' : ''}` }, fill);
  if (width) node.style.width = width;
  return node;
}

export function stackMeter(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return el(
    'div',
    { class: `meter-stack${animate() ? ' grow' : ''}` },
    parts.filter((p) => p.value > 0).map((p) => {
      const span = el('span', { title: p.label });
      span.style.width = `${(p.value / total) * 100}%`;
      span.style.background = p.color;
      return span;
    }),
  );
}

export function segmented(options, value, onChange, label = '') {
  const group = el('div', { class: 'seg-group', role: 'group', 'aria-label': label });
  const key = `seg:${label}:${options.map((o) => o.value).join('|')}`;
  let moveTo = null;
  const buttons = options.map((option) =>
    el(
      'button',
      { class: 'seg', type: 'button', 'aria-pressed': String(option.value === value), on: { click: (event) => {
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === event.currentTarget)));
        moveTo?.(event.currentTarget);
        onChange(option.value);
      } } },
      option.label,
      option.count !== undefined ? el('span', { class: 'seg-count', text: String(option.count) }) : null,
    ),
  );
  group.append(...buttons);
  moveTo = inkAfterMount(group, key, () => group.querySelector('[aria-pressed="true"]'), 'seg-ink');
  return group;
}

export function tabs(items, value, onChange) {
  const list = el('div', { class: 'tabs', role: 'tablist' });
  const key = `tabs:${items.map((i) => i.value).join('|')}`;
  let moveTo = null;
  for (const item of items) {
    list.append(
      el(
        'button',
        { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(item.value === value), on: { click: (event) => { moveTo?.(event.currentTarget); onChange(item.value); } } },
        item.icon ? icon(item.icon) : null,
        item.label,
        item.count !== undefined ? el('span', { class: 'seg-count', text: String(item.count) }) : null,
      ),
    );
  }
  moveTo = inkAfterMount(list, key, () => list.querySelector('[aria-selected="true"]'), 'tab-ink');
  return list;
}

export function chip(label, pressed, onClick, { swatch = null, count = null } = {}) {
  return el(
    'button',
    { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(pressed)), on: { click: onClick } },
    swatch ? el('span', { class: 'swatch', style: { background: swatch } }) : null,
    label,
    count !== null ? el('span', { class: 'chip-count', text: String(count) }) : null,
  );
}

export function empty(title, text = '', action = null, iconName = 'search') {
  return el('div', { class: 'empty' }, icon(iconName), el('div', { class: 'empty-title', text: title }), text ? el('p', { text }) : null, action);
}

export function note(text, { tone = '', iconName = 'info' } = {}) {
  return el('div', { class: `note${tone ? ` note-${tone}` : ''}` }, icon(iconName), el('div', {}, text));
}

export function sandboxNote(text) {
  return note(text, { tone: 'sandbox', iconName: 'sandbox' });
}

export function field(label, control, { hint = null, error = null } = {}) {
  const nativeControl = ['INPUT', 'SELECT', 'TEXTAREA'].includes(control?.tagName);
  return el(nativeControl ? 'label' : 'div', { class: 'field', role: nativeControl ? null : 'group', 'aria-label': nativeControl ? null : label }, el('span', { class: 'field-label', text: label }), control, hint ? el('span', { class: 'field-hint', text: hint }) : null, error ? el('span', { class: 'field-error', text: error }) : null);
}

export function input(props = {}) {
  return el('input', { class: `input${props.num ? ' input-num' : ''}`, type: 'text', ...props, num: null });
}

export function select(options, value, onChange, props = {}) {
  const node = el(
    'select',
    { class: 'select', ...props, on: { change: (event) => onChange(event.target.value) } },
    options.map((o) => el('option', { value: o.value, selected: o.value === value ? true : null, text: o.label })),
  );
  return node;
}

export function searchInput(placeholder, value, onInput) {
  const field = el('input', { class: 'input', type: 'search', placeholder, value: value ?? '', 'aria-label': placeholder, on: { input: (event) => onInput(event.target.value) } });
  return el('div', { class: 'input-icon' }, icon('search'), field);
}

export function qtyStepper(value, onChange, { min = 0, max = 100000, step = 1, label = 'Количество' } = {}) {
  const field = el('input', { inputmode: 'decimal', value: String(value), 'aria-label': label });
  const commit = (next) => {
    const v = Math.min(max, Math.max(min, Math.round(Number(String(next).replace(',', '.')) / step) * step));
    if (!Number.isFinite(v)) { field.value = String(value); return; }
    value = v;
    field.value = String(v);
    onChange(v);
  };
  field.addEventListener('change', () => commit(field.value));
  return el(
    'div',
    { class: 'qty', role: 'group', 'aria-label': label },
    el('button', { type: 'button', 'aria-label': 'Меньше', on: { click: () => commit(Number(field.value) - step) } }, icon('minus')),
    field,
    el('button', { type: 'button', 'aria-label': 'Больше', on: { click: () => commit(Number(field.value) + step) } }, icon('plus')),
  );
}

// логотип поставщика: картинка из Wikimedia Commons, если она есть, иначе плитка с инициалами в цвете группы
export function logoTile(supplier, { large = false } = {}) {
  const cls = `logo-tile${large ? ' lg' : ''}`;
  if (supplier.logoUrl) {
    const img = el('img', { class: `${cls} logo-img`, src: supplier.logoUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(initialsTile(supplier, cls)));
    return img;
  }
  return initialsTile(supplier, cls);
}

function initialsTile(supplier, cls) {
  return el('span', { class: cls, style: { background: supplier.tileColor }, 'aria-hidden': 'true', text: supplier.initials });
}

export function productThumb(product, { large = false } = {}) {
  const cls = `thumb${large ? ' thumb-lg' : ''}`;
  if (product.image) {
    const img = el('img', { class: cls, src: product.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(el('span', { class: `${cls} thumb-ph` }, icon('box'))));
    return img;
  }
  return el('span', { class: `${cls} thumb-ph` }, icon(product.group === 'packaging' ? 'box' : 'catalog'));
}

// таблица с сортировкой по столбцам: columns [{key, label, align, render(row), sort(row)}]
export function dataTable({ columns, rows, sortKey = null, sortDir = 'desc', onRow = null, compact = false, emptyText = 'Ничего не найдено', limit = null }) {
  let key = sortKey;
  let dir = sortDir;
  const wrap = el('div', { class: `table-wrap${animate() ? ' table-enter' : ''}` });
  const draw = () => {
    const col = columns.find((c) => c.key === key);
    const sorted = col?.sort ? rows.slice().sort((a, b) => {
      const va = col.sort(a);
      const vb = col.sort(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb, 'ru') : va - vb;
      return dir === 'asc' ? cmp : -cmp;
    }) : rows;
    const shown = limit ? sorted.slice(0, limit) : sorted;
    const table = el(
      'table',
      { class: `table${compact ? ' table-compact' : ''}` },
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { class: c.align === 'right' ? 'r' : '', scope: 'col', 'aria-sort': c.key === key ? (dir === 'asc' ? 'ascending' : 'descending') : null }, c.sort
        ? el('button', { class: 'sort', type: 'button', 'aria-sort': c.key === key ? dir : null, on: { click: () => {
          if (key === c.key) dir = dir === 'asc' ? 'desc' : 'asc';
          else { key = c.key; dir = c.defaultDir ?? 'desc'; }
          wrap.classList.remove('table-enter');
          draw();
        } } }, c.label, icon(c.key === key ? (dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'updown'))
        : c.label)))),
      el('tbody', {}, shown.length
        ? shown.map((row) => el('tr', { class: onRow ? 'clickable' : '', tabindex: onRow ? '0' : null, on: onRow ? { click: () => onRow(row), keydown: (e) => { if (e.key === 'Enter') onRow(row); } } : null }, columns.map((c) => el('td', { class: c.align === 'right' ? 'r' : c.cls ?? '' }, c.render(row)))))
        : el('tr', {}, el('td', { colspan: columns.length }, el('div', { class: 'empty' }, el('p', { text: emptyText }))))),
    );
    wrap.replaceChildren(table);
  };
  draw();
  return wrap;
}

// ---------- всплывающее меню ----------

let openMenu = null;
let menuAnchor = null;
let menuCleanup = null;
let menuNumber = 0;

export function closeMenu({ restoreFocus = false } = {}) {
  const anchor = menuAnchor;
  menuCleanup?.();
  menuCleanup = null;
  openMenu?.remove();
  openMenu = null;
  menuAnchor = null;
  anchor?.setAttribute('aria-expanded', 'false');
  anchor?.removeAttribute('aria-controls');
  if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
}

/** items: [{label, sub, icon, checked, onClick} | {sep:true} | {group:'...'}] */
export function popMenu(anchor, items, { align = 'left', width = null, cls = '' } = {}) {
  if (openMenu && menuAnchor === anchor) {
    closeMenu({ restoreFocus: true });
    return null;
  }
  closeMenu();
  const keyboard = anchor.matches(':focus-visible');
  const menu = el('div', { class: `menu ${cls}`.trim(), role: 'menu', id: `menu-${++menuNumber}`, tabindex: '-1', 'aria-label': anchor.getAttribute('aria-label') ?? anchor.textContent.trim() });
  if (width) menu.style.width = `${width}px`;
  for (const item of items) {
    if (item.sep) menu.append(el('div', { class: 'menu-sep', role: 'separator' }));
    else if (item.group) menu.append(el('div', { class: 'menu-label', text: item.group }));
    else {
      menu.append(el('button', {
        class: `menu-item${item.sub ? ' has-sub' : ''}`,
        type: 'button',
        role: item.checked === undefined ? 'menuitem' : 'menuitemradio',
        'aria-checked': item.checked === undefined ? null : String(item.checked),
        on: { click: () => { closeMenu({ restoreFocus: true }); item.onClick?.(); } },
      },
      item.prefix ?? (item.icon ? icon(item.icon) : null),
      el('span', { class: 'menu-item-text' }, el('span', { class: 'menu-item-title', text: item.label }), item.sub ? el('span', { class: 'sub', text: item.sub }) : null),
      item.checked ? icon('check', 'check') : null));
    }
  }
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const below = Math.max(0, window.innerHeight - rect.bottom - 14);
  const above = Math.max(0, rect.top - 14);
  const upward = menu.offsetHeight > below && above > below;
  menu.style.maxHeight = `${upward ? above : below}px`;
  const left = align === 'right' ? rect.right - menu.offsetWidth : rect.left;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${upward ? Math.max(8, rect.top - menu.offsetHeight - 6) : rect.bottom + 6}px`;
  openMenu = menu;
  menuAnchor = anchor;
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  anchor.setAttribute('aria-controls', menu.id);

  const away = (event) => {
    // повторное нажатие обрабатывает сама кнопка: закрыть, не открыть заново
    if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMenu();
  };
  const keydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu({ restoreFocus: true }); }
    if (event.key === 'Tab') closeMenu({ restoreFocus: true });
  };
  const moved = (event) => {
    if (event.type === 'scroll' && menu.contains(event.target)) return;
    closeMenu();
  };
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', keydown, true);
  window.addEventListener('resize', moved);
  window.addEventListener('scroll', moved, true);
  menuCleanup = () => {
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('resize', moved);
    window.removeEventListener('scroll', moved, true);
  };
  menu.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const list = [...menu.querySelectorAll('.menu-item')];
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : event.key === 'ArrowDown' ? (i + 1) % list.length : i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
    list[index].focus({ preventScroll: true });
    list[index].scrollIntoView({ block: 'nearest' });
  });
  // при нажатии мышью не выдаём первый пункт за выбранный; стрелки по-прежнему работают
  const initial = keyboard ? menu.querySelector('[aria-checked="true"]') ?? menu.querySelector('.menu-item') : menu;
  initial?.focus({ preventScroll: true });
  return menu;
}

// выпадающий выбор, похожий на кнопку («Последние 30 дней ▾»)
export function dropdown(options, value, onChange, { prefix = null, align = 'left', iconName = null } = {}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const btn = el('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu' }, iconName ? icon(iconName) : null, prefix ? el('span', { class: 'faint', text: prefix }) : null, el('span', { text: current?.label ?? '' }), icon('chevron-down'));
  btn.addEventListener('click', () => popMenu(btn, options.map((o) => ({ label: o.label, sub: o.sub, checked: o.value === value, onClick: () => onChange(o.value) })), { align }));
  return btn;
}

// ---------- уведомления внизу экрана ----------

export function toast(text, { error = false } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', { class: `toast${error ? ' error' : ''}` }, icon(error ? 'alert' : 'check'), el('span', { text }));
  host.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 200);
  }, 4000);
}

// ---------- окно и боковая панель ----------

export function finishDialog(dialog, opener, onClose = null) {
  dialog.remove();
  onClose?.();
  window.dispatchEvent(new Event('zakrom:dialogclosed'));
  if (document.querySelector('dialog[open]')) return;
  const focusKey = opener?.dataset?.focusKey;
  const focusLabel = opener?.getAttribute('aria-label');
  const replacement = focusKey ? [...document.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey) : focusLabel ? [...document.querySelectorAll('main [aria-label]')].find((node) => node.getAttribute('aria-label') === focusLabel) : null;
  (opener?.isConnected ? opener : replacement)?.focus({ preventScroll: true });
}

function dialogShell(kind, { title, sub = null, body, foot = null, wide = false, head = null, onClose = null }) {
  const opener = document.activeElement;
  closeMenu();
  const dialog = el('dialog', { class: `${kind}${wide ? ' wide' : ''}`, 'aria-label': typeof title === 'string' ? title : 'Окно' });
  const close = () => dialog.close();
  const inner = kind === 'drawer'
    ? el('div', { class: 'drawer-inner' },
      el('header', { class: 'drawer-head' }, head ?? el('div', { style: { flex: '1' } }, el('h2', { class: 'modal-title', text: title }), sub ? el('p', { class: 'modal-sub', text: sub }) : null), el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Закрыть', on: { click: close } }, icon('x'))),
      el('div', { class: 'drawer-body' }, body),
      foot ? el('footer', { class: 'drawer-foot' }, foot) : null)
    : el('div', { class: 'modal-inner' },
      el('header', { class: 'modal-head' }, el('div', {}, el('h2', { class: 'modal-title', text: title }), sub ? el('p', { class: 'modal-sub', text: sub }) : null), el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Закрыть', on: { click: close } }, icon('x'))),
      el('div', { class: 'modal-body' }, body),
      el('footer', { class: 'modal-foot' }, foot));
  dialog.append(inner);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => finishDialog(dialog, opener, onClose));
  smoothClose(dialog);
  const heading = dialog.querySelector('.modal-title');
  heading?.setAttribute('tabindex', '-1');
  heading?.setAttribute('autofocus', '');
  document.body.append(dialog);
  dialog.showModal();
  heading?.focus({ preventScroll: true });
  return { dialog, close };
}

// окно уезжает за 140 мс, а не пропадает. close() переопределяем у самого окна, чтобы анимацию получили
// и те места, что закрывают его напрямую через dialog.close()
const CLOSE_MS = 140;
export function smoothClose(dialog) {
  const nativeClose = HTMLDialogElement.prototype.close;
  let closing = false;
  dialog.close = (...args) => {
    if (closing || !dialog.open) return;
    closing = true;
    dialog.classList.add('closing');
    setTimeout(() => nativeClose.apply(dialog, args), CLOSE_MS);
  };
  // esc: отменяем мгновенное закрытие и закрываем плавно
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.close();
  });
}

export const openModal = (opts) => dialogShell('modal', opts);
export const openDrawer = (opts) => dialogShell('drawer', opts);

export function confirmDialog({ title, text, confirm = 'Подтвердить', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const { close } = openModal({
      title,
      body: el('p', { class: 'muted', text }),
      foot: [
        button('Отмена', { variant: 'ghost', onClick: () => close() }),
        button(confirm, { variant: danger ? 'danger' : 'primary', onClick: () => { result = true; close(); } }),
      ],
      onClose: () => resolve(result),
    });
  });
}

export function kv(pairs) {
  return el('dl', { class: 'kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [el('div', {}, el('dt', { class: 'k', text: k })), el('div', {}, el('dd', { class: 'v' }, v ?? '—'))]));
}
