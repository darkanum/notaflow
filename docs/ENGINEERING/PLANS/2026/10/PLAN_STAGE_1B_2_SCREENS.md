# Stage 1b-2 (Screens on Malphas, Idempotent Issue, and the Acceptance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every NotaFlow screen on the Vapulab Malphas design system, add the screens to issue a similar invoice, cancel, reconcile, and edit customers, make issue idempotent, handle a second cancel, and run the Stage 1b acceptance in produção restrita.

**Architecture:** Malphas is a Go templ library with a Tailwind 3 preset, a `tokens.css` file, and a font. NotaFlow's web app is React, so the plan copies the theme files into `apps/web/src/malphas/` (with a check script against the private `darkanum/vapulab` repo), adds Tailwind with the Malphas preset, and writes thin React components in `apps/web/src/ui/` that repeat the class strings of each Malphas component. Every existing page moves to those components; the new pages are built on them. On the server, `POST /invoices/issue` takes an `Idempotency-Key` header stored on the pending row, and a cancel that the Sefin refuses because the invoice is already cancelled marks the row `cancelled`.

**Tech Stack:** React 19, Vite 7, Tailwind CSS 3.4 with PostCSS and Autoprefixer, Vitest 3 with jsdom and Testing Library, Fastify 5, Drizzle 0.45.

**Spec:** [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md), sections "Flow: issue a new invoice", "Flow: cancel", "Invoice status", "Delivery Stages" (1b). [Invoice Lifecycle](../../ARCHITECTURE/INVOICE_LIFECYCLE.md) for the server API built in Stage 1b-1.

**Decisions from Lincoln (2026-10-09):**
- Every screen uses the Malphas UI from `darkanum/vapulab` (folder `malphas/`, MIT license, private repo). The theme files are copied into NotaFlow (public) with a source note and a check script; CI does not need a token for the private repo.
- The existing screens (home, emitters, onboarding, invoices, invoice detail, members, admin) move to Malphas in this stage, not later.
- From the PR #16 review: an idempotency key on issue (a double submit, or a retry after a Cloudflare 524, must not issue twice), and a second cancel of a cancelled invoice must not answer "refused" while the invoice is cancelled. The real Sefin code for "already cancelled" comes from the acceptance in produção restrita.
- Every invoice issued in a test is cancelled afterwards, and the acceptance ends with a list of issued and cancelled invoices.

## Global Constraints

- Never use TypeScript non-null assertions (`value!`). ESLint enforces it.
- A credential or real invoice data never enters git: no real CNPJ, customer name, amount, or access key in tests, fixtures, plans, or docs. Tests use synthetic data (CNPJ `12345678000195`). See `docs/ENGINEERING/CONVENTIONS/SECRETS.md`.
- Amounts are integer cents; the UI formats them only with `formatCents`. An exchange rate is an integer scaled by 10 000.
- UI text is in Brazilian Portuguese; code, comments, and docs are in English. Docs follow the Writing Style (no em dash).
- Every API error code the UI can receive has a message in `ERROR_TEXT`.
- The environment badge is visible on every screen that shows an emitter or an invoice, and on the issue review and the cancel confirmation.
- Tailwind is version 3.4 (the Malphas preset uses the 3.4 `darkMode: ['variant', ...]` form). No Alpine and no `malphas.js`: React owns behavior. The Malphas class strings are copied exactly; a deviation needs a ledger ruling.
- New dependencies are exact-range dev dependencies of `@notaflow/web` only: `tailwindcss@^3.4.17`, `postcss@^8.4.49`, `autoprefixer@^10.4.20`.
- Every new server route uses the existing guards (`write` for issue, cancel, reconcile, customer edits) and appears in the route sweep.
- Commits carry no AI attribution. Never pass `--no-verify`. On Lincoln's Windows machine, add the `gitleaks` folder to `PATH` before `git commit`. Scripts run on Windows and Linux.
- PRs target `production`. Tests run locally: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build:web`, `pytest services/signer-py`.

## Review Focus

1. The user clicks "Emitir" twice, or the browser retries after a 524. Expected: one DPS number, one pending row, one NFS-e; the second request answers the first row's current state. Pinned in Task 1 (server) and Task 7 (the form keeps one key per review).
2. The Sefin refuses a cancel because the invoice is already cancelled (the first cancel timed out after it was registered). Expected: the row ends `cancelled`, and the user sees "já estava cancelada", not an error. Pinned in Task 2.
3. A production emitter: the review screen and the cancel dialog must say PRODUÇÃO loudly before the user confirms. Expected: the badge is in both, and the confirm button text names the environment. Pinned in Task 7 and Task 8.
4. The PTAX service is down or has no quote. Expected: the form says so and keeps the BRL amount editable; issue still works with a typed amount. Pinned in Task 7.
5. Dark mode (OS dark or `data-theme="dark"`): every page stays readable, because the colors come only from the Malphas tokens. Expected: no hard-coded color class in `apps/web/src` outside `src/malphas/`. Pinned in Task 6 with a test that scans the sources.

---

## File Structure

```
apps/server/
  drizzle/0003_invoice_idempotency.sql   idempotency_key + unique (emitter_id, idempotency_key)
  src/db/schema.ts                       invoices.idempotencyKey
  src/repos/InvoiceRepository.ts         findByIdempotencyKey, get adds sefinMessages and templateOf
  src/issue/IssueService.ts              idempotent issue, already-cancelled
  src/routes/issue.ts                    Idempotency-Key header
