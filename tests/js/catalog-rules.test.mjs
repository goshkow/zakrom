import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, cleanBrand, cleanText, isPrivateLabel, classifyOsm, matchBrandEntity, normalizeWebsite, displayName, groupsFromText, commonsLogoUrl } from '../../tools/catalog-rules.mjs';

test('фасовка: граммы, литры, штуки и «6 x 200 г»', () => {
  assert.deepEqual(parseQuantity('2 кг', 'кг'), { amount: 2 });
  assert.deepEqual(parseQuantity('900 г', 'кг'), { amount: 0.9 });
  assert.deepEqual(parseQuantity('0,9 л', 'л'), { amount: 0.9 });
  assert.deepEqual(parseQuantity('6 x 200 г', 'кг'), { amount: 1.2 });
  assert.deepEqual(parseQuantity('10 шт', 'шт'), { amount: 10 });
  assert.deepEqual(parseQuantity('Биойогурт 130г', 'кг'), { amount: 0.13 });
  // литр ≈ килограмм для соусов и молочки
  assert.deepEqual(parseQuantity('1 л', 'кг'), { amount: 1 });
});

test('фасовка: мусор и неправдоподобные значения отбрасываются', () => {
  assert.equal(parseQuantity('1000', 'л'), null);
  assert.equal(parseQuantity(undefined, 'кг'), null);
  assert.equal(parseQuantity('5 г', 'кг'), null, 'меньше 50 г - не опт');
  assert.equal(parseQuantity('100 кг', 'кг'), null);
  assert.equal(parseQuantity('2 кг', 'шт'), null, 'вес для штучного товара');
  assert.equal(parseQuantity('2 гарнитура', 'кг'), null, 'единица должна быть отдельным словом');
});

test('бренд и текст: html-сущности, ООО и кавычки', () => {
  assert.equal(cleanText('Майонез &quot;Провансаль&quot;  67%'), 'Майонез "Провансаль" 67%');
  assert.equal(cleanBrand('ООО «Карачиха», Другое'), 'Карачиха');
  assert.equal(cleanBrand('Д'), '');
  assert.equal(cleanBrand('12345'), '');
});

test('собственные марки сетей не попадают в B2B-каталог', () => {
  assert.equal(isPrivateLabel('Красная цена'), true);
  assert.equal(isPrivateLabel('ВкусВилл'), true);
  assert.equal(isPrivateLabel('Простоквашино'), false);
});

test('OSM: опт, производство, упаковка и не наш профиль', () => {
  assert.equal(classifyOsm('METRO', { shop: 'wholesale' }).type, 'distributor');
  assert.deepEqual(classifyOsm('Лианозовский молочный комбинат', { man_made: 'works' }), { type: 'producer', groups: ['dairy'], note: 'Молочное производство' });
  assert.equal(classifyOsm('Самарская картонная упаковка', { man_made: 'works' }).type, 'packaging');
  assert.equal(classifyOsm('Сокольнический вагоноремонтно-строительный завод', { man_made: 'works' }), null);
  assert.equal(classifyOsm('Стройбаза', { shop: 'wholesale' }), null);
  // «унитарное» содержит «тарн» - раньше это давало ложную упаковку
  assert.equal(classifyOsm('ОПХ', { man_made: 'works', description: 'Государственное унитарное предприятие' }), null);
  // хлеб сети пекут сами: хлебозавод поставщиком не считаем
  assert.equal(classifyOsm('Булочно-кондитерский комбинат', { man_made: 'works' }), null);
  assert.equal(classifyOsm('Обжарочный цех', { craft: 'coffee_roaster' }).note, 'Обжарка кофе');
});

test('группы по тексту без \\b: кириллица не ломает границы слов', () => {
  assert.deepEqual(groupsFromText('Чайная фабрика'), ['drinks']);
  assert.deepEqual(groupsFromText('Сокольники'), []);
  assert.deepEqual(groupsFromText('Мясокомбинат и рыбный цех'), ['meat']);
});

test('Wikidata: бренд -> российская компания, тёзки отсекаются', () => {
  const entities = {
    Q1: { id: 'Q1', label: 'Красный Октябрь', description: 'завод в Волгограде', instanceOf: ['Q83405'], country: ['Q159'] },
    Q2: { id: 'Q2', label: 'Красный Октябрь', description: 'кондитерская фабрика в Москве', instanceOf: ['Q83405'], country: ['Q159'] },
    Q3: { id: 'Q3', label: 'Alpen Gold', description: 'торговая марка шоколада', instanceOf: ['Q167270'], country: ['Q159'], owner: [] },
    Q4: { id: 'Q4', label: 'Простоквашино', description: 'торговая марка', instanceOf: ['Q167270'], country: ['Q159'], owner: ['Q5'] },
    Q5: { id: 'Q5', label: 'Данон Россия', description: 'производитель молочной продукции', instanceOf: ['Q4830453'], country: ['Q159'] },
    Q6: { id: 'Q6', label: 'Heinz', description: 'food company', instanceOf: ['Q4830453'], country: ['Q30'] },
  };
  assert.equal(matchBrandEntity('Красный Октябрь', ['Q1', 'Q2'], entities).company.id, 'Q2');
  assert.equal(matchBrandEntity('Alpen Gold', ['Q3'], entities), null, 'марка без владельца - не поставщик');
  assert.equal(matchBrandEntity('Простоквашино', ['Q4'], entities).company.id, 'Q5');
  assert.equal(matchBrandEntity('Heinz', ['Q6'], entities), null, 'берём только российские компании');
  assert.equal(matchBrandEntity('Д', ['Q2'], entities), null);
});

test('сайт: добавляем https и не пропускаем javascript:', () => {
  assert.equal(normalizeWebsite('mikoyan.ru'), 'https://mikoyan.ru');
  assert.equal(normalizeWebsite('http://www.rotfront.ru/'), 'http://www.rotfront.ru');
  assert.equal(normalizeWebsite('javascript:alert(1)'), null);
  assert.equal(normalizeWebsite('localhost'), null);
});

test('названия из Wikidata и ссылки на логотипы', () => {
  assert.equal(displayName('Бабаевский (концерн)'), 'Концерн «Бабаевский»');
  assert.equal(displayName('Липецкий (молочный комбинат)'), 'Липецкий молочный комбинат');
  assert.equal(displayName('Окраина (производитель мясной гастрономии)'), 'Окраина');
  assert.equal(commonsLogoUrl('Logo Petmol.svg'), 'https://commons.wikimedia.org/wiki/Special:FilePath/Logo_Petmol.svg?width=128');
  assert.equal(commonsLogoUrl(''), null);
});
