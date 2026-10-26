// состояние кабинета: данные каталога, история организации и действия пользователя поверх неё
// история детерминирована и не хранится; хранится только то, что сделал пользователь (ключ zakrom:ws:<id>)
import { createMarket } from '../model/market.js';
import { createSupply } from '../model/supply.js';
import { simulate } from '../model/history.js';
import { WORKSPACES, WORKSPACE_BY_ID } from '../model/workspaces.js';
import { KINDS } from '../model/kinds.js';
import { applyProfile, normalizeProfile, OWNER_ROLES } from '../model/profile.js';
import { load, save } from '../core/store.js';
import { addDays, localIsoDay, weekday } from '../core/format.js';

const USER_VERSION = 1;
const listeners = new Set();

export const state = {
  ready: false,
  today: localIsoDay(),
  catalog: null,
  marketRaw: null,
  market: null,
  wsId: null,
  ws: null,
  supply: null,
  sim: null,
  user: null,
  cache: new Map(),
};

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) fn(reason);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

export async function boot() {
  const [catalog, marketRaw] = await Promise.all([fetchJson('data/catalog.json'), fetchJson('data/market.json')]);
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.products)) throw new Error('каталог в неизвестном формате');
  state.catalog = catalog;
  state.marketRaw = marketRaw;
  state.market = createMarket(marketRaw, state.today);
  const saved = load('workspace', null);
  selectWorkspace(WORKSPACE_BY_ID[saved] ? saved : WORKSPACES[0].id, { silent: true });
  state.ready = true;
}

export function selectWorkspace(id, { silent = false } = {}) {
  const ws = WORKSPACE_BY_ID[id];
  if (!ws) return;
  state.wsId = id;
  state.ws = ws;
  if (!state.cache.has(id)) {
    const supply = createSupply(state.catalog, state.market, ws);
    const sim = simulate(supply, ws, state.today);
    state.cache.set(id, { supply, sim });
  }
  const { supply, sim } = state.cache.get(id);
  state.supply = supply;
  state.sim = sim;
  state.user = loadUser(id);
  state.ws = applyProfile(ws, state.user.settings.workspaceProfile);
  save('workspace', id);
  if (!silent) emit('workspace');
}

export function workspaces() {
  return WORKSPACES.map((base) => base.id === state.wsId ? state.ws : applyProfile(base, load(`ws:${base.id}`, null)?.settings?.workspaceProfile));
}

function emptyUser() {
  return { v: USER_VERSION, orders: [], decisions: {}, receipts: {}, cart: [], rfqs: [], favorites: [], notes: {}, readAlerts: [], settings: {}, watch: [] };
}

// пользовательские данные проверяем по форме: битая запись из старой версии не должна ронять кабинет
function loadUser(id) {
  const raw = load(`ws:${id}`, null);
  const base = emptyUser();
  if (!raw || raw.v !== USER_VERSION || typeof raw !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key])) base[key] = Array.isArray(raw[key]) ? raw[key] : [];
    else if (typeof base[key] === 'object') base[key] = raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]) ? raw[key] : {};
  }
  const locIds = new Set(state.ws.locations.map((l) => l.id));
  const knownLine = (l) => l && state.supply.products.has(l.productId) && Number(l.packs) > 0;
  base.orders = base.orders.filter((o) => o && typeof o.id === 'string' && state.supply.suppliers.has(o.supplierId) && locIds.has(o.locId) && Array.isArray(o.lines) && o.lines.length && o.lines.every(knownLine));
  base.cart = base.cart.filter((c) => c && locIds.has(c.locId) && validPacks(c.packs) && hasOffer(c.productId, c.supplierId));
  base.settings.workspaceProfile = normalizeProfile(base.settings.workspaceProfile, state.ws);
  base.rfqs = base.rfqs.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.items) && Array.isArray(r.supplierIds) && r.items.every((i) => i && typeof i.kind === 'string'));
  for (const [id, d] of Object.entries(base.decisions)) if (!d || typeof d !== 'object' || !['approved', 'rejected'].includes(d.status)) delete base.decisions[id];
  for (const [id, r] of Object.entries(base.receipts)) if (!r || !Array.isArray(r.lines) || typeof r.day !== 'string') delete base.receipts[id];
  if (!Array.isArray(base.settings.mutedAlerts)) delete base.settings.mutedAlerts;
  for (const key of ['approvalLimit', 'monthlyBudget']) if (key in base.settings && !(Number(base.settings[key]) > 0)) delete base.settings[key];
  base.favorites = base.favorites.filter((id) => typeof id === 'string');
  base.readAlerts = base.readAlerts.filter((id) => typeof id === 'string');
  return base;
}

