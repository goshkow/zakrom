// «Обзор»: куда уходят деньги на закупки, что требует внимания сегодня и что едет
import { el, icon } from '../core/dom.js';
import { rubShort, pct, num, countOf, dayShort, dayHuman, dayFull, MONTHS_AXIS, addDays } from '../core/format.js';
import { state, orders, locationName } from '../app/state.js';
import { alerts, monthBudget } from '../app/derive.js';
import { filterOrders, total, spendByDayGroup, spendByWeekGroup, dailySeries, revenueTotal, sumBy, groupSeries, activityDays, streak } from '../model/analytics.js';
import { GROUPS, GROUP_BY_ID, KINDS } from '../model/kinds.js';
import { kpi, card, button, badge, meter, empty } from '../ui/components.js';
import { stackedBars, treemap, donut, heatmap, heatLegend, legend } from '../ui/charts.js';
import { pageHead, readPeriod, readLoc, periodControl, locControl, refreshBtn, statusBadge, productCell, downloadCsv, share } from './common.js';
import { go, link } from '../app/router.js';
import { load, save } from '../core/store.js';

export const title = () => 'Обзор';

const hidden = new Set();

export function render(route) {
  const { period, range } = readPeriod(route);
  const locId = readLoc(route);
  const all = orders();
  const cur = filterOrders(all, { from: range.from, to: range.to, locId });
  const prev = filterOrders(all, { from: range.prevFrom, to: range.prevTo, locId });
  const spend = total(cur);
  const spendPrev = total(prev);
  const daily = dailySeries(cur, range.from, range.to);
  const revenue = revenueTotal(state.sim.revenue, range.from, range.to, locId);
  const revenuePrev = revenueTotal(state.sim.revenue, range.prevFrom, range.prevTo, locId);
  const foodCost = revenue ? spend / revenue : 0;
  const foodCostPrev = revenuePrev ? spendPrev / revenuePrev : 0;
  const delivered = cur.filter((o) => o.status === 'delivered' || o.status === 'received');
  const otif = delivered.length ? delivered.filter((o) => !o.late && !o.issues.some((i) => i.type === 'short' || i.type === 'quality')).length / delivered.length : null;
  const deliveredPrev = prev.filter((o) => o.status === 'delivered' || o.status === 'received');
  const otifPrev = deliveredPrev.length ? deliveredPrev.filter((o) => !o.late && !o.issues.some((i) => i.type === 'short' || i.type === 'quality')).length / deliveredPrev.length : null;
  const avg = cur.length ? spend / cur.length : 0;
  const avgPrev = prev.length ? spendPrev / prev.length : 0;
  const delta = (a, b) => (b ? a / b - 1 : null);

  // спарклайны по дням: число заказов и средний чек
  const countSeries = daily.days.map((d) => cur.filter((o) => o.createdDay === d).length);

  const ws = state.ws;
  const head = pageHead('Обзор', `${ws.name} · ${locId ? locationName(locId) : `${countOf(ws.locations.length, ['точка', 'точки', 'точек'])}`}. Закупки за период и то, что требует решения сегодня.`, [
    locControl(locId),
    periodControl(period),
    button('Экспорт CSV', { iconName: 'download', onClick: () => exportCsv(cur) }),
    refreshBtn(),
  ]);

  const tiles = el('div', { class: 'tiles tiles-5' },
    kpi({ label: 'Расходы на закупки', value: rubShort(spend), delta: delta(spend, spendPrev), upIsGood: false, meta: 'к прошлому периоду', spark: daily.values, sparkColor: 'var(--text-2)' }),
    kpi({ label: 'Заказы', value: num(cur.length), delta: delta(cur.length, prev.length), upIsGood: true, meta: `${countOf(new Set(cur.map((o) => o.supplierId)).size, ['поставщик', 'поставщика', 'поставщиков'])}`, spark: countSeries }),
    kpi({ label: 'Средний заказ', value: rubShort(avg), delta: delta(avg, avgPrev), upIsGood: true, meta: 'к прошлому периоду' }),
    kpi({ label: 'Фудкост', value: pct(foodCost), delta: foodCostPrev ? foodCost / foodCostPrev - 1 : null, upIsGood: false, meta: `цель ${pct(ws.targetFoodCost, { digits: 0 })} выручки`, hint: 'Закупки сырья и упаковки к выручке за тот же период. Выручка - из кассы песочницы.' }),
    kpi({ label: 'Поставки OTIF', value: otif === null ? '—' : pct(otif), delta: otif !== null && otifPrev !== null ? otif - otifPrev : null, upIsGood: true, meta: 'вовремя и полностью', hint: 'On Time In Full: доля поставок, которые приехали в срок и без недовоза или брака.' }),
  );

  const banner = integrationBanner();

  // столбцы: по дням до 90 дней, дальше по неделям
  const series = groupSeries();
  const weekly = range.length > 92;
  const bars = weekly ? spendByWeekGroup(cur, range.from, range.to) : spendByDayGroup(cur, range.from, range.to);
  const chartHost = el('div');
  const drawBars = () => {
    const visible = series.filter((s) => !hidden.has(s.key));
    chartHost.replaceChildren(
      stackedBars({
        labels: bars.days,
        series: visible,
        rows: bars.rows,
        height: 280,
        xLabel: (d) => dayShort(d),
        title: (d) => (weekly ? `Неделя с ${dayShort(d)}` : dayHuman(d, state.today)),
        onSelect: (d) => go(link('orders', null, { from: d, to: weekly ? addDays(d, 6) : d, loc: locId })),
      }),
      el('div', { style: { marginTop: '14px' } }, legend(series, { hidden, onToggle: (key) => { hidden.has(key) ? hidden.delete(key) : hidden.add(key); drawBars(); } })),
    );
  };
  drawBars();

  const bySupplier = sumBy(cur, (o) => o.supplierId);
  const supplierItems = [...bySupplier.entries()].map(([id, value]) => {
    const s = state.supply.suppliers.get(id);
    return { id, label: s.name, value, color: GROUP_BY_ID[s.groups[0]]?.color ?? 'var(--s1)', sub: s.typeLabel };
  });

  const spendCard = card({
    title: el('span', {}, 'Расходы по категориям'),
    sub: weekly ? 'По неделям, по дате заказа' : 'По дням, по дате заказа. Нажмите на столбец - откроются заказы дня',
    body: chartHost,
  });
  const treeCard = card({
    title: 'Топ поставщиков по расходам',
    actions: el('a', { class: 'card-link', href: '#/suppliers' }, 'Все', icon('chevron-right')),
    body: supplierItems.length ? treemap(supplierItems, { height: 318, onSelect: (item) => go(link('suppliers', item.id)) }) : empty('Закупок за период нет'),
  });

  const byGroup = sumBy(cur, (o, l) => KINDS[l.kind].group);
  const groupItems = GROUPS.map((g) => ({ label: g.label, value: byGroup.get(g.id) ?? 0, color: g.color, id: g.id })).filter((g) => g.value > 0);
  const distribution = card({
    title: 'Распределение',
    sub: 'Доля категорий в расходах',
    body: groupItems.length
      ? el('div', { class: 'donut-wrap' }, donut(groupItems, { size: 148, thickness: 16, center: { value: rubShort(spend).replace(' ₽', ''), label: '₽ за период' } }), el('div', { class: 'list', style: { flex: '1', minWidth: '0' } }, groupItems.sort((a, b) => b.value - a.value).map((g) => el('a', { class: 'between', href: link('analytics', null, { group: g.id, period }), style: { padding: '5px 0' } }, el('span', { class: 'row truncate' }, el('span', { class: 'swatch', style: { background: g.color, borderRadius: '50%' } }), el('span', { class: 'truncate', text: g.label })), el('span', { class: 'num muted', text: pct(share(g.value, spend), { digits: 0 }) })))))
      : empty('Нет данных'),
  });

  const attention = attentionCard();
  const deliveries = deliveriesCard(locId);
  const budget = budgetCard();
  const top = topProductsCard(cur, spend);
  const activity = activityCard(locId);

  return el('div', { class: 'stack-l' },
    head,
    banner,
    tiles,
    el('div', { class: 'grid-main' }, spendCard, treeCard),
    el('div', { class: 'grid-3' }, attention, deliveries, budget),
    el('div', { class: 'grid-main' }, top, distribution),
    activity,
  );
}

