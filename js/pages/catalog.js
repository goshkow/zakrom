// «Каталог»: настоящие товары (Open Food Facts) и типовые позиции, предложения поставщиков с ценами песочницы
import { el, icon, debounce } from '../core/dom.js';
import { rub, num, pct, countOf, monthAxis, monthLabel, addDays } from '../core/format.js';
import { state, orders, cartAdd, cartSet, onChange, locationName } from '../app/state.js';
import { GROUPS, GROUP_BY_ID, KINDS, COMMODITY_LABELS } from '../model/kinds.js';
import { button, badge, card, chip, empty, openDrawer, openModal, toast, qtyStepper, productThumb, logoTile, searchInput, dropdown, select, field, note } from '../ui/components.js';
import { lineChart } from '../ui/charts.js';
import { animate } from '../ui/motion.js';
import { pageHead, packLabel } from './common.js';
import { setQuery, link, go } from '../app/router.js';
import { lookupBarcode, isValidGtin } from '../core/off.js';
import { shiftMonth } from '../model/market.js';
import { openCart } from '../app/panels.js';
import { supplierScore } from '../model/analytics.js';

export const title = () => 'Каталог';

const SORTS = [
  { value: 'popular', label: 'Сначала то, что расходуем' },
  { value: 'cheap', label: 'Дешевле за кг, л, шт' },
  { value: 'expensive', label: 'Дороже за кг, л, шт' },
  { value: 'name', label: 'По названию' },
];

let openId = null;
let productPanel = null;

export function syncOverlay(route) {
  const id = route.section === 'catalog' ? route.query.get('p') : null;
  if (id === openId) return;
  const previous = productPanel;
  openId = null;
  productPanel = null;
  previous?.close();
  if (id && state.supply.products.has(id)) productDrawer(id);
}

function assignedSet() {
  const set = new Set();
  for (const a of state.sim.assignments.values()) for (const x of a.values()) set.add(x.productId);
  return set;
}

export function bestFor(productId, day = state.today) {
  const offers = state.supply.offersByProduct.get(productId) ?? [];
  let best = null;
  for (const offer of offers) {
    const price = state.supply.priceAt(offer, day);
    if (!best || price < best.price) best = { offer, price };
  }
  return best;
}

