import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { providerEvent, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { type ApplyCounts, applyDocument } from './applyDocument';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

function setup() {
  const ctx = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = new EmitterRepository(db).create(ctx, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  const repos = { customers: new CustomerRepository(db), invoices: new InvoiceRepository(db) };
  const counts: ApplyCounts = { invoices: 0, events: 0, skipped: 0 };
  return { ctx, emitterId, repos, counts };
}

test('an invoice document stores the invoice and its customer', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(
    repos,
    ctx,
    emitterId,
    { kind: 'invoice', nsu: 1, invoice: providerInvoice() },
    counts,
  );
  expect(counts).toEqual({ invoices: 1, events: 0, skipped: 0 });
  const { items } = repos.invoices.list(ctx, { limit: 10, offset: 0 });
  expect(items).toMatchObject([
    { number: '42', status: 'issued', customerName: 'Cliente Exemplo Ltda' },
  ]);
  expect(repos.customers.list(ctx, { emitterId })).toHaveLength(1);
});

test('the same documents twice create nothing new', () => {
  const { ctx, emitterId, repos, counts } = setup();
  for (let round = 0; round < 2; round++) {
    applyDocument(
      repos,
      ctx,
      emitterId,
      { kind: 'invoice', nsu: 1, invoice: providerInvoice() },
      counts,
    );
    applyDocument(repos, ctx, emitterId, { kind: 'event', nsu: 2, event: providerEvent() }, counts);
  }
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).total).toBe(1);
  expect(repos.customers.list(ctx, {})).toHaveLength(1);
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).items[0]?.status).toBe('cancelled');
});

test('an event before its invoice still ends with a cancelled invoice', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(repos, ctx, emitterId, { kind: 'event', nsu: 1, event: providerEvent() }, counts);
  applyDocument(
    repos,
    ctx,
    emitterId,
    { kind: 'invoice', nsu: 2, invoice: providerInvoice() },
    counts,
  );
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).items[0]?.status).toBe('cancelled');
});

test('a skipped document only counts', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(
    repos,
    ctx,
    emitterId,
    { kind: 'skipped', nsu: 1, reason: 'received invoice' },
    counts,
  );
  expect(counts).toEqual({ invoices: 0, events: 0, skipped: 1 });
});
