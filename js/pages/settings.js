// «Настройки»: организация, бюджет и согласования, команда, интеграции, уведомления, данные песочницы
import { el, icon, safeUrl } from '../core/dom.js';
import { rub, num, countOf, dayFull, pct } from '../core/format.js';
import { state, setSetting, setting, approvalLimit, monthlyBudget, orders, updateProfile, persist } from '../app/state.js';
import { clearSandbox } from '../core/store.js';
import { badge, button, card, kv, toast, input, field, confirmDialog, sandboxNote, openModal, select } from '../ui/components.js';
import { pageHead } from './common.js';
import { link } from '../app/router.js';
import { ALERT_TYPES } from '../app/derive.js';

export const title = () => 'Настройки';

const SECTIONS = [
  { group: 'Организация' },
  { id: 'general', label: 'Организация и точки', icon: 'building' },
  { id: 'team', label: 'Команда и роли', icon: 'users' },
  { group: 'Закупки' },
  { id: 'budgets', label: 'Бюджет и лимиты', icon: 'wallet' },
  { id: 'approvals', label: 'Правила согласования', icon: 'shield' },
  { id: 'notifications', label: 'Уведомления', icon: 'bell' },
  { group: 'Интеграции и данные' },
  { id: 'integrations', label: 'Интеграции', icon: 'layers' },
  { id: 'data', label: 'Данные и песочница', icon: 'sandbox' },
];

export function render(route) {
  const section = SECTIONS.some((s) => s.id === route.id) ? route.id : 'general';
  const nav = el('nav', { class: 'subnav', 'aria-label': 'Разделы настроек' }, SECTIONS.map((s) => (s.group ? el('div', { class: 'subnav-group', text: s.group }) : el('a', { href: link('settings', s.id), 'aria-current': String(s.id === section) }, icon(s.icon), s.label))));
  const body = { general, team, budgets, approvals, notifications, integrations, data }[section]();
  return el('div', {}, pageHead('Настройки', 'Всё про организацию, бюджеты, согласования и подключения.'), el('div', { class: 'layout-side' }, nav, el('div', { class: 'stack-l' }, body)));
}

function editForm(title, fields, save) {
  const error = el('p', { class: 'field-error', 'aria-live': 'polite' });
  const form = el('form', { class: 'stack' }, fields.map(([label, control]) => field(label, control)), error);
  const { close } = openModal({ title, body: form, foot: [button('Отмена', { variant: 'ghost', onClick: () => close() }), button('Сохранить', { variant: 'primary', onClick: () => form.requestSubmit() })] });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try { save(); close(); toast('Изменения сохранены'); }
    catch (e) { error.textContent = e.message; }
  });
}

function textControl(value, max = 100, extra = {}) {
  return input({ value: value ?? '', required: true, maxlength: String(max), ...extra });
}

function editOrganization() {
  const ws = state.ws;
  const name = textControl(ws.name);
  const short = textControl(ws.short, 40);
  const type = textControl(ws.type);
  const target = input({ type: 'number', value: String(Math.round(ws.targetFoodCost * 100)), required: true, min: '5', max: '95', step: '1' });
  editForm('Редактировать организацию', [['Название', name], ['Короткое название', short], ['Тип организации', type], ['Целевой фудкост, %', target]], () => {
    if (![name, short, type].every((c) => c.value.trim())) throw new Error('Заполните название и тип организации');
    updateProfile({ name: name.value, short: short.value, type: type.value, targetFoodCost: Number(target.value) / 100 });
  });
}

function editLocation(loc) {
  const name = textControl(loc.name);
  const address = textControl(loc.address, 200, { required: null, placeholder: 'Улица, дом, вход' });
  const start = input({ type: 'time', value: loc.receivingStart ?? '08:00', required: true });
  const end = input({ type: 'time', value: loc.receivingEnd ?? '12:00', required: true });
  editForm(`Точка · ${loc.city}`, [['Название точки', name], ['Адрес доставки', address], ['Начало приёмки', start], ['Конец приёмки', end]], () => {
    if (!name.value.trim()) throw new Error('Введите название точки');
    if (start.value >= end.value) throw new Error('Конец приёмки должен быть позже начала');
    updateProfile({ locations: { [loc.id]: { name: name.value, address: address.value, receivingStart: start.value, receivingEnd: end.value } } });
  });
}

