// справочник того, что закупают: группы, виды сырья и упаковки, базовые оптовые цены
// цены - ориентир песочницы на осень 2026 (₽ за кг, л или шт без НДС), не прайс конкретной компании

// порядок групп = порядок цветов в графиках (палитра проверена на дальтонизм именно в этом порядке)
export const GROUPS = [
  { id: 'dairy', label: 'Молочка и сыры', short: 'Молочка', color: 'var(--s1)' },
  { id: 'meat', label: 'Мясо, птица, рыба', short: 'Мясо и рыба', color: 'var(--s2)' },
  { id: 'produce', label: 'Овощи и заморозка', short: 'Овощи', color: 'var(--s3)' },
  { id: 'grocery', label: 'Бакалея', short: 'Бакалея', color: 'var(--s4)' },
  { id: 'sauces', label: 'Соусы, сладкое, специи', short: 'Соусы и сладкое', color: 'var(--s5)' },
  { id: 'drinks', label: 'Кофе, чай, напитки', short: 'Напитки', color: 'var(--s6)' },
  { id: 'packaging', label: 'Упаковка и расходники', short: 'Упаковка', color: 'var(--s7)' },
];

export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g]));

/**
 * key -> вид: group, unit (кг|л|шт), price (₽ за unit), commodity (ряд Всемирного банка), beta (какая доля
 * биржевого движения доходит до оптовой цены), vet (ВСД в Меркурии), marked (Честный знак), words (проверка названия
 * товара из Open Food Facts: без совпадения товар в каталог не берём - категории OFF бывают шумными)
 */
