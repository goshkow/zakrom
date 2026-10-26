// «Техкарты»: себестоимость блюд из текущих цен поставщиков, фудкост меню и симулятор подорожания сырья
import { el, icon } from '../core/dom.js';
import { rub, rubShort, pct, num, countOf, qty, addDays } from '../core/format.js';
import { state } from '../app/state.js';
import { KINDS, GROUP_BY_ID } from '../model/kinds.js';
import { badge, button, card, kpi, dataTable, openDrawer, stackMeter, sandboxNote } from '../ui/components.js';
import { pageHead } from './common.js';
import { link } from '../app/router.js';

export const title = () => 'Техкарты';

// сценарий «что если» живёт, пока открыт раздел: вид -> изменение цены (0.1 = +10%)
const scenarios = new Map();
let shocks = new Map();

// цена вида за кг/л/шт: средняя по точкам у тех поставщиков, у кого берём сейчас
function unitCost(kind, day) {
  let sum = 0;
  let n = 0;
  for (const assign of state.sim.assignments.values()) {
    const a = assign.get(kind);
    if (!a) continue;
    const offer = state.supply.offersByProduct.get(a.productId)?.find((o) => o.supplierId === a.supplierId);
    if (!offer) continue;
    sum += state.supply.unitPriceAt(offer, day);
    n += 1;
  }
  if (n) return sum / n;
  const best = state.supply.bestOffer(kind, day);
  return best ? best.price : KINDS[kind].price;
}

function dishCost(dish, day, withShock = false) {
  let cost = 0;
  const parts = [];
  for (const [kind, amount] of Object.entries(dish.recipe)) {
    const price = unitCost(kind, day) * (withShock ? 1 + (shocks.get(kind) ?? 0) : 1);
    const value = price * amount;
    cost += value;
    parts.push({ kind, amount, price, value });
  }
  return { cost, parts: parts.sort((a, b) => b.value - a.value) };
}

