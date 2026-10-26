// «Тендеры»: запрос цен у нескольких поставщиков, ответы и сравнение по полной стоимости
// ответы присылает песочница: цена строится от прайса поставщика со скидкой за объём, срок ответа - минуты
import { el } from '../core/dom.js';
import { rub, rubShort, pct, num, countOf, dayShort, dayFull, relTime, addDays, qty } from '../core/format.js';
import { state, saveRfq, createOrder } from '../app/state.js';
import { avgUse } from '../app/derive.js';
import { KINDS, GROUP_BY_ID } from '../model/kinds.js';
import { between, unit } from '../core/rng.js';
import { badge, button, card, kpi, chip, empty, openModal, toast, logoTile, field, input, select, sandboxNote, note, dataTable } from '../ui/components.js';
import { pageHead, backLink } from './common.js';
import { setQuery, link, go } from '../app/router.js';

export const title = (route) => (route.id ? 'Тендер' : 'Тендеры');

// стоимость денег для сравнения отсрочек: 16% годовых, около ключевой ставки
const MONEY_RATE = 0.16;
let refreshTimer = null;

// таймер обновления ответов не должен пережить уход со страницы
window.addEventListener('hashchange', () => clearTimeout(refreshTimer));

let newPanel = null;
export function syncOverlay(route) {
  const requested = route.section === 'rfq' && route.query.get('new') === '1';
  if (requested && !newPanel) newRfqDialog(route);
  else if (!requested && newPanel) { const panel = newPanel; newPanel = null; panel.close(); }
}

export function render(route) {
  clearTimeout(refreshTimer);
  if (route.id) return detail(route.id);
  const list = [...state.user.rfqs].sort((a, b) => b.createdAt - a.createdAt);
  const examples = exampleRfqs();
  const all = [...list, ...examples];
  const savings = all.filter((r) => r.awardedTo).map((r) => evaluate(r)).filter((e) => e.best && e.median);
  const saved = savings.reduce((s, e) => s + (e.median - e.winner.total), 0);

  const head = pageHead('Тендеры', 'Запросите цены у нескольких поставщиков сразу и выберите лучшее предложение по полной стоимости: цена, отсрочка и срок доставки в одной цифре.', [
    button('Новый тендер', { variant: 'primary', iconName: 'plus', onClick: () => setQuery({ new: 1 }) }),
  ]);
  const tiles = el('div', { class: 'tiles tiles-3' },
    kpi({ label: 'Тендеров', value: num(all.length), meta: `${countOf(list.filter((r) => !r.awardedTo).length, ['идёт', 'идут', 'идут'])} сейчас` }),
    kpi({ label: 'Экономия к медиане', value: rubShort(saved), meta: 'за месяц объёма, по выбранным победителям', hint: 'Разница между медианным предложением и выбранным: сколько бы переплатили, выбрав «среднего» поставщика' }),
    kpi({ label: 'Ответов в среднем', value: savings.length ? num(savings.reduce((s, e) => s + e.responded, 0) / savings.length, 1) : '—', meta: 'поставщиков на тендер' }),
  );
  const rows = all.map((r) => ({ r, e: evaluate(r) }));
  const table = rows.length ? dataTable({
    columns: [
      { key: 'title', label: 'Тендер', render: ({ r }) => el('div', {}, el('div', { class: 'row', style: { gap: '8px' } }, el('span', { class: 'cell-title', text: r.title }), r.example ? badge('пример', 'outline') : null), el('div', { class: 'cell-sub', text: `№ ${r.number} · ${dayShort(r.createdDay)} · ${countOf(r.items.length, ['позиция', 'позиции', 'позиций'])}` })), sort: ({ r }) => r.createdAt },
      { key: 'resp', label: 'Ответы', align: 'right', render: ({ e }) => `${e.responded} из ${e.invited}`, sort: ({ e }) => e.responded },
      { key: 'best', label: 'Лучшее предложение', render: ({ e }) => (e.best ? el('div', {}, el('div', { class: 'truncate', style: { maxWidth: '220px' }, text: e.best.s.name }), el('div', { class: 'cell-sub', text: rub(e.best.total) })) : el('span', { class: 'faint', text: 'ждём ответов' })) },
      { key: 'status', label: 'Статус', render: ({ r, e }) => (r.awardedTo ? badge('Победитель выбран', 'good', { dot: true }) : e.pending ? badge(`Идёт сбор · ${e.pending} ждём`, 'info', { dot: true }) : badge('Можно выбирать', 'serious', { dot: true })) },
    ],
    rows,
    sortKey: 'title',
    sortDir: 'desc',
    onRow: ({ r }) => go(link('rfq', r.id)),
  }) : null;
  if (list.some((r) => !r.awardedTo && evaluate(r).pending)) refreshTimer = setTimeout(() => window.dispatchEvent(new Event('zakrom:render')), 10000);
  return el('div', { class: 'stack-l' }, head, tiles, card({ title: 'Все тендеры', flush: true, body: table ?? empty('Тендеров пока нет', 'Начните с позиции, которая заметно подорожала', button('Новый тендер', { onClick: () => setQuery({ new: 1 }) })) }), sandboxNote('Приглашения в тендер не уходят реальным компаниям: ответы присылает песочница через 0,5-3 минуты, цены - от прайса поставщика со скидкой за объём.'));
}