function general() {
  const ws = state.ws;
  return [
    card({ title: 'Организация', actions: button('Редактировать', { iconName: 'edit', onClick: editOrganization }), body: kv([['Название', ws.name], ['Тип', ws.type], ['Точек', num(ws.locations.length)], ['Целевой фудкост', pct(ws.targetFoodCost, { digits: 0 })], ['В Закроме с', dayFull(state.sim.start)]]) }),
    card({
      title: 'Точки',
      sub: 'Адреса доставки и время приёмки',
      flush: true,
      body: el('div', { class: 'list' }, ws.locations.map((l) => el('div', { class: 'list-item settings-item' }, el('span', { class: 'tl-dot' }, icon('pin')), el('div', { class: 'settings-item-text' }, el('div', { class: 'cell-title', text: l.name }), el('div', { class: 'cell-sub', text: [l.city, l.address].filter(Boolean).join(' · ') }), el('div', { class: 'cell-sub', text: `Приёмка ${l.receivingStart ?? '08:00'}–${l.receivingEnd ?? '12:00'}` })), button('Изменить', { size: 'sm', ariaLabel: `Изменить точку ${l.name}`, onClick: () => editLocation(l) })))),
    }),
  ];
}

const ROLE_RIGHTS = {
  Владелец: 'согласует заказы выше лимита, видит всё',
  Директор: 'согласует заказы выше лимита, видит всё',
  Закупщик: 'создаёт заказы и тендеры, принимает поставки',
  'Начальник снабжения': 'создаёт заказы и тендеры, принимает поставки',
};

function editMember(index = null) {
  const member = index === null ? { name: '', email: '', role: 'Закупщик' } : state.ws.team[index];
  const name = textControl(member.name);
  const email = textControl(member.email, 120, { type: 'email' });
  const roles = [...new Set([...Object.keys(ROLE_RIGHTS), 'Управляющий', 'Шеф-повар', ...state.ws.team.map((m) => m.role)])];
  const role = select(roles.map((r) => ({ value: r, label: r })), member.role, () => {});
  editForm(index === null ? 'Добавить участника' : 'Редактировать участника', [['Имя', name], ['Почта', email], ['Роль', role]], () => {
    const team = state.ws.team.map((m) => ({ ...m }));
    const next = { name: name.value.trim(), email: email.value.trim(), role: role.value };
    if (index === null) team.push(next);
    else team[index] = next;
    updateProfile({ team });
  });
}

function team() {
  return [
    card({
      title: `Команда · ${state.ws.team.length}`,
      actions: button('Добавить', { iconName: 'plus', disabled: state.ws.team.length >= 30, onClick: () => editMember() }),
      flush: true,
      body: el('div', { class: 'list' }, state.ws.team.map((m, i) => el('div', { class: 'list-item settings-item' }, el('span', { class: 'avatar', style: { background: ['#6d5bd0', '#2a78d6', '#199e70', '#c98500'][i % 4] }, text: m.name[0] }), el('div', { class: 'settings-item-text' }, el('div', { class: 'cell-title', text: m.name }), el('div', { class: 'cell-sub', text: m.email }), el('div', { class: 'cell-sub', text: `${m.role} · ${ROLE_RIGHTS[m.role] ?? 'принимает поставки своей точки'}` })), el('div', { class: 'row' }, button('Изменить', { size: 'sm', ariaLabel: `Изменить участника ${m.name}`, onClick: () => editMember(i) }), button('', { size: 'sm', iconName: 'trash', ariaLabel: `Удалить участника ${m.name}`, onClick: async () => {
        if (!(await confirmDialog({ title: 'Удалить участника?', text: `${m.name} будет удалён из команды этой организации.`, confirm: 'Удалить', danger: true }))) return;
        try { updateProfile({ team: state.ws.team.filter((_, index) => index !== i) }); toast('Участник удалён'); }
        catch (error) { toast(error.message, { error: true }); }
      } }))))),
    }),
    sandboxNote('Песочница создана, чтобы показать навыки разработки. Команда и её почтовые адреса вымышленные; изменения сохраняются в этом браузере.'),
  ];
}

