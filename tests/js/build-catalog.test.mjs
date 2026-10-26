import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProducts, buildOsmSuppliers, buildManufacturers, mergeDuplicates, classifyProduct, validate, buildAll } from '../../tools/build-catalog.mjs';

const img = (code) => `https://images.openfoodfacts.org/images/products/${code}/front.200.jpg`;
const off = {
  products: [
    { code: '1', product_name_ru: 'Сметана 20%', brands: 'Простоквашино', quantity: '315 г', image_front_small_url: img(1), _tag: 'creams', unique_scans_n: 9 },
    { code: '2', product_name_ru: 'Молоко 3,2%', brands: 'Красная цена', quantity: '1 л', image_front_small_url: img(2), _tag: 'milks', unique_scans_n: 8 },
    { code: '3', product_name_ru: 'Мука пшеничная в/с', brands: 'Макфа', quantity: '2 kg', image_front_small_url: img(3), _tag: 'flours', unique_scans_n: 7 },
    { code: '4', product_name_ru: 'Батончик злаковый', brands: 'Бренд', quantity: '30 г', image_front_small_url: img(4), _tag: 'flours', unique_scans_n: 6 },
    { code: '5', product_name_ru: 'Мука пшеничная в/с', brands: 'Макфа', quantity: '2 kg', image_front_small_url: img(5), _tag: 'flours', unique_scans_n: 5 },
    { code: '6', product_name_ru: 'Йогурт клубника', brands: 'Чудо', quantity: '', image_front_small_url: 'http://evil.example/x.jpg', _tag: 'yogurts', unique_scans_n: 4 },
  ],
};

test('товары: вид по названию, СТМ и дубли отсеиваются, фото только с OFF', () => {
  const { products, rejected } = buildProducts(off);
  const fromOff = products.filter((p) => p.source === 'off');
  assert.deepEqual(fromOff.map((p) => p.id), ['1', '3']);
  assert.equal(fromOff[0].kind, 'sour_cream', 'сметана из категории «сливки»');
  assert.equal(fromOff[1].pack, 2);
  assert.equal(rejected.privateLabel, 1);
  assert.equal(rejected.duplicate, 1);
  assert.ok(products.some((p) => p.source === 'generic' && p.kind === 'cup_350'), 'типовые позиции добавлены');
});

test('вид уточняется только внутри группы', () => {
  assert.equal(classifyProduct('Творог 9%', 'cheese'), 'cottage_cheese');
  assert.equal(classifyProduct('Сыр творожный сливочный', 'cheese'), 'cream_cheese');
  assert.equal(classifyProduct('Шоколад молочный', 'milk'), null);
});

test('OSM -> поставщики, повторы по имени и городу схлопываются', () => {
  const osm = { elements: [
    { type: 'node', id: 1, lat: 55.75, lon: 37.6, timestamp: '2025-01-02T00:00:00Z', _city: 'Москва', tags: { name: 'Лианозовский молочный комбинат', man_made: 'works', phone: '+7 495 000-00-00;+7 495 111-11-11', website: 'lmk.ru' } },
    { type: 'way', id: 2, center: { lat: 55.7, lon: 37.5 }, _city: 'Москва', tags: { name: 'Лианозовский молочный комбинат', man_made: 'works' } },
    { type: 'node', id: 3, lat: 1, lon: 1, _city: 'Москва', tags: { name: 'Автозапчасти', shop: 'wholesale' } },
  ] };
  const list = buildOsmSuppliers(osm);
  assert.equal(list.length, 1);
  assert.equal(list[0].phone, '+7 495 000-00-00');
  assert.equal(list[0].website, 'https://lmk.ru');
  assert.equal(list[0].sourceUrl, 'https://www.openstreetmap.org/node/1');
  assert.equal(list[0].checkedAt, '2025-01-02');
});

test('завод из Wikidata и OSM становится одним поставщиком', () => {
  const manufacturers = [{ id: 'wd-Q1', name: 'Лианозовский молочный комбинат', groups: ['dairy'], city: 'Восточное Дегунино', address: null, coords: null, website: null, phone: null, email: null, osm: null }];
  const local = [{ id: 'osm-node-1', name: 'Лианозовский молочный комбинат', groups: ['dairy'], city: 'Москва', address: 'Угличская, 13', coords: { lat: 1, lon: 2 }, website: 'https://x.ru', phone: '+7', email: null, osm: { type: 'node', id: 1 } }, { id: 'osm-node-2', name: 'Другой завод', groups: ['meat'], city: 'Москва' }];
  const rest = mergeDuplicates(manufacturers, local);
  assert.deepEqual(rest.map((s) => s.id), ['osm-node-2']);
  assert.equal(manufacturers[0].city, 'Москва');
  assert.equal(manufacturers[0].address, 'Угличская, 13');
});

test('производители по брендам и отраслям', () => {
  const { products } = buildProducts(off);
  const wikidata = {
    fetchedAt: '2026-10-21T00:00:00Z',
    candidates: { Простоквашино: ['Q4'] },
    entities: {
      Q4: { id: 'Q4', label: 'Простоквашино', description: 'торговая марка', instanceOf: ['Q167270'], country: ['Q159'], owner: ['Q5'] },
      Q5: { id: 'Q5', label: 'Данон Россия', description: 'производитель молочной продукции', instanceOf: ['Q4830453'], country: ['Q159'], hq: ['Q649'] },
      Q649: { id: 'Q649', label: 'Москва', country: ['Q159'] },
      Q7: { id: 'Q7', label: 'Томские мельницы', description: '', instanceOf: ['Q4830453'], country: ['Q159'], industry: ['Q540912'] },
      Q8: { id: 'Q8', label: 'Балтика', description: 'пивоваренная компания', instanceOf: ['Q4830453'], country: ['Q159'], industry: ['Q4899370'] },
    },
    industryCompanies: ['Q7', 'Q8'],
    industryGroups: { Q540912: 'food', Q4899370: 'drinks' },
  };
  const { suppliers, brandToSupplier } = buildManufacturers(products, wikidata);
  assert.equal(brandToSupplier['Простоквашино'], 'wd-Q5');
  const danone = suppliers.find((s) => s.id === 'wd-Q5');
  assert.equal(danone.city, 'Москва');
  assert.deepEqual(danone.groups, ['dairy']);
  assert.ok(suppliers.some((s) => s.id === 'wd-Q7' && s.groups.includes('grocery')), 'мельница из отраслевого запроса');
  assert.ok(!suppliers.some((s) => s.id === 'wd-Q8'), 'пиво в закупки общепита не берём');
});

test('проверка каталога ловит повторы и битые ссылки', () => {
  const { catalog } = buildAll({ off, wikidata: null, osm: null, fx: null, commodities: null });
  assert.deepEqual(validate(catalog), []);
  catalog.products.push({ ...catalog.products[0] });
  catalog.brandToSupplier.X = 'wd-нет';
  const errors = validate(catalog);
  assert.ok(errors.some((e) => e.startsWith('повтор товара')));
  assert.ok(errors.some((e) => e.startsWith('бренд X')));
});
