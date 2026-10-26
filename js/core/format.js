// форматирование денег, чисел и дат по-русски; без DOM, поэтому работает и в тестах node
const NBSP = '\u00a0';
const int = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_AXIS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const finite = (value) => (Number.isFinite(value) ? value : 0);

export function num(value, digits = 0) {
  const v = finite(value);
  if (digits === 1) return dec1.format(v);
  if (digits === 2) return dec2.format(v);
  return int.format(Math.round(v));
}

export function rub(value, { kopecks = false } = {}) {
  const v = finite(value);
  if (kopecks) return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}${NBSP}₽`;
  return `${int.format(Math.round(v))}${NBSP}₽`;
}

// 1 240 000 -> «1,24 млн ₽»; для плиток и осей, где точность до рубля только мешает
export function rubShort(value) {
  const v = finite(value);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${trim(v / 1e9)}${NBSP}млрд${NBSP}₽`;
  if (abs >= 1e6) return `${trim(v / 1e6)}${NBSP}млн${NBSP}₽`;
  if (abs >= 1e4) return `${int.format(Math.round(v / 1e3))}${NBSP}тыс.${NBSP}₽`;
  return rub(v);
}

// подписи оси: без «₽», коротко
export function axisShort(value) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${trim(value / 1e6)}${NBSP}млн`;
  if (abs >= 1e3) return `${trim(value / 1e3)}${NBSP}тыс`;
  return int.format(value);
}

function trim(value) {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}

export function pct(value, { digits = 1, sign = false } = {}) {
  const v = finite(value) * 100;
  const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Math.abs(v));
  const prefix = sign ? (v > 0.05 ? '+' : v < -0.05 ? '−' : '') : v < 0 ? '−' : '';
  return `${prefix}${text}${NBSP}%`;
}

export function plural(count, forms) {
  const n = Math.abs(Math.trunc(count));
  const last = n % 10;
  const lastTwo = n % 100;
  if (last === 1 && lastTwo !== 11) return forms[0];
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return forms[1];
  return forms[2];
}

export const countOf = (count, forms) => `${num(count)}${NBSP}${plural(count, forms)}`;

export function qty(value, unit) {
  const v = finite(value);
  const text = Number.isInteger(v) ? int.format(v) : dec2.format(v);
  return unit ? `${text}${NBSP}${unit}` : text;
}

// ---------- даты: дни храним строкой ГГГГ-ММ-ДД, так нет сюрпризов с часовыми поясами ----------

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

export function isoDay(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function localIsoDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? date : null;
}

export function addDays(day, delta) {
  const date = parseDay(day);
  return isoDay(new Date(date.getTime() + delta * DAY));
}

export function diffDays(a, b) {
  return Math.round((parseDay(a).getTime() - parseDay(b).getTime()) / DAY);
}

export function weekday(day) {
  return parseDay(day).getUTCDay();
}

export function dayShort(day) {
  const date = parseDay(day);
  return `${date.getUTCDate()}${NBSP}${MONTHS_SHORT[date.getUTCMonth()]}`;
}

export function dayAxis(day) {
  const date = parseDay(day);
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}`;
}

export function dayFull(day) {
  const date = parseDay(day);
  if (!date) return '—';
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

export function dayHuman(day, today) {
  const delta = diffDays(day, today);
  if (delta === 0) return 'сегодня';
  if (delta === 1) return 'завтра';
  if (delta === -1) return 'вчера';
  if (delta === 2) return 'послезавтра';
  return `${WEEKDAYS[weekday(day)]}, ${dayShort(day)}`;
}

export function monthLabel(key) {
  // key: ГГГГ-ММ
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_NOM[m - 1]} ${y}`;
}

export function monthAxis(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${MONTHS_AXIS[0]} ${String(y).slice(2)}` : MONTHS_AXIS[m - 1];
}

// «5 мин назад», «через 2 ч»: для живых заказов песочницы
export function relTime(ms, now = Date.now()) {
  const delta = ms - now;
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60000);
  let text;
  if (minutes < 1) text = 'меньше минуты';
  else if (minutes < 60) text = `${minutes}${NBSP}мин`;
  else if (minutes < 60 * 24) text = `${Math.round(minutes / 60)}${NBSP}ч`;
  else text = countOf(Math.round(minutes / 1440), ['день', 'дня', 'дней']);
  if (minutes < 1) return delta >= 0 ? 'через минуту' : 'только что';
  return delta >= 0 ? `через ${text}` : `${text} назад`;
}

export function clockTime(ms) {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function initials(name) {
  const words = String(name || '').replace(/[«»"()]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