export function render() {
  if (!scenarios.has(state.wsId)) scenarios.set(state.wsId, new Map());
  shocks = scenarios.get(state.wsId);
  const ws = state.ws;
  const today = state.today;
  const ago = addDays(today, -92);
  const menu = ws.menu.filter((d) => !d.internal);
  const sold = state.sim.sales;
  const rows = menu.map((dish) => {
    const now = dishCost(dish, today);
    const before = dishCost(dish, ago);
    const shocked = dishCost(dish, today, true);
    const portions = sold.get(dish.id) ?? 0;
    return { dish, now, before, shocked, portions, foodCost: now.cost / dish.price, shockedFoodCost: shocked.cost / dish.price, change: before.cost ? now.cost / before.cost - 1 : 0 };
  });
  const revenue = rows.reduce((s, r) => s + r.portions * r.dish.price, 0);
  const cost = rows.reduce((s, r) => s + r.portions * r.now.cost, 0);
  const costShock = rows.reduce((s, r) => s + r.portions * r.shocked.cost, 0);
  const costBefore = rows.reduce((s, r) => s + r.portions * r.before.cost, 0);
  const worst = rows.slice().sort((a, b) => b.foodCost - a.foodCost)[0];
  const target = ws.targetFoodCost;

  // вклад вида в себестоимость меню за 30 дней: что двигать в сценарии
  const impact = new Map();
  for (const r of rows) for (const p of r.now.parts) impact.set(p.kind, (impact.get(p.kind) ?? 0) + p.value * r.portions);
  const topKinds = [...impact.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);

  const head = pageHead('Техкарты и фудкост', `Себестоимость блюд ${ws.short} по текущим ценам тех поставщиков, у кого вы берёте сырьё. Продажи - за последние 30 дней.`, [
    button('Сбросить сценарий', { variant: 'ghost', iconName: 'refresh', disabled: !shocks.size, onClick: () => { shocks.clear(); rerenderSelf(); } }),
  ]);

  const tiles = el('div', { class: 'tiles tiles-4' },
    kpi({ label: 'Фудкост меню', value: pct(revenue ? cost / revenue : 0), meta: `цель ${pct(target, { digits: 0 })}, взвешенно по продажам` }),
    kpi({ label: 'Валовая маржа за 30 дней', value: rubShort(revenue - cost), meta: `выручка ${rubShort(revenue)}` }),
    kpi({ label: 'Себестоимость за 3 месяца', value: pct(costBefore ? cost / costBefore - 1 : 0, { sign: true }), meta: 'при тех же продажах', upIsGood: false }),
    kpi({ label: 'Самый тяжёлый фудкост', value: worst ? pct(worst.foodCost, { digits: 0 }) : '—', meta: worst?.dish.name ?? '' }),
  );

  const table = dataTable({
    columns: [
      { key: 'dish', label: 'Блюдо', render: (r) => el('div', {}, el('div', { class: 'cell-title', text: r.dish.name }), el('div', { style: { marginTop: '6px', width: '180px' } }, stackMeter(r.now.parts.map((p) => ({ value: p.value, color: GROUP_BY_ID[KINDS[p.kind].group].color, label: KINDS[p.kind].label }))))), sort: (r) => r.dish.name, defaultDir: 'asc' },
      { key: 'portions', label: 'Продано, 30 дн.', align: 'right', cls: 'hide-sm', render: (r) => num(r.portions), sort: (r) => r.portions },
      { key: 'price', label: 'Цена', align: 'right', render: (r) => rub(r.dish.price), sort: (r) => r.dish.price },
      { key: 'cost', label: 'Себестоимость', align: 'right', render: (r) => el('div', {}, el('div', { class: 'num', text: rub(r.now.cost, { kopecks: true }) }), el('div', { class: `cell-sub ${r.change > 0.02 ? 'warn' : ''}`, text: `${pct(r.change, { sign: true })} за 3 мес.` })), sort: (r) => r.now.cost },
      { key: 'fc', label: 'Фудкост', align: 'right', render: (r) => fcCell(r, target), sort: (r) => r.foodCost },
      { key: 'margin', label: 'Маржа, 30 дн.', align: 'right', render: (r) => rubShort(r.portions * (r.dish.price - r.now.cost)), sort: (r) => r.portions * (r.dish.price - r.now.cost) },
    ],
    rows,
    sortKey: 'fc',
    sortDir: 'desc',
    onRow: (r) => dishDrawer(r, target),
  });

  const whatIf = card({
    title: 'Что если сырьё подорожает',
    sub: 'Сдвиньте цену - пересчитаются себестоимость и маржа всего меню',
    body: el('div', { class: 'stack' },
      topKinds.map(([kind, value]) => shockRow(kind, value / (cost || 1))),
      el('div', { class: 'tiles tiles-2' },
        kpi({ label: 'Фудкост по сценарию', value: pct(revenue ? costShock / revenue : 0), delta: revenue && shocks.size ? (costShock - cost) / revenue : null, upIsGood: false, meta: 'п. п. к текущему' }),
        kpi({ label: 'Маржа за 30 дней', value: rubShort(revenue - costShock), delta: shocks.size ? (cost - costShock) / Math.max(1, revenue - cost) : null, upIsGood: true, meta: shocks.size ? `${rub(cost - costShock)}` : 'без изменений' }),
      ),
    ),
  });

  return el('div', { class: 'stack-l', id: 'recipes-root' },
    head,
    tiles,
    el('div', { class: 'grid-main', style: { alignItems: 'start' } },
      card({ title: `Меню · ${countOf(rows.length, ['блюдо', 'блюда', 'блюд'])}`, sub: 'Нажмите на блюдо - откроется техкарта с ценой каждого ингредиента', flush: true, body: table }),
      whatIf,
    ),
    sandboxNote('Техкарты - пример песочницы. В рабочей версии они приходят из iiko или r_keeper, а продажи - из кассы.'),
  );
}

