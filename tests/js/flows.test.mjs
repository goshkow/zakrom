// сценарии пользователя поверх истории: без браузера, localStorage подменяем простым объектом
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, marketRaw, TODAY } from './helpers.mjs';

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  key: (i) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
};

const S = await import('../../js/app/state.js');
const D = await import('../../js/app/derive.js');
const { createMarket } = await import('../../js/model/market.js');

function bootFor(wsId) {
  S.state.today = TODAY;
  S.state.catalog = catalog;
  S.state.marketRaw = marketRaw;
  S.state.market = createMarket(marketRaw, TODAY);
  S.state.ready = true;
  S.selectWorkspace(wsId, { silent: true });
}

test('согласование: заказ выше лимита ждёт решения, после «согласовать» уходит поставщику', () => {
  bootFor('zerno');
  const known = S.orders().find((o) => o.status === 'delivered');
  const line = known.lines[0];
  const packs = Math.ceil((S.approvalLimit() + 1) / line.price);
  const order = S.createOrder({ supplierId: known.supplierId, locId: known.locId, lines: [{ productId: line.productId, packs }] });
  assert.equal(S.orderById(order.id).status, 'approval');
  assert.ok(D.alerts().some((a) => a.type === 'approval'));
  S.decide(order.id, 'approved', 'ок');
  const after = S.orderById(order.id);
  assert.equal(after.status, 'sent');
  assert.equal(after.decision.comment, 'ок');
  const saved = JSON.parse(memory.get('zakrom:ws:zerno'));
  assert.equal(saved.v, 1);
  assert.equal(saved.decisions[order.id].status, 'approved');
});

test('приёмка с недовозом и ценой выше заказа: статус, сверка, сумма по УПД и остаток', () => {
  bootFor('zerno');
  const order = S.orders().find((o) => o.status === 'arrived');
  assert.ok(order);
  const line = order.lines[0];
  const pack = S.state.supply.products.get(line.productId).pack;
  const before = D.stockLevel(order.locId, line.kind);
  S.receive(order.id, order.lines.map((l, i) => ({ productId: l.productId, receivedPacks: i === 0 ? Math.max(0, l.packs - 1) : l.packs, rejectedPacks: 0, invoicePrice: i === 0 ? Math.round(l.price * 1.1 * 100) / 100 : l.price })));
  const after = S.orderById(order.id);
  assert.equal(after.status, 'received');
  assert.deepEqual([...new Set(after.issues.map((i) => i.type))].sort(), line.packs > 0 ? ['price', 'short'] : ['price']);
  const expected = after.lines.reduce((s, l) => s + (l.receivedPacks - l.rejectedPacks) * l.invoicePrice, 0);
  assert.ok(Math.abs(after.invoiceTotal - expected) < 0.01);
  assert.equal(after.docs.upd, 'signed');
  assert.ok(D.stockLevel(order.locId, line.kind) > before - 1e-9 + (line.packs - 1) * pack - 1e-6);
});

test('новый поставщик идёт через согласование, знакомый - нет, цена из тендера сохраняется', () => {
  bootFor('ugol');
  const used = new Set(S.orders().map((o) => o.supplierId));
  const offer = S.state.supply.offers.find((o) => !used.has(o.supplierId) && S.state.supply.suppliers.get(o.supplierId).national);
  const fresh = S.createOrder({ supplierId: offer.supplierId, locId: S.state.ws.locations[0].id, lines: [{ productId: offer.productId, packs: 1 }] });
  assert.equal(fresh.needsApproval, true);
  assert.equal(S.orderById(fresh.id).status, 'approval');
  const known = S.orders().find((o) => o.status === 'delivered');
  const cheapLine = known.lines[0];
  const repeat = S.createOrder({ supplierId: known.supplierId, locId: known.locId, lines: [{ productId: cheapLine.productId, packs: 1, price: 1.23 }] });
  assert.equal(repeat.needsApproval, false);
  assert.equal(repeat.lines[0].price, 1.23, 'цена тендера, а не прайс');
  assert.equal(S.orderById(repeat.id).status, 'sent', 'первую минуту - «отправлен»');
  S.simulateArrival(repeat.id);
  assert.equal(S.orderById(repeat.id).status, 'arrived');
});

test('правило «новый поставщик» можно выключить, отклонение сохраняет комментарий', () => {
  bootFor('pekar');
  S.setSetting('approveNewSuppliers', false);
  const used = new Set(S.orders().map((o) => o.supplierId));
  const offer = S.state.supply.offers.find((o) => !used.has(o.supplierId));
  const order = S.createOrder({ supplierId: offer.supplierId, locId: S.state.ws.locations[0].id, lines: [{ productId: offer.productId, packs: 1 }] });
  assert.equal(order.needsApproval, false);
  S.setSetting('approvalLimit', 1000);
  const big = S.createOrder({ supplierId: offer.supplierId, locId: S.state.ws.locations[0].id, lines: [{ productId: offer.productId, packs: 50 }] });
  assert.equal(big.needsApproval, true);
  S.decide(big.id, 'rejected', 'дорого');
  assert.equal(S.orderById(big.id).status, 'rejected');
});

