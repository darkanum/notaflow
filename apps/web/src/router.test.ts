import { expect, test } from 'vitest';
import { parseRoute, routeHref } from './router';

test.each([
  ['', { name: 'home' }],
  ['#/', { name: 'home' }],
  ['#/a/acc1/emitters', { name: 'emitters', accountId: 'acc1' }],
  ['#/a/acc1/invoices', { name: 'invoices', accountId: 'acc1' }],
  ['#/a/acc1/invoices/inv9', { name: 'invoice', accountId: 'acc1', invoiceId: 'inv9' }],
  ['#/a/acc1/members', { name: 'members', accountId: 'acc1' }],
  ['#/admin', { name: 'admin' }],
  ['#/unknown/path', { name: 'home' }],
])('parseRoute(%s)', (hash, route) => {
  expect(parseRoute(hash)).toEqual(route);
});

test('routeHref is the inverse of parseRoute', () => {
  const route = { name: 'invoice', accountId: 'a b', invoiceId: 'i/1' } as const;
  expect(parseRoute(routeHref(route))).toEqual(route);
});
