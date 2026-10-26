import test from 'node:test';
import assert from 'node:assert/strict';
import { load, save, clearSandbox } from '../../js/core/store.js';

test('без localStorage и с ломающимся хранилищем всё работает', () => {
  delete globalThis.localStorage;
  assert.equal(load('x', 7), 7);
  assert.equal(save('x', 1), false);
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.equal(load('x', 'fallback'), 'fallback');
  assert.equal(save('x', 1), false);
});

test('сброс песочницы не трогает тему и выбор организации', () => {
  const memory = new Map([['zakrom:ws:zerno', '{}'], ['zakrom:ws:ugol', '{}'], ['zakrom:theme', '"light"'], ['zakrom:workspace', '"ugol"'], ['other', '1']]);
  globalThis.localStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
    key: (i) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  };
  clearSandbox();
  assert.deepEqual([...memory.keys()].sort(), ['other', 'zakrom:theme', 'zakrom:workspace']);
  memory.set('zakrom:bad', '{oops');
  assert.equal(load('bad', null), null);
});
