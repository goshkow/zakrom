// «Аналитика»: куда и как меняются расходы, цена вашей корзины и разрез по любому измерению
import { el, icon, debounce } from '../core/dom.js';
import { rub, rubShort, pct, num, countOf, dayShort, dayHuman, monthAxis, monthLabel, addDays } from '../core/format.js';
import { state, orders, locationName } from '../app/state.js';
import { GROUPS, GROUP_BY_ID, KINDS, COMMODITY_LABELS } from '../model/kinds.js';
import { filterOrders, total, spendByDayGroup, spendByWeekGroup, dailySeries, revenueTotal, sumBy, groupSeries, basketIndex, inflationDrivers } from '../model/analytics.js';
import { shiftMonth } from '../model/market.js';
import { kpi, card, tabs, dataTable, dropdown, searchInput, badge, empty, button } from '../ui/components.js';
import { stackedBars, lineChart, legend } from '../ui/charts.js';
import { pageHead, readPeriod, readLoc, periodControl, locControl, downloadCsv, share } from './common.js';
import { setQuery, link, go } from '../app/router.js';

export const title = () => 'Аналитика';

const TABS = [
  { value: 'overview', label: 'Обзор', icon: 'analytics' },
  { value: 'prices', label: 'Цены', icon: 'market' },
  { value: 'explore', label: 'Разрез', icon: 'layers' },
];

const DIMENSIONS = [
  { value: 'supplier', label: 'Поставщик' },
  { value: 'group', label: 'Категория' },
  { value: 'kind', label: 'Вид сырья' },
  { value: 'product', label: 'Товар' },
  { value: 'loc', label: 'Точка' },
];

const LOC_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const hiddenGroups = new Set();

export function render(route) {
  const tab = TABS.some((t) => t.value === route.query.get('tab')) ? route.query.get('tab') : 'overview';
  const { period, range } = readPeriod(route, '90d');
  const locId = readLoc(route);
  const group = GROUP_BY_ID[route.query.get('group')] ? route.query.get('group') : null;
  const all = orders();
  const cur = filterOrders(all, { from: range.from, to: range.to, locId, group });
  const prev = filterOrders(all, { from: range.prevFrom, to: range.prevTo, locId, group });

  const head = pageHead('Аналитика расходов', `${state.ws.name}${locId ? ` · ${locationName(locId)}` : ''}${group ? ` · ${GROUP_BY_ID[group].label}` : ''}. Все суммы - по дате заказа, после приёмки - по УПД.`, [
    locControl(locId),
    dropdown([{ value: '', label: 'Все категории' }, ...GROUPS.map((g) => ({ value: g.id, label: g.label }))], group ?? '', (v) => setQuery({ group: v || null }), { iconName: 'layers' }),
    periodControl(period),
  ]);
  const bar = tabs(TABS, tab, (v) => setQuery({ tab: v === 'overview' ? null : v }));
  let body;
  if (tab === 'prices') body = pricesTab(cur, range);
  else if (tab === 'explore') body = exploreTab(route, cur, prev, range, group);
  else body = overviewTab(cur, prev, range, locId, group);
  return el('div', { class: 'stack-l' }, head, bar, body);
}

