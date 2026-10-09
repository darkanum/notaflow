# Stage 1a-2 (Server Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the NotaFlow server foundation: a Fastify API on SQLite with Cloudflare Access authentication, accounts, users, roles, an encrypted certificate vault, emitter onboarding with a connection test, and an audit log.

**Architecture:** A new package `apps/server`. Fastify serves a JSON API under `/api`. Drizzle ORM maps a SQLite file (`better-sqlite3`). Every request under `/api` (except `/api/health`) is authenticated: in production by the Cloudflare Access JWT, in development by a fixed email. Every account-level query goes through a repository method that takes an `AccountContext`. Certificates are sealed with envelope encryption (AES-256-GCM, one data key per certificate, wrapped by `NFSE_MASTER_KEY`). Onboarding opens the `.pfx`, refuses a CNPJ of another account, runs the connection test through `InvoiceProvider.checkConnection` (Stage 1a-1), and only then stores anything.

**Tech Stack:** Node 22 or later, pnpm 10, TypeScript 5, Vitest 3, Fastify 5, `drizzle-orm` 0.45 and `drizzle-kit` 0.31, `better-sqlite3` 13, `jose` 6. Tests use `@notaflow/fake-nacional` and `@notaflow/test-kit`.

**Spec:** [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md), sections "Flow: onboard an emitter", "Data Model", "Security", and "Testing".

**Stage 1a split:** Plan [1a-1](PLAN_STAGE_1A_1_PROVIDER_READ.md) built the provider read side and the fake. This plan (1a-2) is the server foundation. Plan 1a-3 adds the invoice, event, customer, and sync tables, the sync job, the read API, the web UI, and the admin panel UI. This plan has no UI.

## Global Constraints

- Never use TypeScript non-null assertions (`value!`). ESLint enforces it.
- A credential never enters git or a log. Tests use `@notaflow/test-kit` certificates and synthetic data. The test CNPJ is `12345678000195`.
- From Stage 1a, every database query goes through a repository that requires the account context. The only exceptions are the identity lookup during authentication, the platform admin repository (which requires an `AdminContext`), and the seed command. Each exception says so in a one-line comment.
- Amounts are integer cents. Timestamps are UTC. A CNPJ is a 14-character string `[0-9A-Z]`.
- Emails are stored and compared in lower case.
- The server refuses to start with `AUTH_MODE=dev` and `NODE_ENV=production`, and with `NACIONAL_FAKE_URL` in production.
- Mutations require `Content-Type: application/json` and an `Origin` equal to `APP_ORIGIN`.
- A member of another account gets HTTP 404, never 403, so an account's existence does not leak. A platform admin has no access to an account's data by default.
- A new emitter always starts in `producao_restrita`.
- Scripts must run on Windows and Linux. No `VAR=value cmd` prefixes.
- Comments are a budget: one line, only the non-obvious why.
- Docs are in English, follow the writing standard, and contain no em dash character.
- Commits carry no AI attribution. Never pass `--no-verify`. On Lincoln's Windows machine, add the `gitleaks` folder to `PATH` before `git commit` (see the Stage 0 ledger).
- PRs target `production` (stacked on the previous feature branch while it is open). Tests run locally: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pytest services/signer-py`.

## Review Focus

1. Cloudflare Access sends the email with different case than the stored one (`Lincoln@Example.com`). Expected: the user is found, because emails are lower-cased on write and on lookup. Pinned in Task 5.
2. An owner uploads a `.pfx` whose CNPJ already belongs to another account. Expected: HTTP 409 `cnpj_in_other_account`, nothing stored, and an audit entry with result `refused`. Pinned in Task 7.
3. The connection test fails (the convênio call answers 503). Expected: HTTP 502 `connection_test_failed`, no emitter and no certificate stored, so the owner can retry the upload. Pinned in Task 7.
4. A suspended account. Expected: reads work, and every mutation in that account answers HTTP 403 `account_suspended`. Pinned in Task 6 (invite) and Task 8 (environment switch).
5. A wrong `.pfx` password or a tampered sealed certificate. Expected: the API answers HTTP 400 `WRONG_PASSWORD` without echoing the password; the vault throws `VaultError` and never returns bytes from a tampered or wrongly keyed blob. Pinned in Task 3 and Task 7.

---

## File Structure

```
apps/server/
  package.json, tsconfig.json, drizzle.config.ts, AGENTS.md, .env.example
  drizzle/                               generated SQL migrations (committed)
  src/
    config.ts                            loadConfig(env) and ConfigError
    app.ts                               buildApp(deps): routes, hooks, error handler
    httpError.ts                         HttpError and the error handler
    main.ts                              process entry: config, database, listen
    seed.ts                              seedAdmin and the seed:admin CLI
    db/schema.ts                         Drizzle tables
    db/openDatabase.ts                   opens SQLite and applies migrations
    vault/envelope.ts                    seal, open, sealCertificate, openCertificate, rewrapKey
    vault/VaultCertificateStore.ts       CertificateStore over the repository and the envelope
    auth/accessVerifier.ts               Cloudflare Access JWT check (jose)
    auth/authHook.ts                     identity resolution and the mutation guard
    auth/guards.ts                       adminContext, accountContext
    repos/IdentityRepository.ts          user and membership lookup for authentication
    repos/AdminRepository.ts             platform admin operations
    repos/MemberRepository.ts            account members (owner invites)
    repos/EmitterRepository.ts           emitters of one account
    repos/CertificateRepository.ts       sealed certificates of one account's emitters
    repos/AuditLog.ts                    append-only audit entries
    providers/providerFactory.ts         InvoiceProvider for an emitter
    routes/me.ts, routes/admin.ts, routes/members.ts, routes/emitters.ts
  test/
    testApp.ts                           app on an in-memory database, signed Access tokens, the fake
packages/core/src/
  domain/Tenancy.ts                      AccountRole, AccountContext, AdminContext
  ports/CertificateStore.ts              CertificateStore port
docs/ENGINEERING/ARCHITECTURE/
  TENANCY.md, CERTIFICATE_VAULT.md
```

---

### Task 1: Server package, configuration, and the health route

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`
- Create: `apps/server/src/config.ts`, `apps/server/src/config.test.ts`
- Create: `apps/server/src/httpError.ts`
- Create: `apps/server/src/app.ts`, `apps/server/src/app.test.ts`
- Modify: root `package.json` (`pnpm.onlyBuiltDependencies`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `loadConfig(env: Record<string, string | undefined>): Config`, `class ConfigError extends Error { problems: string[] }`
  - `interface Config { nodeEnv: 'development' | 'test' | 'production'; host: string; port: number; databasePath: string; appOrigin: string; masterKey: Buffer; auth: AuthConfig; nacionalUrls?: { sefin: string; adn: string } }`
  - `type AuthConfig = { mode: 'access'; teamDomain: string; audience: string } | { mode: 'dev'; email: string }`
  - `class HttpError extends Error { constructor(status: number, code: string, detail?: string) }`
  - `buildApp(deps: AppDeps): FastifyInstance`, with `interface AppDeps { config: Config }` (later tasks add fields)

- [ ] **Step 1: Create the package**

`apps/server/package.json`:

```json
{
  "name": "@notaflow/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@notaflow/core": "workspace:*",
    "@notaflow/provider-nacional": "workspace:*",
    "@notaflow/signer-node": "workspace:*",
    "better-sqlite3": "^13.0.3",
    "drizzle-orm": "^0.45.4",
    "fastify": "^5.12.5",
    "jose": "^6.2.12",
    "undici": "^7.2.0"
  },
  "devDependencies": {
    "@notaflow/fake-nacional": "workspace:*",
    "@notaflow/test-kit": "workspace:*",
    "@types/better-sqlite3": "^9.6.0",
    "drizzle-kit": "^0.31.11"
  }
}
```

`apps/server/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "drizzle.config.ts"] }
```

In the root `package.json`, change `pnpm.onlyBuiltDependencies` to `["better-sqlite3", "esbuild"]`.

Run: `pnpm install`
Expected: `better-sqlite3` builds or downloads its prebuilt binary with no error. Check with `node -e "require('X:/Projetos/notaflow/apps/server/node_modules/better-sqlite3')"` on Windows or the same path on Linux; no output means it loaded.

- [ ] **Step 2: Write the failing tests**

`apps/server/src/config.test.ts`:

```ts
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
```

`apps/server/src/app.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server`
Expected: FAIL, `./config` and `./app` do not exist.

- [ ] **Step 4: Implement the configuration**

`apps/server/src/config.ts`:

```ts
export type AuthConfig =
  | { mode: 'access'; teamDomain: string; audience: string }
  | { mode: 'dev'; email: string };

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databasePath: string;
  appOrigin: string;
  masterKey: Buffer;
  auth: AuthConfig;
  nacionalUrls?: { sefin: string; adn: string };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];
  const required = (name: string): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is required`);
    return value ?? '';
  };

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    problems.push('NODE_ENV must be development, test, or production');
  }
  const databasePath = required('DATABASE_PATH');
  const appOrigin = required('APP_ORIGIN');
  const masterKey = Buffer.from(env.NFSE_MASTER_KEY ?? '', 'base64');
  if (masterKey.length !== 32) problems.push('NFSE_MASTER_KEY must be 32 bytes in base64');

  let auth: AuthConfig = { mode: 'dev', email: '' };
  if (env.AUTH_MODE === 'access') {
    auth = {
      mode: 'access',
      teamDomain: required('CF_ACCESS_TEAM_DOMAIN'),
      audience: required('CF_ACCESS_AUD'),
    };
  } else if (env.AUTH_MODE === 'dev') {
    if (nodeEnv === 'production') problems.push('AUTH_MODE=dev is not allowed with NODE_ENV=production');
    if (!env.DEV_USER_EMAIL) problems.push('DEV_USER_EMAIL is required with AUTH_MODE=dev');
    auth = { mode: 'dev', email: (env.DEV_USER_EMAIL ?? '').toLowerCase() };
  } else {
    problems.push('AUTH_MODE must be access or dev');
  }

  const fake = env.NACIONAL_FAKE_URL;
  if (fake && nodeEnv === 'production') {
    problems.push('NACIONAL_FAKE_URL is not allowed with NODE_ENV=production');
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    nodeEnv: nodeEnv as Config['nodeEnv'],
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    databasePath,
    appOrigin,
    masterKey,
    auth,
    ...(fake ? { nacionalUrls: { sefin: `${fake}/SefinNacional`, adn: `${fake}/adn` } } : {}),
  };
}
```

- [ ] **Step 5: Implement the error type and the app**

`apps/server/src/httpError.ts`:

```ts
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

export function handleError(error: FastifyError | Error, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply
      .status(error.status)
      .send({ error: error.code, ...(error.detail ? { detail: error.detail } : {}) });
  }
  const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (status < 500) return reply.status(status).send({ error: 'bad_request', detail: error.message });
  reply.log.error({ err: error }, 'unhandled error');
  return reply.status(500).send({ error: 'internal_error' });
}
```

`apps/server/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { handleError } from './httpError';

export interface AppDeps {
  config: Config;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.config.nodeEnv !== 'test' });
  app.setErrorHandler(handleError);
  app.get('/api/health', async () => ({ status: 'ok' }));
  return app;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server package.json pnpm-lock.yaml
git commit -m "feat(server): Fastify app with configuration checks and a health route"
```

---

### Task 2: Database schema, migrations, and the test database

**Files:**
- Create: `apps/server/drizzle.config.ts`
- Create: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/db/openDatabase.ts`, `apps/server/src/db/openDatabase.test.ts`
- Create: `apps/server/drizzle/` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Tables `accounts`, `users`, `memberships`, `emitters`, `certificates`, `auditLog` (Drizzle objects in `src/db/schema.ts`).
  - `type Database = BetterSQLite3Database<typeof schema>`
  - `openDatabase(path: string): { db: Database; close(): void }` (applies every migration)

