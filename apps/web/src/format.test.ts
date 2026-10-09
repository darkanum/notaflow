// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { fileToBase64, formatCents, formatCompetence, formatDate } from './format';

test('formatCents writes BRL with comma decimals', () => {
  expect(formatCents(150000).replace(/\s/g, ' ')).toBe('R$ 1.500,00');
  expect(formatCents(5).replace(/\s/g, ' ')).toBe('R$ 0,05');
});

test('formatDate shows the Brasília day of a UTC timestamp', () => {
  expect(formatDate('2026-10-02T01:30:00.000Z')).toBe('01/10/2026');
  expect(formatDate('2026-10-02T03:30:00.000Z')).toBe('02/10/2026');
});

test('formatDate and formatCompetence use the Brazilian order', () => {
  expect(formatDate('2026-10-01T13:00:00.000Z')).toBe('01/10/2026');
  expect(formatDate(null)).toBe('');
  expect(formatCompetence('2026-09-30')).toBe('09/2026');
});

test('fileToBase64 reads a file without the data URL prefix', async () => {
  const file = new Blob([new Uint8Array([1, 2, 3, 250])]);
  expect(await fileToBase64(file)).toBe(Buffer.from([1, 2, 3, 250]).toString('base64'));
});