export function render(route) {
  const q = route.query.get('q') ?? '';
  const group = GROUP_BY_ID[route.query.get('group')] ? route.query.get('group') : null;
  const kind = KINDS[route.query.get('kind')] ? route.query.get('kind') : null;
  const sort = SORTS.some((s) => s.value === route.query.get('sort')) ? route.query.get('sort') : 'popular';
  const onlyUsed = route.query.get('used') === '1';
  const assigned = assignedSet();
  const usedKinds = new Set([...state.sim.assignments.values()].flatMap((m) => [...m.keys()]));

  const all = [...state.supply.products.values()].filter((p) => (state.supply.offersByProduct.get(p.id) ?? []).length);
  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
  const query = norm(q).trim();
  const list = all.filter((p) => {
    if (group && p.group !== group) return false;
    if (kind && p.kind !== kind) return false;
    if (onlyUsed && !usedKinds.has(p.kind)) return false;
    if (query && !norm(`${p.name} ${p.brand ?? ''} ${p.barcode ?? ''} ${p.spec.label}`).includes(query)) return false;
    return true;
  });
  const priced = list.map((p) => {
    const best = bestFor(p.id);
    return { p, best, unit: best ? best.price / p.pack : Infinity, offers: (state.supply.offersByProduct.get(p.id) ?? []).length };
  });
  priced.sort((a, b) => {
    if (sort === 'cheap') return a.unit - b.unit;
    if (sort === 'expensive') return b.unit - a.unit;
    if (sort === 'name') return a.p.name.localeCompare(b.p.name, 'ru');
    // сначала виды, которые расходуем, внутри - товары с фото и штрихкодом, потом типовые позиции
    const rank = (x) => (usedKinds.has(x.p.kind) ? 0 : 4) + (x.p.image ? 0 : 2) + (assigned.has(x.p.id) ? 0 : 1);
    return rank(a) - rank(b) || a.p.group.localeCompare(b.p.group) || a.unit - b.unit;
  });

  const suppliersCount = new Set(state.supply.offers.map((o) => o.supplierId)).size;
  const head = pageHead('Каталог', `${countOf(all.length, ['товар', 'товара', 'товаров'])} от ${countOf(suppliersCount, ['поставщика', 'поставщиков', 'поставщиков'])} для ${state.ws.short}. Товары со штрихкодом - из Open Food Facts, без штрихкода - типовые позиции оптовиков.`, [
    button('Найти по штрихкоду', { iconName: 'scan', onClick: () => barcodeDialog() }),
  ]);

  const groupCounts = new Map();
  for (const p of all) groupCounts.set(p.group, (groupCounts.get(p.group) ?? 0) + 1);
  const side = el('nav', { class: 'subnav', 'aria-label': 'Группы товаров' },
    el('div', { class: 'subnav-group', text: 'Группы' }),
    el('a', { href: link('catalog', null, { q, sort, used: onlyUsed ? 1 : null }), 'aria-current': String(!group) }, icon('layers'), 'Все товары', el('span', { class: 'faint', style: { marginLeft: 'auto' }, text: String(all.length) })),
    GROUPS.map((g) => el('a', { href: link('catalog', null, { group: g.id, q, sort, used: onlyUsed ? 1 : null }), 'aria-current': String(group === g.id) }, el('span', { class: 'swatch', style: { background: g.color } }), el('span', { class: 'truncate', text: g.label }), el('span', { class: 'faint', style: { marginLeft: 'auto' }, text: String(groupCounts.get(g.id) ?? 0) }))),
  );

  const kindsInGroup = group ? Object.entries(KINDS).filter(([k, spec]) => spec.group === group && all.some((p) => p.kind === k)) : [];
  const searchBox = searchInput('Название, бренд или штрихкод', q, debounce((value) => setQuery({ q: value || null }), 250));
  const toolbar = el('div', { class: 'row-wrap', style: { gap: '10px' } },
    el('div', { style: { flex: '1 1 260px' } }, searchBox),
    chip('Только то, что расходуем', onlyUsed, () => setQuery({ used: onlyUsed ? null : 1 })),
    dropdown(SORTS, sort, (v) => setQuery({ sort: v }), { iconName: 'sliders', align: 'right' }),
  );
  const kindChips = kindsInGroup.length > 1
    ? el('div', { class: 'row-wrap' }, chip('Все виды', !kind, () => setQuery({ kind: null })), kindsInGroup.map(([k, spec]) => chip(spec.label, kind === k, () => setQuery({ kind: kind === k ? null : k }))))
    : kind ? el('div', { class: 'row-wrap' }, chip(`${KINDS[kind].label}`, true, () => setQuery({ kind: null })), el('span', { class: 'faint', text: 'нажмите, чтобы сбросить' })) : null;

  // карточки дорисовываем порциями: 240 карточек с картинками сразу Safari на айфоне не тянет и перезагружает вкладку
  let shown = Math.min(priced.length, PAGE);
  const counter = el('div', { class: 'faint', style: { fontSize: '13px' } });
  const paintCounter = () => { counter.textContent = `Показано ${num(shown)} из ${num(priced.length)}`; };
  paintCounter();
  const more = button('Показать ещё', { variant: 'ghost', onClick: () => {
    const next = Math.min(priced.length, shown + PAGE);
    grid.append(...priced.slice(shown, next).map((item, i) => productCard(item, assigned.has(item.p.id), shown + i)));
    shown = next;
    paintCounter();
    if (shown >= priced.length) more.remove();
  } });
  const grid = priced.length
    ? el('div', { class: `catalog-grid${animate() ? ' anim' : ''}` }, priced.slice(0, shown).map((item, i) => productCard(item, assigned.has(item.p.id), i)))
    : empty('Ничего не нашлось', 'Проверьте написание или поищите по штрихкоду: если товара нет в каталоге, его можно запросить у поставщиков через тендер.', button('Запустить тендер', { iconName: 'gavel', onClick: () => go(link('rfq', null, { new: 1, item: q })) }));


  return el('div', {},
    head,
    el('div', { class: 'layout-side' }, side, el('div', { class: 'stack' }, toolbar, kindChips, counter, grid, priced.length > shown ? more : null)),
  );
}