function integrationBanner() {
  if (load(`banner:integrations:${state.wsId}`, false)) return null;
  const node = el('div', { class: 'banner' },
    el('div', { class: 'banner-icons', 'aria-hidden': 'true' }, ['1С', 'POS', 'ЭДО', 'ВСД'].map((t, i) => el('span', { class: 'logo-tile banner-tile', style: { background: ['#ffd84d', '#9fe870', '#7cc4ff', '#ffb08a'][i] }, text: t }))),
    el('div', { class: 'banner-text' }, el('div', { class: 'banner-title', text: 'Подключите учётную систему, ЭДО и Меркурий' }), el('div', { class: 'banner-sub', text: 'Остатки, выручка и входящие УПД будут приходить сами, а ВСД гаситься при приёмке. В песочнице интеграции пока не подключаются, но их можно добавить.' })),
    el('a', { class: 'btn', href: '#/settings/integrations' }, 'Посмотреть интеграции'),
    el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Скрыть', on: { click: () => { save(`banner:integrations:${state.wsId}`, true); node.remove(); } } }, icon('x')),
  );
  return node;
}

function attentionCard() {
  const list = alerts().slice(0, 5);
  return card({
    title: 'Требует внимания',
    actions: list.length ? badge(String(alerts().length), 'outline') : null,
    flush: true,
    body: list.length
      ? el('div', { class: 'list' }, list.map((a) => el('a', { class: 'list-item', href: a.href }, el('span', { class: `badge badge-${a.tone}` }, icon(a.icon)), el('div', { style: { minWidth: '0', flex: '1' } }, el('div', { class: 'cell-title truncate', text: a.title }), el('div', { class: 'cell-sub', text: a.text })), icon('chevron-right', 'faint'))))
      : empty('Всё под контролем', 'Согласований, приёмок и просрочек нет', null, 'check'),
  });
}