export const KINDS = {
  milk: { label: 'Молоко', group: 'dairy', unit: 'л', price: 88, vet: true, marked: true, words: /молок/i, not: /сгущ|кокос|овсян|соев|миндал|шоколад|коктейл|каш/i },
  cream: { label: 'Сливки', group: 'dairy', unit: 'л', price: 430, vet: true, marked: true, words: /сливк/i, not: /масло|мороже|сыр/i },
  butter: { label: 'Масло сливочное', group: 'dairy', unit: 'кг', price: 980, vet: true, marked: true, words: /масло/i, not: /подсолн|оливк|растит|спред/i },
  cheese: { label: 'Сыр', group: 'dairy', unit: 'кг', price: 820, vet: true, marked: true, words: /сыр/i, not: /сырок|творож|плавлен|глазир/i },
  mozzarella: { label: 'Моцарелла', group: 'dairy', unit: 'кг', price: 760, vet: true, marked: true, words: /моцарелл|mozzarella/i },
  sour_cream: { label: 'Сметана', group: 'dairy', unit: 'кг', price: 260, vet: true, marked: true, words: /сметан/i },
  cottage_cheese: { label: 'Творог', group: 'dairy', unit: 'кг', price: 420, vet: true, marked: true, words: /творог|творож/i, not: /сырок|глазир|сыр/i },
  cream_cheese: { label: 'Сыр сливочный', group: 'dairy', unit: 'кг', price: 690, vet: true, marked: true, words: /сыр|cream cheese|творожн/i, not: /сырок|глазир/i },
  yogurt: { label: 'Йогурт', group: 'dairy', unit: 'кг', price: 230, vet: true, marked: true, words: /йогурт/i },

  sausages: { label: 'Колбасы и сосиски', group: 'meat', unit: 'кг', price: 560, vet: true, commodity: 'chicken', beta: 0.25, words: /колбас|сосис|сардел|салями|сервелат/i },
  ham: { label: 'Ветчина', group: 'meat', unit: 'кг', price: 690, vet: true, commodity: 'beef', beta: 0.2, words: /ветчин|окорок|бекон|грудинк/i },
  canned_fish: { label: 'Рыбные консервы', group: 'meat', unit: 'кг', price: 620, vet: true, words: /тунец|сардин|скумбри|сайр|шпрот|горбуш|лосос|печень трески|сельд/i },
  canned_meat: { label: 'Мясные консервы', group: 'meat', unit: 'кг', price: 780, vet: true, commodity: 'beef', beta: 0.3, words: /тушен|говядин|свинин|паштет/i },
  beef_mince: { label: 'Фарш говяжий', group: 'meat', unit: 'кг', price: 720, vet: true, commodity: 'beef', beta: 0.35, generic: true },
  chicken_fillet: { label: 'Филе куриное', group: 'meat', unit: 'кг', price: 390, vet: true, commodity: 'chicken', beta: 0.35, generic: true },

  frozen_veg: { label: 'Овощи замороженные', group: 'produce', unit: 'кг', price: 210, words: /овощ|смесь|горош|фасол|брокол|капуст|шпинат|морков/i },
  canned_veg: { label: 'Овощные консервы', group: 'produce', unit: 'кг', price: 230, words: /горош|фасол|огурц|томат|оливк|маслин|кукуруз|грибы|шампин/i },
  tomato_paste: { label: 'Томатная паста', group: 'produce', unit: 'кг', price: 330, words: /томат/i },
  corn: { label: 'Кукуруза консервированная', group: 'produce', unit: 'кг', price: 260, commodity: 'maize', beta: 0.2, words: /кукуруз/i },
  fries: { label: 'Картофель фри', group: 'produce', unit: 'кг', price: 190, words: /фри|соломк|дольк/i, not: /чипс|снек|хруст/i },
  potatoes: { label: 'Картофель', group: 'produce', unit: 'кг', price: 38, generic: true },
  tomatoes: { label: 'Томаты свежие', group: 'produce', unit: 'кг', price: 210, generic: true },
  cucumbers: { label: 'Огурцы свежие', group: 'produce', unit: 'кг', price: 180, generic: true },
  lettuce: { label: 'Салат айсберг', group: 'produce', unit: 'кг', price: 420, generic: true },
  onions: { label: 'Лук репчатый', group: 'produce', unit: 'кг', price: 35, generic: true },
  cabbage: { label: 'Капуста белокочанная', group: 'produce', unit: 'кг', price: 32, generic: true },

  flour: { label: 'Мука пшеничная', group: 'grocery', unit: 'кг', price: 46, commodity: 'wheat', beta: 0.45, words: /мука/i, not: /кокос|миндал|рисов|кукуруз|смесь для/i },
  sugar: { label: 'Сахар', group: 'grocery', unit: 'кг', price: 74, commodity: 'sugar', beta: 0.5, words: /сахар/i, not: /пудр|ванил|тростник/i },
  sunflower_oil: { label: 'Масло подсолнечное', group: 'grocery', unit: 'л', price: 145, commodity: 'sunflower_oil', beta: 0.55, words: /подсолн|растит/i },
  olive_oil: { label: 'Масло оливковое', group: 'grocery', unit: 'л', price: 1150, words: /оливк/i, not: /маслин/i },
  pasta: { label: 'Макароны', group: 'grocery', unit: 'кг', price: 125, commodity: 'wheat', beta: 0.3, words: /макарон|спагет|паст|рожк|перь|фузил|лапш|вермиш|ракушк|спираль/i },
  rice: { label: 'Рис', group: 'grocery', unit: 'кг', price: 120, commodity: 'rice', beta: 0.45, words: /рис/i },
  buckwheat: { label: 'Гречка', group: 'grocery', unit: 'кг', price: 95, words: /греч/i },
  eggs: { label: 'Яйцо куриное', group: 'grocery', unit: 'шт', price: 10.5, vet: true, words: /яйц/i, not: /шоколад|киндер|лапш/i },
  salt: { label: 'Соль', group: 'grocery', unit: 'кг', price: 28, words: /соль/i },
  oats: { label: 'Хлопья овсяные', group: 'grocery', unit: 'кг', price: 110, words: /овсян|геркулес|хлопь/i },
  yeast: { label: 'Дрожжи', group: 'grocery', unit: 'кг', price: 330, generic: true },

  ketchup: { label: 'Кетчуп', group: 'sauces', unit: 'кг', price: 240, words: /кетчуп|соус/i },
  mayo: { label: 'Майонез', group: 'sauces', unit: 'кг', price: 260, commodity: 'sunflower_oil', beta: 0.25, words: /майонез/i },
  mustard: { label: 'Горчица', group: 'sauces', unit: 'кг', price: 300, words: /горчиц/i },
  soy_sauce: { label: 'Соус соевый', group: 'sauces', unit: 'л', price: 290, words: /соев/i },
  spices: { label: 'Специи', group: 'sauces', unit: 'кг', price: 1400, words: /перец|паприк|приправ|корица|лист|специ|куркум|орегано|базилик|чеснок|имбир|ванил|гвоздик|тмин/i },
  honey: { label: 'Мёд', group: 'sauces', unit: 'кг', price: 650, words: /мёд|мед/i },
  jam: { label: 'Джем и варенье', group: 'sauces', unit: 'кг', price: 380, commodity: 'sugar', beta: 0.15, words: /джем|варень|конфитюр|повидл/i },
  chocolate: { label: 'Шоколад', group: 'sauces', unit: 'кг', price: 1350, commodity: 'cocoa', beta: 0.4, words: /шоколад/i },
  cocoa: { label: 'Какао-порошок', group: 'sauces', unit: 'кг', price: 980, commodity: 'cocoa', beta: 0.55, words: /какао/i },
  condensed_milk: { label: 'Сгущённое молоко', group: 'sauces', unit: 'кг', price: 390, vet: true, commodity: 'sugar', beta: 0.15, words: /сгущ|молоко цельное с сахаром|варён/i },
  syrup: { label: 'Сироп', group: 'sauces', unit: 'л', price: 520, commodity: 'sugar', beta: 0.15, words: /сироп|топпинг/i },

  coffee_beans: { label: 'Кофе в зёрнах', group: 'drinks', unit: 'кг', price: 1950, commodity: 'coffee', beta: 0.5, words: /кофе|coffee|зерн/i, not: /напиток|растворим|капсул/i },
  coffee: { label: 'Кофе молотый и растворимый', group: 'drinks', unit: 'кг', price: 2100, commodity: 'coffee', beta: 0.45, words: /кофе|coffee|nescafe|jacobs/i },
  tea: { label: 'Чай', group: 'drinks', unit: 'кг', price: 1300, commodity: 'tea', beta: 0.3, words: /чай|tea/i },
  juice: { label: 'Соки и нектары', group: 'drinks', unit: 'л', price: 125, marked: true, commodity: 'orange', beta: 0.25, words: /сок|нектар|морс/i },
  water: { label: 'Вода питьевая', group: 'drinks', unit: 'л', price: 38, marked: true, words: /вода|aqua|минерал/i },
  soda: { label: 'Газированные напитки', group: 'drinks', unit: 'л', price: 85, marked: true, commodity: 'sugar', beta: 0.1, words: /напиток|газир|кола|cola|лимонад|тоник|спрайт|фанта|pepsi/i },

  cup_250: { label: 'Стакан бумажный 250 мл', group: 'packaging', unit: 'шт', price: 4.2, generic: true },
  cup_350: { label: 'Стакан бумажный 350 мл', group: 'packaging', unit: 'шт', price: 5.4, generic: true },
  lid: { label: 'Крышка для стакана', group: 'packaging', unit: 'шт', price: 2.1, generic: true },
  kraft_bag: { label: 'Пакет крафт', group: 'packaging', unit: 'шт', price: 3.6, generic: true },
  film_bag: { label: 'Пакет ПП для хлеба', group: 'packaging', unit: 'шт', price: 1.4, generic: true },
  container_500: { label: 'Контейнер 500 мл', group: 'packaging', unit: 'шт', price: 7.8, generic: true },
  container_1000: { label: 'Контейнер 1000 мл', group: 'packaging', unit: 'шт', price: 11.5, generic: true },
  burger_box: { label: 'Коробка для бургера', group: 'packaging', unit: 'шт', price: 6.9, generic: true },
  muffin_cup: { label: 'Капсула для маффинов', group: 'packaging', unit: 'шт', price: 0.9, generic: true },
  napkins: { label: 'Салфетки', group: 'packaging', unit: 'шт', price: 0.35, generic: true },
  gloves: { label: 'Перчатки нитриловые', group: 'packaging', unit: 'шт', price: 3.2, generic: true },
};