function overviewTab(cur, prev, range, locId, group) {
  const spend = total(cur, { group });
  const spendPrev = total(prev, { group });
  const daily = dailySeries(cur, range.from, range.to);
  const revenue = revenueTotal(state.sim.revenue, range.from, range.to, locId);
  const revenuePrev = revenueTotal(state.sim.revenue, range.prevFrom, range.prevTo, locId);
  const lines = cur.reduce((s, o) => s + o.lines.length, 0);
  const weekly = range.length > 92;
  const bars = weekly ? spendByWeekGroup(cur, range.from, range.to) : spendByDayGroup(cur, range.from, range.to);
  const series = groupSeries().filter((s) => !group || s.key === group);

  const tiles = el('div', { class: 'tiles tiles-4' },
    kpi({ label: 'Расходы', value: rubShort(spend), delta: spendPrev ? spend / spendPrev - 1 : null, upIsGood: false, meta: 'к прошлому периоду', spark: daily.values }),
    kpi({ label: 'Расход в день', value: rubShort(spend / range.length), meta: 'в среднем за период', hint: 'Сколько в среднем уходит на закупки за один день. Удобно сравнивать с выручкой дня.' }),
    kpi({ label: 'Выручка', value: rubShort(revenue), delta: revenuePrev ? revenue / revenuePrev - 1 : null, upIsGood: true, meta: 'касса песочницы' }),
    kpi({ label: 'Строк в заказах', value: num(lines), meta: `${countOf(cur.length, ['заказ', 'заказа', 'заказов'])}, ${num(lines / Math.max(1, cur.length), 1)} поз. в среднем` }),
  );

  const chartHost = el('div');
  const draw = () => {
    const visible = series.filter((s) => !hiddenGroups.has(s.key));
    chartHost.replaceChildren(stackedBars({ labels: bars.days, series: visible, rows: bars.rows, height: 280, xLabel: dayShort, title: (d) => (weekly ? `Неделя с ${dayShort(d)}` : dayHuman(d, state.today)) }), el('div', { style: { marginTop: '14px' } }, legend(series, { hidden: hiddenGroups, onToggle: (k) => { hiddenGroups.has(k) ? hiddenGroups.delete(k) : hiddenGroups.add(k); draw(); } })));
  };
  draw();

  // расходы по точкам: одна серия на точку
  const locSeries = state.ws.locations.map((l, i) => ({ key: l.id, label: l.name, color: LOC_COLORS[i % LOC_COLORS.length] }));
  const byLoc = (weekly ? weekRows : dayRows)(cur, range, (o) => o.locId);
  const locCard = state.ws.locations.length > 1 && !locId
    ? card({ title: 'Расходы по точкам', sub: weekly ? 'По неделям' : 'По дням', body: el('div', { class: 'stack' }, stackedBars({ labels: byLoc.days, series: locSeries, rows: byLoc.rows, height: 240, xLabel: dayShort, title: (d) => (weekly ? `Неделя с ${dayShort(d)}` : dayHuman(d, state.today)) }), legend(locSeries)) })
    : null;

  // доля закупок напрямую у производителей: чем выше, тем меньше переплата посредникам
  const weeks = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 7)) weeks.push(d);
  const direct = weeks.map((w) => {
    const to = addDays(w, 6);
    const list = cur.filter((o) => o.createdDay >= w && o.createdDay <= to);
    const sum = total(list);
    const man = total(list.filter((o) => ['manufacturer', 'producer'].includes(state.supply.suppliers.get(o.supplierId).type)));
    return sum ? (man / sum) * 100 : null;
  });
  const directCard = card({
    title: 'Закупки напрямую у производителей',
    sub: 'Доля в расходах по неделям. Остальное - оптовики и cash & carry',
    body: weeks.length > 1 ? lineChart({ labels: weeks, series: [{ key: 'direct', label: 'Напрямую', color: 'var(--s3)', values: direct }], height: 220, xLabel: dayShort, title: (d) => `Неделя с ${dayShort(d)}`, format: (v) => `${num(v, 1)} %`, yFormat: (v) => `${num(v)} %`, zero: true }) : empty('Период слишком короткий', 'Выберите хотя бы 30 дней'),
  });

  const ordersByDay = dayRows(cur, range, () => 'n', true);
  const volumeCard = card({
    title: 'Число заказов',
    sub: 'По дням: видно ритм поставок и пики перед выходными',
    body: stackedBars({ labels: ordersByDay.days, series: [{ key: 'n', label: 'Заказов', color: 'var(--s1)' }], rows: ordersByDay.rows, height: 220, xLabel: dayShort, title: (d) => dayHuman(d, state.today), format: (v) => countOf(v, ['заказ', 'заказа', 'заказов']), yFormat: (v) => num(v) }),
  });

  return el('div', { class: 'stack-l' },
    tiles,
    card({ title: 'Расходы по категориям', sub: 'Нажмите на категорию в легенде, чтобы скрыть её', body: chartHost }),
    el('div', { class: 'grid-2' }, locCard ?? volumeCard, directCard),
    locCard ? volumeCard : null,
  );
}

function dayRows(list, range, keyFn, countMode = false) {
  const { days } = spendByDayGroup([], range.from, range.to);
  const index = new Map(days.map((d, i) => [d, i]));
  const rows = days.map(() => ({}));
  for (const o of list) {
    const i = index.get(o.createdDay);
    if (i === undefined) continue;
    const key = keyFn(o);
    rows[i][key] = (rows[i][key] ?? 0) + (countMode ? 1 : o.total);
  }
  return { days, rows };
}

function weekRows(list, range, keyFn) {
  const daily = dayRows(list, range, keyFn);
  const days = [];
  const rows = [];
  for (let i = 0; i < daily.days.length; i += 7) {
    days.push(daily.days[i]);
    const acc = {};
    for (let j = i; j < Math.min(i + 7, daily.days.length); j += 1) for (const [k, v] of Object.entries(daily.rows[j])) acc[k] = (acc[k] ?? 0) + v;
    rows.push(acc);
  }
  return { days, rows };
}

