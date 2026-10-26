import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, viewKey } from '../../js/app/router.js';
import { quietly, animate } from '../../js/ui/motion.js';
import { normalizeProfile, applyProfile } from '../../js/model/profile.js';
import { WORKSPACE_BY_ID } from '../../js/model/workspaces.js';

const base = WORKSPACE_BY_ID.zerno;

test('карточка товара и окно тендера не меняют страницу, фильтры и организация меняют', () => {
  const key = (hash, ws = 'zerno') => viewKey(parseRoute(hash), ws);
  assert.equal(key('#/catalog?q=сметана'), key('#/catalog?p=123&q=сметана'));
  assert.notEqual(key('#/catalog?q=сметана'), key('#/catalog?q=молоко'));
  assert.notEqual(key('#/catalog'), key('#/catalog', 'ugol'));
  assert.equal(key('#/rfq'), key('#/rfq?new=1&product=123&supplier=x&item=молоко'));
  assert.notEqual(key('#/rfq'), key('#/rfq/123'));
  assert.notEqual(key('#/settings/team'), key('#/settings/general'));
});

test('вложенная тихая отрисовка и исключения сохраняют режим анимаций', () => {
  assert.equal(animate(), true);
  quietly(() => {
    assert.equal(animate(), false);
    quietly(() => assert.equal(animate(), false));
    assert.equal(animate(), false);
  });
  assert.throws(() => quietly(() => { throw new Error('ошибка'); }));
  assert.equal(animate(), true);
});

test('реквизиты не меняют ID точек, города, веса и исходную организацию', () => {
  const source = JSON.stringify(base);
  const loc = base.locations[0];
  const ws = applyProfile(base, { id: 'ugol', seed: 'другой', name: 'Новое имя', targetFoodCost: 0.35, locations: { [loc.id]: { id: 'другой', city: 'другой', weight: 100, name: 'Точка 1', address: 'Пример, 1', receivingStart: '09:00', receivingEnd: '13:00' }, чужая: { name: 'Не наша' } } });
  assert.equal(ws.id, base.id);
  assert.equal(ws.seed, base.seed);
  assert.equal(ws.locations[0].id, loc.id);
  assert.equal(ws.locations[0].city, loc.city);
  assert.equal(ws.locations[0].weight, loc.weight);
  assert.equal(ws.locations[0].address, 'Пример, 1');
  assert.equal(ws.targetFoodCost, 0.35);
  assert.equal(ws.locations.length, base.locations.length);
  assert.equal(JSON.stringify(base), source);
});

test('битые реквизиты и недопустимые часы приёмки отбрасываются', () => {
  const loc = base.locations[0];
  const profile = normalizeProfile({ name: {}, short: '', targetFoodCost: Infinity, locations: { [loc.id]: { name: [], receivingStart: '22:00', receivingEnd: '08:00' } } }, base);
  assert.equal(profile.name, undefined);
  assert.equal(profile.targetFoodCost, undefined);
  assert.equal(profile.locations[loc.id].receivingStart, undefined);
  assert.deepEqual(normalizeProfile([], base), {});
});

test('команда: нельзя убрать последнего владельца, повторить почту или сохранить пустое имя', () => {
  const owner = { name: 'Владелец', role: 'Владелец', email: 'OWNER@example.test' };
  const buyer = { name: 'Закупщик', role: 'Закупщик', email: 'buyer@example.test' };
  assert.equal(normalizeProfile({ team: [owner, buyer] }, base).team[0].email, 'owner@example.test');
  for (const team of [[], [buyer], [owner, { ...buyer, email: owner.email.toLowerCase() }], [owner, { ...buyer, name: ' ' }], [owner, { ...buyer, email: 'нет' }]]) assert.equal(normalizeProfile({ team }, base).team, undefined);
});

test('отложенный поиск не меняет страницу после перехода или открытия карточки', async () => {
  const { debounce } = await import('../../js/core/dom.js');
  const previous = globalThis.location;
  globalThis.location = { hash: '#/catalog' };
  const calls = [];
  const search = debounce((value) => calls.push(value), 5);
  try {
    search('сметана');
    globalThis.location.hash = '#/catalog?p=123';
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(calls, []);
    search('молоко');
    search('сыр');
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(calls, ['сыр']);
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});
