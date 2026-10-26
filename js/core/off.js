// штрихкод и карточка продукта из Open Food Facts: запрос только по нажатию кнопки, без поиска «на лету»
export const OFF_HOST = 'https://world.openfoodfacts.org';
export const OFF_LICENSE_URL = 'https://world.openfoodfacts.org/terms-of-use';

// GTIN: 8, 12, 13 или 14 цифр, последняя - контрольная; без проверки сюда уходили бы заведомо пустые запросы
export function isValidGtin(code) {
  const text = String(code ?? '').trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(text)) return false;
  const digits = text.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

export function offProductUrl(code) {
  return `${OFF_HOST}/api/v2/product/${code}.json?fields=code,product_name,product_name_ru,brands,quantity`;
}

const text = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

// ответ API: status 1 - продукт найден; без названия он бесполезен для склада
export function parseOffProduct(raw, code) {
  const product = raw && typeof raw === 'object' && raw.status === 1 ? raw.product : null;
  if (!product || typeof product !== 'object') return { found: false, code };
  const name = text(product.product_name_ru || product.product_name);
  if (!name) return { found: false, code };
  return {
    found: true,
    code,
    name: name.slice(0, 120),
    brand: text(product.brands).split(',')[0].trim(),
    quantity: text(product.quantity),
  };
}

// статусы: found, not_found, busy (сервер просит подождать), error, invalid (код не прошёл проверку)
export async function lookupBarcode(code, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!isValidGtin(code)) return { status: 'invalid' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(offProductUrl(String(code).trim()), {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      // адрес страницы склада в запрос не уходит
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (response.status === 429 || response.status === 503) return { status: 'busy' };
    if (!response.ok) return { status: 'error' };
    const product = parseOffProduct(await response.json(), String(code).trim());
    return product.found ? { status: 'found', product } : { status: 'not_found' };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}
