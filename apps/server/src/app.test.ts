import { expect, test } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

test('GET /api/health answers without authentication', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: 'dev@example.com',
  });
  const app = buildApp({ config });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'ok' });
  await app.close();
});