test('корзина раскладывается на заказы по поставщику и точке', () => {
  bootFor('zerno');
  S.cartClear();
  const [a, b] = S.state.supply.offers.filter((o) => o.supplierId === S.state.supply.offers[0].supplierId).slice(0, 2);
  S.cartAdd(a.productId, a.supplierId, 2, 'msk-pyat');
  S.cartAdd(b.productId, b.supplierId, 1, 'msk-pyat');
  S.cartAdd(a.productId, a.supplierId, 3, 'spb-pet');
  S.cartAdd(a.productId, a.supplierId, 1, 'msk-pyat');
  const groups = S.cartGroups();
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.locId === 'msk-pyat').items.find((i) => i.productId === a.productId).packs, 3);
  S.cartClear();
  assert.equal(S.cartGroups().length, 0);
});

test('битые данные пользователя не роняют кабинет', () => {
  memory.set('zakrom:ws:zerno', '{не json');
  bootFor('zerno');
  assert.deepEqual(S.state.user.orders, []);
  memory.set('zakrom:ws:zerno', JSON.stringify({ v: 1, orders: [{ nope: 1 }], cart: [{ productId: 'нет', supplierId: 'нет', packs: 1 }], decisions: [] }));
  bootFor('zerno');
  assert.deepEqual(S.state.user.orders, []);
  assert.deepEqual(S.state.user.cart, []);
  assert.deepEqual(S.state.user.decisions, {});
});

test('уведомления: типы можно выключить, склад считает рекомендации', () => {
  bootFor('ugol');
  const all = D.alerts();
  assert.ok(all.length > 0);
  S.setSetting('mutedAlerts', [...new Set(all.map((a) => a.type))]);
  assert.equal(D.alerts().length, 0);
  S.setSetting('mutedAlerts', []);
  const rows = D.stockRows(S.state.ws.locations[0].id);
  assert.ok(rows.length > 10);
  for (const r of rows) {
    assert.ok(r.packs >= 0);
    if (r.packs >= r.product.caseSize) assert.equal(r.packs % r.product.caseSize, 0, 'заказ кратен коробке');
  }
});

test('решение по заказу не замораживает его статус, принятое пользователем остаётся на складе назавтра', () => {
  bootFor('zerno');
  // «согласовали» заказ, который и так в пути: статус должен остаться из истории
  const moving = S.orders().find((o) => o.status === 'in_transit' || o.status === 'confirmed');
  S.decide(moving.id, 'approved');
  assert.equal(S.orderById(moving.id).status, moving.status);

  const known = S.orders().find((o) => o.status === 'delivered');
  const line = known.lines[0];
  const order = S.createOrder({ supplierId: known.supplierId, locId: known.locId, lines: [{ productId: line.productId, packs: 3 }] });
  S.simulateArrival(order.id);
  const before = D.stockLevel(known.locId, line.kind);
  S.receive(order.id, [{ productId: line.productId, receivedPacks: 3, rejectedPacks: 0, invoicePrice: line.price }]);
  const added = D.stockLevel(known.locId, line.kind) - before;
  assert.ok(added > 0);
  // наступило завтра: модель про свои заказы пользователя не знает, но остаток от приёмки должен остаться
  const sim = S.state.sim;
  S.state.today = '2026-10-22';
  S.invalidate();
  const stillThere = D.stockLevel(known.locId, line.kind) - (sim.stock.get(known.locId).get(line.kind));
  assert.ok(Math.abs(stillThere - added) < 1e-6);
  S.state.today = TODAY;
  S.invalidate();
});

test('битые настройки уведомлений и лимитов отбрасываются при загрузке', () => {
  memory.set('zakrom:ws:ugol', JSON.stringify({ v: 1, settings: { mutedAlerts: 'всё', approvalLimit: -5 }, rfqs: [{ id: 1 }], decisions: { x: 'да' } }));
  bootFor('ugol');
  assert.equal(S.state.user.settings.mutedAlerts, undefined);
  assert.equal(S.approvalLimit(), S.state.ws.approvalLimit);
  assert.deepEqual(S.state.user.rfqs, []);
  assert.deepEqual(S.state.user.decisions, {});
  assert.ok(Array.isArray(D.alerts()));
});

