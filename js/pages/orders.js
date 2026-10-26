// «Заказы»: весь путь заказа от согласования до оплаты, проблемы поставок и платёжный календарь
import { el, icon, debounce } from '../core/dom.js';
import { rub, rubShort, num, countOf, dayShort, dayHuman, dayFull, addDays, diffDays } from '../core/format.js';
import { state, orders, decideMany, locationName } from '../app/state.js';
import { payments, filterOrders } from '../model/analytics.js';
import { badge, button, card, kpi, dataTable, dropdown, searchInput, toast, empty, tabs, confirmDialog } from '../ui/components.js';
import { stackedBars } from '../ui/charts.js';
import { pageHead, readPeriod, readLoc, periodControl, locControl, statusBadge, issueBadges, supplierCell, downloadCsv } from './common.js';
import { setQuery, link, go } from '../app/router.js';

export const title = () => 'Заказы';

const OPEN = ['sent', 'confirmed', 'in_transit'];
const TABS = [
  { value: 'all', label: 'Все' },
  { value: 'approval', label: 'На согласовании', test: (o) => o.status === 'approval' },
  { value: 'open', label: 'В работе', test: (o) => OPEN.includes(o.status) },
  { value: 'arrived', label: 'Ждут приёмки', test: (o) => o.status === 'arrived' },
  { value: 'done', label: 'Принятые', test: (o) => o.status === 'delivered' || o.status === 'received' },
  { value: 'issues', label: 'С проблемами', test: (o) => o.late > 0 || o.issues.length > 0 },
  { value: 'payments', label: 'Оплаты' },
];

