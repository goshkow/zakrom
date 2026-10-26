// организации песочницы: вымышленные клиенты Закрома. у каждой свои точки, меню и техкарты,
// из которых считается расход сырья, а из расхода - вся история закупок
// recipe: вид -> расход на одну порцию в единицах вида (кг, л, шт)

const coffeeMenu = [
  { id: 'cappuccino', name: 'Капучино 0,3', price: 260, perDay: 62, recipe: { milk: 0.18, coffee_beans: 0.018, cup_350: 1, lid: 1 } },
  { id: 'latte', name: 'Латте 0,4', price: 290, perDay: 38, recipe: { milk: 0.25, coffee_beans: 0.018, cup_350: 1, lid: 1, syrup: 0.005 } },
  { id: 'americano', name: 'Американо 0,3', price: 190, perDay: 30, recipe: { coffee_beans: 0.018, cup_250: 1, lid: 1 } },
  { id: 'raf', name: 'Раф ванильный', price: 320, perDay: 16, recipe: { cream: 0.12, coffee_beans: 0.018, syrup: 0.02, cup_350: 1, lid: 1 } },
  { id: 'cocoa', name: 'Какао на молоке', price: 250, perDay: 9, recipe: { milk: 0.22, cocoa: 0.02, sugar: 0.01, cup_350: 1, lid: 1 } },
  { id: 'tea', name: 'Чай листовой', price: 160, perDay: 14, recipe: { tea: 0.005, honey: 0.01, cup_350: 1, lid: 1 } },
  { id: 'croissant', name: 'Круассан сливочный', price: 180, perDay: 32, recipe: { flour: 0.06, butter: 0.035, sugar: 0.006, eggs: 0.2, yeast: 0.002, kraft_bag: 1 } },
  { id: 'cinnabon', name: 'Булочка с корицей', price: 230, perDay: 18, recipe: { flour: 0.08, butter: 0.02, sugar: 0.025, cream_cheese: 0.02, spices: 0.001, yeast: 0.002, kraft_bag: 1 } },
  { id: 'syrniki', name: 'Сырники со сметаной', price: 290, perDay: 13, recipe: { cottage_cheese: 0.1, flour: 0.015, eggs: 0.3, sugar: 0.01, sour_cream: 0.03, container_500: 1 } },
  { id: 'sandwich', name: 'Сэндвич с ветчиной и сыром', price: 340, perDay: 21, recipe: { flour: 0.08, ham: 0.04, cheese: 0.03, butter: 0.01, yeast: 0.001, kraft_bag: 1 } },
  { id: 'cheesecake', name: 'Чизкейк', price: 310, perDay: 10, recipe: { cream_cheese: 0.09, sugar: 0.02, eggs: 0.4, cream: 0.02, flour: 0.01, butter: 0.01, container_500: 1 } },
  { id: 'juice', name: 'Сок 0,25', price: 180, perDay: 8, recipe: { juice: 0.25, cup_250: 1 } },
  { id: 'water', name: 'Вода 0,5', price: 120, perDay: 16, recipe: { water: 0.5 } },
];

