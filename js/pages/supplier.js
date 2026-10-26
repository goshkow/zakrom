// профиль поставщика: реальные сведения о компании + показатели и ассортимент из песочницы
import { el, icon, safeUrl, safeTel, safeMail } from '../core/dom.js';
import { rub, rubShort, pct, num, dayShort, dayFull, addDays, monthAxis, monthLabel } from '../core/format.js';
import { state, orders, toggleFavorite, setNote, locationName } from '../app/state.js';
import { GROUPS, KINDS } from '../model/kinds.js';
import { filterOrders, supplierScore, total } from '../model/analytics.js';
import { shiftMonth } from '../model/market.js';
import { badge, button, card, kpi, kv, empty, dataTable, logoTile, sandboxNote, toast } from '../ui/components.js';
import { stackedBars, legend } from '../ui/charts.js';
import { backLink, statusBadge, issueBadges, productCell } from './common.js';
import { link } from '../app/router.js';

export const title = (route) => state.supply.suppliers.get(route.id)?.name ?? 'Поставщик';

const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function render(route) {
  const s = state.supply.suppliers.get(route.id);
  if (!s) return el('div', {}, backLink('#/suppliers', 'Поставщики'), empty('Поставщик не найден', 'Возможно, он не возит в города этой организации. Переключите организацию или вернитесь к списку.'));
  const from = addDays(state.today, -89);
  const all = orders().filter((o) => o.supplierId === s.id);
  const recent = filterOrders(all, { from, to: state.today });
  const prevRecent = filterOrders(all, { from: addDays(from, -90), to: addDays(from, -1) });
  const spend = total(recent);
  const score = supplierScore(recent, s.id, from, state.today);
  const fav = state.user.favorites.includes(s.id);
  const offers = state.supply.offersBySupplier.get(s.id) ?? [];
  const working = recent.length > 0;

  const site = safeUrl(s.website);
  const head = el('header', { class: 'page-head' },
    el('div', { class: 'row', style: { gap: '16px', alignItems: 'center' } },
      logoTile(s, { large: true }),
      el('div', {},
        el('h1', { class: 'page-title', text: s.name }),
        el('div', { class: 'row-wrap', style: { marginTop: '8px' } },
          badge(s.typeLabel, 'outline'),
          s.city ? badge(s.city, 'outline', { iconName: 'pin' }) : null,
          working ? badge('Работаем', 'good', { dot: true }) : badge('Не работаем', ''),
          s.groups.some((g) => g === 'dairy' || g === 'meat') ? badge('ВетИС: ВСД', 'info') : null,
          badge(`ЭДО: ${s.terms.edo}`, 'info'),
        ),
      ),
    ),
    el('div', { class: 'page-actions' },
      button(fav ? 'В избранном' : 'В избранное', { iconName: 'star', onClick: () => { toggleFavorite(s.id); toast(fav ? 'Убрали из избранного' : 'Добавили в избранное'); } }),
      site ? el('a', { class: 'btn', href: site, target: '_blank', rel: 'noopener noreferrer' }, icon('globe'), 'Сайт') : null,
      el('a', { class: 'btn btn-primary', href: link('rfq', null, { new: 1, supplier: s.id }) }, icon('gavel'), 'Запросить цены'),
    ),
  );

  const tiles = el('div', { class: 'tiles tiles-5' },
    kpi({ label: 'Расходы за 90 дней', value: rubShort(spend), delta: total(prevRecent) ? spend / total(prevRecent) - 1 : null, upIsGood: false, meta: 'к прошлым 90 дням' }),
    kpi({ label: 'Заказы', value: num(recent.length), meta: recent.length ? `средний ${rubShort(spend / recent.length)}` : 'за 90 дней' }),
    kpi({ label: 'OTIF', value: score ? pct(score.otif) : '—', meta: score ? `вовремя ${pct(score.onTime, { digits: 0 })}, полностью ${pct(score.inFull, { digits: 0 })}` : 'нет поставок', hint: 'On Time In Full: поставка в срок, без недовоза и брака' }),
    kpi({ label: 'Срок поставки', value: score ? `${num(score.avgLead, 1)} дн.` : `${s.terms.leadDays} дн.`, meta: `по договору ${s.terms.leadDays} дн.` }),
    kpi({ label: 'Цена в УПД', value: score ? pct(score.priceAccuracy, { digits: 0 }) : '—', meta: 'поставок без завышения цены', hint: 'Сверка цены в УПД с ценой в заказе: трёхсторонняя проверка заказ - приёмка - документ' }),
  );

  // расходы по месяцам за год, по категориям
  const months = [];
  for (let i = 11; i >= 0; i -= 1) months.push(shiftMonth(state.today.slice(0, 7), -i));
  const year = filterOrders(all, { from: `${months[0]}-01`, to: state.today });
  const byMonth = months.map((m) => {
    const row = {};
    for (const o of year) if (o.createdDay.startsWith(m)) for (const l of o.lines) row[KINDS[l.kind].group] = (row[KINDS[l.kind].group] ?? 0) + l.packs * (l.invoicePrice ?? l.price);
    return row;
  });
  const series = GROUPS.filter((g) => s.groups.includes(g.id) || byMonth.some((r) => r[g.id])).map((g) => ({ key: g.id, label: g.short, color: g.color }));
  const spendCard = card({
    title: 'Расходы по месяцам',
    sub: 'Сколько и на что тратим у этого поставщика',
    body: year.length ? el('div', { class: 'stack' }, stackedBars({ labels: months, series, rows: byMonth, height: 220, xLabel: monthAxis, title: monthLabel }), series.length > 1 ? legend(series) : null) : empty('Заказов у этого поставщика не было', 'Можно запросить цены через тендер и сравнить с текущими'),
  });

  const assortment = card({
    title: `Ассортимент · ${offers.length}`,
    sub: 'Цены песочницы за упаковку и изменение за 3 месяца',
    flush: true,
    body: dataTable({
      columns: [
        { key: 'p', label: 'Товар', render: (r) => el('a', { href: link('catalog', null, { p: r.p.id }) }, productCell(r.p)), sort: (r) => r.p.name, defaultDir: 'asc' },
        { key: 'price', label: 'Цена', align: 'right', render: (r) => el('div', {}, el('div', { class: 'num', text: rub(r.price, { kopecks: true }) }), el('div', { class: 'cell-sub', text: `${rub(r.price / r.p.pack, { kopecks: r.price / r.p.pack < 100 })}/${r.p.unit}` })), sort: (r) => r.price },
        { key: 'chg', label: '3 мес.', align: 'right', render: (r) => el('span', { class: r.change > 0.03 ? 'warn' : r.change < -0.01 ? 'good' : 'muted', text: pct(r.change, { sign: true }) }), sort: (r) => r.change },
      ],
      rows: offers.map((o) => {
        const p = state.supply.products.get(o.productId);
        const price = state.supply.priceAt(o, state.today);
        const before = state.supply.priceAt(o, addDays(state.today, -92));
        return { p, price, change: before ? price / before - 1 : 0 };
      }),
      sortKey: 'p',
      sortDir: 'asc',
      compact: true,
      limit: 60,
    }),
  });

  const lastOrders = card({
    title: 'Последние заказы',
    actions: el('a', { class: 'card-link', href: link('orders', null, { supplier: s.id }) }, 'Все', icon('chevron-right')),
    flush: true,
    body: all.length
      ? el('div', { class: 'list' }, all.slice(0, 6).map((o) => el('a', { class: 'list-item', href: link('orders', o.id) }, el('div', { style: { flex: '1', minWidth: '0' } }, el('div', { class: 'cell-title', text: `№ ${o.number}` }), el('div', { class: 'cell-sub', text: `${locationName(o.locId)} · ${dayShort(o.createdDay)}` })), el('div', { class: 'row', style: { gap: '6px' } }, issueBadges(o).slice(0, 1), statusBadge(o.status)), el('span', { class: 'num', style: { minWidth: '90px', textAlign: 'right' }, text: rubShort(o.total) }))))
      : empty('Заказов пока нет'),
  });

  const about = card({
    title: 'О компании',
    sub: s.source === 'wikidata' ? 'Сведения из Wikidata' : 'Сведения из OpenStreetMap',
    body: el('div', { class: 'stack' },
      s.description ? el('p', { class: 'muted', text: capitalize(s.description) }) : null,
      kv([
        ['Тип', s.typeLabel],
        s.city ? ['Город', s.city] : null,
        s.address ? ['Адрес', s.address] : null,
        s.founded ? ['Основана', `${s.founded} г.`] : null,
        s.employees ? ['Сотрудники', num(s.employees)] : null,
        s.ogrn ? ['ОГРН', s.ogrn] : null,
        s.brands?.length ? ['Бренды', s.brands.join(', ')] : null,
        s.openingHours ? ['Часы работы', s.openingHours] : null,
        site ? ['Сайт', el('a', { href: site, target: '_blank', rel: 'noopener noreferrer', class: 'card-link', text: site.replace(/^https?:\/\/(www\.)?/, '') })] : null,
        s.phone && safeTel(s.phone) ? ['Телефон', el('a', { href: safeTel(s.phone), class: 'card-link', text: s.phone })] : null,
        s.email && safeMail(s.email) ? ['Почта', el('a', { href: safeMail(s.email), class: 'card-link', text: s.email })] : null,
        ['Источник', el('a', { href: safeUrl(s.sourceUrl) ?? '#', target: '_blank', rel: 'noopener noreferrer', class: 'card-link', text: s.source === 'wikidata' ? `Wikidata ${s.wikidata}` : `OpenStreetMap ${s.osm?.type ?? ''} ${s.osm?.id ?? ''}` })],
        s.checkedAt ? ['Данные на', dayFull(s.checkedAt)] : null,
      ]),
      el('div', { class: 'row-wrap' },
        el('a', { class: 'btn btn-sm', href: `https://pb.nalog.ru/search.html#t=${Date.now()}&mode=search-ul&queryUl=${encodeURIComponent(s.name.replace(/[«»"]/g, ''))}`, target: '_blank', rel: 'noopener noreferrer' }, icon('shield'), 'Проверить в ФНС'),
        Number.isFinite(s.coords?.lat) && Number.isFinite(s.coords?.lon) ? el('a', { class: 'btn btn-sm', href: `https://www.openstreetmap.org/?mlat=${s.coords.lat}&mlon=${s.coords.lon}#map=15/${s.coords.lat}/${s.coords.lon}`, target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), 'На карте') : null,
        s.ruwiki ? el('a', { class: 'btn btn-sm', href: `https://ru.wikipedia.org/wiki/${encodeURIComponent(s.ruwiki)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Википедия') : null,
      ),
    ),
  });

  const t = s.terms;
  const terms = card({
    title: 'Условия поставки',
    sub: 'Песочница: таких данных нет в открытых источниках',
    body: el('div', { class: 'stack' },
      kv([
        ['Минимальный заказ', rub(t.minOrder)],
        ['Доставка', t.deliveryDays.length >= 6 ? 'ежедневно, кроме воскресенья' : t.deliveryDays.map((d) => DAY_NAMES[d]).join(', ')],
        ['Срок', t.leadDays === 1 ? 'на следующий день после заказа' : `${t.leadDays} дн. после заказа`],
        ['Оплата', t.paymentDays === 0 ? 'при заказе' : `отсрочка ${t.paymentDays} дн. после приёмки`],
        ['Документооборот', `УПД через ${t.edo}`],
        ['Сертификаты и документы', t.certs.join(', ')],
        ['Охват', s.national ? 'вся Россия' : `${s.city} и область`],
      ]),
      sandboxNote('Цены и условия смоделированы: компания настоящая, а договора с ней в песочнице нет.'),
    ),
  });

  const noteField = el('textarea', { class: 'textarea', placeholder: 'Контакт менеджера, договорённости, на что обратить внимание при приёмке…', 'aria-label': 'Заметка о поставщике' });
  noteField.value = state.user.notes[s.id] ?? '';
  noteField.addEventListener('change', () => { setNote(s.id, noteField.value); toast('Заметка сохранена'); });
  const notes = card({ title: 'Заметки', sub: 'Видны только в этом браузере', body: noteField });

  return el('div', { class: 'stack-l' },
    backLink('#/suppliers', 'Поставщики'),
    head,
    tiles,
    el('div', { class: 'grid-main-r' },
      el('div', { class: 'stack-l' }, spendCard, lastOrders, assortment),
      el('div', { class: 'stack-l' }, about, terms, notes),
    ),
  );
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

