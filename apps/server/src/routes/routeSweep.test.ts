import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { EmitterRepository } from '../repos/EmitterRepository';

let t: TestApp;
let params: Record<string, string>;

beforeAll(async () => {
  t = await createTestApp();
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  seedUser(t.db, 'admin@example.com', 'admin');
  const emitter = new EmitterRepository(t.db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  params = { accountId: a.accountId, emitterId: emitter.id, userId: a.userId };
});
afterAll(() => t.close());

const PUBLIC = new Set(['GET /api/health']);

function fill(url: string): string {
  return url.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (!value) throw new Error(`The sweep has no value for :${name}; add it to params.`);
    return value;
  });
}

function bodyFor(method: string) {
  return method === 'GET' ? {} : { payload: {} };
}

describe('every /api route', () => {
  test('the sweep sees the routes of this plan', () => {
    const urls = t.app.routeList.map((r) => `${r.method} ${r.url}`);
    expect(urls).toEqual(
      expect.arrayContaining([
        'GET /api/me',
        'POST /api/admin/accounts',
        'POST /api/accounts/:accountId/emitters',
        'POST /api/accounts/:accountId/emitters/:emitterId/environment',
      ]),
    );
  });

  test('requires authentication', async () => {
    for (const route of t.app.routeList) {
      if (!route.url.startsWith('/api/') || PUBLIC.has(`${route.method} ${route.url}`)) continue;
      const response = await t.app.inject({ method: route.method as 'GET', url: fill(route.url) });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  test('answers 404 to a user of another account, on every account route', async () => {
    const headers = await t.as('b@example.com');
    const routes = t.app.routeList.filter((r) => r.url.startsWith('/api/accounts/:accountId'));
    for (const route of routes) {
      const response = await t.app.inject({
        method: route.method as 'GET',
        url: fill(route.url),
        headers,
        ...bodyFor(route.method),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(404);
    }
  });

  test('answers 403 admin_only to an account owner, on every admin route', async () => {
    const headers = await t.as('a@example.com');
    for (const route of t.app.routeList.filter((r) => r.url.startsWith('/api/admin/'))) {
      const response = await t.app.inject({
        method: route.method as 'GET',
        url: fill(route.url),
        headers,
        ...bodyFor(route.method),
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });

  test('a platform admin without a membership gets 404 on account routes', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: fill('/api/accounts/:accountId/emitters'),
      headers: await t.as('admin@example.com'),
    });
    expect(response.statusCode).toBe(404);
  });
});