The tables follow the RFC "Data Model". Invoices, events, customers, and `sync_state` arrive in plan 1a-3, each with its own migration.

- [ ] **Step 1: Write the schema**

`apps/server/src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`);

export const accounts = sqliteTable('accounts', {
  id: id(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  plan: text('plan').notNull().default(''),
  createdAt: createdAt(),
});

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  platformRole: text('platform_role', { enum: ['admin', 'user'] }).notNull().default('user'),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
});

export const memberships = sqliteTable(
  'memberships',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    accountId: text('account_id').notNull().references(() => accounts.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('memberships_user_account').on(table.userId, table.accountId)],
);

export const emitters = sqliteTable('emitters', {
  id: id(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  cnpj: text('cnpj').notNull().unique(),
  companyName: text('company_name').notNull(),
  municipalRegistration: text('municipal_registration'),
  municipality: text('municipality').notNull(),
  simplesNacional: text('simples_nacional', { enum: ['1', '2', '3'] }).notNull(),
  simplesRegime: text('simples_regime', { enum: ['1', '2', '3'] }),
  specialRegime: text('special_regime').notNull(),
  provider: text('provider', { enum: ['nacional'] }).notNull().default('nacional'),
  environment: text('environment', { enum: ['producao', 'producao_restrita'] })
    .notNull()
    .default('producao_restrita'),
  dpsSeries: text('dps_series').notNull(),
  nextDpsNumber: integer('next_dps_number').notNull().default(1),
  createdAt: createdAt(),
});

export const certificates = sqliteTable('certificates', {
  id: id(),
  emitterId: text('emitter_id').notNull().references(() => emitters.id),
  pfxCiphertext: blob('pfx_ciphertext', { mode: 'buffer' }).notNull(),
  passwordCiphertext: blob('password_ciphertext', { mode: 'buffer' }).notNull(),
  wrappedKey: blob('wrapped_key', { mode: 'buffer' }).notNull(),
  cnpj: text('cnpj').notNull(),
  subject: text('subject').notNull(),
  validFrom: integer('valid_from', { mode: 'timestamp_ms' }).notNull(),
  validTo: integer('valid_to', { mode: 'timestamp_ms' }).notNull(),
  fingerprintSha256: text('fingerprint_sha256').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  uploadedAt: createdAt(),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userEmail: text('user_email').notNull(),
  accountId: text('account_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  result: text('result', { enum: ['ok', 'refused', 'error'] }).notNull(),
  detail: text('detail'),
  at: createdAt(),
});
```

`apps/server/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
```

- [ ] **Step 2: Generate the first migration**

Run: `pnpm --filter @notaflow/server exec drizzle-kit generate --name init`
Expected: `apps/server/drizzle/0000_init.sql` and `apps/server/drizzle/meta/` exist. Read the SQL: it creates the six tables, the unique index on `users.email`, `emitters.cnpj`, and `memberships(user_id, account_id)`.

- [ ] **Step 3: Write the failing test**

`apps/server/src/db/openDatabase.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDatabase } from './openDatabase';
import { accounts, emitters, users } from './schema';

test('applies the migrations to a new database', () => {
  const { db, close } = openDatabase(':memory:');
  const tables = db.$client
    .prepare("select name from sqlite_master where type = 'table'")
    .all() as { name: string }[];
  expect(tables.map((t) => t.name)).toEqual(
    expect.arrayContaining(['accounts', 'audit_log', 'certificates', 'emitters', 'memberships', 'users']),
  );
  close();
});

test('a CNPJ belongs to one emitter on the whole platform', () => {
  const { db, close } = openDatabase(':memory:');
  const a = randomUUID();
  const b = randomUUID();
  db.insert(accounts).values([{ id: a, name: 'A' }, { id: b, name: 'B' }]).run();
  const emitter = {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1' as const,
    specialRegime: '0',
    dpsSeries: '900',
  };
  db.insert(emitters).values({ id: randomUUID(), accountId: a, ...emitter }).run();
  expect(() => db.insert(emitters).values({ id: randomUUID(), accountId: b, ...emitter }).run()).toThrow(
    /UNIQUE/,
  );
  close();
});

test('an email belongs to one user', () => {
  const { db, close } = openDatabase(':memory:');
  db.insert(users).values({ id: randomUUID(), email: 'a@example.com', name: 'A' }).run();
  expect(() =>
    db.insert(users).values({ id: randomUUID(), email: 'a@example.com', name: 'B' }).run(),
  ).toThrow(/UNIQUE/);
  close();
});

test('foreign keys are enforced', () => {
  const { db, close } = openDatabase(':memory:');
  expect(() =>
    db.insert(emitters).values({
      id: randomUUID(),
      accountId: 'missing',
      cnpj: '12345678000195',
      companyName: 'X',
      municipality: '3550308',
      simplesNacional: '1',
      specialRegime: '0',
      dpsSeries: '900',
    }).run(),
  ).toThrow(/FOREIGN KEY/);
  close();
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run apps/server/src/db`
Expected: FAIL, `./openDatabase` does not exist.

- [ ] **Step 5: Implement `openDatabase`**

`apps/server/src/db/openDatabase.ts`:

```ts
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Database = BetterSQLite3Database<typeof schema> & { $client: BetterSqlite3.Database };

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function openDatabase(path: string): { db: Database; close(): void } {
  const client = new BetterSqlite3(path);
  client.pragma('journal_mode = WAL');
  // SQLite leaves foreign keys off unless every connection turns them on.
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS. If `Database` does not match the type `drizzle()` returns in this Drizzle version, use `ReturnType<typeof drizzle<typeof schema>>` and keep `$client` from it; record the change as a ruling.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): SQLite schema for tenancy, emitters, certificates, and audit"
```

---

### Task 3: Vault envelope encryption

**Files:**
- Create: `apps/server/src/vault/envelope.ts`, `apps/server/src/vault/envelope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class VaultError extends Error`
  - `seal(plaintext: Buffer, key: Buffer): Buffer` (layout `iv(12) | tag(16) | ciphertext`)
  - `open(sealed: Buffer, key: Buffer): Buffer` (throws `VaultError`)
  - `interface SealedCertificate { pfxCiphertext: Buffer; passwordCiphertext: Buffer; wrappedKey: Buffer }`
  - `sealCertificate(pfx: Buffer, password: string, masterKey: Buffer): SealedCertificate`
  - `openCertificate(sealed: SealedCertificate, masterKey: Buffer): { pfx: Buffer; password: string }`
  - `rewrapKey(wrappedKey: Buffer, oldMasterKey: Buffer, newMasterKey: Buffer): Buffer`

- [ ] **Step 1: Write the failing tests**

`apps/server/src/vault/envelope.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { open, openCertificate, rewrapKey, seal, sealCertificate, VaultError } from './envelope';

const master = randomBytes(32);

test('seal and open round-trip, with a new IV each time', () => {
  const data = Buffer.from('segredo ção');
  const a = seal(data, master);
  const b = seal(data, master);
  expect(a.equals(b)).toBe(false);
  expect(open(a, master).toString()).toBe('segredo ção');
});

test('open throws VaultError with the wrong key', () => {
  expect(() => open(seal(Buffer.from('x'), master), randomBytes(32))).toThrow(VaultError);
});

test('open throws VaultError on a tampered ciphertext', () => {
  const sealed = seal(Buffer.from('certificate bytes'), master);
  sealed[sealed.length - 1] ^= 0x01;
  expect(() => open(sealed, master)).toThrow(VaultError);
});

test('open throws VaultError on a blob too short to hold an IV and a tag', () => {
  expect(() => open(Buffer.alloc(10), master)).toThrow(VaultError);
});

test('sealCertificate uses a data key per certificate, wrapped by the master key', () => {
  const pfx = randomBytes(2000);
  const one = sealCertificate(pfx, 'senha-1', master);
  const two = sealCertificate(pfx, 'senha-1', master);
  expect(one.wrappedKey.equals(two.wrappedKey)).toBe(false);
  expect(one.pfxCiphertext.includes(pfx.subarray(0, 32))).toBe(false);
  expect(openCertificate(one, master)).toEqual({ pfx, password: 'senha-1' });
});

test('rewrapKey moves a certificate to a new master key without touching the ciphertexts', () => {
  const sealed = sealCertificate(Buffer.from('pfx'), 'senha', master);
  const next = randomBytes(32);
  const moved = { ...sealed, wrappedKey: rewrapKey(sealed.wrappedKey, master, next) };
  expect(openCertificate(moved, next)).toEqual({ pfx: Buffer.from('pfx'), password: 'senha' });
  expect(() => openCertificate(moved, master)).toThrow(VaultError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/vault`
Expected: FAIL, `./envelope` does not exist.

- [ ] **Step 3: Implement the envelope**

`apps/server/src/vault/envelope.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV = 12;
const TAG = 16;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export interface SealedCertificate {
  pfxCiphertext: Buffer;
  passwordCiphertext: Buffer;
  wrappedKey: Buffer;
}

export function seal(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function open(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < IV + TAG) throw new VaultError('Sealed data is too short.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
    decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
  } catch {
    // Never say which part failed: the key and a tampered blob look the same to a caller.
    throw new VaultError('Sealed data cannot be opened with this key.');
  }
}

export function sealCertificate(pfx: Buffer, password: string, masterKey: Buffer): SealedCertificate {
  const dataKey = randomBytes(32);
  return {
    pfxCiphertext: seal(pfx, dataKey),
    passwordCiphertext: seal(Buffer.from(password, 'utf8'), dataKey),
    wrappedKey: seal(dataKey, masterKey),
  };
}

export function openCertificate(
  sealed: SealedCertificate,
  masterKey: Buffer,
): { pfx: Buffer; password: string } {
  const dataKey = open(sealed.wrappedKey, masterKey);
  return {
    pfx: open(sealed.pfxCiphertext, dataKey),
    password: open(sealed.passwordCiphertext, dataKey).toString('utf8'),
  };
}

export function rewrapKey(wrappedKey: Buffer, oldMasterKey: Buffer, newMasterKey: Buffer): Buffer {
  return seal(open(wrappedKey, oldMasterKey), newMasterKey);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server/src/vault && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/vault
git commit -m "feat(server): envelope encryption for certificates with AES-256-GCM"
```

---

### Task 4: Tenancy types and the repositories

**Files:**
- Create: `packages/core/src/domain/Tenancy.ts`, `packages/core/src/ports/CertificateStore.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/AGENTS.md`
- Create: `apps/server/src/repos/IdentityRepository.ts`, `AdminRepository.ts`, `MemberRepository.ts`, `EmitterRepository.ts`, `CertificateRepository.ts`, `AuditLog.ts`
- Create: `apps/server/src/repos/repos.test.ts`
- Create: `apps/server/test/fixtures.ts`

**Interfaces:**
- Consumes: `openDatabase`, `Database`, the tables (Task 2); `SealedCertificate` (Task 3); `Environment`, `CertificateMaterial` from `@notaflow/core`.
- Produces (core):
  - `type AccountRole = 'owner' | 'member'`
  - `interface AccountContext { accountId: string; userId: string; role: AccountRole; accountStatus: 'active' | 'suspended' }`
  - `interface AdminContext { userId: string; admin: true }`
  - `interface CertificateStore { loadActive(context: AccountContext, emitterId: string): Promise<CertificateMaterial | null> }`
- Produces (server):
  - `IdentityRepository`: `findByEmail(email): Identity | null`, `touchLogin(userId): void`; `interface Identity { userId; email; name; platformRole: 'admin' | 'user'; memberships: { accountId; accountName; role: AccountRole; accountStatus: 'active' | 'suspended' }[] }`
  - `AdminRepository`: `listAccounts(ctx)`, `createAccount(ctx, name): string`, `setAccountStatus(ctx, accountId, status): boolean`, `createUser(ctx, email, name): string | null` (null when the email exists), `setMembership(ctx, accountId, userId, role): boolean`
  - `MemberRepository`: `list(ctx)`, `invite(ctx, email, name): { userId: string; created: boolean } | null` (null when already a member)
  - `EmitterRepository`: `list(ctx)`, `get(ctx, emitterId): EmitterRow | null`, `isCnpjTakenElsewhere(ctx, cnpj): boolean`, `findByCnpj(ctx, cnpj): EmitterRow | null`, `create(ctx, input: NewEmitter): EmitterRow`, `setEnvironment(ctx, emitterId, environment): boolean`
  - `CertificateRepository`: `addActive(ctx, emitterId, sealed, meta): string`, `activeFor(ctx, emitterId): CertificateRow | null`
  - `AuditLog`: `record(entry: { userEmail; accountId: string | null; action; entity; result: 'ok' | 'refused' | 'error'; detail?: string }): void`, `list(): AuditRow[]` (tests and the admin panel of plan 1a-3 read it)
  - `test/fixtures.ts`: `seedTenant(db, input)` to create an account, a user, and a membership for tests

Every method of `EmitterRepository`, `CertificateRepository`, and `MemberRepository` filters by `ctx.accountId`. A row of another account is `null` or `false`, never an error, so routes can answer 404.

- [ ] **Step 1: Add the core types**

`packages/core/src/domain/Tenancy.ts`:

```ts
export type AccountRole = 'owner' | 'member';

// Built only by the server's guards, after the membership check.
export interface AccountContext {
  accountId: string;
  userId: string;
  role: AccountRole;
  accountStatus: 'active' | 'suspended';
}

export interface AdminContext {
  userId: string;
  admin: true;
}
```

`packages/core/src/ports/CertificateStore.ts`:

```ts
import type { AccountContext } from '../domain/Tenancy';
import type { CertificateMaterial } from './Signer';

export interface CertificateStore {
  loadActive(context: AccountContext, emitterId: string): Promise<CertificateMaterial | null>;
}
```

Add to `packages/core/src/index.ts`:

```ts
export type { AccountContext, AccountRole, AdminContext } from './domain/Tenancy';
export type { CertificateStore } from './ports/CertificateStore';
```

In `packages/core/AGENTS.md`, change the ports line to say `CertificateStore` (`src/ports/CertificateStore.ts`) exists, and add `Tenancy` (`src/domain/Tenancy.ts`) to the domain line.

- [ ] **Step 2: Write the test fixtures and the failing tests**

`apps/server/test/fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { AccountContext, AccountRole, AdminContext } from '@notaflow/core';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/openDatabase';
import { accounts, memberships, users } from '../src/db/schema';

export function seedUser(db: Database, email: string, platformRole: 'admin' | 'user' = 'user'): string {
  const id = randomUUID();
  db.insert(users).values({ id, email: email.toLowerCase(), name: email.split('@')[0] ?? email, platformRole }).run();
  return id;
}

export function seedTenant(
  db: Database,
  input: { accountName: string; email: string; role?: AccountRole; status?: 'active' | 'suspended' },
): AccountContext {
  const accountId = randomUUID();
  db.insert(accounts).values({ id: accountId, name: input.accountName, status: input.status ?? 'active' }).run();
  const existing = db.select().from(users).where(eq(users.email, input.email.toLowerCase())).get();
  const userId = existing?.id ?? seedUser(db, input.email);
  const role = input.role ?? 'owner';
  db.insert(memberships).values({ id: randomUUID(), userId, accountId, role }).run();
  return { accountId, userId, role, accountStatus: input.status ?? 'active' };
}

export function adminOf(userId: string): AdminContext {
  return { userId, admin: true };
}
```

`apps/server/src/repos/repos.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { adminOf, seedTenant, seedUser } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { sealCertificate } from '../vault/envelope';
import { AdminRepository } from './AdminRepository';
import { AuditLog } from './AuditLog';
import { CertificateRepository } from './CertificateRepository';
import { EmitterRepository } from './EmitterRepository';
import { IdentityRepository } from './IdentityRepository';
import { MemberRepository } from './MemberRepository';

let db: Database;
let close: () => void;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

const newEmitter = {
  cnpj: '12345678000195',
  companyName: 'EMPRESA TESTE LTDA',
  municipality: '3550308',
  simplesNacional: '1' as const,
  specialRegime: '0',
  dpsSeries: '900',
};
const certMeta = {
  cnpj: '12345678000195',
  subject: 'CN=EMPRESA TESTE LTDA:12345678000195',
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2027-01-01T00:00:00Z'),
  fingerprintSha256: 'ab'.repeat(32),
  uploadedBy: '',
};

describe('IdentityRepository', () => {
  test('finds a user by email in any case, with memberships', () => {
    const a = seedTenant(db, { accountName: 'Vapulab', email: 'lincoln@example.com' });
    const identity = new IdentityRepository(db).findByEmail('Lincoln@Example.COM');
    expect(identity).toMatchObject({
      userId: a.userId,
      email: 'lincoln@example.com',
      platformRole: 'user',
      memberships: [{ accountId: a.accountId, accountName: 'Vapulab', role: 'owner', accountStatus: 'active' }],
    });
  });

  test('an unknown email is null', () => {
    expect(new IdentityRepository(db).findByEmail('nobody@example.com')).toBeNull();
  });
});

describe('EmitterRepository and CertificateRepository isolation', () => {
  test('an account never reads or changes another account emitter', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
    const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
    const emitters = new EmitterRepository(db);
    const emitter = emitters.create(a, newEmitter);
    expect(emitter.environment).toBe('producao_restrita');
    expect(emitters.list(a)).toHaveLength(1);
    expect(emitters.list(b)).toEqual([]);
    expect(emitters.get(b, emitter.id)).toBeNull();
    expect(emitters.setEnvironment(b, emitter.id, 'producao')).toBe(false);
    expect(emitters.get(a, emitter.id)?.environment).toBe('producao_restrita');
  });

  test('isCnpjTakenElsewhere is true only for a CNPJ of another account', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
    const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
    new EmitterRepository(db).create(a, newEmitter);
    expect(new EmitterRepository(db).isCnpjTakenElsewhere(b, '12345678000195')).toBe(true);
    expect(new EmitterRepository(db).isCnpjTakenElsewhere(a, '12345678000195')).toBe(false);
  });

  test('a new active certificate deactivates the previous one, and other accounts see none', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
    const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
    const emitter = new EmitterRepository(db).create(a, newEmitter);
    const certs = new CertificateRepository(db);
    const sealed = sealCertificate(Buffer.from('pfx'), 'senha', Buffer.alloc(32, 1));
    const first = certs.addActive(a, emitter.id, sealed, { ...certMeta, uploadedBy: a.userId });
    const second = certs.addActive(a, emitter.id, sealed, { ...certMeta, uploadedBy: a.userId });
    expect(certs.activeFor(a, emitter.id)?.id).toBe(second);
    expect(certs.activeFor(a, emitter.id)?.id).not.toBe(first);
    expect(certs.activeFor(b, emitter.id)).toBeNull();
    expect(() => certs.addActive(b, emitter.id, sealed, { ...certMeta, uploadedBy: b.userId })).toThrow(
      /not found/,
    );
  });
});

describe('MemberRepository', () => {
  test('invite creates the user once and adds a member', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'owner@example.com' });
    const members = new MemberRepository(db);
    const first = members.invite(a, 'New@Example.com', 'New');
    expect(first).toMatchObject({ created: true });
    expect(members.invite(a, 'new@example.com', 'New')).toBeNull();
    expect(members.list(a).map((m) => [m.email, m.role])).toEqual(
      expect.arrayContaining([
        ['owner@example.com', 'owner'],
        ['new@example.com', 'member'],
      ]),
    );
  });
});

describe('AdminRepository', () => {
  test('creates accounts and users, sets memberships, and suspends', () => {
    const admin = adminOf(seedUser(db, 'admin@example.com', 'admin'));
    const repo = new AdminRepository(db);
    const accountId = repo.createAccount(admin, 'Vapulab');
    const userId = repo.createUser(admin, 'Owner@Example.com', 'Owner');
    expect(userId).toEqual(expect.any(String));
    expect(repo.createUser(admin, 'owner@example.com', 'Again')).toBeNull();
    expect(repo.setMembership(admin, accountId, userId ?? '', 'owner')).toBe(true);
    expect(repo.setAccountStatus(admin, accountId, 'suspended')).toBe(true);
    expect(repo.setAccountStatus(admin, 'missing', 'suspended')).toBe(false);
    expect(repo.listAccounts(admin)).toEqual([
      expect.objectContaining({ id: accountId, name: 'Vapulab', status: 'suspended', members: 1 }),
    ]);
  });
});

describe('AuditLog', () => {
  test('records entries in order', () => {
    const log = new AuditLog(db);
    log.record({ userEmail: 'a@example.com', accountId: null, action: 'account.create', entity: 'x', result: 'ok' });
    log.record({ userEmail: 'a@example.com', accountId: null, action: 'user.create', entity: 'y', result: 'refused', detail: 'exists' });
    expect(log.list().map((e) => [e.action, e.result])).toEqual([
      ['account.create', 'ok'],
      ['user.create', 'refused'],
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/repos`
Expected: FAIL, the repository modules do not exist.

- [ ] **Step 4: Implement the repositories**

`apps/server/src/repos/IdentityRepository.ts`:

```ts
import type { AccountRole } from '@notaflow/core';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, memberships, users } from '../db/schema';

export interface Identity {
  userId: string;
  email: string;
  name: string;
  platformRole: 'admin' | 'user';
  memberships: {
    accountId: string;
    accountName: string;
    role: AccountRole;
    accountStatus: 'active' | 'suspended';
  }[];
}

// Authentication runs before any account context exists, so this lookup is not account-scoped.
export class IdentityRepository {
  constructor(private readonly db: Database) {}

  findByEmail(email: string): Identity | null {
    const user = this.db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
    if (!user) return null;
    const rows = this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        role: memberships.role,
        accountStatus: accounts.status,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(eq(memberships.userId, user.id))
      .all();
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      memberships: rows,
    };
  }

  touchLogin(userId: string): void {
    this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)).run();
  }
}
```

`apps/server/src/repos/AdminRepository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { AccountRole, AdminContext } from '@notaflow/core';
import { count, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, memberships, users } from '../db/schema';

// Platform scope: every method needs an AdminContext, which only the admin guard builds.
export class AdminRepository {
  constructor(private readonly db: Database) {}

  listAccounts(_ctx: AdminContext) {
    return this.db
      .select({
        id: accounts.id,
        name: accounts.name,
        status: accounts.status,
        plan: accounts.plan,
        members: count(memberships.id),
      })
      .from(accounts)
      .leftJoin(memberships, eq(memberships.accountId, accounts.id))
      .groupBy(accounts.id)
      .orderBy(accounts.name)
      .all();
  }

  createAccount(_ctx: AdminContext, name: string): string {
    const id = randomUUID();
    this.db.insert(accounts).values({ id, name }).run();
    return id;
  }

  setAccountStatus(_ctx: AdminContext, accountId: string, status: 'active' | 'suspended'): boolean {
    return this.db.update(accounts).set({ status }).where(eq(accounts.id, accountId)).run().changes > 0;
  }

  createUser(_ctx: AdminContext, email: string, name: string): string | null {
    const normalized = email.toLowerCase();
    if (this.db.select().from(users).where(eq(users.email, normalized)).get()) return null;
    const id = randomUUID();
    this.db.insert(users).values({ id, email: normalized, name }).run();
    return id;
  }

  setMembership(_ctx: AdminContext, accountId: string, userId: string, role: AccountRole): boolean {
    const account = this.db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!account || !user) return false;
    this.db
      .insert(memberships)
      .values({ id: randomUUID(), accountId, userId, role })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.accountId], set: { role } })
      .run();
    return true;
  }
}
```

`apps/server/src/repos/MemberRepository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { memberships, users } from '../db/schema';

