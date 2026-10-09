import { afterEach, beforeEach, expect, test } from 'vitest';
import { withTemplate } from '../../test/issueSetup';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('a timeout leaves the invoice unknown; reconcile finds it, with no second NFS-e', async () => {
  const { a, emitterId, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'delay', ms: 600 });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 1000, foreignAmountCents: 200 },
  });
  expect(issued.json()).toMatchObject({ status: 'unknown' });
  const { id } = issued.json<{ id: string }>();
  const reconciled = await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`, headers, payload: {} });
  expect(reconciled.json()).toMatchObject({ id, status: 'issued', accessKey: expect.any(String) });
  // A blind resend would have made a second NFS-e; the feed must hold the template and one new invoice.
  await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`, headers, payload: {} });
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  expect(list.json()).toMatchObject({ total: 2 });
});

test('when the Sefin never stored it, reconcile resends the same DPS number', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'reply', status: 503, body: 'down' });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 1000, foreignAmountCents: 200 },
  });
  const { id } = issued.json<{ id: string }>();
  expect(issued.json().status).toBe('unknown');
  const reconciled = await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`, headers, payload: {} });
  expect(reconciled.json()).toMatchObject({ status: 'issued' });
});

test('reconcile of an issued invoice is 409 not_unknown', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/reconcile`, headers, payload: {} });
  expect(response.statusCode).toBe(409);
});
