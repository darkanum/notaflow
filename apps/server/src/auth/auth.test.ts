import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('GET /api/me without a token is 401', async () => {
  const response = await t.app.inject({ method: 'GET', url: '/api/me' });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: 'unauthenticated' });
});

test('a token signed by another key is 401', async () => {
  const other = await createTestApp();
  const token = await other.tokenFor('a@example.com');
  await other.close();
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { 'cf-access-jwt-assertion': token },
  });
  expect(response.statusCode).toBe(401);
});

test('a valid token for an unknown email is 403 access_not_granted', async () => {
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: await t.as('x@example.com'),
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'access_not_granted' });
});

test('GET /api/me returns the user and accounts, with the email matched in any case', async () => {
  const a = seedTenant(t.db, { accountName: 'Vapulab', email: 'lincoln@example.com' });
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: await t.as('Lincoln@Example.com'),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    email: 'lincoln@example.com',
    name: 'lincoln',
    platformRole: 'user',
    accounts: [{ id: a.accountId, name: 'Vapulab', role: 'owner', status: 'active' }],
  });
});

test('a mutation without the app Origin is 403 bad_origin', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = { ...(await t.as('a@example.com')), origin: 'https://evil.example.com' };
  const response = await t.app.inject({ method: 'POST', url: '/api/me', headers, payload: {} });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'bad_origin' });
});

test('a mutation that is not JSON is 415 json_required', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = { ...(await t.as('a@example.com')), 'content-type': 'text/plain' };
  const response = await t.app.inject({ method: 'POST', url: '/api/me', headers, payload: 'x' });
  expect(response.statusCode).toBe(415);
  expect(response.json()).toEqual({ error: 'json_required' });
});

test('a rejected token is logged with a reason and without the token', async () => {
  const lines: string[] = [];
  const logged = await createTestApp({ logStream: { write: (line: string) => lines.push(line) } });
  const response = await logged.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { 'cf-access-jwt-assertion': 'not-a-jwt-secret-value' },
  });
  await logged.close();
  expect(response.statusCode).toBe(401);
  const warning = lines.find((line) => line.includes('access token rejected'));
  expect(warning).toBeDefined();
  expect(warning).toContain('"reason"');
  expect(lines.join(' ')).not.toContain('not-a-jwt-secret-value');
});
