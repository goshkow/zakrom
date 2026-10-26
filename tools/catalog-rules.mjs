// правила разбора открытых данных: чистые функции, чтобы их можно было проверить тестами без сети
// \b в регулярках не используем: без флага u он не видит границ кириллических слов

const ENTITIES = { '&quot;': '"', '&amp;': '&', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&(quot|amp|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m])
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// «Простоквашино, Danone» -> «Простоквашино»; ООО и кавычки убираем, регистр оставляем как есть
export function cleanBrand(value) {
  const first = cleanText(value).split(',')[0].trim();
  const brand = first.replace(/^(ооо|оао|зао|пао|ао|ип)\s+/i, '').replace(/["«»]/g, '').trim();
  if (brand.length < 2 || /^\d+$/.test(brand)) return '';
  return brand;
}

// собственные марки сетей: оптом их не купить, поэтому из B2B-каталога убираем
const PRIVATE_LABELS = [
  'красная цена', 'каждый день', 'лента', 'вкусвилл', '365 дней', 'моя цена', 'k-classic', 'global village',
  'clever', 'ozon fresh', 'первым делом', 'prosto', 'магнит', 'перекрёсток', 'перекресток', 'пятёрочка', 'пятерочка',
  'ашан', 'auchan', 'метро шеф', 'metro chef', 'fine life', 'aro', 'smart', 'спар', 'spar', 'дикси', 'окей', "о'кей",
  'светофор', 'бристоль', 'самокат', 'яндекс лавка', 'лавка', 'globus', 'глобус', 'зелёная линия', 'зеленая линия',
  'от фермера', 'маркет перекрёсток', 'семишагофф', 'верный', 'полушка', 'мария-ра', 'fix price', 'ecoroom',
];

export function isPrivateLabel(brand) {
  const key = String(brand).toLowerCase().replace(/ё/g, 'е').trim();
  return PRIVATE_LABELS.some((label) => key === label.replace(/ё/g, 'е'));
}

const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(кг|kg|килограмм|гр|г|g|грамм|мл|ml|cl|л|l|литр|шт|pcs|штук|яиц|pc)(?![a-zа-яё])/gi;

/**
 * «2 кг», «6 x 200 г», «0,9 л», «10 шт» -> {amount} в единицах вида (кг, л или шт)
 * для кг и л разрешаем 1 л ≈ 1 кг: у молочки и соусов фасовку пишут по-разному, а точность до плотности не нужна
 */
export function parseQuantity(text, unit) {
  if (typeof text !== 'string') return null;
  const value = text.toLowerCase().replace(/ё/g, 'е');
  const multi = value.match(/(\d+)\s*[x×х*]\s*(\d+(?:[.,]\d+)?)\s*(кг|kg|гр|г|g|мл|ml|л|l|шт)/i);
  let amount = null;
  let found = null;
  if (multi) {
    found = { value: Number(multi[1]) * Number(multi[2].replace(',', '.')), unit: multi[3] };
  } else {
    UNIT_RE.lastIndex = 0;
    const match = UNIT_RE.exec(value);
    if (match) found = { value: Number(match[1].replace(',', '.')), unit: match[2] };
  }
  if (!found || !Number.isFinite(found.value) || found.value <= 0) return null;
  const u = found.unit.toLowerCase();
  const mass = { кг: 1, kg: 1, килограмм: 1, гр: 0.001, г: 0.001, g: 0.001, грамм: 0.001 };
  const volume = { л: 1, l: 1, литр: 1, мл: 0.001, ml: 0.001, cl: 0.01 };
  const pieces = { шт: 1, pcs: 1, штук: 1, яиц: 1, pc: 1 };
  if (unit === 'шт') {
    if (!(u in pieces)) return null;
    amount = found.value;
    if (amount < 1 || amount > 720) return null;
  } else {
    if (u in mass) amount = found.value * mass[u];
    else if (u in volume) amount = found.value * volume[u];
    else return null;
    if (amount < 0.05 || amount > 30) return null;
  }
  return { amount: Math.round(amount * 1000) / 1000 };
}

const RUSSIA = 'Q159';
const COMPANY_TYPES = new Set(['Q4830453', 'Q6881511', 'Q783794', 'Q891723', 'Q167270', 'Q431289', 'Q83405', 'Q134161', 'Q1589009', 'Q22687', 'Q658255', 'Q2085381', 'Q507619', 'Q1137109', 'Q1631129', 'Q13235160', 'Q155076', 'Q936518', 'Q1631129']);
const COMPANY_WORDS = /компан|производ|завод|комбинат|бренд|марк|фабрик|холдинг|предприят|концерн|агрохолд|изготов|молочн|кондитер|мясн|пищев|напит|company|brand|manufactur|producer|dairy|food|beverage/i;
const BRAND_TYPES = new Set(['Q167270', 'Q431289']);
// у Wikidata тёзки: металлургический «Красный Октябрь», хлебозавод «Черкизово». такие описания отбрасываем
const WRONG_WORDS = /металлург|сталь|(?:^|\s)завод в |хлебозавод|футбол|клуб|район|посел|село|станц|улиц|река|институт|университет|техникум|колледж|музей|банк|издательств|пив|алкогол|водк|ликёр|ликер|винодел|империи|сеть магазинов|сеть булочных|historic|рыборазвод|разведени|рыболов|целлюлоз|элеватор/i;
// по названию тоже: у части компаний описания нет, а тип «хлебозавод» виден только в имени
const WRONG_LABEL = /хлебозавод|булочн|пивовар|пиво|ликёро|ликеро|винзавод|база рыбфлота|база активного|элеватор|рыборазвод/i;
// «торговая марка» без владельца - это бренд, а не юрлицо, с которым заключают договор
const BRAND_WORDS = /торговая марка|товарный знак|(?:^|\s)бренд|brand|trademark/i;

export function isCompanyish(entity) {
  if (!entity || entity.dissolved) return false;
  const description = entity.description ?? '';
  if (WRONG_WORDS.test(description) || WRONG_LABEL.test(entity.label ?? '')) return false;
  return (entity.instanceOf ?? []).some((t) => COMPANY_TYPES.has(t)) || COMPANY_WORDS.test(description);
}

export const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/["«»'.,()-]/g, ' ').replace(/\s+/g, ' ').trim();

function isRussian(entity, entities) {
  if (entity.country?.includes(RUSSIA)) return true;
  return (entity.hq ?? []).some((q) => entities[q]?.country?.includes(RUSSIA));
}

/**
 * бренд из Open Food Facts -> компания из Wikidata. берём только российские компании, у которых название
 * совпадает с брендом, а описание или тип похожи на производителя: иначе «Д» или «Слобода» найдут что угодно
 */
export function matchBrandEntity(brand, candidateIds, entities) {
  const b = norm(brand);
  if (b.length < 3) return null;
  for (const qid of candidateIds) {
    const entity = entities[qid];
    if (!entity?.label) continue;
    const label = norm(entity.label);
    const nameMatch = label === b || label.startsWith(`${b} `) || label.endsWith(` ${b}`) || (b.length >= 5 && label.includes(b));
    if (!nameMatch) continue;
    if (!isCompanyish(entity)) continue;
    let company = entity;
    if ((entity.instanceOf ?? []).some((t) => BRAND_TYPES.has(t)) || BRAND_WORDS.test(entity.description ?? '')) {
      // марка без известного владельца - не поставщик: договор заключают с компанией, а не с брендом
      const owner = (entity.owner ?? []).map((q) => entities[q]).find((e) => e?.label && !e.dissolved);
      if (!owner) continue;
      company = owner;
    }
    if (!isRussian(company, entities) && !isRussian(entity, entities)) continue;
    return { brandEntity: entity, company };
  }
  return null;
}

// уточнения Wikidata в скобках: «Бабаевский (концерн)» -> «Концерн «Бабаевский»», «Липецкий (молочный комбинат)» -> «Липецкий молочный комбинат»
export function displayName(label) {
  const text = cleanText(label);
  const match = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!match) return text;
  const [, name, note] = match;
  const words = note.trim().split(/\s+/);
  if (words.length === 1) return `${words[0][0].toUpperCase()}${words[0].slice(1)} «${name}»`;
  if (words.length === 2) return `${name} ${note}`;
  return name;
}

export function commonsLogoUrl(file) {
  if (typeof file !== 'string' || !file.trim()) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.trim().replace(/ /g, '_'))}?width=128`;
}

export function normalizeWebsite(value) {
  const text = cleanText(value).split(';')[0].trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

// группы закупок по словам в названии или описании
export function groupsFromText(value) {
  const text = norm(value);
  const groups = [];
  if (/молоч|молок|сыр|маслозавод|маслосыр|dairy|cheese/.test(text)) groups.push('dairy');
  if (/мясо|мясн|колбас|птицеф|бройлер|птиц|рыб|морепрод|meat|seafood|fish|poultry/.test(text)) groups.push('meat');
  if (/овощ|фрукт|теплиц|тепличн|грибн|ягод|fruit|vegetable|frozen/.test(text)) groups.push('produce');
  if (/мельн|мука|мучн|мелькомб|круп|элеватор|макарон|масложир|сахар|яйц|бакал|grocer|grain|flour/.test(text)) groups.push('grocery');
  if (/майонез|соус|кетчуп|специ|пряност|кондитер|шоколад|конфет|confection/.test(text)) groups.push('sauces');
  if (/кофе|обжар|(?:^|\s)чай|чайн|вод[аы]|напит|лимонад|(?:^|\s)сок(?:и|ов)?(?:\s|$)|coffee|tea|beverage|water/.test(text)) groups.push('drinks');
  return groups;
}

const NON_FOOD = /строй|строит|вагон|ремонт|энерго|материал|авто|запчаст|мебел|одежд|обув|ткан|текстил|электр|сантех|инструм|канцел|цвет|зоо|аптек|косметик|шин|металл|кабел|двер|окн|плитк|краск|игруш|книг|бытов|техник|сталь|бетон|кирпич|(?:^|\s)лес|пиломат|мото|вело|станк|оборуд|химия|бумаг[аи]? для|обо[ий]|ковр|часы|ювел|табак|вейп|кальян|пив|ликер|ликёр|водк|винзавод|вино|спирт|алко|коньяк|ветерин|корм|семен|удобр|бенз|топлив|(?:^|\s)газ(?:\s|$)|насос|подшип|крепеж|крепёж|фанер|стекл|бижут|парфюм|хозтовар/i;

// подпись производства по словам в названии и тегах: что именно здесь делают
const PRODUCER_NOTES = [
  [/обжар|кофе|coffee/, 'Обжарка кофе'],
  [/чайн|(?:^|\s)чай/, 'Чайная фабрика'],
  [/плавлен/, 'Завод плавленых сыров'],
  [/молоч|молок|маслозавод|dairy/, 'Молочное производство'],
  [/птицеф|бройлер/, 'Птицефабрика'],
  [/рыб/, 'Рыбоперерабатывающее производство'],
  [/мясо|мясн|колбас|meat/, 'Мясоперерабатывающее производство'],
  [/мельн|мука|мучн|мелькомб|flour/, 'Мукомольное производство'],
  [/кондитер|шоколад|конфет|confection/, 'Кондитерское производство'],
  [/ягод|овощ|фрукт|теплиц/, 'Переработка овощей и ягод'],
  [/вод[аы]|напит|лимонад/, 'Производство напитков'],
];

/**
 * организация из OSM -> тип поставщика и группы закупок. null - не наш профиль (стройматериалы, алкоголь и т.п.)
 */
export function classifyOsm(name, tags = {}) {
  const text = norm([name, tags.product, tags.wholesale, tags.industrial, tags.craft, tags.description, tags.operator].filter(Boolean).join(' '));
  if (NON_FOOD.test(text)) return null;
  if (/упаков|(?:^|\s)тара(?:\s|$)|(?:^|\s)тарн|пакет|картон|гофр|полимер|пленк|(?:^|\s)пэт(?:\s|$)|packag|plast|одноразов|посуд/.test(text) || ['packaging', 'plastics', 'paper'].includes(tags.industrial) || tags.product === 'packaging') {
    return { type: 'packaging', groups: ['packaging'], note: 'Упаковка, одноразовая посуда и расходники' };
  }
  const groups = groupsFromText(text);
  if (tags.shop === 'wholesale') {
    const general = /metro|метро|продукт|продовол|horeca|хорека|ресторан|food|фуд|гастро|снабж|дистриб|(?:^|\s)опт|оптов|торгов|cash|кэш|база|склад/.test(text) || ['food', 'grocery', 'frozen_food'].includes(tags.wholesale);
    if (!groups.length && !general) return null;
    const list = groups.length ? groups : ['dairy', 'meat', 'produce', 'grocery', 'sauces', 'drinks'];
    return { type: 'distributor', groups: list, note: groups.length ? 'Оптовая торговля, профильный ассортимент' : 'Оптовая торговля продуктами питания' };
  }
  if (!groups.length) return null;
  // хлеб и выпечку сети пекут сами, а комбинатам «кондитерский» в названии даёт ложную группу
  if (/хлеб|булочн|пекар/.test(text) && !/фабрик|шоколад|конфет/.test(text)) return null;
  const isProducer = tags.man_made === 'works' || Boolean(tags.industrial) || Boolean(tags.craft);
  if (!isProducer) return null;
  const note = PRODUCER_NOTES.find(([re]) => re.test(text))?.[1] ?? 'Пищевое производство';
  return { type: 'producer', groups, note };
}