export function render(route) {
  const tab = TABS.some((t) => t.value === route.query.get('tab')) ? route.query.get('tab') : TABS.some((t) => t.value === route.query.get('status')) ? route.query.get('status') : 'all';
  const issue = route.query.get('issue');
  const activeTab = issue ? 'issues' : tab;
  const { period, range } = readPeriod(route, '30d');
  const locId = readLoc(route);
  const supplierId = state.supply.suppliers.has(route.query.get('supplier')) ? route.query.get('supplier') : null;
  const q = (route.query.get('q') ?? '').replace(/\D/g, '');
  const from = route.query.get('from') && /^\d{4}-\d{2}-\d{2}$/.test(route.query.get('from')) ? route.query.get('from') : null;
  const to = route.query.get('to') && /^\d{4}-\d{2}-\d{2}$/.test(route.query.get('to')) ? route.query.get('to') : null;

  const all = orders();
  if (route.query.get('export') === '1') {
    history.replaceState(null, '', location.hash.replace(/([?&])export=1&?/, '$1').replace(/[?&]$/, ''));
    queueMicrotask(() => exportOrders(all.filter((o) => o.createdDay >= range.from && o.createdDay <= range.to)));
  }

  // открытые заказы показываем всегда, остальные - за выбранный период
  const inPeriod = (o) => {
    if (from || to) return o.createdDay >= (from ?? '0000') && o.createdDay <= (to ?? '9999');
    return ['approval', 'arrived', ...OPEN].includes(o.status) || (o.createdDay >= range.from && o.createdDay <= range.to);
  };
  const base = all.filter((o) => inPeriod(o) && (!locId || o.locId === locId) && (!supplierId || o.supplierId === supplierId) && (!q || o.number.includes(q)));
  const counts = Object.fromEntries(TABS.map((t) => [t.value, t.test ? base.filter(t.test).length : base.length]));
  const def = TABS.find((t) => t.value === activeTab);
  let list = def?.test ? base.filter(def.test) : base;
  if (issue) list = list.filter((o) => o.issues.some((i) => i.type === issue) || (issue === 'late' && o.late));

  const head = pageHead('Заказы', 'Каждый заказ проходит согласование, подтверждение поставщика, приёмку с гашением ВСД и сверку УПД. Ничего не уходит реальным компаниям.', [
    button('Экспорт CSV', { iconName: 'download', onClick: () => exportOrders(list) }),
    el('a', { class: 'btn btn-primary', href: '#/catalog' }, icon('plus'), 'Новый заказ'),
  ]);

  const tabBar = tabs(TABS.map((t) => ({ value: t.value, label: t.label, count: t.value === 'payments' ? undefined : counts[t.value] || undefined })), activeTab, (v) => setQuery({ tab: v === 'all' ? null : v, status: null, issue: null }));

  if (activeTab === 'payments') return el('div', { class: 'stack-l' }, head, tabBar, paymentsView(all));

  const supplierOptions = [{ value: '', label: 'Все поставщики' }, ...[...new Set(all.map((o) => o.supplierId))].map((id) => state.supply.suppliers.get(id)).sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((s) => ({ value: s.id, label: s.name }))];
  const filters = el('div', { class: 'row-wrap', style: { gap: '10px' } },
    el('div', { style: { flex: '1 1 200px', maxWidth: '280px' } }, searchInput('Номер заказа', q, debounce((v) => setQuery({ q: v || null }), 300))),
    dropdown(supplierOptions, supplierId ?? '', (v) => setQuery({ supplier: v || null }), { iconName: 'suppliers' }),
    locControl(locId),
    from || to ? button(`${dayShort(from ?? to)}${to && to !== from ? ` - ${dayShort(to)}` : ''}`, { iconName: 'x', onClick: () => setQuery({ from: null, to: null }) }) : periodControl(period),
    issue ? button(`Проблема: ${issue === 'price' ? 'цена' : issue}`, { iconName: 'x', onClick: () => setQuery({ issue: null }) }) : null,
  );

  const approvalBar = activeTab === 'approval' && list.length
    ? el('div', { class: 'note note-warn', style: { alignItems: 'center' } }, icon('clock'), el('div', { style: { flex: '1' }, text: `${countOf(list.length, ['заказ', 'заказа', 'заказов'])} на ${rub(list.reduce((s, o) => s + o.total, 0))}. Лимит без согласования - ${rub(state.user.settings.approvalLimit ?? state.ws.approvalLimit)} на заказ.` }), button('Согласовать все', { variant: 'primary', size: 'sm', onClick: async () => {
      const ok = await confirmDialog({ title: 'Согласовать все заказы?', text: `${countOf(list.length, ['заказ уйдёт', 'заказа уйдут', 'заказов уйдут'])} поставщикам песочницы.`, confirm: 'Согласовать' });
      if (!ok) return;
      decideMany(list.map((o) => o.id), 'approved');
      toast('Заказы согласованы и отправлены');
    } }))
    : null;

  const table = dataTable({
    columns: [
      { key: 'number', label: 'Заказ', render: (o) => el('div', {}, el('div', { class: 'cell-title', text: `№ ${o.number}` }), el('div', { class: 'cell-sub', text: `${dayShort(o.createdDay)}${o.source === 'user' ? ' · вы' : ''}` })), sort: (o) => `${o.createdDay}${o.number}` },
      { key: 'supplier', label: 'Поставщик', render: (o) => supplierCell(state.supply.suppliers.get(o.supplierId), locationName(o.locId)), sort: (o) => state.supply.suppliers.get(o.supplierId).name, defaultDir: 'asc' },
      { key: 'lines', label: 'Позиции', align: 'right', cls: 'hide-sm', render: (o) => num(o.lines.length), sort: (o) => o.lines.length },
      { key: 'delivery', label: 'Доставка', render: (o) => deliveryCell(o), sort: (o) => o.deliveredDay ?? o.expectedDay },
      { key: 'docs', label: 'Документы', cls: 'hide-sm', render: (o) => docsCell(o) },
      { key: 'total', label: 'Сумма', align: 'right', render: (o) => el('span', { class: 'num', text: rub(o.status === 'delivered' || o.status === 'received' ? o.invoiceTotal : o.total) }), sort: (o) => o.total },
      { key: 'status', label: 'Статус', render: (o) => el('div', { class: 'row-wrap', style: { gap: '4px' } }, statusBadge(o.status), issueBadges(o).slice(0, 2)) },
    ],
    rows: list,
    sortKey: 'number',
    sortDir: 'desc',
    onRow: (o) => go(link('orders', o.id)),
    limit: 300,
    emptyText: activeTab === 'approval' ? 'Нечего согласовывать: все заказы в пределах лимита' : 'Заказов под фильтр нет',
  });

  return el('div', { class: 'stack-l' },
    head,
    tabBar,
    filters,
    approvalBar,
    card({ title: `${countOf(list.length, ['заказ', 'заказа', 'заказов'])} на ${rubShort(list.reduce((s, o) => s + o.total, 0))}`, sub: list.length > 300 ? 'Показаны последние 300' : null, flush: true, body: table }),
  );
}

function deliveryCell(o) {
  if (o.status === 'delivered' || o.status === 'received') return el('div', {}, el('div', { text: dayShort(o.deliveredDay) }), o.late ? el('div', { class: 'cell-sub warn', text: `позже на ${o.late} дн.` }) : el('div', { class: 'cell-sub', text: 'в срок' }));
  if (['approval', 'rejected', 'cancelled'].includes(o.status)) return el('span', { class: 'faint', text: '—' });
  if (o.status === 'arrived') return el('div', {}, el('div', { text: 'сегодня' }), el('div', { class: 'cell-sub', text: 'на рампе' }));
  return el('div', {}, el('div', { text: dayHuman(o.expectedDay, state.today) }), el('div', { class: 'cell-sub', text: o.expectedDay < state.today ? 'задерживается' : 'ожидаем' }));
}

const DOC_TONE = { signed: 'good', redeemed: 'good', accepted: 'good', pending: 'serious', issued: '', none: '' };

function docsCell(o) {
  const d = o.docs ?? {};
  const items = [];
  if (d.upd && d.upd !== 'none') items.push(badge('УПД', DOC_TONE[d.upd], { dot: true }));
  if (d.vsd) items.push(badge('ВСД', DOC_TONE[d.vsd], { dot: true }));
  if (d.marking) items.push(badge('ЧЗ', DOC_TONE[d.marking], { dot: true }));
  return items.length ? el('div', { class: 'row', style: { gap: '4px' } }, items) : el('span', { class: 'faint', text: '—' });
}

