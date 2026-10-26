// тема: dark | light | system. хранится в zakrom:theme
import { load, save } from '../core/store.js';

const media = globalThis.matchMedia?.('(prefers-color-scheme: light)');

export function themeChoice() {
  const value = load('theme', 'dark');
  return ['dark', 'light', 'system'].includes(value) ? value : 'dark';
}

export function applyTheme(choice = themeChoice()) {
  const resolved = choice === 'system' ? (media?.matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f6f6f4' : '#0a0a0b');
}

export function setTheme(choice) {
  save('theme', choice);
  applyTheme(choice);
}

media?.addEventListener?.('change', () => {
  if (themeChoice() === 'system') applyTheme('system');
});
