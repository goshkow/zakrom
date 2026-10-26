// общие данные для тестов модели: настоящий каталог из репозитория и фиксированная «сегодняшняя» дата
import { readFileSync } from 'node:fs';
import { createMarket } from '../../js/model/market.js';
import { createSupply } from '../../js/model/supply.js';
import { simulate } from '../../js/model/history.js';
import { WORKSPACE_BY_ID } from '../../js/model/workspaces.js';

export const TODAY = '2026-10-21';
export const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
export const marketRaw = JSON.parse(readFileSync(new URL('../../data/market.json', import.meta.url), 'utf8'));

const cache = new Map();

export function world(wsId = 'zerno', today = TODAY) {
  const key = `${wsId}|${today}`;
  if (!cache.has(key)) {
    const market = createMarket(marketRaw, today);
    const ws = WORKSPACE_BY_ID[wsId];
    const supply = createSupply(catalog, market, ws);
    const sim = simulate(supply, ws, today);
    cache.set(key, { market, ws, supply, sim });
  }
  return cache.get(key);
}