export class MemberRepository {
  constructor(private readonly db: Database) {}

  list(ctx: AccountContext) {
    return this.db
      .select({ userId: users.id, email: users.email, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.accountId, ctx.accountId))
      .orderBy(users.email)
      .all();
  }

  invite(ctx: AccountContext, email: string, name: string): { userId: string; created: boolean } | null {
    const normalized = email.toLowerCase();
    return this.db.transaction((tx) => {
      const existing = tx.select().from(users).where(eq(users.email, normalized)).get();
      const userId = existing?.id ?? randomUUID();
      if (!existing) tx.insert(users).values({ id: userId, email: normalized, name }).run();
      const member = tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.accountId, ctx.accountId), eq(memberships.userId, userId)))
        .get();
      if (member) return null;
      tx.insert(memberships).values({ id: randomUUID(), accountId: ctx.accountId, userId, role: 'member' }).run();
      return { userId, created: !existing };
    });
  }
}
```

`apps/server/src/repos/EmitterRepository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { AccountContext, Environment } from '@notaflow/core';
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters } from '../db/schema';

export type EmitterRow = typeof emitters.$inferSelect;
export type NewEmitter = Omit<
  typeof emitters.$inferInsert,
  'id' | 'accountId' | 'environment' | 'provider' | 'nextDpsNumber' | 'createdAt'