export function persist(reason = 'user') {
  save(`ws:${state.wsId}`, state.user);
  emit(reason);
}

export function setting(key, fallback) {
  const value = state.user.settings[key];
  return value === undefined ? fallback : value;
}

export const approvalLimit = () => setting('approvalLimit', state.ws.approvalLimit);
export const monthlyBudget = () => setting('monthlyBudget', state.ws.monthlyBudget);

// ---------- заказы: история + решения пользователя + свои заказы ----------

let mergedCache = null;
let mergedKey = '';

export function orders() {
  const key = `${state.today}|${state.wsId}|${JSON.stringify(state.user.decisions)}|${JSON.stringify(state.user.receipts)}|${state.user.orders.length}|${state.user.orders.map((o) => o.status).join()}|${Math.floor(Date.now() / 30000)}`;
  if (mergedCache && key === mergedKey) return mergedCache;
  const list = state.sim.orders.map((o) => applyUser(o));
  for (const o of state.user.orders) list.push(liveOrder(o));
  list.sort((a, b) => (a.createdDay === b.createdDay ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : a.createdDay < b.createdDay ? 1 : -1));
  mergedCache = list;
  mergedKey = key;
  return list;
}

export function invalidate() {
  mergedCache = null;
}

export function orderById(id) {
  return orders().find((o) => o.id === id) ?? null;
}

function applyUser(order) {
  const decision = state.user.decisions[order.id];
  const receipt = state.user.receipts[order.id];
  if (!decision && !receipt) return order;
  const copy = { ...order, lines: order.lines.map((l) => ({ ...l })), issues: [...order.issues], docs: { ...order.docs }, payment: { ...order.payment } };
  // решение меняет только заказ, который ждал согласования; дальше он живёт своей историей (в пути, приехал)
  if (decision && order.status === 'approval') copy.status = decision.status === 'approved' ? 'sent' : 'rejected';
  if (decision) copy.decision = decision;
  if (receipt) applyReceipt(copy, receipt);
  return copy;
}

function applyReceipt(order, receipt) {
  order.status = 'received';
  order.deliveredDay = receipt.day;
  order.receipt = receipt;
  order.issues = [];
  for (const l of order.lines) {
    const r = receipt.lines.find((x) => x.productId === l.productId);
    if (!r) continue;
    l.receivedPacks = r.receivedPacks;
    l.rejectedPacks = r.rejectedPacks;
    l.invoicePrice = r.invoicePrice ?? l.invoicePrice ?? l.price;
    if (r.receivedPacks < l.packs) order.issues.push({ type: 'short', productId: l.productId });
    if (r.rejectedPacks > 0) order.issues.push({ type: 'quality', productId: l.productId });
    if (l.invoicePrice > l.price + 0.005) order.issues.push({ type: 'price', productId: l.productId });
  }
  order.invoiceTotal = Math.round(order.lines.reduce((s, l) => s + Math.max(0, (l.receivedPacks ?? l.packs) - l.rejectedPacks) * l.invoicePrice, 0) * 100) / 100;
  order.docs = { ...order.docs, upd: 'signed', vsd: order.docs.vsd ? 'redeemed' : null, marking: order.docs.marking ? 'accepted' : null };
  const s = state.supply.suppliers.get(order.supplierId);
  const termDays = s?.terms.paymentDays ?? 14;
  order.payment = { dueDay: termDays === 0 ? order.createdDay : addDays(receipt.day, termDays), paidDay: termDays === 0 ? order.createdDay : null, amount: order.invoiceTotal };
}

// статус своего заказа идёт по настоящему времени: подтверждение поставщика песочницы приходит через минуту
export const CONFIRM_AFTER_MS = 60 * 1000;

function liveOrder(raw) {
  const order = { ...raw, lines: raw.lines.map((l) => ({ ...l })), issues: [], docs: { ...raw.docs }, payment: { ...raw.payment } };
  const decision = state.user.decisions[order.id];
  const receipt = state.user.receipts[order.id];
  if (raw.status === 'draft' || raw.status === 'cancelled') return order;
  if (receipt) {
    applyReceipt(order, receipt);
    return order;
  }
  if (order.needsApproval && !decision) {
    order.status = 'approval';
    return order;
  }
  if (decision?.status === 'rejected') {
    order.status = 'rejected';
    order.decision = decision;
    return order;
  }
  const sentAt = decision?.at ?? order.createdAt;
  order.sentAt = sentAt;
  if (order.arrivedAt || state.today >= order.expectedDay) order.status = 'arrived';
  else if (Date.now() - sentAt < CONFIRM_AFTER_MS) order.status = 'sent';
  else order.status = addDays(state.today, 1) >= order.expectedDay ? 'in_transit' : 'confirmed';
  if (order.status === 'arrived') order.docs = { ...order.docs, upd: 'pending', vsd: order.docs.vsd ? 'pending' : null };
  if (decision) order.decision = decision;
  return order;
}

