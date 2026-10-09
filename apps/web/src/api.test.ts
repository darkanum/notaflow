import { afterEach, expect, test, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

test('post sends JSON with the same-origin credentials', async () => {
  const fetchMock = stubFetch(201, { id: 'x' });
  expect(await api.post('/api/admin/accounts', { name: 'A' })).toEqual({ id: 'x' });
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/accounts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A' }),
  });
});

test('a non-2xx answer throws ApiError with the server code', async () => {
  stubFetch(409, { error: 'cnpj_in_other_account' });
  await expect(api.post('/api/x', {})).rejects.toMatchObject({
    status: 409,
    code: 'cnpj_in_other_account',
  });
  await expect(api.get('/api/x')).rejects.toBeInstanceOf(ApiError);
});

test('a 204 answer resolves to undefined', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  expect(await api.post('/api/x', {})).toBeUndefined();
});
