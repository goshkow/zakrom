// подвал страницы: источники открытых данных и лицензии. ODbL и CC BY требуют подписи и ссылки
import { el } from '../core/dom.js';
import { dayFull } from '../core/format.js';
import { state } from './state.js';

export function footer() {
  const src = (id) => state.catalog.sources.find((s) => s.id === id);
  const off = src('off');
  const osm = src('osm');
  const wd = src('wikidata');
  const fx = state.marketRaw?.fx;
  const wb = state.marketRaw?.commodities;
  const a = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
  return el(
    'footer',
    { class: 'footer' },
    el('div', { class: 'source-line' },
      el('span', {}, 'Товары: ', a('https://world.openfoodfacts.org', 'Open Food Facts'), ' (ODbL, фото CC BY-SA)'),
      el('span', {}, 'Организации: ', a('https://www.openstreetmap.org/copyright', '© участники OpenStreetMap'), ' (ODbL) и ', a('https://www.wikidata.org', 'Wikidata'), ' (CC0)'),
      el('span', {}, 'Курсы: ', a('https://www.cbr.ru/currency_base/', 'Банк России')),
      el('span', {}, 'Сырьё: ', a('https://www.worldbank.org/en/research/commodity-markets', 'World Bank Pink Sheet'), ' (CC BY 4.0)'),
      el('span', { text: `Снимок данных: ${dayFull((off?.fetchedAt ?? osm?.fetchedAt ?? wd?.fetchedAt ?? '').slice(0, 10))}${fx ? `, курсы на ${dayFull(fx.series?.USD?.at(-1)?.[0] ?? '')}` : ''}${wb ? `, сырьё по ${wb.series?.wheat?.points?.at(-1)?.[0] ?? '—'}` : ''}` }),
    ),
    el('span', { text: 'Закром · песочница: цены, условия и заказы смоделированы' }),
  );
}
