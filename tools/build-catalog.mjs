#!/usr/bin/env node
// собирает data/catalog.json и data/market.json из снимков data/sources/*.json (их качает tools/fetch_sources.py)
// node tools/build-catalog.mjs          собрать
// node tools/build-catalog.mjs --check  собрать в память и проверить, файлы не трогать
// сеть не нужна: сборка повторяема, одни и те же снимки дают тот же каталог
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KINDS, OFF_TAG_KIND, GENERIC_ITEMS } from '../js/model/kinds.js';
import { classifyOsm, matchBrandEntity, isCompanyish, groupsFromText, norm, displayName, cleanBrand, cleanText, parseQuantity, isPrivateLabel, commonsLogoUrl, normalizeWebsite } from './catalog-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data', 'sources');
const MAX_PER_KIND = 12;

const readSource = (name) => {
  const path = join(SRC, `${name}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};

const fits = (spec, name) => Boolean(spec.words) && spec.words.test(name) && !(spec.not && spec.not.test(name));

// категория OFF задаёт группу, а вид уточняем по названию: в «сливках» лежит сметана, в «сырах» - творог
export function classifyProduct(name, tagKind) {
  const spec = KINDS[tagKind];
  if (!spec) return null;
  if (fits(spec, name)) return tagKind;
  for (const [key, other] of Object.entries(KINDS)) {
    if (other.group === spec.group && !other.generic && fits(other, name)) return key;
  }
  return null;
}

export function buildProducts(off) {
  const byKind = new Map();
  const seen = new Set();
  const rejected = { noName: 0, privateLabel: 0, words: 0, quantity: 0, duplicate: 0, noImage: 0 };
  const sorted = (off?.products ?? []).slice().sort((a, b) => (b.unique_scans_n ?? 0) - (a.unique_scans_n ?? 0));
  for (const raw of sorted) {
    const name = cleanText(raw.product_name_ru || raw.product_name);
    if (!name || !/[а-яё]/i.test(name)) { rejected.noName += 1; continue; }
    const brand = cleanBrand(raw.brands);
    if (!brand) { rejected.noName += 1; continue; }
    // СТМ сетей (Красная цена, ВкусВилл...) оптовик не продаёт: в B2B-каталоге им не место
    if (isPrivateLabel(brand)) { rejected.privateLabel += 1; continue; }
    const kind = classifyProduct(name, OFF_TAG_KIND[raw._tag]);
    if (!kind) { rejected.words += 1; continue; }
    const spec = KINDS[kind];
    // фасовку часто пишут только в названии: «Биойогурт ... 130г»
    const pack = parseQuantity(raw.quantity, spec.unit) ?? parseQuantity(name, spec.unit);
    if (!pack) { rejected.quantity += 1; continue; }
    const image = typeof raw.image_front_small_url === 'string' && raw.image_front_small_url.startsWith('https://images.openfoodfacts.org/') ? raw.image_front_small_url : null;
    if (!image) { rejected.noImage += 1; continue; }
    const key = `${name.toLowerCase()}|${brand.toLowerCase()}|${pack.amount}`;
    if (seen.has(key)) { rejected.duplicate += 1; continue; }
    seen.add(key);
    const list = byKind.get(kind) ?? [];
    if (list.length >= MAX_PER_KIND) continue;
    list.push({
      id: String(raw.code),
      barcode: String(raw.code),
      name,
      brand,
      kind,
      group: spec.group,
      pack: pack.amount,
      unit: spec.unit,
      image,
      nutriscore: /^[a-e]$/.test(raw.nutriscore_grade ?? '') ? raw.nutriscore_grade : null,
      source: 'off',
    });
    byKind.set(kind, list);
  }
  const generic = GENERIC_ITEMS.map((item) => ({
    id: `gen-${item.kind}`,
    barcode: null,
    name: item.name,
    brand: null,
    kind: item.kind,
    group: KINDS[item.kind].group,
    pack: item.pack,
    caseSize: item.case,
    unit: KINDS[item.kind].unit,
    image: null,
    nutriscore: null,
    source: 'generic',
  }));
  return { products: [...[...byKind.values()].flat(), ...generic], rejected };
}

function supplierFromEntity(company, entities, fetchedAt) {
  const hq = company.hq?.map((q) => entities[q]).find(Boolean);
  return {
    id: `wd-${company.id}`,
    name: displayName(company.label),
    type: 'manufacturer',
    groups: [],
    brands: [],
    city: hq?.label ?? null,
    address: null,
    coords: company.coords?.[0] ?? hq?.coords?.[0] ?? null,
    website: normalizeWebsite(company.website?.[0]),
    phone: null,
    email: null,
    description: company.description || null,
    founded: company.inception?.[0] ? Number(company.inception[0].slice(1, 5)) || null : null,
    employees: company.employees?.[0] ? Math.round(Number(company.employees[0])) || null : null,
    ogrn: company.ogrn?.[0] ?? null,
    logo: commonsLogoUrl(company.logo?.[0]),
    wikidata: company.id,
    ruwiki: company.ruwiki ?? null,
    osm: null,
    source: 'wikidata',
    sourceUrl: `https://www.wikidata.org/wiki/${company.id}`,
    checkedAt: (fetchedAt ?? '').slice(0, 10) || null,
    scope: 'national',
  };
}