function budgets() {
  const budget = input({ type: 'number', value: String(monthlyBudget()), required: true, min: '1000', max: '1000000000', step: '1', 'aria-label': 'Бюджет закупок на месяц, ₽' });
  const limit = input({ type: 'number', value: String(approvalLimit()), required: true, min: '1000', max: '1000000000', step: '1', 'aria-label': 'Лимит заказа без согласования, ₽' });
  const form = el('form', { class: 'stack' }, el('div', { class: 'grid-2' }, field('Бюджет закупок на месяц, ₽', budget), field('Лимит заказа без согласования, ₽', limit)), el('div', {}, button('Сохранить', { variant: 'primary', type: 'submit' })));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.user.settings.monthlyBudget = Number(budget.value);
    state.user.settings.approvalLimit = Number(limit.value);
    persist('settings');
    toast('Бюджет и лимит сохранены');
  });
  return [
    card({ title: 'Бюджет и лимиты', body: form }),
    card({ title: 'Как считается прогноз', body: el('p', { class: 'muted', text: 'Расходы с начала месяца делим на прошедшие дни и умножаем на число дней в месяце. Если прогноз выше бюджета больше чем на 2%, в уведомлениях появится предупреждение.' }) }),
  ];
}

function toggle(label, hint, key, fallback) {
  const box = el('input', { type: 'checkbox', checked: setting(key, fallback) ? true : null, 'aria-label': label });
  box.addEventListener('change', () => { setSetting(key, box.checked); toast(box.checked ? 'Правило включено' : 'Правило выключено'); });
  return el('label', { class: 'list-item', style: { cursor: 'pointer', alignItems: 'flex-start' } }, box, el('div', {}, el('div', { class: 'cell-title', text: label }), el('div', { class: 'cell-sub', text: hint })));
}

function approvals() {
  const pending = orders().filter((o) => o.status === 'approval').length;
  return [
    card({
      title: 'Правила согласования',
      sub: pending ? `${countOf(pending, ['заказ ждёт', 'заказа ждут', 'заказов ждут'])} решения` : 'Сейчас ничего не ждёт',
      flush: true,
      body: el('div', { class: 'list' },
        el('div', { class: 'list-item', style: { alignItems: 'flex-start' } }, el('span', { class: 'tl-dot' }, icon('check')), el('div', {}, el('div', { class: 'cell-title', text: `Заказ дороже ${rub(approvalLimit())} - согласует владелец` }), el('div', { class: 'cell-sub', text: 'Лимит меняется в разделе «Бюджет и лимиты»' }))),
        toggle('Новый поставщик - только после согласования', 'Первый заказ у компании, с которой ещё не работали, уходит владельцу независимо от суммы', 'approveNewSuppliers', true),
      ),
    }),
  ];
}

function notifications() {
  const muted = new Set(setting('mutedAlerts', []));
  return [
    card({
      title: 'Что показывать в уведомлениях',
      sub: 'Колокольчик в шапке и блок «Требует внимания» на обзоре',
      flush: true,
      body: el('div', { class: 'list' }, Object.entries(ALERT_TYPES).map(([key, info]) => {
        const box = el('input', { type: 'checkbox', checked: muted.has(key) ? null : true, 'aria-label': info.label });
        box.addEventListener('change', () => {
          const next = new Set(setting('mutedAlerts', []));
          if (box.checked) next.delete(key);
          else next.add(key);
          setSetting('mutedAlerts', [...next]);
        });
        return el('label', { class: 'list-item', style: { cursor: 'pointer', alignItems: 'flex-start' } }, box, el('div', {}, el('div', { class: 'cell-title', text: info.label }), el('div', { class: 'cell-sub', text: info.hint })));
      })),
    }),
  ];
}

const INTEGRATIONS = [
  { name: '1С:Управление торговлей', tag: '1С', color: '#ffd84d', text: 'Номенклатура, остатки и проведение приходов по принятым поставкам' },
  { name: 'iiko и r_keeper', tag: 'POS', color: '#9fe870', text: 'Продажи по блюдам и техкарты: из них считается расход сырья и фудкост' },
  { name: 'Диадок, СБИС, Такском', tag: 'ЭДО', color: '#7cc4ff', text: 'Входящие УПД, подписание при приёмке, акты расхождений ТОРГ-2' },
  { name: 'ФГИС Меркурий (ВетИС)', tag: 'ВСД', color: '#ffb08a', text: 'Гашение ветеринарных сопроводительных документов при приёмке молочки, мяса и рыбы' },
  { name: 'Честный знак', tag: 'ЧЗ', color: '#c9b8ff', text: 'Приёмка кодов маркировки воды, соков и молочной продукции вместе с УПД' },
  { name: 'Банк: выписки и платёжки', tag: '₽', color: '#e0e0e0', text: 'Оплата поставщикам по платёжному календарю и сверка оплат' },
];

