// свой тонкий скроллбар для горизонтальных областей: таблицы, календарь закупок, широкие графики на телефоне.
// родной прячем: на Windows он толстый и серый, а на маке и телефоне не виден вовсе, и непонятно, что можно листать
import { el } from '../core/dom.js';
import { hideTip } from './charts.js';

const SELECTOR = '.table-wrap, .heatmap, .chart-scroll';

export function attachScrollbar(view) {
  if (view.dataset.hs) return;
  view.dataset.hs = '1';
  const thumb = el('span', { class: 'hs-thumb' });
  const bar = el('div', { class: 'hs-bar', 'aria-hidden': 'true' }, thumb);
  // обёртка встаёт на место области, чтобы полоска не стала отдельной ячейкой сетки с её отступами
  const wrap = el('div', { class: 'hs' });
  // при переносе в обёртку браузер сбрасывает прокрутку, а календарь уже был прокручен к свежим неделям
  const left = view.scrollLeft;
  view.replaceWith(wrap);
  wrap.append(view, bar);
  view.scrollLeft = left;
  view.classList.add('hs-view');

  let thumbW = 0;
  const update = () => {
    const { scrollWidth: sw, clientWidth: cw, scrollLeft: sl } = view;
    const over = sw - cw > 1;
    wrap.classList.toggle('hs-on', over);
    view.classList.toggle('fade-l', over && sl > 2);
    view.classList.toggle('fade-r', over && sl < sw - cw - 2);
    if (over) {
      view.setAttribute('tabindex', '0');
      view.setAttribute('role', 'region');
      if (!view.hasAttribute('aria-label')) view.setAttribute('aria-label', view.classList.contains('table-wrap') ? 'Таблица с горизонтальной прокруткой' : 'График с горизонтальной прокруткой');
    } else view.removeAttribute('tabindex');
    if (!over) return;
    const track = bar.clientWidth;
    thumbW = Math.max(28, (cw / sw) * track);
    thumb.style.width = `${thumbW}px`;
    thumb.style.transform = `translateX(${(sl / (sw - cw)) * (track - thumbW)}px)`;
  };

  view.addEventListener('keydown', (event) => {
    if (event.target !== view) return;
    const shifts = { ArrowLeft: -48, ArrowRight: 48, Home: -view.scrollWidth, End: view.scrollWidth };
    if (!(event.key in shifts) || view.scrollWidth <= view.clientWidth) return;
    event.preventDefault();
    view.scrollLeft += shifts[event.key];
  });

  let idle = null;
  view.addEventListener('scroll', () => {
    update();
    hideTip();
    wrap.classList.add('hs-active');
    clearTimeout(idle);
    idle = setTimeout(() => wrap.classList.remove('hs-active'), 800);
  }, { passive: true });

  // таблица пересобирается при сортировке, график - при смене ширины: следим и за размером, и за содержимым
  const resize = new ResizeObserver(update);
  resize.observe(view);
  const mutation = new MutationObserver(() => requestAnimationFrame(update));
  mutation.observe(view, { childList: true });
  requestAnimationFrame(update);

  thumb.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    wrap.classList.add('hs-drag');
    const startX = event.clientX;
    const startLeft = view.scrollLeft;
    const ratio = (view.scrollWidth - view.clientWidth) / Math.max(1, bar.clientWidth - thumbW);
    const move = (e) => {
      view.scrollLeft = startLeft + (e.clientX - startX) * ratio;
    };
    const up = () => {
      wrap.classList.remove('hs-drag');
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', up);
      thumb.removeEventListener('pointercancel', up);
    };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', up);
    thumb.addEventListener('pointercancel', up);
  });

  // клик по дорожке листает на экран в ту сторону
  bar.addEventListener('pointerdown', (event) => {
    if (event.target === thumb) return;
    const thumbBox = thumb.getBoundingClientRect();
    const dir = event.clientX < thumbBox.left ? -1 : 1;
    view.scrollBy({ left: dir * view.clientWidth * 0.8, behavior: 'smooth' });
  });
  return () => { resize.disconnect(); mutation.disconnect(); clearTimeout(idle); };
}

function scan(node, cleanups) {
  if (!(node instanceof Element) || !node.isConnected) return;
  const attach = (view) => {
    if (!view.dataset.hs) cleanups.set(view, attachScrollbar(view));
  };
  if (node.matches(SELECTOR)) attach(node);
  node.querySelectorAll(SELECTOR).forEach(attach);
}

// новые области появляются при каждой перерисовке и в окнах: ловим их наблюдателем, а не правим каждого автора
export function watchScrollbars(root) {
  const cleanups = new Map();
  scan(root, cleanups);
  let pending = [];
  let queued = false;
  const observer = new MutationObserver((records) => {
    for (const record of records) pending.push(...record.addedNodes);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const list = pending;
      pending = [];
      for (const [view, cleanup] of cleanups) {
        if (!view.isConnected) { cleanup?.(); cleanups.delete(view); }
      }
      list.forEach((node) => scan(node, cleanups));
    });
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => { observer.disconnect(); cleanups.forEach((cleanup) => cleanup?.()); cleanups.clear(); };
}
