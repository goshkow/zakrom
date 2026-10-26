// сравнение поставщиков и подсказка, с кем связаться первым
// веса простые и видны в интерфейсе: надёжность важнее всего, потом срок, порог заказа, отсрочка и документы

export const CRITERIA = [
  { key: 'otif', label: 'надёжность поставок', weight: 0.35, higherBetter: true },
  { key: 'leadDays', label: 'быстрая доставка', weight: 0.2, higherBetter: false },
  { key: 'minOrder', label: 'низкий минимальный заказ', weight: 0.15, higherBetter: false },
  { key: 'paymentDays', label: 'отсрочка платежа', weight: 0.15, higherBetter: true },
  { key: 'certCount', label: 'больше документов', weight: 0.1, higherBetter: true },
  { key: 'local', label: 'работает в вашем городе', weight: 0.05, higherBetter: true },
];

/**
 * items - [{ id, otif, leadDays, minOrder, paymentDays, certCount, local }]
 * возвращает список по убыванию баллов: { id, score, reasons } , reasons - до двух сильных сторон
 */
export function rankSuppliers(items) {
  if (!items.length) return [];
  const range = (key) => {
    const values = items.map((i) => Number(i[key]) || 0);
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  const ranges = Object.fromEntries(CRITERIA.map((c) => [c.key, range(c.key)]));
  const part = (item, c) => {
    const { min, max } = ranges[c.key];
    if (max === min) return 0.5;
    const x = ((Number(item[c.key]) || 0) - min) / (max - min);
    return c.higherBetter ? x : 1 - x;
  };
  return items
    .map((item) => {
      const parts = CRITERIA.map((c) => ({ c, v: part(item, c) }));
      const score = parts.reduce((sum, p) => sum + p.v * p.c.weight, 0);
      const reasons = items.length > 1
        ? parts.filter((p) => p.v === 1 && ranges[p.c.key].max !== ranges[p.c.key].min).sort((a, b) => b.c.weight - a.c.weight).slice(0, 2).map((p) => p.c.label)
        : [];
      return { id: item.id, score, reasons };
    })
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}
