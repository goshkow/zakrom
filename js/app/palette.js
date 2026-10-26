// командная панель ⌘K: разделы, товары, поставщики, заказы и действия в одном поиске
import { el, icon } from '../core/dom.js';
import { rub, dayShort } from '../core/format.js';
import { state, orders, selectWorkspace, workspaces } from './state.js';
import { go, link } from './router.js';
import { setTheme } from './theme.js';
import { smoothClose, closeMenu, finishDialog } from '../ui/components.js';

const SECTIONS = [
  ['', 'Обзор', 'overview'], ['catalog', 'Каталог', 'catalog'], ['suppliers', 'Поставщики', 'suppliers'], ['orders', 'Заказы', 'orders'],
  ['stock', 'Склад и автозаказ', 'stock'], ['recipes', 'Техкарты и фудкост', 'recipes'], ['analytics', 'Аналитика расходов', 'analytics'],
  ['market', 'Рынок сырья и курсы', 'market'], ['rfq', 'Тендеры', 'rfq'], ['settings', 'Настройки', 'settings'],
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

function search(q) {
  const query = norm(q).trim();
  const groups = [];
  const match = (text) => !query || norm(text).includes(query);
  const sections = SECTIONS.filter(([, label]) => match(label)).map(([path, label, ic]) => ({ icon: ic, label, meta: 'раздел', run: () => go(`#/${path}`) }));
  if (sections.length) groups.push(['Разделы', sections.slice(0, query ? 5 : 10)]);
  if (query.length >= 2) {
    const products = [...state.supply.products.values()].filter((p) => match(`${p.name} ${p.brand ?? ''} ${p.barcode ?? ''} ${p.spec.label}`)).slice(0, 6);
    if (products.length) groups.push(['Товары', products.map((p) => ({ icon: 'catalog', label: p.name, meta: p.brand ?? p.spec.label, run: () => go(link('catalog', null, { p: p.id })) }))]);
    const suppliers = [...state.supply.suppliers.values()].filter((s) => match(`${s.name} ${s.city ?? ''} ${(s.brands ?? []).join(' ')}`)).slice(0, 5);
    if (suppliers.length) groups.push(['Поставщики', suppliers.map((s) => ({ icon: 'suppliers', label: s.name, meta: `${s.typeLabel}${s.city ? ` · ${s.city}` : ''}`, run: () => go(link('suppliers', s.id)) }))]);
    const found = orders().filter((o) => o.number.includes(query.replace(/\D/g, '')) && /\d{3,}/.test(query)).slice(0, 5);
    if (found.length) groups.push(['Заказы', found.map((o) => ({ icon: 'orders', label: `Заказ № ${o.number}`, meta: `${state.supply.suppliers.get(o.supplierId)?.name} · ${rub(o.total)} · ${dayShort(o.createdDay)}`, run: () => go(link('orders', o.id)) }))]);
  }
  const actions = [
    { icon: 'cart', label: 'Новый заказ из каталога', run: () => go('#/catalog') },
    { icon: 'flash', label: 'Собрать автозаказ по складу', run: () => go('#/stock') },
    { icon: 'gavel', label: 'Запустить тендер', run: () => go('#/rfq?new=1') },
    { icon: 'download', label: 'Выгрузить заказы в CSV', run: () => go('#/orders?export=1') },
    ...workspaces().filter((w) => w.id !== state.wsId).map((w) => ({ icon: 'building', label: `Перейти в «${w.short}»`, meta: w.type, run: () => selectWorkspace(w.id) })),
    { icon: 'moon', label: 'Тёмная тема', run: () => setTheme('dark') },
    { icon: 'sun', label: 'Светлая тема', run: () => setTheme('light') },
  ].filter((a) => match(a.label));
  if (actions.length) groups.push(['Действия', actions.slice(0, query ? 6 : 4)]);
  return groups;
}

export function openPalette() {
  const existing = document.querySelector('dialog.palette[open]');
  if (existing) { existing.close(); return; }
  const opener = document.activeElement;
  closeMenu();
  const dialog = el('dialog', { class: 'modal palette', 'aria-label': 'Поиск по кабинету' });
  const input = el('input', { type: 'text', placeholder: 'Товар, штрихкод, поставщик, номер заказа или действие', 'aria-label': 'Поиск', autocomplete: 'off', spellcheck: 'false' });
  const results = el('div', { class: 'palette-results', role: 'listbox' });
  let items = [];
  let active = 0;
  const draw = () => {
    const groups = search(input.value);
    items = [];
    results.replaceChildren(
      ...groups.flatMap(([title, list]) => [
        el('div', { class: 'palette-group', text: title }),
        ...list.map((item) => {
          const index = items.length;
          items.push(item);
          return el('button', { class: 'palette-item', type: 'button', role: 'option', 'aria-selected': String(index === active), on: { click: () => run(index), mousemove: () => select(index) } }, icon(item.icon), el('span', { class: 'truncate', text: item.label }), item.meta ? el('span', { class: 'meta', text: item.meta }) : null);
        }),
      ]),
    );
    if (!items.length) results.replaceChildren(el('div', { class: 'empty' }, el('p', { text: 'Ничего не нашлось. Попробуйте штрихкод или часть названия.' })));
  };
  const select = (index) => {
    active = index;
    results.querySelectorAll('.palette-item').forEach((node, i) => node.setAttribute('aria-selected', String(i === active)));
    results.querySelectorAll('.palette-item')[active]?.scrollIntoView({ block: 'nearest' });
  };
  const run = (index) => {
    const item = items[index];
    dialog.close();
    item?.run();
  };
  input.addEventListener('input', () => {
    active = 0;
    draw();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); select(Math.min(items.length - 1, active + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); select(Math.max(0, active - 1)); }
    if (event.key === 'Enter') { event.preventDefault(); run(active); }
  });
  dialog.append(el('div', { class: 'modal-inner' }, el('div', { class: 'palette-input' }, icon('search'), input, el('span', { class: 'kbd', text: 'Esc' })), results));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => finishDialog(dialog, opener));
  smoothClose(dialog);
  document.body.append(dialog);
  draw();
  dialog.showModal();
  input.focus();
}


