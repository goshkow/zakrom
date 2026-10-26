// графики на SVG без библиотек. правила: тонкие столбцы до 24px со скруглённым верхом, 2px зазор между
// сегментами стека, линии 2px, заливка под линией ~10%, сетка-волосок, у каждой метки есть подсказка
import { el, svg } from '../core/dom.js';
import { axisShort, rub } from '../core/format.js';
import { animate, stagger } from './motion.js';

// ---------- подсказка: одна на страницу ----------

let tipNode = null;

function tip() {
  if (!tipNode) {
    tipNode = el('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(tipNode);
    // при прокрутке подсказка отрывается от метки: прячем
    window.addEventListener('scroll', () => hideTip({ now: true }), { passive: true });
    window.addEventListener('hashchange', () => hideTip({ now: true }));
  }
  return tipNode;
}

let hideTimer = null;

export function showTip(event, title, rows = [], total = null) {
  const node = tip();
  clearTimeout(hideTimer);
  // подсказка, которая уже видна, плавно переезжает к новой метке; появившаяся заново - сразу на месте
  const wasOn = node.classList.contains('on');
  // replaceChildren превращает null в текст «null», поэтому пустые части отфильтровываем
  node.replaceChildren(
    ...[
      title ? el('div', { class: 'tooltip-title', text: title }) : null,
      ...rows.map((row) =>
        el('div', { class: 'tooltip-row' }, row.color ? el('span', { class: 'swatch', style: { background: row.color } }) : null, el('span', { text: row.label }), el('span', { class: 'v', text: row.value })),
      ),
      total ? el('div', { class: 'tooltip-row tooltip-total' }, el('span', { text: total.label }), el('span', { class: 'v', text: total.value })) : null,
    ].filter(Boolean),
  );
  node.classList.toggle('jump', !wasOn);
  node.classList.add('on');
  placeTip(event);
  if (!wasOn) requestAnimationFrame(() => node.classList.remove('jump'));
}

export function placeTip(event) {
  const node = tip();
  const pad = 14;
  const rect = node.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
  node.style.left = `${Math.max(8, x)}px`;
  node.style.top = `${Math.max(8, y)}px`;
}

// прячем с паузой: при переходе мыши на соседний столбец подсказка не моргает, а едет
export function hideTip({ now = false } = {}) {
  if (!tipNode) return;
  clearTimeout(hideTimer);
  if (now === true) tipNode.classList.remove('on');
  else hideTimer = setTimeout(() => tipNode.classList.remove('on'), 80);
}

// подсветка под курсором (колонка, перекрестие, точки) едет за ним, а не прыгает
function glide(node, x, y = 0) {
  const shown = node.dataset.shown === '1';
  node.style.transition = shown ? '' : 'opacity 0.16s';
  node.style.transform = `translate(${x}px, ${y}px)`;
  node.style.opacity = '1';
  node.dataset.shown = '1';
}

function fadeOut(node) {
  node.style.transition = '';
  node.style.opacity = '0';
  node.dataset.shown = '';
}

function delayed(fn, ms = 80) {
  let timer = null;
  return { run() { clearTimeout(timer); timer = setTimeout(fn, ms); }, cancel() { clearTimeout(timer); } };
}

// ---------- общее ----------

export function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s * ticks >= max) ?? 10 * power;
  const top = Math.ceil(max / step) * step;
  const list = [];
  for (let v = 0; v <= top + step / 2; v += step) list.push(Math.round(v * 1e6) / 1e6);
  return { max: top, step, ticks: list };
}

function rangeScale(min, max, ticks = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s * ticks >= max - min) ?? 10 * power;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const list = [];
  for (let v = lo; v <= hi + step / 2; v += step) list.push(Math.round(v * 1e6) / 1e6);
  return { min: lo, max: hi, ticks: list };
}

// перерисовка по ширине контейнера: текст в SVG остаётся в настоящих пикселях
function responsive(root, draw) {
  let last = 0;
  const run = () => {
    if (!root.isConnected) { observer.disconnect(); return; }
    const width = Math.round(root.clientWidth);
    if (!width || width === last) return;
    last = width;
    draw(width);
  };
  const observer = new ResizeObserver(run);
  observer.observe(root);
  requestAnimationFrame(run);
  return () => {
    last = 0;
    run();
  };
}