// ---------- действия ----------

export function decide(orderId, status, comment = '') {
  decideMany([orderId], status, comment);
}

// пачкой: «Согласовать все» - одно сохранение и одна перерисовка
export function decideMany(ids, status, comment = '') {
  const at = Date.now();
  for (const id of ids) state.user.decisions[id] = { status, at, comment: String(comment).slice(0, 300), by: state.ws.team.find((m) => OWNER_ROLES.includes(m.role))?.name ?? 'Владелец' };
  invalidate();
  persist('order');
}

export function receive(orderId, lines, note = '') {
  state.user.receipts[orderId] = { day: state.today, at: Date.now(), lines, note: String(note).slice(0, 500) };
  invalidate();
  persist('order');
}

export function simulateArrival(orderId) {
  const order = state.user.orders.find((o) => o.id === orderId);
  if (!order) return;
  order.arrivedAt = Date.now();
  invalidate();
  persist('order');
}

export function cancelUserOrder(orderId) {
  const order = state.user.orders.find((o) => o.id === orderId);
  if (!order) return;
  order.status = 'cancelled';
  invalidate();
  persist('order');
}

function deliveryAfter(dow, lead, days) {
  for (let add = lead; add < lead + 8; add += 1) if (days.includes((dow + add) % 7)) return add;
  return lead;
}

export function expectedFor(supplier, day = state.today) {
  return addDays(day, deliveryAfter(weekday(day), supplier.terms.leadDays, supplier.terms.deliveryDays));
}

let counter = 0;

/** lines: [{productId, packs}] одного поставщика и одной точки -> новый заказ */
// price в строке - цена из тендера; без неё берём текущий прайс поставщика
export function createOrder({ supplierId, locId, lines, comment = '', source = 'user' }) {
  const s = state.supply.suppliers.get(supplierId);
  if (!s) throw new Error('поставщик не найден');
  if (!state.ws.locations.some((l) => l.id === locId)) throw new Error('точка не найдена');
  if (!Array.isArray(lines) || !lines.length || !lines.every((l) => l && validPacks(l.packs))) throw new Error('некорректное количество упаковок');
  const priced = lines
    .filter((l) => l.packs > 0)
    .map((l) => {
      const offer = state.supply.offersByProduct.get(l.productId)?.find((o) => o.supplierId === supplierId);
      if (!offer) throw new Error(`у поставщика нет товара ${l.productId}`);
      const product = state.supply.products.get(l.productId);
      const price = Number.isFinite(l.price) && l.price > 0 ? l.price : state.supply.priceAt(offer, state.today);
      return { productId: l.productId, kind: product.kind, packs: l.packs, price, invoicePrice: null, receivedPacks: null, rejectedPacks: 0 };
    });
  const total = Math.round(priced.reduce((sum, l) => sum + l.packs * l.price, 0) * 100) / 100;
  const number = String(90000 + state.user.orders.length * 7 + (counter += 1) + (Date.now() % 97));
  const vet = priced.some((l) => KINDS[l.kind].vet);
  const marked = priced.some((l) => KINDS[l.kind].marked);
  const order = {
    id: `u-${state.wsId}-${number}`,
    number,
    wsId: state.wsId,
    locId,
    supplierId,
    createdDay: state.today,
    createdAt: Date.now(),
    expectedDay: expectedFor(s),
    deliveredDay: null,
    status: 'new',
    // правило «новый поставщик - через согласование»: первый заказ у незнакомой компании проверяет владелец
    needsApproval: total > approvalLimit() || (setting('approveNewSuppliers', true) && !orders().some((o) => o.supplierId === supplierId && o.status !== 'rejected' && o.status !== 'cancelled')),
    lines: priced,
    total,
    late: 0,
    issues: [],
    comment: String(comment).slice(0, 500),
    docs: { edo: s.terms.edo, upd: 'none', vsd: vet ? 'issued' : null, marking: marked ? 'pending' : null },
    payment: { dueDay: addDays(state.today, s.terms.paymentDays), paidDay: s.terms.paymentDays === 0 ? state.today : null, amount: total },
    source,
  };
  state.user.orders.push(order);
  invalidate();
  persist('order');
  return order;
}

// ---------- корзина ----------