>;

export class EmitterRepository {
  constructor(private readonly db: Database) {}

  list(ctx: AccountContext): EmitterRow[] {
    return this.db.select().from(emitters).where(eq(emitters.accountId, ctx.accountId)).all();
  }

  get(ctx: AccountContext, emitterId: string): EmitterRow | null {
    return (
      this.db
        .select()
        .from(emitters)
        .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
        .get() ?? null
    );
  }

  findByCnpj(ctx: AccountContext, cnpj: string): EmitterRow | null {
    return (
      this.db
        .select()
        .from(emitters)
        .where(and(eq(emitters.cnpj, cnpj), eq(emitters.accountId, ctx.accountId)))
        .get() ?? null
    );
  }

  // Answers only yes or no, so a caller learns nothing else about the other account.
  isCnpjTakenElsewhere(ctx: AccountContext, cnpj: string): boolean {
    return (
      this.db
        .select({ id: emitters.id })
        .from(emitters)
        .where(and(eq(emitters.cnpj, cnpj), ne(emitters.accountId, ctx.accountId)))
        .get() !== undefined
    );
  }

  create(ctx: AccountContext, input: NewEmitter): EmitterRow {
    return this.db
      .insert(emitters)
      .values({ ...input, id: randomUUID(), accountId: ctx.accountId })
      .returning()
      .get();
  }

  setEnvironment(ctx: AccountContext, emitterId: string, environment: Environment): boolean {
    return (
      this.db
        .update(emitters)
        .set({ environment })
        .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
        .run().changes > 0
    );
  }
}
```

`apps/server/src/repos/CertificateRepository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { AccountContext } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { certificates, emitters } from '../db/schema';
import type { SealedCertificate } from '../vault/envelope';

export type CertificateRow = typeof certificates.$inferSelect;

export interface CertificateMeta {
  cnpj: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
  fingerprintSha256: string;
  uploadedBy: string;
}

export class CertificateRepository {
  constructor(private readonly db: Database) {}

  addActive(ctx: AccountContext, emitterId: string, sealed: SealedCertificate, meta: CertificateMeta): string {
    return this.db.transaction((tx) => {
      const emitter = tx
        .select({ id: emitters.id })
        .from(emitters)
        .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
        .get();
      if (!emitter) throw new Error('Emitter not found in this account.');
      tx.update(certificates).set({ active: false }).where(eq(certificates.emitterId, emitterId)).run();
      const id = randomUUID();
      tx.insert(certificates).values({ id, emitterId, ...sealed, ...meta, active: true }).run();
      return id;
    });
  }

  activeFor(ctx: AccountContext, emitterId: string): CertificateRow | null {
    const row = this.db
      .select({ certificate: certificates })
      .from(certificates)
      .innerJoin(emitters, eq(emitters.id, certificates.emitterId))
      .where(
        and(
          eq(certificates.emitterId, emitterId),
          eq(certificates.active, true),
          eq(emitters.accountId, ctx.accountId),
        ),
      )
      .get();
    return row?.certificate ?? null;
  }
}
```

`apps/server/src/repos/AuditLog.ts`:

```ts
import { asc } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  userEmail: string;
  accountId: string | null;
  action: string;
  entity: string;
  result: 'ok' | 'refused' | 'error';
  detail?: string;
}

// Append-only and written by the platform itself, so it takes no account context.
export class AuditLog {
  constructor(private readonly db: Database) {}

  record(entry: AuditEntry): void {
    this.db.insert(auditLog).values({ ...entry, detail: entry.detail ?? null }).run();
  }

  list() {
    return this.db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server packages/core && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/server
git commit -m "feat(server): account-scoped repositories, the admin repository, and the audit log"
```

---

### Task 5: Authentication, the mutation guard, and `GET /api/me`

**Files:**
- Create: `apps/server/src/auth/accessVerifier.ts`
- Create: `apps/server/src/auth/authHook.ts`
- Create: `apps/server/src/auth/guards.ts`
- Create: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/server/test/testApp.ts`
- Create: `apps/server/src/auth/auth.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1); `Database`, `openDatabase` (Task 2); `IdentityRepository`, `Identity`, `seedTenant`, `seedUser` (Task 4); `AccountContext`, `AdminContext` from core.
- Produces:
  - `type VerifyAccessToken = (token: string) => Promise<string>` (returns the lower-cased email, throws on any invalid token)
  - `createAccessVerifier(options: { issuer: string; audience: string; jwks: JWTVerifyGetKey }): VerifyAccessToken`
  - `remoteAccessVerifier(teamDomain: string, audience: string): VerifyAccessToken`
  - `AppDeps` grows to `{ config: Config; db: Database; verifyAccessToken?: VerifyAccessToken; providerFactory?: ProviderFactory }` (`ProviderFactory` arrives in Task 7; until then leave the field out)
  - `request.identity: Identity | null` (Fastify request decoration)
  - `adminContext(request): AdminContext` (403 `admin_only`)
  - `accountContext(request, accountId, options?: { owner?: boolean; write?: boolean }): AccountContext` (404 `not_found`, 403 `owner_only`, 403 `account_suspended`)
  - `app.routeList: { method: string; url: string }[]` (Fastify instance decoration, used by the sweep in Task 9)
  - `test/testApp.ts`: `createTestApp(options?): Promise<TestApp>` with `{ app, db, fake, tokenFor(email): Promise<string>, as(email): HeadersFor, close() }`

Authentication rules (RFC "Authentication and authorization"):
- Every `/api` route except `/api/health` needs an identity.
- `AUTH_MODE=access`: the token is the `Cf-Access-Jwt-Assertion` header. Invalid or missing: 401 `unauthenticated`.
- `AUTH_MODE=dev`: the identity is `DEV_USER_EMAIL`.
- An email not in `users`: 403 `access_not_granted`.
- `POST`, `PUT`, `PATCH`, `DELETE` need `Content-Type: application/json` (else 415 `json_required`) and `Origin` equal to `APP_ORIGIN` (else 403 `bad_origin`).

- [ ] **Step 1: Add the dependency and write the test harness**

`jose` is already in `apps/server/package.json` (Task 1).

`apps/server/test/testApp.ts`:

```ts
import { type FakeNacional, startFakeNacional } from '@notaflow/fake-nacional';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/app';
import { createAccessVerifier } from '../src/auth/accessVerifier';
import { loadConfig } from '../src/config';
import { type Database, openDatabase } from '../src/db/openDatabase';

export const ORIGIN = 'http://localhost:3000';
const ISSUER = 'https://test.cloudflareaccess.com';
const AUDIENCE = 'test-aud';

export interface TestApp {
  app: FastifyInstance;
  db: Database;
  fake: FakeNacional;
  tokenFor(email: string): Promise<string>;
  as(email: string): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const fake = await startFakeNacional();
  const { db, close } = openDatabase(':memory:');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: ORIGIN,
    NFSE_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    AUTH_MODE: 'access',
    CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
    CF_ACCESS_AUD: AUDIENCE,
    NACIONAL_FAKE_URL: fake.urls.sefin.replace('/SefinNacional', ''),
  });
  const app = buildApp({
    config,
    db,
    verifyAccessToken: createAccessVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks }),
  });
  await app.ready();

  const tokenFor = (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  return {
    app,
    db,
    fake,
    tokenFor,
    as: async (email) => ({
      'cf-access-jwt-assertion': await tokenFor(email),
      origin: ORIGIN,
      'content-type': 'application/json',
    }),
    close: async () => {
      await app.close();
      close();
      await fake.close();
    },
  };
}
```

Plan note: `as(email)` returns headers that satisfy every guard, so a test that checks one guard removes or changes only that header.

- [ ] **Step 2: Write the failing tests**

`apps/server/src/auth/auth.test.ts`:

```ts
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
  const response = await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('x@example.com') });
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
```

The last two tests post to `/api/me`, which has no POST route. The guard runs in `onRequest`, before routing to a handler, so the guard answers first; without the guard the answer would be 404. That proves the guard runs for every mutation, including one to a route that does not exist.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/auth`
Expected: FAIL, the auth modules do not exist.

- [ ] **Step 4: Implement the verifier, the hook, the guards, and the route**

`apps/server/src/auth/accessVerifier.ts`:

```ts
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

export type VerifyAccessToken = (token: string) => Promise<string>;

export function createAccessVerifier(options: {
  issuer: string;
  audience: string;
  jwks: JWTVerifyGetKey;
}): VerifyAccessToken {
  return async (token) => {
    const { payload } = await jwtVerify(token, options.jwks, {
      issuer: options.issuer,
      audience: options.audience,
    });
    if (typeof payload.email !== 'string' || payload.email === '') {
      throw new Error('The Access token has no email.');
    }
    return payload.email.toLowerCase();
  };
}

export function remoteAccessVerifier(teamDomain: string, audience: string): VerifyAccessToken {
  const issuer = `https://${teamDomain}`;
  return createAccessVerifier({
    issuer,
    audience,
    jwks: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
  });
}
```

`apps/server/src/auth/authHook.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { HttpError } from '../httpError';
import type { IdentityRepository } from '../repos/IdentityRepository';
import type { VerifyAccessToken } from './accessVerifier';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerAuth(
  app: FastifyInstance,
  deps: { config: Config; identities: IdentityRepository; verifyAccessToken: VerifyAccessToken },
): void {
  app.decorateRequest('identity', null);
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || request.url === '/api/health') return;
    const email = await emailOf(request, deps.config, deps.verifyAccessToken);
    const identity = deps.identities.findByEmail(email);
    if (!identity) throw new HttpError(403, 'access_not_granted');
    if (MUTATIONS.has(request.method)) {
      if (request.headers.origin !== deps.config.appOrigin) throw new HttpError(403, 'bad_origin');
      if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
        throw new HttpError(415, 'json_required');
      }
    }
    request.identity = identity;
  });
}

async function emailOf(request: FastifyRequest, config: Config, verify: VerifyAccessToken): Promise<string> {
  if (config.auth.mode === 'dev') return config.auth.email;
  const token = request.headers['cf-access-jwt-assertion'];
  if (typeof token !== 'string' || token === '') throw new HttpError(401, 'unauthenticated');
  try {
    return await verify(token);
  } catch {
    throw new HttpError(401, 'unauthenticated');
  }
}
```

`apps/server/src/auth/guards.ts`:

```ts
import type { AccountContext, AdminContext } from '@notaflow/core';
import type { FastifyRequest } from 'fastify';
import { HttpError } from '../httpError';
import type { Identity } from '../repos/IdentityRepository';

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
  }
}

export function identityOf(request: FastifyRequest): Identity {
  if (!request.identity) throw new HttpError(401, 'unauthenticated');
  return request.identity;
}

