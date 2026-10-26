// общее для страниц: заголовок, фильтры периода и точки, ссылки, статусы, выгрузка CSV
import { el, icon } from '../core/dom.js';
import { dayShort, rub, num, qty } from '../core/format.js';
import { state, locationName } from '../app/state.js';
import { PERIODS, periodRange } from '../model/analytics.js';
import { STATUS, ISSUE } from '../app/derive.js';
import { badge, dropdown, logoTile, productThumb, iconBtn } from '../ui/components.js';
import { setQuery, link, rerender } from '../app/router.js';
import { GROUP_BY_ID } from '../model/kinds.js';
import { toCsv } from '../core/csv.js';

export function pageHead(title, sub, actions = []) {
  return el(
    'header',
    { class: 'page-head' },
    el('div', {}, el('h1', { class: 'page-title', text: title }), sub ? el('p', { class: 'page-sub', text: sub }) : null),
    actions.length ? el('div', { class: 'page-actions' }, actions) : null,
  );
}

export function backLink(href, text) {
  return el('a', { class: 'back-link', href }, icon('chevron-left'), text);
}

export function readPeriod(route, fallback = '30d') {
  const value = route.query.get('period');
  const period = PERIODS.some((p) => p.value === value) ? value : fallback;
  return { period, range: periodRange(period, state.today) };
}

export function readLoc(route) {
  const loc = route.query.get('loc');
  return state.ws.locations.some((l) => l.id === loc) ? loc : null;
}

export function periodControl(period) {
  return el('div', { class: 'row' }, el('span', { class: 'tag-utc', title: 'Даты по московскому времени', text: 'МСК' }), dropdown(PERIODS.map((p) => ({ value: p.value, label: p.label })), period, (v) => setQuery({ period: v }), { iconName: 'calendar', align: 'right' }));
}

export function locControl(locId) {
  if (state.ws.locations.length < 2) return null;
  return dropdown([{ value: '', label: 'Все точки' }, ...state.ws.locations.map((l) => ({ value: l.id, label: l.name, sub: l.city }))], locId ?? '', (v) => setQuery({ loc: v || null }), { iconName: 'pin' });
}

export function refreshBtn() {
  return iconBtn('refresh', 'Обновить', () => rerender());
}

export function statusBadge(status) {
  const meta = STATUS[status] ?? { label: status, tone: '' };
  return badge(meta.label, meta.tone, { dot: true });
}

export function issueBadges(order) {
  const list = [];
  if (order.late) list.push(badge(`Опоздание ${order.late} дн.`, ISSUE.late.tone));
  const types = new Set(order.issues?.map((i) => i.type));
  for (const type of types) if (ISSUE[type]) list.push(badge(ISSUE[type].label, ISSUE[type].tone));
  return list;
}

export function supplierCell(s, sub = null) {
  return el('a', { class: 'cell-main', href: link('suppliers', s.id) }, logoTile(s), el('div', { style: { minWidth: '0' } }, el('div', { class: 'cell-title truncate', text: s.name }), el('div', { class: 'cell-sub truncate', text: sub ?? `${s.typeLabel}${s.city ? ` · ${s.city}` : ''}` })));
}

export function productCell(p, sub = null) {
  return el('div', { class: 'cell-main' }, productThumb(p), el('div', { style: { minWidth: '0' } }, el('div', { class: 'cell-title truncate', text: p.name }), el('div', { class: 'cell-sub truncate', text: sub ?? [p.brand, packLabel(p)].filter(Boolean).join(' · ') })));
}

export function packLabel(p) {
  return `${qty(p.pack, p.unit)} × ${p.caseSize} в коробке`.replace(' × 1 в коробке', '');
}

export function groupDot(groupId) {
  const g = GROUP_BY_ID[groupId];
  return el('span', { class: 'swatch', style: { background: g?.color ?? 'var(--text-3)' }, title: g?.label ?? '' });
}

export function orderTitle(o) {
  return `Заказ № ${o.number}`;
}

export function orderSub(o) {
  return `${locationName(o.locId)} · ${dayShort(o.createdDay)}`;
}

export function money(value) {
  return el('span', { class: 'num', text: rub(value) });
}

export function share(value, totalValue) {
  return totalValue > 0 ? value / totalValue : 0;
}

export function downloadCsv(filename, header, rows) {
  const body = toCsv(header, rows);
  const blob = new Blob(['\ufeff', body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmt = { num, rub, qty };