function fcCell(r, target) {
  const over = r.foodCost > target + 0.05;
  const under = r.foodCost < target - 0.08;
  return el('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '6px' } }, el('span', { class: `num ${over ? 'bad' : ''}`, text: pct(r.foodCost) }), over ? badge('выше цели', 'bad') : under ? badge('запас', 'good') : null);
}

function shockRow(kind, share) {
  const value = shocks.get(kind) ?? 0;
  const label = el('span', { class: 'num', style: { textAlign: 'right' }, text: pct(value, { sign: true, digits: 0 }) });
  const slider = el('input', { class: 'slider', type: 'range', min: '-30', max: '50', step: '5', value: String(Math.round(value * 100)), 'aria-label': `Изменение цены: ${KINDS[kind].label}` });
  slider.addEventListener('input', () => { label.textContent = pct(Number(slider.value) / 100, { sign: true, digits: 0 }); });
  slider.addEventListener('change', () => {
    const v = Number(slider.value) / 100;
    if (v === 0) shocks.delete(kind);
    else shocks.set(kind, v);
    rerenderSelf();
  });
  return el('div', { class: 'whatif' }, el('div', { style: { minWidth: '0' } }, el('div', { class: 'row', style: { gap: '8px' } }, el('span', { class: 'swatch', style: { background: GROUP_BY_ID[KINDS[kind].group].color } }), el('span', { class: 'truncate', text: KINDS[kind].label })), el('div', { class: 'cell-sub', style: { marginLeft: '17px' }, text: `${pct(share, { digits: 0 })} себестоимости` })), slider, label);
}

function rerenderSelf() {
  window.dispatchEvent(new Event('zakrom:render'));
}

function dishDrawer(r, target) {
  const { dish, now } = r;
  const fairPrice = now.cost / target;
  openDrawer({
    title: dish.name,
    sub: `Техкарта на 1 порцию · продано ${num(r.portions)} за 30 дней`,
    body: [
      el('div', { class: 'tiles tiles-3' },
        kpi({ label: 'Себестоимость', value: rub(now.cost, { kopecks: true }) }),
        kpi({ label: 'Фудкост', value: pct(r.foodCost), meta: `при цене ${rub(dish.price)}` }),
        kpi({ label: 'Цена под цель', value: rub(Math.ceil(fairPrice / 10) * 10), meta: `фудкост ${pct(target, { digits: 0 })}` }),
      ),
      card({
        title: 'Ингредиенты',
        flush: true,
        body: el('div', { class: 'table-wrap' }, el('table', { class: 'table table-compact' },
          el('thead', {}, el('tr', {}, el('th', { text: 'Сырьё' }), el('th', { class: 'r', text: 'На порцию' }), el('th', { class: 'r', text: 'Цена' }), el('th', { class: 'r', text: 'Стоимость' }), el('th', { class: 'r', text: 'Доля' }))),
          el('tbody', {}, now.parts.map((p) => {
            const spec = KINDS[p.kind];
            return el('tr', {},
              el('td', {}, el('a', { class: 'row', style: { gap: '8px' }, href: link('catalog', null, { kind: p.kind }) }, el('span', { class: 'swatch', style: { background: GROUP_BY_ID[spec.group].color } }), spec.label)),
              el('td', { class: 'r', text: spec.unit === 'шт' ? qty(p.amount, 'шт') : p.amount < 1 ? `${num(p.amount * 1000)} ${spec.unit === 'л' ? 'мл' : 'г'}` : qty(p.amount, spec.unit) }),
              el('td', { class: 'r', text: `${rub(p.price, { kopecks: p.price < 100 })}/${spec.unit}` }),
              el('td', { class: 'r', text: rub(p.value, { kopecks: true }) }),
              el('td', { class: 'r', text: pct(p.value / now.cost, { digits: 0 }) }),
            );
          })),
        )),
      }),
      el('div', { class: 'note' }, icon('info'), el('div', { text: 'Цена сырья - средняя по точкам у текущих поставщиков. Потери при обработке (1-3%) в расход включены, в техкарту - нет.' })),
    ],
  });
}