function pricesTab(cur, range) {
  const months = [];
  for (let i = 11; i >= 0; i -= 1) months.push(shiftMonth(state.market.nowKey, -i));
  const monthDays = months.map((m) => `${m}-15`);
  const index = basketIndex(cur, state.market, monthDays);
  const drivers = inflationDrivers(cur, state.market, monthDays[0], state.today);
  const yearChange = index.at(-1) / index[0] - 1;
  const q = inflationDrivers(cur, state.market, addDays(state.today, -92), state.today);
  const quarter = q.reduce((s, d) => s + d.contribution, 0);
  const top = drivers.filter((d) => d.contribution > 0).slice(0, 1)[0];
  return el('div', { class: 'stack-l' },
    el('div', { class: 'tiles tiles-3' },
      kpi({ label: 'Корзина за 12 месяцев', value: pct(yearChange, { sign: true }), meta: 'при той же структуре закупок', upIsGood: false }),
      kpi({ label: 'За последние 3 месяца', value: pct(quarter, { sign: true }), meta: 'взвешенно по вашим расходам' }),
      kpi({ label: 'Главный вклад', value: top ? KINDS[top.kind].label : '—', meta: top ? `${pct(top.change, { sign: true })} цены, ${pct(top.share, { digits: 0 })} расходов` : '' }),
    ),
    card({
      title: 'Индекс цены вашей корзины',
      sub: '100 = цены год назад. Веса - доли видов сырья в ваших расходах за выбранный период',
      body: lineChart({ labels: months, series: [{ key: 'idx', label: 'Индекс', color: 'var(--s2)', values: index }], height: 260, xLabel: monthAxis, title: monthLabel, format: (v) => num(v, 1), yFormat: (v) => num(v), refValue: 100, refLabel: 'год назад' }),
    }),
    card({
      title: 'Что двигает цену корзины',
      sub: 'Изменение цены за 12 месяцев × доля в расходах. Биржевые виды идут за ценами Всемирного банка в рублях',
      flush: true,
      body: dataTable({
        columns: [
          { key: 'kind', label: 'Вид сырья', render: (d) => el('a', { class: 'row', style: { gap: '8px' }, href: link('catalog', null, { kind: d.kind }) }, el('span', { class: 'swatch', style: { background: GROUP_BY_ID[KINDS[d.kind].group].color } }), el('span', {}, el('div', { class: 'cell-title', text: KINDS[d.kind].label }), el('div', { class: 'cell-sub', text: KINDS[d.kind].commodity ? `биржа: ${COMMODITY_LABELS[KINDS[d.kind].commodity]}` : 'без биржевой привязки' }))) },
          { key: 'share', label: 'Доля расходов', align: 'right', render: (d) => pct(d.share), sort: (d) => d.share },
          { key: 'change', label: 'Цена за 12 мес.', align: 'right', render: (d) => el('span', { class: d.change > 0.05 ? 'warn' : d.change < 0 ? 'good' : '', text: pct(d.change, { sign: true }) }), sort: (d) => d.change },
          { key: 'contribution', label: 'Вклад в корзину', align: 'right', render: (d) => el('b', { class: 'num', text: `${d.contribution >= 0 ? '+' : '−'}${num(Math.abs(d.contribution) * 100, 2)} п.п.` }), sort: (d) => d.contribution },
        ],
        rows: drivers.slice(0, 20),
        sortKey: 'contribution',
        sortDir: 'desc',
      }),
    }),
  );
}

