// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ERROR_TEXT } from '../components/Layout';
import { stubApi } from '../test/stubApi';
import { IssuePage } from './IssuePage';

const KEY = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  // A second call would give another key, so a test sees a key made per attempt.
  vi.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce(KEY)
    .mockReturnValue('22222222-2222-4222-8222-222222222222');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

const draft = {
  templateInvoiceId: 'inv1',
  emitterId: 'em1',
  competence: '2026-08-31',
  serviceCents: 1086420,
  description: 'Serviços de TI',
  customer: { document: { type: 'NIF', value: '00-0000000' }, name: 'Foreign Customer Inc' },
  foreign: { currency: 'USD', currencyCode: '220', amountCents: 200000 },
};
const emitter = {
  id: 'em1',
  cnpj: '12345678000195',
  companyName: 'EMPRESA TESTE LTDA',
  environment: 'producao',
  municipality: '4113700',
  dpsSeries: '900',
  certificate: null,
};
const base = {
  '/api/accounts/acc/invoices/inv1/draft': draft,
  '/api/accounts/acc/emitters': [emitter],
  '/api/accounts/acc/customers': [],
};

test('the PTAX button fills the BRL amount from the foreign amount', async () => {
  stubApi({
    ...base,
    '/api/accounts/acc/exchange-rate': {
      currency: 'USD',
      date: '2026-08-31',
      rate: '5.4321',
      rateE4: 54321,
      source: 'PTAX venda, fechamento',
    },
  });
  render(<IssuePage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /cotação ptax/i }));
  expect(await screen.findByDisplayValue('10.864,20')).toBeTruthy();
  expect(screen.getByText(/PTAX venda de 31\/08\/2026: 5,4321/)).toBeTruthy();
});

test('a PTAX failure keeps the BRL amount editable and says so', async () => {
  stubApi({ ...base, '/api/accounts/acc/exchange-rate': { error: 'ptax_unavailable' } });
  render(<IssuePage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /cotação ptax/i }));
  expect(await screen.findByText(ERROR_TEXT.ptax_unavailable ?? '')).toBeTruthy();
  expect((screen.getByLabelText(/valor em reais/i) as HTMLInputElement).disabled).toBe(false);
});

test('the review shows PRODUÇÃO, highlights changes, and sends one key on a retry', async () => {
  const calls = stubApi({
    ...base,
    '/api/accounts/acc/invoices/issue': { error: 'sefin_unavailable' },
  });
  render(<IssuePage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  const description = await screen.findByLabelText(/descrição/i);
  await user.clear(description);
  await user.type(description, 'Serviços de outubro');
  await user.click(screen.getByRole('button', { name: /revisar/i }));
  expect(screen.getByText('PRODUÇÃO')).toBeTruthy();
  expect(screen.getByRole('row', { name: /descrição/i }).className).toContain('bg-warning/10');
  expect(screen.getByRole('row', { name: /tomador/i }).className).not.toContain('bg-warning/10');
  await user.click(screen.getByRole('button', { name: /emitir em produção/i }));
  await user.click(await screen.findByRole('button', { name: /emitir em produção/i }));
  await waitFor(() =>
    expect(calls.filter((c) => c.url.endsWith('/invoices/issue'))).toHaveLength(2),
  );
  const keys = calls
    .filter((c) => c.url.endsWith('/invoices/issue'))
    .map((c) => new Headers(c.init?.headers).get('idempotency-key'));
  expect(keys).toEqual([KEY, KEY]);
});

test('an issued invoice opens its detail', async () => {
  stubApi({
    ...base,
    '/api/accounts/acc/invoices/issue': { id: 'new1', status: 'issued', number: '7' },
  });
  render(<IssuePage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /revisar/i }));
  await user.click(screen.getByRole('button', { name: /emitir em produção/i }));
  await waitFor(() => expect(window.location.hash).toBe('#/a/acc/invoices/new1'));
});