test('редактирование организации и точек переживает переключение, изолировано и сохраняет историю', () => {
  memory.clear();
  bootFor('zerno');
  const before = JSON.stringify(S.state.sim.orders);
  const loc = S.state.ws.locations[0];
  S.updateProfile({ name: 'Новое Зерно', short: 'Новое', targetFoodCost: 0.33, locations: { [loc.id]: { name: 'Новая точка', address: 'Пример, 1', receivingStart: '09:00', receivingEnd: '13:00' } } });
  assert.equal(S.state.ws.name, 'Новое Зерно');
  assert.equal(S.state.ws.locations[0].address, 'Пример, 1');
  S.selectWorkspace('ugol', { silent: true });
  assert.notEqual(S.state.ws.name, 'Новое Зерно');
  S.selectWorkspace('zerno', { silent: true });
  assert.equal(S.state.ws.short, 'Новое');
  assert.equal(S.state.ws.targetFoodCost, 0.33);
  assert.match(S.locationName(loc.id), /Новая точка/);
  assert.equal(JSON.stringify(S.state.sim.orders), before);
  const team = S.state.ws.team.map((m) => ({ ...m }));
  team[1].name = 'Новый закупщик';
  S.updateProfile({ team });
  assert.throws(() => S.updateProfile({ team: team.filter((m) => !['Владелец', 'Директор'].includes(m.role)) }));
  S.selectWorkspace('zerno', { silent: true });
  assert.equal(S.state.ws.team[1].name, 'Новый закупщик');
  memory.clear();
});

test('корзина и заказ отвергают чужую точку, отсутствующее предложение и нецелое количество', () => {
  bootFor('zerno');
  S.cartClear();
  const offer = S.state.supply.offers[0];
  const locId = S.state.ws.locations[0].id;
  for (const packs of [NaN, Infinity, -1, 0, 1.5, '2', 100001]) {
    assert.throws(() => S.cartAdd(offer.productId, offer.supplierId, packs, locId));
    assert.throws(() => S.createOrder({ supplierId: offer.supplierId, locId, lines: [{ productId: offer.productId, packs }] }));
  }
  assert.throws(() => S.cartAdd(offer.productId, offer.supplierId, 1, 'чужая'));
  assert.throws(() => S.cartAdd('нет', offer.supplierId, 1, locId));
  assert.throws(() => S.createOrder({ supplierId: offer.supplierId, locId: 'чужая', lines: [{ productId: offer.productId, packs: 1 }] }));
  assert.throws(() => S.createOrder({ supplierId: offer.supplierId, locId, lines: [] }));
  assert.equal(S.state.user.cart.length, 0);
  S.cartAdd(offer.productId, offer.supplierId, 100000, locId);
  assert.throws(() => S.cartAdd(offer.productId, offer.supplierId, 1, locId));
  assert.throws(() => S.cartSet(0, Infinity));
  assert.equal(S.state.user.cart[0].packs, 100000);
  S.cartSet(0, 0);
  assert.equal(S.state.user.cart.length, 0);
});

test('частичное оформление сохраняет неоформленные позиции и не дублирует успешные', () => {
  memory.clear();
  bootFor('zerno');
  const offer = S.state.supply.offers[0];
  const [a, b] = S.state.ws.locations;
  S.cartAdd(offer.productId, offer.supplierId, 2, a.id);
  S.state.user.cart.push({ productId: 'несуществующий', supplierId: offer.supplierId, packs: 3, locId: b.id });
  const first = S.checkoutCart();
  assert.equal(first.created.length, 1);
  assert.equal(first.failed.length, 1);
  assert.equal(S.state.user.cart.length, 1);
  assert.equal(S.state.user.cart[0].productId, 'несуществующий');
  assert.equal(S.checkoutCart().created.length, 0);
  assert.equal(S.state.user.orders.length, 1);
  assert.equal(JSON.parse(memory.get('zakrom:ws:zerno')).cart.length, 1);
  memory.clear();
});

test('повтор заказа и автозаказ добавляются атомарно с одной перерисовкой', () => {
  memory.clear();
  bootFor('zerno');
  const offer = S.state.supply.offers[0];
  const item = { productId: offer.productId, supplierId: offer.supplierId, packs: 2, locId: S.state.ws.locations[0].id };
  let changes = 0;
  const off = S.onChange((reason) => { if (reason === 'cart') changes += 1; });
  assert.throws(() => S.cartAddMany([item, { ...item, productId: 'нет' }]));
  assert.equal(S.state.user.cart.length, 0);
  assert.equal(changes, 0);
  S.cartAddMany([item, item]);
  assert.equal(S.state.user.cart[0].packs, 4);
  assert.equal(changes, 1);
  off();
  memory.clear();
});

test('список организаций для меню и поиска использует сохранённые реквизиты', () => {
  memory.clear();
  bootFor('zerno');
  S.updateProfile({ short: 'Новое Зерно', name: 'Кофейни после переименования' });
  S.selectWorkspace('ugol', { silent: true });
  S.updateProfile({ short: 'Новый Уголь' });
  const list = S.workspaces();
  assert.equal(list.length, 3);
  assert.equal(list.find((ws) => ws.id === 'zerno').short, 'Новое Зерно');
  assert.equal(list.find((ws) => ws.id === 'zerno').name, 'Кофейни после переименования');
  assert.equal(list.find((ws) => ws.id === 'ugol').short, 'Новый Уголь');
  assert.equal(list.find((ws) => ws.id === 'pekar').short, 'Северный пекарь');
  S.selectWorkspace('zerno', { silent: true });
  assert.equal(S.workspaces().find((ws) => ws.id === 'ugol').short, 'Новый Уголь');
  memory.clear();
});
