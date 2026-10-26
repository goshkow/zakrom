import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarket, shiftMonth, monthsBetween } from '../../js/model/market.js';
import { KINDS } from '../../js/model/kinds.js';
import { WORKSPACES, kindsUsed } from '../../js/model/workspaces.js';
import { addDays, diffDays } from '../../js/core/format.js';
import { world, TODAY, marketRaw } from './helpers.mjs';

test('месяцы: сдвиг через год и разница', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2025-12', 2), '2026-02');
  assert.equal(monthsBetween('2026-10', '2025-10'), 12);
});

test('индекс цены: сегодня 1, биржевой вид идёт за рублёвой ценой с лагом и долей beta', () => {
  const fake = {
    fx: { series: { USD: [['2026-08-10', 80], ['2026-09-10', 80], ['2026-10-10', 80]] } },
    commodities: { series: { wheat: { unit: '($/mt)', points: [['2026-07', 200], ['2026-08', 200], ['2026-09', 300]] } } },
  };
  const market = createMarket(fake, '2026-10-21');
  assert.equal(market.index('flour', '2026-10-21'), 1);
  // в октябре прайс опирается на сентябрь (300), в сентябре - на август (200): 1 + 0.45 × (200/300 - 1)
  const sept = market.index('flour', '2026-09-15');
  const expected = (1 + 0.0055) ** -1 * (1 + KINDS.flour.beta * (200 / 300 - 1));
  assert.ok(Math.abs(sept - expected) < 0.012, `${sept} ≈ ${expected}`);
  assert.ok(market.index('milk', '2025-10-15') < 1, 'без биржи - общий рост цен, год назад дешевле');
  assert.equal(market.index('milk', '2027-01-01'), 1, 'будущее не прогнозируем');
});

test('рубли за сырьё: доллар × средний курс месяца', () => {
  const market = createMarket(marketRaw, TODAY);
  const row = market.commodityTable('wheat', 3).at(-1);
  assert.ok(row.rub > row.usd * 50 && row.rub < row.usd * 150);
});

for (const ws of WORKSPACES) {
  test(`${ws.short}: каждому виду из техкарт есть поставщик в городах сети`, () => {
    const { supply, sim } = world(ws.id);
    for (const loc of ws.locations) {
      const assign = sim.assignments.get(loc.id);
      for (const kind of kindsUsed(ws)) assert.ok(assign.has(kind), `${loc.id}: нет поставщика для ${kind}`);
      for (const a of assign.values()) {
        const s = supply.suppliers.get(a.supplierId);
        assert.ok(s.national || s.city === loc.city, `${s.name} не возит в ${loc.city}`);
      }
    }
  });

  test(`${ws.short}: история заказов согласована`, () => {
    const { supply, sim } = world(ws.id);
    assert.ok(sim.orders.length > 100);
    for (const o of sim.orders) {
      assert.ok(o.createdDay >= sim.start && o.createdDay <= TODAY);
      assert.ok(o.expectedDay >= o.createdDay);
      const sum = o.lines.reduce((s, l) => s + l.packs * l.price, 0);
      assert.ok(Math.abs(sum - o.total) < 0.02, `сумма заказа ${o.id}`);
      assert.ok(supply.suppliers.has(o.supplierId));
      if (o.status === 'delivered') {
        assert.ok(o.deliveredDay < TODAY);
        assert.ok(o.payment.dueDay >= o.createdDay);
      } else {
        assert.equal(o.deliveredDay, null);
        assert.equal(o.late, 0, 'будущее опоздание не должно быть видно заранее');
      }
      if (o.status !== 'delivered' && o.status !== 'arrived') assert.equal(o.issues.length, 0);
    }
  });

  test(`${ws.short}: фудкост и дефициты правдоподобны`, () => {
    const { sim } = world(ws.id);
    const from = addDays(TODAY, -30);
    let spend = 0;
    let revenue = 0;
    for (const o of sim.orders) if (o.createdDay >= from) spend += o.total;
    for (const [day, r] of sim.revenue) if (day >= from) revenue += r.total;
    const fc = spend / revenue;
    assert.ok(fc > 0.15 && fc < 0.5, `фудкост ${fc}`);
    const kinds = kindsUsed(world(ws.id).ws).length;
    const locDays = ws.locations.length * diffDays(TODAY, ws.since) * kinds;
    assert.ok(sim.stockouts.length / locDays < 0.01, `дефицитов ${sim.stockouts.length} на ${locDays} точко-дней`);
  });
}

