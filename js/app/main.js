// оболочка кабинета: шапка, навигация, роутер по хэшу, общие панели (уведомления, корзина, поиск)
import { el, icon } from '../core/dom.js';
import { rubShort, countOf, localIsoDay } from '../core/format.js';
import { load } from '../core/store.js';
import { state, boot, onChange, selectWorkspace, orders, workspaces } from './state.js';
import { alerts, monthBudget } from './derive.js';
import { button, iconBtn, popMenu, closeMenu, toast, meter } from '../ui/components.js';
import { themeChoice, setTheme, applyTheme } from './theme.js';
import { openPalette } from './palette.js';
import { footer } from './footer.js';
import { parseRoute, go, viewKey } from './router.js';
import { sandboxInfo, openNotifications, openCart } from './panels.js';
import { quietly, inkAfterMount } from '../ui/motion.js';
import { watchScrollbars } from '../ui/scrollbar.js';

import * as overview from '../pages/overview.js';
import * as catalog from '../pages/catalog.js';
import * as suppliers from '../pages/suppliers.js';
import * as supplier from '../pages/supplier.js';
import * as ordersPage from '../pages/orders.js';
import * as order from '../pages/order.js';
import * as stock from '../pages/stock.js';
import * as recipes from '../pages/recipes.js';
import * as analytics from '../pages/analytics.js';
import * as market from '../pages/market.js';
import * as rfq from '../pages/rfq.js';
import * as settings from '../pages/settings.js';

applyTheme();

export const NAV = [
  { path: '', label: 'Обзор', icon: 'overview', page: overview },
  { path: 'catalog', label: 'Каталог', icon: 'catalog', page: catalog },
  { path: 'suppliers', label: 'Поставщики', icon: 'suppliers', page: suppliers, detail: supplier },
  { path: 'orders', label: 'Заказы', icon: 'orders', page: ordersPage, detail: order, count: () => orders().filter((o) => o.status === 'approval' || o.status === 'arrived').length },
  { path: 'stock', label: 'Склад', icon: 'stock', page: stock },
  { path: 'recipes', label: 'Техкарты', icon: 'recipes', page: recipes },
  { path: 'analytics', label: 'Аналитика', icon: 'analytics', page: analytics },
  { path: 'market', label: 'Рынок', icon: 'market', page: market },
  { path: 'rfq', label: 'Тендеры', icon: 'rfq', page: rfq, detail: rfq },
  { path: 'settings', label: 'Настройки', icon: 'settings', page: settings, detail: settings },
];

// ---------- шапка ----------