const burgerMenu = [
  { id: 'cheeseburger', name: 'Чизбургер', price: 450, perDay: 58, recipe: { beef_mince: 0.15, flour: 0.07, eggs: 0.1, yeast: 0.002, cheese: 0.025, tomatoes: 0.03, lettuce: 0.015, onions: 0.01, ketchup: 0.02, mayo: 0.015, burger_box: 1, napkins: 2 } },
  { id: 'double', name: 'Двойной бургер', price: 620, perDay: 24, recipe: { beef_mince: 0.3, flour: 0.07, eggs: 0.1, yeast: 0.002, cheese: 0.05, tomatoes: 0.03, lettuce: 0.015, onions: 0.015, ketchup: 0.02, mayo: 0.02, burger_box: 1, napkins: 2 } },
  { id: 'chicken', name: 'Бургер с курицей', price: 420, perDay: 30, recipe: { chicken_fillet: 0.14, flour: 0.09, eggs: 0.15, yeast: 0.002, mayo: 0.02, lettuce: 0.02, tomatoes: 0.03, spices: 0.002, sunflower_oil: 0.02, burger_box: 1, napkins: 2 } },
  { id: 'fries', name: 'Картофель фри', price: 190, perDay: 78, recipe: { fries: 0.15, sunflower_oil: 0.015, salt: 0.003, container_500: 1 } },
  { id: 'wedges', name: 'Картофель по-деревенски', price: 210, perDay: 26, recipe: { potatoes: 0.2, sunflower_oil: 0.02, spices: 0.003, salt: 0.003, container_500: 1 } },
  { id: 'nuggets', name: 'Наггетсы, 9 шт', price: 260, perDay: 22, recipe: { chicken_fillet: 0.12, flour: 0.02, eggs: 0.1, sunflower_oil: 0.02, spices: 0.002, container_500: 1 } },
  { id: 'salad', name: 'Салат с овощами', price: 340, perDay: 12, recipe: { lettuce: 0.06, tomatoes: 0.06, cucumbers: 0.06, olive_oil: 0.012, container_1000: 1 } },
  { id: 'soda', name: 'Газировка 0,4', price: 160, perDay: 52, recipe: { soda: 0.4, cup_350: 1, lid: 1 } },
  { id: 'shake', name: 'Молочный коктейль', price: 290, perDay: 18, recipe: { milk: 0.25, cream: 0.03, syrup: 0.03, cup_350: 1, lid: 1 } },
  { id: 'sauce', name: 'Соус к картофелю', price: 60, perDay: 44, recipe: { ketchup: 0.025, mayo: 0.015, mustard: 0.004 } },
  { id: 'staff', name: 'Перчатки для кухни (расход смены)', price: 0, perDay: 1, internal: true, recipe: { gloves: 24 } },
];

const bakeryMenu = [
  { id: 'baton', name: 'Батон нарезной 400 г', price: 48, perDay: 2600, recipe: { flour: 0.25, sugar: 0.01, sunflower_oil: 0.01, salt: 0.004, yeast: 0.004, film_bag: 1 } },
  { id: 'baguette', name: 'Багет французский', price: 65, perDay: 900, recipe: { flour: 0.2, salt: 0.004, yeast: 0.003, kraft_bag: 1 } },
  { id: 'croissant_frozen', name: 'Круассан замороженный (для HoReCa)', price: 52, perDay: 1800, recipe: { flour: 0.06, butter: 0.035, sugar: 0.006, eggs: 0.2, yeast: 0.002 } },
  { id: 'pie_cabbage', name: 'Пирожок с капустой', price: 38, perDay: 1400, recipe: { flour: 0.06, cabbage: 0.05, onions: 0.01, sunflower_oil: 0.012, eggs: 0.05, yeast: 0.002, film_bag: 1 } },
  { id: 'muffin', name: 'Маффин шоколадный', price: 45, perDay: 1200, recipe: { flour: 0.04, sugar: 0.03, eggs: 0.3, sunflower_oil: 0.02, cocoa: 0.006, chocolate: 0.008, muffin_cup: 1 } },
  { id: 'cookie', name: 'Печенье овсяное, 10 шт', price: 120, perDay: 500, recipe: { oats: 0.12, flour: 0.08, sugar: 0.08, butter: 0.06, eggs: 0.6, honey: 0.01, film_bag: 1 } },
  { id: 'pizza_base', name: 'Основа для пиццы 30 см', price: 70, perDay: 650, recipe: { flour: 0.18, olive_oil: 0.008, salt: 0.003, yeast: 0.003, film_bag: 1 } },
  { id: 'staff', name: 'Перчатки и салфетки цеха', price: 0, perDay: 1, internal: true, recipe: { gloves: 160, napkins: 400 } },
];

