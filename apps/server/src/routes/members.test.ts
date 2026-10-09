import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

test('an owner invites a member, who then sees the account', async () => {
  const a = seedTenant(t.db, { accountName: 'Vapulab', email: 'owner@example.com' });
  const invite = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await t.as('owner@example.com'),
    payload: { email: 'Contador@Example.com', name: 'Contador' },
  });
  expect(invite.statusCode).toBe(201);
  expect(invite.json()).toMatchObject({ created: true });
  const me = await t.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: await t.as('contador@example.com'),
  });
  expect(me.json()).toMatchObject({ accounts: [{ id: a.accountId, role: 'member' }] });
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({
    action: 'member.invite',
    accountId: a.accountId,
  });
});

test('inviting an existing member is 409 already_member', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const headers = await t.as('owner@example.com');
  const payload = { email: 'm@example.com', name: 'M' };
  const url = `/api/accounts/${a.accountId}/members`;
  await t.app.inject({ method: 'POST', url, headers, payload });
  const again = await t.app.inject({ method: 'POST', url, headers, payload });
  expect(again.statusCode).toBe(409);
});

test('a member cannot invite: 403 owner_only', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'member@example.com', role: 'member' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers: await t.as('member@example.com'),
    payload: { email: 'x@example.com', name: 'X' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'owner_only' });
});

test('a suspended account can list members but cannot invite', async () => {
  const a = seedTenant(t.db, {
    accountName: 'A',
    email: 'owner@example.com',
    status: 'suspended',
  });
  const headers = await t.as('owner@example.com');
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/members`,
    headers,
  });
  expect(list.statusCode).toBe(200);
  const invite = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/members`,
    headers,
    payload: { email: 'x@example.com', name: 'X' },
  });
  expect(invite.statusCode).toBe(403);
  expect(invite.json()).toEqual({ error: 'account_suspended' });
});
