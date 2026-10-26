// карточка заказа: строки, трёхсторонняя сверка (заказ - приёмка - УПД), документы, оплата и события
import { el, icon } from '../core/dom.js';
import { rub, num, dayShort, dayFull, dayHuman, addDays, clockTime, relTime } from '../core/format.js';
import { state, orderById, decide, receive, simulateArrival, cancelUserOrder, cartAddMany, locationName, CONFIRM_AFTER_MS } from '../app/state.js';
import { KINDS } from '../model/kinds.js';
import { badge, button, card, kv, empty, openModal, toast, logoTile, sandboxNote, note, confirmDialog } from '../ui/components.js';
import { backLink, statusBadge, issueBadges, productCell } from './common.js';
import { link } from '../app/router.js';
import { stableTime } from '../core/rng.js';

export const title = (route) => {
  const o = orderById(route.id);
  return o ? `Заказ № ${o.number}` : 'Заказ';
};

export function render(route) {
  const o = orderById(route.id);
  if (!o) return el('div', {}, backLink('#/orders', 'Заказы'), empty('Заказ не найден', 'Он мог быть в другой организации. Вернитесь к списку.'));
  const s = state.supply.suppliers.get(o.supplierId);
  const delivered = o.status === 'delivered' || o.status === 'received';

  const actions = [];
  if (o.status === 'approval') {
    actions.push(button('Отклонить', { variant: 'ghost', onClick: () => rejectDialog(o) }));
    actions.push(button('Согласовать', { variant: 'primary', iconName: 'check', onClick: () => { decide(o.id, 'approved'); toast(`Заказ № ${o.number} согласован и отправлен`); } }));
  }
  if (o.status === 'arrived') actions.push(button('Принять поставку', { variant: 'primary', iconName: 'receipt-check', onClick: () => receiveDialog(o) }));
  if (o.source === 'user' && ['sent', 'confirmed', 'in_transit'].includes(o.status)) {
    actions.push(button('Отменить', { variant: 'ghost', onClick: async () => { if (await confirmDialog({ title: 'Отменить заказ?', text: 'Поставщик песочницы получит отмену. Заказ останется в истории.', confirm: 'Отменить заказ', danger: true })) { cancelUserOrder(o.id); toast('Заказ отменён'); } } }));
    actions.push(button('Привезти сейчас', { iconName: 'truck', title: 'Песочница: не ждать дня доставки', onClick: () => { simulateArrival(o.id); toast('Машина на рампе: можно принимать'); } }));
  }
  if (delivered && o.issues.length) actions.push(button('Претензия', { iconName: 'file', onClick: () => claimDialog(o) }));
  actions.push(button('Повторить', { iconName: 'refresh', onClick: () => {
    try { cartAddMany(o.lines.map((l) => ({ productId: l.productId, supplierId: o.supplierId, packs: l.packs, locId: o.locId }))); toast('Позиции заказа добавлены в корзину'); }
    catch (error) { toast(error.message, { error: true }); }
  } }));

  const head = el('header', { class: 'page-head' },
    el('div', {},
      el('div', { class: 'row-wrap', style: { gap: '10px' } }, el('h1', { class: 'page-title', text: `Заказ № ${o.number}` }), statusBadge(o.status), issueBadges(o)),
      el('p', { class: 'page-sub', text: `${s.name} → ${locationName(o.locId)} · создан ${dayFull(o.createdDay)}${o.source === 'user' ? ' вами' : ' автозаказом'}` }),
    ),
    el('div', { class: 'page-actions' }, actions),
  );

  const linesCard = card({
    title: `Позиции · ${o.lines.length}`,
    sub: delivered ? 'По заказу, по факту приёмки и по УПД' : 'Цены зафиксированы на момент заказа',
    flush: true,
    body: el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Товар' }), el('th', { class: 'r', text: 'Заказано' }), delivered ? el('th', { class: 'r', text: 'Принято' }) : null, el('th', { class: 'r', text: 'Цена' }), delivered ? el('th', { class: 'r', text: 'Цена в УПД' }) : null, el('th', { class: 'r', text: 'Сумма' }))),
      el('tbody', {}, o.lines.map((l) => {
        const p = state.supply.products.get(l.productId);
        const got = (l.receivedPacks ?? l.packs) - (l.rejectedPacks ?? 0);
        const priceDiff = delivered && l.invoicePrice > l.price + 0.005;
        return el('tr', {},
          el('td', {}, el('a', { href: link('catalog', null, { p: p.id }) }, productCell(p, `${p.spec.label}${KINDS[l.kind].vet ? ' · ВСД' : ''}${KINDS[l.kind].marked ? ' · Честный знак' : ''}`))),
          el('td', { class: 'r', text: `${num(l.packs)} уп.` }),
          delivered ? el('td', { class: `r ${got < l.packs ? 'warn' : ''}`, text: `${num(got)} уп.${l.rejectedPacks ? `, брак ${l.rejectedPacks}` : ''}` }) : null,
          el('td', { class: 'r', text: rub(l.price, { kopecks: true }) }),
          delivered ? el('td', { class: `r ${priceDiff ? 'bad' : ''}`, text: rub(l.invoicePrice ?? l.price, { kopecks: true }) }) : null,
          el('td', { class: 'r', text: rub((delivered ? got * (l.invoicePrice ?? l.price) : l.packs * l.price)) }),
        );
      })),
    )),
    foot: el('div', { class: 'between', style: { width: '100%' } }, el('span', { text: delivered ? `По заказу ${rub(o.total)}` : `${o.lines.length} поз.` }), el('b', { class: 'num', style: { color: 'var(--text)', fontSize: '15px' }, text: rub(delivered ? o.invoiceTotal : o.total) })),
  });

  const match = delivered ? matchCard(o) : null;
  const timeline = card({ title: 'События', body: timelineView(o) });
  const docs = card({
    title: 'Документы',
    body: kv([
      ['УПД', docText('upd', o.docs.upd, o.docs.edo)],
      o.docs.vsd ? ['ВСД, Меркурий', docText('vsd', o.docs.vsd)] : null,
      o.docs.marking ? ['Честный знак', docText('marking', o.docs.marking)] : null,
      ['ЭДО', o.docs.edo],
    ]),
  });
  const pay = o.payment;
  const payment = card({
    title: 'Оплата',
    body: kv([
      ['Сумма', rub(pay.amount)],
      ['Условия', s.terms.paymentDays ? `отсрочка ${s.terms.paymentDays} дн.` : 'оплата при заказе'],
      ['Срок', `${dayFull(pay.dueDay)}${!pay.paidDay && pay.dueDay < state.today && delivered ? ' · просрочен' : ''}`],
      ['Статус', pay.paidDay ? `оплачен ${dayShort(pay.paidDay)}` : delivered ? 'ждёт оплаты' : 'после приёмки'],
    ]),
  });
  const loc = state.ws.locations.find((l) => l.id === o.locId);
  const delivery = card({ title: 'Доставка', body: kv([['Точка', locationName(o.locId)], ['Адрес', loc?.address || 'Адрес не указан'], ['Приёмка', `${loc?.receivingStart ?? '08:00'}–${loc?.receivingEnd ?? '12:00'}`]]) });
  const supplierCard = card({
    body: el('a', { class: 'row', href: link('suppliers', s.id), style: { gap: '12px' } }, logoTile(s), el('div', { style: { flex: '1', minWidth: '0' } }, el('div', { class: 'cell-title truncate', text: s.name }), el('div', { class: 'cell-sub', text: `${s.typeLabel} · мин. заказ ${rub(s.terms.minOrder)}` })), icon('chevron-right', 'faint')),
  });

  const hint = o.source === 'user' && !delivered ? sandboxNote('Заказ создан в песочнице: поставщик подтверждает его автоматически через минуту, а привезти можно кнопкой «Привезти сейчас», не дожидаясь дня доставки.') : null;
  const decision = o.decision ? note(`${o.decision.status === 'approved' ? 'Согласовал' : 'Отклонил'} ${o.decision.by}, ${clockTime(o.decision.at)}${o.decision.comment ? `: «${o.decision.comment}»` : ''}`, { iconName: o.decision.status === 'approved' ? 'check' : 'x' }) : null;

  return el('div', { class: 'stack-l' },
    backLink('#/orders', 'Заказы'),
    head,
    hint,
    el('div', { class: 'grid-main-r' },
      el('div', { class: 'stack-l' }, linesCard, match, decision, o.receipt?.note ? note(`Комментарий приёмки: ${o.receipt.note}`, { iconName: 'edit' }) : null),
      el('div', { class: 'stack-l' }, supplierCard, delivery, timeline, docs, payment),
    ),
  );
}

