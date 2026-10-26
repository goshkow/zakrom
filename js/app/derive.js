// производные данные для экранов: статусы, бюджет, остатки, сигналы «требует внимания»
import { state, orders, approvalLimit, monthlyBudget, locationName } from './state.js';
import { KINDS } from '../model/kinds.js';
import { addDays, parseDay, rub, rubShort, countOf, pct, dayShort } from '../core/format.js';
import { counts, orderValue, payments, total, filterOrders } from '../model/analytics.js';

export const STATUS = {
  draft: { label: 'Черновик', tone: '', icon: 'edit' },
  new: { label: 'Создан', tone: 'info', icon: 'orders' },
  approval: { label: 'На согласовании', tone: 'warn', icon: 'clock' },
  sent: { label: 'Отправлен', tone: 'info', icon: 'arrow-right' },
  confirmed: { label: 'Подтверждён', tone: 'info', icon: 'check' },
  in_transit: { label: 'В пути', tone: 'info', icon: 'truck' },
  arrived: { label: 'Ждёт приёмки', tone: 'serious', icon: 'box' },
  delivered: { label: 'Принят', tone: 'good', icon: 'check' },
  received: { label: 'Принят', tone: 'good', icon: 'check' },
  rejected: { label: 'Отклонён', tone: 'bad', icon: 'x' },
  cancelled: { label: 'Отменён', tone: '', icon: 'x' },
};

export const ISSUE = {
  short: { label: 'Недовоз', tone: 'serious' },
  quality: { label: 'Брак', tone: 'bad' },
  price: { label: 'Цена выше заказа', tone: 'warn' },
  late: { label: 'Опоздание', tone: 'warn' },
};

export function monthBudget() {
  const today = state.today;
  const from = `${today.slice(0, 7)}-01`;
  const list = filterOrders(orders(), { from, to: today });
  const spent = total(list);
  const date = parseDay(today);
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = date.getUTCDate();
  const budget = monthlyBudget();
  const forecast = (spent / dayOfMonth) * daysInMonth;
  return { budget, spent, forecast, share: spent / budget, forecastShare: forecast / budget, dayOfMonth, daysInMonth };
}

const packOf = (productId) => state.supply.products.get(productId)?.pack ?? 0;

// остаток по точке и виду: модель + принятое пользователем. поставки истории, принятые раньше сегодня,
// модель уже сама положила на склад; свои заказы пользователя в модель не входят - их считаем всегда
export function stockLevel(locId, kind) {
  let qty = state.sim.stock.get(locId)?.get(kind) ?? 0;
  for (const o of orders()) {
    if (o.locId !== locId || o.status !== 'received' || !o.receipt || o.receipt.day > state.today) continue;
    if (o.source !== 'user' && o.receipt.day !== state.today) continue;
    for (const l of o.lines) {
      if (l.kind !== kind) continue;
      qty += Math.max(0, (l.receivedPacks ?? 0) - (l.rejectedPacks ?? 0)) * packOf(l.productId);
    }
  }
  return qty;
}

export function onOrderQty(locId, kind) {
  let qty = 0;
  for (const o of orders()) {
    if (o.locId !== locId || !['sent', 'confirmed', 'in_transit', 'arrived', 'approval'].includes(o.status)) continue;
    for (const l of o.lines) if (l.kind === kind) qty += l.packs * packOf(l.productId);
  }
  return qty;
}

export function avgUse(locId, kind) {
  return state.sim.avgUse.get(locId)?.get(kind) ?? 0;
}

/**
 * строки склада с запасом в днях и рекомендацией: заказать столько, чтобы хватило до следующей поставки
 * и ещё на страховой запас. поставщик и товар - те, у кого точка берёт этот вид сейчас
 */
