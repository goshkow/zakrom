#!/usr/bin/env node
// находит неиспользуемые импорты в js/: линтера в проекте нет, а мёртвые импорты копятся быстро
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) files.push(path);
  }
};
for (const dir of process.argv.slice(2).length ? process.argv.slice(2) : ['js', 'tools']) walk(dir);

let problems = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const body = text.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
  for (const match of text.matchAll(/^import\s+\{([^}]+)\}\s+from/gm)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop();
      if (!name) continue;
      if (!new RegExp(`(?<![\\w$])(?<![^.]\\.)${name.replace('$', '\\$')}(?![\\w$])`).test(body)) {
        console.log(`${file}: не используется ${name}`);
        problems += 1;
      }
    }
  }
}
process.exit(problems ? 1 : 0);
