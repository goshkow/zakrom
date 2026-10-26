// общие панели кабинета: песочница, уведомления, корзина
import { el, icon } from '../core/dom.js';
import { rub, countOf, num } from '../core/format.js';
import { save } from '../core/store.js';
import { state, cartGroups, cartSet, cartClear, checkoutCart, markAlertsRead, locationName } from './state.js';
import { alerts } from './derive.js';
import { button, openDrawer, openModal, toast, qtyStepper, productThumb, confirmDialog } from '../ui/components.js';
import { go } from './router.js';


export function sandboxInfo() {
  const cat = state.catalog;
  const src = (id) => cat.sources.find((s) => s.id === id);
  openModal({
    title: 'Это песочница Закрома',
    sub: 'Компании и товары настоящие, а закупки в них - нет',
    body: [
      el('p', { text: 'Закром показывает, как сеть кафе или производство закупает сырьё, упаковку и готовую продукцию. Чтобы на кабинет можно было смотреть без договоров с поставщиками, он работает в режиме песочницы.' }),
      el('div', { class: 'stack' },
        infoRow('check', 'Настоящее', `${num(src('off')?.count ?? 0)} товаров со штрихкодами из Open Food Facts, ${num(cat.suppliers.length)} компаний из Wikidata и OpenStreetMap с сайтами и адресами, курсы Банка России, биржевые цены сырья Всемирного банка. Поиск по штрихкоду ходит в Open Food Facts по-настоящему.`),
        infoRow('sandbox', 'Смоделировано', 'Цены и условия поставщиков, история заказов, ответы на заказы и тендеры. Цены двигаются вслед за реальными биржевыми индексами, но это не прайс конкретной компании.'),
        infoRow('lock', 'Никуда не уходит', 'Заказы и тендеры не отправляются компаниям. Всё, что вы делаете, хранится только в этом браузере, и его можно сбросить в настройках.'),
      ),
    ],
    foot: [button('Понятно', { variant: 'primary', onClick: (e) => e.target.closest('dialog').close() })],
    onClose: () => save('welcome:v1', true),
  });
}

function infoRow(iconName, title, text) {
  return el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '12px' } }, el('span', { class: 'tl-dot' }, icon(iconName)), el('div', {}, el('div', { class: 'tl-title', text: title }), el('p', { class: 'muted', text })));
}

export function openNotifications() {
  const list = alerts();
  const { close } = openDrawer({
    title: 'Уведомления',
    sub: list.length ? `${countOf(list.length, ['событие', 'события', 'событий'])} требуют внимания` : 'Всё спокойно',
    body: list.length
      ? el('div', { class: 'card' }, el('div', { class: 'list' }, list.map((a) => el('a', { class: 'list-item', href: a.href, on: { click: () => close() } }, el('span', { class: `badge badge-${a.tone}` }, icon(a.icon)), el('div', { style: { flex: '1', minWidth: '0' } }, el('div', { class: 'cell-title', text: a.title }), el('div', { class: 'cell-sub', text: a.text })), a.read ? null : el('span', { class: 'swatch', style: { background: 'var(--accent)', borderRadius: '50%' }, title: 'Новое' })))))
      : el('div', { class: 'empty' }, icon('check'), el('div', { class: 'empty-title', text: 'Новых событий нет' })),
    foot: list.length ? [button('Отметить всё прочитанным', { variant: 'ghost', onClick: () => { markAlertsRead(list.map((a) => a.id)); close(); } })] : null,
  });
}