function workspaceSwitch() {
  const ws = state.ws;
  const btn = el('button', { class: 'ws-switch', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Организация: ${ws.name}` }, el('span', { class: 'ws-avatar', style: { background: ws.color }, text: ws.short[0] }), el('span', { class: 'ws-name ws-full truncate', text: ws.name }), el('span', { class: 'ws-name ws-short truncate', text: ws.short }), icon('updown'));
  btn.addEventListener('click', () =>
    popMenu(
      btn,
      [
        { group: 'Организации песочницы' },
        ...workspaces().map((w) => ({
            label: w.name,
            sub: `${w.type} · ${countOf(w.locations.length, ['точка', 'точки', 'точек'])}`,
            prefix: el('span', { class: 'ws-avatar', style: { background: w.color }, text: w.short[0] }),
            checked: w.id === ws.id,
            onClick: () => {
              if (w.id === state.wsId) return;
              selectWorkspace(w.id);
              toast(`Открыта организация «${w.short}»`);
            },
        })),
      ],
      { width: 360, cls: 'workspace-menu' },
    ),
  );
  return btn;
}

function budgetChip() {
  const b = monthBudget();
  const tone = b.forecastShare > 1.02 ? 'bad' : b.forecastShare > 0.95 ? 'warn' : 'ok';
  const chip = el('a', { class: 'budget-chip', href: '#/analytics', title: `Прогноз месяца ${rubShort(b.forecast)}` }, el('span', { class: 'faint', text: 'Бюджет' }), el('b', { text: `${rubShort(b.spent)}` }), el('span', { class: 'faint', text: `из ${rubShort(b.budget)}` }), meter(b.share, { tone }));
  return chip;
}

function avatarMenu(anchor) {
  const me = state.ws.team[1] ?? state.ws.team[0];
  const theme = themeChoice();
  popMenu(
    anchor,
    [
      { group: `${me.name} · ${me.role}` },
      { label: 'Настройки организации', icon: 'settings', onClick: () => go('#/settings') },
      { label: 'Команда и роли', icon: 'users', onClick: () => go('#/settings/team') },
      { sep: true },
      { group: 'Тема' },
      { label: 'Тёмная', icon: 'moon', checked: theme === 'dark', onClick: () => setTheme('dark') },
      { label: 'Светлая', icon: 'sun', checked: theme === 'light', onClick: () => setTheme('light') },
      { label: 'Как в системе', icon: 'monitor', checked: theme === 'system', onClick: () => setTheme('system') },
      { sep: true },
      { label: 'Что такое песочница', icon: 'sandbox', onClick: () => sandboxInfo() },
    ],
    { align: 'right', width: 260 },
  );
}

let topbarSignature = '';
function renderTopbar() {
  const signature = JSON.stringify([state.ws, monthBudget(), alerts().map((a) => [a.id, a.read]), state.user.cart]);
  if (signature === topbarSignature) return;
  topbarSignature = signature;
  const row = document.getElementById('topbar-row');
  const restoreWorkspaceFocus = document.activeElement === row.querySelector('.ws-switch');
  closeMenu();
  const brand = row.querySelector('.brand');
  const unread = alerts().filter((a) => !a.read).length;
  const cartCount = state.user.cart.length;
  const me = state.ws.team[1] ?? state.ws.team[0];
  const avatar = el('button', { class: 'avatar', type: 'button', 'aria-label': `Профиль: ${me.name}`, text: me.name[0] });
  avatar.addEventListener('click', () => avatarMenu(avatar));
  row.replaceChildren(
    brand,
    el('span', { class: 'crumb-sep', 'aria-hidden': 'true', text: '/' }),
    workspaceSwitch(),
    el('span', { class: 'topbar-spacer' }),
    el('button', { class: 'search-btn', type: 'button', 'aria-label': 'Поиск по кабинету', on: { click: () => openPalette() } }, icon('search'), el('span', { text: 'Товар, поставщик, заказ…' }), el('span', { class: 'kbd', text: navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K' })),
    el('button', { class: 'sandbox-badge', type: 'button', title: 'Цены, условия и заказы смоделированы', on: { click: () => sandboxInfo() } }, icon('sandbox'), el('span', { text: 'Песочница' })),
    quietly(budgetChip),
    iconBtn('cart', cartCount ? `Корзина: ${cartCount}` : 'Корзина', () => openCart(), { dot: cartCount > 0 }),
    iconBtn('bell', unread ? `Уведомления: ${unread}` : 'Уведомления', () => openNotifications(), { dot: unread > 0 }),
    avatar,
  );
  if (restoreWorkspaceFocus) row.querySelector('.ws-switch').focus({ preventScroll: true });
}

function renderNav(route) {
  const nav = document.getElementById('nav');
  nav.replaceChildren(
    ...NAV.map((item) => {
      const current = route.section === item.path;
      const count = item.count?.() ?? 0;
      return el('a', { href: `#/${item.path}`, 'aria-current': current ? 'page' : null }, icon(item.icon), item.label, count ? el('span', { class: 'count', text: String(count) }) : null);
    }),
  );
  const active = nav.querySelector('[aria-current="page"]');
  if (active && (active.offsetLeft < nav.scrollLeft || active.offsetLeft + active.offsetWidth > nav.scrollLeft + nav.clientWidth)) nav.scrollTo({ left: active.offsetLeft - 16, behavior: 'smooth' });
  inkAfterMount(nav, 'nav', () => nav.querySelector('[aria-current="page"]'), 'nav-ink');
}

// ---------- отрисовка страницы ----------

let lastSection = null;
let lastView = null;
let deferred = false;

