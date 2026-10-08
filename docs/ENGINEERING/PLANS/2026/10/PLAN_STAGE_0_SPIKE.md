# Stage 0 (Scaffold and Signer Spike) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the NotaFlow repository foundation and prove, against the national test environment, that we can sign, issue, query, and cancel an NFS-e.

**Architecture:** pnpm monorepo in TypeScript. `core` holds the `Signer` port and types. `signer-node` implements it with `xml-crypto`. `provider-nacional` builds DPS and cancellation XML (validated against the official XSD) and talks to Sefin and ADN over mTLS. A small Python signer (`signxml`) exists for the comparison. A spike script runs the real calls with Lincoln's certificate and records the evidence in the RFC.

**Tech Stack:** Node 22 or later, pnpm 10, TypeScript 5, Vitest 3, ESLint 9, `xml-crypto` 6, `node-forge` 1, `undici` 7, `@xmldom/xmldom` 0.9, `xpath` 0.0.34. Python 3.12, `signxml` 4, `lxml` 5, `cryptography` 44, `pytest` 8.

**Spec:** [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md)

## Global Constraints

- Never use TypeScript non-null assertions (`value!`). ESLint enforces it.
- A credential never enters git: no `.pfx`, `.p12`, `.pem`, `.env*` (except `.env.example`), and no real invoice XML.
- Tests use generated self-signed certificates and synthetic data with CNPJ `12345678000195`.
- Amounts are integer cents in code. Only the XML builder converts to decimal strings.
- The CNPJ is a string of 14 characters `[0-9A-Z]`, because the XSD of 2026-07-27 allows letters.
- Package scripts must be cross-platform. No `VAR=value cmd` prefixes, because Lincoln develops on Windows.
- Docs are in English, follow the writing standard, and contain no em dash character.
- Comments are a budget: one line by default, only the non-obvious why.
- Commits carry no AI attribution trailer.
- The Python interpreter is read from the `PYTHON` env var, with `python` as the default.

## Review Focus

1. A real e-CNPJ `.pfx` often uses legacy encryption (3DES or RC2). Node's OpenSSL 3 refuses RC2. Expected: the certificate loads through `node-forge`, and mTLS uses PEM key and certificate, never the raw `.pfx`. Pinned in Task 4 (3DES fixture) and Task 8 (agent built from PEM).
2. A wrong password. Expected: a typed `CertificateError` with code `WRONG_PASSWORD`, not a stack trace. Pinned in Task 4.
3. An expired certificate. Expected: `CertificateError` with code `EXPIRED`. Pinned in Task 4.
4. A service description with accents and symbols (`Consultoria em análise & ção <teste>`). Expected: the XML stays valid, the signature verifies, and the text round-trips. Pinned in Task 5 and Task 6.
5. The ADN returns HTTP 404 with `NENHUM_DOCUMENTO_LOCALIZADO` at the end of the queue. Expected: an empty batch, not an exception. Pinned in Task 8.

---

## File Structure

```
notaflow/
  package.json                      workspace root scripts
  pnpm-workspace.yaml
  tsconfig.base.json
  eslint.config.js
  .prettierrc.json
  .gitignore
  .env.example
  .gitleaks.toml
  .githooks/pre-commit              gitleaks on staged files
  .github/workflows/ci.yml
  .github/dependabot.yml
  LICENSE                           BSL 1.1
  README.md
  AGENTS.md
  docs/...                          see Task 2
  packages/core/src/
    index.ts
    ports/Signer.ts                 Signer port and certificate types
  packages/test-kit/src/
    index.ts
    makeTestCertificate.ts          self-signed ICP-like certificate for tests
  packages/signer-node/src/
    index.ts
    loadCertificate.ts              .pfx to CertificateMaterial
    CertificateError.ts
    NodeSigner.ts                   Signer implementation
    verifyXmlSignature.ts           independent verification for tests and spike
  packages/provider-nacional/
    schemas/                        official XSD files (vendored)
    src/
      index.ts
      xml/escapeXml.ts
      xml/formatters.ts             cents, Brasília date-time
      dps/types.ts                  DpsInput
      dps/buildDpsId.ts
      dps/buildDpsXml.ts
      events/buildCancelEventXml.ts
      http/gzipBase64.ts
      http/createMtlsDispatcher.ts
      http/endpoints.ts
      http/NacionalClient.ts        Sefin and ADN calls
    test/xsd.ts                     helper that runs tools/xsd/validate.py
  services/signer-py/
    pyproject.toml
    notaflow_signer/sign.py
    notaflow_signer/cli.py          stdin JSON: sign | verify
    tests/test_sign.py
  tools/xsd/validate.py
  tools/xsd/requirements.txt
  spikes/2026-10-sefin/
    run.ts                          real calls against produção restrita
    README.md
```

---

### Task 1: Repository tooling, license, and secret guard

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`, `.env.example`, `.gitleaks.toml`, `.githooks/pre-commit`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `LICENSE`, `README.md`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Produces: root scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`. Every later package copies the `package.json` and `tsconfig.json` shape of `packages/core`.

- [ ] **Step 1: Root workspace files**

`package.json`:

```json
{
  "name": "notaflow",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.18.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "pnpm -r --parallel typecheck",
    "test": "vitest run",
    "format": "prettier --write .",
    "prepare": "git config core.hooksPath .githooks"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "prettier": "^3.4.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.18.0",
    "vitest": "^3.0.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - apps/*
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'services/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

`.prettierrc.json`:

```json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 2: Secret guard files**

`.gitignore`:

```
node_modules/
dist/
coverage/
data/
*.pfx
*.p12
*.pem
*.key
.env*
!.env.example
spikes/**/results.local.*
__pycache__/
.venv/
.pytest_cache/
```

`.env.example`:

```
# Copy to .env.local for the Stage 0 spike. Never commit the real file.
NOTAFLOW_PFX_PATH=C:/path/outside/the/repo/certificate.pfx
NOTAFLOW_PFX_PASSWORD=
NOTAFLOW_EMITTER_MUNICIPALITY=0000000
NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION=
NOTAFLOW_SIMPLES_NACIONAL=1
NOTAFLOW_SPECIAL_REGIME=0
NOTAFLOW_DPS_SERIES=900
NOTAFLOW_CUSTOMER_CNPJ=
NOTAFLOW_CUSTOMER_NAME=
NOTAFLOW_SERVICE_NATIONAL_CODE=010101
NOTAFLOW_SERVICE_NBS=
PYTHON=python
```

`.gitleaks.toml`:

```toml
[extend]
useDefault = true

[[rules]]
id = "pkcs12-file-base64"
description = "Base64 PKCS#12 blob"
regex = '''MII[A-Za-z0-9+/]{200,}'''
```

`.githooks/pre-commit`:

```sh
#!/bin/sh
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --staged --redact --no-banner || exit 1
else
  echo "gitleaks not installed: install it, the commit is blocked" >&2
  exit 1
fi
```

- [ ] **Step 3: CI and Dependabot**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

Task 6 adds the Python setup for XSD validation. Task 9 adds the Python signer tests.

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: pip
    directory: /services/signer-py
    schedule: { interval: weekly }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

- [ ] **Step 4: License**

Download the official BSL 1.1 text from `https://mariadb.com/bsl11/` and fill the parameters block at the top:

```
Licensor:             Vapulab
Licensed Work:        NotaFlow. The Licensed Work is (c) 2026 Vapulab.
Additional Use Grant: None
Change Date:          Four years from the date the Licensed Work is published.
Change License:       Apache License, Version 2.0
```

- [ ] **Step 5: `packages/core` skeleton with one smoke test**

`packages/core/package.json`:

```json
{
  "name": "@notaflow/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" }
}
```

`packages/core/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/core/src/index.ts`:

```ts
export const CORE_VERSION = '0.0.0';
```

`packages/core/src/index.test.ts`:

```ts
import { expect, test } from 'vitest';
import { CORE_VERSION } from './index';

test('core loads', () => {
  expect(CORE_VERSION).toBe('0.0.0');
});
```

`README.md`: two paragraphs. What NotaFlow is (copy the RFC Overview first paragraph), and a link to `AGENTS.md` and the RFC.

- [ ] **Step 6: Install and run all checks**

Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test`
Expected: install succeeds, lint passes, typecheck passes, 1 test passes.

- [ ] **Step 7: Prove the secret guard blocks a certificate**

Create `tmp-test.pfx` and `.env.local` with any content, then run: `git status --porcelain tmp-test.pfx .env.local`
Expected: no output, because both files are ignored. Delete both files.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: add workspace tooling, BSL license, CI, and secret guard"
```

---

### Task 2: Documentation skeleton and RFC update

**Files:**
- Create: `AGENTS.md`, `docs/README.md`
- Create: `docs/ENGINEERING/CONVENTIONS/DOCUMENTATION_STANDARD.md`, `WRITING_STYLE.md`, `CODE_COMMENTS.md`, `SECRETS.md`
- Create: `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md`
- Create: `docs/TEMPLATES/RFC.md`, `docs/TEMPLATES/PLAN.md`, `docs/TEMPLATES/TUTORIAL.md`
- Create: `packages/core/AGENTS.md`
- Modify: `docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md`

**Interfaces:**
- Produces: the doc layout every later task links into.

- [ ] **Step 1: Root `AGENTS.md`**

Under 80 lines. Sections, in this order:

1. One paragraph: what NotaFlow is, link to the RFC.
2. **Project-wide rules** (numbered):
   1. Never use non-null assertions.
   2. A credential never enters git. Tests use `@notaflow/test-kit` certificates and synthetic data. Never pass `--no-verify`.
   3. Amounts are integer cents. CNPJ is a 14-character string `[0-9A-Z]`.
   4. Every database query goes through a repository that requires the account context (from Stage 1a).
   5. Comments are a budget: one line, only the non-obvious why. See `CODE_COMMENTS.md`.
   6. Every English text follows `WRITING_STYLE.md`: inverted pyramid, Simplified Technical English, no em dash.
   7. Commits and PRs carry no AI attribution.
