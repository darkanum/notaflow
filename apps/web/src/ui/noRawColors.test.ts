import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SRC = join(__dirname, '..');
// Tailwind palette colors (bg-red-500, text-gray-700, ...) and hex literals bypass the tokens.
const RAW =
  /\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b|#[0-9a-fA-F]{3,8}\b/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'malphas' ? [] : files(path);
    return /\.(tsx?|css)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

// The Malphas modal overlay is the one raw color the design system itself uses.
const ALLOWED = ['backdrop:bg-black/50'];

test('no source outside src/malphas uses a color that is not a Malphas token', () => {
  const offenders = files(SRC).filter((path) => {
    const text = ALLOWED.reduce(
      (all, allowed) => all.split(allowed).join(''),
      readFileSync(path, 'utf8'),
    );
    return RAW.test(text);
  });
  expect(offenders).toEqual([]);
});