const PAGE = 48;

function productCard({ p, best, unit, offers }, used, index = 0) {
  const cartPacks = state.user.cart.filter((c) => c.productId === p.id).reduce((sum, c) => sum + c.packs, 0);
  const node = el('button', { class: 'product-card', type: 'button', dataset: { focusKey: `product:${p.id}` }, style: { '--d': `${Math.min(index, 16) * 22}ms` }, on: { click: () => setQuery({ p: p.id }, { push: true }) } },
    p.image
      ? el('div', { class: 'product-img' }, el('img', { src: p.image, alt: '', width: 160, height: 120, loading: index < 12 ? 'eager' : 'lazy', decoding: 'async', fetchpriority: index < 6 ? 'high' : 'auto', referrerpolicy: 'no-referrer' }))
      : el('div', { class: 'product-img ph' }, el('span', { class: 'ph-kind' }, el('span', { class: 'swatch', style: { background: GROUP_BY_ID[p.group].color } }), p.spec.label), el('span', { class: 'ph-note', text: 'без штрихкода · формат HoReCa' })),
    el('div', { class: 'product-body' },
      el('div', { class: 'between' }, el('span', { class: 'product-brand truncate', text: p.brand ?? 'Типовая позиция' }), el('span', { class: 'row', style: { gap: '4px' } }, p.spec.vet ? badge('ВСД', 'outline') : null, p.spec.marked ? badge('ЧЗ', 'outline') : null)),
      el('div', { class: 'product-name', text: p.name }),
      el('div', { class: 'faint', style: { fontSize: '12.5px' }, text: packLabel(p) }),
      el('div', { class: 'product-price' }, el('b', { text: best ? rub(best.price) : '—' }), el('span', { class: 'faint', style: { fontSize: '12.5px' }, text: best ? `${rub(unit, { kopecks: unit < 100 })}/${p.unit}` : '' })),
      // вся карточка - одна кнопка, поэтому «Заказать» внутри - просто подпись, вложенные кнопки в HTML нельзя
      el('div', { class: 'between product-foot' },
        el('span', { class: 'faint truncate' }, used ? el('span', { class: 'good', text: 'уже закупаем · ' }) : null, countOf(offers, ['предложение', 'предложения', 'предложений'])),
        best ? el('span', { class: 'btn btn-sm product-cta', 'aria-hidden': 'true' }, icon(cartPacks ? 'check' : 'cart'), cartPacks ? `В корзине · ${cartPacks} уп.` : 'Заказать') : null),
    ),
  );
  if (p.image) node.querySelector('img').addEventListener('error', (e) => e.target.replaceWith(el('span', { class: 'ph-kind', text: p.spec.label })));
  return node;
}

// ---------- карточка товара ----------

