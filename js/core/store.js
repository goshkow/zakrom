// localStorage с защитой: приватный режим, переполнение и битый JSON не роняют кабинет
const PREFIX = 'zakrom:';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function load(key, fallback) {
  const ls = storage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(PREFIX + key);
  } catch {
    // нечего чистить - и ладно
  }
}

// все ключи песочницы одной кнопкой: тема и выбор организации остаются
export function clearSandbox() {
  const ls = storage();
  if (!ls) return;
  try {
    const keys = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (key && key.startsWith(`${PREFIX}ws:`)) keys.push(key);
    }
    keys.forEach((key) => ls.removeItem(key));
  } catch {
    // см. выше
  }
}
