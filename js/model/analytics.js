// аналитика по заказам: всё считается из списка заказов и выручки, без отдельного хранилища
import { addDays, diffDays } from '../core/format.js';
import { KINDS, GROUPS } from './kinds.js';

export const PERIODS = [
  { value: '7d', label: 'Последние 7 дней', days: 7 },
  { value: '30d', label: 'Последние 30 дней', days: 30 },
  { value: '90d', label: 'Последние 90 дней', days: 90 },
  { value: 'mtd', label: 'Текущий месяц' },
  { value: 'prev', label: 'Прошлый месяц' },
  { value: '1y', label: 'За всё время', days: 365 },
];

// диапазон дат периода [from, to] включительно и такой же по длине предыдущий
export function periodRange(value, today) {
  let from;
  let to = today;
  if (value === 'mtd') from = `${today.slice(0, 7)}-01`;
  else if (value === 'prev') {
    const first = `${today.slice(0, 7)}-01`;
    to = addDays(first, -1);
    from = `${to.slice(0, 7)}-01`;
  } else {
    const days = PERIODS.find((p) => p.value === value)?.days ?? 30;
    from = addDays(today, -(days - 1));
  }
  const length = diffDays(to, from) + 1;
  return { from, to, length, prevFrom: addDays(from, -length), prevTo: addDays(from, -1) };
}

export function daysOf(from, to) {
  const list = [];
  for (let d = from; d <= to; d = addDays(d, 1)) list.push(d);
  return list;
}

// заказ «тратит» деньги в день оформления; отменённые и отклонённые не считаем
export const counts = (order) => !['cancelled', 'rejected', 'draft'].includes(order.status);
export const orderValue = (order) => (order.status === 'delivered' || order.status === 'received' ? order.invoiceTotal ?? order.total : order.total);

export function filterOrders(orders, { from, to, locId = null, supplierId = null, group = null } = {}) {
  return orders.filter((o) => counts(o) && o.createdDay >= from && o.createdDay <= to && (!locId || o.locId === locId) && (!supplierId || o.supplierId === supplierId) && (!group || o.lines.some((l) => KINDS[l.kind].group === group)));
}

function lineValue(order, line) {
  const delivered = order.status === 'delivered' || order.status === 'received';
  const packs = delivered ? (line.receivedPacks ?? line.packs) - (line.rejectedPacks ?? 0) : line.packs;
  const price = delivered ? line.invoicePrice ?? line.price : line.price;
  return Math.max(0, packs) * price;
}

/** сумма по ключу: keyFn(order, line) -> ключ */
export function sumBy(orders, keyFn, { group = null } = {}) {
  const map = new Map();
  for (const o of orders) {
    for (const l of o.lines) {
      if (group && KINDS[l.kind].group !== group) continue;
      const key = keyFn(o, l);
      if (key === null || key === undefined) continue;
      map.set(key, (map.get(key) ?? 0) + lineValue(o, l));
    }
  }
  return map;
}

export function total(orders, opts = {}) {
  let sum = 0;
  for (const value of sumBy(orders, () => 'all', opts).values()) sum += value;
  return sum;
}

// столбцы по дням: [{day, dairy: ..., meat: ...}]
export function spendByDayGroup(orders, from, to) {
  const days = daysOf(from, to);
  const index = new Map(days.map((d, i) => [d, i]));
  const rows = days.map(() => ({}));
  for (const o of orders) {
    const i = index.get(o.createdDay);
    if (i === undefined) continue;
    for (const l of o.lines) {
      const g = KINDS[l.kind].group;
      rows[i][g] = (rows[i][g] ?? 0) + lineValue(o, l);
    }
  }
  return { days, rows };
}

// по неделям - для длинных периодов, иначе столбцы становятся тоньше волоса
export function spendByWeekGroup(orders, from, to) {
  const { days, rows } = spendByDayGroup(orders, from, to);
  const weeks = [];
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days[i]);
    const acc = {};
    for (let j = i; j < Math.min(i + 7, days.length); j += 1) for (const [g, v] of Object.entries(rows[j])) acc[g] = (acc[g] ?? 0) + v;
    out.push(acc);
  }
  return { days: weeks, rows: out };
}

