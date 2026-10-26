// «Поставщики»: реальные компании из Wikidata и OpenStreetMap, с кем работаем и как они поставляют
import { el, icon, debounce, safeUrl, safeTel, safeMail } from '../core/dom.js';
import { rub, rubShort, pct, num, countOf, addDays } from '../core/format.js';
import { state, orders } from '../app/state.js';
import { GROUPS, GROUP_BY_ID } from '../model/kinds.js';
import { TYPE_LABELS } from '../model/supply.js';
import { rankSuppliers } from '../model/compare.js';
import { filterOrders, sumBy, supplierScore, total } from '../model/analytics.js';
import { badge, chip, dataTable, searchInput, dropdown, meter, card, kpi, sandboxNote } from '../ui/components.js';
import { pageHead, supplierCell, share } from './common.js';
import { setQuery, link, go } from '../app/router.js';

export const title = () => 'Поставщики';

const MAX_COMPARE = 4;
const DAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const SCOPES = [
  { value: 'active', label: 'С кем работаем' },
  { value: 'all', label: 'Все доступные' },
  { value: 'fav', label: 'Избранные' },
];

export function render(route) {
  const scope = SCOPES.some((s) => s.value === route.query.get('scope')) ? route.query.get('scope') : 'active';
  const type = TYPE_LABELS[route.query.get('type')] ? route.query.get('type') : null;
  const group = GROUP_BY_ID[route.query.get('group')] ? route.query.get('group') : null;
  const q = route.query.get('q') ?? '';
  const cities = [...new Set([...state.supply.suppliers.values()].filter((x) => !x.national && x.city).map((x) => x.city))].sort((a, b) => a.localeCompare(b, 'ru'));
  const city = cities.includes(route.query.get('city')) ? route.query.get('city') : null;
  const picked = (route.query.get('cmp') ?? '').split(',').filter((id) => state.supply.suppliers.has(id)).slice(0, MAX_COMPARE);
  const togglePick = (id) => setQuery({ cmp: (picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < MAX_COMPARE ? [...picked, id] : picked).join(',') || null });
  const from = addDays(state.today, -89);
  const recent = filterOrders(orders(), { from, to: state.today });
  const spend = sumBy(recent, (o) => o.supplierId);
  const spendTotal = total(recent);
  const counts = new Map();
  for (const o of recent) counts.set(o.supplierId, (counts.get(o.supplierId) ?? 0) + 1);
  const favorites = new Set(state.user.favorites);
  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

  const rows = [...state.supply.suppliers.values()]
    .filter((s) => (state.supply.offersBySupplier.get(s.id) ?? []).length)
    .filter((s) => {
      if (scope === 'active' && !spend.has(s.id)) return false;
      if (scope === 'fav' && !favorites.has(s.id)) return false;
      if (type && s.type !== type) return false;
      if (group && !s.groups.includes(group)) return false;
      if (city && !s.national && s.city !== city) return false;
      if (q && !norm(`${s.name} ${s.city ?? ''} ${(s.brands ?? []).join(' ')} ${s.description ?? ''}`).includes(norm(q))) return false;
      return true;
    })
    .map((s) => ({ s, spend: spend.get(s.id) ?? 0, orders: counts.get(s.id) ?? 0, score: supplierScore(recent, s.id, from, state.today), offers: (state.supply.offersBySupplier.get(s.id) ?? []).length }));

  const active = [...spend.keys()].length;
  const top = [...spend.entries()].sort((a, b) => b[1] - a[1]);
  const topShare = top.length ? top[0][1] / spendTotal : 0;
  const scores = [...spend.keys()].map((id) => supplierScore(recent, id, from, state.today)).filter(Boolean);
  const avgOtif = scores.length ? scores.reduce((s, x) => s + x.otif * x.n, 0) / scores.reduce((s, x) => s + x.n, 0) : null;
  const sources = state.catalog.sources;

  const head = pageHead('Поставщики', `Компании - настоящие: профили из Wikidata, адреса и контакты из OpenStreetMap. Условия поставки и показатели - по заказам песочницы за 90 дней.`, [
    el('a', { class: 'btn', href: '#/rfq?new=1' }, icon('gavel'), 'Запросить цены'),
  ]);

  const tiles = el('div', { class: 'tiles tiles-4' },
    kpi({ label: 'Работаем сейчас', value: num(active), meta: `из ${num(state.supply.suppliers.size)} доступных в ваших городах` }),
    kpi({ label: 'Средний OTIF', value: avgOtif === null ? '—' : pct(avgOtif), meta: 'вовремя и полностью, 90 дней' }),
    kpi({ label: 'Доля крупнейшего', value: pct(topShare, { digits: 0 }), meta: top.length ? `${state.supply.suppliers.get(top[0][0]).name}` : '—', hint: 'Если один поставщик закрывает больше 40% расходов, его сбой остановит кухню. Держите запасного.' }),
    kpi({ label: 'Расходы за 90 дней', value: rubShort(spendTotal), meta: countOf(recent.length, ['заказ', 'заказа', 'заказов']) }),
  );

  const typeCounts = {};
  for (const s of state.supply.suppliers.values()) typeCounts[s.type] = (typeCounts[s.type] ?? 0) + 1;

  const filters = el('div', { class: 'stack' },
    el('div', { class: 'row-wrap', style: { gap: '10px' } },
      el('div', { class: 'seg-group' }, SCOPES.map((s) => el('button', { class: 'seg', type: 'button', 'aria-pressed': String(scope === s.value), on: { click: () => setQuery({ scope: s.value === 'active' ? null : s.value }) } }, s.label, s.value === 'fav' && favorites.size ? el('span', { class: 'seg-count', text: String(favorites.size) }) : null))),
      el('div', { style: { flex: '1 1 240px' } }, searchInput('Компания, город или бренд', q, debounce((v) => setQuery({ q: v || null }), 250))),
      dropdown([{ value: '', label: 'Все города' }, ...cities.map((c) => ({ value: c, label: c }))], city ?? '', (v) => setQuery({ city: v || null }), { iconName: 'pin', align: 'right' }),
      dropdown([{ value: '', label: 'Все категории' }, ...GROUPS.map((g) => ({ value: g.id, label: g.label }))], group ?? '', (v) => setQuery({ group: v || null }), { iconName: 'layers', align: 'right' }),
    ),
    el('div', { class: 'row-wrap' }, chip('Все типы', !type, () => setQuery({ type: null })), Object.entries(TYPE_LABELS).map(([k, label]) => chip(label, type === k, () => setQuery({ type: type === k ? null : k }), { count: typeCounts[k] ?? 0 }))),
  );

  const table = dataTable({
    columns: [
      { key: 'name', label: 'Компания', render: (r) => el('div', { class: 'row', style: { gap: '8px' } }, supplierCell(r.s), favorites.has(r.s.id) ? el('span', { class: 'faint', title: 'В избранном' }, icon('star')) : null), sort: (r) => r.s.name, defaultDir: 'asc' },
      { key: 'pick', label: 'Сравнить', render: (r) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(picked.includes(r.s.id)), 'aria-label': `Сравнить: ${r.s.name}`, on: { click: (e) => { e.stopPropagation(); togglePick(r.s.id); } } }, icon(picked.includes(r.s.id) ? 'check' : 'plus')) },
      { key: 'groups', label: 'Что берём', render: (r) => el('div', { class: 'row', style: { gap: '4px' } }, r.s.groups.slice(0, 4).map((g) => el('span', { class: 'swatch', style: { background: GROUP_BY_ID[g].color }, title: GROUP_BY_ID[g].label })), el('span', { class: 'cell-sub', style: { marginLeft: '4px' }, text: countOf(r.offers, ['позиция', 'позиции', 'позиций']) })) },
      { key: 'source', label: 'Источник', render: (r) => badge(r.s.source === 'wikidata' ? 'Wikidata' : 'OpenStreetMap', 'outline'), cls: 'hide-sm' },
      { key: 'minOrder', label: 'Мин. заказ', align: 'right', render: (r) => el('span', { class: 'num', text: rubShort(r.s.terms.minOrder) }), sort: (r) => r.s.terms.minOrder, cls: 'hide-sm' },
      { key: 'lead', label: 'Срок', align: 'right', render: (r) => `${r.s.terms.leadDays} дн.`, sort: (r) => r.s.terms.leadDays, cls: 'hide-sm' },
      { key: 'otif', label: 'OTIF', align: 'right', render: (r) => (r.score ? el('span', { class: r.score.otif < 0.85 ? 'bad' : r.score.otif < 0.92 ? 'warn' : '', text: pct(r.score.otif, { digits: 0 }) }) : el('span', { class: 'faint', text: '—' })), sort: (r) => r.score?.otif ?? -1 },
      { key: 'orders', label: 'Заказы', align: 'right', render: (r) => (r.orders ? num(r.orders) : el('span', { class: 'faint', text: '—' })), sort: (r) => r.orders },
      { key: 'spend', label: 'Расходы, 90 дней', align: 'right', render: (r) => (r.spend ? el('div', { style: { minWidth: '120px' } }, el('div', { class: 'num', text: rubShort(r.spend) }), el('div', { style: { marginTop: '5px' } }, meter(share(r.spend, top[0]?.[1] ?? 1)))) : el('span', { class: 'faint', text: 'не работаем' })), sort: (r) => r.spend },
    ],
    rows,
    sortKey: scope === 'active' ? 'spend' : 'name',
    sortDir: scope === 'active' ? 'desc' : 'asc',
    onRow: (r) => go(link('suppliers', r.s.id)),
    emptyText: scope === 'fav' ? 'В избранном пока никого: отметьте звёздочкой в профиле поставщика' : 'Под фильтр никто не подошёл',
  });

  const sourceNote = el('div', { class: 'source-line' }, sources.map((s) => el('span', { text: `${s.title}: ${num(s.count)} записей, снимок ${String(s.fetchedAt ?? '').slice(0, 10)}` })));

  return el('div', { class: 'stack-l' }, head, tiles, card({ body: el('div', { class: 'stack' }, filters), cls: '' }), picked.length ? compareCard(picked, { city, scores: (id) => supplierScore(recent, id, from, state.today), clear: () => setQuery({ cmp: null }), drop: togglePick }) : picked.length === 0 && rows.length > 1 ? hint() : null, card({ title: `${countOf(rows.length, ['компания', 'компании', 'компаний'])}`, flush: true, body: table }), sourceNote);
}

