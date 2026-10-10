import type { AccountContext } from '@notaflow/core';
import { makeTestCertificate } from '@notaflow/test-kit';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { MemberRepository } from '../repos/MemberRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function onboarded() {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as('owner@example.com'),
    payload: {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '3550308',
      simplesNacional: '1',
      specialRegime: '0',
      dpsSeries: '900',
    },
  });
  return { a, emitterId: response.json<{ id: string }>().id };
}

test('POST sync runs the sync and GET shows the state', async () => {
  const { a, emitterId } = await onboarded();
  await issueOnFake(t.fake, 2);
  const url = `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`;
  const headers = await t.as('owner@example.com');
  const run = await t.app.inject({ method: 'POST', url, headers, payload: {} });
  expect(run.statusCode).toBe(200);
  expect(run.json()).toMatchObject({ invoices: 2, lastNsu: 2, error: null });
  const state = await t.app.inject({ method: 'GET', url, headers });
  expect(state.json()).toMatchObject({
    environment: 'producao',
    lastNsu: 2,
    lastError: null,
    running: false,
  });
});

test('a member can sync too', async () => {
  const { a, emitterId } = await onboarded();
  new MemberRepository(t.db).invite(a, 'member@example.com', 'Member');
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`,
    headers: await t.as('member@example.com'),
    payload: {},
  });
  expect(response.statusCode).toBe(200);
});

test('an emitter of another account is 404', async () => {
  const { emitterId } = await onboarded();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${b.accountId}/emitters/${emitterId}/sync`,
    headers: await t.as('b@example.com'),
    payload: {},
  });
  expect(response.statusCode).toBe(404);
});

test('onboarding starts the first sync through onEmitterCreated', async () => {
  const created: string[] = [];
  const own = await createTestAppWith((_, emitterId) => created.push(emitterId));
  const a = seedTenant(own.db, { accountName: 'A', email: 'owner@example.com' });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const response = await own.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await own.as('owner@example.com'),
    payload: {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '3550308',
      simplesNacional: '1',
      specialRegime: '0',
      dpsSeries: '900',
    },
  });
  await own.close();
  expect(created).toEqual([response.json<{ id: string }>().id]);
});

async function createTestAppWith(
  onEmitterCreated: (ctx: AccountContext, emitterId: string) => void,
) {
  return createTestApp({ onEmitterCreated });
}

test('the test app retries a transient ADN error without the production delays', async () => {
  const { a, emitterId } = await onboarded();
  await issueOnFake(t.fake, 1);
  t.fake.next('dfe', { kind: 'reply', status: 503, body: 'busy' });
  const started = Date.now();
  const run = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`,
    headers: await t.as('owner@example.com'),
    payload: {},
  });
  expect(run.json()).toMatchObject({ invoices: 1, error: null });
  expect(Date.now() - started).toBeLessThan(800);
});
