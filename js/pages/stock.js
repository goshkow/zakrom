// «Склад и автозаказ»: запас в днях по каждой позиции точки и готовая заявка до следующей поставки
import { el } from '../core/dom.js';
import { rub, rubShort, num, qty, countOf } from '../core/format.js';
import { state, cartAdd, cartAddMany, cartSet, locationName } from '../app/state.js';
import { stockRows } from '../app/derive.js';
import { GROUP_BY_ID } from '../model/kinds.js';
import { badge, button, card, kpi, chip, dataTable, dropdown, meter, toast, sandboxNote } from '../ui/components.js';
import { pageHead } from './common.js';
import { setQuery, link } from '../app/router.js';
import { openCart } from '../app/panels.js';

export const title = () => 'Склад';

const FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'critical', label: 'Заканчивается' },
  { value: 'low', label: 'Пора заказать' },
  { value: 'ok', label: 'В норме' },
];

export function render(route) {
  const locs = state.ws.locations;
  const locId = locs.some((l) => l.id === route.query.get('loc')) ? route.query.get('loc') : locs[0].id;
  const filter = FILTERS.some((f) => f.value === route.query.get('filter')) ? route.query.get('filter') : 'all';
  const rows = stockRows(locId);
  const unitPrice = (r) => {
    const offer = state.supply.offersByProduct.get(r.product.id)?.find((o) => o.supplierId === r.supplier.id);
    return offer ? state.supply.unitPriceAt(offer, state.today) : 0;
  };
  const value = rows.reduce((s, r) => s + r.level * unitPrice(r), 0);
  const incoming = rows.reduce((s, r) => s + r.incoming * unitPrice(r), 0);
  const critical = rows.filter((r) => r.status === 'critical');
  const low = rows.filter((r) => r.status === 'low');
  const todo = rows.filter((r) => r.packs > 0);
  const todoSum = todo.reduce((s, r) => s + r.packs * r.product.pack * unitPrice(r), 0);
  const useValue = rows.reduce((s, r) => s + r.use * unitPrice(r), 0);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  const autoOrder = () => {
    if (!todo.length) return;
    // повторное нажатие не удваивает: уже лежащие в корзине позиции приводим к рассчитанному количеству
    try {
      for (const r of todo) {
        const index = state.user.cart.findIndex((c) => c.productId === r.product.id && c.supplierId === r.supplier.id && c.locId === locId);
        if (index >= 0) cartSet(index, r.packs);
        else cartAddMany([{ productId: r.product.id, supplierId: r.supplier.id, packs: r.packs, locId }]);
      }
    } catch (error) { toast(error.message, { error: true }); return; }
    toast(`В корзине ${countOf(todo.length, ['позиция', 'позиции', 'позиций'])} на ${rubShort(todoSum)}`);
    openCart();
  };

  const head = pageHead('Склад и автозаказ', 'Остаток считается из продаж по техкартам и принятых поставок. Автозаказ добирает запас до следующей поставки плюс страховые дни.', [
    locs.length > 1 ? dropdown(locs.map((l) => ({ value: l.id, label: l.name, sub: l.city })), locId, (v) => setQuery({ loc: v }), { iconName: 'pin' }) : null,
    button(todo.length ? `Собрать автозаказ · ${rubShort(todoSum)}` : 'Заказывать нечего', { variant: 'primary', iconName: 'flash', disabled: !todo.length, onClick: autoOrder }),
  ]);

  const tiles = el('div', { class: 'tiles tiles-5' },
    kpi({ label: 'Заканчивается', value: num(critical.length), meta: 'запаса меньше, чем до поставки' }),
    kpi({ label: 'Пора заказать', value: num(low.length), meta: 'ниже страхового запаса' }),
    kpi({ label: 'Запас на складе', value: rubShort(value), meta: useValue ? `на ${num(value / useValue, 1)} дн. работы` : '' }),
    kpi({ label: 'Едет', value: rubShort(incoming), meta: 'в подтверждённых заказах' }),
    kpi({ label: 'Расход в день', value: rubShort(useValue), meta: 'по продажам за 14 дней' }),
  );

  const table = dataTable({
    columns: [
      { key: 'kind', label: 'Позиция', render: (r) => el('div', {}, el('div', { class: 'row', style: { gap: '8px' } }, el('span', { class: 'swatch', style: { background: GROUP_BY_ID[r.spec.group].color } }), el('span', { class: 'cell-title', text: r.spec.label })), el('a', { class: 'cell-sub clamp-2', style: { maxWidth: '320px', marginLeft: '17px' }, href: link('catalog', null, { p: r.product.id }), text: r.product.name })), sort: (r) => r.spec.label, defaultDir: 'asc' },
      { key: 'level', label: 'Остаток', align: 'right', render: (r) => qty(round(r.level), r.spec.unit), sort: (r) => r.level },
      { key: 'use', label: 'Расход в день', align: 'right', cls: 'hide-sm', render: (r) => qty(round(r.use), r.spec.unit), sort: (r) => r.use },
      { key: 'cover', label: 'Хватит на', render: (r) => coverCell(r), sort: (r) => r.cover, defaultDir: 'asc' },
      { key: 'incoming', label: 'Едет', align: 'right', cls: 'hide-sm', render: (r) => (r.incoming > 0 ? qty(round(r.incoming), r.spec.unit) : el('span', { class: 'faint', text: '—' })), sort: (r) => r.incoming },
      { key: 'supplier', label: 'Поставщик', cls: 'hide-sm', render: (r) => el('a', { href: link('suppliers', r.supplier.id) }, el('div', { class: 'clamp-2', style: { maxWidth: '200px' }, text: r.supplier.name }), el('div', { class: 'cell-sub', text: r.lead === 1 ? 'привозит назавтра' : `срок ${r.lead} дн.` })) },
      { key: 'packs', label: 'Заказать', align: 'right', render: (r) => (r.packs > 0
        ? el('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } }, el('div', {}, el('div', { class: 'num', text: `${num(r.packs)} уп.` }), el('div', { class: 'cell-sub', text: rub(r.packs * r.product.pack * unitPrice(r)) })), button('', { size: 'sm', iconName: 'cart', ariaLabel: `В корзину: ${r.spec.label}`, onClick: () => { try { cartAdd(r.product.id, r.supplier.id, r.packs, locId); toast(`${r.spec.label}: ${r.packs} уп. в корзине`); } catch (error) { toast(error.message, { error: true }); } } }))
        : el('span', { class: 'faint', text: 'хватает' })), sort: (r) => r.packs },
    ],
    rows: shown,
    sortKey: 'cover',
    sortDir: 'asc',
    emptyText: 'Таких позиций нет',
  });

  return el('div', { class: 'stack-l' },
    head,
    tiles,
    el('div', { class: 'row-wrap' }, FILTERS.map((f) => chip(f.label, filter === f.value, () => setQuery({ filter: f.value === 'all' ? null : f.value }), { count: f.value === 'all' ? rows.length : rows.filter((r) => r.status === f.value).length }))),
    card({ title: `${locationName(locId)} · ${countOf(rows.length, ['позиция', 'позиции', 'позиций'])}`, sub: 'Отсортировано по запасу: сверху то, что кончится раньше', flush: true, body: table }),
    sandboxNote('В рабочей версии остатки приходят из iiko, r_keeper или 1С, а расход - из продаж кассы. В песочнице продажи смоделированы, а техкарты - на странице «Техкарты».'),
  );
}

function round(v) {
  if (v >= 100) return Math.round(v);
  if (v >= 10) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}

function coverCell(r) {
  const days = r.cover;
  const tone = r.status === 'critical' ? 'bad' : r.status === 'low' ? 'warn' : 'ok';
  const text = !Number.isFinite(days) ? 'не расходуется' : days < 1 ? 'меньше дня' : `${num(Math.floor(days))} дн.`;
  return el('div', { style: { minWidth: '120px' } }, el('div', { class: 'row', style: { gap: '6px' } }, el('span', { text }), r.status === 'critical' ? badge('мало', 'bad') : null), el('div', { style: { marginTop: '5px' } }, meter(Math.min(1, (Number.isFinite(days) ? days : 14) / 14), { tone })));
}