apps/web/
  package.json, tailwind.config.cjs, postcss.config.cjs
  public/malphas-assets/fonts/SpaceGrotesk.woff2
  src/malphas/tokens.css, preset.cjs, SOURCE.md       copied from darkanum/vapulab
  src/index.css                                     tokens + Tailwind layers
  src/ui/                                           React components that repeat Malphas classes
    classes.ts, Button.tsx, Badge.tsx, Alert.tsx, Card.tsx, Field.tsx, Table.tsx,
    Modal.tsx, Link.tsx, Spinner.tsx, index.ts, ui.test.tsx
  src/components/Layout.tsx, EnvironmentBadge.tsx, CertificateWarning.tsx
  src/pages/*.tsx                                   restyled; new: IssuePage, CustomersPage, CustomerPage, CancelDialog
  src/router.ts, src/App.tsx, src/api.ts, src/format.ts
scripts/malphas-check.mjs                           compares the copy with darkanum/vapulab
docs/ENGINEERING/ARCHITECTURE/WEB_UI.md
```

---

### Task 1: Idempotent issue on the server

**Files:**
- Modify: `apps/server/src/db/schema.ts`; create `apps/server/drizzle/0003_invoice_idempotency.sql` (generated)
- Modify: `apps/server/src/repos/InvoiceRepository.ts`, `apps/server/src/issue/IssueService.ts`, `apps/server/src/routes/issue.ts`
- Test: `apps/server/src/routes/issue.test.ts`

**Interfaces:**
- Produces:
  - `invoices.idempotency_key text`, unique index `invoices_emitter_idempotency_key` on `(emitter_id, idempotency_key)` (SQLite unique indexes allow many NULLs).
  - `InvoiceRepository.findByIdempotencyKey(ctx, emitterId, key): string | null`
  - `InvoiceRepository.resultView(ctx, invoiceId): IssueResultView | null` (status, number, accessKey, and `errors` from `sefinMessages` when rejected)
  - `createPending` input gains `idempotencyKey?: string`.
  - `IssueResultView.status` gains `'pending'`.
  - `POST /invoices/issue` reads the `Idempotency-Key` header (8 to 100 characters of `[A-Za-z0-9-]`, else 400 `invalid_idempotency_key`). A repeat answers `200` with the existing row's view; a first call answers `201` as before. Without the header the route behaves as in Stage 1b-1.

- [ ] **Step 1: Write the failing tests** (append to `issue.test.ts`)

```ts
test('the same Idempotency-Key twice issues once and answers the same invoice', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const request = {
    method: 'POST' as const,
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers: { ...headers, 'idempotency-key': 'form-0001-abcdef' },
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 670321, foreignAmountCents: 123400 },
  };
  const first = await t.app.inject(request);
  const second = await t.app.inject(request);
  expect(first.statusCode).toBe(201);
  expect(second.statusCode).toBe(200);
  expect(second.json()).toEqual(first.json());
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  expect(list.json()).toMatchObject({ total: 2 });
});

test('two requests with one key at the same time make one invoice', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const request = {
    method: 'POST' as const,
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers: { ...headers, 'idempotency-key': 'form-0002-abcdef' },
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 100, foreignAmountCents: 20 },
  };
  const [one, two] = await Promise.all([t.app.inject(request), t.app.inject(request)]);
  expect(one.json().id).toBe(two.json().id);
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  expect(list.json()).toMatchObject({ total: 2 });
});

test('a malformed Idempotency-Key is 400', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers: { ...headers, 'idempotency-key': 'x' },
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 100, foreignAmountCents: 20 },
  });
  expect(response.json()).toEqual({ error: 'invalid_idempotency_key' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/server/src/routes/issue.test.ts`
Expected: FAIL; the second request issues a second invoice (`total` 3), and the malformed key is accepted.

- [ ] **Step 3: Implement**

`schema.ts`, in `invoices`, after `templateOf`:

```ts
  // Sent by the issue form; a repeat of the same key answers the first row.
  idempotencyKey: text('idempotency_key'),
```

and the table's third argument adds `uniqueIndex('invoices_emitter_idempotency_key').on(table.emitterId, table.idempotencyKey)` (convert the table definition to the `(table) => [...]` form used by `invoiceEvents`). Generate the migration: `pnpm --filter @notaflow/server exec drizzle-kit generate --name invoice_idempotency`.

`IssueService.issue(ctx, actor, input, idempotencyKey?: string)`:
1. After `loadTemplate` and before the checks: if a key is given and `findByIdempotencyKey(ctx, state.emitterId, key)` finds a row, return `{ repeat: true, view: resultView(...) }`.
2. Inside the reservation transaction, run the same lookup again before `reserveDpsNumber` (two requests can pass step 1 together while the first awaits the certificate); a hit returns that row's view without reserving.
3. Pass `idempotencyKey` to `createPending`.

The method returns `{ view: IssueResultView; repeat: boolean }`; the route answers `repeat ? 200 : 201`. Validate the header in the route with `/^[A-Za-z0-9-]{8,100}$/`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): idempotent issue with an Idempotency-Key stored on the pending row"
```

---

### Task 2: A second cancel, and the detail the screens need

**Files:**
- Modify: `apps/server/src/issue/IssueService.ts`, `apps/server/src/repos/InvoiceRepository.ts`
- Test: `apps/server/src/routes/cancel.test.ts`, `apps/server/src/routes/invoices.test.ts`

**Interfaces:**
- Produces:
  - `ALREADY_CANCELLED_CODES: string[]` in `IssueService.ts`, starting as `['E0840']` (the fake's code; Task 10 records the real one).
  - A cancel refused with one of those codes marks the row `cancelled` and answers `200 { id, status: 'cancelled', alreadyCancelled: true }`; audit `invoice.cancel` result `ok`, detail `already cancelled at the Sefin`.
  - `GET /invoices/:id` adds `sefinMessages: { code, message }[] | null` and `templateOf: string | null`.

- [ ] **Step 1: Write the failing tests**

`cancel.test.ts`:

```ts
test('a cancel refused because the invoice is already cancelled marks it cancelled', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('event', { kind: 'reply', status: 400, body: { erro: { Codigo: 'E0840', Descricao: 'NFS-e já cancelada.' } } });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`,
    headers,
    payload: { reason: '1', justification: 'Valor do serviço incorreto' },
  });
  expect(response.json()).toEqual({ id: templateInvoiceId, status: 'cancelled', alreadyCancelled: true });
  const detail = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}`, headers });
  expect(detail.json()).toMatchObject({ status: 'cancelled' });
});
```

`invoices.test.ts`, inside the first test after the detail request:

```ts
  expect(detail.json()).toMatchObject({ sefinMessages: null, templateOf: null });
```

- [ ] **Step 2: Run, fail, implement, run, pass**

Run: `pnpm vitest run apps/server/src/routes/cancel.test.ts apps/server/src/routes/invoices.test.ts` → FAIL (422, and the two fields are missing). Implement: in `cancel`, before throwing `sefin_rejected`, check `ALREADY_CANCELLED_CODES.includes(outcome.error.code)` and call `markCancelled`; in `InvoiceRepository.get`, select `sefinMessages` and `templateOf` next to the summary. Then `pnpm vitest run apps/server && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server
git commit -m "feat(server): an already cancelled invoice ends cancelled, and the detail carries Sefin messages"
```

---

### Task 3: Malphas theme and Tailwind in the web app

**Files:**
- Create: `apps/web/src/malphas/tokens.css`, `apps/web/src/malphas/preset.cjs`, `apps/web/src/malphas/SOURCE.md`, `apps/web/public/malphas-assets/fonts/SpaceGrotesk.woff2`
- Create: `apps/web/tailwind.config.cjs`, `apps/web/postcss.config.cjs`, `apps/web/src/index.css`
- Create: `scripts/malphas-check.mjs`, `scripts/malphas-check.test.ts`
- Modify: `apps/web/package.json`, `apps/web/src/main.tsx`, `apps/web/index.html`, root `package.json`
- Delete: `apps/web/src/styles.css` (in Task 6, after the last page moves)

**Interfaces:**
- Produces: Tailwind utilities with the Malphas colors (`bg-primary`, `text-fg`, `border-border`, `bg-danger/10`, ...), `font-display`, the `dark:` variant; `pnpm malphas:check`; `compareCopies(pairs: { local: Buffer; remote: Buffer; name: string }[]): string[]` (names that differ).

- [ ] **Step 1: Copy the theme files from the private repo**

Run from the repo root (Git Bash; `unset GH_TOKEN` first on Lincoln's machine):

```bash
REF=$(gh api "repos/darkanum/vapulab/commits?path=malphas&per_page=1" -q '.[0].sha')
mkdir -p apps/web/src/malphas apps/web/public/malphas-assets/fonts
gh api "repos/darkanum/vapulab/contents/malphas/theme/tokens.css?ref=$REF" -q .content | base64 -d > apps/web/src/malphas/tokens.css
gh api "repos/darkanum/vapulab/contents/malphas/theme/preset.js?ref=$REF" -q .content | base64 -d > apps/web/src/malphas/preset.cjs
gh api "repos/darkanum/vapulab/contents/malphas/assets/fonts/SpaceGrotesk.woff2?ref=$REF" -q .content | base64 -d > apps/web/public/malphas-assets/fonts/SpaceGrotesk.woff2
echo "$REF"
```

`apps/web/src/malphas/SOURCE.md`:

```markdown
# Malphas theme (copied)

These files are copies from the Malphas design system in `darkanum/vapulab` (MIT license), folder `malphas/`:

| Here | There |
| --- | --- |
| `tokens.css` | `malphas/theme/tokens.css` |
| `preset.cjs` | `malphas/theme/preset.js` |
| `apps/web/public/malphas-assets/fonts/SpaceGrotesk.woff2` | `malphas/assets/fonts/SpaceGrotesk.woff2` |

Copied at commit `<REF>`. Do not edit them here: change Malphas, then copy again. `pnpm malphas:check` tells whether the copies still match.

The React components in `src/ui/` repeat the class strings of `malphas/components/*.templ`.
```

(Write the real `$REF` in place of `<REF>`.)

- [ ] **Step 2: Tailwind, PostCSS, and the stylesheet**

Run: `pnpm --filter @notaflow/web add -D tailwindcss@^3.4.17 postcss@^8.4.49 autoprefixer@^10.4.20`

`apps/web/tailwind.config.cjs`:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('./src/malphas/preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

`apps/web/postcss.config.cjs`:

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`apps/web/src/index.css`:

```css
@import './malphas/tokens.css';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`main.tsx`: replace `import './styles.css';` with `import './index.css';` and keep `styles.css` imported after it until Task 6 deletes it (`import './styles.css';` on the next line).

`index.html`: `<html lang="pt-BR">` stays; add `<link rel="icon" type="image/svg+xml" href="/malphas-assets/favicon.svg" />` only if the favicon is copied too (copy `malphas/assets/favicon.svg` into `public/malphas-assets/` with the same command pattern and list it in `SOURCE.md`), and set `<body class="min-h-screen bg-surface text-fg font-sans antialiased">` (the Malphas `layout/base.templ` body classes).

- [ ] **Step 3: The check script, test first**

`scripts/malphas-check.test.ts`:

```ts
import { expect, test } from 'vitest';
import { compareCopies } from './malphas-check.mjs';

test('compareCopies names only the files whose bytes differ', () => {
  expect(
    compareCopies([
      { name: 'a', local: Buffer.from('x'), remote: Buffer.from('x') },
      { name: 'b', local: Buffer.from('x'), remote: Buffer.from('y') },
    ]),
  ).toEqual(['b']);
});
```

Run: `pnpm vitest run scripts/malphas-check.test.ts` → FAIL (module missing).

`scripts/malphas-check.mjs`:

```js
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FILES = [
  ['apps/web/src/malphas/tokens.css', 'malphas/theme/tokens.css'],
  ['apps/web/src/malphas/preset.cjs', 'malphas/theme/preset.js'],
  ['apps/web/public/malphas-assets/fonts/SpaceGrotesk.woff2', 'malphas/assets/fonts/SpaceGrotesk.woff2'],
];

export function compareCopies(pairs) {
  return pairs.filter((pair) => !pair.local.equals(pair.remote)).map((pair) => pair.name);
}

function remote(path) {
  // A stale GH_TOKEN in the shell would override the gh login.
  const env = { ...process.env };
  delete env.GH_TOKEN;
  const base64 = execFileSync('gh', ['api', `repos/darkanum/vapulab/contents/${path}`, '-q', '.content'], {
    env,
    encoding: 'utf8',
  });
  return Buffer.from(base64.replace(/\s/g, ''), 'base64');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const differing = compareCopies(
    FILES.map(([local, path]) => ({ name: local, local: readFileSync(local), remote: remote(path) })),
  );
  if (differing.length === 0) console.log('Malphas copies match darkanum/vapulab.');
  else {
    console.log(`Malphas copies differ: ${differing.join(', ')}. Copy them again (see SOURCE.md).`);
    process.exitCode = 1;
  }
}
```

Root `package.json` script: `"malphas:check": "node scripts/malphas-check.mjs"`. If the root `tsconfig.json` or ESLint config rejects the `.mjs` import in a `.ts` test, add `scripts/malphas-check.d.mts` with `export function compareCopies(pairs: { name: string; local: Buffer; remote: Buffer }[]): string[];` and record the ruling.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run scripts/malphas-check.test.ts && pnpm malphas:check && pnpm build:web && grep -l "bg-surface" apps/web/dist/assets/*.css && grep -c -- "--color-primary" apps/web/dist/assets/*.css`
Expected: PASS; "Malphas copies match"; the build succeeds; the CSS has the body utility and the tokens.

Run: `pnpm test && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web scripts package.json pnpm-lock.yaml
git commit -m "feat(web): Malphas theme and Tailwind, with a check against the design system repo"
```

---

### Task 4: Malphas components in React

**Files:**
- Create: `apps/web/src/ui/classes.ts`, `Button.tsx`, `Badge.tsx`, `Alert.tsx`, `Card.tsx`, `Field.tsx`, `Table.tsx`, `Modal.tsx`, `Link.tsx`, `Spinner.tsx`, `index.ts`, `ui.test.tsx`

**Interfaces:**
- Produces (all exported from `src/ui/index.ts`):
  - `buttonClasses({ variant?: 'primary' | 'secondary' | 'danger'; size?: 'sm' | 'md' | 'lg' })`, `badgeClasses({ variant?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'; size?: 'sm' | 'md'; outline?: boolean })`, `alertClasses(variant?: 'info' | 'success' | 'warning' | 'error')`, `linkClasses({ variant?: 'primary' | 'muted' | 'danger'; underline?: boolean })`, `INPUT_CLASSES`, `SELECT_CLASSES`, `LABEL_CLASSES`, `CARD_CLASSES`
  - `Button` (native button props plus `variant`, `size`; `type` defaults to `button`), `Badge`, `Alert` (`role="alert"`), `Card`, `Field` (`label` plus one child control, wrapped in a `<label>` so `getByLabelText` keeps working), `Input`, `Select`, `Textarea` (Malphas has no textarea; it uses `INPUT_CLASSES` with `h-auto min-h-24 py-2`), `Table`, `THead`, `TBody`, `TH`, `TD`, `Modal` (`open`, `title`, `onClose`, children), `Link`, `Spinner` (`label` default "Carregando")

`classes.ts` holds the exact strings from the Malphas `.templ` files:

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function buttonClasses(p: { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' } = {}): string {
  const base =
    'inline-flex items-center justify-center font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50';
  const variant = {
    primary: 'bg-primary text-primary-fg hover:bg-primary/90',
    secondary: 'bg-surface text-fg border border-border hover:bg-muted/10',
    danger: 'bg-danger text-danger-fg hover:bg-danger/90',
  }[p.variant ?? 'primary'];
  const size = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[p.size ?? 'md'];
  return `${base} ${variant} ${size}`;
}

export function badgeClasses(p: { variant?: BadgeVariant; size?: 'sm' | 'md'; outline?: boolean } = {}): string {
  const base = 'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap';
  const variant = p.variant ?? 'neutral';
  const color = p.outline
    ? {
        neutral: 'border border-border text-fg',
        primary: 'border border-primary text-primary',
        success: 'border border-success text-success',
        warning: 'border border-warning text-warning',
        danger: 'border border-danger text-danger',
        info: 'border border-info text-info',
      }[variant]
    : {
        neutral: 'bg-muted/20 text-fg',
        primary: 'bg-primary text-primary-fg',
        success: 'bg-success text-success-fg',
        warning: 'bg-warning text-warning-fg',
        danger: 'bg-danger text-danger-fg',
        info: 'bg-info text-info-fg',
      }[variant];
  const size = { sm: 'px-2 py-0.5 text-xs', md: 'px-2.5 py-1 text-xs' }[p.size ?? 'md'];
  return `${base} ${color} ${size}`;
}

export function alertClasses(variant: 'info' | 'success' | 'warning' | 'error' = 'info'): string {
  const base = 'flex items-start gap-3 rounded border p-4 text-sm text-fg';
  return `${base} ${
    {
      info: 'border-info/40 bg-info/10',
      success: 'border-success/40 bg-success/10',
      warning: 'border-warning/40 bg-warning/10',
      error: 'border-danger/40 bg-danger/10',
    }[variant]
  }`;
}

export function linkClasses(p: { variant?: 'primary' | 'muted' | 'danger'; underline?: boolean } = {}): string {
  const base = 'rounded-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50';
  const variant = {
    primary: 'text-primary hover:text-primary/80',
    muted: 'text-muted hover:text-fg',
    danger: 'text-danger hover:text-danger/80',
  }[p.variant ?? 'primary'];
  return `${base} ${variant} ${p.underline ? 'underline' : 'hover:underline'}`;
}

export const CARD_CLASSES = 'rounded border border-border bg-surface p-6 shadow-sm';
export const LABEL_CLASSES = 'text-sm font-medium text-fg';
export const INPUT_CLASSES =
  'h-10 px-3 rounded border border-border bg-surface text-fg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
export const SELECT_CLASSES =
  'h-10 w-full appearance-none rounded border border-border bg-surface px-3 pr-9 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50';
export const TABLE_CLASSES =
  'w-full border-collapse text-left text-sm [&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-3';
export const THEAD_CLASSES = 'border-b border-border text-xs uppercase tracking-wide text-muted';
export const TBODY_CLASSES = '[&_tr]:border-b [&_tr]:border-border [&_tr:last-child]:border-0';
export const MODAL_PANEL_CLASSES =
  'relative z-10 max-h-full w-full max-w-md overflow-y-auto rounded border border-border bg-surface p-6 shadow-lg focus:outline-none';
```

`Modal.tsx` uses a native `<dialog>` (focus trap, Escape, and inert background come with `showModal()`), styled with the Malphas panel and backdrop:

```tsx
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { MODAL_PANEL_CLASSES } from './classes';

export function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={props.onClose}
      className={`${MODAL_PANEL_CLASSES} backdrop:bg-black/50`}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold text-fg">
          {props.title}
        </h2>
        <button
          type="button"
          aria-label="Fechar"
          className="rounded text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      {props.children}
    </dialog>
  );
}
```

`Field.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { INPUT_CLASSES, LABEL_CLASSES, SELECT_CLASSES } from './classes';

// Malphas pairs label and control with for/id; wrapping does the same without ids to manage.
export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL_CLASSES}>{props.label}</span>
      {props.children}
      {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASSES} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${INPUT_CLASSES} h-auto min-h-24 py-2 ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={SELECT_CLASSES} />
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
        ▾
      </span>
    </div>
  );
}
```

The other components are one element each: `Button` renders `<button type={type ?? 'button'} className={buttonClasses(...)}>`; `Badge` a `<span>`; `Alert` a `<div role="alert">`; `Card` a `<div className={CARD_CLASSES + className}>`; `Link` an `<a>`; `Table` a `<div className="w-full overflow-x-auto"><table className={TABLE_CLASSES}>`; `THead`, `TBody`, `TH` (`scope="col"`, `font-medium`), `TD` (`text-fg`); `Spinner` a `<span role="status" aria-label={label}>` with `inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent text-primary` (the Malphas Loading spinner, `md`, `primary`).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/ui/ui.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { Badge, Button, buttonClasses, Field, Input, Modal } from './index';

beforeAll(() => {
  // jsdom has no showModal; the browser one adds the focus trap that tests cannot see anyway.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => cleanup());

test('button classes are the Malphas ones', () => {
  expect(buttonClasses({ variant: 'danger', size: 'sm' })).toBe(
    'inline-flex items-center justify-center font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 bg-danger text-danger-fg hover:bg-danger/90 h-8 px-3 text-sm',
  );
});

test('a Button is type button unless told otherwise', () => {
  render(<Button>Salvar</Button>);
  expect(screen.getByRole('button', { name: 'Salvar' }).getAttribute('type')).toBe('button');
});

test('a Field label names its control', () => {
  render(
    <Field label="E-mail">
      <Input type="email" />
    </Field>,
  );
  expect(screen.getByLabelText('E-mail').tagName).toBe('INPUT');
});

test('the Modal opens, shows its title, and closes from its button', () => {
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <Modal open={open} title="Cancelar nota" onClose={() => setOpen(false)}>
        <Badge variant="danger">PRODUÇÃO</Badge>
      </Modal>
    );
  }
  render(<Host />);
  expect(screen.getByRole('dialog', { name: 'Cancelar nota' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
```

- [ ] **Step 2: Run, fail, implement, run, pass**

Run: `pnpm vitest run apps/web/src/ui` → FAIL (module missing). Implement every file above. Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/ui
git commit -m "feat(web): Malphas components in React, with the exact Malphas classes"
```

---

### Task 5: Layout, navigation, badges, and error texts

**Files:**
- Modify: `apps/web/src/components/Layout.tsx`, `EnvironmentBadge.tsx`, `CertificateWarning.tsx`, `components.test.tsx`

**Interfaces:**
- Produces:
  - `Layout({ title, accountId?, children })`: a Malphas Navbar (`header.border-b.border-border.bg-surface`, `nav.mx-auto.flex.max-w-5xl.items-center.gap-6.px-4.py-3`), brand "NotaFlow" in `font-display font-semibold text-fg`, and, when `accountId` is given, links Notas, Emitentes, Clientes, Membros (`linkClasses({ variant: 'muted' })`, `aria-current="page"` on the current one). `main` is `mx-auto max-w-5xl px-4 py-8`, the title `font-display text-2xl font-semibold mb-6`.
  - `EnvironmentBadge`: `Badge` `danger` with "PRODUÇÃO" for `producao`, `Badge` `warning` with "PRODUÇÃO RESTRITA (teste)" otherwise, size `md` plus `text-sm px-3 py-1.5` so it stays loud. Same texts as today.
  - `CertificateWarning`: `Alert` `warning`, same texts.
  - `ERROR_TEXT` gains:

```ts
  template_unsupported: 'Esta nota tem campos que o NotaFlow ainda não sabe copiar.',
  template_not_issued: 'Só uma nota emitida ou cancelada serve de modelo.',
  invalid_amount: 'Informe um valor maior que zero.',
  competence_after_issue: 'A competência não pode ser depois de hoje.',
  customer_without_document: 'Este cliente não tem CNPJ, CPF ou NIF.',
  customer_not_found: 'Cliente não encontrado.',
  not_unknown: 'Esta nota não está pendente nem incerta.',
  not_issued: 'Só uma nota emitida pode ser cancelada.',
  sefin_rejected: 'A Sefin recusou o pedido.',
  sefin_unavailable: 'A Sefin não respondeu. Tente de novo em alguns minutos.',
  ptax_unavailable: 'Não foi possível buscar a cotação PTAX. Informe o valor em reais.',
  unsupported_currency: 'Moeda sem cotação automática. Informe o valor em reais.',
  invalid_justification: 'A justificativa precisa ter de 15 a 255 caracteres.',
  invalid_address: 'Endereço incompleto.',
  invalid_idempotency_key: 'Erro interno do formulário. Recarregue a página.',
```

- [ ] **Step 1: Write the failing tests** (append to `components.test.tsx`)

```tsx
test('the layout shows the account links and marks the current page', () => {
  window.location.hash = '#/a/acc/invoices';
  render(
    <Layout title="Notas" accountId="acc">
      <p>conteúdo</p>
    </Layout>,
  );
  expect(screen.getByRole('link', { name: 'Notas' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Clientes' }).getAttribute('href')).toBe('#/a/acc/customers');
});

test('every error code the server can send has a text', () => {
  for (const code of ['template_unsupported', 'sefin_rejected', 'ptax_unavailable', 'invalid_idempotency_key']) {
    expect(ERROR_TEXT[code]).toBeTruthy();
  }
});
```

(Import `Layout` and `ERROR_TEXT` from `./Layout`.) The route `customers` does not exist yet: add `{ name: 'customers'; accountId }` and `{ name: 'customer'; accountId; customerId }` to `Route`, `parseRoute`, and `routeHref` in this task, with cases in `router.test.ts`:

```ts
test('customer routes', () => {
  expect(parseRoute('#/a/acc/customers')).toEqual({ name: 'customers', accountId: 'acc' });
  expect(parseRoute('#/a/acc/customers/c1')).toEqual({ name: 'customer', accountId: 'acc', customerId: 'c1' });
  expect(routeHref({ name: 'customer', accountId: 'acc', customerId: 'c1' })).toBe('#/a/acc/customers/c1');
});
```

- [ ] **Step 2: Run, fail, implement, run, pass**

Run: `pnpm vitest run apps/web` → FAIL. Implement. Until Task 9 adds the pages, `App.tsx` sends the `customers` and `customer` routes to the home page. Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): Malphas layout with account navigation, loud environment badge, and error texts"
```

---

### Task 6: Move the existing pages to Malphas

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`, `EmittersPage.tsx`, `OnboardingForm.tsx`, `InvoicesPage.tsx`, `InvoiceDetailPage.tsx`, `MembersPage.tsx`, `AdminPage.tsx`
- Delete: `apps/web/src/styles.css` (and its import in `main.tsx`)
- Create: `apps/web/src/ui/noRawColors.test.ts`

Behavior does not change: every existing test in `apps/web` passes unchanged, except where a test looks up an element by a class name that no longer exists (none do today).

Mapping, applied to every page:

| Today | Malphas |
| --- | --- |
| `<Layout title=...>` on an account page | `<Layout title=... accountId={accountId}>` |
| `className="card"` (`section`, `form`, `li`, `dl`) | `<Card>` (or `CARD_CLASSES` on the same element when the element must stay a `form` or `dl`), with `flex flex-col gap-4` on forms |
| `<label>Text<input .../></label>` | `<Field label="Text"><Input .../></Field>` (same for `select` with `Select`) |
| `<button>` | `<Button>`; the main action of a form is `variant="primary"` with `type="submit"`, others `variant="secondary"`; "Passar para PRODUÇÃO" is `variant="danger"` |
| `className="error"` paragraph | `<Alert variant="error">` |
| `className="message"` paragraph | `<Alert variant="info">` |
| `className="warning"` | `<Alert variant="warning">` |
| `<table>`, `thead`, `tbody`, `th`, `td` | `Table`, `THead`, `TBody`, `TH`, `TD` |
| `<a href=...>` inside text | `<Link href=...>` |
| status cell `status-<x>` | `<Badge variant={STATUS_VARIANT[status]}>` with `STATUS_VARIANT = { pending: 'info', issued: 'success', rejected: 'danger', unknown: 'warning', cancelled: 'neutral' }` exported from `InvoicesPage.tsx` next to `STATUS_TEXT` |
| "Carregando..." | `<Spinner />` |
| `label.button` file input ("Trocar certificado") | `<label className={buttonClasses({ variant: 'secondary' })}>` with the hidden input inside |
| `<h2>` in a card | `className="font-display text-lg font-semibold mb-2"` |
| `dl` in the invoice detail | `grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2`, `dt` `text-sm text-muted`, `dd` `text-fg` |

- [ ] **Step 1: Write the failing test**

`apps/web/src/ui/noRawColors.test.ts` keeps dark mode working (Review Focus 5): colors come only from the Malphas tokens.

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SRC = join(__dirname, '..');
// Tailwind palette colors (bg-red-500, text-gray-700, ...) and hex literals bypass the tokens.
const RAW = /\b(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b|#[0-9a-fA-F]{3,8}\b/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'malphas' ? [] : files(path);
    return /\.(tsx?|css)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

// The Malphas modal overlay is the one raw color the design system itself uses.
const ALLOWED = ['backdrop:bg-black/50'];

test('no source outside src/malphas uses a color that is not a Malphas token', () => {
  const offenders = files(SRC).filter((path) => {
    const text = ALLOWED.reduce((all, allowed) => all.split(allowed).join(''), readFileSync(path, 'utf8'));
    return RAW.test(text);
  });
  expect(offenders).toEqual([]);
});
```

Run: `pnpm vitest run apps/web/src/ui/noRawColors.test.ts`
Expected: FAIL, `styles.css` has hex colors.

- [ ] **Step 2: Move the pages, one commit each**

For each page, apply the mapping, run `pnpm vitest run apps/web`, and commit (`refactor(web): <page> on Malphas`). Then delete `styles.css` and its import. The test allows exactly one raw color, `backdrop:bg-black/50`, the Malphas modal overlay.

- [ ] **Step 3: Verify in the browser, light and dark**

Run `pnpm fake:nacional`, `pnpm dev:server` (with `NACIONAL_FAKE_URL` in a test `.env.local`), and `pnpm dev:web`; open each page with Playwright at 1280 and 390 px wide, in light and in dark (`document.documentElement.dataset.theme = 'dark'`). Expected: readable text, no horizontal page scroll, the environment badge visible. Take one screenshot per page into `.playwright-mcp/` (gitignored) and delete them after the check.

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:web` → PASS.

---

### Task 7: The issue screen ("Emitir parecida")

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/router.ts`, `apps/web/src/App.tsx`, `apps/web/src/format.ts`
- Create: `apps/web/src/pages/IssuePage.tsx`, `apps/web/src/pages/IssuePage.test.tsx`

**Interfaces:**
- Consumes: `GET /invoices/:id/draft`, `GET /exchange-rate`, `POST /invoices/issue` with `Idempotency-Key` (Task 1), `GET /customers`.
- Produces:
  - Route `{ name: 'issue'; accountId; invoiceId }` at `#/a/:acc/invoices/:id/issue`.
  - `api.post` gains an optional `headers` argument: `post<T>(path, body, headers?: Record<string, string>)`.
  - Types `Draft`, `ExchangeRate`, `IssueResult`, `Customer` in `api.ts`, matching the server answers.
  - `format.ts`: `previousMonthEnd(today: string): string` (YYYY-MM-DD) and `brasiliaToday(now?: Date): string`; `parseCents(text: string): number | null` ("1.234,56" and "1234.56" give 123456; anything else null).

Screen, in three states:
1. **Form.** Pre-filled from the draft: competence (default `previousMonthEnd(brasiliaToday())`, editable, `max` = today), BRL amount, description (`Textarea`), customer (`Select` with "Mesmo tomador da nota-modelo" first, then the account's customers of the same emitter that have a document). For an export draft: the foreign amount in its currency, and a "Buscar cotação PTAX" button that calls `/exchange-rate?currency=<currencyCode>&date=<competence>` and fills the BRL amount with `Math.round(foreignCents * rateE4 / 10000)`; it shows "PTAX venda de <date>: <rate>" under the field. A PTAX error shows `ERROR_TEXT.ptax_unavailable` and leaves the BRL field as it is (Review Focus 4).
2. **Review.** The `EnvironmentBadge` of the emitter on top; a table of the fields with the template value and the new value, the changed rows highlighted with `bg-warning/10`; the button "Emitir em PRODUÇÃO" (danger) or "Emitir em produção restrita" (primary); "Voltar e editar" (secondary). Opening the review creates `idempotencyKey = crypto.randomUUID()` once; "Voltar e editar" clears it; a retry of the same confirmation reuses it (Review Focus 1). The confirm button is disabled while the request runs.
3. **Result.** `issued` → go to the new invoice's detail. `rejected` → `Alert` error with each Sefin `code: message`, and "Voltar e editar". `unknown` or `pending` → `Alert` warning "A Sefin não confirmou. Não emita de novo; verifique o resultado." with "Verificar agora" (Task 8's reconcile call) and a link to the detail.

- [ ] **Step 1: Write the failing tests**

`IssuePage.test.tsx` (stub `fetch` as in `pages.test.tsx`; stub `crypto.randomUUID` with `vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111')`):

```tsx
const draft = {
  templateInvoiceId: 'inv1',
  emitterId: 'em1',
  competence: '2026-08-31',
  serviceCents: 1086420,
  description: 'Serviços de TI',
  customer: { document: { type: 'NIF', value: '00-0000000' }, name: 'Foreign Customer Inc' },
  foreign: { currency: 'USD', currencyCode: '220', amountCents: 200000 },
};
const emitter = { id: 'em1', cnpj: '12345678000195', companyName: 'EMPRESA TESTE LTDA', environment: 'producao', municipality: '4113700', dpsSeries: '900', certificate: null };

test('the PTAX button fills the BRL amount from the foreign amount', async () => {
  stubApi({
    '/api/accounts/acc/invoices/inv1/draft': draft,
    '/api/accounts/acc/emitters': [emitter],
    '/api/accounts/acc/customers': [],
    '/api/accounts/acc/exchange-rate': { currency: 'USD', date: '2026-08-31', rate: '5.4321', rateE4: 54321, source: 'PTAX venda, fechamento' },
  });
  render(<IssuePage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /cotação ptax/i }));
  expect(await screen.findByDisplayValue('10.864,20')).toBeTruthy();
  expect(screen.getByText(/PTAX venda de 31\/08\/2026: 5,4321/)).toBeTruthy();
});

test('a PTAX failure keeps the BRL amount editable and says so', async () => {
  stubApi({
    '/api/accounts/acc/invoices/inv1/draft': draft,
    '/api/accounts/acc/emitters': [emitter],
    '/api/accounts/acc/customers': [],
  });
  render(<IssuePage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /cotação ptax/i }));
  expect(await screen.findByText(ERROR_TEXT.ptax_unavailable)).toBeTruthy();
  expect((screen.getByLabelText(/valor em reais/i) as HTMLInputElement).disabled).toBe(false);
});

test('the review shows PRODUÇÃO, highlights changes, and sends one key on a retry', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/inv1/draft': draft,
    '/api/accounts/acc/emitters': [emitter],
    '/api/accounts/acc/customers': [],
    '/api/accounts/acc/invoices/issue': { error: 'sefin_unavailable' },
  });
  render(<IssuePage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  const description = await screen.findByLabelText(/descrição/i);
  await user.clear(description);
  await user.type(description, 'Serviços de outubro');
  await user.click(screen.getByRole('button', { name: /revisar/i }));
  expect(screen.getByText('PRODUÇÃO')).toBeTruthy();
  expect(screen.getByRole('row', { name: /descrição/i }).className).toContain('bg-warning/10');
  const confirm = screen.getByRole('button', { name: /emitir em produção/i });
  await user.click(confirm);
  await user.click(await screen.findByRole('button', { name: /emitir em produção/i }));
  const keys = calls
    .filter((c) => c.url.endsWith('/invoices/issue'))
    .map((c) => new Headers(c.init?.headers).get('idempotency-key'));
  expect(keys).toEqual(['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111']);
});
```

Extend the test `stubApi` to answer 422/503 when the body has an `error` field (status from a map in the test: `sefin_unavailable` 502), so `api.post` throws `ApiError`.

`format.test.ts`:

```ts
test('previousMonthEnd and parseCents', () => {
  expect(previousMonthEnd('2026-10-09')).toBe('2026-09-30');
  expect(previousMonthEnd('2026-03-01')).toBe('2026-02-28');
  expect(parseCents('1.234,56')).toBe(123456);
  expect(parseCents('1234.56')).toBe(123456);
  expect(parseCents('12,5')).toBe(1250);
  expect(parseCents('abc')).toBeNull();
});
```

- [ ] **Step 2: Run, fail, implement, run, pass**

Run: `pnpm vitest run apps/web` → FAIL. Implement `IssuePage` with the three states above using only `src/ui` components; the BRL and foreign fields are text inputs that show `formatCents(...).replace('R$', '').trim()` and parse with `parseCents`; an unparseable value disables "Revisar" and shows "Valor inválido". Add the route and the "Emitir parecida" link target. Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): issue similar with PTAX, a review of the changes, and one idempotency key per review"
```

---

### Task 8: Invoice detail actions: issue similar, cancel, verify

**Files:**
- Modify: `apps/web/src/pages/InvoiceDetailPage.tsx`, `apps/web/src/api.ts`
- Create: `apps/web/src/pages/CancelDialog.tsx`, `apps/web/src/pages/InvoiceDetailPage.test.tsx`

**Interfaces:**
- Consumes: `POST /invoices/:id/cancel`, `POST /invoices/:id/reconcile`, `GET /invoices/:id` with `sefinMessages` and `templateOf` (Task 2).
- Produces: `CancelDialog({ open, invoice, environment, onClose, onDone })`; `InvoiceDetail` type gains `sefinMessages` and `templateOf`.

Rules:
- "Emitir parecida" (primary) when the status is `issued` or `cancelled`: link to the issue route.
- "Cancelar nota" (danger) when `issued`: opens `CancelDialog`. The dialog shows the `EnvironmentBadge`, the number, the customer, and the amount; a `Select` with the reasons (1 Erro na emissão, 2 Serviço não prestado, 9 Outros); a `Textarea` for the justification with a counter "<n>/255" and the confirm button disabled until 15 to 255 characters after trimming; the confirm text is "Cancelar em PRODUÇÃO" or "Cancelar em produção restrita" (Review Focus 3). Success reloads the detail; `alreadyCancelled` shows the info alert "A nota já estava cancelada na Sefin."; `sefin_rejected` shows the server's `message` (extend `ApiError` with an optional `detail` object read from the body, so the Sefin `code` and `message` reach the dialog).
- "Verificar na Sefin" (secondary) when `unknown` or `pending`: calls reconcile and reloads; shows the resulting status.
- `rejected` or `unknown`: an `Alert` lists `sefinMessages`.

- [ ] **Step 1: Write the failing tests** in `InvoiceDetailPage.test.tsx` (same `fetch` stub and the `showModal` polyfill of `ui.test.tsx`; move the polyfill to `apps/web/src/test/dialog.ts` and import it in both):

```tsx
test('cancel in production names the environment and needs a 15-character justification', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/inv1/cancel': { id: 'inv1', status: 'cancelled' },
    '/api/accounts/acc/invoices/inv1': { ...issuedInvoice, environment: 'producao' },
  });
  render(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancelar nota' }));
  const dialog = screen.getByRole('dialog', { name: /cancelar/i });
  const confirm = within(dialog).getByRole('button', { name: 'Cancelar em PRODUÇÃO' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await user.type(within(dialog).getByLabelText(/justificativa/i), 'Valor do serviço incorreto');
  expect((confirm as HTMLButtonElement).disabled).toBe(false);
  await user.click(confirm);
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(true));
  expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/cancel'))?.init?.body))).toEqual({
    reason: '1',
    justification: 'Valor do serviço incorreto',
  });
});

test('an unknown invoice offers Verificar na Sefin and lists the Sefin messages', async () => {
  const calls = stubApi({
    '/api/accounts/acc/invoices/inv1/reconcile': { id: 'inv1', status: 'issued' },
    '/api/accounts/acc/invoices/inv1': {
      ...issuedInvoice,
      status: 'unknown',
      sefinMessages: [{ code: 'uncertain', message: 'timeout' }],
    },
  });
  render(<InvoiceDetailPage accountId="acc" invoiceId="inv1" />);
  const user = userEvent.setup();
  expect(await screen.findByText(/timeout/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Verificar na Sefin' }));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/reconcile'))).toBe(true));
});
```

with `issuedInvoice` a synthetic detail (`status: 'issued'`, `events: []`, `sefinMessages: null`, `templateOf: null`, amounts `670321`).

- [ ] **Step 2: Run, fail, implement, run, pass**

Run: `pnpm vitest run apps/web` → FAIL. Implement. Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): cancel dialog, verify at the Sefin, and issue similar from the invoice detail"
```

---

### Task 9: Customers screens

**Files:**
- Create: `apps/web/src/pages/CustomersPage.tsx`, `apps/web/src/pages/CustomerPage.tsx`, `apps/web/src/pages/customers.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/api.ts`

**Interfaces:**
- Consumes: `GET /customers?q=`, `GET /customers/:id`, `PUT /customers/:id` (Stage 1b-1).
- Produces: the `customers` and `customer` routes render these pages.

`CustomersPage`: a search `Input` ("Nome ou documento"), a `Table` (Nome, Documento, E-mail, Origem as a `Badge`: "manual" or "importado"), each name a `Link` to the customer. `CustomerPage`: a form with name, e-mail, phone, municipal registration, and the address (a `Select` "Brasil" or "Exterior" that switches between municipality code and CEP, or country, postal code, city, and region; street, number, complement, district always). Saving sends only the changed fields and shows "Dados salvos. O sync não sobrescreve campos editados à mão."

- [ ] **Step 1: Write the failing tests**

```tsx
test('the customer list links each customer', async () => {
  stubApi({ '/api/accounts/acc/customers': [customer] });
  render(<CustomersPage accountId="acc" />);
  expect((await screen.findByRole('link', { name: 'Cliente Exemplo Ltda' })).getAttribute('href')).toBe('#/a/acc/customers/c1');
});

test('saving sends only the changed fields', async () => {
  const calls = stubApi({ '/api/accounts/acc/customers/c1': customer });
  render(<CustomerPage accountId="acc" customerId="c1" />);
  const user = userEvent.setup();
  const email = await screen.findByLabelText('E-mail');
  await user.clear(email);
  await user.type(email, 'contas@example.com');
  await user.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true));
  expect(JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body))).toEqual({ email: 'contas@example.com' });
});
```

with `customer = { id: 'c1', emitterId: 'em1', documentType: 'CNPJ', document: '98765432000110', name: 'Cliente Exemplo Ltda', email: 'financeiro@example.com', phone: null, municipalRegistration: null, address: null, origin: 'imported', archived: false }`.

- [ ] **Step 2: Run, fail, implement, run, pass**

Run: `pnpm vitest run apps/web` → FAIL. Implement. Run: `pnpm vitest run apps/web && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): customers list and edit by hand"
```

---

### Task 10: Docs and the Stage 1b acceptance in produção restrita

**Files:**
- Create: `docs/ENGINEERING/ARCHITECTURE/WEB_UI.md`
- Modify: `apps/web/AGENTS.md`, `docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md`, `docs/ENGINEERING/ARCHITECTURE/INVOICE_LIFECYCLE.md`, `apps/server/src/issue/IssueService.ts` (only if the real "already cancelled" code differs)

- [ ] **Step 1: Run the whole suite**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:web && pytest services/signer-py`
Expected: PASS.

- [ ] **Step 2: Write the docs**

`WEB_UI.md`: Malphas as the design system, where the copies live and how to refresh them (`SOURCE.md`, `pnpm malphas:check`), the rule "classes come from `src/ui`, colors only from tokens", dark mode (OS or `data-theme`), and the screen map (routes). `apps/web/AGENTS.md`: add "Use `src/ui` components; never a raw color" to the Key Rules and link `WEB_UI.md`. `INVOICE_LIFECYCLE.md`: the `Idempotency-Key` and the already-cancelled rule.

- [ ] **Step 3: The acceptance in produção restrita (Lincoln's machine, real certificate)**

Rule: every invoice issued here is cancelled before the step ends.

1. `apps/server/.env.local` without `NACIONAL_FAKE_URL`; the emitter in `producao_restrita` (the environment switch on the emitters screen). `pnpm build:web && pnpm dev:server`.
2. On a produção restrita invoice of the emitter (a Stage 0 spike invoice serves as template), "Emitir parecida": change the amount and the description, fetch the PTAX for an export template, review, issue. Expected: status `issued`, the new invoice in the list after a sync.
3. Double-click "Emitir em produção restrita" on a second issue. Expected: one new invoice (the list total grows by one).
4. Cancel each invoice issued in steps 2 and 3 with reason 9 and a justification. Expected: `cancelled`, with the 101101 event after a sync.
5. Cancel one of them again. Record the Sefin code of the refusal. If it is not `E0840`, add it to `ALREADY_CANCELLED_CODES` with a test that uses it (fake reply), and check the second cancel ends "já estava cancelada".
6. Record in the RFC, under "Stage 1b acceptance", the date, the counts (issued N, cancelled N), and the code from step 5. Keep the list of issued and cancelled invoice numbers (numbers only, no amount or customer) in the PR description, not in the repo.

- [ ] **Step 4: Commit**

```bash
git add docs apps/web/AGENTS.md apps/server
git commit -m "docs: web UI on Malphas and the Stage 1b acceptance"
```
