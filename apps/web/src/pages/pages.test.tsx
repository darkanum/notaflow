// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { InvoicesPage } from './InvoicesPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function stubApi(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      const body = key ? routes[key] : { error: 'not_found' };
      return new Response(JSON.stringify(body), {
        status: key ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const invoice = {
  id: 'inv1',
  emitterId: 'em1',
  accessKey: 'K'.repeat(50),
  number: '3',
  status: 'cancelled',
  environment: 'producao',
  issuedAt: '2026-09-02T16:12:54.000Z',
  competence: '2026-08-31',
  customerDocument: '00-0000000',
  customerName: 'Foreign Customer Inc',
  serviceCode: '010701',
  description: 'Serviços de TI',
  serviceCents: 670321,
  issCents: null,
  netCents: 670321,
};

test('lists invoices with BRL amounts and the cancelled status', async () => {
  stubApi({
    '/api/accounts/acc/invoices': { items: [invoice], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  expect(await screen.findByText('Foreign Customer Inc')).toBeTruthy();
  expect(screen.getByText(/6\.703,21/)).toBeTruthy();
  expect(screen.getByRole('cell', { name: /cancelada/i })).toBeTruthy();
});

test('the lookup posts the key and opens the found invoice', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/lookup': { id: 'inv1' },
    '/api/accounts/acc/invoices': { items: [], total: 0 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/chave de acesso/i), 'K'.repeat(50));
  await user.click(screen.getByRole('button', { name: /buscar/i }));
  await waitFor(() => expect(window.location.hash).toBe('#/a/acc/invoices/inv1'));
  expect(calls.find((c) => c.url.endsWith('/lookup'))?.init?.body).toBe(
    JSON.stringify({ accessKey: 'K'.repeat(50) }),
  );
});