// ---------- модель ответа ----------

function monthlyNeed(kind) {
  let sum = 0;
  for (const loc of state.ws.locations) sum += avgUse(loc.id, kind);
  return sum * 30;
}

function supplierQuote(rfq, supplierId) {
  const s = state.supply.suppliers.get(supplierId);
  const h = (k) => `${rfq.id}|${supplierId}|${k}`;
  const arrivesAt = rfq.createdAt + between(h('delay'), 25000, 170000);
  if (unit(h('decline')) < 0.14) return { s, arrivesAt, declined: true, reason: unit(h('why')) < 0.5 ? 'не набирается объём под их логистику' : 'не возят в эти точки по графику' };
  const lines = rfq.items.map((item) => {
    const offers = (state.supply.offersBySupplier.get(supplierId) ?? []).filter((o) => o.kind === item.kind);
    if (!offers.length) return { item, missing: true };
    let best = null;
    for (const o of offers) {
      const unitPrice = state.supply.unitPriceAt(o, state.today);
      if (!best || unitPrice < best.unitPrice) best = { offer: o, unitPrice };
    }
    const product = state.supply.products.get(best.offer.productId);
    const discount = between(h(`d|${item.kind}`), 0.9, 0.995);
    const price = Math.round(state.supply.priceAt(best.offer, state.today) * discount * 100) / 100;
    const packs = Math.max(1, Math.ceil(item.qty / product.pack));
    return { item, product, price, packs, sum: price * packs, discount };
  });
  const quoted = lines.filter((l) => !l.missing);
  const total = quoted.reduce((sum, l) => sum + l.sum, 0);
  const paymentDays = s.terms.paymentDays + (unit(h('pay')) < 0.35 ? 7 : 0);
  // отсрочка - это бесплатный кредит: деньги остаются в обороте на paymentDays дней
  const effective = total * (1 - (MONEY_RATE * paymentDays) / 365);
  return { s, arrivesAt, lines, quoted: quoted.length, total, paymentDays, leadDays: s.terms.leadDays, effective, validTo: addDays(rfq.createdDay, 30) };
}

function evaluate(rfq) {
  const now = Date.now();
  const quotes = rfq.supplierIds.map((id) => supplierQuote(rfq, id)).filter((q) => q.s);
  const arrived = quotes.filter((q) => rfq.example || q.arrivesAt <= now);
  const valid = arrived.filter((q) => !q.declined && q.quoted === rfq.items.length);
  const ranked = valid.slice().sort((a, b) => a.effective - b.effective);
  const sorted = valid.map((q) => q.total).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const winner = rfq.awardedTo ? quotes.find((q) => q.s.id === rfq.awardedTo) : null;
  return { quotes, arrived, ranked, best: ranked[0] ?? null, median, winner, invited: quotes.length, responded: arrived.length, pending: quotes.length - arrived.length };
}

