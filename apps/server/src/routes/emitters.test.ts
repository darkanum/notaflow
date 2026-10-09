import { makeTestCertificate } from '@notaflow/test-kit';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';
import { CertificateRepository } from '../repos/CertificateRepository';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const testCert = makeTestCertificate({ cnpj: '12345678000195' });
const body = (overrides: Record<string, unknown> = {}) => ({
  pfxBase64: testCert.pfx.toString('base64'),
  password: testCert.password,
  municipality: '3550308',
  simplesNacional: '1',
  specialRegime: '0',
  dpsSeries: '900',
  ...overrides,
});

async function onboard(accountId: string, email: string, payload = body()) {
  return t.app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/emitters`,
    headers: await t.as(email),
    payload,
  });
}

async function listEmitters(accountId: string, email: string) {
  return t.app.inject({
    method: 'GET',
    url: `/api/accounts/${accountId}/emitters`,
    headers: await t.as(email),
  });
}

test('an owner onboards an emitter: connection test, sealed certificate, producao_restrita', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await onboard(a.accountId, 'owner@example.com');
  expect(response.statusCode).toBe(201);
  const created = response.json<{ id: string; environment: string; cnpj: string }>();
  expect(created).toMatchObject({
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    environment: 'producao_restrita',
  });

  const stored = new CertificateRepository(t.db).activeFor(a, created.id);
  expect(stored?.pfxCiphertext.includes(testCert.pfx.subarray(0, 64))).toBe(false);
  expect(new AuditLog(t.db).list().map((e) => [e.action, e.result])).toEqual([
    ['emitter.create', 'ok'],
    ['certificate.upload', 'ok'],
  ]);

  const list = await listEmitters(a.accountId, 'owner@example.com');
  expect(list.json()).toEqual([
    expect.objectContaining({
      id: created.id,
      cnpj: '12345678000195',
      environment: 'producao_restrita',
      certificate: { validTo: expect.any(String), expiresSoon: false },
    }),
  ]);
});

test('a wrong password is 400 WRONG_PASSWORD and the response does not echo it', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await onboard(
    a.accountId,
    'owner@example.com',
    body({ password: 'senha-errada-123' }),
  );
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'WRONG_PASSWORD' });
  expect(response.body).not.toContain('senha-errada-123');
});

test('a CNPJ of another account is 409, nothing is stored, and the refusal is audited', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  expect((await onboard(a.accountId, 'a@example.com')).statusCode).toBe(201);
  const response = await onboard(b.accountId, 'b@example.com');
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: 'cnpj_in_other_account' });
  expect((await listEmitters(b.accountId, 'b@example.com')).json()).toEqual([]);
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    accountId: b.accountId,
    result: 'refused',
  });
});

test('the same CNPJ twice in one account is 409 emitter_exists', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  await onboard(a.accountId, 'a@example.com');
  const again = await onboard(a.accountId, 'a@example.com');
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({ error: 'emitter_exists' });
});

test('a failed connection test is 502 and stores nothing', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  t.fake.next('convenio', { kind: 'reply', status: 503, body: 'down' });
  const response = await onboard(a.accountId, 'a@example.com');
  expect(response.statusCode).toBe(502);
  expect(response.json()).toMatchObject({ error: 'connection_test_failed' });
  expect((await listEmitters(a.accountId, 'a@example.com')).json()).toEqual([]);
  expect((await onboard(a.accountId, 'a@example.com')).statusCode).toBe(201);
});

test('a certificate that expires in less than 30 days is flagged', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const soon = makeTestCertificate({
    cnpj: 'AB345678000195',
    notAfter: new Date(Date.now() + 10 * 86_400_000),
  });
  await onboard(
    a.accountId,
    'a@example.com',
    body({ pfxBase64: soon.pfx.toString('base64'), password: soon.password }),
  );
  expect((await listEmitters(a.accountId, 'a@example.com')).json()).toEqual([
    expect.objectContaining({ certificate: expect.objectContaining({ expiresSoon: true }) }),
  ]);
});

test('a member cannot onboard: 403 owner_only', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'm@example.com', role: 'member' });
  expect((await onboard(a.accountId, 'm@example.com')).statusCode).toBe(403);
});