export const WORKSPACES = [
  {
    id: 'zerno',
    name: 'Кофейни «Зерно»',
    short: 'Зерно',
    type: 'Сеть кофеен-пекарен',
    color: '#c8f15a',
    seed: 'zerno-2026',
    // дата подключения к Закрому: от неё идёт история. фиксирована, чтобы завтра история была та же плюс один день
    since: '2025-12-25',
    locations: [
      { id: 'msk-pyat', name: 'Пятницкая', city: 'Москва', weight: 1.25 },
      { id: 'msk-sok', name: 'Сокол', city: 'Москва', weight: 1.0 },
      { id: 'msk-bau', name: 'Бауманская', city: 'Москва', weight: 0.95 },
      { id: 'msk-tag', name: 'Таганская', city: 'Москва', weight: 0.85 },
      { id: 'spb-pet', name: 'Петроградская', city: 'Санкт-Петербург', weight: 1.1 },
      { id: 'spb-vas', name: 'Васильевский', city: 'Санкт-Петербург', weight: 0.8 },
    ],
    menu: coffeeMenu,
    monthlyBudget: 3_900_000,
    approvalLimit: 60_000,
    // доля выручки на сырьё и упаковку, к которой стремится сеть
    targetFoodCost: 0.27,
    weekday: [1.1, 0.92, 0.94, 0.97, 1.0, 1.12, 1.2],
    team: [
      { name: 'Ирина Котова', role: 'Владелец', email: 'owner@zerno.example' },
      { name: 'Артём Белов', role: 'Закупщик', email: 'buyer@zerno.example' },
      { name: 'Мария Чен', role: 'Управляющая, Москва', email: 'msk@zerno.example' },
      { name: 'Олег Рябов', role: 'Управляющий, Петербург', email: 'spb@zerno.example' },
    ],
  },
  {
    id: 'ugol',
    name: 'Бургерные «Уголь»',
    short: 'Уголь',
    type: 'Сеть быстрого питания',
    color: '#ff8a4c',
    seed: 'ugol-2026',
    since: '2026-02-23',
    locations: [
      { id: 'kzn-bau', name: 'Баумана', city: 'Казань', weight: 1.2 },
      { id: 'kzn-pob', name: 'Проспект Победы', city: 'Казань', weight: 0.9 },
      { id: 'ekb-vai', name: 'Вайнера', city: 'Екатеринбург', weight: 1.05 },
      { id: 'nn-pok', name: 'Покровская', city: 'Нижний Новгород', weight: 0.95 },
    ],
    menu: burgerMenu,
    monthlyBudget: 5_200_000,
    approvalLimit: 80_000,
    targetFoodCost: 0.31,
    weekday: [1.25, 0.85, 0.88, 0.92, 1.0, 1.18, 1.32],
    team: [
      { name: 'Рустам Галиев', role: 'Владелец', email: 'owner@ugol.example' },
      { name: 'Елена Шарова', role: 'Закупщик', email: 'buyer@ugol.example' },
      { name: 'Денис Ким', role: 'Шеф-повар сети', email: 'chef@ugol.example' },
    ],
  },
  {
    id: 'pekar',
    name: 'Хлебозавод «Северный пекарь»',
    short: 'Северный пекарь',
    type: 'Пищевое производство',
    color: '#7cc4ff',
    seed: 'pekar-2026',
    since: '2025-10-26',
    locations: [
      { id: 'spb-shop', name: 'Цех на Парнасе', city: 'Санкт-Петербург', weight: 1 },
    ],
    menu: bakeryMenu,
    monthlyBudget: 9_500_000,
    approvalLimit: 250_000,
    targetFoodCost: 0.42,
    weekday: [0.7, 1.05, 1.0, 1.0, 1.05, 1.15, 0.95],
    team: [
      { name: 'Виктор Лебедев', role: 'Директор', email: 'director@pekar.example' },
      { name: 'Наталья Орлова', role: 'Начальник снабжения', email: 'supply@pekar.example' },
      { name: 'Павел Зуев', role: 'Технолог', email: 'tech@pekar.example' },
      { name: 'Светлана Им', role: 'Бухгалтер', email: 'acc@pekar.example' },
    ],
  },
];

export const WORKSPACE_BY_ID = Object.fromEntries(WORKSPACES.map((w) => [w.id, w]));

// все виды, которые расходует организация
export function kindsUsed(ws) {
  const set = new Set();
  for (const dish of ws.menu) for (const kind of Object.keys(dish.recipe)) set.add(kind);
  return [...set];
}

export function citiesOf(ws) {
  return [...new Set(ws.locations.map((l) => l.city))];
}
