import { afterEach, beforeEach, expect, test } from 'vitest';
import { withTemplate } from '../../test/issueSetup';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { EmitterRepository } from '../repos/EmitterRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('a timeout leaves the invoice unknown; reconcile finds it by DPS id without a resend', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'delay', ms: 600 });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 1000,
      foreignAmountCents: 200,
    },
  });
  expect(issued.json()).toMatchObject({ status: 'unknown' });
  const { id } = issued.json<{ id: string }>();
  const reconciled = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`,
    headers,
    payload: {},
  });
  expect(reconciled.json()).toMatchObject({ id, status: 'issued', accessKey: expect.any(String) });
  // Found by the lookup: nothing was resent.
  expect(new AuditLog(t.db).list().some((e) => e.detail?.startsWith('resent'))).toBe(false);
});

test('when the Sefin never stored it, reconcile resends the same DPS number', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'reply', status: 503, body: 'down' });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 1000,
      foreignAmountCents: 200,
    },
  });
  const { id } = issued.json<{ id: string }>();
  expect(issued.json().status).toBe('unknown');
  const reconciled = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`,
    headers,
    payload: {},
  });
  expect(reconciled.json()).toMatchObject({ status: 'issued' });
});

test('reconcile of an issued invoice is 409 not_unknown', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/reconcile`,
    headers,
    payload: {},
  });
  expect(response.statusCode).toBe(409);
});

test('reconcile looks up and resends in the invoice environment, not the emitter current one', async () => {
  const { a, emitterId, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'reply', status: 503, body: 'down' });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 1000,
      foreignAmountCents: 200,
    },
  });
  const { id } = issued.json<{ id: string }>();
  new EmitterRepository(t.db).setEnvironment(a, emitterId, 'producao');
  const reconciled = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`,
    headers,
    payload: {},
  });
  expect(reconciled.json()).toMatchObject({ status: 'issued' });
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${id}`,
    headers,
  });
  expect(detail.json()).toMatchObject({ environment: 'producao_restrita' });
});

test('a resend of our own DPS that gets E0014 ends issued through the lookup and the ownership check', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'delay', ms: 600 });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 1000,
      foreignAmountCents: 200,
    },
  });
  const { id } = issued.json<{ id: string }>();
  // The first lookup misses although the Sefin stored the DPS, so reconcile resends and gets E0014.
  t.fake.next('getDps', { kind: 'reply', status: 404, body: { erro: 'not found' } });
  const reconciled = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`,
    headers,
    payload: {},
  });
  expect(reconciled.json()).toMatchObject({ id, status: 'issued' });
  expect(new AuditLog(t.db).list().some((e) => e.detail?.startsWith('resent'))).toBe(true);
});