// типовые позиции без штрихкода: фасовка и кратность заказа, как в прайсах оптовиков
// makers - кто из производителей может их выпускать (по названию или описанию компании);
// без makers позицию продаёт любой поставщик группы. оптовики продают все позиции своих групп
const DAIRY = /молоч|молок|сыр|маслозавод|dairy/i;
const MEAT = /мяс|колбас|птиц|бройлер|meat/i;
export const GENERIC_ITEMS = [
  { kind: 'milk', name: 'Молоко 3,2% для кофе, HoReCa', pack: 1, case: 12, makers: DAIRY },
  { kind: 'cream', name: 'Сливки 33% для взбивания', pack: 1, case: 12, makers: DAIRY },
  { kind: 'butter', name: 'Масло сливочное 82,5%, монолит', pack: 5, case: 1, makers: DAIRY },
  { kind: 'cottage_cheese', name: 'Творог 9% весовой', pack: 5, case: 1, makers: DAIRY },
  { kind: 'sour_cream', name: 'Сметана 20%, ведро', pack: 5, case: 1, makers: DAIRY },
  { kind: 'cheese', name: 'Сыр полутвёрдый 45%, брус', pack: 3, case: 1, makers: DAIRY },
  { kind: 'mozzarella', name: 'Моцарелла для пиццы 40%, брус', pack: 2, case: 4, makers: DAIRY },
  { kind: 'cream_cheese', name: 'Сыр сливочный 70%, ведро', pack: 2.2, case: 1, makers: DAIRY },
  { kind: 'sausages', name: 'Сосиски молочные весовые', pack: 2, case: 3, makers: MEAT },
  { kind: 'ham', name: 'Ветчина для сэндвичей, нарезка', pack: 1, case: 5, makers: MEAT },
  { kind: 'beef_mince', name: 'Фарш говяжий 20%, охлаждённый', pack: 2, case: 5, makers: /мяс|meat|говяд/i },
  { kind: 'chicken_fillet', name: 'Филе грудки цыплёнка-бройлера, охлаждённое', pack: 2, case: 5, makers: /птиц|бройлер|мяс|курин|poultry/i },
  { kind: 'flour', name: 'Мука пшеничная хлебопекарная в/с, мешок', pack: 50, case: 1, makers: /мельн|мук|мелькомб|зерн|flour|макфа/i },
  { kind: 'sugar', name: 'Сахар-песок, мешок', pack: 50, case: 1, makers: /сахар|продимекс/i },
  { kind: 'sunflower_oil', name: 'Масло подсолнечное рафинированное для фритюра', pack: 5, case: 3, makers: /масл|жир|эфко/i },
  { kind: 'eggs', name: 'Яйцо куриное С1, лоток', pack: 360, case: 1, makers: /птиц|яйц/i },
  { kind: 'chocolate', name: 'Шоколад тёмный 70% в каллетах', pack: 1, case: 5, makers: /кондитер|шоколад/i },
  { kind: 'cocoa', name: 'Какао-порошок алкализованный 22–24%', pack: 1, case: 10, makers: /кондитер|шоколад|какао/i },
  { kind: 'mayo', name: 'Майонез 67% для HoReCa, ведро', pack: 3, case: 1, makers: /майонез|соус|масложир|жир/i },
  { kind: 'ketchup', name: 'Кетчуп томатный для HoReCa', pack: 2, case: 6, makers: /соус|кетчуп|томат/i },
  { kind: 'tea', name: 'Чай чёрный листовой, крупный лист', pack: 1, case: 6, makers: /(?:^|\s)чай|чайн/i },
  { kind: 'coffee_beans', name: 'Кофе в зёрнах, эспрессо-смесь 80/20 (арабика/робуста)', pack: 1, case: 6, makers: /кофе|обжар|coffee/i },
  { kind: 'fries', name: 'Картофель фри замороженный, соломка 9×9 мм', pack: 2.5, case: 4, makers: /овощ|картоф|заморож/i },
  { kind: 'potatoes', name: 'Картофель мытый, сетка', pack: 10, case: 1 },
  { kind: 'tomatoes', name: 'Томаты красные, ящик', pack: 6, case: 1 },
  { kind: 'cucumbers', name: 'Огурцы гладкие, ящик', pack: 6, case: 1 },
  { kind: 'lettuce', name: 'Салат айсберг, ящик', pack: 5, case: 1 },
  { kind: 'onions', name: 'Лук репчатый, сетка', pack: 10, case: 1 },
  { kind: 'cabbage', name: 'Капуста белокочанная, сетка', pack: 20, case: 1 },
  { kind: 'yeast', name: 'Дрожжи хлебопекарные прессованные', pack: 0.5, case: 20 },
  { kind: 'cup_250', name: 'Стакан бумажный однослойный 250 мл, белый', pack: 50, case: 20 },
  { kind: 'cup_350', name: 'Стакан бумажный однослойный 350 мл, белый', pack: 50, case: 20 },
  { kind: 'lid', name: 'Крышка ПС 80 мм с питьевым отверстием', pack: 100, case: 10 },
  { kind: 'kraft_bag', name: 'Пакет бумажный крафт 170×250 мм', pack: 100, case: 10 },
  { kind: 'film_bag', name: 'Пакет ПП 250×400 мм для батона', pack: 500, case: 4 },
  { kind: 'container_500', name: 'Контейнер ПП 500 мл с крышкой', pack: 50, case: 10 },
  { kind: 'container_1000', name: 'Контейнер ПП 1000 мл с крышкой', pack: 50, case: 6 },
  { kind: 'burger_box', name: 'Коробка картонная для бургера 115×115 мм', pack: 100, case: 6 },
  { kind: 'muffin_cup', name: 'Капсула бумажная для маффинов 50×40 мм', pack: 1000, case: 5 },
  { kind: 'napkins', name: 'Салфетки однослойные 24×24 см', pack: 400, case: 12 },
  { kind: 'gloves', name: 'Перчатки нитриловые, размер M', pack: 100, case: 10 },
];

