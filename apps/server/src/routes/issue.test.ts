import { MockAgent } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueExportOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { withTemplate } from '../../test/issueSetup';
import { providerInvoice } from '../../test/providerData';
import { createTestApp, type TestApp } from '../../test/testApp';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('the draft copies the template and marks it as an export', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const draft = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/draft`,
    headers,
  });
  expect(draft.json()).toMatchObject({
    templateInvoiceId,
    serviceCents: 1036320,
    foreign: { currency: 'USD', amountCents: 200000 },
    customer: { document: { type: 'NIF' } },
  });
});

test('issue similar: pending, then issued with a new DPS number and the new amounts', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: {
      templateInvoiceId,
      competence: '2026-09-30',
      serviceCents: 1813560,
      foreignAmountCents: 350000,
      description: 'Serviços de setembro',
    },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ status: 'issued', accessKey: expect.any(String) });
  const { id } = response.json<{ id: string }>();
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices/${id}`,
    headers,
  });
  expect(detail.json()).toMatchObject({
    status: 'issued',
    serviceCents: 1813560,
    description: 'Serviços de setembro',
    origin: 'app',
  });
});

test('two issues at the same time get two different DPS numbers', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const payload = { templateInvoiceId, competence: '2026-09-30', serviceCents: 100, foreignAmountCents: 20 };
  const url = `/api/accounts/${a.accountId}/invoices/issue`;
  const [one, two] = await Promise.all([
    t.app.inject({ method: 'POST', url, headers, payload }),
    t.app.inject({ method: 'POST', url, headers, payload }),
  ]);
  expect([one.json().status, two.json().status]).toEqual(['issued', 'issued']);
  expect(one.json().accessKey).not.toBe(two.json().accessKey);
});

test('a zero amount and a future competence are refused before anything is reserved', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const url = `/api/accounts/${a.accountId}/invoices/issue`;
  const zero = await t.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 0, foreignAmountCents: 1 },
  });
  expect(zero.json()).toEqual({ error: 'invalid_amount' });
  const future = await t.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { templateInvoiceId, competence: '2999-01-31', serviceCents: 1, foreignAmountCents: 1 },
  });
  expect(future.json()).toEqual({ error: 'competence_after_issue' });
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  expect(list.json()).toMatchObject({ total: 1 });
});

test('a template with a field the app cannot copy is 422 with the paths, and nothing is reserved', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const headers = await t.as('owner@example.com');
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '4113700',
    simplesNacional: '3',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const xml = '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><DPS><infDPS><BM><tpBM>1</tpBM></BM></infDPS></DPS></infNFSe></NFSe>';
  const { id } = new InvoiceRepository(t.db).upsertSynced(a, emitter.id, providerInvoice({ xml }), null);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId: id, competence: '2026-09-30', serviceCents: 100 },
  });
  expect(response.statusCode).toBe(422);
  expect(response.json()).toEqual({ error: 'template_unsupported', paths: ['BM/tpBM'] });
  expect(new EmitterRepository(t.db).get(a, emitter.id)?.nextDpsNumber).toBe(1);
});

test('a DPS number used outside the app is never taken as the new invoice', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  // Number 7 was issued by another system and is not synced yet; the app reserves 7 next.
  await issueExportOnFake(t.fake, { number: 7, amounts: { serviceCents: 999 } });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 1813560, foreignAmountCents: 350000 },
  });
  expect(response.json()).toMatchObject({ status: 'rejected', errors: [{ code: 'E0014' }] });
});

test('the exchange rate route returns the PTAX sell closing rate', async () => {
  const ptax = new MockAgent();
  ptax.disableNetConnect();
  ptax
    .get('https://olinda.bcb.gov.br')
    .intercept({ path: (p) => p.includes('08-31-2026'), method: 'GET' })
    .reply(200, { value: [{ tipoBoletim: 'Fechamento PTAX', cotacaoVenda: 5.1816, cotacaoCompra: 5.181 }] });
  const own = await createTestApp({ ptaxDispatcher: ptax });
  const a = seedTenant(own.db, { accountName: 'A', email: 'x@example.com' });
  const response = await own.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/exchange-rate?currency=220&date=2026-08-31`,
    headers: await own.as('x@example.com'),
  });
  await own.close();
  expect(response.json()).toEqual({
    currency: 'USD',
    date: '2026-08-31',
    rate: '5.1816',
    rateE4: 51816,
    source: 'PTAX venda, fechamento',
  });
});
