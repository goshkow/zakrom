// детерминированный генератор: одна и та же строка-зерно даёт ту же историю закупок на любом компьютере

// cyrb53: быстрый хэш строки в 53-битное число
export function hash(text, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// число 0..1 из строки: для свойств, которые не должны зависеть от порядка генерации (наценка, надёжность)
export function unit(text) {
  return (hash(text) % 1000003) / 1000003;
}

export function between(text, min, max) {
  return min + unit(text) * (max - min);
}

// mulberry32: поток чисел для истории, где важен порядок
export function stream(seedText) {
  let state = hash(seedText) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    // примерно нормальное распределение (сумма трёх равномерных): хватает для шума спроса
    normal: (mean = 0, sd = 1) => mean + sd * ((next() + next() + next() - 1.5) / 0.5),
  };
}

// время события внутри дня, одинаковое при каждом открытии: для шкалы событий старых заказов
export function stableTime(key, day, fromHour, toHour) {
  const [y, m, d] = day.split('-').map(Number);
  const minutes = Math.floor(fromHour * 60 + unit(`${key}|${day}`) * (toHour - fromHour) * 60);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime();
}