function deliveriesCard(locId) {
  const soon = orders()
    .filter((o) => ['arrived', 'in_transit', 'confirmed', 'sent'].includes(o.status) && (!locId || o.locId === locId))
    .sort((a, b) => (a.expectedDay < b.expectedDay ? -1 : a.expectedDay > b.expectedDay ? 1 : 0))
    .slice(0, 5);
  return card({
    title: 'Ближайшие поставки',
    actions: el('a', { class: 'card-link', href: '#/orders?status=open' }, 'Все', icon('chevron-right')),
    flush: true,
    body: soon.length
      ? el('div', { class: 'list' }, soon.map((o) => {
        const s = state.supply.suppliers.get(o.supplierId);
        return el('a', { class: 'list-item', href: link('orders', o.id) }, el('div', { style: { minWidth: '0', flex: '1' } }, el('div', { class: 'cell-title truncate', text: s.name }), el('div', { class: 'cell-sub truncate', text: `${o.status === 'arrived' ? 'приехал' : dayHuman(o.expectedDay, state.today)} · ${locationName(o.locId)}` })), el('div', { style: { textAlign: 'right' } }, el('div', { class: 'num', text: rubShort(o.total) }), statusBadge(o.status)));
      }))
      : empty('Поставок в пути нет'),
  });
}

function budgetCard() {
  const b = monthBudget();
  const tone = b.forecastShare > 1.02 ? 'bad' : b.forecastShare > 0.95 ? 'warn' : 'ok';
  const from = `${state.today.slice(0, 7)}-01`;
  const locs = state.ws.locations.map((l) => ({ l, v: total(filterOrders(orders(), { from, to: state.today, locId: l.id })) })).sort((a, b) => b.v - a.v);
  const max = Math.max(...locs.map((x) => x.v), 1);
  return card({
    title: 'Бюджет месяца',
    sub: `День ${b.dayOfMonth} из ${b.daysInMonth}`,
    actions: el('a', { class: 'card-link', href: '#/settings/budgets' }, 'Лимиты'),
    body: el('div', { class: 'stack' },
      el('div', {}, el('div', { class: 'row', style: { alignItems: 'baseline', gap: '6px' } }, el('span', { class: 'kpi-value', text: rubShort(b.spent) }), el('span', { class: 'faint', text: `из ${rubShort(b.budget)}` })), el('div', { style: { margin: '10px 0 6px' } }, meter(b.share, { tone })), el('div', { class: 'between faint', style: { fontSize: '12.5px' } }, el('span', { text: `Потрачено ${pct(b.share, { digits: 0 })}` }), el('span', { class: tone === 'ok' ? '' : tone, text: `Прогноз ${rubShort(b.forecast)}` }))),
      locs.length > 1 ? el('div', { class: 'list' }, locs.slice(0, 6).map(({ l, v }) => el('div', { style: { padding: '4px 0' } }, el('div', { class: 'between', style: { fontSize: '13px' } }, el('span', { class: 'truncate', text: l.name }), el('span', { class: 'num muted', text: rubShort(v) })), el('div', { style: { marginTop: '4px' } }, meter(v / max))))) : null,
    ),
  });
}

