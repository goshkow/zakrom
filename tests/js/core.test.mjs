import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rub, rubShort, pct, plural, countOf, addDays, diffDays, dayHuman, parseDay, initials, relTime, axisShort } from '../../js/core/format.js';
import { hash, unit, stream } from '../../js/core/rng.js';
import { csvCell, toCsv } from '../../js/core/csv.js';
import { isValidGtin, parseOffProduct, lookupBarcode } from '../../js/core/off.js';
import { periodRange, filterOrders, supplierScore, payments, basketIndex, streak } from '../../js/model/analytics.js';

const NB = '\u00a0';
// разделитель разрядов зависит от версии ICU (U+00A0 или U+202F): сравниваем без разницы между ними
const G = NB;
const same = (a, b) => assert.equal(a.replace(/\u202f/g, NB), b);

test('деньги и проценты по-русски', () => {
  same(rub(1234567.4), `1${G}234${G}567${NB}₽`);
  assert.equal(rubShort(2_960_000), `2,96${NB}млн${NB}₽`);
  assert.equal(rubShort(43_210), `43${NB}тыс.${NB}₽`);
  assert.equal(rubShort(950), `950${NB}₽`);
  assert.equal(pct(0.0549), `5,5${NB}%`);
  assert.equal(pct(-0.031, { sign: true }), `−3,1${NB}%`);
  assert.equal(pct(0.0001, { sign: true }), `0,0${NB}%`);
  assert.equal(axisShort(150000), `150${NB}тыс`);
});

test('склонения и даты', () => {
  assert.equal(plural(1, ['заказ', 'заказа', 'заказов']), 'заказ');
  assert.equal(plural(12, ['заказ', 'заказа', 'заказов']), 'заказов');
  assert.equal(countOf(22, ['день', 'дня', 'дней']), `22${NB}дня`);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-03-01', '2026-02-27'), 2);
  assert.equal(dayHuman('2026-10-22', '2026-10-21'), 'завтра');
  assert.equal(parseDay('2026-02-30'), null);
  assert.equal(initials('Кофейни «Зерно»'), 'КЗ');
  assert.equal(relTime(Date.now() - 5 * 60000), `5${NB}мин назад`);
});

test('случайность детерминирована', () => {
  assert.equal(hash('зерно'), hash('зерно'));
  assert.notEqual(hash('зерно'), hash('уголь'));
  const u = unit('x');
  assert.ok(u >= 0 && u < 1);
  const a = stream('seed');
  const b = stream('seed');
  for (let i = 0; i < 5; i += 1) assert.equal(a.next(), b.next());
});

test('CSV: кавычки, переносы и защита от формул Excel', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+7 495'), "'+7 495");
  assert.equal(csvCell('-12,5'), '-12,5', 'отрицательное число остаётся числом');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell(null), '');
  assert.equal(toCsv(['a', 'b'], [[1, 'x\ny']]), 'a;b\r\n1;"x\ny"');
});

test('штрихкод: контрольная цифра и разбор ответа Open Food Facts', () => {
  assert.equal(isValidGtin('4601780002565'), true);
  assert.equal(isValidGtin('4601780002566'), false);
  assert.equal(isValidGtin('12'), false);
  const raw = JSON.parse(readFileSync(new URL('./fixtures/off-product-3017620422003.json', import.meta.url), 'utf8'));
  const parsed = parseOffProduct(raw, '3017620422003');
  assert.equal(parsed.found, true);
  assert.ok(parsed.name.length > 0);
  assert.equal(parseOffProduct({ status: 0 }, '1').found, false);
});

test('штрихкод: сеть, лимит и неверный код', async () => {
  let calls = 0;
  const ok = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ status: 1, product: { product_name_ru: 'Мука', brands: 'Макфа', quantity: '2 кг' } }) }; };
  assert.equal((await lookupBarcode('4601780002566', { fetchImpl: ok })).status, 'invalid');
  assert.equal(calls, 0, 'неверный код не уходит в сеть');
  const found = await lookupBarcode('4601780002565', { fetchImpl: ok });
  assert.equal(found.status, 'found');
  assert.equal(found.product.name, 'Мука');
  assert.equal((await lookupBarcode('4601780002565', { fetchImpl: async () => ({ ok: false, status: 429 }) })).status, 'busy');
  assert.equal((await lookupBarcode('4601780002565', { fetchImpl: async () => { throw new Error('offline'); } })).status, 'error');
});

test('аналитика: периоды, фильтр, OTIF, оплаты, индекс корзины', () => {
  assert.deepEqual(periodRange('mtd', '2026-10-21'), { from: '2026-10-01', to: '2026-10-21', length: 21, prevFrom: '2026-09-10', prevTo: '2026-09-30' });
  assert.equal(periodRange('prev', '2026-10-21').from, '2026-09-01');
  assert.equal(periodRange('prev', '2026-10-21').to, '2026-09-30');
  const base = { lines: [{ kind: 'milk', productId: 'p', packs: 2, price: 100, invoicePrice: 100, receivedPacks: 2, rejectedPacks: 0 }], total: 200, payment: { dueDay: '2026-10-10', paidDay: null, amount: 200 } };
  const orders = [
    { ...base, id: '1', supplierId: 's', createdDay: '2026-10-01', status: 'delivered', late: 0, issues: [], deliveredDay: '2026-10-02', expectedDay: '2026-10-02' },
    { ...base, id: '2', supplierId: 's', createdDay: '2026-10-03', status: 'delivered', late: 1, issues: [], deliveredDay: '2026-10-05', expectedDay: '2026-10-04' },
    { ...base, id: '3', supplierId: 's', createdDay: '2026-10-04', status: 'cancelled', late: 0, issues: [] },
    { ...base, id: '4', supplierId: 's', createdDay: '2026-10-05', status: 'delivered', late: 0, issues: [{ type: 'short' }], deliveredDay: '2026-10-06', expectedDay: '2026-10-06', payment: { dueDay: '2026-10-30', paidDay: null, amount: 200 } },
  ];
  assert.equal(filterOrders(orders, { from: '2026-10-01', to: '2026-10-31' }).length, 3, 'отменённые не считаем');
  const score = supplierScore(orders, 's', '2026-10-01', '2026-10-31');
  assert.equal(score.n, 3);
  assert.ok(Math.abs(score.otif - 1 / 3) < 1e-9);
  const pay = payments(orders, '2026-10-21');
  assert.equal(pay.overdue.length, 2);
  assert.equal(pay.upcoming.length, 1);
  const market = { index: (kind, day) => (day === '2026-01-15' ? 1 : 1.1) };
  const idx = basketIndex(orders, market, ['2026-01-15', '2026-02-15']);
  assert.equal(idx[0], 100);
  assert.ok(Math.abs(idx[1] - 110) < 1e-9);
  assert.equal(streak(new Map([['2026-10-01', {}], ['2026-10-02', {}], ['2026-10-04', {}]]), '2026-10-05'), 2);
});