export function adminContext(request: FastifyRequest): AdminContext {
  const identity = identityOf(request);
  if (identity.platformRole !== 'admin') throw new HttpError(403, 'admin_only');
  return { userId: identity.userId, admin: true };
}

export function accountContext(
  request: FastifyRequest,
  accountId: string,
  options: { owner?: boolean; write?: boolean } = {},
): AccountContext {
  const identity = identityOf(request);
  const membership = identity.memberships.find((m) => m.accountId === accountId);
  // 404, not 403: an account a user does not belong to must look like it does not exist.
  if (!membership) throw new HttpError(404, 'not_found');
  if (options.owner && membership.role !== 'owner') throw new HttpError(403, 'owner_only');
  if (options.write && membership.accountStatus === 'suspended') {
    throw new HttpError(403, 'account_suspended');
  }
  return {
    accountId,
    userId: identity.userId,
    role: membership.role,
    accountStatus: membership.accountStatus,
  };
}
```

`apps/server/src/routes/me.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { identityOf } from '../auth/guards';

export function meRoutes(app: FastifyInstance): void {
  app.get('/api/me', async (request) => {
    const identity = identityOf(request);
    return {
      email: identity.email,
      name: identity.name,
      platformRole: identity.platformRole,
      accounts: identity.memberships.map((m) => ({
        id: m.accountId,
        name: m.accountName,
        role: m.role,
        status: m.accountStatus,
      })),
    };
  });
}
```

Replace `apps/server/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { remoteAccessVerifier, type VerifyAccessToken } from './auth/accessVerifier';
import { registerAuth } from './auth/authHook';
import type { Config } from './config';
import type { Database } from './db/openDatabase';
import { handleError } from './httpError';
import { IdentityRepository } from './repos/IdentityRepository';
import { meRoutes } from './routes/me';

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
  }
}

export interface AppDeps {
  config: Config;
  db: Database;
  verifyAccessToken?: VerifyAccessToken;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const app = Fastify({ logger: config.nodeEnv !== 'test' });
  const routeList: { method: string; url: string }[] = [];
  app.decorate('routeList', routeList);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') routeList.push({ method, url: route.url });
    }
  });
  app.setErrorHandler(handleError);

  const verifyAccessToken =
    deps.verifyAccessToken ??
    (config.auth.mode === 'access'
      ? remoteAccessVerifier(config.auth.teamDomain, config.auth.audience)
      : async () => '');
  registerAuth(app, { config, identities: new IdentityRepository(db), verifyAccessToken });

  app.get('/api/health', async () => ({ status: 'ok' }));
  meRoutes(app);
  return app;
}
```

Update `apps/server/src/app.test.ts` to pass `db`:

```ts
import { expect, test } from 'vitest';
import { seedUser } from '../test/fixtures';
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/openDatabase';

test('GET /api/health answers without authentication', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: 'dev@example.com',
  });
  const { db, close } = openDatabase(':memory:');
  const app = buildApp({ config, db });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'ok' });
  await app.close();
  close();
});

test('dev mode authenticates every request as DEV_USER_EMAIL', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: 'Dev@Example.com',
  });
  const { db, close } = openDatabase(':memory:');
  seedUser(db, 'dev@example.com');
  const app = buildApp({ config, db });
  const response = await app.inject({ method: 'GET', url: '/api/me' });
  expect(response.json()).toMatchObject({ email: 'dev@example.com' });
  await app.close();
  close();
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): Cloudflare Access authentication, the mutation guard, and GET /api/me"
```

---

### Task 6: Admin API and member invites

**Files:**
- Create: `apps/server/src/routes/admin.ts`, `apps/server/src/routes/admin.test.ts`
- Create: `apps/server/src/routes/members.ts`, `apps/server/src/routes/members.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `adminContext`, `accountContext`, `identityOf` (Task 5); `AdminRepository`, `MemberRepository`, `AuditLog` (Task 4); `createTestApp`, `seedTenant`, `seedUser` (Tasks 4 and 5).
- Produces routes:
  - `GET /api/admin/accounts` → `200 [{ id, name, status, plan, members }]`
  - `POST /api/admin/accounts` `{ name }` → `201 { id }`
  - `POST /api/admin/accounts/:accountId/status` `{ status: 'active' | 'suspended' }` → `204`, `404 not_found`
  - `POST /api/admin/users` `{ email, name, platformRole? }` → `201 { id }`, `409 user_exists`
  - `PUT /api/admin/accounts/:accountId/members/:userId` `{ role: 'owner' | 'member' }` → `204`, `404 not_found`
  - `GET /api/accounts/:accountId/members` → `200 [{ userId, email, name, role }]`
  - `POST /api/accounts/:accountId/members` `{ email, name }` (owner, write) → `201 { userId, created }`, `409 already_member`

Every admin mutation and every invite writes an audit entry (RFC "user and account changes").

- [ ] **Step 1: Write the failing tests**

`apps/server/src/routes/admin.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant, seedUser } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';
import { AuditLog } from '../repos/AuditLog';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  seedUser(t.db, 'admin@example.com', 'admin');
});
afterEach(() => t.close());

test('a platform admin creates an account and a user, and sets the owner', async () => {
  const headers = await t.as('admin@example.com');
  const account = await t.app.inject({ method: 'POST', url: '/api/admin/accounts', headers, payload: { name: 'Vapulab' } });
  expect(account.statusCode).toBe(201);
  const { id: accountId } = account.json<{ id: string }>();

  const user = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers,
    payload: { email: 'Owner@Example.com', name: 'Owner' },
  });
  expect(user.statusCode).toBe(201);
  const { id: userId } = user.json<{ id: string }>();

  const member = await t.app.inject({
    method: 'PUT',
    url: `/api/admin/accounts/${accountId}/members/${userId}`,
    headers,
    payload: { role: 'owner' },
  });
  expect(member.statusCode).toBe(204);

  const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('owner@example.com') });
  expect(me.json()).toMatchObject({ accounts: [{ id: accountId, role: 'owner' }] });

  const list = await t.app.inject({ method: 'GET', url: '/api/admin/accounts', headers });
  expect(list.json()).toEqual([expect.objectContaining({ id: accountId, name: 'Vapulab', members: 1 })]);
  expect(new AuditLog(t.db).list().map((e) => e.action)).toEqual([
    'account.create',
    'user.create',
    'membership.set',
  ]);
});

test('a second user with the same email is 409 user_exists', async () => {
  const headers = await t.as('admin@example.com');
  const payload = { email: 'x@example.com', name: 'X' };
  await t.app.inject({ method: 'POST', url: '/api/admin/users', headers, payload });
  const again = await t.app.inject({ method: 'POST', url: '/api/admin/users', headers, payload });
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({ error: 'user_exists' });
});

test('an admin suspends an account; an unknown account is 404', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const headers = await t.as('admin@example.com');
  const status = await t.app.inject({
    method: 'POST',
    url: `/api/admin/accounts/${a.accountId}/status`,
    headers,
    payload: { status: 'suspended' },
  });
  expect(status.statusCode).toBe(204);
  const missing = await t.app.inject({
    method: 'POST',
    url: '/api/admin/accounts/missing/status',
    headers,
    payload: { status: 'suspended' },
  });
  expect(missing.statusCode).toBe(404);
});

test('a user who is not a platform admin gets 403 admin_only', async () => {
  seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await t.app.inject({
    method: 'GET',
    url: '/api/admin/accounts',
    headers: await t.as('owner@example.com'),
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'admin_only' });
});

test('an invalid body is 400', async () => {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api/admin/accounts/x/status',
    headers: await t.as('admin@example.com'),
    payload: { status: 'deleted' },
  });
  expect(response.statusCode).toBe(400);
});
```

`apps/server/src/routes/members.test.ts`:

```ts
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
  const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: await t.as('contador@example.com') });
  expect(me.json()).toMatchObject({ accounts: [{ id: a.accountId, role: 'member' }] });
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({ action: 'member.invite', accountId: a.accountId });
});

test('inviting an existing member is 409 already_member', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const headers = await t.as('owner@example.com');
  const payload = { email: 'm@example.com', name: 'M' };
  await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/members`, headers, payload });
  const again = await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/members`, headers, payload });
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
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com', status: 'suspended' });
  const headers = await t.as('owner@example.com');
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/members`, headers });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/routes`
Expected: FAIL with HTTP 404 on every new route.

- [ ] **Step 3: Implement the routes**

`apps/server/src/routes/admin.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { adminContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AdminRepository } from '../repos/AdminRepository';
import { AuditLog } from '../repos/AuditLog';

const email = { type: 'string', format: 'email', maxLength: 254 } as const;
const name = { type: 'string', minLength: 1, maxLength: 200 } as const;

export function adminRoutes(app: FastifyInstance, db: Database): void {
  const admin = new AdminRepository(db);
  const audit = new AuditLog(db);

  app.get('/api/admin/accounts', async (request) => admin.listAccounts(adminContext(request)));

  app.post<{ Body: { name: string } }>(
    '/api/admin/accounts',
    { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name } } } },
    async (request, reply) => {
      const id = admin.createAccount(adminContext(request), request.body.name);
      audit.record({ userEmail: identityOf(request).email, accountId: id, action: 'account.create', entity: id, result: 'ok' });
      return reply.status(201).send({ id });
    },
  );

  app.post<{ Params: { accountId: string }; Body: { status: 'active' | 'suspended' } }>(
    '/api/admin/accounts/:accountId/status',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: { status: { enum: ['active', 'suspended'] } },
        },
      },
    },
    async (request, reply) => {
      const { accountId } = request.params;
      if (!admin.setAccountStatus(adminContext(request), accountId, request.body.status)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId,
        action: 'account.status',
        entity: accountId,
        result: 'ok',
        detail: request.body.status,
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Body: { email: string; name: string; platformRole?: 'admin' | 'user' } }>(
    '/api/admin/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'name'],
          additionalProperties: false,
          properties: { email, name, platformRole: { enum: ['admin', 'user'] } },
        },
      },
    },
    async (request, reply) => {
      const ctx = adminContext(request);
      const id = admin.createUser(ctx, request.body.email, request.body.name);
      const actor = identityOf(request).email;
      if (!id) {
        audit.record({ userEmail: actor, accountId: null, action: 'user.create', entity: request.body.email.toLowerCase(), result: 'refused', detail: 'exists' });
        throw new HttpError(409, 'user_exists');
      }
      if (request.body.platformRole === 'admin') admin.setPlatformRole(ctx, id, 'admin');
      audit.record({ userEmail: actor, accountId: null, action: 'user.create', entity: id, result: 'ok' });
      return reply.status(201).send({ id });
    },
  );

  app.put<{ Params: { accountId: string; userId: string }; Body: { role: 'owner' | 'member' } }>(
    '/api/admin/accounts/:accountId/members/:userId',
    {
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          additionalProperties: false,
          properties: { role: { enum: ['owner', 'member'] } },
        },
      },
    },
    async (request, reply) => {
      const { accountId, userId } = request.params;
      if (!admin.setMembership(adminContext(request), accountId, userId, request.body.role)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId,
        action: 'membership.set',
        entity: userId,
        result: 'ok',
        detail: request.body.role,
      });
      return reply.status(204).send();
    },
  );
}
```

`POST /api/admin/users` with `platformRole: 'admin'` needs one more `AdminRepository` method. Add it to `apps/server/src/repos/AdminRepository.ts`, with a test in `repos.test.ts` first ("setPlatformRole makes a user a platform admin", asserting `new IdentityRepository(db).findByEmail(...)?.platformRole` is `admin`):

```ts
  setPlatformRole(_ctx: AdminContext, userId: string, platformRole: 'admin' | 'user'): boolean {
    return this.db.update(users).set({ platformRole }).where(eq(users.id, userId)).run().changes > 0;
  }
```

`apps/server/src/routes/members.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import { MemberRepository } from '../repos/MemberRepository';