function topProductsCard(cur, spend) {
  const byProduct = sumBy(cur, (o, l) => l.productId);
  const rows = [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, value]) => ({ p: state.supply.products.get(id), value }));
  const max = rows[0]?.value ?? 1;
  return card({
    title: 'Топ товаров по расходам',
    sub: 'На что уходит больше всего денег',
    actions: el('a', { class: 'card-link', href: '#/analytics?tab=explore' }, 'Разбор', icon('chevron-right')),
    flush: true,
    body: rows.length
      ? el('div', { class: 'list' }, rows.map(({ p, value }, i) => el('a', { class: 'list-item', href: link('catalog', null, { p: p.id }) },
        el('span', { class: 'list-rank', text: String(i + 1) }),
        el('div', { style: { flex: '1', minWidth: '0' } }, productCell(p, `${p.spec.label}${p.brand ? ` · ${p.brand}` : ''}`), el('div', { style: { marginTop: '8px', marginLeft: '46px' } }, meterColored(value / max, GROUP_BY_ID[p.group].color))),
        el('div', { style: { textAlign: 'right' } }, el('div', { class: 'num', text: rubShort(value) }), el('div', { class: 'cell-sub', text: pct(share(value, spend)) })),
      )))
      : empty('Нет закупок за период'),
  });
}

function meterColored(value, color) {
  const node = meter(value);
  node.firstChild.style.background = color;
  return node;
}

function activityCard(locId) {
  const all = orders().filter((o) => !locId || o.locId === locId);
  const days = activityDays(all);
  for (const [day, info] of days) {
    info.title = dayFull(day);
    info.label = countOf(info.n, ['заказ', 'заказа', 'заказов']);
  }
  const values = [...days.values()].map((d) => d.value);
  const sum = values.reduce((a, b) => a + b, 0);
  const firstDay = [...days.keys()].sort()[0] ?? state.today;
  const span = Math.max(1, (Date.parse(state.today) - Date.parse(firstDay)) / 86400000 + 1);
  return card({
    title: el('span', { class: 'row' }, 'Активность закупок', el('span', { class: 'faint', title: 'Каждая клетка - день. Цвет - сумма заказов за день' }, icon('info'))),
    actions: el('span', { class: 'faint', text: 'Расходы' }),
    body: el('div', { class: 'stack' },
      el('div', { class: 'row-wrap', style: { gap: '28px' } },
        stat('Самая длинная серия', countOf(streak(days, state.today), ['день', 'дня', 'дней'])),
        stat('В среднем за день', rubShort(sum / span)),
        stat('В среднем за неделю', rubShort((sum / span) * 7)),
        stat('Всего за год', rubShort(sum)),
      ),
      heatmap(days, { end: state.today, weeks: 53, monthNames: MONTHS_AXIS }),
      heatLegend(),
    ),
  });
}

function stat(label, value) {
  return el('div', {}, el('div', { class: 'faint', style: { fontSize: '13px' }, text: label }), el('div', { style: { fontSize: '18px', fontWeight: '600', marginTop: '2px' }, text: value }));
}

function exportCsv(list) {
  const rows = [];
  for (const o of list) {
    const s = state.supply.suppliers.get(o.supplierId);
    for (const l of o.lines) {
      const p = state.supply.products.get(l.productId);
      rows.push([o.number, o.createdDay, locationName(o.locId), s.name, p.name, p.barcode ?? '', KINDS[l.kind].label, l.packs, String(l.price).replace('.', ','), String(Math.round(l.packs * l.price * 100) / 100).replace('.', ','), o.status]);
    }
  }
  downloadCsv(`zakrom-${state.wsId}-${state.today}.csv`, ['Заказ', 'Дата', 'Точка', 'Поставщик', 'Товар', 'Штрихкод', 'Вид', 'Упаковок', 'Цена за упаковку', 'Сумма', 'Статус'], rows);
}