export function buildManufacturers(products, wikidata) {
  const suppliers = new Map();
  const brandToSupplier = {};
  if (!wikidata) return { suppliers: [], brandToSupplier };
  const entities = wikidata.entities ?? {};
  const brands = [...new Set(products.filter((p) => p.brand).map((p) => p.brand))];
  for (const brand of brands) {
    const match = matchBrandEntity(brand, wikidata.candidates?.[brand] ?? [], entities);
    if (!match) continue;
    const id = `wd-${match.company.id}`;
    const current = suppliers.get(id) ?? supplierFromEntity(match.company, entities, wikidata.fetchedAt);
    if (!current.brands.includes(brand)) current.brands.push(brand);
    for (const product of products) if (product.brand === brand && !current.groups.includes(product.group)) current.groups.push(product.group);
    suppliers.set(id, current);
    brandToSupplier[brand] = id;
  }
  // производители из отраслевого запроса: их товаров может не быть в OFF, но компания настоящая
  const industryGroups = wikidata.industryGroups ?? {};
  for (const qid of wikidata.industryCompanies ?? []) {
    const entity = entities[qid];
    if (!entity?.label || !isCompanyish(entity)) continue;
    const id = `wd-${qid}`;
    const current = suppliers.get(id) ?? supplierFromEntity(entity, entities, wikidata.fetchedAt);
    const fromText = groupsFromText(`${entity.label} ${entity.description ?? ''}`);
    const fromIndustry = (entity.industry ?? []).map((q) => industryGroups[q]).filter((g) => g && g !== 'food');
    const groups = [...new Set([...current.groups, ...fromText, ...fromIndustry])];
    if (!groups.length) continue;
    current.groups = groups;
    suppliers.set(id, current);
  }
  return { suppliers: [...suppliers.values()], brandToSupplier };
}