export function memberRoutes(app: FastifyInstance, db: Database): void {
  const members = new MemberRepository(db);
  const audit = new AuditLog(db);

  app.get<{ Params: { accountId: string } }>('/api/accounts/:accountId/members', async (request) =>
    members.list(accountContext(request, request.params.accountId)),
  );

  app.post<{ Params: { accountId: string }; Body: { email: string; name: string } }>(
    '/api/accounts/:accountId/members',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'name'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const result = members.invite(ctx, request.body.email, request.body.name);
      if (!result) throw new HttpError(409, 'already_member');
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'member.invite',
        entity: result.userId,
        result: 'ok',
      });
      return reply.status(201).send(result);
    },
  );
}
```

In `apps/server/src/app.ts`, import `adminRoutes` and `memberRoutes` and call them after `meRoutes(app)`:

```ts
  adminRoutes(app, db);
  memberRoutes(app, db);
```

Fastify validates the body before the handler, so a member hitting the invite route with an invalid body gets 400 before the 403. The tests above send valid bodies on purpose.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): admin API for accounts, users, and owners, and member invites"
```

---

### Task 7: Certificate store, provider factory, and emitter onboarding

**Files:**
- Create: `apps/server/src/vault/VaultCertificateStore.ts`, `VaultCertificateStore.test.ts`
- Create: `apps/server/src/providers/providerFactory.ts`
- Create: `apps/server/src/routes/emitters.ts`, `apps/server/src/routes/emitters.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/test/testApp.ts`

**Interfaces:**
- Consumes: `sealCertificate`, `openCertificate`, `VaultError` (Task 3); `EmitterRepository`, `CertificateRepository`, `AuditLog` (Task 4); `accountContext`, `identityOf` (Task 5); `loadCertificate`, `CertificateError` from `@notaflow/signer-node`; `NacionalProvider`, `NacionalClient`, `createMtlsDispatcher` from `@notaflow/provider-nacional`; `InvoiceProvider`, `CertificateStore`, `CertificateMaterial`, `Environment` from `@notaflow/core`; `makeTestCertificate` from `@notaflow/test-kit`.
- Produces:
  - `class VaultCertificateStore implements CertificateStore`, `constructor(certificates: CertificateRepository, masterKey: Buffer)`
  - `type ProviderFactory = (input: { environment: Environment; certificate: CertificateMaterial }) => InvoiceProvider`
  - `nacionalProviderFactory(urls?: { sefin: string; adn: string }): ProviderFactory`
  - `POST /api/accounts/:accountId/emitters` (owner, write) → `201 { id, cnpj, companyName, environment }`
  - `GET /api/accounts/:accountId/emitters` → `200 [{ id, cnpj, companyName, environment, municipality, dpsSeries, certificate: { validTo, expiresSoon } | null }]`
  - `AppDeps.providerFactory?: ProviderFactory` (default `nacionalProviderFactory(config.nacionalUrls)`)

Onboarding body (JSON, so the mutation guard applies; the `.pfx` travels in base64):

```json
{
  "pfxBase64": "...",
  "password": "...",
  "municipality": "4113700",
  "municipalRegistration": "optional",
  "simplesNacional": "3",
  "simplesRegime": "1",
  "specialRegime": "0",
  "dpsSeries": "900"
}
```

Onboarding order (RFC "Flow: onboard an emitter"; a failure at any step stores nothing):
1. Open the `.pfx` with `loadCertificate`. A `CertificateError` answers 400 with its code (`WRONG_PASSWORD`, `EXPIRED`, `NOT_YET_VALID`, `INVALID_FILE`, `CNPJ_NOT_FOUND`).
2. If the CNPJ belongs to another account: 409 `cnpj_in_other_account`, audit `refused`.
3. If this account already has an emitter with this CNPJ: 409 `emitter_exists` (the owner replaces the certificate instead, Task 8).
4. Connection test in `producao_restrita`: `providerFactory(...).checkConnection(municipality)`. Any error: 502 `connection_test_failed`, audit `error`.
5. In one transaction: create the emitter (environment `producao_restrita`) and store the sealed certificate as active.
6. Audit `emitter.create` and `certificate.upload`, both `ok`.

`expiresSoon` is true when `validTo` is less than 30 days away (RFC "Certificate vault").

- [ ] **Step 1: Add the provider factory to the test app**

In `apps/server/test/testApp.ts`, no change is needed: `buildApp` builds the default factory from `config.nacionalUrls`, which points at the fake. A plain-HTTP fake URL works with the mTLS dispatcher, because undici ignores the TLS options for `http:`.

- [ ] **Step 2: Write the failing tests**

`apps/server/src/vault/VaultCertificateStore.test.ts`:

```ts
import { makeTestCertificate } from '@notaflow/test-kit';
import { expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { openDatabase } from '../db/openDatabase';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { sealCertificate, VaultError } from './envelope';
import { VaultCertificateStore } from './VaultCertificateStore';

const master = Buffer.alloc(32, 3);

test('loads the active certificate as PEM material, only for its own account', async () => {
  const { db, close } = openDatabase(':memory:');
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  const emitter = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
  const testCert = makeTestCertificate();
  const certificates = new CertificateRepository(db);
  certificates.addActive(a, emitter.id, sealCertificate(testCert.pfx, testCert.password, master), {
    cnpj: testCert.cnpj,
    subject: 'x',
    validFrom: new Date(),
    validTo: new Date(Date.now() + 86_400_000),
    fingerprintSha256: 'ab'.repeat(32),
    uploadedBy: a.userId,
  });

  const store = new VaultCertificateStore(certificates, master);
  expect((await store.loadActive(a, emitter.id))?.cnpj).toBe('12345678000195');
  expect(await store.loadActive(b, emitter.id)).toBeNull();
  await expect(new VaultCertificateStore(certificates, Buffer.alloc(32, 4)).loadActive(a, emitter.id)).rejects.toThrow(
    VaultError,
  );
  close();
});
```

`apps/server/src/routes/emitters.test.ts`:

```ts
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

test('an owner onboards an emitter: connection test, sealed certificate, producao_restrita', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const response = await onboard(a.accountId, 'owner@example.com');
  expect(response.statusCode).toBe(201);
  const created = response.json<{ id: string; environment: string; cnpj: string }>();
  expect(created).toMatchObject({ cnpj: '12345678000195', environment: 'producao_restrita' });

  const stored = new CertificateRepository(t.db).activeFor(a, created.id);
  expect(stored?.pfxCiphertext.includes(testCert.pfx.subarray(0, 64))).toBe(false);
  expect(new AuditLog(t.db).list().map((e) => [e.action, e.result])).toEqual([
    ['emitter.create', 'ok'],
    ['certificate.upload', 'ok'],
  ]);

  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as('owner@example.com'),
  });
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
  const response = await onboard(a.accountId, 'owner@example.com', body({ password: 'senha-errada-123' }));
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
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/emitters`,
    headers: await t.as('b@example.com'),
  });
  expect(list.json()).toEqual([]);
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({ accountId: b.accountId, result: 'refused' });
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
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as('a@example.com'),
  });
  expect(list.json()).toEqual([]);
  expect((await onboard(a.accountId, 'a@example.com')).statusCode).toBe(201);
});

test('a certificate that expires in less than 30 days is flagged', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'a@example.com' });
  const soon = makeTestCertificate({ cnpj: 'AB345678000195', notAfter: new Date(Date.now() + 10 * 86_400_000) });
  await onboard(a.accountId, 'a@example.com', body({ pfxBase64: soon.pfx.toString('base64'), password: soon.password }));
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as('a@example.com'),
  });
  expect(list.json()).toEqual([expect.objectContaining({ certificate: expect.objectContaining({ expiresSoon: true }) })]);
});

test('a member cannot onboard: 403 owner_only', async () => {
  const a = seedTenant(t.db, { accountName: 'A', email: 'm@example.com', role: 'member' });
  expect((await onboard(a.accountId, 'm@example.com')).statusCode).toBe(403);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/vault apps/server/src/routes/emitters.test.ts`
Expected: FAIL, `./VaultCertificateStore` does not exist and the emitter routes answer 404.

- [ ] **Step 4: Implement the store and the factory**

`apps/server/src/vault/VaultCertificateStore.ts`:

```ts
import type { AccountContext, CertificateMaterial, CertificateStore } from '@notaflow/core';
import { loadCertificate } from '@notaflow/signer-node';
import type { CertificateRepository } from '../repos/CertificateRepository';
import { openCertificate } from './envelope';

export class VaultCertificateStore implements CertificateStore {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly masterKey: Buffer,
  ) {}

  async loadActive(context: AccountContext, emitterId: string): Promise<CertificateMaterial | null> {
    const row = this.certificates.activeFor(context, emitterId);
    if (!row) return null;
    const { pfx, password } = openCertificate(row, this.masterKey);
    return loadCertificate(pfx, password);
  }
}
```

`apps/server/src/providers/providerFactory.ts`:

```ts
import type { CertificateMaterial, Environment, InvoiceProvider } from '@notaflow/core';
import { createMtlsDispatcher, NacionalClient, NacionalProvider } from '@notaflow/provider-nacional';

export type ProviderFactory = (input: {
  environment: Environment;
  certificate: CertificateMaterial;
}) => InvoiceProvider;

export function nacionalProviderFactory(urls?: { sefin: string; adn: string }): ProviderFactory {
  return ({ environment, certificate }) =>
    new NacionalProvider(
      new NacionalClient({
        environment,
        dispatcher: createMtlsDispatcher(certificate),
        ...(urls ? { urls } : {}),
      }),
      certificate.cnpj,
    );
}
```

- [ ] **Step 5: Implement the emitter routes**

`apps/server/src/routes/emitters.ts`:

```ts
import type { CertificateMaterial } from '@notaflow/core';
import { CertificateError, loadCertificate } from '@notaflow/signer-node';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { ProviderFactory } from '../providers/providerFactory';
import { AuditLog } from '../repos/AuditLog';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { sealCertificate } from '../vault/envelope';

const DAY_MS = 86_400_000;

interface OnboardBody {
  pfxBase64: string;
  password: string;
  municipality: string;
  municipalRegistration?: string;
  simplesNacional: '1' | '2' | '3';
  simplesRegime?: '1' | '2' | '3';
  specialRegime: string;
  dpsSeries: string;
}

const onboardSchema = {
  body: {
    type: 'object',
    required: ['pfxBase64', 'password', 'municipality', 'simplesNacional', 'specialRegime', 'dpsSeries'],
    additionalProperties: false,
    properties: {
      pfxBase64: { type: 'string', minLength: 1, maxLength: 200_000 },
      password: { type: 'string', maxLength: 200 },
      municipality: { type: 'string', pattern: '^[0-9]{7}$' },
      municipalRegistration: { type: 'string', minLength: 1, maxLength: 15 },
      simplesNacional: { enum: ['1', '2', '3'] },
      simplesRegime: { enum: ['1', '2', '3'] },
      specialRegime: { enum: ['0', '1', '2', '3', '4', '5', '6', '9'] },
      dpsSeries: { type: 'string', pattern: '^[0-9]{1,5}$' },
    },
  },
} as const;

export function openPfx(pfxBase64: string, password: string): { pfx: Buffer; material: CertificateMaterial } {
  const pfx = Buffer.from(pfxBase64, 'base64');
  try {
    return { pfx, material: loadCertificate(pfx, password) };
  } catch (error) {
    if (error instanceof CertificateError) throw new HttpError(400, error.code);
    throw error;
  }
}

export function emitterRoutes(
  app: FastifyInstance,
  deps: { db: Database; masterKey: Buffer; providerFactory: ProviderFactory },
): void {
  const emitters = new EmitterRepository(deps.db);
  const certificates = new CertificateRepository(deps.db);
  const audit = new AuditLog(deps.db);

  app.get<{ Params: { accountId: string } }>('/api/accounts/:accountId/emitters', async (request) => {
    const ctx = accountContext(request, request.params.accountId);
    return emitters.list(ctx).map((emitter) => {
      const certificate = certificates.activeFor(ctx, emitter.id);
      return {
        id: emitter.id,
        cnpj: emitter.cnpj,
        companyName: emitter.companyName,
        environment: emitter.environment,
        municipality: emitter.municipality,
        dpsSeries: emitter.dpsSeries,
        certificate: certificate
          ? {
              validTo: certificate.validTo.toISOString(),
              expiresSoon: certificate.validTo.getTime() - Date.now() < 30 * DAY_MS,
            }
          : null,
      };
    });
  });

  app.post<{ Params: { accountId: string }; Body: OnboardBody }>(
    '/api/accounts/:accountId/emitters',
    { schema: onboardSchema },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const actor = identityOf(request).email;
      const { pfxBase64, password, ...fiscal } = request.body;
      const { pfx, material } = openPfx(pfxBase64, password);

      if (emitters.isCnpjTakenElsewhere(ctx, material.cnpj)) {
        audit.record({ userEmail: actor, accountId: ctx.accountId, action: 'emitter.create', entity: material.cnpj, result: 'refused', detail: 'cnpj_in_other_account' });
        throw new HttpError(409, 'cnpj_in_other_account');
      }
      if (emitters.findByCnpj(ctx, material.cnpj)) throw new HttpError(409, 'emitter_exists');

      try {
        await deps.providerFactory({ environment: 'producao_restrita', certificate: material }).checkConnection(fiscal.municipality);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        audit.record({ userEmail: actor, accountId: ctx.accountId, action: 'emitter.create', entity: material.cnpj, result: 'error', detail: `connection test: ${detail}` });
        throw new HttpError(502, 'connection_test_failed', detail);
      }

      const sealed = sealCertificate(pfx, password, deps.masterKey);
      const emitter = deps.db.transaction(() => {
        const created = emitters.create(ctx, {
          ...fiscal,
          cnpj: material.cnpj,
          companyName: companyNameOf(material),
        });
        certificates.addActive(ctx, created.id, sealed, {
          cnpj: material.cnpj,
          subject: material.subject,
          validFrom: material.notBefore,
          validTo: material.notAfter,
          fingerprintSha256: material.fingerprintSha256,
          uploadedBy: ctx.userId,
        });
        return created;
      });
      audit.record({ userEmail: actor, accountId: ctx.accountId, action: 'emitter.create', entity: emitter.id, result: 'ok' });
      audit.record({ userEmail: actor, accountId: ctx.accountId, action: 'certificate.upload', entity: emitter.id, result: 'ok' });
      return reply.status(201).send({
        id: emitter.id,
        cnpj: emitter.cnpj,
        companyName: emitter.companyName,
        environment: emitter.environment,
      });
    },
  );
}

