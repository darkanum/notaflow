import { expect, test } from 'vitest';
import {
  centsToDecimal,
  decimalToCents,
  formatBrasiliaDate,
  formatBrasiliaDateTime,
} from './formatters';

test.each([
  [0, '0.00'],
  [5, '0.05'],
  [150000, '1500.00'],
  [123456789, '1234567.89'],
])('centsToDecimal(%i) = %s', (cents, expected) => {
  expect(centsToDecimal(cents)).toBe(expected);
});

test('centsToDecimal rejects negative and fractional cents', () => {
  expect(() => centsToDecimal(-1)).toThrow(RangeError);
  expect(() => centsToDecimal(1.5)).toThrow(RangeError);
});

test('formatBrasiliaDateTime writes UTC-3 without milliseconds', () => {
  expect(formatBrasiliaDateTime(new Date('2026-10-08T18:30:15.123Z'))).toBe(
    '2026-10-08T15:30:15-03:00',
  );
});

test('formatBrasiliaDate keeps the Brasília day after 21:00 local time', () => {
  expect(formatBrasiliaDate(new Date('2026-10-09T01:30:00Z'))).toBe('2026-10-08');
  expect(formatBrasiliaDate(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-09');
});

test.each([
  ['0.00', 0],
  ['10', 1000],
  ['10.5', 1050],
  ['6703.21', 670321],
  ['1234567.89', 123456789],
])('decimalToCents(%s) = %i', (value, cents) => {
  expect(decimalToCents(value)).toBe(cents);
});

test('decimalToCents rejects a value that is not a non-negative decimal with up to 2 places', () => {
  for (const value of ['', '-1.00', '1.234', 'abc', '1,50']) {
    expect(() => decimalToCents(value)).toThrow(RangeError);
  }
});