export function dailySeries(orders, from, to) {
  const { days, rows } = spendByDayGroup(orders, from, to);
  return { days, values: rows.map((r) => Object.values(r).reduce((a, b) => a + b, 0)) };
}

export function revenueTotal(revenue, from, to, locId = null) {
  let sum = 0;
  for (const [day, r] of revenue) if (day >= from && day <= to) sum += locId ? r[locId] ?? 0 : r.total;
  return sum;
}

/**
 * OTIF по поставщику: доля поставок вовремя и полностью среди принятых за период
 */
export function supplierScore(orders, supplierId, from, to) {
  const delivered = orders.filter((o) => o.supplierId === supplierId && (o.status === 'delivered' || o.status === 'received') && o.createdDay >= from && o.createdDay <= to);
  if (!delivered.length) return null;
  let onTime = 0;
  let inFull = 0;
  let both = 0;
  let priceIssues = 0;
  let lead = 0;
  for (const o of delivered) {
    const t = !o.late;
    const f = !o.issues?.some((i) => i.type === 'short' || i.type === 'quality');
    if (t) onTime += 1;
    if (f) inFull += 1;
    if (t && f) both += 1;
    if (o.issues?.some((i) => i.type === 'price')) priceIssues += 1;
    lead += diffDays(o.deliveredDay ?? o.expectedDay, o.createdDay);
  }
  const n = delivered.length;
  return { n, onTime: onTime / n, inFull: inFull / n, otif: both / n, priceAccuracy: 1 - priceIssues / n, avgLead: lead / n };
}

/**
 * индекс цены корзины: веса - доли видов в расходах за период, цены - рыночный индекс вида
 * 100 = цены месяц назад от начала ряда. показывает инфляцию именно вашей корзины, а не средней по стране
 */
export function basketIndex(orders, market, days) {
  const weights = new Map();
  for (const o of orders) for (const l of o.lines) weights.set(l.kind, (weights.get(l.kind) ?? 0) + lineValue(o, l));
  const sum = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const base = days[0];
  return days.map((day) => {
    let idx = 0;
    for (const [kind, w] of weights) idx += (w / sum) * (market.index(kind, day) / market.index(kind, base));
    return idx * 100;
  });
}

// вклад видов в подорожание: доля в расходах × изменение индекса
export function inflationDrivers(orders, market, from, to) {
  const weights = new Map();
  for (const o of orders) for (const l of o.lines) weights.set(l.kind, (weights.get(l.kind) ?? 0) + lineValue(o, l));
  const sum = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  return [...weights.entries()]
    .map(([kind, w]) => {
      const change = market.index(kind, to) / market.index(kind, from) - 1;
      return { kind, share: w / sum, change, contribution: (w / sum) * change, spend: w };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// платёжный календарь: неоплаченные заказы по дате оплаты
export function payments(orders, today) {
  const open = orders.filter((o) => counts(o) && o.payment && !o.payment.paidDay && o.status !== 'approval');
  const overdue = open.filter((o) => o.payment.dueDay < today);
  const upcoming = open.filter((o) => o.payment.dueDay >= today).sort((a, b) => (a.payment.dueDay < b.payment.dueDay ? -1 : 1));
  return { overdue, upcoming, overdueSum: overdue.reduce((s, o) => s + o.payment.amount, 0), upcomingSum: upcoming.reduce((s, o) => s + o.payment.amount, 0) };
}

export function groupSeries() {
  return GROUPS.map((g) => ({ key: g.id, label: g.short, color: g.color }));
}

// календарь активности: день -> {value, title, label}
export function activityDays(orders) {
  const map = new Map();
  for (const o of orders) {
    if (!counts(o)) continue;
    const cur = map.get(o.createdDay) ?? { value: 0, n: 0 };
    cur.value += orderValue(o);
    cur.n += 1;
    map.set(o.createdDay, cur);
  }
  return map;
}

export function streak(activity, today) {
  let best = 0;
  let cur = 0;
  const days = [...activity.keys()].sort();
  if (!days.length) return 0;
  for (let d = days[0]; d <= today; d = addDays(d, 1)) {
    if (activity.has(d)) {
      cur += 1;
      best = Math.max(best, cur);
    } else cur = 0;
  }
  return best;
}
