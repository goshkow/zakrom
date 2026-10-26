// история закупок организации: спрос по меню -> расход сырья -> остатки -> заказы поставщикам
// всё детерминировано: зерно организации и дата дают одну и ту же историю на любом компьютере
import { stream, unit } from '../core/rng.js';
import { addDays, parseDay, isoDay } from '../core/format.js';
import { KINDS } from './kinds.js';
import { kindsUsed } from './workspaces.js';

const PERISHABLE = new Set(['dairy', 'meat', 'produce']);
const SEASON = { zerno: { amp: 0.06, peak: 15 }, ugol: { amp: 0.09, peak: 196 }, pekar: { amp: 0.03, peak: 350 } };
const TRAIL = 14;

const dayOfYear = (date) => Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);

// когда поставщик привозит после заказа в день dow: ближайший день доставки не раньше, чем через lead дней
function deliveryAfter(orderDow, lead, deliveryDays) {
  for (let add = lead; add < lead + 8; add += 1) {
    if (deliveryDays.includes((orderDow + add) % 7)) return add;
  }
  return lead;
}

// промежуток до следующей доставки этого поставщика, дней
function gapAfter(dow, deliveryDays) {
  for (let add = 1; add <= 7; add += 1) if (deliveryDays.includes((dow + add) % 7)) return add;
  return 7;
}