test('история детерминирована: тот же день - те же заказы', () => {
  const a = world('ugol');
  const b = world('ugol', '2026-10-21');
  assert.equal(a, b);
  const fresh = world('ugol', '2026-10-22');
  // завтрашний день добавляет заказы, но не переписывает прошлое: ни номера, ни суммы, ни даты оплат
  const past = (list) => list.filter((o) => o.createdDay <= '2026-10-21').map((o) => `${o.id}|${o.total}|${o.createdDay}`).join();
  assert.equal(past(a.sim.orders), past(fresh.sim.orders));
  // оплата, которая вчера уже была видна, завтра не меняет день; новых «оплачен задним числом» не появляется
  const paidMap = new Map(fresh.sim.orders.map((o) => [o.id, o.payment.paidDay]));
  for (const o of a.sim.orders) {
    if (o.payment.paidDay) assert.equal(paidMap.get(o.id), o.payment.paidDay, o.id);
    else if (paidMap.get(o.id)) assert.ok(paidMap.get(o.id) >= '2026-10-21', `${o.id} оплачен задним числом`);
  }
});

test('цена предложения: месячные ступеньки, на сегодня без шума', () => {
  const { supply } = world('pekar');
  const offer = supply.offersByKind.get('flour')[0];
  assert.equal(supply.priceAt(offer, '2026-10-01'), supply.priceAt(offer, TODAY));
  assert.equal(supply.priceAt(offer, '2026-05-03'), supply.priceAt(offer, '2026-05-28'));
  const best = supply.bestOffer('flour', TODAY);
  for (const o of supply.offersByKind.get('flour')) assert.ok(supply.unitPriceAt(o, TODAY) >= best.price - 1e-9);
});

test('смена месяца не переписывает цены старых заказов', () => {
  const oct = world('zerno', '2026-10-21');
  const nov = world('zerno', '2026-11-05');
  const offer = oct.supply.offersByKind.get('milk')[0];
  const same = nov.supply.offers.find((o) => o.id === offer.id);
  assert.equal(oct.supply.priceAt(offer, '2026-06-10'), nov.supply.priceAt(same, '2026-06-10'));
  const sample = (w) => w.sim.orders.filter((o) => o.createdDay < '2026-10-01').slice(-50).map((o) => `${o.id}|${o.total}`).join();
  assert.equal(sample(oct), sample(nov));
});

test('сравнение: первым идёт тот, кто сильнее по весам, причины - реальные плюсы', async () => {
  const { rankSuppliers } = await import('../../js/model/compare.js');
  const a = { id: 'a', otif: 0.95, leadDays: 1, minOrder: 5000, paymentDays: 14, certCount: 3, local: 1 };
  const b = { id: 'b', otif: 0.88, leadDays: 3, minOrder: 40000, paymentDays: 0, certCount: 2, local: 0 };
  const r = rankSuppliers([b, a]);
  assert.equal(r[0].id, 'a');
  assert.ok(r[0].reasons.length > 0 && r[0].reasons.length <= 2);
  assert.deepEqual(rankSuppliers([a])[0].reasons, []);
  assert.deepEqual(rankSuppliers([]), []);
});

test('у каждого поставщика есть документы, и набор не меняется между запусками', () => {
  const { supply } = world('zerno');
  const again = world('zerno').supply;
  for (const s of supply.suppliers.values()) {
    assert.ok(s.terms.certs.length >= 1, s.name);
    assert.deepEqual(s.terms.certs, again.suppliers.get(s.id).terms.certs);
  }
});