const DOC_TEXT = {
  upd: { none: 'придёт с поставкой', pending: 'пришёл, ждёт подписи', signed: 'подписан' },
  vsd: { issued: 'оформлен поставщиком', pending: 'ждёт гашения', redeemed: 'погашен' },
  marking: { pending: 'коды придут с УПД', accepted: 'коды приняты' },
};

function docText(type, status, edo) {
  const tone = status === 'signed' || status === 'redeemed' || status === 'accepted' ? 'good' : status === 'pending' ? 'serious' : '';
  return el('span', { class: 'row-wrap', style: { gap: '4px 6px' } }, badge(DOC_TEXT[type][status] ?? status, tone, { dot: true }), type === 'upd' && edo && status !== 'none' ? el('span', { class: 'faint', style: { fontSize: '12.5px' }, text: `через ${edo}` }) : null);
}

function matchCard(o) {
  const rows = o.lines.map((l) => {
    const p = state.supply.products.get(l.productId);
    const got = (l.receivedPacks ?? l.packs) - (l.rejectedPacks ?? 0);
    const qtyOk = got === l.packs;
    const priceOk = !(l.invoicePrice > l.price + 0.005);
    return { p, l, got, qtyOk, priceOk };
  });
  const bad = rows.filter((r) => !r.qtyOk || !r.priceOk);
  const over = rows.reduce((s, r) => s + Math.max(0, (r.l.invoicePrice ?? r.l.price) - r.l.price) * r.got, 0);
  const mark = (ok) => el('span', { class: ok ? 'good' : 'bad' }, icon(ok ? 'check' : 'x'));
  return card({
    title: 'Сверка: заказ, приёмка, УПД',
    sub: bad.length ? `Расхождения по ${bad.length} поз.${over > 0 ? `, переплата по УПД ${rub(over)}` : ''}` : 'Всё сходится: количество и цены совпали с заказом',
    actions: bad.length ? badge('Есть расхождения', 'serious') : badge('Сходится', 'good'),
    flush: true,
    body: el('div', { class: 'table-wrap' }, el('table', { class: 'table table-compact' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Позиция' }), el('th', { class: 'r', text: 'Заказ' }), el('th', { class: 'r', text: 'Приёмка' }), el('th', { class: 'r', text: 'УПД' }))),
      el('tbody', {}, rows.map((r) => el('tr', {},
        el('td', {}, el('div', { class: 'clamp-2', style: { maxWidth: '280px' }, text: r.p.name })),
        el('td', { class: 'r', text: `${r.l.packs} × ${rub(r.l.price, { kopecks: true })}` }),
        el('td', { class: 'r' }, el('span', { class: 'row', style: { justifyContent: 'flex-end', gap: '6px' } }, `${r.got} уп.`, mark(r.qtyOk))),
        el('td', { class: 'r' }, el('span', { class: 'row', style: { justifyContent: 'flex-end', gap: '6px' } }, rub(r.l.invoicePrice ?? r.l.price, { kopecks: true }), mark(r.priceOk))),
      ))),
    )),
  });
}

function timelineView(o) {
  const s = state.supply.suppliers.get(o.supplierId);
  const created = o.createdAt ?? stableTime(o.id, o.createdDay, 8, 12);
  const items = [{ title: 'Заказ создан', time: `${dayHuman(o.createdDay, state.today)}, ${clockTime(created)}`, state: 'done', icon: 'orders' }];
  if (o.needsApproval || o.status === 'approval' || o.decision) {
    if (o.status === 'approval') items.push({ title: 'Ждёт согласования владельца', time: 'сумма выше лимита на заказ', state: 'now', icon: 'clock' });
    else if (o.decision) items.push({ title: o.decision.status === 'approved' ? 'Согласован' : 'Отклонён', time: `${relTime(o.decision.at)}, ${o.decision.by}`, state: o.decision.status === 'approved' ? 'done' : 'problem', icon: o.decision.status === 'approved' ? 'check' : 'x' });
  }
  if (['rejected', 'cancelled'].includes(o.status)) {
    if (o.status === 'cancelled') items.push({ title: 'Отменён', time: '', state: 'problem', icon: 'x' });
    return renderTimeline(items);
  }
  if (o.status === 'approval') return renderTimeline([...items, { title: 'Отправка поставщику', time: 'после согласования', state: 'todo', icon: 'arrow-right' }]);
  const sentAt = o.sentAt ?? created;
  items.push({ title: `Отправлен в «${s.name}»`, time: o.source === 'user' ? relTime(sentAt) : `${dayHuman(o.createdDay, state.today)}, ${clockTime(sentAt + 60000)}`, state: 'done', icon: 'arrow-right' });
  const confirmed = o.status !== 'sent';
  items.push({ title: 'Подтверждён поставщиком', time: confirmed ? (o.source === 'user' ? relTime(sentAt + CONFIRM_AFTER_MS) : `${dayHuman(o.createdDay, state.today)}, ${clockTime(sentAt + 40 * 60000)}`) : 'обычно в течение часа', state: confirmed ? 'done' : 'now', icon: 'check' });
  const delivered = o.status === 'delivered' || o.status === 'received';
  const day = o.deliveredDay ?? o.expectedDay;
  if (o.status === 'confirmed') items.push({ title: 'Доставка', time: `ожидаем ${dayHuman(o.expectedDay, state.today)}`, state: 'todo', icon: 'truck' });
  else if (o.status === 'in_transit') items.push({ title: 'В пути', time: `ожидаем ${dayHuman(o.expectedDay, state.today)}`, state: 'now', icon: 'truck' });
  else if (o.status === 'arrived') items.push({ title: 'Машина на рампе', time: 'проверьте количество, температуру и сроки, погасите ВСД', state: 'now', icon: 'truck' });
  else if (delivered) {
    items.push({ title: o.late ? `Доставлен с опозданием на ${o.late} дн.` : 'Доставлен в срок', time: `${dayHuman(day, state.today)}, ${clockTime(stableTime(o.id, day, 8, 11))}`, state: o.late ? 'problem' : 'done', icon: 'truck' });
    const issues = o.issues.filter((i) => i.type !== 'price');
    items.push({ title: issues.length ? 'Принят с расхождениями' : 'Принят', time: `${o.docs.vsd ? 'ВСД погашены, ' : ''}УПД подписан`, state: issues.length ? 'problem' : 'done', icon: 'receipt-check' });
    if (o.payment.paidDay) items.push({ title: 'Оплачен', time: dayHuman(o.payment.paidDay, state.today), state: 'done', icon: 'wallet' });
    else items.push({ title: 'Оплата', time: `до ${dayFull(o.payment.dueDay)}`, state: o.payment.dueDay < state.today ? 'problem' : 'todo', icon: 'wallet' });
  }
  return renderTimeline(items);
}

function renderTimeline(items) {
  return el('div', { class: 'timeline' }, items.map((i) => el('div', { class: `tl-item ${i.state}` }, el('span', { class: 'tl-dot' }, icon(i.icon)), el('div', {}, el('div', { class: 'tl-title', text: i.title }), i.time ? el('div', { class: 'tl-time', text: i.time }) : null))));
}

// ---------- диалоги ----------

function rejectDialog(o) {
  const text = el('textarea', { class: 'textarea', placeholder: 'Почему отклоняем: дорого, есть остаток, другой поставщик…', 'aria-label': 'Комментарий' });
  const { close } = openModal({
    title: `Отклонить заказ № ${o.number}?`,
    sub: 'Закупщик увидит комментарий и сможет пересобрать заказ',
    body: text,
    foot: [button('Отмена', { variant: 'ghost', onClick: () => close() }), button('Отклонить', { variant: 'danger', onClick: () => { decide(o.id, 'rejected', text.value); close(); toast('Заказ отклонён'); } })],
  });
}

function receiveDialog(o) {
  const state2 = o.lines.map((l) => ({ productId: l.productId, receivedPacks: l.receivedPacks ?? l.packs, rejectedPacks: l.rejectedPacks ?? 0, invoicePrice: l.invoicePrice ?? l.price }));
  const vet = o.lines.some((l) => KINDS[l.kind].vet);
  const marked = o.lines.some((l) => KINDS[l.kind].marked);
  const numInput = (value, onChange, label, step = '1') => {
    const input = el('input', { class: 'input input-num', type: 'number', min: '0', step, value: String(value), 'aria-label': label, style: { width: '96px' } });
    input.addEventListener('change', () => onChange(Math.max(0, Number(input.value) || 0)));
    return input;
  };
  const rows = o.lines.map((l, i) => {
    const p = state.supply.products.get(l.productId);
    return el('div', { class: 'stack', style: { gap: '8px', padding: '10px 0', borderBottom: '1px solid var(--line)' } },
      el('div', { class: 'between' }, el('span', { class: 'cell-title truncate', text: p.name }), el('span', { class: 'faint', text: `заказано ${l.packs} уп.` })),
      el('div', { class: 'row-wrap', style: { gap: '12px' } },
        el('label', { class: 'field' }, el('span', { class: 'field-hint', text: 'Привезли, уп.' }), numInput(state2[i].receivedPacks, (v) => { state2[i].receivedPacks = Math.min(v, l.packs * 2); }, 'Привезли')),
        el('label', { class: 'field' }, el('span', { class: 'field-hint', text: 'Брак, уп.' }), numInput(state2[i].rejectedPacks, (v) => { state2[i].rejectedPacks = v; }, 'Брак')),
        el('label', { class: 'field' }, el('span', { class: 'field-hint', text: 'Цена в УПД, ₽' }), numInput(state2[i].invoicePrice, (v) => { state2[i].invoicePrice = v || l.price; }, 'Цена в УПД', '0.01')),
      ),
    );
  });
  const comment = el('textarea', { class: 'textarea', placeholder: 'Температура при приёмке, состояние упаковки, кто принимал', 'aria-label': 'Комментарий к приёмке' });
  const { close } = openModal({
    title: `Приёмка заказа № ${o.number}`,
    sub: `${state.supply.suppliers.get(o.supplierId).name} · ${locationName(o.locId)}`,
    wide: true,
    body: [
      note(`Сверьте количество и цену с УПД${vet ? ', проверьте температуру и сроки годности' : ''}. Расхождения попадут в сверку и претензию.`, { iconName: 'info' }),
      el('div', {}, rows),
      vet ? note('При подтверждении ВСД в Меркурии будут погашены автоматически (в песочнице - имитация гашения).', { iconName: 'shield' }) : null,
      marked ? note('Коды маркировки Честного знака примутся вместе с УПД.', { iconName: 'scan' }) : null,
      comment,
    ],
    foot: [button('Отмена', { variant: 'ghost', onClick: () => close() }), button('Принять и подписать УПД', { variant: 'primary', iconName: 'check', onClick: () => {
      for (const r of state2) if (r.rejectedPacks > r.receivedPacks) r.rejectedPacks = r.receivedPacks;
      receive(o.id, state2.map((r) => ({ ...r, invoicePrice: Math.round(r.invoicePrice * 100) / 100 })), comment.value);
      close();
      toast('Поставка принята, остатки обновлены');
    } })],
  });
}

function claimDialog(o) {
  const s = state.supply.suppliers.get(o.supplierId);
  const lines = [];
  let sum = 0;
  for (const l of o.lines) {
    const p = state.supply.products.get(l.productId);
    const got = (l.receivedPacks ?? l.packs) - (l.rejectedPacks ?? 0);
    if (got < l.packs) {
      const amount = (l.packs - got) * l.price;
      sum += amount;
      lines.push(`- ${p.name}: заказано ${l.packs} уп., принято ${got} уп.${l.rejectedPacks ? ` (брак ${l.rejectedPacks} уп.)` : ''}, на сумму ${rub(amount)}`);
    }
    if (l.invoicePrice > l.price + 0.005) {
      const amount = (l.invoicePrice - l.price) * got;
      sum += amount;
      lines.push(`- ${p.name}: цена в УПД ${rub(l.invoicePrice, { kopecks: true })} вместо ${rub(l.price, { kopecks: true })} по заказу, разница ${rub(amount)}`);
    }
  }
  const text = `Претензия по заказу № ${o.number} от ${dayFull(o.createdDay)}\n\n${s.name}, добрый день.\n\nПри приёмке поставки ${dayFull(o.deliveredDay ?? state.today)} на точку «${locationName(o.locId)}» обнаружены расхождения:\n${lines.join('\n')}\n\nПросим выставить корректировочный УПД на ${rub(sum)} или довезти недостающее до ${dayFull(addDays(state.today, 3))}.\n\n${state.ws.team[1]?.name ?? state.ws.team[0].name}, ${state.ws.name}`;
  const area = el('textarea', { class: 'textarea', style: { minHeight: '260px', fontFamily: 'var(--mono)', fontSize: '12.5px' }, 'aria-label': 'Текст претензии' });
  area.value = text;
  openModal({
    title: 'Претензия поставщику',
    sub: `Сумма к корректировке ${rub(sum)}`,
    wide: true,
    body: [area, sandboxNote('В рабочей версии претензия уходит через ЭДО вместе с актом расхождений (ТОРГ-2). В песочнице текст можно скопировать.')],
    foot: [button('Скопировать', { variant: 'primary', iconName: 'copy', onClick: async () => { try { await navigator.clipboard.writeText(area.value); toast('Текст претензии скопирован'); } catch { area.select(); toast('Выделили текст: скопируйте вручную', { error: true }); } } })],
  });
}