// The e-CNPJ CN is "COMPANY NAME:CNPJ"; the name is the part before the last colon.
function companyNameOf(material: CertificateMaterial): string {
  const cn = /CN=([^,]+)/.exec(material.subject)?.[1] ?? material.subject;
  const colon = cn.lastIndexOf(':');
  return colon > 0 ? cn.slice(0, colon) : cn;
}
```

`EmitterRepository.create` and `CertificateRepository.addActive` already run on `deps.db`. Inside `deps.db.transaction(() => ...)` they use the same SQLite connection, and `better-sqlite3` transactions are synchronous, so both writes commit or roll back together. `CertificateRepository.addActive` opens its own nested `transaction`, which `better-sqlite3` turns into a savepoint.

In `apps/server/src/app.ts`, add `providerFactory?: ProviderFactory` to `AppDeps`, and register the routes after `memberRoutes`:

```ts
  emitterRoutes(app, {
    db,
    masterKey: config.masterKey,
    providerFactory: deps.providerFactory ?? nacionalProviderFactory(config.nacionalUrls),
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS. The subject format of `makeTestCertificate` decides `companyNameOf`; if the onboarding response shows a `companyName` other than `EMPRESA TESTE LTDA`, read `material.subject` in a test and fix `companyNameOf`, not the test.

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): emitter onboarding with the vault and a connection test"
```

---

### Task 8: Certificate replacement and the environment switch

**Files:**
- Modify: `apps/server/src/routes/emitters.ts`
- Modify: `apps/server/src/routes/emitters.test.ts`

**Interfaces:**
- Consumes: everything from Task 7.
- Produces routes:
  - `POST /api/accounts/:accountId/emitters/:emitterId/certificate` `{ pfxBase64, password }` (owner, write) → `204`; `400 cnpj_mismatch`; `502 connection_test_failed`; `404 not_found`
  - `POST /api/accounts/:accountId/emitters/:emitterId/environment` `{ environment, confirm }` (owner, write) → `204`; `400 confirmation_required` when `environment` is `producao` and `confirm` is not the literal `producao`; `404 not_found`

The replacement runs the connection test in the emitter's current environment. Both routes write audit entries: `certificate.upload` and `emitter.environment` (with the new environment in `detail`).

- [ ] **Step 1: Write the failing tests**

Add `import { eq } from 'drizzle-orm';` and `import { accounts } from '../db/schema';` to the imports of `apps/server/src/routes/emitters.test.ts`, then append:

```ts
async function onboarded(email = 'owner@example.com') {
  const a = seedTenant(t.db, { accountName: 'A', email });
  const response = await onboard(a.accountId, email);
  return { a, emitterId: response.json<{ id: string }>().id };
}

test('the owner replaces the certificate with one of the same CNPJ', async () => {
  const { a, emitterId } = await onboarded();
  const next = makeTestCertificate({ cnpj: '12345678000195' });
  const before = new CertificateRepository(t.db).activeFor(a, emitterId)?.id;
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/certificate`,
    headers: await t.as('owner@example.com'),
    payload: { pfxBase64: next.pfx.toString('base64'), password: next.password },
  });
  expect(response.statusCode).toBe(204);
  expect(new CertificateRepository(t.db).activeFor(a, emitterId)?.id).not.toBe(before);
});

test('a certificate of another CNPJ is 400 cnpj_mismatch', async () => {
  const { a, emitterId } = await onboarded();
  const other = makeTestCertificate({ cnpj: '98765432000110' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/certificate`,
    headers: await t.as('owner@example.com'),
    payload: { pfxBase64: other.pfx.toString('base64'), password: other.password },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'cnpj_mismatch' });
});

test('switching to producao needs the literal confirmation and is audited', async () => {
  const { a, emitterId } = await onboarded();
  const url = `/api/accounts/${a.accountId}/emitters/${emitterId}/environment`;
  const headers = await t.as('owner@example.com');
  const missing = await t.app.inject({ method: 'POST', url, headers, payload: { environment: 'producao', confirm: 'yes' } });
  expect(missing.statusCode).toBe(400);
  expect(missing.json()).toEqual({ error: 'confirmation_required' });

  const ok = await t.app.inject({ method: 'POST', url, headers, payload: { environment: 'producao', confirm: 'producao' } });
  expect(ok.statusCode).toBe(204);
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/emitters`, headers });
  expect(list.json()).toEqual([expect.objectContaining({ environment: 'producao' })]);
  expect(new AuditLog(t.db).list().at(-1)).toMatchObject({ action: 'emitter.environment', detail: 'producao' });
});

test('a suspended account cannot switch the environment', async () => {
  const { a, emitterId } = await onboarded();
  t.db.update(accounts).set({ status: 'suspended' }).where(eq(accounts.id, a.accountId)).run();
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters/${emitterId}/environment`,
    headers: await t.as('owner@example.com'),
    payload: { environment: 'producao', confirm: 'producao' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'account_suspended' });
});

