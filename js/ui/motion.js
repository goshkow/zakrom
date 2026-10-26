// движение в интерфейсе: новые графики проявляются, а тихие перерисовки (галочка, корзина, ответ тендера) - нет,
// иначе каждое действие заново выращивало бы все столбцы на странице
import { el } from '../core/dom.js';

let quiet = false;

export function quietly(fn) {
  const previous = quiet;
  quiet = true;
  try {
    return fn();
  } finally {
    quiet = previous;
  }
}

export const animate = () => !quiet;

// задержка i-го элемента из n: вся волна укладывается в total мс, сколько бы элементов ни было
export function stagger(i, n, total = 260) {
  return `${Math.round(Math.min(i * (total / Math.max(n, 1)), total))}ms`;
}

// ползунок под активной вкладкой. вкладки перерисовываются целиком, поэтому прошлое место помним по ключу
// и едем от него к новому
const inkSpots = new Map();

function spot(node) {
  return { x: node.offsetLeft, w: node.offsetWidth };
}

function place(bar, p) {
  bar.style.transform = `translateX(${p.x}px)`;
  bar.style.width = `${p.w}px`;
}

export function ink(container, key, cls = 'ink') {
  const bar = el('span', { class: cls, 'aria-hidden': 'true' });
  container.append(bar);
  const moveTo = (active, { slide = true } = {}) => {
    if (!active || !active.offsetWidth) {
      container.classList.remove('has-ink');
      return;
    }
    const to = spot(active);
    const from = inkSpots.get(key);
    inkSpots.set(key, to);
    if (slide && from && (from.x !== to.x || from.w !== to.w) && !container.classList.contains('has-ink')) {
      bar.style.transition = 'none';
      place(bar, from);
      bar.getBoundingClientRect();
      bar.style.transition = '';
    }
    place(bar, to);
    container.classList.add('has-ink');
  };
  return moveTo;
}

// после вставки в документ: размеры кнопок известны только тогда
export function inkAfterMount(container, key, find, cls) {
  const moveTo = ink(container, key, cls);
  requestAnimationFrame(() => moveTo(find()));
  return moveTo;
}