export function openCart() {
  let close;
  let submitting = false;
  const draw = () => {
    const groups = cartGroups();
    if (!groups.length) {
      return el('div', { class: 'empty' }, icon('cart'), el('div', { class: 'empty-title', text: 'Корзина пуста' }), el('p', { text: 'Добавляйте товары из каталога или со склада: корзина сама разложит их по поставщикам и точкам.' }), button('Открыть каталог', { onClick: () => { close(); go('#/catalog'); } }));
    }
    return el('div', { class: 'stack' }, groups.map((g) => {
      const s = state.supply.suppliers.get(g.supplierId);
      const below = g.total < s.terms.minOrder;
      const loc = state.ws.locations.find((l) => l.id === g.locId);
      return el('section', { class: 'card' },
        el('header', { class: 'card-head' }, el('div', {}, el('div', { class: 'card-title', text: s.name }), el('div', { class: 'card-sub', text: `${locationName(g.locId)}${loc?.address ? ` · ${loc.address}` : ''} · приёмка ${loc?.receivingStart ?? '08:00'}–${loc?.receivingEnd ?? '12:00'} · доставка ${s.terms.leadDays === 1 ? 'на следующий день' : `через ${s.terms.leadDays} дн.`}` })), el('b', { class: 'num', text: rub(g.total) })),
        el('div', { class: 'card-body' },
          el('div', { class: 'list' }, g.items.map((item) => {
            const p = state.supply.products.get(item.productId);
            return el('div', { class: 'row cart-line', style: { padding: '8px 0', gap: '12px' } }, productThumb(p), el('div', { style: { flex: '1', minWidth: '0' } }, el('div', { class: 'cell-title truncate', text: p.name }), el('div', { class: 'cell-sub', text: `${rub(item.price, { kopecks: true })} за упаковку` })), qtyStepper(item.packs, (v) => { cartSet(item.index, v); refresh(); }, { min: 0, step: 1, label: `Упаковок: ${p.name}` }));
          })),
          below ? el('p', { class: 'field-error', text: `Минимальный заказ у поставщика ${rub(s.terms.minOrder)}: добавьте ещё на ${rub(s.terms.minOrder - g.total)}` }) : null,
        ),
      );
    }));
  };
  const body = el('div', {}, draw());
  const total = el('div', { class: 'cart-total', 'aria-live': 'polite' });
  const clear = button('Очистить', { variant: 'ghost', onClick: () => { cartClear(); refresh(); } });
  const checkout = button('Оформить заказы', { variant: 'primary', iconName: 'arrow-right', onClick: () => submit() });
  const refresh = () => {
    body.replaceChildren(draw());
    const groups = cartGroups();
    const sum = groups.reduce((value, group) => value + group.total, 0);
    total.textContent = groups.length ? `Итого ${rub(sum)} · ${countOf(groups.length, ['заказ', 'заказа', 'заказов'])}` : '';
    checkout.disabled = submitting || !groups.length;
    clear.disabled = submitting || !groups.length;
  };
  const submit = async () => {
    if (submitting || !state.user.cart.length) return;
    const wsId = state.wsId;
    const signature = JSON.stringify(state.user.cart);
    submitting = true;
    refresh();
    try {
      const groups = cartGroups();
      const below = groups.filter((g) => g.total < state.supply.suppliers.get(g.supplierId).terms.minOrder);
      if (below.length && !(await confirmDialog({ title: 'Ниже минимального заказа', text: `${countOf(below.length, ['заказ не добирает', 'заказа не добирают', 'заказов не добирают'])} до минимума поставщика. Поставщик может взять доплату за доставку или перенести отгрузку. Оформить всё равно?`, confirm: 'Оформить' }))) return;
      if (state.wsId !== wsId || JSON.stringify(state.user.cart) !== signature) {
        toast('Корзина изменилась. Проверьте её и повторите оформление', { error: true });
        return;
      }
      const { created, failed } = checkoutCart();
      if (failed.length) {
        toast(`Оформлено заказов: ${created.length}. Неоформленные позиции остались в корзине`, { error: true });
        return;
      }
      close();
      const approvals = created.filter((o) => o.needsApproval).length;
      toast(approvals ? `Создано ${countOf(created.length, ['заказ', 'заказа', 'заказов'])}, ${approvals} ждут согласования` : `Отправлено ${countOf(created.length, ['заказ', 'заказа', 'заказов'])} поставщикам`);
      go('#/orders');
    } finally {
      submitting = false;
      refresh();
    }
  };
  ({ close } = openDrawer({
    title: 'Корзина',
    sub: 'Один поставщик и одна точка - один заказ',
    body,
    foot: [total, clear, checkout],
  }));
  refresh();
}
