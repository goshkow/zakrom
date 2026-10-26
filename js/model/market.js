// рынок: курсы ЦБ и биржевые цены Всемирного банка (настоящие данные) -> индекс цены для каждого вида сырья
// оптовые цены песочницы двигаются вслед за этими индексами, поэтому графики цен повторяют реальный рынок
import { KINDS } from './kinds.js';
import { unit } from '../core/rng.js';

const monthKey = (day) => day.slice(0, 7);

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
}

// оптовый прайс реагирует на биржу с запаздыванием: берём цену прошлого месяца
const LAG_MONTHS = 1;
// общий рост цен на продукты без биржевой привязки, в месяц
const DRIFT = 0.0055;

export function createMarket(market, today) {
  const fx = market?.fx?.series ?? {};
  const usd = fx.USD ?? [];
  const usdByMonth = new Map();
  for (const [day, value] of usd) {
    const key = monthKey(day);
    const acc = usdByMonth.get(key) ?? { sum: 0, n: 0 };
    acc.sum += value;
    acc.n += 1;
    usdByMonth.set(key, acc);
  }
  const usdMonths = [...usdByMonth.keys()].sort();
  const usdAt = (key) => {
    const acc = usdByMonth.get(key);
    if (acc) return acc.sum / acc.n;
    // за пределами снимка курса берём ближайший известный месяц
    if (!usdMonths.length) return 90;
    const nearest = key < usdMonths[0] ? usdMonths[0] : usdMonths[usdMonths.length - 1];
    const n = usdByMonth.get(nearest);
    return n.sum / n.n;
  };

  const series = market?.commodities?.series ?? {};
  const rubCache = new Map();
  // цена сырья в рублях за месяц: долларовая биржевая цена × средний курс месяца
  const commodityRub = (name, key) => {
    const cacheKey = `${name}|${key}`;
    if (rubCache.has(cacheKey)) return rubCache.get(cacheKey);
    const points = series[name]?.points ?? [];
    if (!points.length) return null;
    let value = null;
    for (const [m, v] of points) {
      if (m <= key) value = v;
      else break;
    }
    if (value === null) value = points[0][1];
    const result = value * usdAt(key);
    rubCache.set(cacheKey, result);
    return result;
  };

  const nowKey = monthKey(today);
  // база цен - месяц снимка данных, а не «сегодня»: иначе в новом месяце пересчитались бы цены всех старых заказов
  const baseKey = String(market?.fx?.fetchedAt ?? market?.commodities?.fetchedAt ?? today).slice(0, 7);
  const idxCache = new Map();

  // индекс цены вида на месяц: 1 = прайс месяца снимка. дальше снимка биржа «замирает», остаётся общий рост цен
  const index = (kind, day) => {
    const key = monthKey(day) > nowKey ? nowKey : monthKey(day);
    const cacheKey = `${kind}|${key}`;
    if (idxCache.has(cacheKey)) return idxCache.get(cacheKey);
    const spec = KINDS[kind];
    const ago = monthsBetween(baseKey, key);
    let idx = (1 + DRIFT) ** -ago;
    if (spec?.commodity) {
      const base = commodityRub(spec.commodity, shiftMonth(baseKey, -LAG_MONTHS));
      const then = commodityRub(spec.commodity, shiftMonth(key < baseKey ? key : baseKey, -LAG_MONTHS));
      if (base && then) idx *= 1 + spec.beta * (then / base - 1);
    }
    // небольшой месячный шум прайса, одинаковый для всех поставщиков вида: так видны «ступеньки» прайс-листов
    if (key !== baseKey) idx *= 1 + (unit(`${kind}|${key}`) - 0.5) * 0.02;
    idxCache.set(cacheKey, idx);
    return idx;
  };

  // ряд для страницы «Рынок»: рубли и доллары по месяцам
  const commodityTable = (name, months = 24) => {
    const points = series[name]?.points ?? [];
    const tail = points.slice(-months);
    return tail.map(([m, v]) => ({ month: m, usd: v, rub: v * usdAt(m) }));
  };

  return {
    today,
    nowKey,
    baseKey,
    index,
    usdAt,
    commodityRub,
    commodityTable,
    commodityNames: Object.keys(series),
    commodityUnit: (name) => series[name]?.unit ?? '',
    fx,
    sources: { fx: market?.fx ?? null, commodities: market?.commodities ?? null },
  };
}
