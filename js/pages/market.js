// «Рынок»: настоящие курсы Банка России и биржевые цены Всемирного банка, и как они касаются ваших закупок
import { el, safeUrl } from '../core/dom.js';
import { rub, pct, num, dayShort, dayFull, monthAxis, monthLabel, addDays } from '../core/format.js';
import { state, orders } from '../app/state.js';
import { KINDS, COMMODITY_LABELS } from '../model/kinds.js';
import { filterOrders, sumBy, total } from '../model/analytics.js';
import { kpi, card, segmented, badge, sandboxNote } from '../ui/components.js';
import { lineChart } from '../ui/charts.js';
import { pageHead } from './common.js';
import { setQuery, link } from '../app/router.js';

export const title = () => 'Рынок';

const FX = [
  { code: 'USD', label: 'Доллар США', color: 'var(--s1)' },
  { code: 'EUR', label: 'Евро', color: 'var(--s3)' },
  { code: 'CNY', label: 'Китайский юань', color: 'var(--s2)' },
];

const UNIT_RU = { '($/mt)': '$ за тонну', '($/kg)': '$ за кг', '($/bbl)': '$ за баррель' };

export function render(route) {
  const span = route.query.get('span') === '90' ? 90 : 365;
  const fx = state.market.fx;
  const fxSource = state.marketRaw?.fx;
  const wb = state.marketRaw?.commodities;

  // какая доля расходов за 90 дней зависит от каждого сырьевого ряда
  const recent = filterOrders(orders(), { from: addDays(state.today, -89), to: state.today });
  const spend = total(recent);
  const byKind = sumBy(recent, (o, l) => l.kind);
  const exposure = new Map();
  for (const [kind, value] of byKind) {
    const c = KINDS[kind].commodity;
    if (!c) continue;
    const e = exposure.get(c) ?? { value: 0, kinds: new Set() };
    e.value += value;
    e.kinds.add(kind);
    exposure.set(c, e);
  }

  const fxCards = FX.map((f) => {
    const points = (fx[f.code] ?? []).filter(([day]) => day >= addDays(state.today, -span));
    const last = points.at(-1)?.[1];
    const monthAgo = (fx[f.code] ?? []).filter(([day]) => day <= addDays(state.today, -30)).at(-1)?.[1];
    return { f, points, last, change: last && monthAgo ? last / monthAgo - 1 : null };
  });

  const head = pageHead('Рынок сырья и курсы', 'Настоящие данные: официальные курсы Банка России и месячные биржевые цены Всемирного банка. Оптовые цены песочницы идут за ними с лагом в месяц.', [
    segmented([{ value: '90', label: '90 дней' }, { value: '365', label: 'Год' }], String(span), (v) => setQuery({ span: v === '365' ? null : v }), 'Период курсов'),
  ]);

  const tiles = el('div', { class: 'tiles tiles-3' }, fxCards.map(({ f, points, last, change }) => kpi({
    label: `${f.label}, ₽`,
    value: last ? num(last, 2) : '—',
    delta: change,
    upIsGood: false,
    meta: `за 30 дней · ЦБ на ${dayShort(points.at(-1)?.[0] ?? state.today)}`,
    spark: points.map(([, v]) => v),
    sparkColor: f.color,
  })));

  const fxCharts = el('div', { class: 'grid-3' }, fxCards.map(({ f, points }) => card({
    title: `${f.code}/RUB`,
    sub: f.label,
    body: points.length ? lineChart({ labels: points.map(([d]) => d), series: [{ key: f.code, label: f.code, color: f.color, values: points.map(([, v]) => v) }], height: 180, xLabel: dayShort, title: dayFull, format: (v) => `${num(v, 2)} ₽`, yFormat: (v) => num(v, v < 20 ? 1 : 0), area: true }) : el('p', { class: 'muted', text: 'Нет данных' }),
  })));

  const names = state.market.commodityNames.filter((n) => COMMODITY_LABELS[n]);
  names.sort((a, b) => (exposure.get(b)?.value ?? 0) - (exposure.get(a)?.value ?? 0));
  const commodityCards = names.map((name) => {
    const table = state.market.commodityTable(name, 24);
    if (!table.length) return null;
    const last = table.at(-1);
    const yearAgo = table.at(-13) ?? table[0];
    const e = exposure.get(name);
    const unit = UNIT_RU[state.market.commodityUnit(name)] ?? state.market.commodityUnit(name);
    return card({
      title: COMMODITY_LABELS[name],
      sub: `${num(last.usd, last.usd < 10 ? 2 : 0)} ${unit} · ${monthLabel(last.month)}`,
      actions: badge(pct(last.rub / yearAgo.rub - 1, { sign: true }), last.rub > yearAgo.rub ? 'warn' : 'good'),
      body: el('div', { class: 'stack', style: { gap: '10px' } },
        lineChart({ labels: table.map((r) => r.month), series: [{ key: name, label: 'В рублях', color: e ? 'var(--s2)' : 'var(--text-3)', values: table.map((r) => r.rub) }], height: 150, xLabel: monthAxis, title: monthLabel, format: (v) => rub(v), yFormat: () => '', endLabels: false }),
        el('div', { class: 'cell-sub' }, e
          ? el('span', {}, 'Влияет на ', [...e.kinds].map((k, i) => [i ? ', ' : '', el('a', { class: 'card-link', href: link('catalog', null, { kind: k }), text: KINDS[k].label.toLowerCase() })]), ` · ${pct(e.value / (spend || 1), { digits: 1 })} ваших расходов`)
          : el('span', { text: 'В закупках этой организации не участвует' })),
      ),
    });
  }).filter(Boolean);

  const exposed = [...exposure.values()].reduce((s, e) => s + e.value, 0);
  return el('div', { class: 'stack-l' },
    head,
    tiles,
    fxCharts,
    el('div', { class: 'between' }, el('div', {}, el('h2', { class: 'card-title', style: { fontSize: '17px' }, text: 'Биржевое сырьё' }), el('p', { class: 'card-sub', text: `${pct(exposed / (spend || 1), { digits: 0 })} ваших расходов за 90 дней зависят от биржи. Цены в рублях: доллар × средний курс ЦБ за месяц` }))),
    el('div', { class: 'grid-3' }, commodityCards),
    el('div', { class: 'source-line' },
      fxSource ? el('span', {}, 'Курсы: ', el('a', { href: safeUrl(fxSource.url) ?? '#', target: '_blank', rel: 'noopener noreferrer', text: fxSource.source }), `, загружены ${dayFull(String(fxSource.fetchedAt).slice(0, 10))}`) : null,
      wb ? el('span', {}, 'Сырьё: ', el('a', { href: safeUrl(wb.url) ?? '#', target: '_blank', rel: 'noopener noreferrer', text: wb.source }), `, ${wb.license}`) : null,
    ),
    sandboxNote('Курсы и биржевые цены настоящие. Как именно они переходят в оптовые цены поставщиков - модель песочницы: для каждого вида сырья задана доля биржевого движения, которая доходит до прайса.'),
  );
}
