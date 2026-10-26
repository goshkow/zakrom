// роутер по хэшу: #/orders/123?status=approval. перерисовку делает main.js по событию zakrom:render
export function parseRoute(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  return { section: parts[0] ?? '', id: parts[1] ?? null, sub: parts[2] ?? null, query: new URLSearchParams(qs) };
}

export function rerender({ route = false } = {}) {
  window.dispatchEvent(new CustomEvent('zakrom:render', { detail: { route } }));
}

export function go(hash) {
  if (location.hash === hash) rerender();
  else location.hash = hash;
}

export function link(section, id = null, query = null) {
  const path = [section, id].filter(Boolean).map((p) => encodeURIComponent(p)).join('/');
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString() : '';
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

// фильтры страницы живут в адресе: ссылкой можно поделиться, а «назад» возвращает прошлый фильтр
export function setQuery(updates, { push = false } = {}) {
  const route = parseRoute();
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined || v === '' || v === false) route.query.delete(k);
    else route.query.set(k, String(v));
  }
  const hash = link(route.section, route.id && route.sub ? `${route.id}/${route.sub}` : route.id, Object.fromEntries(route.query));
  const fixed = hash.replace('%2F', '/');
  if (push) history.pushState(null, '', fixed);
  else history.replaceState(null, '', fixed);
  rerender({ route: true });
}

// параметры окон не меняют содержимое страницы под ними
export function viewKey(route, workspaceId) {
  const query = new URLSearchParams(route.query);
  if (route.section === 'catalog') query.delete('p');
  if (route.section === 'rfq') for (const key of ['new', 'product', 'supplier', 'item']) query.delete(key);
  query.sort();
  return `${workspaceId}|${route.section}/${route.id ?? ''}/${route.sub ?? ''}?${query}`;
}