function paymentsView(all) {
  const pay = payments(all, state.today);
  const in7 = pay.upcoming.filter((o) => o.payment.dueDay <= addDays(state.today, 7));
  const days = [];
  for (let i = 0; i < 30; i += 1) days.push(addDays(state.today, i));
  const rows = days.map((d) => {
    const row = {};
    for (const o of pay.upcoming) if (o.payment.dueDay === d) {
      const s = state.supply.suppliers.get(o.supplierId);
      const key = s.type;
      row[key] = (row[key] ?? 0) + o.payment.amount;
    }
    return row;
  });
  const series = [
    { key: 'manufacturer', label: 'Производители', color: 'var(--s1)' },
    { key: 'producer', label: 'Производства', color: 'var(--s3)' },
    { key: 'distributor', label: 'Дистрибьюторы', color: 'var(--s2)' },
    { key: 'packaging', label: 'Упаковка', color: 'var(--s7)' },
  ];
  const month = filterOrders(all, { from: `${state.today.slice(0, 7)}-01`, to: state.today });
  const list = [...pay.overdue, ...pay.upcoming].slice(0, 40);
  return el('div', { class: 'stack-l' },
    el('div', { class: 'tiles tiles-4' },
      kpi({ label: 'Просрочено', value: rubShort(pay.overdueSum), meta: countOf(pay.overdue.length, ['счёт', 'счёта', 'счетов']) }),
      kpi({ label: 'К оплате за 7 дней', value: rubShort(in7.reduce((s, o) => s + o.payment.amount, 0)), meta: countOf(in7.length, ['счёт', 'счёта', 'счетов']) }),
      kpi({ label: 'Всего к оплате', value: rubShort(pay.upcomingSum), meta: 'по отсрочкам поставщиков' }),
      kpi({ label: 'Средняя отсрочка', value: `${num(avgTerm(month), 0)} дн.`, meta: 'взвешенно по сумме, текущий месяц', hint: 'Чем длиннее отсрочка, тем меньше своих денег заморожено в запасах' }),
    ),
    card({ title: 'Платёжный календарь', sub: 'Следующие 30 дней: когда наступают сроки оплаты по отсрочкам', body: el('div', { class: 'stack' }, stackedBars({ labels: days, series, rows, height: 220, xLabel: dayShort, title: (d) => dayHuman(d, state.today) }), el('div', { class: 'legend' }, series.map((s) => el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: { background: s.color } }), s.label)))) }),
    card({
      title: 'Счета к оплате',
      flush: true,
      body: list.length ? dataTable({
        columns: [
          { key: 'due', label: 'Срок', render: (o) => el('div', {}, el('div', { class: o.payment.dueDay < state.today ? 'bad' : '', text: dayHuman(o.payment.dueDay, state.today) }), el('div', { class: 'cell-sub', text: o.payment.dueDay < state.today ? `просрочено на ${diffDays(state.today, o.payment.dueDay)} дн.` : dayFull(o.payment.dueDay) })), sort: (o) => o.payment.dueDay, defaultDir: 'asc' },
          { key: 'supplier', label: 'Поставщик', render: (o) => supplierCell(state.supply.suppliers.get(o.supplierId), `№ ${o.number} · ${locationName(o.locId)}`) },
          { key: 'sum', label: 'Сумма', align: 'right', render: (o) => el('span', { class: 'num', text: rub(o.payment.amount) }), sort: (o) => o.payment.amount },
        ],
        rows: list,
        sortKey: 'due',
        sortDir: 'asc',
        onRow: (o) => go(link('orders', o.id)),
      }) : empty('Счетов к оплате нет', '', null, 'check'),
    }),
  );
}

function avgTerm(list) {
  let sum = 0;
  let weight = 0;
  for (const o of list) {
    const s = state.supply.suppliers.get(o.supplierId);
    sum += s.terms.paymentDays * o.total;
    weight += o.total;
  }
  return weight ? sum / weight : 0;
}

function exportOrders(list) {
  downloadCsv(`zakrom-orders-${state.wsId}-${state.today}.csv`, ['Заказ', 'Создан', 'Точка', 'Поставщик', 'Позиций', 'Сумма заказа', 'Сумма по УПД', 'Ожидали', 'Привезли', 'Опоздание, дн.', 'Статус', 'Срок оплаты', 'Оплачен'], list.map((o) => [
    o.number, o.createdDay, locationName(o.locId), state.supply.suppliers.get(o.supplierId).name, o.lines.length, String(o.total).replace('.', ','), String(o.invoiceTotal ?? '').replace('.', ','), o.expectedDay, o.deliveredDay ?? '', o.late ?? 0, o.status, o.payment?.dueDay ?? '', o.payment?.paidDay ?? '',
  ]));
  toast('CSV с заказами скачан');
}

