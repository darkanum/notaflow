import { makeTestCertificate } from '@notaflow/test-kit';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function onboarded(email = 'owner@example.com') {
  const a = seedTenant(t.db, { accountName: 'A', email });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as(email),
    payload: {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '3550308',
      simplesNacional: '1',
      specialRegime: '0',
      dpsSeries: '900',
    },
  });
  expect(response.statusCode).toBe(201);
  return { a, emitterId: response.json<{ id: string }>().id };
}

async function synced() {
  const tenant = await onboarded();
  const keys = await issueOnFake(t.fake, 3);
  const sync = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${tenant.a.accountId}/emitters/${tenant.emitterId}/sync`,
    headers: await t.as('owner@example.com'),
    payload: {},
  });
  expect(sync.json()).toMatchObject({ invoices: 3, error: null });
  return { ...tenant, keys };
}

async function lookup(accountId: string, accessKey: string) {
  return t.app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/invoices/lookup`,
    headers: await t.as('owner@example.com'),
    payload: { accessKey },
  });
}

test('lists synced invoices with paging and returns the detail and the XML', async () => {
  const { a } = await synced();
  const headers = await t.as('owner@example.com');
  const page = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices?limit=2`,
    headers,
  });
  expect(page.statusCode).toBe(200);
  const body = page.json<{ total: number; items: { id: string; number: string }[] }>();
  expect(body.total).toBe(3);
  expect(body.items).toHaveLength(2);

  const id = body.items[0]?.id ?? '';
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${id}`,
    headers,
  });
  expect(detail.json()).toMatchObject({ id, status: 'issued', events: [] });
  expect(detail.json()).toMatchObject({ sefinMessages: null, templateOf: null });

  const xml = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${id}/xml`,
    headers,
  });
  expect(xml.headers['content-type']).toContain('application/xml');
  expect(xml.headers['content-disposition']).toMatch(/^attachment; filename="NFSe-\d+\.xml"$/);
  expect(xml.body).toContain('<NFSe');
});

test('an invalid limit is 400', async () => {
  const { a } = await onboarded();
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices?limit=5000`,
    headers: await t.as('owner@example.com'),
  });
  expect(response.statusCode).toBe(400);
});

test('lookup stores an invoice found by access key through the sync path', async () => {
  const { a } = await onboarded();
  const [key] = await issueOnFake(t.fake, 1);
  const response = await lookup(a.accountId, ` ${(key ?? '').toLowerCase()} `);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ id: expect.any(String) });
  const customers = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/customers`,
    headers: await t.as('owner@example.com'),
  });
  expect(customers.json()).toEqual([expect.objectContaining({ name: 'Cliente Exemplo Ltda' })]);
});

test('lookup of a key whose CNPJ is not an emitter of the account is 404 and calls nothing', async () => {
  const { a } = await onboarded();
  t.fake.next('getNfse', { kind: 'reply', status: 500, body: 'must not be called' });
  const response = await lookup(a.accountId, '355030822' + '98765432000110' + '0'.repeat(27));
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'emitter_not_found' });
  // The queued 500 is still there, so the first lookup never called the Sefin.
  const after = await lookup(a.accountId, '355030822' + '12345678000195' + '9'.repeat(27));
  expect(after.statusCode).toBe(500);
});

test('lookup of an unknown key of the emitter is 404 invoice_not_found', async () => {
  const { a } = await onboarded();
  const response = await lookup(a.accountId, '355030822' + '12345678000195' + '9'.repeat(27));
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'invoice_not_found' });
});

test('a malformed key is 400 invalid_access_key', async () => {
  const { a } = await onboarded();
  const response = await lookup(a.accountId, 'abc');
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'invalid_access_key' });
});

test('another account sees none of the invoices', async () => {
  const { a } = await synced();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices`,
    headers: await t.as('b@example.com'),
  });
  expect(list.json()).toEqual({ items: [], total: 0 });
  const own = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers: await t.as('owner@example.com'),
  });
  expect(own.json()).toMatchObject({ total: 3 });
  const id = own.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  expect(id).not.toBe('');
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices/${id}`,
    headers: await t.as('b@example.com'),
  });
  expect(detail.statusCode).toBe(404);
});

test('the DANFS-e route downloads the PDF from the ADN in the invoice environment', async () => {
  const { a } = await synced();
  const headers = await t.as('owner@example.com');
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  const first = list.json<{ items: { id: string; number: string }[] }>().items[0];
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${first?.id ?? ''}/danfse`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('application/pdf');
  expect(response.headers['content-disposition']).toBe(`attachment; filename="DANFSe-${first?.number ?? ''}.pdf"`);
  expect(response.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

test('when the ADN cannot render the PDF the route answers 502 danfse_unavailable', async () => {
  const { a } = await synced();
  const headers = await t.as('owner@example.com');
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  const id = list.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  t.fake.next('danfse', { kind: 'reply', status: 503, body: '<html>503 Service Unavailable</html>' });
  const response = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${id}/danfse`, headers });
  expect(response.statusCode).toBe(502);
  expect(response.json()).toEqual({ error: 'danfse_unavailable' });
});

test('another account gets 404 on the DANFS-e route', async () => {
  const { a } = await synced();
  const own = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers: await t.as('owner@example.com') });
  const id = own.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices/${id}/danfse`,
    headers: await t.as('b@example.com'),
  });
  expect(response.statusCode).toBe(404);
});