3. **Package entrypoints** table: `packages/core`, `packages/test-kit`, `packages/signer-node`, `packages/provider-nacional`, `services/signer-py`, each linking to its `AGENTS.md`.
4. **Docs** table: categories under `docs/`, linking to `docs/README.md`.
5. **Commands** table: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pytest services/signer-py`, `pnpm spike:sefin`.

- [ ] **Step 2: Conventions, adapted from the CoGrader monorepo**

Source files (read-only, on Lincoln's machine): `X:/Projetos/CoGrader/cograder-monorepo/docs/ENGINEERING/CONVENTIONS/`.

- `DOCUMENTATION_STANDARD.md`: copy rules 1 to 10. Replace every CoGrader package name with the NotaFlow layout. Delete the folder-rename map and every reference to Firestore, cortex, or the CoGrader packages.
- `WRITING_STYLE.md`: copy as is, then add a section "Project directives": no em dash; banned words "delve", "testament", "beacon", "revolutionize", "in today's fast-paced world", "not only... but also", "it's important to remember"; no rhetorical question openers; no two-part dramatic headings.
- `CODE_COMMENTS.md`: copy as is. Replace the examples that name CoGrader code with neutral ones.
- `SECRETS.md`: new, short. What is a secret here (`.pfx`, password, `NFSE_MASTER_KEY`, `TUNNEL_TOKEN`, `CF_ACCESS_AUD`), where each one lives (VM `.env`, mode 600; local `.env.local`), the gitleaks hook, and the rule "a real invoice XML is a secret too".

- [ ] **Step 3: Templates and docs hub**

Copy `docs/TEMPLATES/RFC.md`, `PLAN.md`, `TUTORIAL.md` from the CoGrader repo. Replace "Firestore documents" in the RFC template with "database tables". `docs/README.md` lists each category under `docs/` with one line and says where dated docs go (`YYYY/MM/`).

- [ ] **Step 4: `ARCHITECTURE/OVERVIEW.md`**

The architecture diagram and the packages table from the RFC, plus one paragraph per port (`InvoiceProvider`, `Signer`, `CertificateStore`). State that `InvoiceProvider` and `CertificateStore` arrive in Stage 1a.

- [ ] **Step 5: Update the RFC with the research facts**

In `RFC_NFSE_EMITTER.md`:
- Flow "onboard an emitter", step 4: the connection test is `GET {adn}/parametrizacao/{cMun}/convenio`. The old Sefin municipal-parameter paths return 501.
- Add to "Planned, not in Stage 1": "Local DANFSe (PDF) renderer in the national layout. The ADN DANFSe API is suspended since 2026-08-03 (NT 008/2026)." Lincoln decides in Stage 1b whether it moves into Stage 1.
- Data model: CNPJ is `[0-9A-Z]{14}` (alphanumeric CNPJ, XSD 2026-07-27).
- Open questions: mark "exact endpoint to query by DPS id" as answered: `GET /dps/{id}`, 404 means no NFS-e. Mark "cancellation reason codes" as answered: 1 Erro na Emissão, 2 Serviço não Prestado, 9 Outros; justification 15 to 255 characters. Keep the DPS-reuse and signer questions open.
- Add a "References" line for the Manual-Sefin, the Manual-ADN, and the XSD bundle URLs:
  - `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf`
  - `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf`
  - `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas-nfse-rtc-v1-01-20260727.zip`

- [ ] **Step 6: Check style**

Run: `grep -rnP '\x{2014}' AGENTS.md docs/`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs packages/core/AGENTS.md
git commit -m "docs: add AGENTS router, conventions, templates, and RFC research facts"
```

---

### Task 3: `Signer` port and test certificate kit

**Files:**
- Create: `packages/core/src/ports/Signer.ts`
- Modify: `packages/core/src/index.ts`
- Delete: `packages/core/src/index.test.ts`
- Create: `packages/test-kit/package.json`, `tsconfig.json`, `AGENTS.md`, `src/index.ts`, `src/makeTestCertificate.ts`, `src/makeTestCertificate.test.ts`

**Interfaces:**
- Produces (`@notaflow/core`):

```ts
export type SignatureProfile = 'rsa-sha1-c14n' | 'rsa-sha256-exc-c14n';
export interface CertificateMaterial {
  privateKeyPem: string;
  certificatePem: string;
  cnpj: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
  fingerprintSha256: string;
}
export interface SignRequest {
  xml: string;
  elementName: string;
  certificate: CertificateMaterial;
  profile: SignatureProfile;
}
export interface Signer {
  sign(request: SignRequest): Promise<string>;
}
```

- Produces (`@notaflow/test-kit`):

```ts
export interface TestCertificateOptions {
  cnpj?: string;
  companyName?: string;
  password?: string;
  notBefore?: Date;
  notAfter?: Date;
}
export interface TestCertificate {
  pfx: Buffer;
  password: string;
  cnpj: string;
  privateKeyPem: string;
  certificatePem: string;
}
export function makeTestCertificate(options?: TestCertificateOptions): TestCertificate;
```

- [ ] **Step 1: Write the port**

`packages/core/src/ports/Signer.ts`:

```ts
export type SignatureProfile = 'rsa-sha1-c14n' | 'rsa-sha256-exc-c14n';

export interface CertificateMaterial {
  privateKeyPem: string;
  certificatePem: string;
  cnpj: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
  fingerprintSha256: string;
}

export interface SignRequest {
  xml: string;
  // Local name of the element that carries the Id; the Signature goes right after it.
  elementName: string;
  certificate: CertificateMaterial;
  profile: SignatureProfile;
}

export interface Signer {
  sign(request: SignRequest): Promise<string>;
}
```

`packages/core/src/index.ts`:

```ts
export type {
  CertificateMaterial,
  SignatureProfile,
  SignRequest,
  Signer,
} from './ports/Signer';
```

Delete `packages/core/src/index.test.ts`.

- [ ] **Step 2: Write the failing test for the certificate kit**

`packages/test-kit/package.json`:

```json
{
  "name": "@notaflow/test-kit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "node-forge": "^1.3.1" },
  "devDependencies": { "@types/node-forge": "^1.3.11" }
}
```

`packages/test-kit/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/test-kit/src/makeTestCertificate.test.ts`:

```ts
import forge from 'node-forge';
import { expect, test } from 'vitest';
import { makeTestCertificate } from './makeTestCertificate';

test('creates a 3DES PKCS#12 that opens with the password and carries the CNPJ in the CN', () => {
  const cert = makeTestCertificate({ cnpj: 'AB345678000195' });
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(cert.pfx.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, cert.password);
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const cn = bags[0]?.cert?.subject.getField('CN')?.value;
  expect(cn).toBe('EMPRESA TESTE LTDA:AB345678000195');
});

test('respects custom validity dates', () => {
  const notAfter = new Date('2020-01-01T00:00:00Z');
  const cert = makeTestCertificate({ notBefore: new Date('2019-01-01T00:00:00Z'), notAfter });
  expect(forge.pki.certificateFromPem(cert.certificatePem).validity.notAfter).toEqual(notAfter);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm install && pnpm vitest run packages/test-kit`
Expected: FAIL, "Cannot find module './makeTestCertificate'".

- [ ] **Step 4: Implement**

`packages/test-kit/src/makeTestCertificate.ts`:

```ts
import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

export interface TestCertificateOptions {
  cnpj?: string;
  companyName?: string;
  password?: string;
  notBefore?: Date;
  notAfter?: Date;
}

export interface TestCertificate {
  pfx: Buffer;
  password: string;
  cnpj: string;
  privateKeyPem: string;
  certificatePem: string;
}

const DAY_MS = 86_400_000;

export function makeTestCertificate(options: TestCertificateOptions = {}): TestCertificate {
  const cnpj = options.cnpj ?? '12345678000195';
  const companyName = options.companyName ?? 'EMPRESA TESTE LTDA';
  const password = options.password ?? 'test-password';

  // node:crypto is much faster than forge's pure-JS RSA key generation.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(privateKeyPem);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  cert.serialNumber = '01';
  cert.validity.notBefore = options.notBefore ?? new Date(Date.now() - DAY_MS);
  cert.validity.notAfter = options.notAfter ?? new Date(Date.now() + 365 * DAY_MS);
  const attributes = [
    { name: 'commonName', value: `${companyName}:${cnpj}` },
    { name: 'organizationName', value: 'ICP-Brasil' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.setExtensions([
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true },
  ]);
  cert.sign(forgeKey, forge.md.sha256.create());

  // 3DES matches what most e-CNPJ issuers ship.
  const p12 = forge.pkcs12.toPkcs12Asn1(forgeKey, [cert], password, { algorithm: '3des' });
  const pfx = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');

  return { pfx, password, cnpj, privateKeyPem, certificatePem: forge.pki.certificateToPem(cert) };
}
```

`packages/test-kit/src/index.ts`:

```ts
export { makeTestCertificate } from './makeTestCertificate';
export type { TestCertificate, TestCertificateOptions } from './makeTestCertificate';
```

`packages/test-kit/AGENTS.md`: three lines. Test-only package; never import it from runtime code; the CN format `NAME:CNPJ` mirrors the ICP-Brasil e-CNPJ convention.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/test-kit && pnpm typecheck`
Expected: 2 tests PASS, typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add packages/core packages/test-kit pnpm-lock.yaml
git commit -m "feat(core): add Signer port; feat(test-kit): add self-signed e-CNPJ certificate"
```

---

### Task 4: Load a `.pfx` into `CertificateMaterial`

**Files:**
- Create: `packages/signer-node/package.json`, `tsconfig.json`, `AGENTS.md`, `src/index.ts`, `src/CertificateError.ts`, `src/loadCertificate.ts`, `src/loadCertificate.test.ts`

**Interfaces:**
- Consumes: `CertificateMaterial` from `@notaflow/core`; `makeTestCertificate` from `@notaflow/test-kit`.
- Produces:

```ts
export type CertificateErrorCode =
  | 'INVALID_FILE'
  | 'WRONG_PASSWORD'
  | 'NO_PRIVATE_KEY'
  | 'NO_MATCHING_CERTIFICATE'
  | 'CNPJ_NOT_FOUND'
  | 'NOT_YET_VALID'
  | 'EXPIRED';
export class CertificateError extends Error {
  readonly code: CertificateErrorCode;
}
export function loadCertificate(pfx: Buffer, password: string, now?: Date): CertificateMaterial;
```

- [ ] **Step 1: Package files**

`packages/signer-node/package.json`:

```json
{
  "name": "@notaflow/signer-node",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@notaflow/core": "workspace:*",
    "@xmldom/xmldom": "^0.9.6",
    "node-forge": "^1.3.1",
    "xml-crypto": "^6.1.2",
    "xpath": "^0.0.34"
  },
  "devDependencies": {
    "@notaflow/test-kit": "workspace:*",
    "@types/node-forge": "^1.3.11"
  }
}
```

`packages/signer-node/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the failing tests**

`packages/signer-node/src/loadCertificate.test.ts`:

```ts
import { makeTestCertificate } from '@notaflow/test-kit';
import { describe, expect, test } from 'vitest';
import { CertificateError } from './CertificateError';
import { loadCertificate } from './loadCertificate';