export const MAX_PACKS = 100000;
const validPacks = (packs) => Number.isInteger(packs) && packs > 0 && packs <= MAX_PACKS;
const hasOffer = (productId, supplierId) => state.supply.offersByProduct.get(productId)?.some((o) => o.supplierId === supplierId);

export function cartAdd(productId, supplierId, packs, locId) {
  return cartAddMany([{ productId, supplierId, packs, locId }]);
}

export function cartAddMany(items) {
  const next = state.user.cart.map((item) => ({ ...item }));
  for (const { productId, supplierId, packs, locId } of items) {
    if (!validPacks(packs) || !state.ws.locations.some((l) => l.id === locId) || !hasOffer(productId, supplierId)) throw new Error('Проверьте товар, точку и количество упаковок');
    const existing = next.find((c) => c.productId === productId && c.supplierId === supplierId && c.locId === locId);
    if (existing && existing.packs + packs > MAX_PACKS) throw new Error('Не больше 100 000 упаковок на позицию');
    if (existing) existing.packs += packs;
    else next.push({ productId, supplierId, packs, locId });
  }
  state.user.cart = next;
  persist('cart');
}

export function cartSet(index, packs) {
  if (!state.user.cart[index]) return;
  if (packs !== 0 && !validPacks(packs)) throw new Error('Введите целое количество до 100 000');
  if (packs === 0) state.user.cart.splice(index, 1);
  else state.user.cart[index].packs = packs;
  persist('cart');
}

export function cartClear() {
  state.user.cart = [];
  persist('cart');
}

// корзина раскладывается на заказы: один поставщик + одна точка = один заказ
export function cartGroups() {
  const groups = new Map();
  state.user.cart.forEach((item, index) => {
    const key = `${item.supplierId}|${item.locId}`;
    const g = groups.get(key) ?? { supplierId: item.supplierId, locId: item.locId, items: [], total: 0 };
    const offer = state.supply.offersByProduct.get(item.productId)?.find((o) => o.supplierId === item.supplierId);
    const price = offer ? state.supply.priceAt(offer, state.today) : 0;
    g.items.push({ ...item, index, price, sum: price * item.packs });
    g.total += price * item.packs;
    groups.set(key, g);
  });
  return [...groups.values()];
}

export function toggleFavorite(supplierId) {
  const list = state.user.favorites;
  const i = list.indexOf(supplierId);
  if (i >= 0) list.splice(i, 1);
  else list.push(supplierId);
  persist('favorites');
}

export function setNote(supplierId, text) {
  state.user.notes[supplierId] = String(text).slice(0, 2000);
  persist('notes');
}

export function setSetting(key, value) {
  state.user.settings[key] = value;
  invalidate();
  persist('settings');
}

export function updateProfile(patch) {
  const base = WORKSPACE_BY_ID[state.wsId];
  const current = normalizeProfile(state.user.settings.workspaceProfile, base);
  const profile = normalizeProfile({ ...current, ...patch, locations: { ...current.locations, ...patch.locations } }, base);
  if (patch.team && !profile.team) throw new Error('Проверьте участников: нужны разные почты и хотя бы один владелец или директор');
  state.user.settings.workspaceProfile = profile;
  state.ws = applyProfile(base, profile);
  invalidate();
  persist('profile');
}

export function markAlertsRead(ids) {
  const set = new Set(state.user.readAlerts);
  for (const id of ids) set.add(id);
  state.user.readAlerts = [...set].slice(-400);
  persist('alerts');
}

export function locationName(locId) {
  const loc = state.ws.locations.find((l) => l.id === locId);
  return loc ? `${loc.name}${state.ws.locations.length > 1 ? `, ${loc.city}` : ''}` : '—';
}

// ---------- тендеры ----------

export function saveRfq(rfq) {
  const list = state.user.rfqs;
  const i = list.findIndex((r) => r.id === rfq.id);
  if (i >= 0) list[i] = rfq;
  else list.push(rfq);
  persist('rfq');
}

// удаляем только успешно оформленные группы: ошибка одной поставки не теряет остальные позиции
export function checkoutCart() {
  const created = [];
  const failed = [];
  for (const group of cartGroups()) {
    try {
      created.push(createOrder({ supplierId: group.supplierId, locId: group.locId, lines: group.items.map((item) => ({ productId: item.productId, packs: item.packs })) }));
      state.user.cart = state.user.cart.filter((item) => item.supplierId !== group.supplierId || item.locId !== group.locId);
    } catch (error) {
      failed.push({ supplierId: group.supplierId, locId: group.locId, message: error.message });
    }
  }
  persist('cart');
  return { created, failed };
}