// пара прошлых тендеров для наглядности: строятся из тех же данных и помечены «пример»
function exampleRfqs() {
  const used = new Set();
  for (const a of state.sim.assignments.values()) for (const k of a.keys()) used.add(k);
  const pickKinds = (group, n) => [...used].filter((k) => KINDS[k].group === group).sort((a, b) => monthlyNeed(b) * KINDS[b].price - monthlyNeed(a) * KINDS[a].price).slice(0, n);
  const make = (id, titleText, kinds, daysAgo) => {
    if (!kinds.length) return null;
    const items = kinds.map((kind) => ({ kind, name: KINDS[kind].label, qty: Math.round(monthlyNeed(kind)) }));
    const suppliers = [...new Set(kinds.flatMap((k) => (state.supply.offersByKind.get(k) ?? []).map((o) => o.supplierId)))].filter((sid) => kinds.every((k) => (state.supply.offersBySupplier.get(sid) ?? []).some((o) => o.kind === k))).slice(0, 6);
    if (suppliers.length < 2) return null;
    const day = addDays(state.today, -daysAgo);
    const rfq = { id: `ex-${state.wsId}-${id}`, number: String(700 + daysAgo), title: titleText, createdDay: day, createdAt: Date.parse(`${day}T10:00:00`), deadlineDay: addDays(day, 3), items, supplierIds: suppliers, example: true, awardedTo: null };
    const e = evaluate(rfq);
    rfq.awardedTo = e.best?.s.id ?? null;
    return rfq;
  };
  return [
    make('dairy', 'Молочка на квартал', pickKinds('dairy', 3), 24),
    make('pack', 'Упаковка и расходники', pickKinds('packaging', 4), 51),
  ].filter(Boolean);
}

// ---------- карточка тендера ----------

function detail(id) {
  const rfq = state.user.rfqs.find((r) => r.id === id) ?? exampleRfqs().find((r) => r.id === id);
  if (!rfq) return el('div', {}, backLink('#/rfq', 'Тендеры'), empty('Тендер не найден'));
  const e = evaluate(rfq);
  if (!rfq.example && e.pending && !rfq.awardedTo) refreshTimer = setTimeout(() => window.dispatchEvent(new Event('zakrom:render')), 8000);
  const head = el('header', { class: 'page-head' },
    el('div', {}, el('div', { class: 'row-wrap', style: { gap: '10px' } }, el('h1', { class: 'page-title', text: rfq.title }), rfq.example ? badge('пример', 'outline') : null, rfq.awardedTo ? badge('Победитель выбран', 'good', { dot: true }) : null), el('p', { class: 'page-sub', text: `№ ${rfq.number} · создан ${dayFull(rfq.createdDay)} · приём предложений до ${dayFull(rfq.deadlineDay)}` })),
  );
  const tiles = el('div', { class: 'tiles tiles-4' },
    kpi({ label: 'Приглашено', value: num(e.invited), meta: e.pending ? `ждём ${e.pending}` : 'все ответили' }),
    kpi({ label: 'Полных предложений', value: num(e.ranked.length), meta: 'по всем позициям' }),
    kpi({ label: 'Лучшее', value: e.best ? rubShort(e.best.total) : '—', meta: e.best ? e.best.s.name : 'ждём ответов' }),
    kpi({ label: 'Разброс цен', value: e.ranked.length > 1 ? pct(e.ranked.at(-1).total / e.ranked[0].total - 1, { digits: 0 }) : '—', meta: 'между лучшим и худшим' }),
  );
  const items = card({
    title: 'Что запрашиваем',
    sub: 'Объём - месячная потребность всех точек по техкартам',
    flush: true,
    body: el('div', { class: 'list' }, rfq.items.map((i) => el('div', { class: 'list-item' }, el('span', { class: 'swatch', style: { background: GROUP_BY_ID[KINDS[i.kind].group].color } }), el('span', { style: { flex: '1' }, text: i.name }), el('span', { class: 'num muted', text: qty(i.qty, KINDS[i.kind].unit) })))),
  });

  const order = [...e.quotes].sort((a, b) => {
    const ra = e.ranked.indexOf(a);
    const rb = e.ranked.indexOf(b);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });
  const offers = card({
    title: 'Предложения',
    sub: `Полная стоимость = сумма минус выгода отсрочки (деньги стоят ${pct(MONEY_RATE, { digits: 0 })} годовых)`,
    flush: true,
    body: el('div', { class: 'list' }, order.map((q) => quoteRow(rfq, e, q))),
  });
  return el('div', { class: 'stack-l' }, backLink('#/rfq', 'Тендеры'), head, tiles, el('div', { class: 'grid-main-r' }, offers, el('div', { class: 'stack-l' }, items, rfq.example ? note('Это пример прошлого тендера: на нём видно, как сравниваются предложения. Свой тендер запускается кнопкой «Новый тендер».', { iconName: 'info' }) : sandboxNote('Ответы присылает песочница. Реальным компаниям приглашение не уходит.'))));
}