export function stockRows(locId) {
  const assign = state.sim.assignments.get(locId) ?? new Map();
  const rows = [];
  for (const [kind, a] of assign) {
    const spec = KINDS[kind];
    const product = state.supply.products.get(a.productId);
    const supplier = state.supply.suppliers.get(a.supplierId);
    if (!product || !supplier) continue;
    const use = avgUse(locId, kind);
    const level = stockLevel(locId, kind);
    const incoming = onOrderQty(locId, kind);
    const cover = use > 0 ? level / use : Infinity;
    const lead = supplier.terms.leadDays;
    const perishable = ['dairy', 'meat', 'produce'].includes(spec.group);
    const safety = perishable ? 1.5 : spec.group === 'packaging' ? 6 : 3;
    const target = use * (lead + 3 + safety);
    const need = Math.max(0, target - level - incoming);
    let packs = need > 0 ? Math.ceil(need / product.pack) : 0;
    if (packs && packs >= product.caseSize / 2) packs = Math.ceil(packs / product.caseSize) * product.caseSize;
    const status = cover < lead ? 'critical' : cover < lead + safety ? 'low' : 'ok';
    rows.push({ kind, spec, product, supplier, use, level, incoming, cover, status, packs, lead });
  }
  return rows.sort((a, b) => a.cover - b.cover);
}

// месячная цена товара у поставщика: для сигналов о подорожании
function priceChange(offer) {
  const today = state.today;
  const prev = addDays(`${today.slice(0, 7)}-01`, -1);
  const now = state.supply.priceAt(offer, today);
  const before = state.supply.priceAt(offer, prev);
  return before ? now / before - 1 : 0;
}

export const ALERT_TYPES = {
  approval: { label: 'Заказы на согласовании', hint: 'Заказ выше лимита или у нового поставщика ждёт решения' },
  arrived: { label: 'Поставки на приёмке', hint: 'Машина приехала: нужно сверить УПД и погасить ВСД' },
  overdue: { label: 'Просроченные оплаты', hint: 'Счёт не оплачен после срока отсрочки' },
  price: { label: 'Цена в УПД выше заказа', hint: 'Поставщик выставил цену выше согласованной' },
  rise: { label: 'Подорожания', hint: 'Прайс поставщика вырос больше чем на 3,5% за месяц' },
  low: { label: 'Заканчивается на складе', hint: 'Запаса меньше, чем до ближайшей поставки' },
  budget: { label: 'Бюджет месяца', hint: 'Прогноз расходов выше бюджета' },
  switch: { label: 'Смена поставщика', hint: 'Автозаказ перешёл к поставщику дешевле' },
};

