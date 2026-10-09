import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './config';

const KEY = Buffer.alloc(32, 7).toString('base64');
const base = {
  NODE_ENV: 'production',
  DATABASE_PATH: 'data/notaflow.db',
  APP_ORIGIN: 'https://nfse.example.com',
  NFSE_MASTER_KEY: KEY,
  AUTH_MODE: 'access',
  CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud-123',
};

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
}

test('reads a production configuration with Cloudflare Access', () => {
  const config = loadConfig(base);
  expect(config).toMatchObject({
    nodeEnv: 'production',
    host: '127.0.0.1',
    port: 3000,
    appOrigin: 'https://nfse.example.com',
    auth: { mode: 'access', teamDomain: 'example.cloudflareaccess.com', audience: 'aud-123' },
  });
  expect(config.masterKey).toEqual(Buffer.alloc(32, 7));
  expect(config.nacionalUrls).toBeUndefined();
});

test('refuses AUTH_MODE=dev in production', () => {
  expect(problemsOf({ ...base, AUTH_MODE: 'dev', DEV_USER_EMAIL: 'a@b.c' })).toContain(
    'AUTH_MODE=dev is not allowed with NODE_ENV=production',
  );
});

test('refuses the fake national system in production', () => {
  expect(problemsOf({ ...base, NACIONAL_FAKE_URL: 'http://127.0.0.1:4010' })).toContain(
    'NACIONAL_FAKE_URL is not allowed with NODE_ENV=production',
  );
});

test('dev mode needs DEV_USER_EMAIL and lower-cases it', () => {
  const dev = { ...base, NODE_ENV: 'development', AUTH_MODE: 'dev' };
  expect(problemsOf(dev)).toContain('DEV_USER_EMAIL is required with AUTH_MODE=dev');
  expect(loadConfig({ ...dev, DEV_USER_EMAIL: 'Dev@Example.com' }).auth).toEqual({
    mode: 'dev',
    email: 'dev@example.com',
  });
});

test('the fake URL becomes the Sefin and ADN base URLs', () => {
  const config = loadConfig({
    ...base,
    NODE_ENV: 'development',
    NACIONAL_FAKE_URL: 'http://127.0.0.1:4010',
  });
  expect(config.nacionalUrls).toEqual({
    sefin: 'http://127.0.0.1:4010/SefinNacional',
    adn: 'http://127.0.0.1:4010/adn',
  });
});

test('lists every problem at once', () => {
  const problems = problemsOf({ NODE_ENV: 'production', NFSE_MASTER_KEY: 'c2hvcnQ=' });
  expect(problems).toEqual(
    expect.arrayContaining([
      'DATABASE_PATH is required',
      'APP_ORIGIN is required',
      'NFSE_MASTER_KEY must be 32 bytes in base64',
      'AUTH_MODE must be access or dev',
    ]),
  );
});