export function buildOsmSuppliers(osm) {
  const out = [];
  const seen = new Set();
  for (const element of osm?.elements ?? []) {
    const tags = element.tags ?? {};
    const name = cleanText(tags.name);
    if (!name) continue;
    const cls = classifyOsm(name, tags);
    if (!cls) continue;
    const key = `${name.toLowerCase()}|${element._city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ');
    out.push({
      id: `osm-${element.type}-${element.id}`,
      name,
      type: cls.type,
      groups: cls.groups,
      brands: [],
      city: element._city,
      address: street || null,
      coords: Number.isFinite(lat) && Number.isFinite(lon) ? { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 } : null,
      website: normalizeWebsite(tags.website || tags['contact:website']),
      phone: cleanText(tags.phone || tags['contact:phone'])?.split(';')[0]?.trim() || null,
      email: cleanText(tags.email || tags['contact:email']) || null,
      description: cls.note,
      founded: null,
      employees: null,
      ogrn: null,
      logo: null,
      wikidata: null,
      ruwiki: null,
      osm: { type: element.type, id: element.id },
      openingHours: cleanText(tags.opening_hours) || null,
      operator: cleanText(tags.operator) || null,
      source: 'osm',
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      checkedAt: (element.timestamp ?? '').slice(0, 10) || null,
      scope: 'city',
    });
  }
  return out;
}

// один завод бывает и в Wikidata, и в OSM: оставляем профиль Wikidata, а адрес и телефон берём из OSM
export function mergeDuplicates(manufacturers, local) {
  const rest = [];
  for (const o of local) {
    const name = norm(o.name);
    const twin = manufacturers.find((m) => {
      const label = norm(m.name.replace(/\(.*?\)/g, ''));
      return label === name || (label.length >= 5 && name.includes(label)) || (name.length >= 8 && label.includes(name));
    });
    if (!twin) {
      rest.push(o);
      continue;
    }
    twin.city = o.city;
    twin.address = twin.address ?? o.address;
    twin.coords = o.coords ?? twin.coords;
    twin.website = twin.website ?? o.website;
    twin.phone = twin.phone ?? o.phone;
    twin.email = twin.email ?? o.email;
    twin.osm = o.osm;
    twin.groups = [...new Set([...twin.groups, ...o.groups])];
  }
  return rest;
}

export function buildMarket(fx, commodities) {
  return {
    schemaVersion: 1,
    fx: fx ? { source: fx.source, url: fx.url, fetchedAt: fx.fetchedAt, series: fx.series } : null,
    commodities: commodities
      ? { source: commodities.source, url: commodities.url, license: commodities.license, licenseUrl: commodities.licenseUrl, fetchedAt: commodities.fetchedAt, series: commodities.series }
      : null,
  };
}

export function buildAll(sources) {
  const { products, rejected } = buildProducts(sources.off);
  const { suppliers: manufacturers, brandToSupplier } = buildManufacturers(products, sources.wikidata);
  const local = mergeDuplicates(manufacturers, buildOsmSuppliers(sources.osm));
  const meta = (s, extra = {}) => (s ? { title: s.source, url: s.url, license: s.license, licenseUrl: s.licenseUrl, attributionUrl: s.attributionUrl ?? null, fetchedAt: s.fetchedAt, ...extra } : null);
  const catalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString().slice(0, 19) + 'Z',
    sources: [
      meta(sources.off, { id: 'off', count: products.filter((p) => p.source === 'off').length }),
      meta(sources.wikidata, { id: 'wikidata', count: manufacturers.length }),
      meta(sources.osm, { id: 'osm', count: local.length }),
    ].filter(Boolean),
    products,
    suppliers: [...manufacturers, ...local],
    brandToSupplier,
  };
  return { catalog, market: buildMarket(sources.fx, sources.commodities), rejected };
}

export function validate(catalog) {
  const errors = [];
  const ids = new Set();
  for (const p of catalog.products) {
    if (ids.has(p.id)) errors.push(`повтор товара ${p.id}`);
    ids.add(p.id);
    if (!KINDS[p.kind]) errors.push(`${p.id}: неизвестный вид ${p.kind}`);
    if (!(p.pack > 0)) errors.push(`${p.id}: фасовка ${p.pack}`);
  }
  const sids = new Set();
  for (const s of catalog.suppliers) {
    if (sids.has(s.id)) errors.push(`повтор поставщика ${s.id}`);
    sids.add(s.id);
    if (!s.groups.length) errors.push(`${s.id}: без групп`);
    if (s.website && !/^https?:\/\//.test(s.website)) errors.push(`${s.id}: сайт ${s.website}`);
  }
  for (const [brand, id] of Object.entries(catalog.brandToSupplier)) if (!sids.has(id)) errors.push(`бренд ${brand} -> нет ${id}`);
  return errors;
}

function writeJson(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data)}\n`);
  renameSync(tmp, path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sources = Object.fromEntries(['off', 'wikidata', 'osm', 'fx', 'commodities'].map((n) => [n, readSource(n)]));
  const { catalog, market, rejected } = buildAll(sources);
  const errors = validate(catalog);
  const kinds = {};
  for (const p of catalog.products) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
  const types = {};
  for (const s of catalog.suppliers) types[s.type] = (types[s.type] ?? 0) + 1;
  console.log(`товаров ${catalog.products.length}, поставщиков ${catalog.suppliers.length}`, types);
  console.log('по видам', kinds);
  console.log('отсеяно', rejected);
  if (errors.length) {
    console.error(errors.slice(0, 30).join('\n'));
    process.exit(1);
  }
  if (!process.argv.includes('--check')) {
    writeJson(join(ROOT, 'data', 'catalog.json'), catalog);
    writeJson(join(ROOT, 'data', 'market.json'), market);
    console.log('записано data/catalog.json, data/market.json');
  }
}
