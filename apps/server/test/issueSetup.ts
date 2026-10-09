import { makeTestCertificate } from '@notaflow/test-kit';
import { expect } from 'vitest';
import { issueExportOnFake } from './fakeInvoices';
import { seedTenant } from './fixtures';
import type { TestApp } from './testApp';

// An onboarded emitter with one synced export invoice to copy.
export async function withTemplate(t: TestApp) {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const headers = await t.as('owner@example.com');
  const onboard = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers,
    payload: {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '4113700',
      simplesNacional: '3',
      simplesRegime: '1',
      specialRegime: '0',
      dpsSeries: '900',
    },
  });
  expect(onboard.statusCode).toBe(201);
  const emitterId = onboard.json<{ id: string }>().id;
  await issueExportOnFake(t.fake);
  await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`,
    headers,
    payload: {},
  });
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices`,
    headers,
  });
  const templateInvoiceId = list.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  expect(templateInvoiceId).not.toBe('');
  return { a, emitterId, headers, templateInvoiceId };
}
