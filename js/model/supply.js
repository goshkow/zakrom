// поставщики, товары и предложения для одной организации песочницы
// компании и товары настоящие (каталог из открытых данных), а условия и цены - модель:
// их нет в открытых источниках, поэтому интерфейс везде подписывает их как данные песочницы
import { KINDS, GROUP_BY_ID, GENERIC_BY_KIND } from './kinds.js';
import { between, unit } from '../core/rng.js';
import { initials } from '../core/format.js';
import { citiesOf } from './workspaces.js';

export const TYPE_LABELS = {
  manufacturer: 'Производитель',
  producer: 'Производство',
  distributor: 'Дистрибьютор',
  packaging: 'Упаковка',
};

const EDO = ['Диадок', 'СБИС', 'Такском', 'Калуга Астрал'];
const CASH_CARRY = /metro|метро|selgros|селгрос/i;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function baseTerms(s) {
  const h = (k) => `${s.id}|${k}`;
  const cashCarry = CASH_CARRY.test(s.name);
  if (s.type === 'manufacturer') {
    return {
      minOrder: Math.round(between(h('min'), 35, 90)) * 1000,
      leadDays: 2 + Math.round(between(h('lead'), 0, 2)),
      deliveryDays: unit(h('days')) < 0.5 ? [2, 4] : [1, 4],
      paymentDays: 30,
      edo: EDO[Math.floor(unit(h('edo')) * 3)],
      otif: between(h('otif'), 0.9, 0.975),
      cashCarry: false,
    };
  }
  if (s.type === 'distributor') {
    return cashCarry
      ? { minOrder: 5000, leadDays: 1, deliveryDays: [1, 2, 3, 4, 5, 6], paymentDays: 0, edo: 'СБИС', otif: between(h('otif'), 0.93, 0.975), cashCarry: true }
      : { minOrder: Math.round(between(h('min'), 10, 16)) * 1000, leadDays: 1, deliveryDays: [1, 3, 5], paymentDays: 7, edo: EDO[Math.floor(unit(h('edo')) * 4)], otif: between(h('otif'), 0.85, 0.95), cashCarry: false };
  }
  if (s.type === 'packaging') {
    return { minOrder: Math.round(between(h('min'), 12, 30)) * 1000, leadDays: 2 + Math.round(between(h('lead'), 0, 3)), deliveryDays: [3], paymentDays: 14, edo: EDO[Math.floor(unit(h('edo')) * 4)], otif: between(h('otif'), 0.88, 0.97), cashCarry: false };
  }
  return { minOrder: Math.round(between(h('min'), 8, 20)) * 1000, leadDays: 1, deliveryDays: [1, 3, 5], paymentDays: 14, edo: EDO[Math.floor(unit(h('edo')) * 4)], otif: between(h('otif'), 0.86, 0.96), cashCarry: false };
}

// какие документы у компании «есть»: в открытых данных их нет, поэтому набор моделируется по типу
export function supplierCerts(s) {
  const h = (k) => `${s.id}|${k}`;
  if (s.type === 'packaging') return ['Декларация ТР ТС 005/2011', 'Допуск к контакту с пищей'];
  const list = ['Декларация ТР ТС 021/2011'];
  if (s.type === 'manufacturer' || s.type === 'producer') list.push('ХАССП');
  if (unit(h('iso')) > 0.55 && s.type !== 'distributor') list.push('ISO 22000');
  if (s.groups.some((g) => g === 'dairy' || g === 'meat')) list.push('ВСД в Меркурии');
  return list;
}

export function supplierTerms(s) {
  return { ...baseTerms(s), certs: supplierCerts(s) };
}

function supplierFactor(s) {
  const id = s.id;
  if (s.type === 'manufacturer') return between(`${id}|f`, 0.9, 0.97);
  if (s.type === 'producer') return between(`${id}|f`, 0.93, 1.01);
  if (s.type === 'packaging') return between(`${id}|f`, 0.95, 1.05);
  return CASH_CARRY.test(s.name) ? between(`${id}|f`, 1.06, 1.12) : between(`${id}|f`, 1.03, 1.15);
}

export function defaultCase(product) {
  if (product.caseSize) return product.caseSize;
  if (product.unit === 'шт') return product.pack >= 30 ? 1 : 10;
  if (product.pack <= 0.3) return 24;
  if (product.pack <= 1.05) return 12;
  if (product.pack <= 3) return 6;
  return 1;
}

function basePrice(product) {
  const spec = KINDS[product.kind];
  const brandFactor = product.brand ? between(`brand|${product.brand}`, 0.94, 1.22) : 0.96;
  let packDiscount = 1;
  if (product.unit === 'шт') packDiscount = product.pack >= 300 ? 0.9 : 1;
  else if (product.pack >= 20) packDiscount = 0.86;
  else if (product.pack >= 5) packDiscount = 0.93;
  return spec.price * product.pack * brandFactor * packDiscount;
}