export const GENERIC_BY_KIND = Object.fromEntries(GENERIC_ITEMS.map((item) => [item.kind, item]));

// категория OFF -> вид: по ней товар попал в снимок
export const OFF_TAG_KIND = {
  milks: 'milk', creams: 'cream', butters: 'butter', cheeses: 'cheese', mozzarella: 'mozzarella',
  'sour-creams': 'sour_cream', 'cottage-cheeses': 'cottage_cheese', tvorog: 'cottage_cheese',
  'cream-cheeses': 'cream_cheese', yogurts: 'yogurt',
  sausages: 'sausages', hams: 'ham', 'canned-fishes': 'canned_fish', 'canned-meats': 'canned_meat',
  'frozen-vegetables': 'frozen_veg', 'canned-vegetables': 'canned_veg', 'tomato-pastes': 'tomato_paste',
  'canned-corn': 'corn', 'chips-and-fries': 'fries',
  flours: 'flour', sugars: 'sugar', 'sunflower-oils': 'sunflower_oil', 'olive-oils': 'olive_oil',
  pastas: 'pasta', rices: 'rice', buckwheat: 'buckwheat', eggs: 'eggs', salts: 'salt', 'rolled-oats': 'oats',
  ketchup: 'ketchup', mayonnaises: 'mayo', mustards: 'mustard', 'soy-sauces': 'soy_sauce', spices: 'spices',
  honeys: 'honey', jams: 'jam', chocolates: 'chocolate', 'cocoa-powders': 'cocoa',
  'condensed-milks': 'condensed_milk', syrups: 'syrup',
  coffees: 'coffee', 'coffee-beans': 'coffee_beans', 'ground-coffees': 'coffee', 'instant-coffees': 'coffee',
  teas: 'tea', 'fruit-juices': 'juice', waters: 'water', sodas: 'soda',
};

export const COMMODITY_LABELS = {
  wheat: 'Пшеница (HRW, США)',
  sugar: 'Сахар (мировая цена)',
  cocoa: 'Какао-бобы',
  coffee: 'Кофе арабика',
  coffee_robusta: 'Кофе робуста',
  sunflower_oil: 'Подсолнечное масло',
  palm_oil: 'Пальмовое масло',
  beef: 'Говядина',
  chicken: 'Курица',
  rice: 'Рис (Таиланд 5%)',
  maize: 'Кукуруза',
  tea: 'Чай (среднее трёх аукционов)',
  orange: 'Апельсины',
};
