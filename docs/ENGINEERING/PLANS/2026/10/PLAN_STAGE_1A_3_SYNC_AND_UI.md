# Stage 1a-3 (ADN Sync, Read API, Web UI, and Admin Panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Stage 1a: sync every emitter's invoices and events from the ADN into SQLite, expose them through a read API, and give users a web UI (accounts, emitters, invoices, lookup by access key, members) and admins a panel, so the Vapulab invoices issued to CoGrader show up in the app.

**Architecture:** The server gets four tables (`customers`, `invoices`, `invoice_events`, `sync_state`), account-scoped repositories for them, and a `SyncService` that walks `InvoiceProvider.fetchSince` (Stage 1a-1) from a cursor kept per emitter and environment. Each batch and its cursor commit in one transaction. A scheduler runs every emitter every 30 minutes, and a "sync now" route runs one emitter on demand. A new package `apps/web` is a React UI built with Vite. In development Vite proxies `/api` to the server; in production the server serves the built files. The plan also closes two Stage 1a-2 review findings on the Access token.

**Tech Stack:** Node 22 or later, pnpm 10, TypeScript 5, Vitest 3, Fastify 5, Drizzle 0.45 and `better-sqlite3` 13, `jose` 6, `@fastify/static` 10, React 19, Vite 7 with `@vitejs/plugin-react` 5, Testing Library (React 16, user-event 14), jsdom 26.

**Spec:** [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md), sections "Flow: onboard an emitter" (step 4, first sync), "Flow: sync from the ADN", "Flow: find by access key", "Data Model", "Security", "Delivery Stages" (1a done when), and "Stage 0 Results".

**Stage 1a split:** Plan [1a-1](PLAN_STAGE_1A_1_PROVIDER_READ.md) built the provider read side and the fake. Plan [1a-2](PLAN_STAGE_1A_2_SERVER_FOUNDATION.md) built the server foundation. This plan (1a-3) finishes Stage 1a. Stage 1b adds issue, cancel, and customer editing.

## Global Constraints

- Never use TypeScript non-null assertions (`value!`). ESLint enforces it.
- A credential never enters git or a log. Tests use `@notaflow/test-kit` certificates and synthetic data (CNPJ `12345678000195`). No real invoice data enters the repository.
- Every account query goes through a repository method that takes an `AccountContext`. New exceptions in this plan: the scheduler's list of sync targets (platform scope, like the admin repository). Each exception says so in a one-line comment.
- Amounts are integer cents in code and in the database. The UI formats them as BRL only at display time.
- The official XML is the source of truth: each invoice and event row stores the full XML, gzip-compressed.
- The sync cursor is per emitter and per environment, because produção restrita and production are two ADNs with their own NSU sequences.
- A customer field edited by hand is never overwritten by the sync.
- UI text is in Brazilian Portuguese. Code, comments, and docs are in English, with no em dash character.
- Comments are a budget: one line, only the non-obvious why.
- Scripts must run on Windows and Linux. No `VAR=value cmd` prefixes.
- Commits carry no AI attribution. Never pass `--no-verify`. On Lincoln's Windows machine, add the `gitleaks` folder to `PATH` before `git commit`.
- PRs target `production` (stacked on the previous feature branch while it is open). Tests run locally: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pytest services/signer-py`.

## Review Focus

1. An owner switches an emitter from `producao_restrita` to `producao` after some syncs. Expected: the production sync starts from NSU 0 of the production ADN, because the cursor is kept per environment; the restrita cursor is not reused. Pinned in Task 5.
2. A cancellation event arrives for an invoice that is not stored (it arrived before the invoice, or the invoice was skipped as a parse error). Expected: the event is stored by access key, and when the invoice arrives it is stored as `cancelled`. Pinned in Task 4.
3. The same documents arrive twice (a re-sync from NSU 0, or a crash between batches). Expected: no duplicate invoice, event, or customer; a customer field edited by hand keeps its value. Pinned in Task 4.
4. The ADN answers 429 in the middle of a sync. Expected: the service retries with backoff; after the last retry it records the error in `sync_state` and keeps the cursor of the last committed batch, so the next run resumes there. Pinned in Task 5.
5. A user looks up an access key whose CNPJ is not an emitter of their account. Expected: HTTP 404 `emitter_not_found`, no call to the Sefin, nothing stored. Pinned in Task 7.

---

## File Structure

```
apps/server/
  drizzle/0001_invoices.sql             generated
  src/db/schema.ts                      + customers, invoices, invoiceEvents, syncState
  src/auth/accessVerifier.ts            RS256 only, exp and email required
  src/auth/authHook.ts                  logs rejected tokens; unmatched non-/api paths skip auth
  src/app.ts                            + logStream, syncService, webRoot deps
  src/repos/CustomerRepository.ts       upsert from an invoice, list
  src/repos/InvoiceRepository.ts        upsert, events, list, detail, XML
  src/repos/SyncStateRepository.ts      cursor and last run per emitter and environment
  src/repos/SyncTargetRepository.ts     platform list of emitters for the scheduler
  src/sync/SyncService.ts               fetch, apply, commit cursor, retry, lock
  src/sync/applyDocument.ts             one SyncDocument into the repositories
  src/sync/scheduler.ts                 every 30 minutes
  src/routes/sync.ts                    GET and POST .../emitters/:emitterId/sync
  src/routes/invoices.ts                list, detail, XML, lookup by access key
  src/routes/customers.ts               list
  src/routes/audit.ts                   GET /api/admin/audit
  src/web.ts                            serves apps/web/dist with an SPA fallback
  test/fakeInvoices.ts                  issues synthetic invoices on the fake
apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html, AGENTS.md
  src/main.tsx, src/App.tsx, src/styles.css
  src/api.ts                            fetch wrapper and API types
  src/router.ts                         hash routes
  src/format.ts                         BRL, dates, file to base64
  src/components/*.tsx                  Layout, EnvironmentBadge, CertificateWarning
  src/pages/*.tsx                       Home, Emitters, Invoices, InvoiceDetail, Members, Admin
```

---

### Task 1: Access token hardening and rejected-token logs (Stage 1a-2 Minor 1 and 2)

**Files:**
- Modify: `apps/server/src/auth/accessVerifier.ts`, `apps/server/src/auth/authHook.ts`, `apps/server/src/app.ts`
- Create: `apps/server/src/auth/accessVerifier.test.ts`
- Modify: `apps/server/src/auth/auth.test.ts`

**Interfaces:**
- Consumes: `createAccessVerifier`, `registerAuth`, `buildApp`, `createTestApp` (Stage 1a-2).
- Produces:
  - `createAccessVerifier` accepts only RS256 tokens with `exp` and `email`.
  - `AppDeps.logStream?: NodeJS.WritableStream` (when set, Fastify logs JSON lines to it, also in tests).
  - The auth hook writes a `warn` line `access token rejected` with a `reason` and never the token.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/auth/accessVerifier.test.ts`:

```ts
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, expect, test } from 'vitest';
import { createAccessVerifier, type VerifyAccessToken } from './accessVerifier';

const ISSUER = 'https://test.cloudflareaccess.com';
const AUDIENCE = 'aud';
let verify: VerifyAccessToken;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'RS256' }] });
  verify = createAccessVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks });
});

function token(claims: Record<string, unknown>, withExp = true) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt();
  return (withExp ? jwt.setExpirationTime('5m') : jwt).sign(privateKey);
}

test('accepts an RS256 token with exp and email', async () => {
  expect(await verify(await token({ email: 'A@Example.com' }))).toBe('a@example.com');
});

test('refuses a token without exp', async () => {
  await expect(verify(await token({ email: 'a@example.com' }, false))).rejects.toThrow();
});

test('refuses a token without email', async () => {
  await expect(verify(await token({}))).rejects.toThrow();
});

test('refuses an HS256 token even with the right claims', async () => {
  const hs = await new SignJWT({ email: 'a@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('x'.repeat(32)));
  await expect(verify(hs)).rejects.toThrow();
});
```

Append to `apps/server/src/auth/auth.test.ts`:

```ts
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
  expect(lines.join('\n')).not.toContain('not-a-jwt-secret-value');
});
```

`createTestApp` gets an optional argument. In `apps/server/test/testApp.ts`, change the signature to `createTestApp(options: { logStream?: { write(line: string): void } } = {})` and pass `...(options.logStream ? { logStream: options.logStream } : {})` to `buildApp`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/auth`
Expected: FAIL on "refuses a token without exp" and on the log test (no `logStream` support, no warning). "refuses a token without email" and "refuses an HS256 token" may already pass (the verifier already throws on a missing email, and the local JWKS holds only an RSA key); they stay as regression tests.

- [ ] **Step 3: Implement**

In `apps/server/src/auth/accessVerifier.ts`, pass the algorithm and the required claims:

```ts
    const { payload } = await jwtVerify(token, options.jwks, {
      issuer: options.issuer,
      audience: options.audience,
      // Cloudflare Access signs RS256 and always sets exp; anything else is not from Access.
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'email'],
    });
```

In `apps/server/src/auth/authHook.ts`, log the reason in `emailOf`:

```ts
  try {
    return await verify(token);
  } catch (error) {
    request.log.warn(
      { reason: (error as { code?: string }).code ?? (error as Error).name },
      'access token rejected',
    );
    throw new HttpError(401, 'unauthenticated');
  }
```

In `apps/server/src/app.ts`, add `logStream?: { write(line: string): void }` to `AppDeps`, and build Fastify with:

```ts
  const app = Fastify({
    logger: deps.logStream ? { stream: deps.logStream } : config.nodeEnv !== 'test',
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "fix(server): accept only RS256 Access tokens with exp, and log rejected tokens"
```

---

### Task 2: Invoice, event, customer, and sync tables

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0001_invoices.sql` (generated)
- Modify: `apps/server/src/db/openDatabase.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, the Stage 1a-2 tables.
- Produces: tables `customers`, `invoices`, `invoiceEvents`, `syncState` (Drizzle objects in `src/db/schema.ts`).

Columns follow the RFC "Data Model", with these Stage 1a choices:
- `invoices.access_key` is unique and nullable (Stage 1b creates `pending` rows before the Sefin gives a key; SQLite unique indexes allow many NULLs).
- `invoices.xml_gzip` and `invoice_events.xml_gzip` hold the gzip of the official XML.
- `invoice_events` keeps `access_key` and a nullable `invoice_id`, so an event can arrive before its invoice (Review Focus 2). It is unique on `(access_key, code)`.
- `customers` is unique on `(emitter_id, document_type, document)`. `document_type` `NONE` (with `document` NULL) stands for a customer without a document; the sync does not create those (Task 4).
- `sync_state` has the primary key `(emitter_id, environment)` (Review Focus 1).

- [ ] **Step 1: Add the tables**

Append to `apps/server/src/db/schema.ts` (add `primaryKey` to the `drizzle-orm/sqlite-core` import):

```ts
export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    emitterId: text('emitter_id').notNull().references(() => emitters.id),
    documentType: text('document_type', { enum: ['CNPJ', 'CPF', 'NIF', 'NONE'] }).notNull(),
    document: text('document'),
    name: text('name').notNull(),
    municipalRegistration: text('municipal_registration'),
    address: text('address', { mode: 'json' }),
    email: text('email'),
    phone: text('phone'),
    origin: text('origin', { enum: ['manual', 'imported'] }).notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    manualFields: text('manual_fields', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex('customers_emitter_document').on(table.emitterId, table.documentType, table.document),
  ],
);

export const invoices = sqliteTable('invoices', {
  id: id(),
  emitterId: text('emitter_id').notNull().references(() => emitters.id),
  customerId: text('customer_id').references(() => customers.id),
  accessKey: text('access_key').unique(),
  number: text('number'),
  dpsId: text('dps_id'),
  dpsSeries: text('dps_series').notNull(),
  dpsNumber: integer('dps_number').notNull(),
  status: text('status', { enum: ['pending', 'issued', 'rejected', 'unknown', 'cancelled'] }).notNull(),
  environment: text('environment', { enum: ['producao', 'producao_restrita'] }).notNull(),
  issuedAt: integer('issued_at', { mode: 'timestamp_ms' }),
  competence: text('competence').notNull(),
  customerDocument: text('customer_document'),
  customerName: text('customer_name'),
  serviceCode: text('service_code').notNull(),
  description: text('description').notNull(),
  serviceCents: integer('service_cents').notNull(),
  issCents: integer('iss_cents'),
  netCents: integer('net_cents').notNull(),
  origin: text('origin', { enum: ['synced', 'app'] }).notNull(),
  templateOf: text('template_of'),
  xmlGzip: blob('xml_gzip', { mode: 'buffer' }),
  sefinMessages: text('sefin_messages', { mode: 'json' }),
  createdBy: text('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const invoiceEvents = sqliteTable(
  'invoice_events',
  {
    id: id(),
    emitterId: text('emitter_id').notNull().references(() => emitters.id),
    invoiceId: text('invoice_id').references(() => invoices.id),
    accessKey: text('access_key').notNull(),
    code: text('code').notNull(),
    reasonCode: text('reason_code'),
    justification: text('justification'),
    registeredAt: integer('registered_at', { mode: 'timestamp_ms' }).notNull(),
    xmlGzip: blob('xml_gzip', { mode: 'buffer' }).notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('invoice_events_key_code').on(table.accessKey, table.code)],
);

export const syncState = sqliteTable(
  'sync_state',
  {
    emitterId: text('emitter_id').notNull().references(() => emitters.id),
    environment: text('environment', { enum: ['producao', 'producao_restrita'] }).notNull(),
    lastNsu: integer('last_nsu').notNull().default(0),
    lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
  },
  (table) => [primaryKey({ columns: [table.emitterId, table.environment] })],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @notaflow/server exec drizzle-kit generate --name invoices`
Expected: `apps/server/drizzle/0001_invoices.sql` creates the four tables and the unique indexes `invoices_access_key_unique`, `invoice_events_key_code`, and `customers_emitter_document`. It must not alter the Stage 1a-2 tables.

- [ ] **Step 3: Write the failing test, then run it**

Append to `apps/server/src/db/openDatabase.test.ts` (it fails before Step 1 and passes after; if you wrote Step 1 first, check RED by temporarily renaming `drizzle/0001_invoices.sql`):

```ts
test('the invoice migration adds the sync tables', () => {
  const { db, close } = openDatabase(':memory:');
  const tables = (
    db.$client.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]
  ).map((t) => t.name);
  expect(tables).toEqual(expect.arrayContaining(['customers', 'invoices', 'invoice_events', 'sync_state']));
  close();
});
```

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -m "feat(server): tables for invoices, events, customers, and the sync cursor"
```

---

### Task 3: Customer, invoice, and sync-state repositories

**Files:**
- Create: `apps/server/src/repos/CustomerRepository.ts`, `InvoiceRepository.ts`, `SyncStateRepository.ts`, `SyncTargetRepository.ts`
- Create: `apps/server/src/repos/invoiceRepos.test.ts`
- Create: `apps/server/test/providerData.ts`

**Interfaces:**
- Consumes: the tables (Task 2); `AccountContext`, `ProviderInvoice`, `ProviderEvent`, `InvoiceParty`, `Environment` from `@notaflow/core`; `seedTenant` (Stage 1a-2); `EmitterRepository`.
- Produces:
  - `CustomerRepository.upsertImported(ctx, emitterId, party: InvoiceParty): string | null` (null when `party.document` is null); `list(ctx, filter: { emitterId?: string; search?: string }): CustomerRow[]`; `setManual(ctx, customerId, fields: Partial<Pick<CustomerRow, 'name' | 'email' | 'phone' | 'municipalRegistration'>>): boolean` (used by tests here and by Stage 1b)
  - `InvoiceRepository.upsertSynced(ctx, emitterId, invoice: ProviderInvoice, customerId: string | null): { id: string; created: boolean }`
  - `InvoiceRepository.recordEvent(ctx, emitterId, event: ProviderEvent): boolean` (false when the event already exists)
  - `InvoiceRepository.list(ctx, filter: InvoiceFilter): { items: InvoiceSummary[]; total: number }`
  - `InvoiceRepository.get(ctx, invoiceId): InvoiceDetail | null`, `InvoiceRepository.xml(ctx, invoiceId): string | null`
  - `InvoiceRepository.findIdByAccessKey(ctx, accessKey): string | null`
  - `interface InvoiceFilter { emitterId?: string; environment?: Environment; status?: InvoiceStatus; competenceFrom?: string; competenceTo?: string; search?: string; limit: number; offset: number }`
  - `SyncStateRepository.get(ctx, emitterId, environment): SyncStateRow` (a default row with `lastNsu` 0 when none exists), `saveCursor(ctx, emitterId, environment, lastNsu): void`, `recordRun(ctx, emitterId, environment, result: { at: Date; error: string | null }): void`
  - `SyncTargetRepository.list(): { accountId: string; accountStatus: 'active' | 'suspended'; emitterId: string }[]` (platform scope, for the scheduler)
  - `test/providerData.ts`: `providerInvoice(overrides?)`, `providerEvent(overrides?)` that build synthetic `ProviderInvoice` and `ProviderEvent` values with the gzip-able XML of the 1a-1 fixtures

Status rules:
- A synced invoice is `issued`, unless a stored event with code `101101` exists for its access key; then it is `cancelled`.
- `recordEvent` with code `101101` sets the linked invoice to `cancelled` and links `invoice_id` when the invoice exists.
- `upsertSynced` on an existing access key updates the projection but keeps a `cancelled` status.

Customer rules:
- Upsert by `(emitter, document type, document)`.
- A field listed in `manualFields` keeps its value; the other imported fields take the invoice values.
- `origin` stays `manual` for a customer created by hand (Stage 1b); an imported customer has `origin` `imported`.

- [ ] **Step 1: Write the test data helpers**

`apps/server/test/providerData.ts`:

```ts
import type { InvoiceParty, ProviderEvent, ProviderInvoice } from '@notaflow/core';

export const KEY = '35503082212345678000195000000000004226100000000420';

export function providerInvoice(overrides: Partial<ProviderInvoice> = {}): ProviderInvoice {
  const customer: InvoiceParty = {
    document: { type: 'CNPJ', value: '98765432000110' },
    name: 'Cliente Exemplo Ltda',
    email: 'financeiro@example.com',
  };
  return {
    accessKey: KEY,
    number: '42',
    environment: 'producao_restrita',
    issuedAt: new Date('2026-10-01T13:00:00Z'),
    competence: '2026-09-30',
    dps: { id: 'DPS355030821234567800019500900000000000000042', series: '900', number: 42 },
    provider: { cnpj: '12345678000195', name: 'EMPRESA TESTE LTDA' },
    customer,
    service: { nationalTaxCode: '010101', description: 'Consultoria em análise' },
    amounts: { serviceCents: 150000, issCents: 3000, netCents: 147000 },
    xml: '<NFSe>synthetic</NFSe>',
    ...overrides,
  };
}

export function providerEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    accessKey: KEY,
    code: '101101',
    registeredAt: new Date('2026-10-03T21:28:43Z'),
    reasonCode: '1',
    justification: 'Erro no valor do serviço',
    xml: '<evento>synthetic</evento>',
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`apps/server/src/repos/invoiceRepos.test.ts`:

```ts
import type { AccountContext } from '@notaflow/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { KEY, providerEvent, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { CustomerRepository } from './CustomerRepository';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceRepository } from './InvoiceRepository';
import { SyncStateRepository } from './SyncStateRepository';
import { SyncTargetRepository } from './SyncTargetRepository';

let db: Database;
let close: () => void;
let a: AccountContext;
let b: AccountContext;
let emitterId: string;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
  a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
});
afterEach(() => close());

describe('CustomerRepository', () => {
  test('upserts by document and keeps fields edited by hand', () => {
    const customers = new CustomerRepository(db);
    const party = providerInvoice().customer;
    if (!party) throw new Error('fixture has a customer');
    const id = customers.upsertImported(a, emitterId, party);
    expect(id).toEqual(expect.any(String));
    customers.setManual(a, id ?? '', { email: 'manual@example.com' });
    const again = customers.upsertImported(a, emitterId, { ...party, name: 'Novo Nome', email: 'x@example.com' });
    expect(again).toBe(id);
    expect(customers.list(a, { emitterId })).toEqual([
      expect.objectContaining({ name: 'Novo Nome', email: 'manual@example.com', origin: 'imported' }),
    ]);
  });

  test('a customer without a document is not stored', () => {
    expect(new CustomerRepository(db).upsertImported(a, emitterId, { document: null, name: 'X' })).toBeNull();
  });

  test('another account sees no customer and cannot upsert into this emitter', () => {
    const customers = new CustomerRepository(db);
    const party = providerInvoice().customer;
    if (!party) throw new Error('fixture has a customer');
    customers.upsertImported(a, emitterId, party);
    expect(customers.list(b, {})).toEqual([]);
    expect(() => customers.upsertImported(b, emitterId, party)).toThrow(/not found/);
  });
});

describe('InvoiceRepository', () => {
  test('upsertSynced creates once and updates on the second call', () => {
    const invoices = new InvoiceRepository(db);
    const first = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    const second = invoices.upsertSynced(a, emitterId, providerInvoice({ number: '43' }), null);
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(invoices.list(a, { limit: 50, offset: 0 })).toMatchObject({ total: 1, items: [{ number: '43', status: 'issued' }] });
  });

  test('an event that arrives before its invoice makes the invoice cancelled on arrival', () => {
    const invoices = new InvoiceRepository(db);
    expect(invoices.recordEvent(a, emitterId, providerEvent())).toBe(true);
    expect(invoices.recordEvent(a, emitterId, providerEvent())).toBe(false);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    expect(invoices.get(a, id)).toMatchObject({ status: 'cancelled', events: [{ code: '101101', reasonCode: '1' }] });
  });

  test('a cancellation after the invoice cancels it, and a later re-sync keeps it cancelled', () => {
    const invoices = new InvoiceRepository(db);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    invoices.recordEvent(a, emitterId, providerEvent());
    invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    expect(invoices.get(a, id)?.status).toBe('cancelled');
  });

  test('findIdByAccessKey finds only an invoice of the account', () => {
    const invoices = new InvoiceRepository(db);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    expect(invoices.findIdByAccessKey(a, KEY)).toBe(id);
    expect(invoices.findIdByAccessKey(b, KEY)).toBeNull();
  });

  test('stores and returns the official XML', () => {
    const invoices = new InvoiceRepository(db);
    const { id } = invoices.upsertSynced(a, emitterId, providerInvoice({ xml: '<NFSe>ção</NFSe>' }), null);
    expect(invoices.xml(a, id)).toBe('<NFSe>ção</NFSe>');
    expect(invoices.xml(b, id)).toBeNull();
  });

  test('list filters by status, competence, and a search on number or customer name', () => {
    const invoices = new InvoiceRepository(db);
    invoices.upsertSynced(a, emitterId, providerInvoice(), null);
    invoices.upsertSynced(
      a,
      emitterId,
      providerInvoice({
        accessKey: KEY.replace('0042', '0043'),
        number: '43',
        competence: '2026-08-31',
        customer: { document: { type: 'NIF', value: '00-0000000' }, name: 'Foreign Inc' },
      }),
      null,
    );
    expect(invoices.list(a, { competenceFrom: '2026-09-01', limit: 50, offset: 0 }).total).toBe(1);
    expect(invoices.list(a, { search: 'foreign', limit: 50, offset: 0 }).items.map((i) => i.number)).toEqual(['43']);
    expect(invoices.list(a, { status: 'cancelled', limit: 50, offset: 0 }).total).toBe(0);
    expect(invoices.list(b, { limit: 50, offset: 0 }).total).toBe(0);
  });
});

describe('SyncStateRepository and SyncTargetRepository', () => {
  test('the cursor is kept per environment', () => {
    const state = new SyncStateRepository(db);
    expect(state.get(a, emitterId, 'producao_restrita').lastNsu).toBe(0);
    state.saveCursor(a, emitterId, 'producao_restrita', 12);
    expect(state.get(a, emitterId, 'producao_restrita').lastNsu).toBe(12);
    expect(state.get(a, emitterId, 'producao').lastNsu).toBe(0);
    state.recordRun(a, emitterId, 'producao_restrita', { at: new Date(), error: 'HTTP 429' });
    expect(state.get(a, emitterId, 'producao_restrita')).toMatchObject({ lastNsu: 12, lastError: 'HTTP 429' });
  });

  test('the scheduler sees every emitter of every account', () => {
    expect(new SyncTargetRepository(db).list()).toEqual([
      { accountId: a.accountId, accountStatus: 'active', emitterId },
    ]);
  });
});
```

The search test builds a second access key by replacing `0042` with `0043` inside `KEY`. `KEY` contains `0042` once (the NFS-e number field), so the result is still 50 characters.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/repos/invoiceRepos.test.ts`
Expected: FAIL, the new repository modules do not exist.

- [ ] **Step 4: Implement the repositories**

`apps/server/src/repos/CustomerRepository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { AccountContext, InvoiceParty } from '@notaflow/core';
import { and, eq, like, or } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { customers, emitters } from '../db/schema';

export type CustomerRow = typeof customers.$inferSelect;
type EditableField = 'name' | 'email' | 'phone' | 'municipalRegistration' | 'address';

export class CustomerRepository {
  constructor(private readonly db: Database) {}

  upsertImported(ctx: AccountContext, emitterId: string, party: InvoiceParty): string | null {
    if (!party.document) return null;
    this.requireEmitter(ctx, emitterId);
    const { type, value } = party.document;
    const imported: Partial<Record<EditableField, unknown>> = {
      name: party.name,
      email: party.email ?? null,
      phone: party.phone ?? null,
      municipalRegistration: party.municipalRegistration ?? null,
      address: party.address ?? null,
    };
    const existing = this.db
      .select()
      .from(customers)
      .where(and(eq(customers.emitterId, emitterId), eq(customers.documentType, type), eq(customers.document, value)))
      .get();
    if (!existing) {
      const id = randomUUID();
      this.db
        .insert(customers)
        .values({ id, emitterId, documentType: type, document: value, origin: 'imported', ...imported, name: party.name })
        .run();
      return id;
    }
    const kept = new Set(existing.manualFields);
    const changes = Object.fromEntries(Object.entries(imported).filter(([field]) => !kept.has(field)));
    this.db.update(customers).set({ ...changes, updatedAt: new Date() }).where(eq(customers.id, existing.id)).run();
    return existing.id;
  }

  setManual(
    ctx: AccountContext,
    customerId: string,
    fields: Partial<Pick<CustomerRow, 'name' | 'email' | 'phone' | 'municipalRegistration'>>,
  ): boolean {
    const row = this.get(ctx, customerId);
    if (!row) return false;
    const manualFields = [...new Set([...row.manualFields, ...Object.keys(fields)])];
    this.db.update(customers).set({ ...fields, manualFields, updatedAt: new Date() }).where(eq(customers.id, customerId)).run();
    return true;
  }

  list(ctx: AccountContext, filter: { emitterId?: string; search?: string }): CustomerRow[] {
    const conditions = [eq(emitters.accountId, ctx.accountId), eq(customers.archived, false)];
    if (filter.emitterId) conditions.push(eq(customers.emitterId, filter.emitterId));
    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(like(customers.name, pattern), like(customers.document, pattern));
      if (match) conditions.push(match);
    }
    return this.db
      .select({ customer: customers })
      .from(customers)
      .innerJoin(emitters, eq(emitters.id, customers.emitterId))
      .where(and(...conditions))
      .orderBy(customers.name)
      .all()
      .map((row) => row.customer);
  }

  private get(ctx: AccountContext, customerId: string): CustomerRow | null {
    const row = this.db
      .select({ customer: customers })
      .from(customers)
      .innerJoin(emitters, eq(emitters.id, customers.emitterId))
      .where(and(eq(customers.id, customerId), eq(emitters.accountId, ctx.accountId)))
      .get();
    return row?.customer ?? null;
  }

  private requireEmitter(ctx: AccountContext, emitterId: string): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
  }
}
```

SQLite `LIKE` is case-insensitive for ASCII, which the "foreign" search test relies on.

`apps/server/src/repos/InvoiceRepository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AccountContext, Environment, ProviderEvent, ProviderInvoice } from '@notaflow/core';
import { and, asc, count, desc, eq, gte, like, lte, or, type SQL } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters, invoiceEvents, invoices } from '../db/schema';

export type InvoiceStatus = (typeof invoices.$inferSelect)['status'];
export const CANCELLATION = '101101';

export interface InvoiceFilter {
  emitterId?: string;
  environment?: Environment;
  status?: InvoiceStatus;
  competenceFrom?: string;
  competenceTo?: string;
  search?: string;
  limit: number;
  offset: number;
}

const summary = {
  id: invoices.id,
  emitterId: invoices.emitterId,
  accessKey: invoices.accessKey,
  number: invoices.number,
  status: invoices.status,
  environment: invoices.environment,
  issuedAt: invoices.issuedAt,
  competence: invoices.competence,
  customerDocument: invoices.customerDocument,
  customerName: invoices.customerName,
  serviceCode: invoices.serviceCode,
  description: invoices.description,
  serviceCents: invoices.serviceCents,
  issCents: invoices.issCents,
  netCents: invoices.netCents,
  origin: invoices.origin,
};

export class InvoiceRepository {
  constructor(private readonly db: Database) {}

  upsertSynced(
    ctx: AccountContext,
    emitterId: string,
    invoice: ProviderInvoice,
    customerId: string | null,
  ): { id: string; created: boolean } {
    this.requireEmitter(ctx, emitterId);
    const cancelled = this.db
      .select({ id: invoiceEvents.id })
      .from(invoiceEvents)
      .where(and(eq(invoiceEvents.accessKey, invoice.accessKey), eq(invoiceEvents.code, CANCELLATION)))
      .get();
    const projection = {
      customerId,
      number: invoice.number,
      dpsId: invoice.dps.id,
      dpsSeries: invoice.dps.series,
      dpsNumber: invoice.dps.number,
      environment: invoice.environment,
      issuedAt: invoice.issuedAt,
      competence: invoice.competence,
      customerDocument: invoice.customer?.document?.value ?? null,
      customerName: invoice.customer?.name ?? null,
      serviceCode: invoice.service.nationalTaxCode,
      description: invoice.service.description,
      serviceCents: invoice.amounts.serviceCents,
      issCents: invoice.amounts.issCents ?? null,
      netCents: invoice.amounts.netCents,
      xmlGzip: gzipSync(invoice.xml),
      updatedAt: new Date(),
    };
    const existing = this.db.select().from(invoices).where(eq(invoices.accessKey, invoice.accessKey)).get();
    if (existing) {
      const status = existing.status === 'cancelled' || cancelled ? 'cancelled' : existing.status;
      this.db.update(invoices).set({ ...projection, status }).where(eq(invoices.id, existing.id)).run();
      return { id: existing.id, created: false };
    }
    const id = randomUUID();
    this.db
      .insert(invoices)
      .values({
        ...projection,
        id,
        emitterId,
        accessKey: invoice.accessKey,
        status: cancelled ? 'cancelled' : 'issued',
        origin: 'synced',
      })
      .run();
    this.db
      .update(invoiceEvents)
      .set({ invoiceId: id })
      .where(eq(invoiceEvents.accessKey, invoice.accessKey))
      .run();
    return { id, created: true };
  }

  recordEvent(ctx: AccountContext, emitterId: string, event: ProviderEvent): boolean {
    this.requireEmitter(ctx, emitterId);
    const invoice = this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.accessKey, event.accessKey), eq(invoices.emitterId, emitterId)))
      .get();
    const inserted = this.db
      .insert(invoiceEvents)
      .values({
        id: randomUUID(),
        emitterId,
        invoiceId: invoice?.id ?? null,
        accessKey: event.accessKey,
        code: event.code,
        reasonCode: event.reasonCode ?? null,
        justification: event.justification ?? null,
        registeredAt: event.registeredAt,
        xmlGzip: gzipSync(event.xml),
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return false;
    if (invoice && event.code === CANCELLATION) {
      this.db.update(invoices).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(invoices.id, invoice.id)).run();
    }
    return true;
  }

  list(ctx: AccountContext, filter: InvoiceFilter) {
    const conditions: SQL[] = [eq(emitters.accountId, ctx.accountId)];
    if (filter.emitterId) conditions.push(eq(invoices.emitterId, filter.emitterId));
    if (filter.environment) conditions.push(eq(invoices.environment, filter.environment));
    if (filter.status) conditions.push(eq(invoices.status, filter.status));
    if (filter.competenceFrom) conditions.push(gte(invoices.competence, filter.competenceFrom));
    if (filter.competenceTo) conditions.push(lte(invoices.competence, filter.competenceTo));
    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(like(invoices.number, pattern), like(invoices.customerName, pattern), like(invoices.customerDocument, pattern));
      if (match) conditions.push(match);
    }
    const where = and(...conditions);
    const total =
      this.db.select({ value: count() }).from(invoices).innerJoin(emitters, eq(emitters.id, invoices.emitterId)).where(where).get()
        ?.value ?? 0;
    const items = this.db
      .select(summary)
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(where)
      .orderBy(desc(invoices.competence), desc(invoices.issuedAt))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();
    return { items, total };
  }

  get(ctx: AccountContext, invoiceId: string) {
    const row = this.db
      .select(summary)
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!row) return null;
    const events = this.db
      .select({
        code: invoiceEvents.code,
        reasonCode: invoiceEvents.reasonCode,
        justification: invoiceEvents.justification,
        registeredAt: invoiceEvents.registeredAt,
      })
      .from(invoiceEvents)
      .where(eq(invoiceEvents.accessKey, row.accessKey ?? ''))
      .orderBy(asc(invoiceEvents.registeredAt))
      .all();
    return { ...row, events };
  }

  xml(ctx: AccountContext, invoiceId: string): string | null {
    const row = this.db
      .select({ xmlGzip: invoices.xmlGzip })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
      .get();
    return row?.xmlGzip ? gunzipSync(row.xmlGzip).toString('utf8') : null;
  }

  findIdByAccessKey(ctx: AccountContext, accessKey: string): string | null {
    const row = this.db
      .select({ id: invoices.id })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.accessKey, accessKey), eq(emitters.accountId, ctx.accountId)))
      .get();
    return row?.id ?? null;
  }

  private requireEmitter(ctx: AccountContext, emitterId: string): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
  }
}

export type InvoiceSummary = ReturnType<InvoiceRepository['list']>['items'][number];
export type InvoiceDetail = NonNullable<ReturnType<InvoiceRepository['get']>>;
```

`apps/server/src/repos/SyncStateRepository.ts`:

```ts
import type { AccountContext, Environment } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters, syncState } from '../db/schema';

export type SyncStateRow = typeof syncState.$inferSelect;

export class SyncStateRepository {
  constructor(private readonly db: Database) {}

  get(ctx: AccountContext, emitterId: string, environment: Environment): SyncStateRow {
    const row = this.db
      .select({ state: syncState })
      .from(syncState)
      .innerJoin(emitters, eq(emitters.id, syncState.emitterId))
      .where(
        and(eq(syncState.emitterId, emitterId), eq(syncState.environment, environment), eq(emitters.accountId, ctx.accountId)),
      )
      .get();
    return row?.state ?? { emitterId, environment, lastNsu: 0, lastRunAt: null, lastSuccessAt: null, lastError: null };
  }

  saveCursor(ctx: AccountContext, emitterId: string, environment: Environment, lastNsu: number): void {
    this.upsert(ctx, emitterId, environment, { lastNsu });
  }

  recordRun(ctx: AccountContext, emitterId: string, environment: Environment, result: { at: Date; error: string | null }): void {
    this.upsert(ctx, emitterId, environment, {
      lastRunAt: result.at,
      lastError: result.error,
      ...(result.error === null ? { lastSuccessAt: result.at } : {}),
    });
  }

  private upsert(ctx: AccountContext, emitterId: string, environment: Environment, values: Partial<SyncStateRow>): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
    this.db
      .insert(syncState)
      .values({ emitterId, environment, ...values })
      .onConflictDoUpdate({ target: [syncState.emitterId, syncState.environment], set: values })
      .run();
  }
}
```

`apps/server/src/repos/SyncTargetRepository.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, emitters } from '../db/schema';

// Platform scope: the scheduler runs for every account, before any account context exists.
export class SyncTargetRepository {
  constructor(private readonly db: Database) {}

  list() {
    return this.db
      .select({ accountId: accounts.id, accountStatus: accounts.status, emitterId: emitters.id })
      .from(emitters)
      .innerJoin(accounts, eq(accounts.id, emitters.accountId))
      .all();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): repositories for invoices, events, customers, and the sync cursor"
```

---

### Task 4: Apply sync documents

**Files:**
- Create: `apps/server/src/sync/applyDocument.ts`, `apps/server/src/sync/applyDocument.test.ts`

**Interfaces:**
- Consumes: `CustomerRepository`, `InvoiceRepository` (Task 3); `SyncDocument` from `@notaflow/core`; `providerInvoice`, `providerEvent` (Task 3).
- Produces:
  - `interface ApplyCounts { invoices: number; events: number; skipped: number }`
  - `applyDocument(repos: { customers: CustomerRepository; invoices: InvoiceRepository }, ctx: AccountContext, emitterId: string, document: SyncDocument, counts: ApplyCounts): void`

This is the one place that turns a `SyncDocument` into rows. The sync job (Task 5) and the lookup by access key (Task 7) both use it, so a found invoice is stored "through the same path as the sync" (RFC "Flow: find by access key").

- [ ] **Step 1: Write the failing tests**

`apps/server/src/sync/applyDocument.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { providerEvent, providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { type ApplyCounts, applyDocument } from './applyDocument';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

function setup() {
  const ctx = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const emitterId = new EmitterRepository(db).create(ctx, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  const repos = { customers: new CustomerRepository(db), invoices: new InvoiceRepository(db) };
  const counts: ApplyCounts = { invoices: 0, events: 0, skipped: 0 };
  return { ctx, emitterId, repos, counts };
}

test('an invoice document stores the invoice and its customer', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(repos, ctx, emitterId, { kind: 'invoice', nsu: 1, invoice: providerInvoice() }, counts);
  expect(counts).toEqual({ invoices: 1, events: 0, skipped: 0 });
  const { items } = repos.invoices.list(ctx, { limit: 10, offset: 0 });
  expect(items).toMatchObject([{ number: '42', status: 'issued', customerName: 'Cliente Exemplo Ltda' }]);
  expect(repos.customers.list(ctx, { emitterId })).toHaveLength(1);
});

test('the same documents twice create nothing new', () => {
  const { ctx, emitterId, repos, counts } = setup();
  for (let round = 0; round < 2; round++) {
    applyDocument(repos, ctx, emitterId, { kind: 'invoice', nsu: 1, invoice: providerInvoice() }, counts);
    applyDocument(repos, ctx, emitterId, { kind: 'event', nsu: 2, event: providerEvent() }, counts);
  }
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).total).toBe(1);
  expect(repos.customers.list(ctx, {})).toHaveLength(1);
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).items[0]?.status).toBe('cancelled');
});

test('an event before its invoice still ends with a cancelled invoice', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(repos, ctx, emitterId, { kind: 'event', nsu: 1, event: providerEvent() }, counts);
  applyDocument(repos, ctx, emitterId, { kind: 'invoice', nsu: 2, invoice: providerInvoice() }, counts);
  expect(repos.invoices.list(ctx, { limit: 10, offset: 0 }).items[0]?.status).toBe('cancelled');
});

test('a skipped document only counts', () => {
  const { ctx, emitterId, repos, counts } = setup();
  applyDocument(repos, ctx, emitterId, { kind: 'skipped', nsu: 1, reason: 'received invoice' }, counts);
  expect(counts).toEqual({ invoices: 0, events: 0, skipped: 1 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/sync`
Expected: FAIL, `./applyDocument` does not exist.

- [ ] **Step 3: Implement**

`apps/server/src/sync/applyDocument.ts`:

```ts
import type { AccountContext, SyncDocument } from '@notaflow/core';
import type { CustomerRepository } from '../repos/CustomerRepository';
import type { InvoiceRepository } from '../repos/InvoiceRepository';

export interface ApplyCounts {
  invoices: number;
  events: number;
  skipped: number;
}

export function applyDocument(
  repos: { customers: CustomerRepository; invoices: InvoiceRepository },
  ctx: AccountContext,
  emitterId: string,
  document: SyncDocument,
  counts: ApplyCounts,
): void {
  if (document.kind === 'invoice') {
    const { customer } = document.invoice;
    const customerId = customer ? repos.customers.upsertImported(ctx, emitterId, customer) : null;
    repos.invoices.upsertSynced(ctx, emitterId, document.invoice, customerId);
    counts.invoices++;
  } else if (document.kind === 'event') {
    repos.invoices.recordEvent(ctx, emitterId, document.event);
    counts.events++;
  } else {
    counts.skipped++;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): apply ADN sync documents to invoices, events, and customers"
```

---

### Task 5: Sync service with cursor, retries, and a per-emitter lock

**Files:**
- Create: `apps/server/src/sync/SyncService.ts`, `apps/server/src/sync/SyncService.test.ts`
- Create: `apps/server/test/fakeInvoices.ts`

**Interfaces:**
- Consumes: `applyDocument` (Task 4); `CustomerRepository`, `InvoiceRepository`, `SyncStateRepository` (Task 3); `EmitterRepository`, `VaultCertificateStore`, `ProviderFactory`, `nacionalProviderFactory` (Stage 1a-2); `NacionalHttpError` from `@notaflow/provider-nacional`.
- Produces:
  - `class SyncService`, `constructor(deps: { db: Database; certificates: CertificateStore; providerFactory: ProviderFactory; retryDelaysMs?: number[]; maxBatches?: number; now?: () => Date })`
  - `syncEmitter(ctx: AccountContext, emitterId: string): Promise<SyncResult>`
  - `isRunning(emitterId: string): boolean`
  - `interface SyncResult { environment: Environment; batches: number; invoices: number; events: number; skipped: number; lastNsu: number; error: string | null }`
  - `class SyncBusyError extends Error` (thrown when the emitter is already syncing)
  - `test/fakeInvoices.ts`: `issueOnFake(fake: Pick<FakeNacional, 'urls'>, count: number, start?: number): Promise<string[]>` returns the access keys; `cancelOnFake(fake, accessKey)`

Rules (RFC "Flow: sync from the ADN"):
- Read the active certificate and the emitter's current environment; read the cursor of that environment.
- Loop: `fetchSince(cursor)` with retries; in one transaction, apply every document and save the new cursor; stop when `hasMore` is false or after `maxBatches` (default 200).
- A retryable failure (`NacionalHttpError` with `retryable`, or any error that is not a `NacionalHttpError`) waits `retryDelaysMs[i]` (default `[1000, 5000, 15000]`) and tries again. After the last one, or on a non-retryable error, stop, record the error, and return it in `SyncResult.error`. Batches committed before the error stay committed.
- Record `lastRunAt` always and `lastSuccessAt` only on success.
- One sync per emitter at a time: a second call while one runs throws `SyncBusyError`.
- No active certificate: record and return the error `no active certificate`.

- [ ] **Step 1: Write the fake helper and the failing tests**

`apps/server/test/fakeInvoices.ts`:

```ts
import type { FakeNacional } from '@notaflow/fake-nacional';
import {
  buildCancelEventXml,
  buildDpsXml,
  type DpsInput,
  NacionalClient,
} from '@notaflow/provider-nacional';
import { Agent } from 'undici';

const base: DpsInput = {
  environment: 'producao_restrita',
  issuedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-test',
  series: '900',
  number: 1,
  competence: '2026-10-01',
  emitterMunicipality: '3550308',
  provider: { cnpj: '12345678000195', simplesNacional: '1', specialRegime: '0' },
  customer: { document: { type: 'CNPJ', value: '98765432000110' }, name: 'Cliente Exemplo Ltda' },
  service: { municipality: '3550308', nationalTaxCode: '010101', description: 'Consultoria' },
  amounts: { serviceCents: 150000 },
  tax: { issqnTaxation: '1', issRetention: '1' },
};

// The fake does not check signatures, so these DPS are sent unsigned.
export async function issueOnFake(
  fake: Pick<FakeNacional, 'urls'>,
  count: number,
  start = 1,
): Promise<string[]> {
  const client = new NacionalClient({ environment: 'producao_restrita', dispatcher: new Agent(), urls: fake.urls });
  const keys: string[] = [];
  for (let n = start; n < start + count; n++) {
    const result = await client.issue(buildDpsXml({ ...base, number: n }).xml);
    if (result.kind !== 'issued') throw new Error(`fake did not issue: ${JSON.stringify(result)}`);
    keys.push(result.accessKey);
  }
  return keys;
}

export async function cancelOnFake(
  fake: Pick<FakeNacional, 'urls'>,
  accessKey: string,
): Promise<void> {
  const client = new NacionalClient({ environment: 'producao_restrita', dispatcher: new Agent(), urls: fake.urls });
  const { xml } = buildCancelEventXml({
    environment: 'producao_restrita',
    requestedAt: new Date(),
    appVersion: 'notaflow-test',
    authorCnpj: '12345678000195',
    accessKey,
    reason: '1',
    justification: 'Teste de cancelamento no fake',
  });
  const result = await client.registerEvent(accessKey, xml);
  if (result.kind !== 'registered') throw new Error('fake did not cancel');
}
```

`apps/server/src/sync/SyncService.test.ts`:

```ts
import { type FakeNacional, startFakeNacional } from '@notaflow/fake-nacional';
import { makeTestCertificate } from '@notaflow/test-kit';
import type { AccountContext } from '@notaflow/core';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cancelOnFake, issueOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { nacionalProviderFactory } from '../providers/providerFactory';
import { CertificateRepository } from '../repos/CertificateRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { SyncStateRepository } from '../repos/SyncStateRepository';
import { sealCertificate } from '../vault/envelope';
import { VaultCertificateStore } from '../vault/VaultCertificateStore';
import { SyncBusyError, SyncService } from './SyncService';

const MASTER = Buffer.alloc(32, 5);
let fake: FakeNacional;
let db: Database;
let close: () => void;
let ctx: AccountContext;
let emitterId: string;
let service: SyncService;

beforeEach(async () => {
  fake = await startFakeNacional();
  ({ db, close } = openDatabase(':memory:'));
  ctx = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  emitterId = new EmitterRepository(db).create(ctx, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  const cert = makeTestCertificate();
  const certificates = new CertificateRepository(db);
  certificates.addActive(ctx, emitterId, sealCertificate(cert.pfx, cert.password, MASTER), {
    cnpj: cert.cnpj,
    subject: 'x',
    validFrom: new Date(),
    validTo: new Date(Date.now() + 86_400_000),
    fingerprintSha256: 'ab'.repeat(32),
    uploadedBy: ctx.userId,
  });
  service = new SyncService({
    db,
    certificates: new VaultCertificateStore(certificates, MASTER),
    providerFactory: nacionalProviderFactory(fake.urls),
    retryDelaysMs: [0, 0],
  });
});
afterEach(async () => {
  close();
  await fake.close();
});

test('syncs every invoice and event, then a second run finds nothing new', async () => {
  const keys = await issueOnFake(fake, 3);
  await cancelOnFake(fake, keys[0] ?? '');
  const first = await service.syncEmitter(ctx, emitterId);
  expect(first).toMatchObject({ environment: 'producao_restrita', invoices: 3, events: 1, lastNsu: 4, error: null });
  const invoices = new InvoiceRepository(db).list(ctx, { limit: 10, offset: 0 });
  expect(invoices.total).toBe(3);
  expect(invoices.items.filter((i) => i.status === 'cancelled')).toHaveLength(1);
  expect(await service.syncEmitter(ctx, emitterId)).toMatchObject({ invoices: 0, events: 0, lastNsu: 4 });
});

test('walks more than one batch of 50', async () => {
  await issueOnFake(fake, 51);
  expect(await service.syncEmitter(ctx, emitterId)).toMatchObject({ invoices: 51, lastNsu: 51 });
});

test('a 429 is retried, and after the last retry the error is recorded with the cursor kept', async () => {
  await issueOnFake(fake, 51);
  fake.next('dfe', { kind: 'reply', status: 429, body: {} });
  expect((await service.syncEmitter(ctx, emitterId)).error).toBeNull();

  await issueOnFake(fake, 1, 52);
  for (let i = 0; i < 3; i++) fake.next('dfe', { kind: 'reply', status: 429, body: {} });
  const failed = await service.syncEmitter(ctx, emitterId);
  expect(failed.error).toMatch(/429/);
  const state = new SyncStateRepository(db).get(ctx, emitterId, 'producao_restrita');
  expect(state).toMatchObject({ lastNsu: 51, lastError: expect.stringMatching(/429/) });
  expect(await service.syncEmitter(ctx, emitterId)).toMatchObject({ invoices: 1, lastNsu: 52, error: null });
});

test('the cursor of producao does not reuse the cursor of producao_restrita', async () => {
  await issueOnFake(fake, 2);
  await service.syncEmitter(ctx, emitterId);
  new EmitterRepository(db).setEnvironment(ctx, emitterId, 'producao');
  const production = await service.syncEmitter(ctx, emitterId);
  expect(production).toMatchObject({ environment: 'producao', lastNsu: 2 });
  expect(new SyncStateRepository(db).get(ctx, emitterId, 'producao_restrita').lastNsu).toBe(2);
});

test('a second sync of the same emitter while one runs is refused', async () => {
  await issueOnFake(fake, 1);
  fake.next('dfe', { kind: 'delay', ms: 100 });
  const running = service.syncEmitter(ctx, emitterId);
  expect(service.isRunning(emitterId)).toBe(true);
  await expect(service.syncEmitter(ctx, emitterId)).rejects.toThrow(SyncBusyError);
  await running;
  expect(service.isRunning(emitterId)).toBe(false);
});
```

The "producao" test talks to the same fake: the fake does not separate environments, so the production cursor starting from 0 shows in `lastNsu` 2 being reached again from 0 while the restrita cursor stays at 2. The point under test is that the two cursors are separate rows.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/sync/SyncService.test.ts`
Expected: FAIL, `./SyncService` does not exist.

- [ ] **Step 3: Implement**

`apps/server/src/sync/SyncService.ts`:

```ts
import type { AccountContext, CertificateStore, Environment } from '@notaflow/core';
import { NacionalHttpError } from '@notaflow/provider-nacional';
import type { Database } from '../db/openDatabase';
import type { ProviderFactory } from '../providers/providerFactory';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { SyncStateRepository } from '../repos/SyncStateRepository';
import { type ApplyCounts, applyDocument } from './applyDocument';

export interface SyncResult extends ApplyCounts {
  environment: Environment;
  batches: number;
  lastNsu: number;
  error: string | null;
}

export class SyncBusyError extends Error {
  constructor() {
    super('This emitter is already syncing.');
    this.name = 'SyncBusyError';
  }
}

export class SyncService {
  private readonly running = new Set<string>();
  private readonly emitters: EmitterRepository;
  private readonly customers: CustomerRepository;
  private readonly invoices: InvoiceRepository;
  private readonly state: SyncStateRepository;

  constructor(
    private readonly deps: {
      db: Database;
      certificates: CertificateStore;
      providerFactory: ProviderFactory;
      retryDelaysMs?: number[];
      maxBatches?: number;
      now?: () => Date;
    },
  ) {
    this.emitters = new EmitterRepository(deps.db);
    this.customers = new CustomerRepository(deps.db);
    this.invoices = new InvoiceRepository(deps.db);
    this.state = new SyncStateRepository(deps.db);
  }

  isRunning(emitterId: string): boolean {
    return this.running.has(emitterId);
  }

  async syncEmitter(ctx: AccountContext, emitterId: string): Promise<SyncResult> {
    if (this.running.has(emitterId)) throw new SyncBusyError();
    this.running.add(emitterId);
    try {
      return await this.run(ctx, emitterId);
    } finally {
      this.running.delete(emitterId);
    }
  }

  private async run(ctx: AccountContext, emitterId: string): Promise<SyncResult> {
    const emitter = this.emitters.get(ctx, emitterId);
    if (!emitter) throw new Error('Emitter not found in this account.');
    const environment = emitter.environment;
    const result: SyncResult = {
      environment,
      batches: 0,
      invoices: 0,
      events: 0,
      skipped: 0,
      lastNsu: this.state.get(ctx, emitterId, environment).lastNsu,
      error: null,
    };
    try {
      const certificate = await this.deps.certificates.loadActive(ctx, emitterId);
      if (!certificate) throw new Error('no active certificate');
      const provider = this.deps.providerFactory({ environment, certificate });
      for (let n = 0; n < (this.deps.maxBatches ?? 200); n++) {
        const batch = await this.withRetry(() => provider.fetchSince(result.lastNsu));
        this.deps.db.transaction(() => {
          for (const document of batch.documents) {
            applyDocument({ customers: this.customers, invoices: this.invoices }, ctx, emitterId, document, result);
          }
          this.state.saveCursor(ctx, emitterId, environment, batch.lastNsu);
        });
        result.batches++;
        result.lastNsu = batch.lastNsu;
        if (!batch.hasMore) break;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    this.state.recordRun(ctx, emitterId, environment, { at: this.now(), error: result.error });
    return result;
  }

  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    const delays = this.deps.retryDelaysMs ?? [1000, 5000, 15000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        const retryable = !(error instanceof NacionalHttpError) || error.retryable;
        const delay = delays[attempt];
        if (!retryable || delay === undefined) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
```

`NacionalHttpError` has the message `Unexpected HTTP 429 from the national NFS-e API`, which is what the 429 test matches.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS. In the 429 test, three queued 429 replies exceed one try plus two retries (`retryDelaysMs: [0, 0]`), so the third run of the loop gives up, which is the point.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): ADN sync service with a cursor per environment, retries, and a lock"
```

---

### Task 6: Scheduler, sync routes, and the first sync after onboarding

**Files:**
- Create: `apps/server/src/sync/scheduler.ts`, `apps/server/src/sync/scheduler.test.ts`
- Create: `apps/server/src/routes/sync.ts`, `apps/server/src/routes/sync.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/routes/emitters.ts`, `apps/server/src/main.ts`, `apps/server/test/testApp.ts`

**Interfaces:**
- Consumes: `SyncService`, `SyncBusyError` (Task 5); `SyncTargetRepository`, `SyncStateRepository` (Task 3); `accountContext` (Stage 1a-2).
- Produces:
  - `runAllOnce(deps: { targets: SyncTargetRepository; sync: SyncService; log?: (message: string, data: object) => void }): Promise<void>`
  - `startScheduler(run: () => Promise<void>, intervalMs: number): { stop(): void }` (does not overlap runs)
  - `AppDeps.syncService?: SyncService` (default: built from the app's database, vault, and provider factory)
  - `AppDeps.onEmitterCreated?: (ctx: AccountContext, emitterId: string) => void` (default: runs `syncService.syncEmitter` in the background and logs the result)
  - `GET /api/accounts/:accountId/emitters/:emitterId/sync` → `200 { lastNsu, lastRunAt, lastSuccessAt, lastError, running, environment }`
  - `POST /api/accounts/:accountId/emitters/:emitterId/sync` (any member, write) → `200 SyncResult`, `404 not_found`, `409 sync_running`
  - `test/testApp.ts`: the test app passes `onEmitterCreated: () => {}`, so tests never sync in the background after the database is closed

- [ ] **Step 1: Write the failing tests**

`apps/server/src/sync/scheduler.test.ts`:

```ts
import { expect, test, vi } from 'vitest';
import { startScheduler } from './scheduler';

test('runs on every interval and never overlaps a slow run', async () => {
  vi.useFakeTimers();
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  const scheduler = startScheduler(async () => {
    runs++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 250));
    active--;
  }, 100);
  await vi.advanceTimersByTimeAsync(1000);
  scheduler.stop();
  vi.useRealTimers();
  expect(maxActive).toBe(1);
  expect(runs).toBeGreaterThanOrEqual(3);
});
```

`apps/server/src/routes/sync.test.ts`:

```ts
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
    environment: 'producao_restrita',
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/sync/scheduler.test.ts apps/server/src/routes/sync.test.ts`
Expected: FAIL, `./scheduler` does not exist and the sync routes answer 404 for the owner.

- [ ] **Step 3: Implement the scheduler**

`apps/server/src/sync/scheduler.ts`:

```ts
import type { SyncTargetRepository } from '../repos/SyncTargetRepository';
import type { SyncService } from './SyncService';

export async function runAllOnce(deps: {
  targets: SyncTargetRepository;
  sync: SyncService;
  log?: (message: string, data: object) => void;
}): Promise<void> {
  for (const target of deps.targets.list()) {
    // The scheduler acts for the account itself, not for a person.
    const ctx = { accountId: target.accountId, userId: 'system', role: 'owner' as const, accountStatus: target.accountStatus };
    try {
      const result = await deps.sync.syncEmitter(ctx, target.emitterId);
      deps.log?.('sync finished', { emitterId: target.emitterId, ...result });
    } catch (error) {
      deps.log?.('sync skipped', { emitterId: target.emitterId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export function startScheduler(run: () => Promise<void>, intervalMs: number): { stop(): void } {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    run().finally(() => {
      busy = false;
    });
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 4: Implement the routes and the wiring**

`apps/server/src/routes/sync.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { accountContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { EmitterRepository } from '../repos/EmitterRepository';
import { SyncStateRepository } from '../repos/SyncStateRepository';
import { SyncBusyError, type SyncService } from '../sync/SyncService';

export function syncRoutes(app: FastifyInstance, deps: { db: Database; sync: SyncService }): void {
  const emitters = new EmitterRepository(deps.db);
  const state = new SyncStateRepository(deps.db);
  const url = '/api/accounts/:accountId/emitters/:emitterId/sync';

  app.get<{ Params: { accountId: string; emitterId: string } }>(url, async (request) => {
    const ctx = accountContext(request, request.params.accountId);
    const emitter = emitters.get(ctx, request.params.emitterId);
    if (!emitter) throw new HttpError(404, 'not_found');
    const row = state.get(ctx, emitter.id, emitter.environment);
    return {
      environment: emitter.environment,
      lastNsu: row.lastNsu,
      lastRunAt: row.lastRunAt,
      lastSuccessAt: row.lastSuccessAt,
      lastError: row.lastError,
      running: deps.sync.isRunning(emitter.id),
    };
  });

  app.post<{ Params: { accountId: string; emitterId: string } }>(url, async (request) => {
    const ctx = accountContext(request, request.params.accountId, { write: true });
    const emitter = emitters.get(ctx, request.params.emitterId);
    if (!emitter) throw new HttpError(404, 'not_found');
    try {
      return await deps.sync.syncEmitter(ctx, emitter.id);
    } catch (error) {
      if (error instanceof SyncBusyError) throw new HttpError(409, 'sync_running');
      throw error;
    }
  });
}
```

In `apps/server/src/app.ts`:
- Add to `AppDeps`: `syncService?: SyncService` and `onEmitterCreated?: (ctx: AccountContext, emitterId: string) => void`.
- Build the shared pieces once, before the routes:

```ts
  const providerFactory = deps.providerFactory ?? nacionalProviderFactory(config.nacionalUrls);
  const syncService =
    deps.syncService ??
    new SyncService({
      db,
      certificates: new VaultCertificateStore(new CertificateRepository(db), config.masterKey),
      providerFactory,
    });
  const onEmitterCreated =
    deps.onEmitterCreated ??
    ((ctx: AccountContext, emitterId: string) => {
      syncService
        .syncEmitter(ctx, emitterId)
        .then((result) => app.log.info({ emitterId, ...result }, 'first sync finished'))
        .catch((error: unknown) => app.log.warn({ emitterId, err: error }, 'first sync failed'));
    });
```

- Pass `providerFactory` and `onEmitterCreated` to `emitterRoutes`, and register `syncRoutes(app, { db, sync: syncService })`.
- Decorate the app with the service, so `main.ts` can schedule it: `app.decorate('syncService', syncService);` and add `syncService: SyncService` to the `FastifyInstance` module declaration.

In `apps/server/src/routes/emitters.ts`, add `onEmitterCreated: (ctx: AccountContext, emitterId: string) => void` to the deps, and call `deps.onEmitterCreated(ctx, emitter.id);` right after the two audit records of the onboarding route (RFC: "On success, the certificate becomes active and the first sync starts").

In `apps/server/test/testApp.ts`, pass `onEmitterCreated: () => {}` to `buildApp`.

In `apps/server/src/main.ts`, after `app.listen`:

```ts
  const targets = new SyncTargetRepository(db);
  startScheduler(
    () => runAllOnce({ targets, sync: app.syncService, log: (message, data) => app.log.info(data, message) }),
    30 * 60_000,
  );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS, including the route sweep: it walks the two new routes with `:emitterId`, which is already in its parameter map.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): sync scheduler, sync-now route, and the first sync after onboarding"
```

---

### Task 7: Invoice, customer, lookup, and audit routes

**Files:**
- Create: `apps/server/src/routes/invoices.ts`, `apps/server/src/routes/invoices.test.ts`
- Create: `apps/server/src/routes/customers.ts`
- Create: `apps/server/src/routes/audit.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/routes/routeSweep.test.ts`, `apps/server/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `InvoiceRepository`, `CustomerRepository` (Task 3); `applyDocument` (Task 4); `EmitterRepository`, `VaultCertificateStore`, `ProviderFactory`, `AuditLog`, guards (Stage 1a-2).
- Produces routes:
  - `GET /api/accounts/:accountId/invoices?emitterId&environment&status&competenceFrom&competenceTo&q&limit&offset` → `200 { items: InvoiceSummary[]; total: number }` (`limit` 1 to 200, default 50)
  - `GET /api/accounts/:accountId/invoices/:invoiceId` → `200 InvoiceDetail`, `404 not_found`
  - `GET /api/accounts/:accountId/invoices/:invoiceId/xml` → `200` `application/xml; charset=utf-8` with `content-disposition: attachment; filename="NFSe-<number>.xml"`, `404 not_found`
  - `POST /api/accounts/:accountId/invoices/lookup` `{ accessKey }` (write) → `200 { id }`; `400 invalid_access_key`; `404 emitter_not_found`; `404 invoice_not_found`
  - `GET /api/accounts/:accountId/customers?emitterId&q` → `200 CustomerRow[]` (without `manualFields`)
  - `GET /api/admin/audit?limit` → `200 AuditRow[]`, newest first, `limit` default 100, maximum 1000

Lookup rules (RFC "Flow: find by access key"):
1. The key must match `^[0-9A-Z]{50}$` after trimming and upper-casing.
2. The emitter is the account's emitter whose CNPJ equals `accessKey.slice(9, 23)` (municipality 7, environment 1, registration type 1, then the CNPJ). None: 404 `emitter_not_found`, and the Sefin is not called (Review Focus 5).
3. `provider.getInvoice(key)` in the emitter's environment. `null`: 404 `invoice_not_found`.
4. If `invoice.provider.cnpj` is not the emitter's CNPJ: 404 `emitter_not_found` (the key lied about its CNPJ).
5. Store through `applyDocument` as an `invoice` document, and return its id.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/routes/invoices.test.ts`:

```ts
import { makeTestCertificate } from '@notaflow/test-kit';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function onboarded(email = 'owner@example.com') {
  const a = seedTenant(t.db, { accountName: 'A', email });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers: await t.as(email),
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

async function synced() {
  const tenant = await onboarded();
  const keys = await issueOnFake(t.fake, 3);
  await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${tenant.a.accountId}/emitters/${tenant.emitterId}/sync`,
    headers: await t.as('owner@example.com'),
    payload: {},
  });
  return { ...tenant, keys };
}

test('lists synced invoices with paging and returns the detail and the XML', async () => {
  const { a } = await synced();
  const headers = await t.as('owner@example.com');
  const page = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices?limit=2`, headers });
  expect(page.statusCode).toBe(200);
  const body = page.json<{ total: number; items: { id: string; number: string }[] }>();
  expect(body.total).toBe(3);
  expect(body.items).toHaveLength(2);

  const id = body.items[0]?.id ?? '';
  const detail = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${id}`, headers });
  expect(detail.json()).toMatchObject({ id, status: 'issued', events: [] });

  const xml = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${id}/xml`, headers });
  expect(xml.headers['content-type']).toContain('application/xml');
  expect(xml.headers['content-disposition']).toMatch(/^attachment; filename="NFSe-\d+\.xml"$/);
  expect(xml.body).toContain('<NFSe');
});

test('an invalid limit is 400', async () => {
  const { a } = await onboarded();
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/invoices?limit=5000`,
    headers: await t.as('owner@example.com'),
  });
  expect(response.statusCode).toBe(400);
});

test('lookup stores an invoice found by access key through the sync path', async () => {
  const { a } = await onboarded();
  const [key] = await issueOnFake(t.fake, 1);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/lookup`,
    headers: await t.as('owner@example.com'),
    payload: { accessKey: ` ${(key ?? '').toLowerCase()} ` },
  });
  expect(response.statusCode).toBe(200);
  const { id } = response.json<{ id: string }>();
  const customers = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/customers`,
    headers: await t.as('owner@example.com'),
  });
  expect(customers.json()).toEqual([expect.objectContaining({ name: 'Cliente Exemplo Ltda' })]);
  expect(id).toEqual(expect.any(String));
});

test('lookup of a key whose CNPJ is not an emitter of the account is 404 and calls nothing', async () => {
  const { a } = await onboarded();
  const foreignKey = '355030822' + '98765432000110' + '0'.repeat(27);
  t.fake.next('getNfse', { kind: 'reply', status: 500, body: 'must not be called' });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/lookup`,
    headers: await t.as('owner@example.com'),
    payload: { accessKey: foreignKey },
  });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'emitter_not_found' });
  // The queued 500 is still there, so the first lookup never called the Sefin.
  const after = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/lookup`,
    headers: await t.as('owner@example.com'),
    payload: { accessKey: '355030822' + '12345678000195' + '9'.repeat(27) },
  });
  expect(after.statusCode).toBe(500);
});

test('lookup of an unknown key of the emitter is 404 invoice_not_found', async () => {
  const { a } = await onboarded();
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/lookup`,
    headers: await t.as('owner@example.com'),
    payload: { accessKey: '355030822' + '12345678000195' + '9'.repeat(27) },
  });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'invoice_not_found' });
});

test('a malformed key is 400 invalid_access_key', async () => {
  const { a } = await onboarded();
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/lookup`,
    headers: await t.as('owner@example.com'),
    payload: { accessKey: 'abc' },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'invalid_access_key' });
});

test('another account sees none of the invoices', async () => {
  const { a } = await synced();
  const b = seedTenant(t.db, { accountName: 'B', email: 'b@example.com' });
  const list = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices`,
    headers: await t.as('b@example.com'),
  });
  expect(list.json()).toEqual({ items: [], total: 0 });
  const own = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers: await t.as('owner@example.com') });
  const id = own.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  const detail = await t.app.inject({
    method: 'GET',
    url: `/api/accounts/${b.accountId}/invoices/${id}`,
    headers: await t.as('b@example.com'),
  });
  expect(detail.statusCode).toBe(404);
});
```

Append to `apps/server/src/routes/admin.test.ts`:

```ts
test('the audit log is readable by a platform admin, newest first', async () => {
  const headers = await t.as('admin@example.com');
  await t.app.inject({ method: 'POST', url: '/api/admin/accounts', headers, payload: { name: 'One' } });
  await t.app.inject({ method: 'POST', url: '/api/admin/accounts', headers, payload: { name: 'Two' } });
  const response = await t.app.inject({ method: 'GET', url: '/api/admin/audit?limit=1', headers });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual([expect.objectContaining({ action: 'account.create' })]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/routes/invoices.test.ts apps/server/src/routes/admin.test.ts`
Expected: FAIL with 404 on every new route.

- [ ] **Step 3: Implement the routes**

`apps/server/src/routes/invoices.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { accountContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import type { ProviderFactory } from '../providers/providerFactory';
import { CertificateRepository } from '../repos/CertificateRepository';
import { CustomerRepository } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { type InvoiceFilter, InvoiceRepository } from '../repos/InvoiceRepository';
import { applyDocument } from '../sync/applyDocument';
import { VaultCertificateStore } from '../vault/VaultCertificateStore';

const ACCESS_KEY = /^[0-9A-Z]{50}$/;

interface ListQuery {
  emitterId?: string;
  environment?: 'producao' | 'producao_restrita';
  status?: InvoiceFilter['status'];
  competenceFrom?: string;
  competenceTo?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

const listSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      emitterId: { type: 'string' },
      environment: { enum: ['producao', 'producao_restrita'] },
      status: { enum: ['pending', 'issued', 'rejected', 'unknown', 'cancelled'] },
      competenceFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      competenceTo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      q: { type: 'string', maxLength: 100 },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
  },
} as const;

export function invoiceRoutes(
  app: FastifyInstance,
  deps: { db: Database; masterKey: Buffer; providerFactory: ProviderFactory },
): void {
  const invoices = new InvoiceRepository(deps.db);
  const customers = new CustomerRepository(deps.db);
  const emitters = new EmitterRepository(deps.db);
  const certificates = new VaultCertificateStore(new CertificateRepository(deps.db), deps.masterKey);

  app.get<{ Params: { accountId: string }; Querystring: ListQuery }>(
    '/api/accounts/:accountId/invoices',
    { schema: listSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const { q, limit = 50, offset = 0, ...filters } = request.query;
      return invoices.list(ctx, { ...filters, ...(q ? { search: q } : {}), limit, offset });
    },
  );

  app.get<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const invoice = invoices.get(ctx, request.params.invoiceId);
      if (!invoice) throw new HttpError(404, 'not_found');
      return invoice;
    },
  );

  app.get<{ Params: { accountId: string; invoiceId: string } }>(
    '/api/accounts/:accountId/invoices/:invoiceId/xml',
    async (request, reply) => {
      const ctx = accountContext(request, request.params.accountId);
      const invoice = invoices.get(ctx, request.params.invoiceId);
      const xml = invoice ? invoices.xml(ctx, invoice.id) : null;
      if (!invoice || xml === null) throw new HttpError(404, 'not_found');
      return reply
        .header('content-type', 'application/xml; charset=utf-8')
        .header('content-disposition', `attachment; filename="NFSe-${invoice.number ?? invoice.id}.xml"`)
        .send(xml);
    },
  );

  app.post<{ Params: { accountId: string }; Body: { accessKey: string } }>(
    '/api/accounts/:accountId/invoices/lookup',
    {
      schema: {
        body: {
          type: 'object',
          required: ['accessKey'],
          additionalProperties: false,
          properties: { accessKey: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const accessKey = request.body.accessKey.trim().toUpperCase();
      if (!ACCESS_KEY.test(accessKey)) throw new HttpError(400, 'invalid_access_key');
      // Key layout: municipality (7), environment (1), registration type (1), then the issuer CNPJ.
      const emitter = emitters.findByCnpj(ctx, accessKey.slice(9, 23));
      if (!emitter) throw new HttpError(404, 'emitter_not_found');
      const certificate = await certificates.loadActive(ctx, emitter.id);
      if (!certificate) throw new HttpError(409, 'no_active_certificate');
      const invoice = await deps
        .providerFactory({ environment: emitter.environment, certificate })
        .getInvoice(accessKey);
      if (!invoice) throw new HttpError(404, 'invoice_not_found');
      if (invoice.provider.cnpj !== emitter.cnpj) throw new HttpError(404, 'emitter_not_found');
      const counts = { invoices: 0, events: 0, skipped: 0 };
      deps.db.transaction(() =>
        applyDocument({ customers, invoices }, ctx, emitter.id, { kind: 'invoice', nsu: 0, invoice }, counts),
      );
      const id = invoices.findIdByAccessKey(ctx, accessKey);
      if (!id) throw new HttpError(500, 'internal_error');
      return { id };
    },
  );
}
```

`apps/server/src/routes/customers.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { accountContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';

export function customerRoutes(app: FastifyInstance, db: Database): void {
  const customers = new CustomerRepository(db);
  app.get<{ Params: { accountId: string }; Querystring: { emitterId?: string; q?: string } }>(
    '/api/accounts/:accountId/customers',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { emitterId: { type: 'string' }, q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const { emitterId, q } = request.query;
      return customers
        .list(ctx, { ...(emitterId ? { emitterId } : {}), ...(q ? { search: q } : {}) })
        .map(({ manualFields: _manualFields, ...customer }) => customer);
    },
  );
}
```

`apps/server/src/routes/audit.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { adminContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { AuditLog } from '../repos/AuditLog';

export function auditRoutes(app: FastifyInstance, db: Database): void {
  const audit = new AuditLog(db);
  app.get<{ Querystring: { limit?: number } }>(
    '/api/admin/audit',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
        },
      },
    },
    async (request) => {
      adminContext(request);
      return audit.latest(request.query.limit ?? 100);
    },
  );
}
```

Add `latest(limit: number)` to `apps/server/src/repos/AuditLog.ts` (newest first: `orderBy(desc(auditLog.id)).limit(limit)`), with a test in `repos.test.ts` first.

In `apps/server/src/app.ts`, register `invoiceRoutes(app, { db, masterKey: config.masterKey, providerFactory })`, `customerRoutes(app, db)`, and `auditRoutes(app, db)`.

In `apps/server/src/routes/routeSweep.test.ts`, add `invoiceId` to `params`: in `beforeAll`, insert one invoice for account A with `new InvoiceRepository(t.db).upsertSynced(a, emitter.id, providerInvoice(), null)` and use its id. The sweep then checks every new route.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): invoice list, detail, XML, lookup by access key, customers, and audit routes"
```

---

### Task 8: Web package, API client, router, and formatters

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/api.ts`, `apps/web/src/api.test.ts`
- Create: `apps/web/src/router.ts`, `apps/web/src/router.test.ts`
- Create: `apps/web/src/format.ts`, `apps/web/src/format.test.ts`
- Modify: root `package.json` (scripts `dev:web`, `build:web`), `eslint.config.js` (browser globals for `apps/web`)

**Interfaces:**
- Consumes: the API of Stage 1a-2 and Tasks 6 and 7.
- Produces:
  - `class ApiError extends Error { status: number; code: string }`
  - `api.get<T>(path: string): Promise<T>`, `api.post<T>(path: string, body: unknown): Promise<T>`, `api.put<T>(path, body)`; JSON in and out, same-origin credentials; a non-2xx answer throws `ApiError` with the server's `error` code
  - Types `Me`, `Emitter`, `InvoiceSummary`, `InvoiceDetail`, `InvoicePage`, `SyncState`, `SyncResult`, `Customer`, `AdminAccount`, `AuditEntry`, `Member`
  - `type Route = { name: 'home' } | { name: 'emitters'; accountId: string } | { name: 'invoices'; accountId: string } | { name: 'invoice'; accountId: string; invoiceId: string } | { name: 'members'; accountId: string } | { name: 'admin' }`
  - `parseRoute(hash: string): Route`, `routeHref(route: Route): string`, `useRoute(): Route`
  - `formatCents(cents: number): string` (`R$ 1.500,00`), `formatDate(value: string | null): string` (`dd/mm/aaaa`), `formatCompetence(yyyyMmDd: string): string` (`mm/aaaa`), `fileToBase64(file: Blob): Promise<string>`

Hash routes keep the app a single `index.html` with no server-side routing: `#/a/<accountId>/emitters`, `#/a/<accountId>/invoices`, `#/a/<accountId>/invoices/<invoiceId>`, `#/a/<accountId>/members`, `#/admin`, and `#/` for home.

- [ ] **Step 1: Create the package**

`apps/web/package.json`:

```json
{
  "name": "@notaflow/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.7",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "jsdom": "^26.1.0",
    "vite": "^7.3.0"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NotaFlow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

In the root `package.json`, add to `scripts`:

```json
    "dev:web": "pnpm --filter @notaflow/web exec vite",
    "build:web": "pnpm --filter @notaflow/web build"
```

In `eslint.config.js`, add a block for the web files, so `window`, `document`, `fetch`, and `FileReader` are known:

```js
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', fetch: 'readonly', FileReader: 'readonly', HashChangeEvent: 'readonly' } },
  },
```

With the Vite dev server, the browser sends `Origin: http://localhost:5173`. In `apps/server/.env.example`, change `APP_ORIGIN` to `http://localhost:5173` and add the comment `# The Vite dev server origin; production uses the public URL.`

Run: `pnpm install`
Expected: the web dependencies install. Vitest 3 and the web package share Vite 7, so there is one Vite in the workspace.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/format.test.ts`:

```ts
// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { fileToBase64, formatCents, formatCompetence, formatDate } from './format';

test('formatCents writes BRL with comma decimals', () => {
  expect(formatCents(150000).replace(/\s/g, ' ')).toBe('R$ 1.500,00');
  expect(formatCents(5).replace(/\s/g, ' ')).toBe('R$ 0,05');
});

test('formatDate and formatCompetence use the Brazilian order', () => {
  expect(formatDate('2026-10-01T13:00:00.000Z')).toBe('01/10/2026');
  expect(formatDate(null)).toBe('');
  expect(formatCompetence('2026-09-30')).toBe('09/2026');
});

test('fileToBase64 reads a file without the data URL prefix', async () => {
  const file = new Blob([new Uint8Array([1, 2, 3, 250])]);
  expect(await fileToBase64(file)).toBe(Buffer.from([1, 2, 3, 250]).toString('base64'));
});
```

`apps/web/src/router.test.ts`:

```ts
import { expect, test } from 'vitest';
import { parseRoute, routeHref } from './router';

test.each([
  ['', { name: 'home' }],
  ['#/', { name: 'home' }],
  ['#/a/acc1/emitters', { name: 'emitters', accountId: 'acc1' }],
  ['#/a/acc1/invoices', { name: 'invoices', accountId: 'acc1' }],
  ['#/a/acc1/invoices/inv9', { name: 'invoice', accountId: 'acc1', invoiceId: 'inv9' }],
  ['#/a/acc1/members', { name: 'members', accountId: 'acc1' }],
  ['#/admin', { name: 'admin' }],
  ['#/unknown/path', { name: 'home' }],
])('parseRoute(%s)', (hash, route) => {
  expect(parseRoute(hash)).toEqual(route);
});

test('routeHref is the inverse of parseRoute', () => {
  const route = { name: 'invoice', accountId: 'a b', invoiceId: 'i/1' } as const;
  expect(parseRoute(routeHref(route))).toEqual(route);
});
```

`apps/web/src/api.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
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
  await expect(api.post('/api/x', {})).rejects.toMatchObject({ status: 409, code: 'cnpj_in_other_account' });
  await expect(api.get('/api/x')).rejects.toBeInstanceOf(ApiError);
});

test('a 204 answer resolves to undefined', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  expect(await api.post('/api/x', {})).toBeUndefined();
});
```

`fetch` is the HTTP boundary of the browser; stubbing it is the one mock this layer needs.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web`
Expected: FAIL, the three modules do not exist.

- [ ] **Step 4: Implement**

`apps/web/src/format.ts`:

```ts
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatCents(cents: number): string {
  return money.format(cents / 100);
}

export function formatDate(value: string | null): string {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function formatCompetence(value: string): string {
  const [year, month] = value.split('-');
  return `${month}/${year}`;
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
```

`formatDate` slices the ISO string instead of using `Date`, so a UTC timestamp near midnight does not move the day in the browser's time zone; the server stores `issuedAt` in UTC and the day shown is the UTC day. Plan 1b revisits this if users report a one-day shift.

`apps/web/src/router.ts`:

```ts
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'emitters'; accountId: string }
  | { name: 'invoices'; accountId: string }
  | { name: 'invoice'; accountId: string; invoiceId: string }
  | { name: 'members'; accountId: string }
  | { name: 'admin' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [first, accountId, section, invoiceId] = parts;
  if (first === 'admin' && parts.length === 1) return { name: 'admin' };
  if (first === 'a' && accountId) {
    if (section === 'emitters' && parts.length === 3) return { name: 'emitters', accountId };
    if (section === 'invoices' && parts.length === 3) return { name: 'invoices', accountId };
    if (section === 'invoices' && invoiceId && parts.length === 4) return { name: 'invoice', accountId, invoiceId };
    if (section === 'members' && parts.length === 3) return { name: 'members', accountId };
  }
  return { name: 'home' };
}

export function routeHref(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case 'home':
      return '#/';
    case 'admin':
      return '#/admin';
    case 'invoice':
      return `#/a/${e(route.accountId)}/invoices/${e(route.invoiceId)}`;
    default:
      return `#/a/${e(route.accountId)}/${route.name}`;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
```

`apps/web/src/api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : `http_${response.status}`;
    throw new ApiError(response.status, code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
};

export type Environment = 'producao' | 'producao_restrita';

export interface Me {
  email: string;
  name: string;
  platformRole: 'admin' | 'user';
  accounts: { id: string; name: string; role: 'owner' | 'member'; status: 'active' | 'suspended' }[];
}

export interface Emitter {
  id: string;
  cnpj: string;
  companyName: string;
  environment: Environment;
  municipality: string;
  dpsSeries: string;
  certificate: { validTo: string; expiresSoon: boolean } | null;
}

export interface InvoiceSummary {
  id: string;
  emitterId: string;
  accessKey: string | null;
  number: string | null;
  status: 'pending' | 'issued' | 'rejected' | 'unknown' | 'cancelled';
  environment: Environment;
  issuedAt: string | null;
  competence: string;
  customerDocument: string | null;
  customerName: string | null;
  serviceCode: string;
  description: string;
  serviceCents: number;
  issCents: number | null;
  netCents: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  events: { code: string; reasonCode: string | null; justification: string | null; registeredAt: string }[];
}

export interface InvoicePage {
  items: InvoiceSummary[];
  total: number;
}

export interface SyncState {
  environment: Environment;
  lastNsu: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  running: boolean;
}

export interface SyncResult {
  invoices: number;
  events: number;
  skipped: number;
  lastNsu: number;
  error: string | null;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
}

export interface AdminAccount {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  plan: string;
  members: number;
}

export interface AuditEntry {
  id: number;
  userEmail: string;
  accountId: string | null;
  action: string;
  entity: string;
  result: 'ok' | 'refused' | 'error';
  detail: string | null;
  at: string;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint`
Expected: PASS. If Vitest does not transform the `.tsx` of later tasks because the root has no React plugin, add `apps/web/vitest.config.ts` with `@vitejs/plugin-react` and a root `vitest.workspace.ts` listing `apps/web` and the other packages; record it as a ruling.

- [ ] **Step 6: Commit**

```bash
git add apps/web package.json pnpm-lock.yaml eslint.config.js apps/server/.env.example
git commit -m "feat(web): Vite React package with the API client, hash routes, and formatters"
```

---

### Task 9: Layout, account home, and the emitters page

**Files:**
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/components/Layout.tsx`, `EnvironmentBadge.tsx`, `CertificateWarning.tsx`, `useAsync.ts`
- Create: `apps/web/src/pages/HomePage.tsx`, `apps/web/src/pages/EmittersPage.tsx`, `apps/web/src/pages/OnboardingForm.tsx`
- Create: `apps/web/src/components/components.test.tsx`, `apps/web/src/pages/OnboardingForm.test.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError`, the types, `useRoute`, `routeHref`, the formatters (Task 8).
- Produces:
  - `useAsync<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: ApiError | Error | undefined; loading: boolean; reload(): void }`
  - `<EnvironmentBadge environment />`: a large badge, red "PRODUÇÃO" or amber "PRODUÇÃO RESTRITA (teste)" (RFC: "The UI always shows a large badge with the current environment")
  - `<CertificateWarning certificate />`: nothing when valid for more than 30 days; a warning with the expiry date otherwise; "sem certificado" when null
  - `<OnboardingForm onSubmit={(body) => Promise<void>} />`: file input for `.pfx`, password, municipality, municipal registration (optional), Simples Nacional, Simples regime (shown when `simplesNacional` is `3`), special regime, DPS series
  - `ERROR_TEXT: Record<string, string>` in `Layout.tsx`, the Portuguese message for each API error code, with a generic fallback

Pages:
- **Home** (`#/`): `GET /api/me`; lists the accounts with their role and status, links to emitters and invoices; a link to `#/admin` for a platform admin; "Acesso não liberado" for 403 `access_not_granted`.
- **Emitters** (`#/a/:id/emitters`): the emitter list with company name, CNPJ, `EnvironmentBadge`, `CertificateWarning`, sync state (`GET .../sync`), and buttons "Sincronizar agora" (`POST .../sync`), "Trocar certificado", and for owners the environment switch (a `window.prompt` that asks the user to type `producao`, then `POST .../environment` with that confirmation). Below, for owners, the `OnboardingForm`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/components.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { CertificateWarning } from './CertificateWarning';
import { EnvironmentBadge } from './EnvironmentBadge';

test('the environment badge says which environment, loudly', () => {
  render(<EnvironmentBadge environment="producao" />);
  expect(screen.getByText('PRODUÇÃO')).toBeTruthy();
  render(<EnvironmentBadge environment="producao_restrita" />);
  expect(screen.getByText(/PRODUÇÃO RESTRITA/)).toBeTruthy();
});

test('the certificate warning shows only when the certificate expires soon or is missing', () => {
  const { container } = render(<CertificateWarning certificate={{ validTo: '2030-01-01T00:00:00Z', expiresSoon: false }} />);
  expect(container.textContent).toBe('');
  render(<CertificateWarning certificate={{ validTo: '2026-10-20T00:00:00Z', expiresSoon: true }} />);
  expect(screen.getByText(/vence em 20\/10\/2026/)).toBeTruthy();
  render(<CertificateWarning certificate={null} />);
  expect(screen.getByText(/sem certificado/i)).toBeTruthy();
});
```

`apps/web/src/pages/OnboardingForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { OnboardingForm } from './OnboardingForm';

test('sends the .pfx in base64 with the fiscal fields, and the Simples regime only for ME/EPP', async () => {
  const onSubmit = vi.fn(async () => {});
  render(<OnboardingForm onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/certificado/i), new File([new Uint8Array([1, 2, 3])], 'empresa.pfx'));
  await user.type(screen.getByLabelText(/senha/i), 'segredo');
  await user.type(screen.getByLabelText(/município/i), '4113700');
  await user.selectOptions(screen.getByLabelText(/simples nacional/i), '3');
  await user.selectOptions(screen.getByLabelText(/regime de apuração/i), '1');
  await user.click(screen.getByRole('button', { name: /cadastrar/i }));
  expect(onSubmit).toHaveBeenCalledWith({
    pfxBase64: Buffer.from([1, 2, 3]).toString('base64'),
    password: 'segredo',
    municipality: '4113700',
    simplesNacional: '3',
    simplesRegime: '1',
    specialRegime: '0',
    dpsSeries: '900',
  });
});

test('leaves out the Simples regime when the emitter is not ME/EPP', async () => {
  const onSubmit = vi.fn(async () => {});
  render(<OnboardingForm onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/certificado/i), new File([new Uint8Array([9])], 'x.pfx'));
  await user.type(screen.getByLabelText(/município/i), '3550308');
  await user.click(screen.getByRole('button', { name: /cadastrar/i }));
  expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('simplesRegime');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web`
Expected: FAIL, the components and the form do not exist.

- [ ] **Step 3: Implement the components, the form, the pages, and the entry**

`apps/web/src/components/useAsync.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  // The caller lists what load depends on, like a useEffect dependency list.
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setState((previous) => ({ ...previous, loading: true }));
    run().then(
      (data) => live && setState({ data, loading: false }),
      (error: unknown) => live && setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [run, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}
```

`apps/web/src/components/EnvironmentBadge.tsx`:

```tsx
import type { Environment } from '../api';

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  return environment === 'producao' ? (
    <span className="badge badge-production">PRODUÇÃO</span>
  ) : (
    <span className="badge badge-test">PRODUÇÃO RESTRITA (teste)</span>
  );
}
```

`apps/web/src/components/CertificateWarning.tsx`:

```tsx
import type { Emitter } from '../api';
import { formatDate } from '../format';

export function CertificateWarning({ certificate }: { certificate: Emitter['certificate'] }) {
  if (!certificate) return <p className="warning">Emitente sem certificado ativo.</p>;
  if (!certificate.expiresSoon) return null;
  return <p className="warning">O certificado vence em {formatDate(certificate.validTo)}. Envie um novo.</p>;
}
```

`apps/web/src/components/Layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { routeHref } from '../router';

export const ERROR_TEXT: Record<string, string> = {
  access_not_granted: 'Seu e-mail ainda não tem acesso ao NotaFlow. Fale com o administrador.',
  account_suspended: 'Esta conta está suspensa. Você pode consultar, mas não alterar.',
  owner_only: 'Só o dono da conta pode fazer isso.',
  cnpj_in_other_account: 'Este CNPJ já pertence a outra conta.',
  emitter_exists: 'Este emitente já está cadastrado. Use "Trocar certificado".',
  connection_test_failed: 'O teste de conexão com o sistema nacional falhou. Tente de novo.',
  WRONG_PASSWORD: 'Senha do certificado incorreta.',
  EXPIRED: 'Este certificado está vencido.',
  NOT_YET_VALID: 'Este certificado ainda não é válido.',
  INVALID_FILE: 'O arquivo não é um certificado .pfx válido.',
  CNPJ_NOT_FOUND: 'O certificado não traz um CNPJ.',
  cnpj_mismatch: 'O certificado é de outro CNPJ.',
  confirmation_required: 'Confirmação incorreta. Digite producao para confirmar.',
  sync_running: 'Uma sincronização já está em andamento.',
  invalid_access_key: 'A chave de acesso deve ter 50 caracteres.',
  emitter_not_found: 'Esta chave não é de um emitente desta conta.',
  invoice_not_found: 'Nenhuma nota encontrada com esta chave.',
  user_exists: 'Já existe um usuário com este e-mail.',
  already_member: 'Esta pessoa já é membro da conta.',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return ERROR_TEXT[error.code] ?? `Erro inesperado (${error.code}).`;
  return 'Erro inesperado. Tente de novo.';
}

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app">
      <header>
        <a href={routeHref({ name: 'home' })} className="brand">
          NotaFlow
        </a>
      </header>
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
```

`apps/web/src/pages/OnboardingForm.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import { fileToBase64 } from '../format';

export interface OnboardBody {
  pfxBase64: string;
  password: string;
  municipality: string;
  municipalRegistration?: string;
  simplesNacional: '1' | '2' | '3';
  simplesRegime?: '1' | '2' | '3';
  specialRegime: string;
  dpsSeries: string;
}

export function OnboardingForm({ onSubmit }: { onSubmit: (body: OnboardBody) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [municipalRegistration, setMunicipalRegistration] = useState('');
  const [simplesNacional, setSimplesNacional] = useState<'1' | '2' | '3'>('1');
  const [simplesRegime, setSimplesRegime] = useState<'1' | '2' | '3'>('1');
  const [specialRegime, setSpecialRegime] = useState('0');
  const [dpsSeries, setDpsSeries] = useState('900');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      await onSubmit({
        pfxBase64: await fileToBase64(file),
        password,
        municipality,
        ...(municipalRegistration ? { municipalRegistration } : {}),
        simplesNacional,
        ...(simplesNacional === '3' ? { simplesRegime } : {}),
        specialRegime,
        dpsSeries,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h2>Cadastrar emitente</h2>
      <label>
        Certificado A1 (.pfx)
        <input type="file" accept=".pfx,.p12" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label>
        Senha do certificado
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Município (código IBGE)
        <input value={municipality} required pattern="[0-9]{7}" onChange={(e) => setMunicipality(e.target.value)} />
      </label>
      <label>
        Inscrição municipal (opcional)
        <input value={municipalRegistration} onChange={(e) => setMunicipalRegistration(e.target.value)} />
      </label>
      <label>
        Simples Nacional
        <select value={simplesNacional} onChange={(e) => setSimplesNacional(e.target.value as '1' | '2' | '3')}>
          <option value="1">1 - Não optante</option>
          <option value="2">2 - MEI</option>
          <option value="3">3 - ME/EPP</option>
        </select>
      </label>
      {simplesNacional === '3' && (
        <label>
          Regime de apuração (Simples)
          <select value={simplesRegime} onChange={(e) => setSimplesRegime(e.target.value as '1' | '2' | '3')}>
            <option value="1">1 - Tributos federais e municipal pelo Simples</option>
            <option value="2">2 - Federais pelo Simples, ISSQN fora</option>
            <option value="3">3 - Federais e ISSQN fora do Simples</option>
          </select>
        </label>
      )}
      <label>
        Regime especial
        <select value={specialRegime} onChange={(e) => setSpecialRegime(e.target.value)}>
          <option value="0">0 - Nenhum</option>
          <option value="1">1 - Ato cooperado</option>
          <option value="2">2 - Estimativa</option>
          <option value="3">3 - Microempresa municipal</option>
          <option value="4">4 - Notário ou registrador</option>
          <option value="5">5 - Profissional autônomo</option>
          <option value="6">6 - Sociedade de profissionais</option>
          <option value="9">9 - Outros</option>
        </select>
      </label>
      <label>
        Série da DPS
        <input value={dpsSeries} required pattern="[0-9]{1,5}" onChange={(e) => setDpsSeries(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Testando conexão...' : 'Cadastrar'}
      </button>
    </form>
  );
}
```

`apps/web/src/pages/HomePage.tsx`:

```tsx
import { api, type Me } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { routeHref } from '../router';

export function HomePage() {
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  if (me.error) return <Layout title="NotaFlow"><p className="error">{errorText(me.error)}</p></Layout>;
  if (!me.data) return <Layout title="NotaFlow"><p>Carregando...</p></Layout>;
  const { data } = me;
  return (
    <Layout title={`Olá, ${data.name}`}>
      {data.platformRole === 'admin' && (
        <p>
          <a href={routeHref({ name: 'admin' })}>Painel do administrador</a>
        </p>
      )}
      {data.accounts.length === 0 && <p>Você ainda não participa de nenhuma conta.</p>}
      <ul className="list">
        {data.accounts.map((account) => (
          <li key={account.id} className="card">
            <strong>{account.name}</strong> ({account.role === 'owner' ? 'dono' : 'membro'})
            {account.status === 'suspended' && <span className="warning"> suspensa</span>}
            <nav>
              <a href={routeHref({ name: 'invoices', accountId: account.id })}>Notas</a>
              <a href={routeHref({ name: 'emitters', accountId: account.id })}>Emitentes</a>
              {account.role === 'owner' && <a href={routeHref({ name: 'members', accountId: account.id })}>Membros</a>}
            </nav>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
```

`apps/web/src/pages/EmittersPage.tsx`:

```tsx
import { useState } from 'react';
import { api, type Emitter, type Me, type SyncResult, type SyncState } from '../api';
import { CertificateWarning } from '../components/CertificateWarning';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { fileToBase64, formatDate } from '../format';
import { OnboardingForm } from './OnboardingForm';

export function EmittersPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const [message, setMessage] = useState<string | null>(null);
  const isOwner = me.data?.accounts.find((a) => a.id === accountId)?.role === 'owner';

  async function act(action: () => Promise<string>) {
    setMessage(null);
    try {
      setMessage(await action());
      emitters.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <Layout title="Emitentes">
      {message && <p className="message">{message}</p>}
      {emitters.error && <p className="error">{errorText(emitters.error)}</p>}
      {emitters.data?.map((emitter) => (
        <EmitterCard key={emitter.id} base={base} emitter={emitter} isOwner={isOwner} act={act} />
      ))}
      {isOwner && (
        <OnboardingForm
          onSubmit={(body) =>
            act(async () => {
              await api.post(`${base}/emitters`, body);
              return 'Emitente cadastrado em produção restrita. A primeira sincronização começou.';
            })
          }
        />
      )}
    </Layout>
  );
}

function EmitterCard(props: {
  base: string;
  emitter: Emitter;
  isOwner: boolean;
  act: (action: () => Promise<string>) => Promise<void>;
}) {
  const { base, emitter, isOwner, act } = props;
  const url = `${base}/emitters/${encodeURIComponent(emitter.id)}`;
  const sync = useAsync(() => api.get<SyncState>(`${url}/sync`), [url]);

  async function replaceCertificate(file: File) {
    const password = window.prompt('Senha do novo certificado') ?? '';
    await act(async () => {
      await api.post(`${url}/certificate`, { pfxBase64: await fileToBase64(file), password });
      return 'Certificado trocado.';
    });
  }

  function switchEnvironment() {
    const target = emitter.environment === 'producao' ? 'producao_restrita' : 'producao';
    const confirm =
      target === 'producao'
        ? window.prompt('Para emitir notas reais, digite producao') ?? ''
        : 'producao_restrita';
    if (!confirm) return;
    void act(async () => {
      await api.post(`${url}/environment`, { environment: target, confirm });
      return target === 'producao' ? 'Ambiente trocado para PRODUÇÃO.' : 'Ambiente trocado para produção restrita.';
    });
  }

  return (
    <section className="card">
      <h2>
        {emitter.companyName} <small>{emitter.cnpj}</small>
      </h2>
      <EnvironmentBadge environment={emitter.environment} />
      <CertificateWarning certificate={emitter.certificate} />
      {sync.data && (
        <p>
          Última sincronização: {formatDate(sync.data.lastSuccessAt) || 'nunca'}
          {sync.data.lastError && <span className="error"> (erro: {sync.data.lastError})</span>}
        </p>
      )}
      <div className="actions">
        <button
          onClick={() =>
            act(async () => {
              const result = await api.post<SyncResult>(`${url}/sync`, {});
              sync.reload();
              return result.error
                ? `Sincronização parou: ${result.error}`
                : `${result.invoices} notas e ${result.events} eventos sincronizados.`;
            })
          }
        >
          Sincronizar agora
        </button>
        {isOwner && (
          <>
            <label className="button">
              Trocar certificado
              <input type="file" accept=".pfx,.p12" hidden onChange={(e) => e.target.files?.[0] && replaceCertificate(e.target.files[0])} />
            </label>
            <button onClick={switchEnvironment}>
              {emitter.environment === 'producao' ? 'Voltar para produção restrita' : 'Passar para PRODUÇÃO'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
```

`apps/web/src/App.tsx`:

```tsx
import { AdminPage } from './pages/AdminPage';
import { EmittersPage } from './pages/EmittersPage';
import { HomePage } from './pages/HomePage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { MembersPage } from './pages/MembersPage';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'emitters':
      return <EmittersPage accountId={route.accountId} />;
    case 'invoices':
      return <InvoicesPage accountId={route.accountId} />;
    case 'invoice':
      return <InvoiceDetailPage accountId={route.accountId} invoiceId={route.invoiceId} />;
    case 'members':
      return <MembersPage accountId={route.accountId} />;
    case 'admin':
      return <AdminPage />;
    default:
      return <HomePage />;
  }
}
```

`App.tsx` imports pages from Task 10. Create `InvoicesPage.tsx`, `InvoiceDetailPage.tsx`, `MembersPage.tsx`, and `AdminPage.tsx` in this task as one-line stubs (`export function InvoicesPage(_: { accountId: string }) { return null; }`, and so on) so the package typechecks; Task 10 replaces them.

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
```

`apps/web/src/styles.css`:

```css
:root {
  font-family: system-ui, sans-serif;
  color: #1d2433;
  background: #f5f6f8;
}
body {
  margin: 0;
}
header {
  background: #1d2433;
  padding: 12px 24px;
}
.brand {
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px;
}
.card {
  background: #fff;
  border: 1px solid #dde1e8;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.list {
  list-style: none;
  padding: 0;
}
nav a,
.actions > * {
  margin-right: 12px;
}
.badge {
  display: inline-block;
  font-weight: 700;
  font-size: 1.1rem;
  padding: 6px 12px;
  border-radius: 6px;
  margin: 8px 0;
}
.badge-production {
  background: #c62828;
  color: #fff;
}
.badge-test {
  background: #f9a825;
  color: #1d2433;
}
.warning {
  color: #8a5300;
}
.error {
  color: #c62828;
}
.message {
  background: #e8f1ff;
  padding: 8px 12px;
  border-radius: 6px;
}
form label {
  display: block;
  margin-bottom: 12px;
}
form input,
form select {
  display: block;
  margin-top: 4px;
  padding: 6px;
  min-width: 280px;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
}
th,
td {
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid #dde1e8;
}
.status-cancelled {
  color: #c62828;
}
label.button {
  cursor: pointer;
  text-decoration: underline;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): layout, account home, emitters page, and the onboarding form"
```

---

### Task 10: Invoices, invoice detail, members, and the admin panel

**Files:**
- Replace: `apps/web/src/pages/InvoicesPage.tsx`, `InvoiceDetailPage.tsx`, `MembersPage.tsx`, `AdminPage.tsx`
- Create: `apps/web/src/pages/pages.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 8 and 9.
- Produces pages:
  - **Invoices** (`#/a/:id/invoices`): filters (emitter, status, competence from and to, search), a table (number, competence, customer, amount, status, environment), pages of 50, and a lookup box "Buscar por chave de acesso" that posts to `.../invoices/lookup` and opens the found invoice.
  - **Invoice detail** (`#/a/:id/invoices/:invoiceId`): every projected field, the events, a link "Baixar XML" to `.../invoices/:invoiceId/xml`.
  - **Members** (`#/a/:id/members`, owner): the member list and an invite form.
  - **Admin** (`#/admin`): accounts with status and member count, "Nova conta", "Novo usuário" (email, name, optional admin), "Definir dono" (account, user id, role), suspend and reactivate, and the latest 100 audit entries.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/pages/pages.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { InvoicesPage } from './InvoicesPage';

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function stubApi(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      const body = key ? routes[key] : { error: 'not_found' };
      return new Response(JSON.stringify(body), { status: key ? 200 : 404, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

const invoice = {
  id: 'inv1',
  emitterId: 'em1',
  accessKey: 'K'.repeat(50),
  number: '3',
  status: 'cancelled',
  environment: 'producao',
  issuedAt: '2026-09-02T16:12:54.000Z',
  competence: '2026-08-31',
  customerDocument: '00-0000000',
  customerName: 'Foreign Customer Inc',
  serviceCode: '010701',
  description: 'Serviços de TI',
  serviceCents: 1813560,
  issCents: null,
  netCents: 1813560,
};

test('lists invoices with BRL amounts and the cancelled status', async () => {
  stubApi({
    '/api/accounts/acc/invoices': { items: [invoice], total: 1 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  expect(await screen.findByText('Foreign Customer Inc')).toBeTruthy();
  expect(screen.getByText(/18\.135,60/)).toBeTruthy();
  expect(screen.getByText(/cancelada/i)).toBeTruthy();
});

test('the lookup posts the key and opens the found invoice', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/lookup': { id: 'inv1' },
    '/api/accounts/acc/invoices': { items: [], total: 0 },
    '/api/accounts/acc/emitters': [],
  });
  render(<InvoicesPage accountId="acc" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/chave de acesso/i), 'K'.repeat(50));
  await user.click(screen.getByRole('button', { name: /buscar/i }));
  await waitFor(() => expect(window.location.hash).toBe('#/a/acc/invoices/inv1'));
  expect(calls.find((c) => c.url.endsWith('/lookup'))?.init?.body).toBe(JSON.stringify({ accessKey: 'K'.repeat(50) }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/pages/pages.test.tsx`
Expected: FAIL, the stub `InvoicesPage` renders nothing.

- [ ] **Step 3: Implement the pages**

`apps/web/src/pages/InvoicesPage.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import { api, type Emitter, type InvoicePage } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatCents, formatCompetence } from '../format';
import { routeHref } from '../router';

export const STATUS_TEXT: Record<string, string> = {
  pending: 'Pendente',
  issued: 'Emitida',
  rejected: 'Rejeitada',
  unknown: 'Incerta',
  cancelled: 'Cancelada',
};

const PAGE = 50;

export function InvoicesPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const [filters, setFilters] = useState({ emitterId: '', status: '', competenceFrom: '', competenceTo: '', q: '' });
  const [offset, setOffset] = useState(0);
  const [accessKey, setAccessKey] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  const query = new URLSearchParams(
    Object.entries({ ...filters, limit: String(PAGE), offset: String(offset) }).filter(([, value]) => value !== ''),
  ).toString();
  const page = useAsync(() => api.get<InvoicePage>(`${base}/invoices?${query}`), [base, query]);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setLookupError(null);
    try {
      const { id } = await api.post<{ id: string }>(`${base}/invoices/lookup`, { accessKey: accessKey.trim() });
      window.location.hash = routeHref({ name: 'invoice', accountId, invoiceId: id });
    } catch (error) {
      setLookupError(errorText(error));
    }
  }

  const set = (field: keyof typeof filters) => (value: string) => {
    setOffset(0);
    setFilters((previous) => ({ ...previous, [field]: value }));
  };

  return (
    <Layout title="Notas">
      <form onSubmit={lookup} className="card">
        <label>
          Buscar por chave de acesso
          <input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
        </label>
        <button type="submit">Buscar</button>
        {lookupError && <p className="error">{lookupError}</p>}
      </form>
      <div className="card">
        <select aria-label="Emitente" value={filters.emitterId} onChange={(e) => set('emitterId')(e.target.value)}>
          <option value="">Todos os emitentes</option>
          {emitters.data?.map((emitter) => (
            <option key={emitter.id} value={emitter.id}>
              {emitter.companyName}
            </option>
          ))}
        </select>
        <select aria-label="Situação" value={filters.status} onChange={(e) => set('status')(e.target.value)}>
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_TEXT).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <input aria-label="Competência de" type="date" value={filters.competenceFrom} onChange={(e) => set('competenceFrom')(e.target.value)} />
        <input aria-label="Competência até" type="date" value={filters.competenceTo} onChange={(e) => set('competenceTo')(e.target.value)} />
        <input aria-label="Pesquisar" placeholder="Número ou tomador" value={filters.q} onChange={(e) => set('q')(e.target.value)} />
      </div>
      {page.error && <p className="error">{errorText(page.error)}</p>}
      {page.data && (
        <>
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Competência</th>
                <th>Tomador</th>
                <th>Valor</th>
                <th>Situação</th>
                <th>Ambiente</th>
              </tr>
            </thead>
            <tbody>
              {page.data.items.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <a href={routeHref({ name: 'invoice', accountId, invoiceId: invoice.id })}>{invoice.number ?? '-'}</a>
                  </td>
                  <td>{formatCompetence(invoice.competence)}</td>
                  <td>{invoice.customerName}</td>
                  <td>{formatCents(invoice.serviceCents)}</td>
                  <td className={`status-${invoice.status}`}>{STATUS_TEXT[invoice.status]}</td>
                  <td>{invoice.environment === 'producao' ? 'Produção' : <EnvironmentBadge environment={invoice.environment} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            {page.data.total} notas.{' '}
            {offset > 0 && <button onClick={() => setOffset(offset - PAGE)}>Anteriores</button>}
            {offset + PAGE < page.data.total && <button onClick={() => setOffset(offset + PAGE)}>Próximas</button>}
          </p>
        </>
      )}
    </Layout>
  );
}
```

`apps/web/src/pages/InvoiceDetailPage.tsx`:

```tsx
import { api, type InvoiceDetail } from '../api';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatCents, formatCompetence, formatDate } from '../format';
import { routeHref } from '../router';
import { STATUS_TEXT } from './InvoicesPage';

export function InvoiceDetailPage({ accountId, invoiceId }: { accountId: string; invoiceId: string }) {
  const url = `/api/accounts/${encodeURIComponent(accountId)}/invoices/${encodeURIComponent(invoiceId)}`;
  const invoice = useAsync(() => api.get<InvoiceDetail>(url), [url]);
  if (invoice.error) return <Layout title="Nota"><p className="error">{errorText(invoice.error)}</p></Layout>;
  if (!invoice.data) return <Layout title="Nota"><p>Carregando...</p></Layout>;
  const data = invoice.data;
  return (
    <Layout title={`NFS-e ${data.number ?? ''}`}>
      <p>
        <a href={routeHref({ name: 'invoices', accountId })}>Voltar para as notas</a>
      </p>
      <EnvironmentBadge environment={data.environment} />
      <dl className="card">
        <dt>Situação</dt>
        <dd className={`status-${data.status}`}>{STATUS_TEXT[data.status]}</dd>
        <dt>Chave de acesso</dt>
        <dd>{data.accessKey}</dd>
        <dt>Emitida em</dt>
        <dd>{formatDate(data.issuedAt)}</dd>
        <dt>Competência</dt>
        <dd>{formatCompetence(data.competence)}</dd>
        <dt>Tomador</dt>
        <dd>
          {data.customerName} {data.customerDocument && `(${data.customerDocument})`}
        </dd>
        <dt>Serviço</dt>
        <dd>
          {data.serviceCode}: {data.description}
        </dd>
        <dt>Valor do serviço</dt>
        <dd>{formatCents(data.serviceCents)}</dd>
        {data.issCents !== null && (
          <>
            <dt>ISS</dt>
            <dd>{formatCents(data.issCents)}</dd>
          </>
        )}
        <dt>Valor líquido</dt>
        <dd>{formatCents(data.netCents)}</dd>
      </dl>
      <p>
        <a href={`${url}/xml`}>Baixar XML</a>
      </p>
      {data.events.length > 0 && (
        <section className="card">
          <h2>Eventos</h2>
          <ul>
            {data.events.map((event) => (
              <li key={`${event.code}-${event.registeredAt}`}>
                {event.code === '101101' ? 'Cancelamento' : `Evento ${event.code}`} em {formatDate(event.registeredAt)}
                {event.justification && `: ${event.justification}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Layout>
  );
}
```

`apps/web/src/pages/MembersPage.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import { api, type Member } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';

export function MembersPage({ accountId }: { accountId: string }) {
  const url = `/api/accounts/${encodeURIComponent(accountId)}/members`;
  const members = useAsync(() => api.get<Member[]>(url), [url]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    try {
      await api.post(url, { email, name });
      setMessage(`${email} agora é membro da conta.`);
      setEmail('');
      setName('');
      members.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <Layout title="Membros">
      {members.error && <p className="error">{errorText(members.error)}</p>}
      <ul className="list">
        {members.data?.map((member) => (
          <li key={member.userId}>
            {member.name} ({member.email}): {member.role === 'owner' ? 'dono' : 'membro'}
          </li>
        ))}
      </ul>
      <form onSubmit={invite} className="card">
        <h2>Convidar membro</h2>
        <label>
          E-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Nome
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Convidar</button>
        {message && <p className="message">{message}</p>}
      </form>
    </Layout>
  );
}
```

`apps/web/src/pages/AdminPage.tsx`:

```tsx
import { type FormEvent, useState } from 'react';
import { type AdminAccount, api, type AuditEntry } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatDate } from '../format';

export function AdminPage() {
  const accounts = useAsync(() => api.get<AdminAccount[]>('/api/admin/accounts'), []);
  const audit = useAsync(() => api.get<AuditEntry[]>('/api/admin/audit?limit=100'), []);
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: () => Promise<string>) {
    try {
      setMessage(await action());
      accounts.reload();
      audit.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <Layout title="Painel do administrador">
      {message && <p className="message">{message}</p>}
      {accounts.error && <p className="error">{errorText(accounts.error)}</p>}
      <table>
        <thead>
          <tr>
            <th>Conta</th>
            <th>Situação</th>
            <th>Membros</th>
            <th>Id</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {accounts.data?.map((account) => (
            <tr key={account.id}>
              <td>{account.name}</td>
              <td>{account.status === 'active' ? 'Ativa' : 'Suspensa'}</td>
              <td>{account.members}</td>
              <td>
                <code>{account.id}</code>
              </td>
              <td>
                <button
                  onClick={() =>
                    act(async () => {
                      const status = account.status === 'active' ? 'suspended' : 'active';
                      await api.post(`/api/admin/accounts/${account.id}/status`, { status });
                      return status === 'suspended' ? `${account.name} suspensa.` : `${account.name} reativada.`;
                    })
                  }
                >
                  {account.status === 'active' ? 'Suspender' : 'Reativar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewAccountForm act={act} />
      <NewUserForm act={act} />
      <SetMemberForm act={act} />
      <section className="card">
        <h2>Auditoria (últimas 100)</h2>
        <ul>
          {audit.data?.map((entry) => (
            <li key={entry.id}>
              {formatDate(entry.at)} {entry.userEmail}: {entry.action} {entry.entity} ({entry.result})
              {entry.detail && ` ${entry.detail}`}
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}

type Act = (action: () => Promise<string>) => Promise<void>;

function NewAccountForm({ act }: { act: Act }) {
  const [name, setName] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/accounts', { name });
      setName('');
      return `Conta criada: ${id}`;
    });
  }
  return (
    <form onSubmit={submit} className="card">
      <h2>Nova conta</h2>
      <label>
        Nome
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Criar conta</button>
    </form>
  );
}

function NewUserForm({ act }: { act: Act }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/users', { email, name, ...(admin ? { platformRole: 'admin' } : {}) });
      setEmail('');
      setName('');
      return `Usuário criado: ${id}`;
    });
  }
  return (
    <form onSubmit={submit} className="card">
      <h2>Novo usuário</h2>
      <label>
        E-mail
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Nome
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Administrador da plataforma
      </label>
      <button type="submit">Criar usuário</button>
    </form>
  );
}

function SetMemberForm({ act }: { act: Act }) {
  const [accountId, setAccountId] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('owner');
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      await api.put(`/api/admin/accounts/${encodeURIComponent(accountId)}/members/${encodeURIComponent(userId)}`, { role });
      return 'Vínculo salvo.';
    });
  }
  return (
    <form onSubmit={submit} className="card">
      <h2>Vincular usuário a uma conta</h2>
      <label>
        Id da conta
        <input required value={accountId} onChange={(e) => setAccountId(e.target.value)} />
      </label>
      <label>
        Id do usuário
        <input required value={userId} onChange={(e) => setUserId(e.target.value)} />
      </label>
      <label>
        Papel
        <select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'member')}>
          <option value="owner">Dono</option>
          <option value="member">Membro</option>
        </select>
      </label>
      <button type="submit">Salvar</button>
    </form>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): invoices, invoice detail, members, and the admin panel"
```

---

### Task 11: Serve the web build from the server

**Files:**
- Create: `apps/server/src/web.ts`, `apps/server/src/web.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/auth/authHook.ts`, `apps/server/src/main.ts`, `apps/server/package.json`

**Interfaces:**
- Consumes: `buildApp` (Stage 1a-2), `apps/web/dist` (Task 10, `pnpm build:web`).
- Produces:
  - `AppDeps.webRoot?: string` (a folder with `index.html`; when set, the server serves it)
  - `registerWeb(app, webRoot)`: static files, and `index.html` for any `GET` that matches no route and is not under `/api`

The auth hook already skips matched non-`/api` routes. A request that matches no route has no `routeOptions.url`; the hook then decides by the decoded path: it authenticates only when that path starts with `/api/`, so `/%61pi/unknown` still answers 401 (Stage 1a-2 Important 1) and a page path such as `/favicon.ico` does not need a token.

- [ ] **Step 1: Add the dependency and write the failing tests**

Run: `pnpm --filter @notaflow/server add @fastify/static@^10.1.6`

`apps/server/src/web.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/openDatabase';

let root: string;
let app: ReturnType<typeof buildApp>;
let close: () => void;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'notaflow-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_ORIGIN: 'http://localhost:3000',
    NFSE_MASTER_KEY: Buffer.alloc(32).toString('base64'),
    AUTH_MODE: 'access',
    CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
    CF_ACCESS_AUD: 'aud',
  });
  const opened = openDatabase(':memory:');
  close = opened.close;
  app = buildApp({ config, db: opened.db, webRoot: root, verifyAccessToken: async () => { throw new Error('no'); } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  close();
  rmSync(root, { recursive: true, force: true });
});

test('serves index.html at the root and static assets', async () => {
  expect((await app.inject({ url: '/' })).body).toContain('id="root"');
  expect((await app.inject({ url: '/assets/app.js' })).body).toContain('console.log');
});

test('an unknown page path falls back to index.html without authentication', async () => {
  const response = await app.inject({ url: '/qualquer/coisa' });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('id="root"');
});

test('an unknown /api path still needs authentication, also when percent-encoded', async () => {
  expect((await app.inject({ url: '/api/nao-existe' })).statusCode).toBe(401);
  expect((await app.inject({ url: '/%61pi/nao-existe' })).statusCode).toBe(401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/web.test.ts`
Expected: FAIL, `webRoot` is not supported (`/` answers 401 or 404).

- [ ] **Step 3: Implement**

`apps/server/src/web.ts`:

```ts
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export function registerWeb(app: FastifyInstance, webRoot: string): void {
  app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !isApiPath(request.url)) return reply.sendFile('index.html');
    return reply.status(404).send({ error: 'not_found' });
  });
}

export function isApiPath(url: string): boolean {
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname).startsWith('/api/');
  } catch {
    // A path that does not decode is treated as an API path, so it is authenticated.
    return true;
  }
}
```

With `wildcard: false`, `@fastify/static` registers one route per file found at startup, so `/assets/app.js` is a matched non-`/api` route and needs no token.

In `apps/server/src/auth/authHook.ts`, import `isApiPath` from `../web` and change the skip rule:

```ts
    const route = request.routeOptions.url;
    if (route === '/api/health') return;
    if (route !== undefined ? !route.startsWith('/api/') : !isApiPath(request.url)) return;
```

In `apps/server/src/app.ts`, add `webRoot?: string` to `AppDeps` and call `if (deps.webRoot) registerWeb(app, deps.webRoot);` after the routes.

In `apps/server/src/main.ts`, pass `webRoot` when the build exists:

```ts
  const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const app = buildApp({ config, db, ...(existsSync(join(webRoot, 'index.html')) ? { webRoot } : {}) });
```

(import `existsSync` from `node:fs`, `join` from `node:path`, and `fileURLToPath` from `node:url`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS, including the route sweep: the static file routes do not start with `/api/`, so the sweep skips them.

- [ ] **Step 5: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): serve the web build with an SPA fallback outside /api"
```

---

### Task 12: Local run, docs, and the Stage 1a acceptance check (Lincoln runs part of it)

**Files:**
- Create: `apps/web/AGENTS.md`, `docs/ENGINEERING/ARCHITECTURE/SYNC.md`
- Modify: root `AGENTS.md`, `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md`, `apps/server/AGENTS.md`, `docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md`

**Interfaces:**
- Consumes: everything above.
- Produces: docs, a verified local run against the fake, and the RFC record of the Stage 1a acceptance.

- [ ] **Step 1: Run the whole suite and the build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pytest services/signer-py && pnpm build:web`
Expected: PASS, and `apps/web/dist/index.html` exists. `apps/web/dist` is ignored by the `dist/` rule in `.gitignore`; check with `git check-ignore -v apps/web/dist/index.html`.

- [ ] **Step 2: Run the app locally against the fake**

1. `apps/server/.env.local` (from `.env.example`) with `APP_ORIGIN=http://localhost:5173`, `AUTH_MODE=dev`, `DEV_USER_EMAIL=dev@example.com`, and `NACIONAL_FAKE_URL=http://127.0.0.1:4010`.
2. Write a test certificate outside the repository (the server package has `@notaflow/test-kit`):
   `pnpm --filter @notaflow/server exec tsx -e "import { makeTestCertificate } from '@notaflow/test-kit'; import { writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; const c = makeTestCertificate(); const f = join(tmpdir(), 'notaflow-teste.pfx'); writeFileSync(f, c.pfx); console.log(f, c.password)"`
3. Terminal 1: `pnpm fake:nacional`. Terminal 2: `pnpm seed:admin dev@example.com Dev`, then `pnpm dev:server`. Terminal 3: `pnpm dev:web`.
4. In the browser at `http://localhost:5173`:
   - Open the admin panel, create the account "Teste", and link `dev@example.com` as owner (the user id is in the audit list or in `GET /api/me`).
   - Open "Emitentes" and onboard the emitter with the test `.pfx` and its password, municipality `3550308`.
5. Issue three invoices on the running fake:
   `pnpm --filter @notaflow/server exec tsx -e "import('./test/fakeInvoices.ts').then((m) => m.issueOnFake({ urls: { sefin: 'http://127.0.0.1:4010/SefinNacional', adn: 'http://127.0.0.1:4010/adn' } }, 3)).then(console.log)"`
6. Press "Sincronizar agora", open "Notas", filter, open one invoice, and download the XML.

Expected: every screen loads, the environment badge reads "PRODUÇÃO RESTRITA (teste)", and the onboarding shows the success message. Record what you checked in the ledger.

- [ ] **Step 3: Write the docs**

`apps/web/AGENTS.md`:

```markdown
# Web: AI Context

The React UI, built with Vite. It talks only to the server API under `/api`.

## Quick Reference

- Entry: `src/main.tsx`; routes: `src/router.ts` (hash routes); API client and types: `src/api.ts`
- Run: `pnpm dev:web` (proxies `/api` to `127.0.0.1:3000`); build: `pnpm build:web` (the server serves `apps/web/dist`)
- Tests: Vitest with jsdom (`// @vitest-environment jsdom` at the top of a component test)

## Key Rules

1. UI text is in Brazilian Portuguese; code and comments are in English.
2. Amounts arrive in cents; format them only with `formatCents`.
3. Every API error code has a message in `ERROR_TEXT` (`src/components/Layout.tsx`).
4. The environment badge is always visible where an emitter or invoice is shown.
```

`docs/ENGINEERING/ARCHITECTURE/SYNC.md`:

```markdown
# ADN Sync

The server copies every invoice and event of each emitter from the ADN into SQLite. The ADN is the source of truth and the backup: after a database loss, a sync from NSU 0 rebuilds invoices, events, and imported customers.

## Flow

1. `SyncService.syncEmitter` reads the emitter's environment and the cursor (last NSU) of that environment. Production and produção restrita are separate ADNs, so each has its own cursor.
2. It calls `InvoiceProvider.fetchSince(cursor)`. A 429, a 5xx, or a network error is retried after 1, 5, and 15 seconds.
3. In one transaction it applies the batch (`applyDocument`) and saves the new cursor. A crash resumes from the last committed batch.
4. It repeats until the ADN has nothing new, then records the run in `sync_state`.

## Documents

- An NFS-e of the emitter: upsert the invoice by access key and the customer by document.
- An event: stored by access key, also before its invoice exists. A cancellation (101101) sets the invoice to `cancelled`.
- A skipped document (an invoice the emitter received, an unknown type, or a file that does not parse): counted; the cursor still moves.
- A customer field edited by hand is never overwritten.

## When it runs

- Every 30 minutes for every emitter (`startScheduler` in `main.ts`).
- Right after onboarding.
- On "Sincronizar agora" (`POST /api/accounts/:accountId/emitters/:emitterId/sync`). One sync per emitter at a time; a second request answers 409 `sync_running`.

Code: `apps/server/src/sync/`.
```

In the root `AGENTS.md`, add `| Web | [apps/web/AGENTS.md](apps/web/AGENTS.md) |` to the package table and `| pnpm dev:web | Vite dev server for the UI, proxying /api to the local server |` and `| pnpm build:web | Build the UI into apps/web/dist |` to the commands. In `OVERVIEW.md`, change the `apps/web` row to "React UI, built with Vite and served by the server (Stage 1a-3)." and add a link to `SYNC.md`. In `apps/server/AGENTS.md`, add `- [ADN Sync](../../docs/ENGINEERING/ARCHITECTURE/SYNC.md) - cursor, retries, and document rules` to the index.

- [ ] **Step 4: Commit**

```bash
git add apps/web/AGENTS.md docs AGENTS.md apps/server/AGENTS.md
git commit -m "docs: web package, ADN sync, and the Stage 1a commands"
```

- [ ] **Step 5: Stage 1a acceptance with the real certificate (Lincoln runs it)**

The RFC says Stage 1a is done when the Vapulab account exists, its certificate is uploaded, and the invoices issued to CoGrader are listed from the ADN. The production ADN calls in this check are read-only.

1. In `apps/server/.env.local`, remove `NACIONAL_FAKE_URL` (the server then calls gov.br), keep `AUTH_MODE=dev`, and set `DEV_USER_EMAIL` to Lincoln's email. Run `pnpm seed:admin <email> <name>`, `pnpm dev:server`, and `pnpm dev:web`.
2. In the UI: create the account "Vapulab", link Lincoln as owner, onboard the emitter with the real `.pfx` (municipality `4113700`, Simples Nacional `3`, regime `1`). The connection test runs against produção restrita.
3. Switch the emitter to production (type `producao`), then press "Sincronizar agora".
4. Open "Notas".

Expected: the real invoices issued to CoGrader are listed, with the right numbers, competences, and amounts; the invoices where Vapulab is the customer are not listed. Nothing is issued and nothing is cancelled.

- [ ] **Step 5b: Record the acceptance in the RFC**

In `RFC_NFSE_EMITTER.md`, under "Stage 0 Results", add a subsection with counts only (no CNPJ, no access key, no customer name, no amount):

```markdown
### Stage 1a acceptance (2026-10-xx)

- Account, owner, and emitter created through the UI; connection test passed in produção restrita.
- After the switch to production, "Sincronizar agora" listed N invoices of the emitter and skipped N received invoices.
```

```bash
git add docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md
git commit -m "docs(rfc): record the Stage 1a acceptance"
```