function quoteRow(rfq, e, q) {
  const waiting = !rfq.example && q.arrivesAt > Date.now();
  const rank = e.ranked.indexOf(q);
  const isWinner = rfq.awardedTo === q.s.id;
  const left = el('div', { class: 'cell-main', style: { flex: '1', minWidth: '0' } }, logoTile(q.s), el('div', { style: { minWidth: '0' } }, el('a', { class: 'cell-title truncate', style: { display: 'block' }, href: link('suppliers', q.s.id), text: q.s.name }), el('div', { class: 'cell-sub', text: waiting ? `ответит ${relTime(q.arrivesAt)}` : q.declined ? `отказался: ${q.reason}` : `${q.quoted} из ${rfq.items.length} поз. · отсрочка ${q.paymentDays} дн. · доставка ${q.leadDays === 1 ? 'назавтра' : `за ${q.leadDays} дн.`}` })));
  if (waiting) return el('div', { class: 'list-item' }, left, badge('ждём ответ', 'info', { dot: true }));
  if (q.declined) return el('div', { class: 'list-item' }, left, badge('не участвует', ''));
  const complete = q.quoted === rfq.items.length;
  const right = el('div', { style: { textAlign: 'right' } }, el('div', { class: 'num', style: { fontWeight: '600' }, text: rub(q.total) }), el('div', { class: 'cell-sub', text: complete ? `полная ${rub(q.effective)}` : 'не все позиции' }));
  const action = rfq.awardedTo
    ? isWinner ? el('div', { class: 'row', style: { gap: '6px' } }, badge('Победитель', 'good'), rfq.example ? null : button('Заказать', { size: 'sm', iconName: 'cart', onClick: () => orderFromRfq(rfq, q) })) : null
    : complete && !rfq.example ? button('Выбрать', { size: 'sm', variant: rank === 0 ? 'primary' : '', onClick: () => { rfq.awardedTo = q.s.id; saveRfq(rfq); toast(`Победитель: ${q.s.name}`); } }) : null;
  return el('div', { class: 'list-item' }, left, rank === 0 ? badge('лучшее', 'accent') : null, right, action);
}

function orderFromRfq(rfq, q) {
  const locs = state.ws.locations;
  let locId = locs[0].id;
  const { close } = openModal({
    title: 'Заказ по цене тендера',
    sub: `${q.s.name} · недельный объём для точки`,
    body: [field('Точка', select(locs.map((l) => ({ value: l.id, label: `${l.name}${locs.length > 1 ? `, ${l.city}` : ''}` })), locId, (v) => { locId = v; }))],
    foot: [button('Создать заказ', { variant: 'primary', onClick: () => {
      const lines = q.lines.filter((l) => !l.missing).map((l) => ({ productId: l.product.id, price: l.price, packs: Math.max(1, Math.ceil((avgUse(locId, l.item.kind) * 7) / l.product.pack)) }));
      const order = createOrder({ supplierId: q.s.id, locId, lines, comment: `По тендеру № ${rfq.number}` });
      close();
      toast(order.needsApproval ? 'Заказ создан и ждёт согласования' : 'Заказ отправлен поставщику');
      go(link('orders', order.id));
    } })],
  });
}

// ---------- новый тендер ----------

