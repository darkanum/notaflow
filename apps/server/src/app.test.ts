import { expect, test } from 'vitest';
import { seedUser } from '../test/fixtures';
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/openDatabase';

function devConfig(email: string) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: email,
  });
}

test('GET /api/health answers without authentication', async () => {
  const { db, close } = openDatabase(':memory:');
  const app = buildApp({ config: devConfig('dev@example.com'), db });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'ok' });
  await app.close();
  close();
});

test('dev mode authenticates every request as DEV_USER_EMAIL', async () => {
  const { db, close } = openDatabase(':memory:');
  seedUser(db, 'dev@example.com');
  const app = buildApp({ config: devConfig('Dev@Example.com'), db });
  const response = await app.inject({ method: 'GET', url: '/api/me' });
  expect(response.json()).toMatchObject({ email: 'dev@example.com' });
  await app.close();
  close();
});