/** сигналы для «Требует внимания» и колокольчика */
export function alerts() {
  const list = [];
  const all = orders();
  const today = state.today;
  const approvals = all.filter((o) => o.status === 'approval');
  if (approvals.length) {
    const sum = approvals.reduce((s, o) => s + o.total, 0);
    list.push({ type: 'approval', id: `approval-${approvals.map((o) => o.id).join(',')}`, tone: 'warn', icon: 'clock', title: `${countOf(approvals.length, ['заказ ждёт', 'заказа ждут', 'заказов ждут'])} согласования`, text: `На ${rubShort(sum)}: выше лимита ${rubShort(approvalLimit())} на заказ`, href: '#/orders?status=approval', rank: 1 });
  }
  const arrived = all.filter((o) => o.status === 'arrived');
  if (arrived.length) {
    list.push({ type: 'arrived', id: `arrived-${today}-${arrived.length}`, tone: 'serious', icon: 'truck', title: `${countOf(arrived.length, ['поставка ждёт', 'поставки ждут', 'поставок ждут'])} приёмки`, text: `Сверьте количество с УПД и погасите ВСД в Меркурии`, href: '#/orders?status=arrived', rank: 2 });
  }
  const pay = payments(all, today);
  if (pay.overdue.length) {
    list.push({ type: 'overdue', id: `overdue-${pay.overdue.map((o) => o.id).join(',')}`, tone: 'bad', icon: 'wallet', title: `Просрочена оплата: ${rubShort(pay.overdueSum)}`, text: `${countOf(pay.overdue.length, ['счёт', 'счёта', 'счетов'])} после срока отсрочки`, href: '#/orders?tab=payments', rank: 0 });
  }
  const mismatch = all.filter((o) => (o.status === 'delivered' || o.status === 'received') && o.issues.some((i) => i.type === 'price') && o.deliveredDay >= addDays(today, -14));
  if (mismatch.length) {
    const extra = mismatch.reduce((s, o) => s + o.lines.reduce((x, l) => x + Math.max(0, (l.invoicePrice ?? l.price) - l.price) * (l.receivedPacks ?? l.packs), 0), 0);
    list.push({ type: 'price', id: `price-${mismatch.map((o) => o.id).join(',')}`, tone: 'warn', icon: 'receipt-check', title: `Цена в УПД выше заказа: ${countOf(mismatch.length, ['поставка', 'поставки', 'поставок'])}`, text: `Переплата ${rub(extra)} за 14 дней. Можно выставить претензию`, href: '#/orders?issue=price', rank: 3 });
  }
  // подорожания в этом месяце по тем товарам, которые реально берём
  const seen = new Set();
  const rises = [];
  for (const assign of state.sim.assignments.values()) {
    for (const a of assign.values()) {
      const key = `${a.supplierId}|${a.productId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const offer = state.supply.offersByProduct.get(a.productId)?.find((o) => o.supplierId === a.supplierId);
      if (!offer) continue;
      const change = priceChange(offer);
      if (change > 0.035) rises.push({ offer, change, product: state.supply.products.get(a.productId) });
    }
  }
  rises.sort((a, b) => b.change - a.change);
  // один вид - одно уведомление, даже если подорожал у нескольких складов одной сети cash & carry
  const seenKinds = new Set();
  const topRises = rises.filter((r) => !seenKinds.has(r.product.kind) && seenKinds.add(r.product.kind));
  for (const r of topRises.slice(0, 3)) {
    const s = state.supply.suppliers.get(r.offer.supplierId);
    list.push({ type: 'rise', id: `rise-${r.offer.id}-${today.slice(0, 7)}`, tone: 'warn', icon: 'arrow-up', title: `${r.product.spec.label}: ${pct(r.change, { sign: true })} с начала месяца`, text: `${s.name} поднял прайс. Посмотрите альтернативы в каталоге`, href: `#/catalog?kind=${r.product.kind}`, rank: 4 });
  }
  let low = 0;
  let lowLoc = null;
  for (const loc of state.ws.locations) for (const row of stockRows(loc.id)) if (row.status === 'critical' && row.incoming <= 0) { low += 1; lowLoc ??= loc.id; }
  if (low) list.push({ type: 'low', id: `low-${today}-${low}`, tone: 'bad', icon: 'stock', title: `Заканчивается: ${countOf(low, ['позиция', 'позиции', 'позиций'])}`, text: 'Запаса меньше, чем до ближайшей поставки, и заказ не оформлен', href: `#/stock?filter=critical&loc=${encodeURIComponent(lowLoc)}`, rank: 1 });
  const budget = monthBudget();
  if (budget.forecastShare > 1.02) list.push({ type: 'budget', id: `budget-${today.slice(0, 7)}`, tone: 'warn', icon: 'percent', title: `Прогноз месяца выше бюджета на ${pct(budget.forecastShare - 1)}`, text: `${rubShort(budget.forecast)} при бюджете ${rubShort(budget.budget)}`, href: '#/analytics', rank: 5 });
  const switches = state.sim.switches.filter((s) => s.day >= addDays(today, -40) && s.saving > 0.01);
  for (const sw of switches.slice(-2)) {
    const to = state.supply.suppliers.get(sw.to);
    list.push({ type: 'switch', id: `switch-${sw.day}-${sw.locId}-${sw.kind}`, tone: 'good', icon: 'flash', title: `${KINDS[sw.kind].label}: новый поставщик дешевле на ${pct(sw.saving)}`, text: `${locationName(sw.locId)} с ${dayShort(sw.day)} берёт у «${to.name}»`, href: `#/suppliers/${encodeURIComponent(sw.to)}`, rank: 6 });
  }
  const read = new Set(state.user.readAlerts);
  const muted = new Set(state.user.settings.mutedAlerts ?? []);
  return list.filter((a) => !muted.has(a.type)).sort((a, b) => a.rank - b.rank).map((a) => ({ ...a, read: read.has(a.id) }));
}

export function unreadCount() {
  return alerts().filter((a) => !a.read).length;
}

export { counts, orderValue };