/**
 * catalog - data/catalog.json, market - createMarket(), ws - организация из workspaces.js
 */
export function createSupply(catalog, market, ws) {
  const cities = new Set(citiesOf(ws));
  const products = new Map();
  for (const raw of catalog.products) {
    if (!KINDS[raw.kind]) continue;
    products.set(raw.id, { ...raw, caseSize: defaultCase(raw), spec: KINDS[raw.kind] });
  }

  const suppliers = new Map();
  for (const raw of catalog.suppliers) {
    const national = raw.scope === 'national' || raw.type === 'packaging';
    if (!national && !cities.has(raw.city)) continue;
    const group = GROUP_BY_ID[raw.groups[0]];
    const s = {
      ...raw,
      national,
      initials: initials(raw.name),
      tileColor: `color-mix(in srgb, ${group?.color ?? 'var(--text-3)'} 75%, white)`,
      logoUrl: raw.logo,
      typeLabel: TYPE_LABELS[raw.type] ?? 'Поставщик',
      terms: null,
    };
    s.terms = supplierTerms(s);
    // в cash & carry продают и одноразовую посуду: без неё маленьким точкам упаковку взять негде
    if (s.terms.cashCarry && !s.groups.includes('packaging')) s.groups = [...s.groups, 'packaging'];
    if (/^metro$/i.test(s.name.trim())) s.name = 'METRO Cash & Carry';
    s.factor = supplierFactor(s);
    suppliers.set(s.id, s);
  }

  // у сетей cash & carry по складу в каждом городе: в таблицах «METRO» дважды без города не различить
  const sameName = new Map();
  for (const s of suppliers.values()) sameName.set(s.name, (sameName.get(s.name) ?? 0) + 1);
  for (const s of suppliers.values()) if (sameName.get(s.name) > 1 && s.city) s.name = `${s.name}, ${s.city}`;

  const offers = [];
  const add = (s, p) => {
    const base = basePrice(p) * s.factor * between(`${s.id}|${p.id}`, 0.97, 1.03);
    offers.push({ id: `${s.id}~${p.id}`, supplierId: s.id, productId: p.id, kind: p.kind, base });
  };
  for (const s of suppliers.values()) {
    const text = `${s.name} ${s.description ?? ''}`;
    for (const p of products.values()) {
      if (!s.groups.includes(p.group)) continue;
      if (p.source === 'generic') {
        const generic = GENERIC_BY_KIND[p.kind];
        if (s.type === 'distributor') add(s, p);
        else if (generic?.makers) {
          if (generic.makers.test(text)) add(s, p);
        } else add(s, p);
        continue;
      }
      // товар с брендом продаёт его производитель и часть оптовиков
      if (s.type === 'manufacturer') {
        if (s.brands.includes(p.brand)) add(s, p);
      } else if (s.type === 'distributor') {
        const coverage = s.terms.cashCarry ? 0.88 : 0.55;
        if (unit(`${s.id}|cov|${p.id}`) < coverage) add(s, p);
      }
    }
  }

  const offersByProduct = new Map();
  const offersBySupplier = new Map();
  const offersByKind = new Map();
  for (const offer of offers) {
    for (const [map, key] of [[offersByProduct, offer.productId], [offersBySupplier, offer.supplierId], [offersByKind, offer.kind]]) {
      const list = map.get(key) ?? [];
      list.push(offer);
      map.set(key, list);
    }
  }

  const priceCache = new Map();
  // цена упаковки на дату: базовая цена × индекс вида (рынок) × месячная поправка поставщика
  const priceAt = (offer, day) => {
    const month = day.slice(0, 7);
    const key = `${offer.id}|${month}`;
    let price = priceCache.get(key);
    if (price === undefined) {
      const wobble = month === market.baseKey ? 0 : between(`${offer.id}|${month}`, -0.015, 0.015);
      price = round2(offer.base * market.index(offer.kind, day) * (1 + wobble));
      priceCache.set(key, price);
    }
    return price;
  };
  const unitPriceAt = (offer, day) => priceAt(offer, day) / products.get(offer.productId).pack;

  // лучшее предложение по виду на дату: цена за кг/л/шт
  const bestOffer = (kind, day, filter = null) => {
    let best = null;
    for (const offer of offersByKind.get(kind) ?? []) {
      if (filter && !filter(offer)) continue;
      const price = unitPriceAt(offer, day);
      if (!best || price < best.price) best = { offer, price };
    }
    return best;
  };

  return { ws, products, suppliers, offers, offersByProduct, offersBySupplier, offersByKind, priceAt, unitPriceAt, bestOffer, market };
}