test('an emitter of another account is 404 on both routes', async () => {
  const { emitterId } = await onboarded();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const headers = await t.as('b@example.com');
  const env = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${b.accountId}/emitters/${emitterId}/environment`,
    headers,
    payload: { environment: 'producao', confirm: 'producao' },
  });
  expect(env.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/routes/emitters.test.ts`
Expected: FAIL, the two routes answer 404 for every request.

- [ ] **Step 3: Implement the routes**

Add inside `emitterRoutes`, after the onboarding route:

```ts
  app.post<{ Params: { accountId: string; emitterId: string }; Body: { pfxBase64: string; password: string } }>(
    '/api/accounts/:accountId/emitters/:emitterId/certificate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pfxBase64', 'password'],
          additionalProperties: false,
          properties: {
            pfxBase64: { type: 'string', minLength: 1, maxLength: 200_000 },
            password: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const emitter = emitters.get(ctx, request.params.emitterId);
      if (!emitter) throw new HttpError(404, 'not_found');
      const { pfx, material } = openPfx(request.body.pfxBase64, request.body.password);
      if (material.cnpj !== emitter.cnpj) throw new HttpError(400, 'cnpj_mismatch');
      try {
        await deps.providerFactory({ environment: emitter.environment, certificate: material }).checkConnection(emitter.municipality);
      } catch (error) {
        throw new HttpError(502, 'connection_test_failed', error instanceof Error ? error.message : String(error));
      }
      certificates.addActive(ctx, emitter.id, sealCertificate(pfx, request.body.password, deps.masterKey), {
        cnpj: material.cnpj,
        subject: material.subject,
        validFrom: material.notBefore,
        validTo: material.notAfter,
        fingerprintSha256: material.fingerprintSha256,
        uploadedBy: ctx.userId,
      });
      audit.record({ userEmail: identityOf(request).email, accountId: ctx.accountId, action: 'certificate.upload', entity: emitter.id, result: 'ok' });
      return reply.status(204).send();
    },
  );

  app.post<{
    Params: { accountId: string; emitterId: string };
    Body: { environment: 'producao' | 'producao_restrita'; confirm?: string };
  }>(
    '/api/accounts/:accountId/emitters/:emitterId/environment',
    {
      schema: {
        body: {
          type: 'object',
          required: ['environment'],
          additionalProperties: false,
          properties: {
            environment: { enum: ['producao', 'producao_restrita'] },
            confirm: { type: 'string', maxLength: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId, { owner: true, write: true });
      const { environment, confirm } = request.body;
      if (environment === 'producao' && confirm !== 'producao') {
        throw new HttpError(400, 'confirmation_required');
      }
      if (!emitters.setEnvironment(ctx, request.params.emitterId, environment)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'emitter.environment',
        entity: request.params.emitterId,
        result: 'ok',
        detail: environment,
      });
      return reply.status(204).send();
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): certificate replacement and the audited environment switch"
```

---

### Task 9: Route sweep for authentication and account isolation

**Files:**
- Create: `apps/server/src/routes/routeSweep.test.ts`

**Interfaces:**
- Consumes: `app.routeList` (Task 5); every route of Tasks 5 to 8; `createTestApp`, `seedTenant`, `seedUser`.
- Produces: nothing new. This is the RFC test "walks every registered route".

The sweep fills each path parameter from a fixed map, so a new route with a new parameter fails the sweep until someone adds the parameter to the map. That is on purpose: a new route must be checked.

- [ ] **Step 1: Write the test**

`apps/server/src/routes/routeSweep.test.ts`:

```ts
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
    for (const route of t.app.routeList.filter((r) => r.url.startsWith('/api/accounts/:accountId'))) {
      const response = await t.app.inject({
        method: route.method as 'GET',
        url: fill(route.url),
        headers,
        ...(route.method === 'GET' ? {} : { payload: {} }),
      });
      // An empty body fails validation (400) on some routes, so check the guard does not leak:
      // the answer is never 2xx and never 403.
      expect(response.statusCode, `${route.method} ${route.url}`).not.toBeLessThan(300);
      expect(response.statusCode, `${route.method} ${route.url}`).not.toBe(403);
    }
  });

  test('answers 403 admin_only to an account owner, on every admin route', async () => {
    const headers = await t.as('a@example.com');
    for (const route of t.app.routeList.filter((r) => r.url.startsWith('/api/admin/'))) {
      const response = await t.app.inject({
        method: route.method as 'GET',
        url: fill(route.url),
        headers,
        ...(route.method === 'GET' ? {} : { payload: {} }),
      });
      expect([400, 403], `${route.method} ${route.url}`).toContain(response.statusCode);
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
```

The isolation and admin checks accept 400 because Fastify validates the body before the handler runs the guard. Step 2 removes that gap.

- [ ] **Step 2: Run the sweep and close the 400 gap**

Run: `pnpm vitest run apps/server/src/routes/routeSweep.test.ts`
Expected: PASS.

Then make the guards run before body validation, so the sweep can demand exactly 404 and 403. In `apps/server/src/auth/authHook.ts`, add a `preValidation` hook that runs the account and admin guards from the route URL:

```ts
  app.addHook('preValidation', async (request) => {
    const url = request.routeOptions.url ?? '';
    const params = request.params as Record<string, string | undefined>;
    if (url.startsWith('/api/admin/')) adminContext(request);
    if (url.startsWith('/api/accounts/:accountId') && params.accountId) accountContext(request, params.accountId);
  });
```

Import `adminContext` and `accountContext` from `./guards`. This runs only the membership and admin checks; the owner and write checks stay in the handlers, because they depend on the route. Then tighten the sweep:
- In "answers 404 to a user of another account", replace the two `not` assertions with `expect(response.statusCode, ...).toBe(404);` and delete the two comment lines above them.
- In "answers 403 admin_only", replace `expect([400, 403], ...).toContain(response.statusCode)` with `expect(response.statusCode, ...).toBe(403);`.

Run: `pnpm vitest run apps/server`
Expected: PASS. The tighter sweep fails before the `preValidation` hook and passes after it; run it once without the hook to see the 400s, then with it.

- [ ] **Step 3: Commit**

```bash
git add apps/server
git commit -m "test(server): route sweep for authentication, isolation, and admin-only routes"
```

---

### Task 10: Seed command, server entry, local run, and docs

**Files:**
- Create: `apps/server/src/seed.ts`, `apps/server/src/seed.test.ts`
- Create: `apps/server/src/main.ts`
- Create: `apps/server/.env.example`, `apps/server/AGENTS.md`
- Create: `docs/ENGINEERING/ARCHITECTURE/TENANCY.md`, `docs/ENGINEERING/ARCHITECTURE/CERTIFICATE_VAULT.md`
- Modify: root `package.json` (scripts `dev:server`, `seed:admin`), root `AGENTS.md`, `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `seedAdmin(db: Database, email: string, name: string): { userId: string; created: boolean }` (idempotent: an existing user becomes a platform admin)
  - `pnpm seed:admin <email> <name>` and `pnpm dev:server`

The seed command is the third exception to the repository rule: it runs before any user exists.

- [ ] **Step 1: Write the failing test**

`apps/server/src/seed.test.ts`:

```ts
import { expect, test } from 'vitest';
import { seedUser } from '../test/fixtures';
import { openDatabase } from './db/openDatabase';
import { IdentityRepository } from './repos/IdentityRepository';
import { seedAdmin } from './seed';

test('seedAdmin creates a platform admin once and promotes an existing user', () => {
  const { db, close } = openDatabase(':memory:');
  expect(seedAdmin(db, 'Admin@Example.com', 'Admin')).toMatchObject({ created: true });
  expect(seedAdmin(db, 'admin@example.com', 'Admin')).toMatchObject({ created: false });
  expect(new IdentityRepository(db).findByEmail('admin@example.com')?.platformRole).toBe('admin');

  seedUser(db, 'user@example.com');
  seedAdmin(db, 'user@example.com', 'User');
  expect(new IdentityRepository(db).findByEmail('user@example.com')?.platformRole).toBe('admin');
  close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/server/src/seed.test.ts`
Expected: FAIL, `./seed` does not exist.

- [ ] **Step 3: Implement the seed and the entry**

`apps/server/src/seed.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { type Database, openDatabase } from './db/openDatabase';
import { users } from './db/schema';

// Runs before any user exists, so it writes the users table directly.
export function seedAdmin(db: Database, email: string, name: string): { userId: string; created: boolean } {
  const normalized = email.toLowerCase();
  const existing = db.select().from(users).where(eq(users.email, normalized)).get();
  if (existing) {
    db.update(users).set({ platformRole: 'admin' }).where(eq(users.id, existing.id)).run();
    return { userId: existing.id, created: false };
  }
  const userId = randomUUID();
  db.insert(users).values({ id: userId, email: normalized, name, platformRole: 'admin' }).run();
  return { userId, created: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [email, name] = process.argv.slice(2);
  const path = process.env.DATABASE_PATH;
  if (!email || !name || !path) {
    console.error('Usage: pnpm seed:admin <email> <name>, with DATABASE_PATH set');
    process.exit(1);
  }
  const { db, close } = openDatabase(path);
  console.log(seedAdmin(db, email, name).created ? 'Admin created.' : 'Existing user is now an admin.');
  close();
}
```

`apps/server/src/main.ts`:

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/openDatabase';

try {
  const config = loadConfig(process.env);
  if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
  const { db } = openDatabase(config.databasePath);
  const app = buildApp({ config, db });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
```

`apps/server/.env.example`:

```
# Copy to apps/server/.env.local for local development. Never commit the real file.
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=data/notaflow.db
APP_ORIGIN=http://localhost:3000
# 32 random bytes in base64: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
NFSE_MASTER_KEY=
AUTH_MODE=dev
DEV_USER_EMAIL=
# Production uses AUTH_MODE=access with these two:
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
# Local development against pnpm fake:nacional; refused in production.
NACIONAL_FAKE_URL=http://127.0.0.1:4010
```

In the root `package.json`, add to `scripts`:

```json
    "dev:server": "tsx --env-file=apps/server/.env.local apps/server/src/main.ts",
    "seed:admin": "tsx --env-file=apps/server/.env.local apps/server/src/seed.ts"
```

`data/` is already in `.gitignore`. Check that `apps/server/data/` and `apps/server/.env.local` are ignored:

Run: `git check-ignore -v apps/server/.env.local apps/server/data/notaflow.db`
Expected: both paths print a rule (`.env*` and `data/`).

- [ ] **Step 4: Run the tests**

Run: `pnpm test && pnpm typecheck && pnpm lint && pytest services/signer-py`
Expected: PASS.

- [ ] **Step 5: Run the server by hand**

1. Copy `apps/server/.env.example` to `apps/server/.env.local`. Set `NFSE_MASTER_KEY` with the command in the file, `DEV_USER_EMAIL` to your email, and `DATABASE_PATH` to `apps/server/data/notaflow.db`.
2. Terminal 1: `pnpm fake:nacional`.
3. Terminal 2: `pnpm seed:admin <your email> "<your name>"`, then `pnpm dev:server`.
4. Terminal 3:
   - `curl http://127.0.0.1:3000/api/health` returns `{"status":"ok"}`.
   - `curl http://127.0.0.1:3000/api/me` returns your email with `platformRole` `admin`.
   - `curl -X POST http://127.0.0.1:3000/api/admin/accounts -H "content-type: application/json" -H "origin: http://localhost:3000" -d "{\"name\":\"Vapulab\"}"` returns `201` and an id.

Expected: the three answers above. Stop both processes.

- [ ] **Step 6: Write the docs**

`apps/server/AGENTS.md`:

```markdown
# Server: AI Context

The Fastify API: authentication, accounts and roles, the certificate vault, emitter onboarding, and the audit log. Plan 1a-3 adds the sync job and the read API.

## Quick Reference

- Entry: `src/main.ts` (`pnpm dev:server`); app wiring: `src/app.ts`; config: `src/config.ts`
- Database: `src/db/schema.ts`; migrations in `drizzle/` (`pnpm --filter @notaflow/server exec drizzle-kit generate --name <name>`)
- Tests: `test/testApp.ts` builds the app on an in-memory database, signs Access tokens, and starts the fake national system

## Documentation Index

- [Tenancy](../../docs/ENGINEERING/ARCHITECTURE/TENANCY.md) - accounts, roles, guards, and the route sweep
- [Certificate Vault](../../docs/ENGINEERING/ARCHITECTURE/CERTIFICATE_VAULT.md) - envelope encryption and key rotation
- [RFC](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md) - flows and the security model

## Key Rules

1. Every account query goes through a repository method that takes an `AccountContext`, built only by `accountContext()` in `src/auth/guards.ts`.
2. A new route with a new path parameter must be added to the route sweep (`src/routes/routeSweep.test.ts`).
3. Never log or return a certificate, a password, or the master key.
4. A schema change needs a new migration in the same commit.
```

`docs/ENGINEERING/ARCHITECTURE/TENANCY.md`:

```markdown
# Tenancy

An account is the paying customer. A user is a person, identified by email. A membership links a user to an account with the role `owner` or `member`. A platform `admin` manages accounts and users, and has no access to an account's data by default.

## Request flow

1. Cloudflare Access authenticates the person. The server checks the Access JWT (`Cf-Access-Jwt-Assertion`) against the team keys and the application `AUD`. In development, `AUTH_MODE=dev` uses `DEV_USER_EMAIL`.
2. The email (lower case) must exist in `users`. Otherwise the answer is 403 `access_not_granted`.
3. A mutation needs `Content-Type: application/json` and an `Origin` equal to `APP_ORIGIN`.
4. An account route builds an `AccountContext` with `accountContext()`. A user without a membership gets 404, so an account's existence does not leak. `owner` routes answer 403 `owner_only` to a member. A suspended account can read, and every mutation answers 403 `account_suspended`.

## Repositories

Every account query goes through a repository method that takes an `AccountContext` and filters by its `accountId`. Three places read without one, each marked in the code: the identity lookup during authentication, the platform admin repository (it takes an `AdminContext`), and the seed command.

## Route sweep

`apps/server/src/routes/routeSweep.test.ts` walks every registered route. It checks that each one needs authentication, that a user of another account gets 404, and that an account owner gets 403 on admin routes.
```

`docs/ENGINEERING/ARCHITECTURE/CERTIFICATE_VAULT.md`:

```markdown
# Certificate Vault

The vault stores each tenant's A1 certificate (`.pfx`) and its password, encrypted. Only the server decrypts them, in memory, to sign or to open the mTLS connection.

## Envelope encryption

- Each certificate has its own random 32-byte data key.
- The data key encrypts the `.pfx` and the password with AES-256-GCM. Each sealed value is `iv (12 bytes) | tag (16 bytes) | ciphertext`.
- `NFSE_MASTER_KEY` (32 bytes, base64) encrypts the data key the same way. The database stores only the wrapped data key.
- A wrong key and a tampered value both raise `VaultError`. The vault never returns partial bytes.

Code: `apps/server/src/vault/envelope.ts` and `VaultCertificateStore.ts`.

## Key rotation

A master key rotation re-wraps each data key with `rewrapKey(wrappedKey, oldKey, newKey)`. The `.pfx` and password ciphertexts do not change.

## Losing the master key

Stored certificates become unreadable. The owners upload their `.pfx` again. Invoices are not lost, because the ADN keeps them.

## Rules

- A certificate, its password, and the master key never go to disk in clear text and never go to a log.
- An emitter has one active certificate. A replacement keeps the old row, inactive, as history.
- The UI warns 30 days before the active certificate expires (`expiresSoon` in `GET /api/accounts/:accountId/emitters`).
```

In the root `AGENTS.md`, add a package row `| Server | [apps/server/AGENTS.md](apps/server/AGENTS.md) |` and two command rows: `pnpm dev:server` ("Local server, needs apps/server/.env.local and pnpm fake:nacional") and `pnpm seed:admin <email> <name>` ("Create or promote a platform admin"). In `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md`, change the `apps/server` row to "API, persistence, vault, authorization (Stage 1a-2); sync jobs (Stage 1a-3)." and add links to `TENANCY.md` and `CERTIFICATE_VAULT.md` under the ports section.

- [ ] **Step 7: Commit**

```bash
git add apps/server package.json AGENTS.md docs/ENGINEERING/ARCHITECTURE
git commit -m "feat(server): seed command, server entry, local run, and tenancy and vault docs"
```