function integrations() {
  return [
    el('div', { class: 'grid-2' }, INTEGRATIONS.map((i) => card({ body: el('div', { class: 'stack', style: { gap: '10px' } }, el('div', { class: 'row', style: { gap: '12px' } }, el('span', { class: 'logo-tile', style: { background: i.color }, text: i.tag }), el('div', { style: { flex: '1' } }, el('div', { class: 'cell-title', text: i.name })), badge('по запросу', 'outline')), el('p', { class: 'muted', text: i.text })) }))),
    sandboxNote('Песочница создана, чтобы показать навыки разработки, поэтому интеграции пока не подключаются: вместо них работают модель продаж и документы поставщиков песочницы. Если понадобится расширить функционал для реальной работы, готов дополнить.'),
  ];
}

function data() {
  const sources = state.catalog.sources;
  const m = state.marketRaw;
  const user = state.user;
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ workspace: state.wsId, exportedAt: new Date().toISOString(), data: user }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `zakrom-${state.wsId}-${state.today}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return [
    card({
      title: 'Источники данных',
      sub: 'Что в Закроме настоящее',
      flush: true,
      body: el('div', { class: 'list' },
        sources.map((s) => el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, el('a', { class: 'cell-title card-link', href: safeUrl(s.url) ?? '#', target: '_blank', rel: 'noopener noreferrer', text: s.title }), el('div', { class: 'cell-sub', text: `${num(s.count)} записей · снимок ${dayFull(String(s.fetchedAt).slice(0, 10))}` })), safeUrl(s.licenseUrl) ? el('a', { href: safeUrl(s.licenseUrl), target: '_blank', rel: 'noopener noreferrer' }, badge(s.license, 'outline')) : badge(s.license ?? '', 'outline'))),
        m?.fx ? el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, el('a', { class: 'cell-title card-link', href: safeUrl(m.fx.url) ?? '#', target: '_blank', rel: 'noopener noreferrer', text: m.fx.source }), el('div', { class: 'cell-sub', text: `курсы USD, EUR, CNY · загружены ${dayFull(String(m.fx.fetchedAt).slice(0, 10))}` })), badge('открытые данные', 'outline')) : null,
        m?.commodities ? el('div', { class: 'list-item' }, el('div', { style: { flex: '1' } }, el('a', { class: 'cell-title card-link', href: safeUrl(m.commodities.url) ?? '#', target: '_blank', rel: 'noopener noreferrer', text: m.commodities.source }), el('div', { class: 'cell-sub', text: `${num(Object.keys(m.commodities.series).length)} рядов цен сырья по месяцам` })), badge(m.commodities.license, 'outline')) : null,
      ),
    }),
    card({
      title: 'Ваши данные в этом браузере',
      sub: 'Заказы, решения, приёмки, корзина, тендеры, заметки и настройки',
      body: el('div', { class: 'stack' },
        kv([['Своих заказов', num(user.orders.length)], ['Решений по согласованию', num(Object.keys(user.decisions).length)], ['Приёмок', num(Object.keys(user.receipts).length)], ['Тендеров', num(user.rfqs.length)], ['В корзине', num(user.cart.length)]]),
        el('div', { class: 'row-wrap' },
          button('Скачать JSON', { iconName: 'download', onClick: exportJson }),
          button('Сбросить песочницу', { variant: 'danger', iconName: 'trash', onClick: async () => {
            const ok = await confirmDialog({ title: 'Сбросить песочницу?', text: 'Удалятся ваши заказы, решения, приёмки, тендеры, заметки и настройки организации, точек и команды во всех организациях. История песочницы останется прежней.', confirm: 'Сбросить', danger: true });
            if (!ok) return;
            clearSandbox();
            location.reload();
          } }),
        ),
      ),
    }),
  ];
}