export function productDrawer(productId) {
  const p = state.supply.products.get(productId);
  if (!p) return;
  openId = productId;
  const offers = (state.supply.offersByProduct.get(productId) ?? []).map((offer) => {
    const s = state.supply.suppliers.get(offer.supplierId);
    const price = state.supply.priceAt(offer, state.today);
    const score = supplierScore(orders(), s.id, addDays(state.today, -90), state.today);
    return { offer, s, price, score };
  }).sort((a, b) => a.price - b.price);
  const locs = state.ws.locations;
  let locId = locs[0].id;
  let packs = p.caseSize;

  const offerActions = new Map();
  const footerActions = el('div', { class: 'product-cart-footer' });
  const cartSummary = el('div', { class: 'cart-summary', 'aria-live': 'polite' });
  const inCart = (o) => state.user.cart.findIndex((c) => c.productId === p.id && c.supplierId === o.s.id && c.locId === locId);
  const change = (o, value) => {
    try { cartSet(inCart(o), value); }
    catch (error) { toast(error.message, { error: true }); }
  };
  const add = (o) => {
    try {
      cartAdd(p.id, o.s.id, packs, locId);
      toast(`Добавлено ${packs} уп. для «${locationName(locId)}»`);
    } catch (error) { toast(error.message, { error: true }); }
  };
  const update = () => {
    const focused = document.activeElement;
    const focusHost = [...offerActions.values(), footerActions].find((node) => node.contains(focused));
    const focusLabel = focused?.getAttribute('aria-label');
    for (const o of offers) {
      const item = state.user.cart[inCart(o)];
      const action = offerActions.get(o.s.id);
      action.replaceChildren(...(item ? [
        el('span', { class: 'good', text: `В корзине · ${rub(item.packs * o.price)}` }),
        qtyStepper(item.packs, (v) => change(o, v), { label: `Упаковок у ${o.s.name}`, min: 0 }),
      ] : [button(`В корзину · ${rub(o.price * packs)}`, { iconName: 'cart', size: 'sm', onClick: () => add(o) })]));
    }
    const items = state.user.cart.filter((c) => c.productId === p.id);
    const totalPacks = items.reduce((sum, c) => sum + c.packs, 0);
    const total = items.reduce((sum, c) => sum + c.packs * (offers.find((o) => o.s.id === c.supplierId)?.price ?? 0), 0);
    cartSummary.replaceChildren(...(totalPacks ? [el('b', { class: 'good', text: `В корзине ${totalPacks} уп. · ${rub(total)}` }), el('span', { class: 'cell-sub', text: items.map((c) => `${locationName(c.locId)}: ${c.packs} уп.`).join(' · ') })] : []));
    const best = offers[0];
    const item = best && state.user.cart[inCart(best)];
    footerActions.replaceChildren(...[
      best ? item ? el('span', { class: 'good', text: `В корзине · ${item.packs} уп. · ${rub(item.packs * best.price)}` }) : button(`В корзину · ${packs} уп. · ${rub(best.price * packs)}`, { variant: 'primary', iconName: 'cart', onClick: () => add(best) }) : null,
      totalPacks ? button('Перейти в корзину', { variant: 'primary', iconName: 'arrow-right', onClick: () => { productPanel?.close(); openCart(); } }) : null,
    ].filter(Boolean));
    if (focusHost) {
      const next = [...focusHost.querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === focusLabel) ?? focusHost.querySelector('input, button');
      next?.focus({ preventScroll: true });
    }
  };
  const offerRows = el('div', {}, offers.map((o, i) => {
    const action = el('div', { class: 'offer-actions' });
    offerActions.set(o.s.id, action);
    return el('div', { class: 'offer-row' },
      el('a', { class: 'cell-main', href: link('suppliers', o.s.id) }, logoTile(o.s), el('div', { style: { minWidth: '0' } }, el('div', { class: 'cell-title truncate', text: o.s.name }), el('div', { class: 'cell-sub', text: `${o.s.typeLabel} · мин. заказ ${rub(o.s.terms.minOrder)} · ${o.s.terms.leadDays === 1 ? 'завтра' : `через ${o.s.terms.leadDays} дн.`}${o.score ? ` · OTIF ${pct(o.score.otif, { digits: 0 })}` : ''}` }))),
      el('div', { class: 'offer-price' }, el('div', { class: 'num', text: rub(o.price, { kopecks: true }) }), el('div', { class: 'cell-sub', text: i === 0 ? 'лучшая цена' : `+${pct(o.price / offers[0].price - 1)}` })),
      action,
    );
  }));
  update();
  const unsubscribe = onChange((reason) => { if (reason === 'cart') update(); });

  const history = priceHistory(p, offers.slice(0, 3));
  const analogs = cheaperAnalogs(p, offers[0]?.price ?? Infinity);
  const off = p.source === 'off' ? `https://world.openfoodfacts.org/product/${encodeURIComponent(p.barcode)}` : null;

  const body = [
    el('div', { class: 'row product-intro', style: { alignItems: 'flex-start' } },
      p.image ? el('img', { class: 'thumb product-detail-image', src: p.image, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb thumb-ph product-detail-image' }, icon('box', 'icon-lg')),
      el('div', { class: 'stack', style: { gap: '8px', minWidth: '0' } },
        el('div', { class: 'row-wrap' }, badge(GROUP_BY_ID[p.group].label, ''), p.spec.vet ? badge('Меркурий: ВСД при приёмке', 'info') : null, p.spec.marked ? badge('Честный знак', 'info') : null, p.nutriscore ? badge(`Nutri-Score ${p.nutriscore.toUpperCase()}`, 'outline') : null),
        el('div', { class: 'kv' }, ...kvRows([
          ['Бренд', p.brand ?? 'без бренда, типовая позиция'],
          ['Фасовка', packLabel(p)],
          ['Штрихкод', p.barcode ?? '—'],
          ['Вид сырья', p.spec.label],
        ])),
      ),
    ),
    card({
      title: `Предложения · ${offers.length}`,
      sub: 'Цены песочницы на сегодня, за упаковку',
      body: el('div', { class: 'stack' },
        el('div', { class: 'row-wrap', style: { gap: '10px' } },
          field('Точка', select(locs.map((l) => ({ value: l.id, label: `${l.name}${locs.length > 1 ? `, ${l.city}` : ''}` })), locId, (v) => { locId = v; update(); })),
          field('Упаковок', qtyStepper(packs, (v) => { packs = v; update(); }, { min: 1, step: 1, label: 'Упаковок для добавления' })),
        ),
        cartSummary,
        offerRows,
      ),
    }),
    history,
    analogs,
    el('div', { class: 'source-line' }, off ? el('span', {}, 'Карточка: ', el('a', { href: off, target: '_blank', rel: 'noopener noreferrer', text: 'Open Food Facts' }), ' (ODbL, фото CC BY-SA)') : el('span', { text: 'Типовая позиция: формат и фасовка как в прайсах оптовиков' }), el('span', { text: 'Цены и условия - песочница' })),
  ];

  productPanel = openDrawer({
    title: p.name,
    sub: p.brand ? `${p.brand} · ${p.spec.label}` : p.spec.label,
    body,
    foot: [button('Тендер на эту позицию', { iconName: 'gavel', variant: 'ghost', onClick: () => go(link('rfq', null, { new: 1, product: p.id })) }), footerActions],
    onClose: () => {
      unsubscribe();
      if (openId !== productId) return;
      openId = null;
      productPanel = null;
      if (new URLSearchParams(location.hash.split('?')[1] ?? '').get('p') === productId) setQuery({ p: null });
    },
  });
}

function kvRows(pairs) {
  return pairs.flatMap(([k, v]) => [el('div', {}, el('span', { class: 'k', text: k })), el('div', {}, el('span', { class: 'v', text: v }))]);
}

function priceHistory(p, top) {
  if (!top.length) return null;
  const months = [];
  for (let i = 11; i >= 0; i -= 1) months.push(shiftMonth(state.market.nowKey, -i));
  const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
  const series = top.map((o, i) => ({ key: o.s.id, label: o.s.name, color: colors[i], values: months.map((m) => state.supply.priceAt(o.offer, `${m}-15`)) }));
  const first = series[0].values[0];
  const last = series[0].values.at(-1);
  const commodity = p.spec.commodity;
  return card({
    title: 'Цена за 12 месяцев',
    sub: commodity ? `Идёт за биржевой ценой: ${COMMODITY_LABELS[commodity] ?? commodity}, Всемирный банк, в рублях по курсу ЦБ, с лагом в месяц` : 'Без биржевой привязки: общий рост цен на продукты',
    actions: badge(pct(last / first - 1, { sign: true }), last > first ? 'warn' : 'good'),
    body: el('div', { class: 'stack' }, lineChart({ labels: months, series, height: 200, xLabel: monthAxis, title: monthLabel, format: (v) => rub(v, { kopecks: true }), endLabels: false }), series.length > 1 ? el('div', { class: 'legend' }, series.map((s) => el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: { background: s.color } }), s.label))) : null),
  });
}