describe('loadCertificate', () => {
  test('loads a 3DES .pfx and reads CNPJ, dates, and fingerprint', () => {
    const cert = makeTestCertificate({ cnpj: '12345678000195' });
    const material = loadCertificate(cert.pfx, cert.password);
    expect(material.cnpj).toBe('12345678000195');
    expect(material.subject).toContain('EMPRESA TESTE LTDA:12345678000195');
    expect(material.privateKeyPem).toContain('PRIVATE KEY');
    expect(material.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(material.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('reads an alphanumeric CNPJ', () => {
    const cert = makeTestCertificate({ cnpj: 'AB345678000195' });
    expect(loadCertificate(cert.pfx, cert.password).cnpj).toBe('AB345678000195');
  });

  test('rejects a wrong password with WRONG_PASSWORD', () => {
    const cert = makeTestCertificate();
    try {
      loadCertificate(cert.pfx, 'wrong');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CertificateError);
      expect((error as CertificateError).code).toBe('WRONG_PASSWORD');
    }
  });

  test('rejects a file that is not PKCS#12 with INVALID_FILE', () => {
    try {
      loadCertificate(Buffer.from('not a certificate'), 'x');
      expect.unreachable();
    } catch (error) {
      expect((error as CertificateError).code).toBe('INVALID_FILE');
    }
  });

  test('rejects an expired certificate with EXPIRED', () => {
    const cert = makeTestCertificate({
      notBefore: new Date('2019-01-01T00:00:00Z'),
      notAfter: new Date('2020-01-01T00:00:00Z'),
    });
    try {
      loadCertificate(cert.pfx, cert.password);
      expect.unreachable();
    } catch (error) {
      expect((error as CertificateError).code).toBe('EXPIRED');
    }
  });

  test('rejects a certificate that is not valid yet with NOT_YET_VALID', () => {
    const cert = makeTestCertificate({
      notBefore: new Date('2099-01-01T00:00:00Z'),
      notAfter: new Date('2100-01-01T00:00:00Z'),
    });
    try {
      loadCertificate(cert.pfx, cert.password);
      expect.unreachable();
    } catch (error) {
      expect((error as CertificateError).code).toBe('NOT_YET_VALID');
    }
  });

  test('rejects a CN without a CNPJ with CNPJ_NOT_FOUND', () => {
    const cert = makeTestCertificate({ cnpj: 'short' });
    try {
      loadCertificate(cert.pfx, cert.password);
      expect.unreachable();
    } catch (error) {
      expect((error as CertificateError).code).toBe('CNPJ_NOT_FOUND');
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm install && pnpm vitest run packages/signer-node`
Expected: FAIL, "Cannot find module './CertificateError'".

- [ ] **Step 4: Implement**

`packages/signer-node/src/CertificateError.ts`:

```ts
export type CertificateErrorCode =
  | 'INVALID_FILE'
  | 'WRONG_PASSWORD'
  | 'NO_PRIVATE_KEY'
  | 'NO_MATCHING_CERTIFICATE'
  | 'CNPJ_NOT_FOUND'
  | 'NOT_YET_VALID'
  | 'EXPIRED';

export class CertificateError extends Error {
  constructor(
    readonly code: CertificateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CertificateError';
  }
}
```

`packages/signer-node/src/loadCertificate.ts`:

```ts
import { createHash } from 'node:crypto';
import type { CertificateMaterial } from '@notaflow/core';
import forge from 'node-forge';
import { CertificateError } from './CertificateError';

// ICP-Brasil e-CNPJ certificates put "COMPANY NAME:CNPJ" in the CN.
const CN_CNPJ = /:([0-9A-Z]{14})$/;

export function loadCertificate(pfx: Buffer, password: string, now = new Date()): CertificateMaterial {
  const p12 = openPkcs12(pfx, password);

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keyBags.find((bag) => bag.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new CertificateError('NO_PRIVATE_KEY', 'The certificate file has no private key.');

  // The file can carry the CA chain; pick the certificate that matches the key.
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const cert = certBags
    .map((bag) => bag.cert)
    .find((c) => c && (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n));
  if (!cert) {
    throw new CertificateError('NO_MATCHING_CERTIFICATE', 'No certificate matches the private key.');
  }

  const subject = cert.subject.attributes.map((a) => `${a.shortName ?? a.name}=${String(a.value)}`).join(', ');
  const commonName = String(cert.subject.getField('CN')?.value ?? '');
  const cnpj = CN_CNPJ.exec(commonName)?.[1];
  if (!cnpj) throw new CertificateError('CNPJ_NOT_FOUND', 'The certificate does not carry a CNPJ.');

  const { notBefore, notAfter } = cert.validity;
  if (now < notBefore) throw new CertificateError('NOT_YET_VALID', `The certificate is valid from ${notBefore.toISOString()}.`);
  if (now > notAfter) throw new CertificateError('EXPIRED', `The certificate expired on ${notAfter.toISOString()}.`);

  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');

  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certificatePem: forge.pki.certificateToPem(cert),
    cnpj,
    subject,
    notBefore,
    notAfter,
    fingerprintSha256: createHash('sha256').update(der).digest('hex'),
  };
}

function openPkcs12(pfx: Buffer, password: string): forge.pkcs12.Pkcs12Pfx {
  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
  } catch {
    throw new CertificateError('INVALID_FILE', 'The file is not a valid PKCS#12 (.pfx) certificate.');
  }
  try {
    return forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/MAC could not be verified|Invalid password/i.test(message)) {
      throw new CertificateError('WRONG_PASSWORD', 'The certificate password is wrong.');
    }
    throw new CertificateError('INVALID_FILE', 'The file is not a valid PKCS#12 (.pfx) certificate.');
  }
}
```

`packages/signer-node/src/index.ts`:

```ts
export { CertificateError } from './CertificateError';
export type { CertificateErrorCode } from './CertificateError';
export { loadCertificate } from './loadCertificate';
```

`packages/signer-node/AGENTS.md`: Quick Reference (what it does, entry points `loadCertificate`, `NodeSigner`, `verifyXmlSignature`), and one rule: "Never log or return the PEM strings outside the signer and the mTLS dispatcher."

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/signer-node && pnpm typecheck && pnpm lint`
Expected: 7 tests PASS. If the `CNPJ_NOT_FOUND` test fails because `makeTestCertificate({ cnpj: 'short' })` still matches, check that the regex requires exactly 14 characters after the last colon.

- [ ] **Step 6: Commit**

```bash
git add packages/signer-node pnpm-lock.yaml
git commit -m "feat(signer-node): load e-CNPJ .pfx into CertificateMaterial with typed errors"
```

---

### Task 5: `NodeSigner` and the independent verifier

**Files:**
- Create: `packages/signer-node/src/NodeSigner.ts`, `src/verifyXmlSignature.ts`, `src/NodeSigner.test.ts`
- Modify: `packages/signer-node/src/index.ts`

**Interfaces:**
- Consumes: `Signer`, `SignRequest`, `SignatureProfile` from `@notaflow/core`; `loadCertificate` (Task 4).
- Produces:

```ts
export class NodeSigner implements Signer {
  sign(request: SignRequest): Promise<string>;
}
export function verifyXmlSignature(signedXml: string, certificatePem: string): boolean;
```

- [ ] **Step 1: Write the failing tests**

`packages/signer-node/src/NodeSigner.test.ts`:

```ts
import type { SignatureProfile } from '@notaflow/core';
import { makeTestCertificate } from '@notaflow/test-kit';
import { describe, expect, test } from 'vitest';
import { loadCertificate } from './loadCertificate';
import { NodeSigner } from './NodeSigner';
import { verifyXmlSignature } from './verifyXmlSignature';

const NS = 'http://www.sped.fazenda.gov.br/nfse';
const ID = 'DPS3550308212345678000195000010000000000000001';
const xml = `<DPS xmlns="${NS}" versao="1.01"><infDPS Id="${ID}"><xDescServ>Consultoria em análise &amp; ção &lt;teste&gt;</xDescServ></infDPS></DPS>`;

const testCert = makeTestCertificate();
const certificate = loadCertificate(testCert.pfx, testCert.password);
const signer = new NodeSigner();

describe.each<SignatureProfile>(['rsa-sha1-c14n', 'rsa-sha256-exc-c14n'])('NodeSigner %s', (profile) => {
  test('signs infDPS and the signature verifies', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    expect(verifyXmlSignature(signed, certificate.certificatePem)).toBe(true);
  });

  test('places Signature as the last child of DPS, referencing the Id', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    expect(signed).toMatch(new RegExp(`<Reference URI="#${ID}">`));
    expect(signed).toMatch(/<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature><\/DPS>$/);
    expect(signed).toContain('<X509Certificate>');
  });

  test('keeps accented text intact', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    expect(signed).toContain('análise &amp; ção &lt;teste&gt;');
  });

  test('a tampered document fails verification', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    const tampered = signed.replace('Consultoria', 'Consultorio');
    expect(verifyXmlSignature(tampered, certificate.certificatePem)).toBe(false);
  });
});

test('rejects an element name that is not a plain XML name', async () => {
  await expect(
    signer.sign({ xml, elementName: "infDPS']|//*['", certificate, profile: 'rsa-sha1-c14n' }),
  ).rejects.toThrow('Invalid element name');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/signer-node/src/NodeSigner.test.ts`
Expected: FAIL, "Cannot find module './NodeSigner'".

- [ ] **Step 3: Implement**

`packages/signer-node/src/NodeSigner.ts`:

```ts
import type { SignatureProfile, Signer, SignRequest } from '@notaflow/core';
import { SignedXml } from 'xml-crypto';

const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const PROFILES: Record<SignatureProfile, { signature: string; digest: string; c14n: string }> = {
  'rsa-sha1-c14n': {
    signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
    c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  },
  'rsa-sha256-exc-c14n': {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
    c14n: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  },
};

const XML_NAME = /^[A-Za-z_][\w.-]*$/;

export class NodeSigner implements Signer {
  async sign({ xml, elementName, certificate, profile }: SignRequest): Promise<string> {
    if (!XML_NAME.test(elementName)) throw new Error(`Invalid element name: ${elementName}`);
    const algorithms = PROFILES[profile];
    const target = `//*[local-name(.)='${elementName}']`;

    const signature = new SignedXml({
      privateKey: certificate.privateKeyPem,
      publicCert: certificate.certificatePem,
      signatureAlgorithm: algorithms.signature,
      canonicalizationAlgorithm: algorithms.c14n,
    });
    signature.addReference({
      xpath: target,
      digestAlgorithm: algorithms.digest,
      transforms: [ENVELOPED, algorithms.c14n],
    });
    signature.computeSignature(xml, { location: { reference: target, action: 'after' } });
    return signature.getSignedXml();
  }
}
```

`packages/signer-node/src/verifyXmlSignature.ts`:

```ts
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as xpath from 'xpath';

const SIGNATURE = "//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']";

export function verifyXmlSignature(signedXml: string, certificatePem: string): boolean {
  const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
  const node = xpath.select1(SIGNATURE, doc as unknown as Node);
  if (!node || !xpath.isNodeLike(node)) return false;
  const verifier = new SignedXml({ publicCert: certificatePem });
  verifier.loadSignature(node.toString());
  try {
    return verifier.checkSignature(signedXml);
  } catch {
    return false;
  }
}
```

Add to `packages/signer-node/src/index.ts`:

```ts
export { NodeSigner } from './NodeSigner';
export { verifyXmlSignature } from './verifyXmlSignature';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/signer-node && pnpm typecheck && pnpm lint`
Expected: all tests PASS (7 from Task 4, 9 here). If the "last child" regex fails only because `xml-crypto` writes `<Reference URI="#..."` with extra attributes, loosen the regex to `<Reference URI="#${ID}"`, not the structure check.

- [ ] **Step 5: Commit**

```bash
git add packages/signer-node
git commit -m "feat(signer-node): sign by element Id with SHA1/C14N and SHA256/exc-C14N profiles"
```

---

### Task 6: DPS builder validated against the official XSD

**Files:**
- Create: `packages/provider-nacional/package.json`, `tsconfig.json`, `AGENTS.md`, `schemas/*.xsd` (10 files)
- Create: `src/index.ts`, `src/xml/escapeXml.ts`, `src/xml/formatters.ts`, `src/xml/formatters.test.ts`, `src/dps/types.ts`, `src/dps/buildDpsId.ts`, `src/dps/buildDpsXml.ts`, `src/dps/buildDpsXml.test.ts`, `test/xsd.ts`
- Create: `tools/xsd/validate.py`, `tools/xsd/requirements.txt`
- Modify: `.github/workflows/ci.yml` (add Python setup and `pip install -r tools/xsd/requirements.txt` before `pnpm test`)

**Interfaces:**
- Produces:

```ts
export type Environment = 'producao' | 'producao_restrita';
export interface DpsInput { /* see Step 4 */ }
export function buildDpsId(input: { municipality: string; cnpj: string; series: string; number: number }): string;
export function buildDpsXml(input: DpsInput): { id: string; xml: string };
export function centsToDecimal(cents: number): string;
export function formatBrasiliaDateTime(date: Date): string;
export function escapeXml(text: string): string;
export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
export function validateAgainstXsd(xml: string, schemaFile: string): { valid: boolean; errors: string[] }; // test/xsd.ts
```

- [ ] **Step 1: Vendor the XSD files**

Download `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas-nfse-rtc-v1-01-20260727.zip`. Extract these files into `packages/provider-nacional/schemas/`: `DPS_v1.01.xsd`, `NFSe_v1.01.xsd`, `pedRegEvento_v1.01.xsd`, `evento_v1.01.xsd`, `CNC_v1.00.xsd`, `tiposComplexos_v1.01.xsd`, `tiposSimples_v1.01.xsd`, `tiposEventos_v1.01.xsd`, `tiposCnc_v1.00.xsd`, `xmldsig-core-schema.xsd`. Add `schemas/SOURCE.md` with the URL and the download date.

- [ ] **Step 2: XSD validator**

`tools/xsd/requirements.txt`:

```
lxml>=5.3,<6
```

`tools/xsd/validate.py`:

```python
"""Validate XML from stdin against an XSD. Exit 0 when valid; print one error per line otherwise."""
import sys

from lxml import etree


def main() -> int:
    schema = etree.XMLSchema(etree.parse(sys.argv[1]))
    document = etree.fromstring(sys.stdin.buffer.read())
    if schema.validate(document):
        return 0
    for error in schema.error_log:
        print(f"{error.line}: {error.message}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

`packages/provider-nacional/test/xsd.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../tools/xsd/validate.py', import.meta.url));
const SCHEMAS = fileURLToPath(new URL('../schemas/', import.meta.url));

export function validateAgainstXsd(xml: string, schemaFile: string): { valid: boolean; errors: string[] } {
  const python = process.env.PYTHON ?? 'python';
  const result = spawnSync(python, ['-I', SCRIPT, `${SCHEMAS}${schemaFile}`], { input: xml, encoding: 'utf8' });
  if (result.error) throw result.error;
  const errors = `${result.stdout}${result.stderr}`.split('\n').filter(Boolean);
  return { valid: result.status === 0, errors };
}
```

Run: `pip install -r tools/xsd/requirements.txt`
Expected: lxml installs.

- [ ] **Step 3: Formatter tests first**

`packages/provider-nacional/src/xml/formatters.test.ts`:

```ts
import { expect, test } from 'vitest';
import { centsToDecimal, formatBrasiliaDateTime } from './formatters';

test.each([
  [0, '0.00'],
  [5, '0.05'],
  [150000, '1500.00'],
  [123456789, '1234567.89'],
])('centsToDecimal(%i) = %s', (cents, expected) => {
  expect(centsToDecimal(cents)).toBe(expected);
});

test('centsToDecimal rejects negative and fractional cents', () => {
  expect(() => centsToDecimal(-1)).toThrow(RangeError);
  expect(() => centsToDecimal(1.5)).toThrow(RangeError);
});

test('formatBrasiliaDateTime writes UTC-3 without milliseconds', () => {
  expect(formatBrasiliaDateTime(new Date('2026-10-08T18:30:15.123Z'))).toBe('2026-10-08T15:30:15-03:00');
});
```

Run: `pnpm vitest run packages/provider-nacional`
Expected: FAIL, "Cannot find module './formatters'".

- [ ] **Step 4: Implement formatters, escaping, types, and Id**

`packages/provider-nacional/package.json`:

```json
{
  "name": "@notaflow/provider-nacional",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "@notaflow/core": "workspace:*", "undici": "^7.2.0" },
  "devDependencies": {
    "@notaflow/signer-node": "workspace:*",
    "@notaflow/test-kit": "workspace:*"
  }
}
```

`packages/provider-nacional/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`src/xml/formatters.ts`:

```ts
const BRASILIA_OFFSET_MS = 3 * 3_600_000;

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`Invalid amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// Brazil has had no daylight saving time since 2019, so Brasília is always UTC-3.
export function formatBrasiliaDateTime(date: Date): string {
  return `${new Date(date.getTime() - BRASILIA_OFFSET_MS).toISOString().slice(0, 19)}-03:00`;
}
```

`src/xml/escapeXml.ts`:

```ts
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}
```

`src/dps/types.ts`:

```ts
export type Environment = 'producao' | 'producao_restrita';

export interface Address {
  municipality: string; // IBGE, 7 digits
  zip: string; // 8 digits
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export interface DpsInput {
  environment: Environment;
  issuedAt: Date;
  appVersion: string;
  series: string;
  number: number;
  competence: string; // YYYY-MM-DD
  emitterMunicipality: string;
  provider: {
    cnpj: string;
    municipalRegistration?: string;
    phone?: string;
    email?: string;
    simplesNacional: '1' | '2' | '3';
    simplesRegime?: '1' | '2' | '3';
    specialRegime: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '9';
  };
  customer?: {
    document: { type: 'CNPJ' | 'CPF'; value: string };
    municipalRegistration?: string;
    name: string;
    address?: Address;
    phone?: string;
    email?: string;
  };
  service: {
    municipality: string;
    nationalTaxCode: string; // cTribNac, 6 digits
    municipalTaxCode?: string;
    description: string;
    nbsCode?: string; // 9 digits
  };
  amounts: { serviceCents: number };
  tax: {
    issqnTaxation: '1' | '2' | '3' | '4';
    issRetention: '1' | '2' | '3';
    issRatePercent?: string; // e.g. "2.00"
  };
}
```

`src/dps/buildDpsId.ts`:

```ts
// "DPS" + cMun(7) + tpInsc(2 = CNPJ) + CNPJ(14) + series(5) + number(15) = 45 characters.
export function buildDpsId(input: { municipality: string; cnpj: string; series: string; number: number }): string {
  const id = `DPS${input.municipality}2${input.cnpj}${input.series.padStart(5, '0')}${String(input.number).padStart(15, '0')}`;
  if (!/^DPS[0-9]{7}2[0-9A-Z]{14}[0-9]{20}$/.test(id)) throw new RangeError(`Invalid DPS id: ${id}`);
  return id;
}
```

Run: `pnpm vitest run packages/provider-nacional/src/xml`
Expected: 6 tests PASS.

- [ ] **Step 5: Write the failing DPS tests**

`src/dps/buildDpsXml.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { validateAgainstXsd } from '../../test/xsd';
import { buildDpsId } from './buildDpsId';
import { buildDpsXml } from './buildDpsXml';
import type { DpsInput } from './types';

const base: DpsInput = {
  environment: 'producao_restrita',
  issuedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-0.0.0',
  series: '900',
  number: 1,
  competence: '2026-10-01',
  emitterMunicipality: '3550308',
  provider: { cnpj: '12345678000195', municipalRegistration: '1234567', simplesNacional: '1', specialRegime: '0' },
  customer: {
    document: { type: 'CNPJ', value: '98765432000110' },
    name: 'Cliente Exemplo Ltda',
    email: 'financeiro@example.com',
    address: { municipality: '3550308', zip: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista' },
  },
  service: { municipality: '3550308', nationalTaxCode: '010101', description: 'Consultoria em análise & ção <teste>', nbsCode: '115022000' },
  amounts: { serviceCents: 150000 },
  tax: { issqnTaxation: '1', issRetention: '1' },
};

describe('buildDpsId', () => {
  test('builds the 45-character id', () => {
    const id = buildDpsId({ municipality: '3550308', cnpj: '12345678000195', series: '900', number: 1 });
    expect(id).toBe('DPS355030821234567800019500900000000000000001');
    expect(id).toHaveLength(45);
  });

  test('accepts an alphanumeric CNPJ', () => {
    expect(buildDpsId({ municipality: '3550308', cnpj: 'AB345678000195', series: '1', number: 7 })).toHaveLength(45);
  });
});

describe('buildDpsXml', () => {
  test('produces a DPS that validates against DPS_v1.01.xsd', () => {
    const { xml } = buildDpsXml(base);
    const result = validateAgainstXsd(xml, 'DPS_v1.01.xsd');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test('validates without the optional customer, address, and NBS', () => {
    const { customer: _customer, ...noCustomer } = base;
    const input: DpsInput = { ...noCustomer, service: { municipality: '3550308', nationalTaxCode: '010101', description: 'Serviço' } };
    expect(validateAgainstXsd(buildDpsXml(input).xml, 'DPS_v1.01.xsd').errors).toEqual([]);
  });

  test('writes the fields the Sefin reads first', () => {
    const { id, xml } = buildDpsXml(base);
    expect(id).toBe(buildDpsId({ municipality: '3550308', cnpj: '12345678000195', series: '900', number: 1 }));
    expect(xml).toContain(`<infDPS Id="${id}">`);
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    expect(xml).toContain('<dhEmi>2026-10-08T15:00:00-03:00</dhEmi>');
    expect(xml).toContain('<vServ>1500.00</vServ>');
    expect(xml).toContain('Consultoria em análise &amp; ção &lt;teste&gt;');
  });

  test('uses tpAmb 1 in production', () => {
    expect(buildDpsXml({ ...base, environment: 'producao' }).xml).toContain('<tpAmb>1</tpAmb>');
  });
});
```

Run: `pnpm vitest run packages/provider-nacional/src/dps`
Expected: FAIL, "Cannot find module './buildDpsXml'".

- [ ] **Step 6: Implement `buildDpsXml`**

`src/dps/buildDpsXml.ts`:

```ts
import { escapeXml } from '../xml/escapeXml';
import { centsToDecimal, formatBrasiliaDateTime } from '../xml/formatters';
import { buildDpsId } from './buildDpsId';
import type { Address, DpsInput } from './types';

export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
export const SCHEMA_VERSION = '1.01';

// Element order follows tiposComplexos_v1.01.xsd; the XSD test fails on any reorder.
export function buildDpsXml(input: DpsInput): { id: string; xml: string } {
  const id = buildDpsId({
    municipality: input.emitterMunicipality,
    cnpj: input.provider.cnpj,
    series: input.series,
    number: input.number,
  });

  const xml =
    `<DPS xmlns="${NFSE_NAMESPACE}" versao="${SCHEMA_VERSION}">` +
    `<infDPS Id="${id}">` +
    tag('tpAmb', input.environment === 'producao' ? '1' : '2') +
    tag('dhEmi', formatBrasiliaDateTime(input.issuedAt)) +
    tag('verAplic', input.appVersion) +
    tag('serie', input.series) +
    tag('nDPS', String(input.number)) +
    tag('dCompet', input.competence) +
    tag('tpEmit', '1') +
    tag('cLocEmi', input.emitterMunicipality) +
    provider(input) +
    customer(input) +
    service(input) +
    amounts(input) +
    `</infDPS></DPS>`;

  return { id, xml };
}

function tag(name: string, value: string | undefined): string {
  return value === undefined ? '' : `<${name}>${escapeXml(value)}</${name}>`;
}

function provider({ provider: p }: DpsInput): string {
  return (
    '<prest>' +
    tag('CNPJ', p.cnpj) +
    tag('IM', p.municipalRegistration) +
    tag('fone', p.phone) +
    tag('email', p.email) +
    '<regTrib>' +
    tag('opSimpNac', p.simplesNacional) +
    tag('regApTribSN', p.simplesRegime) +
    tag('regEspTrib', p.specialRegime) +
    '</regTrib></prest>'
  );
}

function customer({ customer: c }: DpsInput): string {
  if (!c) return '';
  return (
    '<toma>' +
    tag(c.document.type, c.document.value) +
    tag('IM', c.municipalRegistration) +
    tag('xNome', c.name) +
    (c.address ? address(c.address) : '') +
    tag('fone', c.phone) +
    tag('email', c.email) +
    '</toma>'
  );
}

function address(a: Address): string {
  return (
    '<end><endNac>' +
    tag('cMun', a.municipality) +
    tag('CEP', a.zip) +
    '</endNac>' +
    tag('xLgr', a.street) +
    tag('nro', a.number) +
    tag('xCpl', a.complement) +
    tag('xBairro', a.district) +
    '</end>'
  );
}

function service({ service: s }: DpsInput): string {
  return (
    '<serv><locPrest>' +
    tag('cLocPrestacao', s.municipality) +
    '</locPrest><cServ>' +
    tag('cTribNac', s.nationalTaxCode) +
    tag('cTribMun', s.municipalTaxCode) +
    tag('xDescServ', s.description) +
    tag('cNBS', s.nbsCode) +
    '</cServ></serv>'
  );
}

function amounts({ amounts: a, tax: t }: DpsInput): string {
  return (
    '<valores><vServPrest>' +
    tag('vServ', centsToDecimal(a.serviceCents)) +
    '</vServPrest><trib><tribMun>' +
    tag('tribISSQN', t.issqnTaxation) +
    tag('tpRetISSQN', t.issRetention) +
    tag('pAliq', t.issRatePercent) +
    '</tribMun><totTrib>' +
    tag('indTotTrib', '0') +
    '</totTrib></trib></valores>'
  );
}
```

Note: `cTribMun` is a 3-digit code (`TCCodTribMun`, pattern `[0-9]{3}`).

`src/index.ts`:

```ts
export { buildDpsId } from './dps/buildDpsId';
export { buildDpsXml, NFSE_NAMESPACE, SCHEMA_VERSION } from './dps/buildDpsXml';
export type { Address, DpsInput, Environment } from './dps/types';
export { escapeXml } from './xml/escapeXml';
export { centsToDecimal, formatBrasiliaDateTime } from './xml/formatters';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck && pnpm lint`
Expected: all PASS. If the XSD test fails, the printed `errors` array names the element and the line. Fix the order or the value, never the test.

- [ ] **Step 8: Signed DPS still validates**

Add to `buildDpsXml.test.ts`:

```ts
import { loadCertificate, NodeSigner } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';

test('a signed DPS validates against the XSD', async () => {
  const testCert = makeTestCertificate();
  const certificate = loadCertificate(testCert.pfx, testCert.password);
  const signed = await new NodeSigner().sign({
    xml: buildDpsXml(base).xml,
    elementName: 'infDPS',
    certificate,
    profile: 'rsa-sha1-c14n',
  });
  expect(validateAgainstXsd(signed, 'DPS_v1.01.xsd').errors).toEqual([]);
});
```

Run: `pnpm vitest run packages/provider-nacional`
Expected: PASS.

- [ ] **Step 9: CI and AGENTS**

In `.github/workflows/ci.yml`, insert before `pnpm install`:

```yaml
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r tools/xsd/requirements.txt
```

`packages/provider-nacional/AGENTS.md`: Quick Reference (DPS builder, cancel event builder, `NacionalClient`), and two rules: "Every XML builder has a test that validates against the vendored XSD." and "Update `schemas/` only from the official gov.br zip, and record the URL and date in `schemas/SOURCE.md`."

- [ ] **Step 10: Commit**

```bash
git add packages/provider-nacional tools/xsd .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat(provider-nacional): build DPS XML validated against the official XSD"
```

---

### Task 7: Cancellation event builder

**Files:**
- Create: `packages/provider-nacional/src/events/buildCancelEventXml.ts`, `src/events/buildCancelEventXml.test.ts`
- Modify: `packages/provider-nacional/src/index.ts`

**Interfaces:**
- Consumes: `escapeXml`, `formatBrasiliaDateTime`, `NFSE_NAMESPACE`, `SCHEMA_VERSION`, `Environment` (Task 6).
- Produces:

```ts
export type CancelReason = '1' | '2' | '9';
export interface CancelEventInput {
  environment: Environment;
  requestedAt: Date;
  appVersion: string;
  authorCnpj: string;
  accessKey: string; // 50 characters, TSChaveNFSe
  reason: CancelReason;
  justification: string; // 15 to 255 characters
}
export function buildCancelEventXml(input: CancelEventInput): { id: string; xml: string };
```

- [ ] **Step 1: Write the failing tests**

`src/events/buildCancelEventXml.test.ts`:

```ts
import { expect, test } from 'vitest';
import { validateAgainstXsd } from '../../test/xsd';
import { buildCancelEventXml, type CancelEventInput } from './buildCancelEventXml';

const accessKey = '35503082212345678000195000000000000126100000000001';

const base: CancelEventInput = {
  environment: 'producao_restrita',
  requestedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-0.0.0',
  authorCnpj: '12345678000195',
  accessKey,
  reason: '1',
  justification: 'Valor informado com erro na emissão',
};

test('builds a pedRegEvento that validates against the XSD', () => {
  const { xml } = buildCancelEventXml(base);
  expect(validateAgainstXsd(xml, 'pedRegEvento_v1.01.xsd').errors).toEqual([]);
});

test('uses the PRE + key + 101101 id', () => {
  const { id, xml } = buildCancelEventXml(base);
  expect(id).toBe(`PRE${accessKey}101101`);
  expect(id).toHaveLength(59);
  expect(xml).toContain('<xDesc>Cancelamento de NFS-e</xDesc>');
});

test.each([
  ['a short justification', { justification: 'curto demais' }],
  ['a long justification', { justification: 'x'.repeat(256) }],
  ['a bad access key', { accessKey: '123' }],
])('rejects %s', (_label, override) => {
  expect(() => buildCancelEventXml({ ...base, ...override })).toThrow(RangeError);
});
```

Run: `pnpm vitest run packages/provider-nacional/src/events`
Expected: FAIL, "Cannot find module './buildCancelEventXml'".

- [ ] **Step 2: Implement**

`src/events/buildCancelEventXml.ts`:

```ts
import { NFSE_NAMESPACE, SCHEMA_VERSION } from '../dps/buildDpsXml';
import type { Environment } from '../dps/types';
import { escapeXml } from '../xml/escapeXml';
import { formatBrasiliaDateTime } from '../xml/formatters';

export type CancelReason = '1' | '2' | '9';

export interface CancelEventInput {
  environment: Environment;
  requestedAt: Date;
  appVersion: string;
  authorCnpj: string;
  accessKey: string;
  reason: CancelReason;
  justification: string;
}

const CANCEL_EVENT_CODE = '101101';

export function buildCancelEventXml(input: CancelEventInput): { id: string; xml: string } {
  // TSChaveNFSe: the 14-character CNPJ part can hold letters since the alphanumeric CNPJ.
  if (!/^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$/.test(input.accessKey)) throw new RangeError('Invalid access key.');
  const justification = input.justification.trim();
  if (justification.length < 15 || justification.length > 255) {
    throw new RangeError('The justification must have 15 to 255 characters.');
  }

  const id = `PRE${input.accessKey}${CANCEL_EVENT_CODE}`;
  const xml =
    `<pedRegEvento xmlns="${NFSE_NAMESPACE}" versao="${SCHEMA_VERSION}">` +
    `<infPedReg Id="${id}">` +
    `<tpAmb>${input.environment === 'producao' ? '1' : '2'}</tpAmb>` +
    `<verAplic>${escapeXml(input.appVersion)}</verAplic>` +
    `<dhEvento>${formatBrasiliaDateTime(input.requestedAt)}</dhEvento>` +
    `<CNPJAutor>${escapeXml(input.authorCnpj)}</CNPJAutor>` +
    `<chNFSe>${input.accessKey}</chNFSe>` +
    `<e${CANCEL_EVENT_CODE}>` +
    `<xDesc>Cancelamento de NFS-e</xDesc>` +
    `<cMotivo>${input.reason}</cMotivo>` +
    `<xMotivo>${escapeXml(justification)}</xMotivo>` +
    `</e${CANCEL_EVENT_CODE}>` +
    `</infPedReg></pedRegEvento>`;

  return { id, xml };
}
```

If the XSD test reports a missing element between `CNPJAutor` and `chNFSe`, read `TCInfPedReg` in `tiposEventos_v1.01.xsd` and add it in order.

Add to `src/index.ts`:

```ts
export { buildCancelEventXml } from './events/buildCancelEventXml';
export type { CancelEventInput, CancelReason } from './events/buildCancelEventXml';
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/provider-nacional
git commit -m "feat(provider-nacional): build the cancellation event request validated against the XSD"
```

---

### Task 8: Sefin and ADN client over mTLS

**Files:**
- Create: `packages/provider-nacional/src/http/gzipBase64.ts`, `src/http/endpoints.ts`, `src/http/createMtlsDispatcher.ts`, `src/http/NacionalClient.ts`, `src/http/NacionalClient.test.ts`
- Modify: `packages/provider-nacional/src/index.ts`

**Interfaces:**
- Consumes: `CertificateMaterial` from `@notaflow/core`; `Environment` (Task 6).
- Produces:

```ts
export function gzipBase64(xml: string): string;
export function gunzipBase64(payload: string): string;
export function createMtlsDispatcher(certificate: CertificateMaterial): Dispatcher;
export interface SefinError { codigo: string; descricao: string; complemento?: string }
export type IssueResult =
  | { kind: 'issued'; accessKey: string; dpsId: string; nfseXml: string; alerts: SefinError[] }
  | { kind: 'rejected'; dpsId: string; errors: SefinError[] }
  | { kind: 'uncertain'; reason: string };
export type DpsLookup = { kind: 'found'; accessKey: string } | { kind: 'not_found' };
export type EventResult = { kind: 'registered'; eventXml: string } | { kind: 'rejected'; error: SefinError };
export interface DfeDocument { nsu: number; accessKey: string; type: string; eventType?: string; xml: string; createdAt: string }
export interface DfeBatch { status: 'DOCUMENTOS_LOCALIZADOS' | 'NENHUM_DOCUMENTO_LOCALIZADO' | 'REJEICAO'; documents: DfeDocument[]; errors: unknown[] }
export class NacionalClient {
  constructor(options: { environment: Environment; dispatcher: Dispatcher; timeoutMs?: number });
  issue(signedDpsXml: string): Promise<IssueResult>;
  findByDpsId(dpsId: string): Promise<DpsLookup>;
  getNfse(accessKey: string): Promise<string>; // NFS-e XML
  registerEvent(accessKey: string, signedEventXml: string): Promise<EventResult>;
  fetchDfe(nsu: number, cnpj: string): Promise<DfeBatch>;
  checkConvenio(municipality: string): Promise<unknown>;
}
```

- [ ] **Step 1: Write the failing tests**

`src/http/NacionalClient.test.ts`:

```ts
import { MockAgent } from 'undici';
import { beforeEach, describe, expect, test } from 'vitest';
import { gunzipBase64, gzipBase64 } from './gzipBase64';
import { NacionalClient } from './NacionalClient';

const SEFIN = 'https://sefin.producaorestrita.nfse.gov.br';
const ADN = 'https://adn.producaorestrita.nfse.gov.br';
const KEY = '3'.repeat(50);
const DPS_ID = 'DPS355030821234567800019500900000000000000001';

let agent: MockAgent;
let client: NacionalClient;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  client = new NacionalClient({ environment: 'producao_restrita', dispatcher: agent, timeoutMs: 200 });
});

test('gzipBase64 round-trips accented XML', () => {
  const xml = '<a>ção &amp; análise</a>';
  expect(gunzipBase64(gzipBase64(xml))).toBe(xml);
});

describe('issue', () => {
  test('201 returns issued with the decompressed NFS-e', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(201, {
      idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64('<NFSe/>'), alertas: [],
    });
    expect(await client.issue('<DPS/>')).toEqual({ kind: 'issued', accessKey: KEY, dpsId: DPS_ID, nfseXml: '<NFSe/>', alerts: [] });
  });

  test('sends the DPS as gzip + base64 in dpsXmlGZipB64', async () => {
    let body = '';
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST', body: (b) => ((body = b), true) })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64('<NFSe/>') });
    await client.issue('<DPS>ç</DPS>');
    expect(gunzipBase64(JSON.parse(body).dpsXmlGZipB64)).toBe('<DPS>ç</DPS>');
  });

  test('400 returns rejected with the Sefin errors', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(400, {
      idDPS: DPS_ID, erros: [{ codigo: 'E0014', descricao: 'DPS duplicada' }],
    });
    expect(await client.issue('<DPS/>')).toEqual({ kind: 'rejected', dpsId: DPS_ID, errors: [{ codigo: 'E0014', descricao: 'DPS duplicada' }] });
  });

  test('500 returns uncertain', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(500, 'boom');
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });

  test('a timeout returns uncertain', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(201, {}).delay(1000);
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });
});

describe('findByDpsId', () => {
  test('200 returns found', async () => {
    agent.get(SEFIN).intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' }).reply(200, { idDps: DPS_ID, chaveAcesso: KEY });
    expect(await client.findByDpsId(DPS_ID)).toEqual({ kind: 'found', accessKey: KEY });
  });

  test('404 returns not_found', async () => {
    agent.get(SEFIN).intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' }).reply(404, {});
    expect(await client.findByDpsId(DPS_ID)).toEqual({ kind: 'not_found' });
  });
});

describe('registerEvent', () => {
  test('201 returns registered', async () => {
    agent.get(SEFIN).intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(201, { eventoXmlGZipB64: gzipBase64('<evento/>') });
    expect(await client.registerEvent(KEY, '<pedRegEvento/>')).toEqual({ kind: 'registered', eventXml: '<evento/>' });
  });

  test('400 returns rejected with the single erro object', async () => {
    agent.get(SEFIN).intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(400, { erro: { codigo: 'E1234', descricao: 'Prazo expirado' } });
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({ kind: 'rejected', error: { codigo: 'E1234', descricao: 'Prazo expirado' } });
  });
});

describe('fetchDfe', () => {
  test('decodes each document', async () => {
    agent.get(ADN).intercept({ path: '/contribuintes/DFe/0?cnpjConsulta=12345678000195&lote=true', method: 'GET' }).reply(200, {
      StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
      LoteDFe: [{ NSU: 1, ChaveAcesso: KEY, TipoDocumento: 'NFSE', ArquivoXml: gzipBase64('<NFSe/>'), DataHoraGeracao: '2026-10-08T10:00:00' }],
      Erros: [],
    });
    const batch = await client.fetchDfe(0, '12345678000195');
    expect(batch.status).toBe('DOCUMENTOS_LOCALIZADOS');
    expect(batch.documents).toEqual([{ nsu: 1, accessKey: KEY, type: 'NFSE', xml: '<NFSe/>', createdAt: '2026-10-08T10:00:00' }]);
  });

  test('404 with NENHUM_DOCUMENTO_LOCALIZADO is an empty batch, not an error', async () => {
    agent.get(ADN).intercept({ path: '/contribuintes/DFe/42?cnpjConsulta=12345678000195&lote=true', method: 'GET' })
      .reply(404, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] });
    expect(await client.fetchDfe(42, '12345678000195')).toEqual({ status: 'NENHUM_DOCUMENTO_LOCALIZADO', documents: [], errors: [] });
  });

  test('429 throws a retryable error', async () => {
    agent.get(ADN).intercept({ path: '/contribuintes/DFe/0?cnpjConsulta=12345678000195&lote=true', method: 'GET' }).reply(429, {});
    await expect(client.fetchDfe(0, '12345678000195')).rejects.toMatchObject({ retryable: true });
  });
});
```

Run: `pnpm vitest run packages/provider-nacional/src/http`
Expected: FAIL, "Cannot find module './gzipBase64'".

- [ ] **Step 2: Implement helpers and endpoints**

`src/http/gzipBase64.ts`:

```ts
import { gunzipSync, gzipSync } from 'node:zlib';

export function gzipBase64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

export function gunzipBase64(payload: string): string {
  return gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
}
```

`src/http/endpoints.ts`:

```ts
import type { Environment } from '../dps/types';

export const ENDPOINTS: Record<Environment, { sefin: string; adn: string }> = {
  producao: { sefin: 'https://sefin.nfse.gov.br/SefinNacional', adn: 'https://adn.nfse.gov.br' },
  producao_restrita: {
    sefin: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
    adn: 'https://adn.producaorestrita.nfse.gov.br',
  },
};
```

`src/http/createMtlsDispatcher.ts`:

```ts
import type { CertificateMaterial } from '@notaflow/core';
import { Agent, type Dispatcher } from 'undici';

// PEM instead of the raw .pfx: OpenSSL 3 refuses the legacy RC2 encryption many e-CNPJ files use.
export function createMtlsDispatcher(certificate: CertificateMaterial): Dispatcher {
  return new Agent({
    connect: { key: certificate.privateKeyPem, cert: certificate.certificatePem, minVersion: 'TLSv1.2' },
  });
}
```

- [ ] **Step 3: Implement the client**

`src/http/NacionalClient.ts`:

```ts
import { type Dispatcher, request } from 'undici';
import type { Environment } from '../dps/types';
import { ENDPOINTS } from './endpoints';
import { gunzipBase64, gzipBase64 } from './gzipBase64';

export interface SefinError {
  codigo: string;
  descricao: string;
  complemento?: string;
}

export type IssueResult =
  | { kind: 'issued'; accessKey: string; dpsId: string; nfseXml: string; alerts: SefinError[] }
  | { kind: 'rejected'; dpsId: string; errors: SefinError[] }
  | { kind: 'uncertain'; reason: string };

export type DpsLookup = { kind: 'found'; accessKey: string } | { kind: 'not_found' };

export type EventResult = { kind: 'registered'; eventXml: string } | { kind: 'rejected'; error: SefinError };

export interface DfeDocument {
  nsu: number;
  accessKey: string;
  type: string;
  eventType?: string;
  xml: string;
  createdAt: string;
}

export interface DfeBatch {
  status: 'DOCUMENTOS_LOCALIZADOS' | 'NENHUM_DOCUMENTO_LOCALIZADO' | 'REJEICAO';
  documents: DfeDocument[];
  errors: unknown[];
}

export class NacionalHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly body: unknown,
  ) {
    super(`Unexpected HTTP ${status} from the national NFS-e API`);
    this.name = 'NacionalHttpError';
  }
}

interface RawDfeItem {
  NSU: number;
  ChaveAcesso: string;
  TipoDocumento: string;
  TipoEvento?: string;
  ArquivoXml: string;
  DataHoraGeracao: string;
}

export class NacionalClient {
  private readonly urls: { sefin: string; adn: string };
  private readonly dispatcher: Dispatcher;
  private readonly timeoutMs: number;

  constructor(options: { environment: Environment; dispatcher: Dispatcher; timeoutMs?: number }) {
    this.urls = ENDPOINTS[options.environment];
    this.dispatcher = options.dispatcher;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async issue(signedDpsXml: string): Promise<IssueResult> {
    let response: { status: number; body: unknown };
    try {
      response = await this.call('POST', `${this.urls.sefin}/nfse`, { dpsXmlGZipB64: gzipBase64(signedDpsXml) });
    } catch (error) {
      return { kind: 'uncertain', reason: error instanceof Error ? error.message : String(error) };
    }
    const body = response.body as Record<string, unknown>;
    if (response.status === 201) {
      return {
        kind: 'issued',
        accessKey: String(body.chaveAcesso),
        dpsId: String(body.idDps),
        nfseXml: gunzipBase64(String(body.nfseXmlGZipB64)),
        alerts: (body.alertas as SefinError[] | undefined) ?? [],
      };
    }
    if (response.status === 400) {
      return { kind: 'rejected', dpsId: String(body.idDPS ?? body.idDps ?? ''), errors: (body.erros as SefinError[] | undefined) ?? [] };
    }
    return { kind: 'uncertain', reason: `HTTP ${response.status}` };
  }

  async findByDpsId(dpsId: string): Promise<DpsLookup> {
    const { status, body } = await this.call('GET', `${this.urls.sefin}/dps/${encodeURIComponent(dpsId)}`);
    if (status === 200) return { kind: 'found', accessKey: String((body as Record<string, unknown>).chaveAcesso) };
    if (status === 404) return { kind: 'not_found' };
    throw new NacionalHttpError(status, status >= 500 || status === 429, body);
  }

  async getNfse(accessKey: string): Promise<string> {
    const { status, body } = await this.call('GET', `${this.urls.sefin}/nfse/${encodeURIComponent(accessKey)}`);
    if (status !== 200) throw new NacionalHttpError(status, status >= 500 || status === 429, body);
    return gunzipBase64(String((body as Record<string, unknown>).nfseXmlGZipB64));
  }

  async registerEvent(accessKey: string, signedEventXml: string): Promise<EventResult> {
    const { status, body } = await this.call('POST', `${this.urls.sefin}/nfse/${encodeURIComponent(accessKey)}/eventos`, {
      pedidoRegistroEventoXmlGZipB64: gzipBase64(signedEventXml),
    });
    const data = body as Record<string, unknown>;
    if (status === 201) return { kind: 'registered', eventXml: gunzipBase64(String(data.eventoXmlGZipB64)) };
    if (status === 400 || status === 401) return { kind: 'rejected', error: data.erro as SefinError };
    throw new NacionalHttpError(status, status >= 500 || status === 429, body);
  }

  async fetchDfe(nsu: number, cnpj: string): Promise<DfeBatch> {
    const url = `${this.urls.adn}/contribuintes/DFe/${nsu}?cnpjConsulta=${encodeURIComponent(cnpj)}&lote=true`;
    const { status, body } = await this.call('GET', url);
    // The ADN returns 400 and 404 with a full batch body, so read the body before the status.
    const data = body as { StatusProcessamento?: DfeBatch['status']; LoteDFe?: RawDfeItem[]; Erros?: unknown[] } | null;
    if (data?.StatusProcessamento && (status === 200 || status === 400 || status === 404)) {
      return {
        status: data.StatusProcessamento,
        documents: (data.LoteDFe ?? []).map((item) => ({
          nsu: item.NSU,
          accessKey: item.ChaveAcesso,
          type: item.TipoDocumento,
          ...(item.TipoEvento ? { eventType: item.TipoEvento } : {}),
          xml: gunzipBase64(item.ArquivoXml),
          createdAt: item.DataHoraGeracao,
        })),
        errors: data.Erros ?? [],
      };
    }
    throw new NacionalHttpError(status, status >= 500 || status === 429, body);
  }

  async checkConvenio(municipality: string): Promise<unknown> {
    const { status, body } = await this.call('GET', `${this.urls.adn}/parametrizacao/${encodeURIComponent(municipality)}/convenio`);
    if (status !== 200) throw new NacionalHttpError(status, status >= 500 || status === 429, body);
    return body;
  }

  private async call(method: 'GET' | 'POST', url: string, json?: unknown): Promise<{ status: number; body: unknown }> {
    const response = await request(url, {
      method,
      dispatcher: this.dispatcher,
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
      headers: { accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}) },
      ...(json ? { body: JSON.stringify(json) } : {}),
    });
    const text = await response.body.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Keep the raw text: some 5xx answers are HTML.
    }
    return { status: response.statusCode, body };
  }
}
```

Add to `src/index.ts`:

```ts
export { createMtlsDispatcher } from './http/createMtlsDispatcher';
export { ENDPOINTS } from './http/endpoints';
export { gunzipBase64, gzipBase64 } from './http/gzipBase64';
export { NacionalClient, NacionalHttpError } from './http/NacionalClient';
export type { DfeBatch, DfeDocument, DpsLookup, EventResult, IssueResult, SefinError } from './http/NacionalClient';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck && pnpm lint`
Expected: all PASS. If the timeout test hangs, check that `headersTimeout` is set from `timeoutMs` and that the MockAgent `.delay(1000)` is longer than `timeoutMs: 200`.

- [ ] **Step 5: mTLS dispatcher test**

Add to `NacionalClient.test.ts`:

```ts
import { loadCertificate } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { Agent } from 'undici';
import { createMtlsDispatcher } from './createMtlsDispatcher';

test('createMtlsDispatcher builds an Agent from PEM material', () => {
  const testCert = makeTestCertificate();
  const dispatcher = createMtlsDispatcher(loadCertificate(testCert.pfx, testCert.password));
  expect(dispatcher).toBeInstanceOf(Agent);
});
```

Run: `pnpm vitest run packages/provider-nacional/src/http`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/provider-nacional
git commit -m "feat(provider-nacional): Sefin and ADN client over mTLS with typed results"
```

---

### Task 9: Python signer and cross-verification

**Files:**
- Create: `services/signer-py/pyproject.toml`, `services/signer-py/AGENTS.md`, `services/signer-py/notaflow_signer/__init__.py`, `notaflow_signer/sign.py`, `notaflow_signer/cli.py`, `services/signer-py/tests/test_sign.py`
- Create: `packages/signer-node/src/crossVerify.test.ts`
- Modify: `.github/workflows/ci.yml` (install `services/signer-py[test]`, run `pytest services/signer-py`)

**Interfaces:**
- Produces (Python):

```python
def sign_xml(xml: bytes, pfx: bytes, password: str, element_id: str, profile: str) -> bytes: ...
def verify_xml(xml: bytes, certificate_pem: bytes) -> bool: ...
```

- Produces (CLI, JSON on stdin, JSON on stdout):
  - `python -m notaflow_signer.cli sign` with `{"xml": "...", "pfx_b64": "...", "password": "...", "element_id": "...", "profile": "rsa-sha1-c14n"}` returns `{"xml": "<signed>"}`.
  - `python -m notaflow_signer.cli verify` with `{"xml": "...", "certificate_pem": "..."}` returns `{"valid": true}`.

- [ ] **Step 1: Package and failing tests**

`services/signer-py/pyproject.toml`:

```toml
[project]
name = "notaflow-signer"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = ["signxml>=4,<5", "lxml>=5.3,<6", "cryptography>=44"]

[project.optional-dependencies]
test = ["pytest>=8"]

[build-system]
requires = ["setuptools>=75"]
build-backend = "setuptools.build_meta"

[tool.setuptools]
packages = ["notaflow_signer"]
```

`services/signer-py/tests/test_sign.py`:

```python
import datetime

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from notaflow_signer.sign import sign_xml, verify_xml

NS = "http://www.sped.fazenda.gov.br/nfse"
ELEMENT_ID = "DPS355030821234567800019500900000000000000001"
XML = (
    f'<DPS xmlns="{NS}" versao="1.01"><infDPS Id="{ELEMENT_ID}">'
    "<xDescServ>Consultoria em análise &amp; ção</xDescServ></infDPS></DPS>"
).encode()


@pytest.fixture(scope="module")
def certificate():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "EMPRESA TESTE LTDA:12345678000195")])
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    pfx = pkcs12.serialize_key_and_certificates(
        b"test", key, cert, None, serialization.BestAvailableEncryption(b"test-password")
    )
    return pfx, cert.public_bytes(serialization.Encoding.PEM)


@pytest.mark.parametrize("profile", ["rsa-sha1-c14n", "rsa-sha256-exc-c14n"])
def test_signs_and_verifies(certificate, profile):
    pfx, cert_pem = certificate
    signed = sign_xml(XML, pfx, "test-password", ELEMENT_ID, profile)
    assert verify_xml(signed, cert_pem)
    assert signed.rstrip().endswith(b"</ds:Signature></DPS>") or signed.rstrip().endswith(b"</Signature></DPS>")


def test_tampered_document_fails(certificate):
    pfx, cert_pem = certificate
    signed = sign_xml(XML, pfx, "test-password", ELEMENT_ID, "rsa-sha1-c14n")
    assert not verify_xml(signed.replace(b"Consultoria", b"Consultorio"), cert_pem)
```

Run: `pip install -e "services/signer-py[test]" && pytest services/signer-py`
Expected: FAIL, "No module named 'notaflow_signer.sign'".

- [ ] **Step 2: Implement**

`services/signer-py/notaflow_signer/__init__.py`: empty file.

`services/signer-py/notaflow_signer/sign.py`:

```python
from cryptography import x509
from cryptography.hazmat.primitives.serialization import pkcs12
from lxml import etree
from signxml import DigestAlgorithm, SignatureMethod, XMLSigner, XMLVerifier, methods
from signxml.exceptions import InvalidSignature
from signxml.verifier import SignatureConfiguration

PROFILES = {
    "rsa-sha1-c14n": (
        SignatureMethod.RSA_SHA1,
        DigestAlgorithm.SHA1,
        "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ),
    "rsa-sha256-exc-c14n": (
        SignatureMethod.RSA_SHA256,
        DigestAlgorithm.SHA256,
        "http://www.w3.org/2001/10/xml-exc-c14n#",
    ),
}


def sign_xml(xml: bytes, pfx: bytes, password: str, element_id: str, profile: str) -> bytes:
    signature_method, digest, c14n = PROFILES[profile]
    key, cert, _ = pkcs12.load_key_and_certificates(pfx, password.encode())
    if key is None or cert is None:
        raise ValueError("The certificate file has no key or no certificate.")
    root = etree.fromstring(xml)
    signer = XMLSigner(
        method=methods.enveloped,
        signature_algorithm=signature_method,
        digest_algorithm=digest,
        c14n_algorithm=c14n,
    )
    # signxml appends the Signature as the last child of the root, as the XSD requires.
    signed = signer.sign(root, key=key, cert=[cert], reference_uri=f"#{element_id}")
    return etree.tostring(signed, encoding="UTF-8")


def verify_xml(xml: bytes, certificate_pem: bytes) -> bool:
    cert = x509.load_pem_x509_certificate(certificate_pem)
    config = SignatureConfiguration(
        signature_methods=frozenset(SignatureMethod),
        digest_algorithms=frozenset(DigestAlgorithm),
        require_x509=False,
    )
    try:
        XMLVerifier().verify(xml, x509_cert=cert, expect_config=config)
        return True
    except InvalidSignature:
        return False
```

If `signxml` 4 refuses SHA1 for signing (it raises `InvalidInput` mentioning SHA1), record that in the spike results and keep only the `rsa-sha256-exc-c14n` profile in Python. Do not downgrade `signxml`.

`services/signer-py/notaflow_signer/cli.py`:

```python
import base64
import json
import sys

from notaflow_signer.sign import sign_xml, verify_xml


def main() -> int:
    command = sys.argv[1]
    payload = json.load(sys.stdin)
    if command == "sign":
        signed = sign_xml(
            payload["xml"].encode(),
            base64.b64decode(payload["pfx_b64"]),
            payload["password"],
            payload["element_id"],
            payload["profile"],
        )
        json.dump({"xml": signed.decode()}, sys.stdout)
        return 0
    if command == "verify":
        json.dump({"valid": verify_xml(payload["xml"].encode(), payload["certificate_pem"].encode())}, sys.stdout)
        return 0
    print(f"Unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Run the Python tests**

Run: `pytest services/signer-py -v`
Expected: 3 PASS (or 2 PASS and the SHA1 case documented, per the note above).

- [ ] **Step 4: Cross-verification test (Node signs, Python verifies; Python signs, Node verifies)**

`packages/signer-node/src/crossVerify.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTestCertificate } from '@notaflow/test-kit';
import { expect, test } from 'vitest';
import { loadCertificate } from './loadCertificate';
import { NodeSigner } from './NodeSigner';
import { verifyXmlSignature } from './verifyXmlSignature';

const SERVICE_DIR = fileURLToPath(new URL('../../../services/signer-py', import.meta.url));
const ID = 'DPS355030821234567800019500900000000000000001';
const XML = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${ID}"><xDescServ>análise</xDescServ></infDPS></DPS>`;

function python(command: 'sign' | 'verify', payload: object): Record<string, unknown> {
  const result = spawnSync(process.env.PYTHON ?? 'python', ['-m', 'notaflow_signer.cli', command], {
    cwd: SERVICE_DIR,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

const testCert = makeTestCertificate();
const certificate = loadCertificate(testCert.pfx, testCert.password);

test('Python verifies a Node signature (SHA1 profile)', async () => {
  const signed = await new NodeSigner().sign({ xml: XML, elementName: 'infDPS', certificate, profile: 'rsa-sha1-c14n' });
  expect(python('verify', { xml: signed, certificate_pem: certificate.certificatePem })).toEqual({ valid: true });
});

test('Node verifies a Python signature (SHA256 profile)', () => {
  const { xml } = python('sign', {
    xml: XML,
    pfx_b64: testCert.pfx.toString('base64'),
    password: testCert.password,
    element_id: ID,
    profile: 'rsa-sha256-exc-c14n',
  });
  expect(verifyXmlSignature(String(xml), certificate.certificatePem)).toBe(true);
});
```

Run: `pnpm vitest run packages/signer-node/src/crossVerify.test.ts`
Expected: 2 PASS. A failure here is a spike finding, not a test to delete: record which direction fails and why in the spike results.

- [ ] **Step 5: CI and AGENTS**

In `.github/workflows/ci.yml`, change the pip line to `pip install -r tools/xsd/requirements.txt -e "services/signer-py[test]"` and add `- run: pytest services/signer-py` after `pnpm test`.

`services/signer-py/AGENTS.md`: what it is (plan B signer, Stage 0 comparison), how to run tests, and the rule "Promote to a FastAPI sidecar only if the Stage 0 decision picks Python."

- [ ] **Step 6: Commit**

```bash
git add services/signer-py packages/signer-node/src/crossVerify.test.ts .github/workflows/ci.yml
git commit -m "feat(signer-py): Python signer with cross-verification against the Node signer"
```

---

### Task 10: Spike against produção restrita and the decision record

**Files:**
- Create: `spikes/2026-10-sefin/run.ts`, `spikes/2026-10-sefin/README.md`
- Modify: root `package.json` (add `"spike:sefin": "tsx --env-file=.env.local spikes/2026-10-sefin/run.ts"`; add `@notaflow/provider-nacional` and `@notaflow/signer-node` as root `devDependencies` with `workspace:*`)
- Modify: `docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md`

**Interfaces:**
- Consumes: everything from Tasks 4 to 9.
- Produces: `spikes/2026-10-sefin/results.local.json` (gitignored, real data) and a sanitized "Stage 0 results" section in the RFC.

This task needs Lincoln: the real Vapulab `.pfx`, its password, and the tax data of a test invoice. The agent writes the script; Lincoln fills `.env.local` and runs it.

- [ ] **Step 1: Write the spike script**

`spikes/2026-10-sefin/run.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCancelEventXml,
  buildDpsXml,
  createMtlsDispatcher,
  NacionalClient,
  type DpsInput,
  type IssueResult,
} from '@notaflow/provider-nacional';
import { loadCertificate, NodeSigner } from '@notaflow/signer-node';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
};

const pfx = readFileSync(env('NOTAFLOW_PFX_PATH'));
const password = env('NOTAFLOW_PFX_PASSWORD');
const certificate = loadCertificate(pfx, password);
const client = new NacionalClient({ environment: 'producao_restrita', dispatcher: createMtlsDispatcher(certificate) });
const nodeSigner = new NodeSigner();
const results: Record<string, unknown> = { cnpj: certificate.cnpj, notAfter: certificate.notAfter };
const appVersion = 'notaflow-spike-0';
// Random high series start so reruns never collide with an earlier run.
let nextNumber = Math.floor(Date.now() / 1000) % 1_000_000_000;

function dps(description: string, serviceCents = 1000): DpsInput {
  return {
    environment: 'producao_restrita',
    issuedAt: new Date(Date.now() - 60_000),
    appVersion,
    series: env('NOTAFLOW_DPS_SERIES'),
    number: nextNumber++,
    competence: new Date().toISOString().slice(0, 10),
    emitterMunicipality: env('NOTAFLOW_EMITTER_MUNICIPALITY'),
    provider: {
      cnpj: certificate.cnpj,
      municipalRegistration: env('NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION'),
      simplesNacional: env('NOTAFLOW_SIMPLES_NACIONAL') as DpsInput['provider']['simplesNacional'],
      specialRegime: env('NOTAFLOW_SPECIAL_REGIME') as DpsInput['provider']['specialRegime'],
    },
    customer: { document: { type: 'CNPJ', value: env('NOTAFLOW_CUSTOMER_CNPJ') }, name: env('NOTAFLOW_CUSTOMER_NAME') },
    service: {
      municipality: env('NOTAFLOW_EMITTER_MUNICIPALITY'),
      nationalTaxCode: env('NOTAFLOW_SERVICE_NATIONAL_CODE'),
      description,
      ...(process.env.NOTAFLOW_SERVICE_NBS ? { nbsCode: process.env.NOTAFLOW_SERVICE_NBS } : {}),
    },
    amounts: { serviceCents },
    tax: { issqnTaxation: '1', issRetention: '1' },
  };
}

function pythonSign(xml: string, elementId: string, profile: string): string {
  const result = spawnSync(process.env.PYTHON ?? 'python', ['-m', 'notaflow_signer.cli', 'sign'], {
    cwd: fileURLToPath(new URL('../../services/signer-py', import.meta.url)),
    input: JSON.stringify({ xml, pfx_b64: pfx.toString('base64'), password, element_id: elementId, profile }),
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return String((JSON.parse(result.stdout) as { xml: string }).xml);
}

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    results[name] = await run();
  } catch (error) {
    results[name] = { thrown: error instanceof Error ? error.message : String(error) };
  }
  console.log(name, JSON.stringify(results[name]).slice(0, 300));
}

const summary = (r: IssueResult) =>
  r.kind === 'issued' ? { kind: r.kind, accessKey: r.accessKey, alerts: r.alerts } : r;

await step('1_convenio', () => client.checkConvenio(env('NOTAFLOW_EMITTER_MUNICIPALITY')));

for (const profile of ['rsa-sha1-c14n', 'rsa-sha256-exc-c14n'] as const) {
  await step(`2_node_${profile}`, async () => {
    const { xml } = buildDpsXml(dps(`Spike NotaFlow node ${profile} ação`));
    return summary(await client.issue(await nodeSigner.sign({ xml, elementName: 'infDPS', certificate, profile })));
  });
  await step(`3_python_${profile}`, async () => {
    const { id, xml } = buildDpsXml(dps(`Spike NotaFlow python ${profile} ação`));
    return summary(await client.issue(pythonSign(xml, id, profile)));
  });
}

await step('4_reuse_after_rejection', async () => {
  const input = dps('Spike reuse', 0); // zero service amount is expected to be rejected
  const first = await client.issue(await nodeSigner.sign({ xml: buildDpsXml(input).xml, elementName: 'infDPS', certificate, profile: 'rsa-sha1-c14n' }));
  const retry = { ...input, amounts: { serviceCents: 1000 }, issuedAt: new Date(Date.now() - 60_000) };
  const second = await client.issue(await nodeSigner.sign({ xml: buildDpsXml(retry).xml, elementName: 'infDPS', certificate, profile: 'rsa-sha1-c14n' }));
  return { first: summary(first), secondSameNumber: summary(second) };
});

const issued = Object.values(results).find(
  (r): r is { kind: 'issued'; accessKey: string } => typeof r === 'object' && r !== null && (r as { kind?: string }).kind === 'issued',
);

if (issued) {
  await step('5_get_nfse', async () => (await client.getNfse(issued.accessKey)).slice(0, 200));
  await step('6_cancel', async () => {
    const { xml } = buildCancelEventXml({
      environment: 'producao_restrita',
      requestedAt: new Date(Date.now() - 60_000),
      appVersion,
      authorCnpj: certificate.cnpj,
      accessKey: issued.accessKey,
      reason: '1',
      justification: 'Teste de cancelamento do spike NotaFlow',
    });
    return client.registerEvent(issued.accessKey, await nodeSigner.sign({ xml, elementName: 'infPedReg', certificate, profile: 'rsa-sha1-c14n' }));
  });
}

await step('7_find_by_dps_id_unknown', () => client.findByDpsId(buildDpsXml(dps('never sent')).id));
await step('8_dfe_first_batch', async () => {
  const batch = await client.fetchDfe(0, certificate.cnpj);
  return { status: batch.status, count: batch.documents.length, types: [...new Set(batch.documents.map((d) => d.type))] };
});

writeFileSync(new URL('./results.local.json', import.meta.url), JSON.stringify(results, null, 2));
console.log('Saved spikes/2026-10-sefin/results.local.json');
```

`spikes/2026-10-sefin/README.md`: what the spike proves (the eight steps), that it runs only in produção restrita, that `results.local.json` holds real data and is gitignored, and how to run it: copy `.env.example` to `.env.local`, fill it, run `pnpm spike:sefin`.

- [ ] **Step 2: Static checks**

Create a root `tsconfig.json`: `{ "extends": "./tsconfig.base.json", "include": ["spikes"] }`. Add `"typecheck:root": "tsc -p tsconfig.json"` to the root scripts, and change `typecheck` to `"pnpm -r --parallel typecheck && pnpm typecheck:root"`.

Run: `pnpm typecheck && pnpm lint`
Expected: pass.

- [ ] **Step 3: Commit the script**

```bash
git add spikes package.json tsconfig.json pnpm-lock.yaml
git commit -m "chore(spike): add the Sefin produção restrita spike runner"
```

- [ ] **Step 4: Lincoln runs the spike (manual)**

Lincoln copies `.env.example` to `.env.local`, fills it with the Vapulab data and a test customer (CoGrader's CNPJ is fine in produção restrita, the notes have no fiscal value), and runs `pnpm spike:sefin`.
Expected: the console prints one line per step, and `results.local.json` exists. Confirm with `git status --porcelain` that neither `.env.local` nor `results.local.json` shows up.

- [ ] **Step 5: Record the decision in the RFC**

Read `results.local.json`. Add a section "Stage 0 results (2026-10-xx)" to the RFC, with no CNPJ, no access key, and no customer data:

- Signer: which of the four combinations (Node/Python x SHA1/SHA256) were accepted. Decision: Node if any Node profile was accepted, with the accepted profile as the default.
- DPS reuse: the result of step 4 (`secondSameNumber` issued or rejected, and the error code).
- Connection test: the status of step 1.
- Cancel: the status of step 6.
- ADN: the status and document types of step 8.
- Anything surprising: Sefin error codes, `alertas`, timing.

Close the matching Open Questions. If the CN of the real certificate does not carry the CNPJ (`loadCertificate` throws `CNPJ_NOT_FOUND` before step 1), record it: Stage 1a then adds the SAN `otherName` 2.16.76.1.3.3 parser.

- [ ] **Step 6: Commit and push**

```bash
git add docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md
git commit -m "docs(rfc): record the Stage 0 spike results and the signer decision"
git push
```

Next: write `docs/ENGINEERING/PLANS/2026/10/PLAN_STAGE_1A.md` from the decision.
