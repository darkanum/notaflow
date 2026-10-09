import { afterEach, beforeEach, expect, test } from 'vitest';
import { withTemplate } from '../../test/issueSetup';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('cancel stores the event and the invoice becomes cancelled', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const url = `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`;
  const response = await t.app.inject({ method: 'POST', url, headers, payload: { reason: '1', justification: 'Valor do serviço incorreto' } });
  expect(response.json()).toEqual({ id: templateInvoiceId, status: 'cancelled' });
  const detail = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}`, headers });
  expect(detail.json()).toMatchObject({ status: 'cancelled', events: [{ code: '101101', reasonCode: '1' }] });
});

test('a second cancel is 409 not_issued', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const url = `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`;
  const payload = { reason: '1', justification: 'Valor do serviço incorreto' };
  await t.app.inject({ method: 'POST', url, headers, payload });
  expect((await t.app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(409);
});

test('a Sefin rejection keeps the invoice issued and returns the Sefin message', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('event', { kind: 'reply', status: 400, body: { erro: { Codigo: 'E1235', Descricao: 'Prazo de cancelamento expirado' } } });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`,
    headers,
    payload: { reason: '1', justification: 'Valor do serviço incorreto' },
  });
  expect(response.statusCode).toBe(422);
  expect(response.json()).toEqual({ error: 'sefin_rejected', code: 'E1235', message: 'Prazo de cancelamento expirado' });
});

test('a short justification is 400', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`,
    headers,
    payload: { reason: '1', justification: 'curta' },
  });
  expect(response.statusCode).toBe(400);
});

test('a justification that is short after trimming is 400 invalid_justification', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`,
    headers,
    payload: { reason: '1', justification: `curta${' '.repeat(20)}` },
  });
  expect(response.json()).toEqual({ error: 'invalid_justification' });
});

test('a cancel refused because the invoice is already cancelled marks it cancelled', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('event', { kind: 'reply', status: 400, body: { erro: { Codigo: 'E0840', Descricao: 'NFS-e já cancelada.' } } });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`,
    headers,
    payload: { reason: '1', justification: 'Valor do serviço incorreto' },
  });
  expect(response.json()).toEqual({ id: templateInvoiceId, status: 'cancelled', alreadyCancelled: true });
  const detail = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}`, headers });
  expect(detail.json()).toMatchObject({ status: 'cancelled' });
});