function cheaperAnalogs(p, price) {
  const unit = price / p.pack;
  const list = [...state.supply.products.values()]
    .filter((x) => x.kind === p.kind && x.id !== p.id)
    .map((x) => ({ x, best: bestFor(x.id) }))
    .filter((r) => r.best && r.best.price / r.x.pack < unit * 0.97)
    .sort((a, b) => a.best.price / a.x.pack - b.best.price / b.x.pack)
    .slice(0, 4);
  if (!list.length) return null;
  return card({
    title: 'Аналоги дешевле',
    sub: `Тот же вид сырья, цена за ${p.unit} ниже`,
    flush: true,
    body: el('div', { class: 'list' }, list.map(({ x, best }) => el('button', { class: 'list-item', type: 'button', on: { click: () => { document.querySelector('dialog.drawer[open]')?.close(); setQuery({ p: x.id }, { push: true }); } } },
      productThumb(x),
      el('div', { style: { flex: '1', minWidth: '0' } }, el('div', { class: 'cell-title truncate', text: x.name }), el('div', { class: 'cell-sub', text: `${x.brand ?? 'типовая позиция'} · ${packLabel(x)}` })),
      el('div', { style: { textAlign: 'right' } }, el('div', { class: 'num', text: `${rub(best.price / x.pack, { kopecks: true })}/${x.unit}` }), el('div', { class: 'cell-sub good', text: `−${pct(1 - best.price / x.pack / unit)}` })),
    ))),
  });
}