function newRfqDialog(route) {
  if (document.querySelector('dialog[data-rfq]')) return;
  const used = new Set();
  for (const a of state.sim.assignments.values()) for (const k of a.keys()) used.add(k);
  const preProduct = state.supply.products.get(route.query.get('product'));
  const preSupplier = state.supply.suppliers.get(route.query.get('supplier'));
  const kinds = [...used].sort((a, b) => KINDS[a].group.localeCompare(KINDS[b].group) || KINDS[a].label.localeCompare(KINDS[b].label, 'ru'));
  const selected = new Set(preProduct ? [preProduct.kind] : preSupplier ? kinds.filter((k) => preSupplier.groups.includes(KINDS[k].group)).slice(0, 3) : []);
  const chosen = new Set(preSupplier ? [preSupplier.id] : []);
  const titleInput = input({ value: preProduct ? `${preProduct.spec.label}: цена на квартал` : route.query.get('item') ? `Запрос: ${route.query.get('item')}` : '', placeholder: 'Например, «Молочка на квартал»', 'aria-label': 'Название тендера' });
  const kindsBox = el('div', { class: 'row-wrap' });
  const suppliersBox = el('div', { class: 'list' });
  const error = el('p', { class: 'field-error' });
  const drawKinds = () => kindsBox.replaceChildren(...kinds.map((k) => chip(KINDS[k].label, selected.has(k), () => { selected.has(k) ? selected.delete(k) : selected.add(k); drawKinds(); drawSuppliers(); }, { swatch: GROUP_BY_ID[KINDS[k].group].color })));
  const drawSuppliers = () => {
    const candidates = [...state.supply.suppliers.values()].filter((s) => [...selected].some((k) => (state.supply.offersBySupplier.get(s.id) ?? []).some((o) => o.kind === k)));
    for (const id of chosen) if (!candidates.some((s) => s.id === id)) chosen.delete(id);
    candidates.sort((a, b) => coverage(b) - coverage(a) || a.name.localeCompare(b.name, 'ru'));
    function coverage(s) { return [...selected].filter((k) => (state.supply.offersBySupplier.get(s.id) ?? []).some((o) => o.kind === k)).length; }
    if (!chosen.size) candidates.filter((s) => coverage(s) === selected.size).slice(0, 5).forEach((s) => chosen.add(s.id));
    suppliersBox.replaceChildren(...(candidates.length ? candidates.slice(0, 12).map((s) => {
      const box = el('input', { type: 'checkbox', checked: chosen.has(s.id) ? true : null, 'aria-label': s.name });
      box.addEventListener('change', () => { box.checked ? chosen.add(s.id) : chosen.delete(s.id); });
      return el('label', { class: 'list-item', style: { cursor: 'pointer', padding: '8px 0' } }, box, logoTile(s), el('div', { style: { flex: '1', minWidth: '0' } }, el('div', { class: 'cell-title truncate', text: s.name }), el('div', { class: 'cell-sub', text: `${s.typeLabel}${s.city ? ` · ${s.city}` : ''} · ${coverage(s)} из ${selected.size} поз.` })));
    }) : [el('p', { class: 'faint', text: 'Выберите позиции - покажем, кто их возит' })]));
  };
  drawKinds();
  drawSuppliers();
  const { dialog, close } = openModal({
    title: 'Новый тендер',
    sub: 'Объём посчитаем по техкартам и продажам всех точек на месяц',
    wide: true,
    body: [field('Название', titleInput), field('Позиции', kindsBox, { hint: 'То, что расходуют ваши точки' }), field('Кого пригласить', suppliersBox, { hint: 'Сверху - кто возит все выбранные позиции' }), error],
    foot: [button('Отмена', { variant: 'ghost', onClick: () => close() }), button('Разослать приглашения', { variant: 'primary', iconName: 'arrow-right', onClick: () => {
      if (!selected.size) { error.textContent = 'Выберите хотя бы одну позицию'; return; }
      if (chosen.size < 2) { error.textContent = 'Пригласите хотя бы двух поставщиков: иначе сравнивать не с кем'; return; }
      const rfq = {
        id: `rfq-${state.wsId}-${Date.now().toString(36)}`,
        number: String(800 + state.user.rfqs.length + 1),
        title: titleInput.value.trim().slice(0, 120) || `Тендер от ${dayShort(state.today)}`,
        createdDay: state.today,
        createdAt: Date.now(),
        deadlineDay: addDays(state.today, 2),
        items: [...selected].map((kind) => ({ kind, name: KINDS[kind].label, qty: Math.max(1, Math.round(monthlyNeed(kind))) })),
        supplierIds: [...chosen].slice(0, 12),
        awardedTo: null,
      };
      saveRfq(rfq);
      close();
      toast(`Приглашения ушли ${countOf(rfq.supplierIds.length, ['поставщику', 'поставщикам', 'поставщикам'])}`);
      go(link('rfq', rfq.id));
    } })],
    onClose: () => {
      if (newPanel?.dialog !== dialog) return;
      newPanel = null;
      if (location.hash.startsWith('#/rfq')) setQuery({ new: null, product: null, supplier: null, item: null });
    },
  });
  newPanel = { dialog, close };
  dialog.dataset.rfq = '1';
  if (route.query.get('item') && !preProduct) error.textContent = '';
  setTimeout(() => titleInput.focus(), 50);
}