function hint() {
  return el('p', { class: 'faint', style: { fontSize: '13px' }, text: 'Отметьте 2-4 компании в колонке «Сравнить»: покажу условия рядом и подскажу, с кем связаться первым.' });
}

// сравнение условий рядом и подсказка, кому писать первым
function compareCard(ids, { city, scores, clear, drop }) {
  const list = ids.map((id) => state.supply.suppliers.get(id));
  const items = list.map((s) => ({ id: s.id, otif: scores(s.id)?.otif ?? s.terms.otif, leadDays: s.terms.leadDays, minOrder: s.terms.minOrder, paymentDays: s.terms.paymentDays, certCount: s.terms.certs.length, local: (city ? s.city === city : !s.national) ? 1 : 0 }));
  const ranked = rankSuppliers(items);
  const best = state.supply.suppliers.get(ranked[0].id);
  const verdict = list.length < 2
    ? 'Добавьте ещё хотя бы одну компанию, чтобы было с чем сравнивать.'
    : `Писать первым: ${best.name}${ranked[0].reasons.length ? ` - ${ranked[0].reasons.join(', ')}` : ''}.`;
  const cell = (s, fn) => el('td', {}, fn(s));
  const row = (label, fn) => el('tr', {}, el('th', { scope: 'row', text: label }), list.map((s) => cell(s, fn)));
  const days = (s) => (s.terms.deliveryDays.length >= 6 ? 'ежедневно, кроме вс' : s.terms.deliveryDays.map((d) => DAY_SHORT[d]).join(', '));
  const contact = (s) => {
    const site = safeUrl(s.website);
    const tel = s.phone && safeTel(s.phone);
    const mail = s.email && safeMail(s.email);
    const parts = [
      site ? el('a', { href: site, target: '_blank', rel: 'noopener noreferrer', class: 'card-link', text: site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') }) : null,
      tel ? el('a', { href: tel, class: 'card-link', text: s.phone }) : null,
      mail ? el('a', { href: mail, class: 'card-link', text: s.email }) : null,
    ].filter(Boolean);
    return parts.length ? el('div', { class: 'stack', style: { gap: '4px' } }, parts) : el('a', { href: safeUrl(s.sourceUrl) ?? '#', target: '_blank', rel: 'noopener noreferrer', class: 'card-link', text: 'контактов нет, источник' });
  };
  const rankOf = (s) => ranked.findIndex((r) => r.id === s.id);
  const table = el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '' }), list.map((s) => el('th', { scope: 'col' }, el('div', { class: 'row', style: { gap: '6px' } }, el('a', { href: link('suppliers', s.id), text: s.name }), el('button', { class: 'chip', type: 'button', 'aria-label': `Убрать из сравнения: ${s.name}`, on: { click: () => drop(s.id) } }, icon('x'))))))),
    el('tbody', {},
      list.length > 1 ? row('Место', (s) => (rankOf(s) === 0 ? badge('первым', 'accent') : `${rankOf(s) + 1}-е`)) : null,
      row('Где', (s) => (s.national ? 'вся Россия' : `${s.city} и область`)),
      row('Минимальный заказ', (s) => rub(s.terms.minOrder)),
      row('Доставка', (s) => `${days(s)}, срок ${s.terms.leadDays} дн.`),
      row('Оплата', (s) => (s.terms.paymentDays === 0 ? 'при заказе' : `отсрочка ${s.terms.paymentDays} дн.`)),
      row('Надёжность (OTIF)', (s) => pct(scores(s.id)?.otif ?? s.terms.otif, { digits: 0 })),
      row('Документы', (s) => s.terms.certs.join(', ')),
      row('Контакты', contact),
      row('Заметка', (s) => state.user.notes[s.id] || el('span', { class: 'faint', text: 'нет' })),
    )));
  return card({
    title: 'Сравнение',
    sub: verdict,
    actions: el('button', { class: 'btn btn-sm', type: 'button', on: { click: clear } }, 'Сбросить'),
    flush: true,
    body: el('div', { class: 'stack' }, table, el('div', { style: { padding: '0 16px 12px' } }, sandboxNote('Минимальный заказ, сроки, отсрочка, документы и OTIF смоделированы. Контакты настоящие, из Wikidata и OpenStreetMap. Веса: надёжность 35%, срок 20%, мин. заказ 15%, отсрочка 15%, документы 10%, город 5%.'))),
  });
}