export function render(reason) {
  if (!state.ready) return;
  const route = parseRoute();
  const item = NAV.find((n) => n.path === route.section) ?? NAV[0];
  const page = route.id && item.detail ? item.detail : item.page;
  const main = document.getElementById('main');
  const section = `${state.wsId}|${route.section}/${route.id ?? ''}`;
  const nextView = viewKey(route, state.wsId);
  const navigated = nextView !== lastView;
  const dataChanged = typeof reason === 'string' || (reason?.type === 'zakrom:render' && !reason.detail?.route);
  try { quietly(renderTopbar); } catch (error) { console.error(error); }
  if (!navigated) { catalog.syncOverlay(route); rfq.syncOverlay(route); }
  // открытие карточки и возврат из неё сохраняют DOM, фокус и прокрутку каталога
  if (!navigated && !dataChanged && !deferred) {
    return;
  }
  // изменения внутри окна обновляют его собственные контролы; фон ждёт закрытия
  if (!navigated && document.querySelector('dialog[open]')) {
    deferred = true;
    return;
  }
  if (navigated) {
    closeMenu();
    catalog.syncOverlay({ section: '' });
    rfq.syncOverlay({ section: '' });
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  }
  const active = document.activeElement;
  const focusLabel = main.contains(active) ? active.getAttribute('aria-label') : null;
  const selection = focusLabel && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  let content;
  try {
    renderNav(route);
    content = navigated ? page.render(route) : quietly(() => page.render(route));
    if (section !== lastSection) content.classList.add('enter');
  } catch (error) {
    console.error(error);
    content = el('div', { class: 'empty' }, icon('alert'), el('div', { class: 'empty-title', text: 'Раздел не открылся' }), el('p', { text: 'Похоже, сохранённые в браузере данные не подходят к этой версии. Можно сбросить песочницу в настройках.' }), button('Открыть настройки', { onClick: () => go('#/settings/data') }));
  }
  main.replaceChildren(content, footer());
  deferred = false;
  lastView = nextView;
  if (section !== lastSection) {
    window.scrollTo(0, 0);
    lastSection = section;
  } else if (focusLabel) {
    const control = [...main.querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === focusLabel);
    control?.focus({ preventScroll: true });
    if (selection && control?.setSelectionRange) control.setSelectionRange(...selection);
  }
  catalog.syncOverlay(route);
  rfq.syncOverlay(route);
  document.title = `${page.title?.(route) ?? item.label} · Закром`;
}

// заказы песочницы меняют статус по настоящему времени: раз в 15 секунд проверяем, не пора ли перерисовать
let liveSig = null;
function liveTick() {
  if (!state.ready) return;
  // наступила полночь: история и цены считаются от даты, проще всего открыть кабинет заново
  if (localIsoDay() !== state.today && !document.querySelector('dialog[open]')) {
    location.reload();
    return;
  }
  const sig = state.user.orders.map((o) => orders().find((x) => x.id === o.id)?.status).join();
  if (liveSig === null) liveSig = sig;
  // пока открыто окно, не перерисовываем и не запоминаем подпись: перерисуемся на следующем тике
  if (sig !== liveSig && !document.querySelector('dialog[open]')) {
    liveSig = sig;
    render('live');
  }
}

function keyboard(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
  }
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    openPalette();
  }
}

async function start() {
  try {
    await boot();
  } catch (error) {
    console.error(error);
    document.getElementById('main').replaceChildren(el('div', { class: 'empty' }, icon('alert'), el('div', { class: 'empty-title', text: 'Не удалось загрузить данные' }), el('p', { text: 'Кабинет открывается через локальный сервер: python3 -m http.server из папки проекта.' })));
    return;
  }
  onChange((reason) => render(reason));
  window.addEventListener('zakrom:dialogclosed', () => { if (deferred && !document.querySelector('dialog[open]')) render('deferred'); });
  window.addEventListener('hashchange', render);
  window.addEventListener('zakrom:render', render);
  document.addEventListener('keydown', keyboard);
  watchScrollbars(document.body);
  render();
  setInterval(liveTick, 15000);
  if (!load('welcome:v1', false)) sandboxInfo();
}

start();