function exploreTab(route, cur, prev, range, group) {
  const dim = DIMENSIONS.some((d) => d.value === route.query.get('by')) ? route.query.get('by') : 'supplier';
  const q = (route.query.get('q') ?? '').toLowerCase();
  const keyFn = {
    supplier: (o) => o.supplierId,
    group: (o, l) => KINDS[l.kind].group,
    kind: (o, l) => l.kind,
    product: (o, l) => l.productId,
    loc: (o) => o.locId,
  }[dim];
  const labelFn = {
    supplier: (k) => state.supply.suppliers.get(k)?.name ?? k,
    group: (k) => GROUP_BY_ID[k]?.label ?? k,
    kind: (k) => KINDS[k]?.label ?? k,
    product: (k) => state.supply.products.get(k)?.name ?? k,
    loc: (k) => locationName(k),
  }[dim];
  const hrefFn = {
    supplier: (k) => link('suppliers', k),
    product: (k) => link('catalog', null, { p: k }),
    kind: (k) => link('catalog', null, { kind: k }),
    group: (k) => link('analytics', null, { group: k }),
    loc: (k) => link('analytics', null, { loc: k }),
  }[dim];
  const now = sumBy(cur, keyFn, { group });
  const before = sumBy(prev, keyFn, { group });
  const qtyMap = new Map();
  const ordersMap = new Map();
  for (const o of cur) {
    const seen = new Set();
    for (const l of o.lines) {
      if (group && KINDS[l.kind].group !== group) continue;
      const k = keyFn(o, l);
      qtyMap.set(k, (qtyMap.get(k) ?? 0) + l.packs * state.supply.products.get(l.productId).pack);
      if (!seen.has(k)) { ordersMap.set(k, (ordersMap.get(k) ?? 0) + 1); seen.add(k); }
    }
  }
  const sum = [...now.values()].reduce((a, b) => a + b, 0);
  const rows = [...now.entries()].map(([key, value]) => ({ key, label: labelFn(key), value, prev: before.get(key) ?? 0, orders: ordersMap.get(key) ?? 0, qty: qtyMap.get(key) ?? 0 })).filter((r) => !q || r.label.toLowerCase().includes(q));
  const unitOf = (key) => (dim === 'kind' ? KINDS[key]?.unit : dim === 'product' ? state.supply.products.get(key)?.unit : null);

  return el('div', { class: 'stack-l' },
    el('div', { class: 'row-wrap', style: { gap: '10px' } },
      el('div', { class: 'seg-group' }, DIMENSIONS.map((d) => el('button', { class: 'seg', type: 'button', 'aria-pressed': String(d.value === dim), on: { click: () => setQuery({ by: d.value === 'supplier' ? null : d.value }) } }, d.label))),
      el('div', { style: { flex: '1 1 220px', maxWidth: '360px' } }, searchInput('Фильтр по названию', route.query.get('q') ?? '', debounce((v) => setQuery({ q: v || null }), 250))),
      button('Экспорт CSV', { iconName: 'download', onClick: () => downloadCsv(`zakrom-${dim}-${state.today}.csv`, [DIMENSIONS.find((d) => d.value === dim).label, 'Расходы', 'Доля', 'Прошлый период', 'Изменение', 'Заказов'], rows.map((r) => [r.label, String(Math.round(r.value)).replace('.', ','), pct(share(r.value, sum)), String(Math.round(r.prev)), r.prev ? pct(r.value / r.prev - 1, { sign: true }) : '', r.orders])) }),
    ),
    el('div', { class: 'tiles tiles-3' },
      kpi({ label: DIMENSIONS.find((d) => d.value === dim).label === 'Товар' ? 'Товаров' : `Значений: ${DIMENSIONS.find((d) => d.value === dim).label.toLowerCase()}`, value: num(rows.length) }),
      kpi({ label: 'Расходы', value: rubShort(sum) }),
      kpi({ label: 'Средний чек строки', value: rubShort(sum / Math.max(1, cur.reduce((s, o) => s + o.lines.length, 0))) }),
    ),
    card({
      flush: true,
      body: dataTable({
        columns: [
          { key: 'label', label: DIMENSIONS.find((d) => d.value === dim).label, render: (r) => el('a', { class: 'cell-title truncate', style: { display: 'block', maxWidth: '420px' }, href: hrefFn(r.key), text: r.label }), sort: (r) => r.label, defaultDir: 'asc' },
          unitOf(rows[0]?.key) ? { key: 'qty', label: 'Объём', align: 'right', render: (r) => `${num(r.qty, r.qty < 100 ? 1 : 0)} ${unitOf(r.key)}`, sort: (r) => r.qty } : null,
          { key: 'orders', label: 'Заказов', align: 'right', render: (r) => num(r.orders), sort: (r) => r.orders },
          { key: 'share', label: 'Доля', align: 'right', render: (r) => pct(share(r.value, sum)), sort: (r) => r.value },
          { key: 'delta', label: 'К прошлому периоду', align: 'right', render: (r) => (r.prev ? el('span', { class: r.value > r.prev * 1.1 ? 'warn' : '', text: pct(r.value / r.prev - 1, { sign: true }) }) : badge('новое', 'info')), sort: (r) => (r.prev ? r.value / r.prev : 99) },
          { key: 'value', label: 'Расходы', align: 'right', render: (r) => el('b', { class: 'num', text: rub(r.value) }), sort: (r) => r.value },
        ].filter(Boolean),
        rows,
        sortKey: 'value',
        sortDir: 'desc',
        limit: 200,
        onRow: (r) => go(hrefFn(r.key)),
      }),
    }),
  );
}