function textWidth(text) {
  return String(text).length * 6.4 + 4;
}

// столбец со скруглённым верхом 4px и прямым низом
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function pickLabelStep(count, bandWidth, labelWidth) {
  const every = Math.max(1, Math.ceil(labelWidth / Math.max(bandWidth, 1)));
  return every;
}

// ---------- столбцы со стеком ----------

/**
 * labels: ключи столбцов; series: [{key,label,color}]; rows: [{[key]: число}] той же длины, что labels
 * xLabel(label) - подпись оси, title(label) - заголовок подсказки
 */
// minBand - самая узкая колонка: если на телефоне не влезает, график листается вбок, свежие дни справа
export function stackedBars({ labels, series, rows, height = 260, xLabel = String, title = String, format = rub, yFormat = axisShort, onSelect = null, highlight = null, minBand = 9 }) {
  const root = el('div', { class: 'chart chart-scroll' });
  let entering = animate();
  const draw = (fit) => {
    const totals = rows.map((row) => series.reduce((sum, s) => sum + (row[s.key] || 0), 0));
    const scale = niceScale(Math.max(...totals, 0));
    const left = Math.max(...scale.ticks.map((t) => textWidth(yFormat(t)))) + 8;
    const width = Math.max(fit, Math.ceil(left + 4 + labels.length * minBand));
    const top = 8;
    const bottom = 26;
    const plotW = Math.max(10, width - left - 4);
    const plotH = height - top - bottom;
    const band = plotW / Math.max(labels.length, 1);
    const barW = Math.max(2, Math.min(24, band * 0.62));
    const y = (v) => top + plotH - (v / scale.max) * plotH;
    const chart = svg('svg', { class: entering ? 'anim' : null, width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Столбчатая диаграмма' });
    for (const t of scale.ticks) {
      const ty = Math.round(y(t)) + 0.5;
      chart.append(svg('line', { class: t === 0 ? 'baseline' : 'gridline', x1: left, x2: width, y1: ty, y2: ty }));
      chart.append(svg('text', { x: left - 8, y: ty + 3.5, 'text-anchor': 'end', text: yFormat(t) }));
    }
    const hoverCol = svg('rect', { class: 'hover-col', x: 0, y: top, width: band, height: plotH, style: { opacity: 0 } });
    chart.append(hoverCol);
    const step = pickLabelStep(labels.length, band, 44);
    const cols = [];
    let current = null;
    const leave = delayed(() => {
      fadeOut(hoverCol);
      root.classList.remove('dim');
      current?.classList.remove('on');
      current = null;
    });
    labels.forEach((label, i) => {
      const cx = left + band * i + band / 2;
      const bx = cx - barW / 2;
      // столбец растёт от оси одним куском, волна идёт слева направо
      const col = svg('g', { class: 'col', style: { '--d': stagger(i, labels.length, 320) } });
      cols.push(col);
      chart.append(col);
      let acc = 0;
      const visible = series.filter((s) => (rows[i][s.key] || 0) > 0);
      visible.forEach((s, index) => {
        const value = rows[i][s.key];
        const y0 = y(acc);
        acc += value;
        const y1 = y(acc);
        const isTop = index === visible.length - 1;
        // 2px зазор между сегментами: у каждого сегмента кроме нижнего срезаем по 2px снизу
        const gap = index === 0 ? 0 : 2;
        const h = Math.max(0, y0 - y1 - gap);
        if (h < 0.5) return;
        const mark = isTop
          ? svg('path', { class: 'mark', d: columnPath(bx, y1, barW, h), fill: s.color })
          : svg('rect', { class: 'mark', x: bx, y: y1, width: barW, height: h, fill: s.color });
        col.append(mark);
      });
      if (highlight && highlight(label) && totals[i] > 0) {
        chart.append(svg('circle', { cx, cy: y(totals[i]) - 8, r: 2.5, fill: 'var(--text-2)' }));
      }
      if (i % step === 0 || labels.length <= 8) {
        chart.append(svg('text', { x: cx, y: height - 8, 'text-anchor': 'middle', text: xLabel(label) }));
      }
      const hit = svg('rect', { class: 'hit', x: left + band * i, y: top, width: band, height: plotH + bottom });
      hit.addEventListener('mouseenter', (event) => {
        leave.cancel();
        glide(hoverCol, left + band * i);
        current?.classList.remove('on');
        current = cols[i];
        current.classList.add('on');
        root.classList.add('dim');
        const list = series
          .filter((s) => (rows[i][s.key] || 0) > 0)
          .slice()
          .reverse()
          .map((s) => ({ label: s.label, value: format(rows[i][s.key]), color: s.color }));
        showTip(event, title(label), list.length ? list : [{ label: 'Закупок не было', value: '' }], list.length > 1 ? { label: 'Всего', value: format(totals[i]) } : null);
      });
      hit.addEventListener('mousemove', placeTip);
      hit.addEventListener('mouseleave', () => {
        leave.run();
        hideTip();
      });
      if (onSelect) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', () => onSelect(label, i));
      }
      chart.append(hit);
    });
    root.replaceChildren(chart);
    if (entering && width > fit) root.scrollLeft = width;
    entering = false;
  };
  responsive(root, draw);
  return root;
}

// ---------- линии ----------

/**
 * labels: подписи точек по оси X; series: [{key,label,color, values:[число|null]}]
 * area - заливка под единственной линией; zero - шкала от нуля
 */
export function lineChart({ labels, series, height = 240, xLabel = String, title = String, format = rub, yFormat = axisShort, area = series.length === 1, zero = false, endLabels = series.length <= 4, refValue = null, refLabel = '' }) {
  const root = el('div', { class: 'chart chart-scroll' });
  let entering = animate();
  const draw = (fit) => {
    const all = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
    if (refValue !== null) all.push(refValue);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const scale = zero ? { min: 0, ...niceScale(hi) } : rangeScale(lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08);
    const min = scale.min ?? 0;
    const left = Math.max(...scale.ticks.map((t) => textWidth(yFormat(t)))) + 8;
    const endW = endLabels ? Math.max(...series.map((s) => textWidth(yFormat(lastValue(s.values))))) + 10 : 8;
    const width = Math.max(fit, Math.min(640, left + endW + Math.max(1, labels.length - 1) * 18));
    const top = 10;
    const bottom = 26;
    const plotW = Math.max(10, width - left - endW);
    const plotH = height - top - bottom;
    const n = labels.length;
    const x = (i) => left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => top + plotH - ((v - min) / (scale.max - min)) * plotH;
    const chart = svg('svg', { class: entering ? 'anim' : null, width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Линейный график' });
    entering = false;
    for (const t of scale.ticks) {
      const ty = Math.round(y(t)) + 0.5;
      chart.append(svg('line', { class: t === scale.ticks[0] ? 'baseline' : 'gridline', x1: left, x2: left + plotW, y1: ty, y2: ty }));
      chart.append(svg('text', { x: left - 8, y: ty + 3.5, 'text-anchor': 'end', text: yFormat(t) }));
    }
    if (refValue !== null) {
      const ry = y(refValue);
      chart.append(svg('line', { x1: left, x2: left + plotW, y1: ry, y2: ry, stroke: 'var(--text-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
      if (refLabel) chart.append(svg('text', { x: left + 4, y: ry - 5, text: refLabel }));
    }
    const step = pickLabelStep(n, plotW / Math.max(n, 1), 52);
    labels.forEach((label, i) => {
      if (i % step === 0) chart.append(svg('text', { x: x(i), y: height - 8, 'text-anchor': i === 0 ? 'start' : 'middle', text: xLabel(label) }));
    });
    for (const s of series) {
      const points = s.values.map((v, i) => (Number.isFinite(v) ? [x(i), y(v)] : null));
      const d = pathFrom(points);
      if (area) {
        const valid = points.filter(Boolean);
        if (valid.length > 1) {
          const base = y(Math.max(min, 0 > min ? 0 : min));
          const areaD = `${d}L${valid[valid.length - 1][0]},${base}L${valid[0][0]},${base}Z`;
          chart.append(svg('path', { class: 'area', d: areaD, fill: s.color, 'fill-opacity': 0.1 }));
        }
      }
      // pathLength=1: линия прорисовывается слева направо одной анимацией штриха, какой бы длины ни была
      chart.append(svg('path', { class: 'mark line', d, pathLength: 1, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const lastIndex = s.values.map((v) => Number.isFinite(v)).lastIndexOf(true);
      if (lastIndex >= 0) {
        chart.append(svg('circle', { class: 'end', cx: x(lastIndex), cy: y(s.values[lastIndex]), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
        if (endLabels) chart.append(svg('text', { class: 'end-label end', x: x(lastIndex) + 8, y: y(s.values[lastIndex]) + 4, text: yFormat(s.values[lastIndex]) }));
      }
    }
    const cross = svg('line', { class: 'crosshair glide', x1: 0, x2: 0, y1: top, y2: top + plotH, style: { opacity: 0 } });
    const dots = series.map((s) => svg('circle', { class: 'glide', r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, style: { opacity: 0 } }));
    chart.append(cross, ...dots);
    const overlay = svg('rect', { class: 'hit', x: left, y: top, width: plotW, height: plotH });
    let lastI = -1;
    overlay.addEventListener('mousemove', (event) => {
      const box = chart.getBoundingClientRect();
      const px = event.clientX - box.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - left) / plotW) * (n - 1))));
      if (i === lastI) {
        placeTip(event);
        return;
      }
      lastI = i;
      glide(cross, x(i));
      series.forEach((s, k) => {
        const v = s.values[i];
        if (Number.isFinite(v)) glide(dots[k], x(i), y(v));
        else fadeOut(dots[k]);
      });
      const rows = series.filter((s) => Number.isFinite(s.values[i])).map((s) => ({ label: s.label, value: format(s.values[i]), color: series.length > 1 ? s.color : null }));
      showTip(event, title(labels[i]), rows);
    });
    overlay.addEventListener('mouseleave', () => {
      lastI = -1;
      fadeOut(cross);
      dots.forEach(fadeOut);
      hideTip();
    });
    chart.append(overlay);
    root.replaceChildren(chart);
  };
  responsive(root, draw);
  return root;
}

function lastValue(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) if (Number.isFinite(values[i])) return values[i];
  return 0;
}

function pathFrom(points) {
  let d = '';
  let pen = false;
  for (const point of points) {
    if (!point) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

// ---------- спарклайн: без осей, для плиток ----------

export function sparkline(values, { color = 'var(--text-2)', width = 108, height = 40, area = true } = {}) {
  const clean = values.map((v) => (Number.isFinite(v) ? v : null));
  const nums = clean.filter((v) => v !== null);
  const node = svg('svg', { class: 'kpi-spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (nums.length < 2) return node;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const x = (i) => 2 + (i / (clean.length - 1)) * (width - 6);
  const y = (v) => 3 + (1 - (v - lo) / span) * (height - 8);
  const d = pathFrom(clean.map((v, i) => (v === null ? null : [x(i), y(v)])));
  if (area) node.append(svg('path', { class: 'area', d: `${d}L${x(clean.length - 1)},${height}L${x(0)},${height}Z`, fill: color, 'fill-opacity': 0.08 }));
  node.append(svg('path', { class: 'line', d, pathLength: 1, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  const li = clean.length - 1;
  if (clean[li] !== null) node.append(svg('circle', { class: 'end', cx: x(li), cy: y(clean[li]), r: 2.2, fill: color }));
  if (animate()) node.classList.add('anim');
  return node;
}

// ---------- кольцо ----------

export function donut(items, { size = 132, thickness = 16, center = null, format = rub } = {}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const r = size / 2 - thickness / 2;
  const c = size / 2;
  const node = svg('svg', { class: `donut${animate() ? ' anim' : ''}`, width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'Доли' });
  node.append(svg('circle', { cx: c, cy: c, r, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': thickness }));
  if (total > 0) {
    const gap = items.filter((i) => i.value > 0).length > 1 ? 2 / r : 0; // 2px зазор по дуге
    let angle = -Math.PI / 2;
    for (const item of items) {
      if (item.value <= 0) continue;
      const sweep = (item.value / total) * Math.PI * 2;
      const a0 = angle + gap / 2;
      const a1 = angle + sweep - gap / 2;
      angle += sweep;
      if (a1 <= a0) continue;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${c + r * Math.cos(a0)},${c + r * Math.sin(a0)}A${r},${r} 0 ${large} 1 ${c + r * Math.cos(a1)},${c + r * Math.sin(a1)}`;
      const arc = svg('path', { class: 'mark arc', d, pathLength: 1, fill: 'none', stroke: item.color, 'stroke-width': thickness, style: { '--d': `${Math.round(((a0 + Math.PI / 2) / (Math.PI * 2)) * 360)}ms` } });
      if (items.length === 1 || sweep >= Math.PI * 2 - 0.001) {
        arc.setAttribute('d', `M${c},${c - r}A${r},${r} 0 1 1 ${c - 0.01},${c - r}`);
      }
      arc.addEventListener('mouseenter', (event) => {
        node.classList.add('dim');
        arc.classList.add('on');
        showTip(event, item.label, [{ label: format(item.value), value: `${Math.round((item.value / total) * 100)} %`, color: item.color }]);
      });
      arc.addEventListener('mousemove', placeTip);
      arc.addEventListener('mouseleave', () => {
        node.classList.remove('dim');
        arc.classList.remove('on');
        hideTip();
      });
      node.append(arc);
    }
  }
  if (center) {
    node.append(svg('text', { x: c, y: c + 2, 'text-anchor': 'middle', fill: 'var(--text)', style: { font: '600 17px var(--sans)' }, text: center.value }));
    if (center.label) node.append(svg('text', { x: c, y: c + 19, 'text-anchor': 'middle', fill: 'var(--text-3)', style: { font: '500 11px var(--sans)' }, text: center.label }));
  }
  return node;
}

// ---------- treemap (squarified) ----------

export function treemap(items, { height = 280, format = rub, onSelect = null } = {}) {
  const root = el('div', { class: 'treemap', style: { height: `${height}px` } });
  const list = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((sum, item) => sum + item.value, 0);
  if (!total) return root;
  const rects = squarify(list.map((item) => ({ item, area: item.value / total })), { x: 0, y: 0, w: 1, h: 1 });
  if (animate()) root.classList.add('anim');
  rects.forEach(({ item, x, y, w, h }, index) => {
    const cell = el(
      'button',
      {
        class: 'treemap-cell',
        type: 'button',
        style: {
          left: `calc(${x * 100}% + 1px)`,
          top: `calc(${y * 100}% + 1px)`,
          width: `calc(${w * 100}% - 2px)`,
          height: `calc(${h * 100}% - 2px)`,
          background: `color-mix(in srgb, ${item.color} 30%, var(--surface))`,
          color: 'var(--text)',
          boxShadow: `inset 0 2px 0 ${item.color}`,
          '--d': stagger(index, rects.length, 240),
        },
        'aria-label': `${item.label}: ${format(item.value)}`,
        on: {
          mouseenter: (event) => showTip(event, item.label, [{ label: item.sub || 'Расходы', value: format(item.value) }, { label: 'Доля', value: `${((item.value / total) * 100).toFixed(1).replace('.', ',')} %` }]),
          mousemove: placeTip,
          mouseleave: hideTip,
          click: onSelect ? () => onSelect(item) : null,
        },
      },
      w * h > 0.012 ? el('span', { class: 'treemap-name truncate', text: item.label }) : null,
      w * h > 0.03 ? el('span', { class: 'treemap-val', text: format(item.value) }) : null,
    );
    root.append(cell);
  });
  return root;
}

function worst(row, side) {
  const sum = row.reduce((s, r) => s + r.area, 0);
  const max = Math.max(...row.map((r) => r.area));
  const min = Math.min(...row.map((r) => r.area));
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

function squarify(nodes, box) {
  const out = [];
  let rest = nodes.slice();
  let { x, y, w, h } = box;
  while (rest.length) {
    const side = Math.min(w, h);
    let row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) {
      row.push(rest[i]);
      i += 1;
    }
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (w >= h) {
      const rw = sum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.area / rw;
        out.push({ item: r.item, x, y: cy, w: rw, h: rh });
        cy += rh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = sum / w;
      let cx = x;
      for (const r of row) {
        const rw = r.area / rh;
        out.push({ item: r.item, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

// ---------- календарь активности ----------

/**
 * days: Map ГГГГ-ММ-ДД -> {value, label}; end - последний день; weeks - сколько недель показать
 */
export function heatmap(days, { end, weeks = 53, format = rub, cell = 11, gap = 3, monthNames = [] } = {}) {
  const root = el('div', { class: 'heatmap' });
  const endDate = new Date(`${end}T00:00:00Z`);
  // последняя колонка - неделя с днём end; строки пн..вс
  const endDow = (endDate.getUTCDay() + 6) % 7;
  const start = new Date(endDate.getTime() - ((weeks - 1) * 7 + endDow) * 86400000);
  const values = [...days.values()].map((d) => d.value).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.8)];
  const level = (v) => (v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
  const left = 26;
  const top = 18;
  const width = left + weeks * (cell + gap);
  const height = top + 7 * (cell + gap);
  const node = svg('svg', { class: animate() ? 'anim' : null, width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Календарь закупок' });
  ['пн', '', 'ср', '', 'пт', '', ''].forEach((label, row) => {
    if (label) node.append(svg('text', { x: 0, y: top + row * (cell + gap) + cell - 2, fill: 'var(--text-3)', style: { font: '500 10.5px var(--sans)' }, text: label }));
  });
  let lastMonth = -1;
  for (let w = 0; w < weeks; w += 1) {
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86400000);
      if (date > endDate) continue;
      const key = date.toISOString().slice(0, 10);
      if (d === 0 && date.getUTCMonth() !== lastMonth && date.getUTCDate() <= 7) {
        lastMonth = date.getUTCMonth();
        node.append(svg('text', { x: left + w * (cell + gap), y: 11, fill: 'var(--text-3)', style: { font: '500 10.5px var(--sans)' }, text: monthNames[lastMonth] ?? '' }));
      }
      const info = days.get(key);
      const v = info?.value ?? 0;
      // волна идёт от свежих недель справа: их видно первыми, а на телефоне старые недели всё равно за краем
      const rect = svg('rect', { class: 'day', x: left + w * (cell + gap), y: top + d * (cell + gap), width: cell, height: cell, rx: 3, fill: `var(--heat-${level(v)})`, style: { '--d': stagger(weeks - 1 - w, weeks, 360) } });
      rect.addEventListener('mouseenter', (event) => showTip(event, info?.title ?? key, v > 0 ? [{ label: info?.label ?? 'Закупки', value: format(v) }] : [{ label: 'Закупок не было', value: '' }]));
      rect.addEventListener('mousemove', placeTip);
      rect.addEventListener('mouseleave', hideTip);
      node.append(rect);
    }
  }
  root.append(node);
  // свежие недели справа, как в календаре GitHub: прокручиваем к концу
  requestAnimationFrame(() => {
    root.scrollLeft = root.scrollWidth;
  });
  return root;
}

export function heatLegend() {
  return el(
    'div',
    { class: 'heat-legend' },
    el('span', { text: 'Меньше' }),
    [0, 1, 2, 3, 4].map((l) => el('span', { class: 'cell', style: { background: `var(--heat-${l})` } })),
    el('span', { text: 'Больше' }),
  );
}

// ---------- легенда с переключением серий ----------

export function legend(series, { hidden = new Set(), onToggle = null } = {}) {
  return el(
    'div',
    { class: 'legend' },
    series.map((s) =>
      onToggle
        ? el(
            'button',
            { class: 'legend-item', type: 'button', 'aria-pressed': hidden.has(s.key) ? 'false' : 'true', on: { click: () => onToggle(s.key) } },
            el('span', { class: 'swatch', style: { background: s.color } }),
            el('span', { text: s.label }),
          )
        : el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: { background: s.color } }), el('span', { text: s.label })),
    ),
  );
}