export function simulate(supply, ws, today) {
  // зерно не зависит от даты: открыв кабинет завтра, пользователь увидит ту же историю плюс один день
  const hist = stream(ws.seed);
  const start = ws.since;
  const kinds = kindsUsed(ws);
  const season = SEASON[ws.id] ?? { amp: 0.04, peak: 15 };
  const orders = [];
  const revenue = new Map(); // день -> {total, [locId]: сумма}
  const switches = [];
  const stockouts = [];
  const sales = new Map(); // блюдо -> порций за последние 30 дней
  let seq = 10000 + Math.floor(hist.range(0, 5000));

  const locState = ws.locations.map((loc) => {
    const opened = loc.opened ?? start;
    // плановый недельный расход: по нему оцениваем, какие поставщики вообще имеют смысл для точки
    const avgWeekday = ws.weekday.reduce((a, b) => a + b, 0) / 7;
    const plan = new Map();
    for (const dish of ws.menu) {
      for (const [kind, q] of Object.entries(dish.recipe)) {
        plan.set(kind, (plan.get(kind) ?? 0) + dish.perDay * loc.weight * avgWeekday * q);
      }
    }
    return {
      loc,
      opened,
      plan,
      stock: new Map(kinds.map((k) => [k, (plan.get(k) ?? 0) * 4])),
      onOrder: new Map(kinds.map((k) => [k, 0])),
      trail: new Map(kinds.map((k) => [k, []])),
      assign: new Map(), // вид -> {supplierId, productId}
      lastOrderDay: new Map(),
    };
  });

  const available = (s, loc) => s.national || s.city === loc.city;

  // выбор поставщика и товара по каждому виду: дешевле с учётом срока и надёжности, с «липкостью» к текущему
  const choose = (st, day) => {
    const potential = new Map();
    for (const kind of kinds) {
      for (const offer of supply.offersByKind.get(kind) ?? []) {
        const s = supply.suppliers.get(offer.supplierId);
        if (!available(s, st.loc)) continue;
        const weekly = (st.plan.get(kind) ?? 0) * 7 * supply.unitPriceAt(offer, day);
        const key = `${s.id}|${kind}`;
        if (!potential.has(key) || potential.get(key) < weekly) potential.set(key, weekly);
      }
    }
    const supplierWeekly = new Map();
    for (const [key, weekly] of potential) {
      const id = key.split('|')[0];
      supplierWeekly.set(id, (supplierWeekly.get(id) ?? 0) + weekly);
    }
    for (const kind of kinds) {
      const current = st.assign.get(kind);
      const pick = (strict) => {
        let best = null;
        for (const offer of supply.offersByKind.get(kind) ?? []) {
          const s = supply.suppliers.get(offer.supplierId);
          if (!available(s, st.loc)) continue;
          // поставщик без шансов набрать минимальный заказ точке не подходит
          if (strict && (supplierWeekly.get(s.id) ?? 0) < s.terms.minOrder * 0.7) continue;
          let score = supply.unitPriceAt(offer, day) * (1 + 0.015 * s.terms.leadDays) * (1 + Math.max(0, 0.95 - s.terms.otif) * 0.6);
          // завод из другого региона: дольше и дороже логистика, местный при прочих равных лучше
          if (s.city && s.city !== st.loc.city) score *= 1.05;
          if (!strict) score *= 1 + s.terms.minOrder / 100000;
          if (current && current.supplierId === s.id) score *= 0.97;
          if (!best || score < best.score) best = { score, offer };
        }
        return best;
      };
      // если по минимальному заказу не проходит никто, берём того, у кого порог ниже: так делают и живые закупщики
      const best = pick(true) ?? pick(false);
      if (!best) continue;
      const next = { supplierId: best.offer.supplierId, productId: best.offer.productId };
      if (current && current.supplierId !== next.supplierId) {
        const oldOffer = (supply.offersByProduct.get(current.productId) ?? []).find((o) => o.supplierId === current.supplierId);
        const before = oldOffer ? supply.unitPriceAt(oldOffer, day) : null;
        const after = supply.unitPriceAt(best.offer, day);
        switches.push({ day, locId: st.loc.id, kind, from: current.supplierId, to: next.supplierId, saving: before ? 1 - after / before : null });
      }
      st.assign.set(kind, next);
    }
  };

  let date = parseDay(start);
  const end = parseDay(today);
  let lastMonth = '';
  while (date <= end) {
    const day = isoDay(date);
    const dow = date.getUTCDay();
    const isToday = day === today;
    const month = day.slice(0, 7);
    const doy = dayOfYear(date);

    for (const st of locState) {
      if (day < st.opened) continue;
      if (month !== lastMonth || st.assign.size === 0) choose(st, day);

      // расход за день. сегодняшний день считаем по плану продаж так же, как прошлые:
      // иначе завтра этот день пересчитается иначе и номера заказов разъедутся с тем, что видел пользователь
      {
        const age = Math.round((date - parseDay(st.opened)) / 86400000);
        const ramp = st.loc.opened ? Math.min(1, 0.55 + age / 60) : 1;
        const growth = 1 + 0.16 * (Math.round((date - parseDay(start)) / 86400000) / 365);
        const seasonal = 1 + season.amp * Math.cos((2 * Math.PI * (doy - season.peak)) / 365);
        const common = Math.max(0.7, Math.min(1.35, hist.normal(1, 0.06)));
        const factor = st.loc.weight * (ws.weekday[dow] ?? 1) * ramp * growth * seasonal * common;
        const consumed = new Map();
        let dayRevenue = 0;
        for (const dish of ws.menu) {
          const qty = Math.max(0, Math.round(dish.perDay * factor * Math.max(0.75, hist.normal(1, 0.05))));
          if (!qty) continue;
          dayRevenue += qty * dish.price;
          if (addDays(today, -30) <= day) sales.set(dish.id, (sales.get(dish.id) ?? 0) + qty);
          for (const [kind, q] of Object.entries(dish.recipe)) {
            const waste = PERISHABLE.has(KINDS[kind].group) ? 1.03 : 1.01;
            consumed.set(kind, (consumed.get(kind) ?? 0) + qty * q * waste);
          }
        }
        const rev = revenue.get(day) ?? { total: 0 };
        rev.total += dayRevenue;
        rev[st.loc.id] = (rev[st.loc.id] ?? 0) + dayRevenue;
        revenue.set(day, rev);
        for (const kind of kinds) {
          const used = consumed.get(kind) ?? 0;
          const have = st.stock.get(kind) ?? 0;
          if (used > have + 1e-9 && used > 0) stockouts.push({ day, locId: st.loc.id, kind, short: used - have });
          st.stock.set(kind, Math.max(0, have - used));
          const trail = st.trail.get(kind);
          trail.push(used);
          if (trail.length > TRAIL) trail.shift();
        }
      }

      // 3. заказы: в дни, когда поставщик принимает заявки
      const bySupplier = new Map();
      for (const [kind, a] of st.assign) {
        const list = bySupplier.get(a.supplierId) ?? [];
        list.push({ kind, productId: a.productId });
        bySupplier.set(a.supplierId, list);
      }
      for (const [supplierId, items] of bySupplier) {
        const s = supply.suppliers.get(supplierId);
        const lead = deliveryAfter(dow, s.terms.leadDays, s.terms.deliveryDays);
        // заявку отправляем так, чтобы она успевала к дню доставки
        if (!s.terms.deliveryDays.includes((dow + lead) % 7) || lead > s.terms.leadDays + 1) continue;
        const gap = gapAfter((dow + lead) % 7, s.terms.deliveryDays);
        const lines = [];
        let critical = false;
        for (const { kind, productId } of items) {
          const product = supply.products.get(productId);
          const trail = st.trail.get(kind);
          const avg = trail.length >= 5 ? trail.reduce((a, b) => a + b, 0) / trail.length : st.plan.get(kind) ?? 0;
          if (avg <= 0) continue;
          const group = KINDS[kind].group;
          const safety = PERISHABLE.has(group) ? 1.5 : group === 'packaging' ? 6 : 3;
          const have = (st.stock.get(kind) ?? 0) + (st.onOrder.get(kind) ?? 0);
          const need = avg * (lead + gap + safety) - have;
          if (have < avg * (lead + gap + 0.5)) critical = true;
          if (need <= 0) continue;
          let packs = Math.ceil(need / product.pack);
          if (packs >= product.caseSize / 2) packs = Math.ceil(packs / product.caseSize) * product.caseSize;
          if (PERISHABLE.has(group)) packs = Math.max(1, Math.min(packs, Math.ceil((avg * (gap + lead + 3)) / product.pack)));
          const offer = supply.offersByProduct.get(productId).find((o) => o.supplierId === supplierId);
          lines.push({ productId, kind, packs, price: supply.priceAt(offer, day) });
        }
        if (!lines.length) continue;
        const total = lines.reduce((sum, l) => sum + l.packs * l.price, 0);
        if (total < s.terms.minOrder && !critical) continue;
        seq += 1 + Math.floor(hist.range(0, 3));
        // жребий тянем всегда, даже если заказ ещё в пути: так поток случайных чисел не зависит от сегодняшней даты
        const lateRoll = hist.chance((1 - s.terms.otif) * 0.75);
        const lateTwo = hist.chance(0.2);
        const late = lateRoll ? (lateTwo ? 2 : 1) : 0;
        const expectedDay = addDays(day, lead);
        const deliveredDay = addDays(expectedDay, late);
        const order = {
          id: `${ws.id}-${seq}`,
          number: String(seq),
          wsId: ws.id,
          locId: st.loc.id,
          supplierId,
          createdDay: day,
          expectedDay,
          deliveredDay: null,
          status: 'confirmed',
          lines: lines.map((l) => ({ ...l, invoicePrice: l.price, receivedPacks: null, rejectedPacks: 0 })),
          total: Math.round(total * 100) / 100,
          late,
          issues: [],
          source: 'auto',
        };
        // события поставки: недовоз, брак, цена в УПД выше заказа. решаются при приёмке
        if (hist.chance((1 - s.terms.otif) * 0.55) && order.lines.length) {
          const line = hist.pick(order.lines);
          line.receivedPacks = Math.max(0, Math.floor(line.packs * hist.range(0.5, 0.9)));
          order.issues.push({ type: 'short', productId: line.productId });
        }
        if (hist.chance(0.008) && order.lines.length) {
          const line = hist.pick(order.lines);
          line.rejectedPacks = Math.max(1, Math.floor(line.packs * hist.range(0.1, 0.3)));
          order.issues.push({ type: 'quality', productId: line.productId });
        }
        if (hist.chance(0.025) && order.lines.length) {
          const line = hist.pick(order.lines);
          line.invoicePrice = Math.round(line.price * hist.range(1.03, 1.08) * 100) / 100;
          order.issues.push({ type: 'price', productId: line.productId });
        }
        for (const l of order.lines) st.onOrder.set(l.kind, (st.onOrder.get(l.kind) ?? 0) + l.packs * supply.products.get(l.productId).pack);
        order._deliverOn = deliveredDay;
        order._st = st;
        orders.push(order);
      }
    }

    // приход заказов, которые доезжают сегодня: в остаток - со следующего дня (принимаем вечером)
    for (const order of orders) {
      if (order._deliverOn !== day || order._done) continue;
      const st = order._st;
      for (const l of order.lines) {
        const pack = supply.products.get(l.productId).pack;
        st.onOrder.set(l.kind, Math.max(0, (st.onOrder.get(l.kind) ?? 0) - l.packs * pack));
        if (!isToday) {
          const got = (l.receivedPacks ?? l.packs) - l.rejectedPacks;
          st.stock.set(l.kind, (st.stock.get(l.kind) ?? 0) + Math.max(0, got) * pack);
        }
      }
      order._done = true;
    }

    lastMonth = month;
    date = new Date(date.getTime() + 86400000);
  }

  // статусы относительно сегодня, документы и оплаты
  for (const order of orders) {
    const s = supply.suppliers.get(order.supplierId);
    const delivered = order._deliverOn < today;
    const arrivesToday = order._deliverOn === today;
    if (delivered) {
      order.status = 'delivered';
      order.deliveredDay = order._deliverOn;
      for (const l of order.lines) if (l.receivedPacks === null) l.receivedPacks = l.packs;
    } else if (arrivesToday) {
      order.status = 'arrived';
      for (const l of order.lines) if (l.receivedPacks === null) l.receivedPacks = l.packs;
    } else if (order.createdDay === today && order.total > ws.approvalLimit) {
      order.status = 'approval';
    } else if (order.createdDay === today) {
      order.status = 'sent';
    } else {
      order.status = order.expectedDay <= addDays(today, 1) ? 'in_transit' : 'confirmed';
    }
    if (!delivered) {
      // будущие события поставки ещё не случились: ни опоздания, ни недовоза заранее не видно
      if (order.status !== 'arrived') order.late = 0;
      order.issues = order.status === 'arrived' ? order.issues : [];
      if (order.status !== 'arrived') for (const l of order.lines) { l.receivedPacks = null; l.rejectedPacks = 0; l.invoicePrice = l.price; }
    }
    order.invoiceTotal = Math.round(order.lines.reduce((sum, l) => sum + (l.receivedPacks ?? l.packs) * l.invoicePrice - l.rejectedPacks * l.invoicePrice, 0) * 100) / 100;
    const vet = order.lines.some((l) => KINDS[l.kind].vet);
    const marked = order.lines.some((l) => KINDS[l.kind].marked);
    order.docs = {
      edo: s.terms.edo,
      upd: delivered ? (order.deliveredDay >= addDays(today, -2) && unit(`${order.id}|upd`) < 0.25 ? 'pending' : 'signed') : order.status === 'arrived' ? 'pending' : 'none',
      vsd: vet ? (delivered ? 'redeemed' : order.status === 'arrived' ? 'pending' : 'issued') : null,
      marking: marked ? (delivered ? 'accepted' : 'pending') : null,
    };
    const termDays = s.terms.paymentDays;
    const dueDay = termDays === 0 ? order.createdDay : addDays(order.deliveredDay ?? order.expectedDay, termDays);
    let paidDay = null;
    if (termDays === 0) paidDay = order.createdDay;
    else if (delivered) {
      // день оплаты - из хэша заказа и не зависит от «сегодня»: показываем его, только когда он уже прошёл.
      // 2,5% счетов платят с опозданием на три недели - это и есть просрочки
      const late = unit(`${order.id}|unpaid`) < 0.025;
      const planned = late ? addDays(dueDay, 21) : addDays(dueDay, -Math.floor(unit(`${order.id}|paid`) * 3));
      if (planned < today) paidDay = planned;
    }
    order.payment = { dueDay, paidDay, amount: order.status === 'delivered' || order.status === 'arrived' ? order.invoiceTotal : order.total };
    delete order._deliverOn;
    delete order._st;
    delete order._done;
  }

  const stock = new Map(locState.map((st) => [st.loc.id, st.stock]));
  const avgUse = new Map(locState.map((st) => [st.loc.id, new Map([...st.trail].map(([k, t]) => [k, t.length ? t.reduce((a, b) => a + b, 0) / t.length : st.plan.get(k) ?? 0]))]));
  const assignments = new Map(locState.map((st) => [st.loc.id, st.assign]));
  return { start, orders, revenue, stock, avgUse, assignments, switches, stockouts, sales };
}