// ---------- штрихкод: живой запрос в Open Food Facts ----------

function barcodeDialog() {
  const input = el('input', { class: 'input', inputmode: 'numeric', placeholder: '13 цифр, например 4601780002565', 'aria-label': 'Штрихкод', maxlength: '14' });
  const result = el('div', {});
  const run = async () => {
    const code = input.value.replace(/\s/g, '');
    if (!isValidGtin(code)) {
      result.replaceChildren(note('Это не похоже на штрихкод EAN или GTIN: проверьте цифры, последняя - контрольная.', { tone: 'warn', iconName: 'alert' }));
      return;
    }
    const local = [...state.supply.products.values()].find((p) => p.barcode === code);
    if (local) {
      document.querySelector('dialog.modal[open]')?.close();
      setQuery({ p: local.id }, { push: true });
      return;
    }
    result.replaceChildren(el('div', { class: 'skeleton', style: { height: '64px' } }));
    const answer = await lookupBarcode(code);
    if (answer.status === 'found') {
      const pr = answer.product;
      result.replaceChildren(card({
        title: pr.name,
        sub: [pr.brand, pr.quantity].filter(Boolean).join(' · '),
        body: el('div', { class: 'stack' }, el('p', { class: 'muted', text: 'Товар есть в Open Food Facts, но у поставщиков песочницы его нет. Можно запросить цену через тендер.' }), button('Запросить у поставщиков', { iconName: 'gavel', onClick: () => { document.querySelector('dialog.modal[open]')?.close(); go(link('rfq', null, { new: 1, item: `${pr.name}${pr.brand ? `, ${pr.brand}` : ''}` })); } })),
      }));
    } else if (answer.status === 'not_found') result.replaceChildren(note('В Open Food Facts такого штрихкода нет.', { iconName: 'search' }));
    else if (answer.status === 'busy') result.replaceChildren(note('Open Food Facts просит подождать минуту: у него лимит запросов.', { tone: 'warn', iconName: 'clock' }));
    else result.replaceChildren(note('Open Food Facts не ответил. Проверьте сеть и попробуйте ещё раз.', { tone: 'warn', iconName: 'alert' }));
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  openModal({
    title: 'Найти по штрихкоду',
    sub: 'Сначала ищем в каталоге, потом в Open Food Facts. Наружу уходит только штрихкод',
    body: [input, result],
    foot: [button('Найти', { variant: 'primary', iconName: 'search', onClick: run })],
  });
  setTimeout(() => input.focus(), 50);
}

