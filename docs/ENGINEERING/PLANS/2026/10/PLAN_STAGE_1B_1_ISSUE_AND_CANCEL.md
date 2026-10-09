# Stage 1b-1 (Issue, Reconcile, and Cancel on the Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server issue a new NFS-e from a stored invoice ("issue similar"), protect the issue against duplicates with a pending row and reconciliation by DPS id, cancel an issued invoice, suggest the PTAX exchange rate for an export invoice, and let users correct customer data.

**Architecture:** `provider-nacional` gets a strict template reader that turns a stored NFS-e XML into a `DpsTemplate` (every fiscal group copied as is, any field it does not know refused), and a `NacionalIssuer` that builds, signs (Node signer, `rsa-sha256-exc-c14n`), sends, looks up, and cancels. `core` gets the provider-neutral `InvoiceIssuer` port. The server reserves the DPS number and creates a `pending` row in one transaction before anything goes to the Sefin, then records `issued`, `rejected`, or `unknown`. An `unknown` invoice is reconciled by DPS id; it is resent only when the Sefin has no invoice for that DPS. Stage 1b-2 builds the screens on this API.

**Tech Stack:** Node 22 or later, pnpm 10, TypeScript 5, Vitest 3, Fastify 5, Drizzle 0.45, `undici` 7, `@notaflow/signer-node`, `@notaflow/fake-nacional`.

**Spec:** [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md), sections "Flow: issue a new invoice", "Flow: cancel", "Invoice status", "Data Model", "Testing", "Stage 0 Results", "Open Questions".

**Decisions from Lincoln (2026-10-09):**
- "Issue similar" copies every fiscal group from the template invoice (ISS taxation, PIS/COFINS, Simples, `IBSCBS`, `comExt`). The user edits only the competence, the amounts, the description, and the customer. "Issue for a customer without a previous invoice" is out of Stage 1b.
- An export invoice gets the BRL amount from the PTAX. Evidence from the emitter's real invoices: the August invoice used exactly the **PTAX sell rate of the closing bulletin ("Fechamento PTAX") on the competence date**; the two July invoices match no PTAX closing rate (probably the bank contract rate). So the app **suggests** the PTAX sell closing rate of the competence date (or of the last business day before it), shows its source, and keeps the BRL amount editable.
- Stage 1b has two plans: this one (server) and 1b-2 (screens and the acceptance in produção restrita).

## Global Constraints

- Never use TypeScript non-null assertions (`value!`). ESLint enforces it.
- A credential never enters git or a log. Tests use `@notaflow/test-kit` certificates and synthetic data (CNPJ `12345678000195`). No real invoice data enters the repository.
- Every account query goes through a repository method that takes an `AccountContext`.
- Amounts are integer cents. An exchange rate is an integer scaled by 10 000 (`54321` for 5.4321), so no float touches money.
- The DPS is signed with the Node signer and the `rsa-sha256-exc-c14n` profile (Stage 0 decision).
- The issue date (`dhEmi`) is now minus 60 seconds, because the Sefin refuses a future date and clocks drift. The competence is chosen by the user and must not be after the issue date (Brasília day).
- The app never resends a DPS blindly: an `unknown` invoice is resent only after `GET /dps/{id}` says no NFS-e exists for it, and always with the same DPS number.
- A zero service amount is refused by the app (the Sefin accepts it; Stage 0 Results).
- Issue, cancel, and customer edits need the `write` guard (a suspended account cannot do them). Issue and cancel are open to owners and members (RFC Roles).
- Every issue, reconciliation, cancel, and customer edit writes an audit entry.
- Comments are a budget: one line, only the non-obvious why. Docs in English, no em dash. UI text (later, in 1b-2) in Brazilian Portuguese.
- Commits carry no AI attribution. Never pass `--no-verify`. On Lincoln's Windows machine, add the `gitleaks` folder to `PATH` before `git commit`.
- PRs target `production`. Tests run locally: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pytest services/signer-py`.

## Review Focus

1. The Sefin answers late (timeout) after storing the invoice. Expected: the row is `unknown`; reconciliation finds the NFS-e by DPS id and marks it `issued` with its access key and XML; nothing is sent twice. Pinned in Task 7.
2. A resend of a DPS that the Sefin already issued answers E0014. Expected: the issuer treats E0014 as "already exists", looks the invoice up by DPS id, and the row ends `issued`, never `rejected`. Pinned in Task 3 and Task 7.
3. A template invoice holds a field the DPS builder does not support (for example `BM` or `vBCPisCofins`). Expected: HTTP 422 `template_unsupported` with the field paths; nothing is reserved or sent. Pinned in Task 2 and Task 6.
4. Two issue requests at the same time for the same emitter. Expected: two different DPS numbers, never the same one twice. Pinned in Task 5.
5. The PTAX has no quote on the competence date (a weekend or a holiday). Expected: the rate of the last business day before it, with that date in the answer. Pinned in Task 4.

---

## File Structure

```
packages/core/src/
  ports/InvoiceIssuer.ts                 IssueRequest, IssueOutcome, CancelOutcome, InvoiceIssuer
packages/provider-nacional/src/
  http/NacionalClient.ts                 event errors in erros[], isDuplicateDps
  template/readTemplate.ts               NFS-e XML -> DpsTemplate, TemplateUnsupportedError
  template/applyTemplate.ts              DpsTemplate + IssueRequest -> DpsInput
  NacionalIssuer.ts                      InvoiceIssuer for the national system
  test/fixtures/NFSE_EXPORT_FULL.xml     synthetic export NFS-e with every supported group
apps/server/src/
  exchange/ptax.ts                       PTAX sell closing rate, conversion to cents
  repos/EmitterRepository.ts             reserveDpsNumber
  repos/InvoiceRepository.ts             createPending, markIssued, markRejected, markUnknown, pendingIssue
  repos/CustomerRepository.ts            get, update by hand
  issue/IssueService.ts                  issue, reconcile, cancel
  providers/providerFactory.ts           + issuerFactory
  routes/issue.ts                        issue, reconcile, cancel, draft, exchange rate
  routes/customers.ts                    + GET one, PUT one
docs/ENGINEERING/ARCHITECTURE/
  INVOICE_LIFECYCLE.md
```

---

### Task 1: Client fixes for event rejections and the duplicate-DPS code

**Files:**
- Modify: `packages/provider-nacional/src/http/NacionalClient.ts`, `NacionalClient.test.ts`
- Modify: `packages/provider-nacional/src/index.ts`

**Interfaces:**
- Produces:
  - `registerEvent` reads a rejection from `erro` (one object) or `erros` (an array, first item); both casings of `Codigo`.
  - `isDuplicateDps(errors: SefinError[]): boolean` (true when any `codigo` is `E0014`)

The RFC "Stage 0 Results" recorded that a second cancellation came back in a shape the client did not read (empty code and message). The real body is still unknown, so the client accepts both documented shapes.

- [ ] **Step 1: Write the failing tests**

Append to the `registerEvent` block of `NacionalClient.test.ts`:

```ts
  test('400 with an erros array returns the first error', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(400, { erros: [{ Codigo: 'E0840', Descricao: 'NFS-e já cancelada' }] });
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({
      kind: 'rejected',
      error: { codigo: 'E0840', descricao: 'NFS-e já cancelada' },
    });
  });
```

Append at the top level:

```ts
test('isDuplicateDps is true only for E0014', () => {
  expect(isDuplicateDps([{ codigo: 'E0014', descricao: 'x' }])).toBe(true);
  expect(isDuplicateDps([{ codigo: 'E0001', descricao: 'x' }])).toBe(false);
  expect(isDuplicateDps([])).toBe(false);
});
```

Add `isDuplicateDps` to the `./NacionalClient` import of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/provider-nacional/src/http`
Expected: FAIL; the `erros` test gets `{ codigo: '', descricao: '' }`, and `isDuplicateDps` is not exported.

- [ ] **Step 3: Implement**

In `NacionalClient.ts`, change the rejected branch of `registerEvent`:

```ts
    if (status === 400 || status === 401) {
      const raw = Array.isArray(data.erros) ? data.erros[0] : data.erro;
      return { kind: 'rejected', error: sefinError(raw) };
    }
```

and add, next to `sefinError`:

```ts
// E0014: an NFS-e already exists for this DPS (RFC Open Questions).
export function isDuplicateDps(errors: SefinError[]): boolean {
  return errors.some((error) => error.codigo === 'E0014');
}
```

Export `isDuplicateDps` from `src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-nacional
git commit -m "fix(provider-nacional): read event rejections in erros arrays and flag E0014"
```

---

### Task 2: Read a stored NFS-e as a DPS template

**Files:**
- Create: `packages/provider-nacional/test/fixtures/NFSE_EXPORT_FULL.xml`
- Create: `packages/provider-nacional/src/template/readTemplate.ts`, `readTemplate.test.ts`
- Modify: `packages/provider-nacional/src/index.ts`

**Interfaces:**
- Consumes: `parseXmlRoot`, `child`, `childElements`, `text`, `requiredText`, `requiredChild` (Stage 1a-1); `DpsInput` (Stage 0); `buildDpsXml`.
- Produces:
  - `type DpsTemplate = Omit<DpsInput, 'environment' | 'issuedAt' | 'appVersion' | 'series' | 'number' | 'competence' | 'amounts'> & { serviceCents: number }`
  - `class TemplateUnsupportedError extends Error { paths: string[] }`
  - `readTemplate(nfseXml: string): DpsTemplate`

Rules:
- The template is the `infDPS` inside the stored `NFSe`. Every leaf element under it must be in the supported list below; any other leaf throws `TemplateUnsupportedError` with every unsupported path (for example `valores/trib/tribMun/BM/...`). The template never drops a field in silence (Review Focus 3).
- Per-issue fields (`tpAmb`, `dhEmi`, `verAplic`, `serie`, `nDPS`, `dCompet`, `tpEmit`) are read past and never copied.

Supported leaf paths (relative to `infDPS`):

```
tpAmb dhEmi verAplic serie nDPS dCompet tpEmit cLocEmi
prest/CNPJ prest/IM prest/fone prest/email prest/regTrib/opSimpNac prest/regTrib/regApTribSN prest/regTrib/regEspTrib
toma/CNPJ toma/CPF toma/NIF toma/IM toma/xNome toma/fone toma/email
toma/end/endNac/cMun toma/end/endNac/CEP
toma/end/endExt/cPais toma/end/endExt/cEndPost toma/end/endExt/xCidade toma/end/endExt/xEstProvReg
toma/end/xLgr toma/end/nro toma/end/xCpl toma/end/xBairro
serv/locPrest/cLocPrestacao serv/cServ/cTribNac serv/cServ/cTribMun serv/cServ/xDescServ serv/cServ/cNBS
serv/comExt/mdPrestacao serv/comExt/vincPrest serv/comExt/tpMoeda serv/comExt/vServMoeda
serv/comExt/mecAFComexP serv/comExt/mecAFComexT serv/comExt/movTempBens serv/comExt/mdic
valores/vServPrest/vServ
valores/trib/tribMun/tribISSQN valores/trib/tribMun/cPaisResult valores/trib/tribMun/tpRetISSQN valores/trib/tribMun/pAliq
valores/trib/tribFed/piscofins/CST valores/trib/tribFed/piscofins/tpRetPisCofins
valores/trib/totTrib/pTotTribSN valores/trib/totTrib/indTotTrib
IBSCBS/finNFSe IBSCBS/indFinal IBSCBS/cIndOp IBSCBS/indDest
IBSCBS/valores/trib/gIBSCBS/CST IBSCBS/valores/trib/gIBSCBS/cClassTrib
```

This list is exactly what `buildDpsXml` writes (Stage 0 and the export work), so read and build are inverse operations.

- [ ] **Step 1: Write the fixture**

`packages/provider-nacional/test/fixtures/NFSE_EXPORT_FULL.xml` is a synthetic export NFS-e with every group of the emitter's real export invoice, built from synthetic values. Create it from the builder, so it is valid by construction: run once

```bash
pnpm --filter @notaflow/provider-nacional exec tsx -e "import { buildDpsXml } from './src/index.ts'; import { writeFileSync } from 'node:fs'; const { xml } = buildDpsXml({ environment: 'producao_restrita', issuedAt: new Date('2026-09-02T16:12:54Z'), appVersion: 'notaflow-test', series: '900', number: 6, competence: '2026-08-31', emitterMunicipality: '4113700', provider: { cnpj: '12345678000195', phone: '43999990000', email: 'contato@example.com', simplesNacional: '3', simplesRegime: '1', specialRegime: '0' }, customer: { document: { type: 'NIF', value: '00-0000000' }, name: 'Foreign Customer Inc', address: { country: 'US', postalCode: '99999', city: 'Testville', region: 'NY', street: '1 Example Street', number: '1', complement: 'Suite 2', district: 'Downtown' } }, service: { municipality: '4113700', nationalTaxCode: '010701', description: 'Serviços de TI para tomador no exterior', nbsCode: '115080000', foreignTrade: { mode: '1', providerLink: '0', currency: '220', amountInCurrencyCents: 200000, providerSupport: '02', customerSupport: '02', temporaryGoods: '1', mdic: '0' } }, amounts: { serviceCents: 1086420 }, tax: { issqnTaxation: '3', resultCountry: 'US', issRetention: '1', pisCofins: { cst: '00', retention: '0' }, simplesTotalPercent: '6.00' }, ibsCbs: { purpose: '0', finalConsumer: '0', operationCode: '100302', destination: '0', cst: '410', classCode: '410027' } }); const nfse = '<?xml version=\"1.0\" encoding=\"utf-8\"?><NFSe versao=\"1.01\" xmlns=\"http://www.sped.fazenda.gov.br/nfse\"><infNFSe Id=\"NFS41137002212345678000195000000000000626090000000060\"><nNFSe>6</nNFSe><cStat>100</cStat><dhProc>2026-09-02T13:12:54-03:00</dhProc><emit><CNPJ>12345678000195</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></emit><valores><vLiq>10864.20</vLiq></valores>' + xml + '</infNFSe></NFSe>'; writeFileSync('test/fixtures/NFSE_EXPORT_FULL.xml', nfse + '\n');"
```

Check: `parseNfseXml` (Stage 1a-1) reads the file; the root `DPS` element keeps its `xmlns`.

- [ ] **Step 2: Write the failing tests**

`packages/provider-nacional/src/template/readTemplate.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { buildDpsXml } from '../dps/buildDpsXml';
import { readTemplate, TemplateUnsupportedError } from './readTemplate';

const full = readFixture('NFSE_EXPORT_FULL.xml');

describe('readTemplate', () => {
  test('copies every fiscal group of an export invoice', () => {
    expect(readTemplate(full)).toEqual({
      emitterMunicipality: '4113700',
      provider: {
        cnpj: '12345678000195',
        phone: '43999990000',
        email: 'contato@example.com',
        simplesNacional: '3',
        simplesRegime: '1',
        specialRegime: '0',
      },
      customer: {
        document: { type: 'NIF', value: '00-0000000' },
        name: 'Foreign Customer Inc',
        address: {
          country: 'US',
          postalCode: '99999',
          city: 'Testville',
          region: 'NY',
          street: '1 Example Street',
          number: '1',
          complement: 'Suite 2',
          district: 'Downtown',
        },
      },
      service: {
        municipality: '4113700',
        nationalTaxCode: '010701',
        description: 'Serviços de TI para tomador no exterior',
        nbsCode: '115080000',
        foreignTrade: {
          mode: '1',
          providerLink: '0',
          currency: '220',
          amountInCurrencyCents: 200000,
          providerSupport: '02',
          customerSupport: '02',
          temporaryGoods: '1',
          mdic: '0',
        },
      },
      serviceCents: 1086420,
      tax: {
        issqnTaxation: '3',
        resultCountry: 'US',
        issRetention: '1',
        pisCofins: { cst: '00', retention: '0' },
        simplesTotalPercent: '6.00',
      },
      ibsCbs: {
        purpose: '0',
        finalConsumer: '0',
        operationCode: '100302',
        destination: '0',
        cst: '410',
        classCode: '410027',
      },
    });
  });

  test('round trip: the template rebuilds the same infDPS', () => {
    const template = readTemplate(full);
    const { serviceCents, ...rest } = template;
    const { xml } = buildDpsXml({
      ...rest,
      environment: 'producao_restrita',
      issuedAt: new Date('2026-09-02T16:12:54Z'),
      appVersion: 'notaflow-test',
      series: '900',
      number: 6,
      competence: '2026-08-31',
      amounts: { serviceCents },
    });
    expect(full).toContain(xml.replace(/^<DPS xmlns="[^"]+" versao="1\.01">/, ''));
  });

  test('a field the builder does not support is refused with its path', () => {
    const xml = full.replace(
      '<tpRetISSQN>1</tpRetISSQN>',
      '<BM><tpBM>1</tpBM></BM><tpRetISSQN>1</tpRetISSQN>',
    );
    try {
      readTemplate(xml);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateUnsupportedError);
      expect((error as TemplateUnsupportedError).paths).toEqual(['valores/trib/tribMun/BM/tpBM']);
    }
  });

  test('a domestic invoice with a CNPJ customer and ISS rate reads too', () => {
    const domestic = readFixture('NFSE_DOMESTIC.xml');
    const template = readTemplate(domestic);
    expect(template.customer?.document).toEqual({ type: 'CNPJ', value: '98765432000110' });
    expect(template.tax).toEqual({ issqnTaxation: '1', issRetention: '1' });
  });
});
```

The round-trip assertion compares the rebuilt `infDPS` element (the builder's output minus its root `DPS` opening tag) with the fixture, which the builder wrote in Step 1. `NFSE_DOMESTIC.xml` (Stage 1a-1) has `indTotTrib` 0, which the builder writes when `simplesTotalPercent` is absent, so the domestic template has no `simplesTotalPercent`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/provider-nacional/src/template`
Expected: FAIL, `./readTemplate` does not exist.

- [ ] **Step 4: Implement**

`packages/provider-nacional/src/template/readTemplate.ts`:

```ts
import type { Element } from '@xmldom/xmldom';
import type { DpsInput, ForeignTrade } from '../dps/types';
import { decimalToCents } from '../xml/formatters';
import { child, childElements, parseXmlRoot, requiredChild, requiredText, text } from '../xml/readXml';

export type DpsTemplate = Omit<
  DpsInput,
  'environment' | 'issuedAt' | 'appVersion' | 'series' | 'number' | 'competence' | 'amounts'
> & { serviceCents: number };

export class TemplateUnsupportedError extends Error {
  constructor(readonly paths: string[]) {
    super(`The template has fields NotaFlow cannot copy yet: ${paths.join(', ')}`);
    this.name = 'TemplateUnsupportedError';
  }
}

const SUPPORTED = new Set(
  `tpAmb dhEmi verAplic serie nDPS dCompet tpEmit cLocEmi
  prest/CNPJ prest/IM prest/fone prest/email prest/regTrib/opSimpNac prest/regTrib/regApTribSN prest/regTrib/regEspTrib
  toma/CNPJ toma/CPF toma/NIF toma/IM toma/xNome toma/fone toma/email
  toma/end/endNac/cMun toma/end/endNac/CEP
  toma/end/endExt/cPais toma/end/endExt/cEndPost toma/end/endExt/xCidade toma/end/endExt/xEstProvReg
  toma/end/xLgr toma/end/nro toma/end/xCpl toma/end/xBairro
  serv/locPrest/cLocPrestacao serv/cServ/cTribNac serv/cServ/cTribMun serv/cServ/xDescServ serv/cServ/cNBS
  serv/comExt/mdPrestacao serv/comExt/vincPrest serv/comExt/tpMoeda serv/comExt/vServMoeda
  serv/comExt/mecAFComexP serv/comExt/mecAFComexT serv/comExt/movTempBens serv/comExt/mdic
  valores/vServPrest/vServ
  valores/trib/tribMun/tribISSQN valores/trib/tribMun/cPaisResult valores/trib/tribMun/tpRetISSQN valores/trib/tribMun/pAliq
  valores/trib/tribFed/piscofins/CST valores/trib/tribFed/piscofins/tpRetPisCofins
  valores/trib/totTrib/pTotTribSN valores/trib/totTrib/indTotTrib
  IBSCBS/finNFSe IBSCBS/indFinal IBSCBS/cIndOp IBSCBS/indDest
  IBSCBS/valores/trib/gIBSCBS/CST IBSCBS/valores/trib/gIBSCBS/cClassTrib`.split(/\s+/),
);

function leafPaths(element: Element, prefix: string): string[] {
  const children = childElements(element);
  if (children.length === 0) return [prefix];
  return children.flatMap((c) => leafPaths(c, prefix ? `${prefix}/${c.localName}` : String(c.localName)));
}

export function readTemplate(nfseXml: string): DpsTemplate {
  const dps = requiredChild(requiredChild(parseXmlRoot(nfseXml, 'NFSe'), 'infNFSe'), 'DPS', 'infDPS');
  const unsupported = leafPaths(dps, '').filter((path) => !SUPPORTED.has(path));
  if (unsupported.length > 0) throw new TemplateUnsupportedError(unsupported);

  const opt = <K extends string, V>(key: K, value: V | undefined) =>
    (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
  const prest = requiredChild(dps, 'prest');
  const serv = requiredChild(dps, 'serv');
  const tribMun = requiredChild(dps, 'valores', 'trib', 'tribMun');
  const toma = child(dps, 'toma');
  const comExt = child(serv, 'comExt');
  const ibs = child(dps, 'IBSCBS');
  const pisCofins = child(requiredChild(dps, 'valores', 'trib'), 'tribFed');

  return {
    emitterMunicipality: requiredText(dps, 'cLocEmi'),
    provider: {
      cnpj: requiredText(prest, 'CNPJ'),
      ...opt('municipalRegistration', text(prest, 'IM')),
      ...opt('phone', text(prest, 'fone')),
      ...opt('email', text(prest, 'email')),
      simplesNacional: requiredText(prest, 'regTrib', 'opSimpNac') as DpsInput['provider']['simplesNacional'],
      ...opt('simplesRegime', text(prest, 'regTrib', 'regApTribSN') as DpsInput['provider']['simplesRegime']),
      specialRegime: requiredText(prest, 'regTrib', 'regEspTrib') as DpsInput['provider']['specialRegime'],
    },
    ...(toma ? { customer: customerOf(toma) } : {}),
    service: {
      municipality: requiredText(serv, 'locPrest', 'cLocPrestacao'),
      nationalTaxCode: requiredText(serv, 'cServ', 'cTribNac'),
      ...opt('municipalTaxCode', text(serv, 'cServ', 'cTribMun')),
      description: requiredText(serv, 'cServ', 'xDescServ'),
      ...opt('nbsCode', text(serv, 'cServ', 'cNBS')),
      ...(comExt ? { foreignTrade: foreignTradeOf(comExt) } : {}),
    },
    serviceCents: decimalToCents(requiredText(dps, 'valores', 'vServPrest', 'vServ')),
    tax: {
      issqnTaxation: requiredText(tribMun, 'tribISSQN') as DpsInput['tax']['issqnTaxation'],
      ...opt('resultCountry', text(tribMun, 'cPaisResult')),
      issRetention: requiredText(tribMun, 'tpRetISSQN') as DpsInput['tax']['issRetention'],
      ...opt('issRatePercent', text(tribMun, 'pAliq')),
      ...(pisCofins
        ? {
            pisCofins: {
              cst: requiredText(pisCofins, 'piscofins', 'CST'),
              ...opt('retention', text(pisCofins, 'piscofins', 'tpRetPisCofins')),
            },
          }
        : {}),
      ...opt('simplesTotalPercent', text(dps, 'valores', 'trib', 'totTrib', 'pTotTribSN')),
    },
    ...(ibs
      ? {
          ibsCbs: {
            purpose: requiredText(ibs, 'finNFSe'),
            ...opt('finalConsumer', text(ibs, 'indFinal') as '0' | '1' | undefined),
            operationCode: requiredText(ibs, 'cIndOp'),
            destination: requiredText(ibs, 'indDest'),
            cst: requiredText(ibs, 'valores', 'trib', 'gIBSCBS', 'CST'),
            classCode: requiredText(ibs, 'valores', 'trib', 'gIBSCBS', 'cClassTrib'),
          },
        }
      : {}),
  };
}
```

Write `customerOf(toma)` and `foreignTradeOf(comExt)` in the same file, mirroring `party()` and `address()` of `parseNfseXml.ts` (Stage 1a-1) but returning the `DpsInput['customer']` shape (`document.type` limited to `CNPJ`, `CPF`, `NIF`; a customer without a document is a `TemplateUnsupportedError(['toma/cNaoNIF'])`, because the builder cannot write `cNaoNIF`), and `ForeignTrade` with `amountInCurrencyCents: decimalToCents(vServMoeda)`. Export `readTemplate`, `TemplateUnsupportedError`, and `DpsTemplate` from `src/index.ts`.

The `opt` helper keeps `exactOptionalPropertyTypes` happy without `undefined` values; if its type assertion fights the compiler, replace each `...opt(...)` with an explicit `...(value ? { key: value } : {})` and record the ruling.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/provider-nacional
git commit -m "feat(provider-nacional): read a stored NFS-e as a strict DPS template"
```

---

### Task 3: The `InvoiceIssuer` port and `NacionalIssuer`

**Files:**
- Create: `packages/core/src/ports/InvoiceIssuer.ts`; modify `packages/core/src/index.ts`
- Create: `packages/provider-nacional/src/template/applyTemplate.ts`
- Create: `packages/provider-nacional/src/NacionalIssuer.ts`, `NacionalIssuer.test.ts`
- Modify: `packages/provider-nacional/src/index.ts`, `packages/provider-nacional/package.json` (`@notaflow/signer-node` moves to `dependencies`)

**Interfaces:**
- Consumes: `readTemplate`, `DpsTemplate` (Task 2); `isDuplicateDps` (Task 1); `buildDpsXml`, `buildDpsId`, `buildCancelEventXml`, `NacionalClient`, `parseNfseXml`, `parseEventXml` (earlier stages); `NodeSigner` from `@notaflow/signer-node`; `CertificateMaterial`, `InvoiceParty`, `ProviderInvoice`, `ProviderEvent`, `Environment` from core.
- Produces (core):

```ts
export interface IssueRequest {
  templateXml: string; // the stored NFS-e the new invoice copies
  series: string;
  number: number;
  issuedAt: Date;
  competence: string; // YYYY-MM-DD
  serviceCents: number;
  foreignAmountCents?: number; // export invoices only
  description?: string;
  customer?: InvoiceParty; // replaces the template's customer
}

export type IssueOutcome =
  | { kind: 'issued'; invoice: ProviderInvoice }
  | { kind: 'rejected'; errors: { code: string; message: string }[] }
  | { kind: 'uncertain'; reason: string };

export type CancelOutcome =
  | { kind: 'cancelled'; event: ProviderEvent | null }
  | { kind: 'rejected'; error: { code: string; message: string } };

export interface InvoiceIssuer {
  dpsId(series: string, number: number, templateXml: string): string;
  issue(request: IssueRequest): Promise<IssueOutcome>;
  findIssued(dpsId: string): Promise<ProviderInvoice | null>;
  cancel(accessKey: string, reason: '1' | '2' | '9', justification: string): Promise<CancelOutcome>;
}
```

- Produces (provider): `applyTemplate(template: DpsTemplate, request: IssueRequest & { environment: Environment; appVersion: string }): DpsInput`; `class NacionalIssuer implements InvoiceIssuer`, `constructor(deps: { client: NacionalClient; certificate: CertificateMaterial; environment: Environment; appVersion: string })`.

Issuer rules:
- `issue` builds the DPS from the template, signs it (`infDPS`, `rsa-sha256-exc-c14n`), and sends it.
- `issued` → `{ kind: 'issued', invoice: parseNfseXml(nfseXml) }`.
- `rejected` with E0014 → look up by DPS id; found → `issued` with that invoice; not found → `uncertain` (Review Focus 2).
- other `rejected` → `rejected` with the Sefin codes and messages.
- `uncertain` → `uncertain`.
- `findIssued` → `findByDpsId`; `found` → `getNfse` → `parseNfseXml`; `not_found` → `null`.
- `cancel` → `buildCancelEventXml` (author CNPJ from the certificate), sign `infPedReg`, `registerEvent`; `registered` → `cancelled` with `parseEventXml(eventXml)` or `null` when unreadable; `rejected` → `rejected`.
- The export amount: when the template has `foreignTrade`, `foreignAmountCents` is required (`RangeError` otherwise) and replaces `amountInCurrencyCents`.

- [ ] **Step 1: Write the failing tests**

`packages/provider-nacional/src/NacionalIssuer.test.ts` runs against the fake (dev dependency of this package is not possible: the fake depends on this package). Put this test in `packages/fake-nacional/src/issuer.e2e.test.ts` instead, next to the Stage 1a-1 end-to-end test, with `@notaflow/provider-nacional`, `@notaflow/signer-node`, and `@notaflow/test-kit`:

```ts
import { NacionalClient, NacionalIssuer } from '@notaflow/provider-nacional';
import { loadCertificate } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { Agent } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { type FakeNacional, startFakeNacional } from './index';

const cert = makeTestCertificate();
const certificate = loadCertificate(cert.pfx, cert.password);
let fake: FakeNacional;
let issuer: NacionalIssuer;
let templateXml: string;

beforeEach(async () => {
  fake = await startFakeNacional();
  const client = new NacionalClient({ environment: 'producao_restrita', dispatcher: new Agent(), urls: fake.urls, timeoutMs: 300 });
  issuer = new NacionalIssuer({ client, certificate, environment: 'producao_restrita', appVersion: 'notaflow-test' });
  // A template issued on the fake from the full export fixture's shape.
  const { readFileSync } = await import('node:fs');
  templateXml = readFileSync(new URL('../../provider-nacional/test/fixtures/NFSE_EXPORT_FULL.xml', import.meta.url), 'utf8');
});
afterEach(() => fake.close());

const request = (number: number) => ({
  templateXml,
  series: '900',
  number,
  issuedAt: new Date(Date.now() - 60_000),
  competence: '2026-10-01',
  serviceCents: 670321,
  foreignAmountCents: 123400,
  description: 'Serviços de outubro',
});

test('issues a copy of the template with the new amounts and description', async () => {
  const outcome = await issuer.issue(request(1));
  expect(outcome.kind).toBe('issued');
  if (outcome.kind !== 'issued') return;
  expect(outcome.invoice).toMatchObject({
    competence: '2026-10-01',
    amounts: { serviceCents: 670321 },
    service: { nationalTaxCode: '010701', description: 'Serviços de outubro' },
    customer: { document: { type: 'NIF', value: '00-0000000' } },
  });
  expect(outcome.invoice.xml).toContain('<vServMoeda>1234.00</vServMoeda>');
  expect(outcome.invoice.xml).toContain('<cClassTrib>410027</cClassTrib>');
});

test('a resend of an issued DPS (E0014) ends issued through the lookup', async () => {
  await issuer.issue(request(2));
  const again = await issuer.issue(request(2));
  expect(again.kind).toBe('issued');
});

test('a timeout is uncertain, and findIssued then finds the invoice', async () => {
  fake.next('issue', { kind: 'delay', ms: 600 });
  expect((await issuer.issue(request(3))).kind).toBe('uncertain');
  const dpsId = issuer.dpsId('900', 3, templateXml);
  expect((await issuer.findIssued(dpsId))?.dps.number).toBe(3);
  expect(await issuer.findIssued(issuer.dpsId('900', 99, templateXml))).toBeNull();
});

test('an export template without a foreign amount is refused before sending', async () => {
  const { foreignAmountCents: _ignored, ...withoutForeign } = request(4);
  await expect(issuer.issue(withoutForeign)).rejects.toThrow(RangeError);
});

test('cancel registers the event and returns it parsed', async () => {
  const issued = await issuer.issue(request(5));
  if (issued.kind !== 'issued') throw new Error('not issued');
  const cancelled = await issuer.cancel(issued.invoice.accessKey, '1', 'Valor do serviço incorreto');
  expect(cancelled).toMatchObject({ kind: 'cancelled', event: { code: '101101', reasonCode: '1' } });
  expect(await issuer.cancel(issued.invoice.accessKey, '1', 'Valor do serviço incorreto')).toMatchObject({
    kind: 'rejected',
  });
});
```

Use static imports for `readFileSync` when you write the file. The fake's DPS reader takes the provider CNPJ and the municipality from the DPS, so the fixture's synthetic CNPJ works.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/fake-nacional/src/issuer.e2e.test.ts`
Expected: FAIL, `NacionalIssuer` is not exported.

- [ ] **Step 3: Implement**

`packages/core/src/ports/InvoiceIssuer.ts` with the types above, exported from `packages/core/src/index.ts`.

`packages/provider-nacional/src/template/applyTemplate.ts`:

```ts
import type { IssueRequest } from '@notaflow/core';
import type { DpsInput, Environment } from '../dps/types';
import type { DpsTemplate } from './readTemplate';

export function applyTemplate(
  template: DpsTemplate,
  request: IssueRequest & { environment: Environment; appVersion: string },
): DpsInput {
  const { serviceCents: _templateAmount, ...copy } = template;
  if (request.serviceCents <= 0) throw new RangeError('The service amount must be above zero.');
  const foreignTrade = copy.service.foreignTrade;
  if (foreignTrade && !request.foreignAmountCents) {
    throw new RangeError('An export invoice needs the amount in the foreign currency.');
  }
  return {
    ...copy,
    environment: request.environment,
    issuedAt: request.issuedAt,
    appVersion: request.appVersion,
    series: request.series,
    number: request.number,
    competence: request.competence,
    ...(request.customer ? { customer: toDpsCustomer(request.customer) } : {}),
    service: {
      ...copy.service,
      ...(request.description ? { description: request.description } : {}),
      ...(foreignTrade && request.foreignAmountCents
        ? { foreignTrade: { ...foreignTrade, amountInCurrencyCents: request.foreignAmountCents } }
        : {}),
    },
    amounts: { serviceCents: request.serviceCents },
  };
}
```

Write `toDpsCustomer(party: InvoiceParty): NonNullable<DpsInput['customer']>` in the same file: `party.document` must not be null (`RangeError` otherwise); a `domestic` address maps to `Address` (`zip` from `zip`), a `foreign` address maps to `ForeignAddress`.

`packages/provider-nacional/src/NacionalIssuer.ts`:

```ts
import type {
  CancelOutcome,
  CertificateMaterial,
  InvoiceIssuer,
  IssueOutcome,
  IssueRequest,
  ProviderInvoice,
} from '@notaflow/core';
import { NodeSigner } from '@notaflow/signer-node';
import { buildDpsId } from './dps/buildDpsId';
import { buildDpsXml } from './dps/buildDpsXml';
import type { Environment } from './dps/types';
import { buildCancelEventXml } from './events/buildCancelEventXml';
import { isDuplicateDps, type NacionalClient } from './http/NacionalClient';
import { parseEventXml } from './parse/parseEventXml';
import { parseNfseXml } from './parse/parseNfseXml';
import { applyTemplate } from './template/applyTemplate';
import { readTemplate } from './template/readTemplate';

export class NacionalIssuer implements InvoiceIssuer {
  private readonly signer = new NodeSigner();

  constructor(
    private readonly deps: {
      client: NacionalClient;
      certificate: CertificateMaterial;
      environment: Environment;
      appVersion: string;
    },
  ) {}

  dpsId(series: string, number: number, templateXml: string): string {
    const template = readTemplate(templateXml);
    return buildDpsId({ municipality: template.emitterMunicipality, cnpj: template.provider.cnpj, series, number });
  }

  async issue(request: IssueRequest): Promise<IssueOutcome> {
    const input = applyTemplate(readTemplate(request.templateXml), {
      ...request,
      environment: this.deps.environment,
      appVersion: this.deps.appVersion,
    });
    const { id, xml } = buildDpsXml(input);
    const signed = await this.signer.sign({
      xml,
      elementName: 'infDPS',
      certificate: this.deps.certificate,
      profile: 'rsa-sha256-exc-c14n',
    });
    const result = await this.deps.client.issue(signed);
    if (result.kind === 'issued') return { kind: 'issued', invoice: parseNfseXml(result.nfseXml) };
    if (result.kind === 'uncertain') return { kind: 'uncertain', reason: result.reason };
    if (isDuplicateDps(result.errors)) {
      const existing = await this.findIssued(id);
      return existing
        ? { kind: 'issued', invoice: existing }
        : { kind: 'uncertain', reason: 'E0014 but no NFS-e found for the DPS' };
    }
    return {
      kind: 'rejected',
      errors: result.errors.map((e) => ({ code: e.codigo, message: e.descricao })),
    };
  }

  async findIssued(dpsId: string): Promise<ProviderInvoice | null> {
    const lookup = await this.deps.client.findByDpsId(dpsId);
    if (lookup.kind === 'not_found') return null;
    return parseNfseXml(await this.deps.client.getNfse(lookup.accessKey));
  }

  async cancel(accessKey: string, reason: '1' | '2' | '9', justification: string): Promise<CancelOutcome> {
    const { xml } = buildCancelEventXml({
      environment: this.deps.environment,
      requestedAt: new Date(Date.now() - 60_000),
      appVersion: this.deps.appVersion,
      authorCnpj: this.deps.certificate.cnpj,
      accessKey,
      reason,
      justification,
    });
    const signed = await this.signer.sign({
      xml,
      elementName: 'infPedReg',
      certificate: this.deps.certificate,
      profile: 'rsa-sha256-exc-c14n',
    });
    const result = await this.deps.client.registerEvent(accessKey, signed);
    if (result.kind === 'rejected') {
      return { kind: 'rejected', error: { code: result.error.codigo, message: result.error.descricao } };
    }
    return { kind: 'cancelled', event: result.eventXml ? parseEventXml(result.eventXml) : null };
  }
}
```

Move `@notaflow/signer-node` from `devDependencies` to `dependencies` in `packages/provider-nacional/package.json` (the issuer signs at runtime) and run `pnpm install`. Export `NacionalIssuer` and `applyTemplate` from `src/index.ts`. Add `@notaflow/signer-node` and `@notaflow/test-kit` to the dev dependencies of `@notaflow/fake-nacional` if they are not there (they are, since Stage 1a-1).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages pnpm-lock.yaml
git commit -m "feat: InvoiceIssuer port and the national issuer with E0014 recovery and cancel"
```

---

### Task 4: PTAX exchange rate

**Files:**
- Create: `apps/server/src/exchange/ptax.ts`, `ptax.test.ts`

**Interfaces:**
- Produces:
  - `interface PtaxRate { currency: string; date: string; rateE4: number; source: 'PTAX venda, fechamento' }` (`rateE4` is the rate times 10 000)
  - `fetchPtaxSell(options: { currency: string; date: string; dispatcher?: Dispatcher; maxDaysBack?: number }): Promise<PtaxRate>` (`date` is `YYYY-MM-DD`; walks back day by day until a closing bulletin exists; default `maxDaysBack` 10)
  - `convertToCents(foreignCents: number, rateE4: number): number` (half away from zero)
  - `BACEN_CURRENCY: Record<string, string>` with `220: 'USD'` and `978: 'EUR'` (the `tpMoeda` codes the templates use)

The API is the public Olinda OData service of the Banco Central: `GET https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='USD'&@dataCotacao='MM-DD-YYYY'&$format=json`. The quotes in the query must be percent-encoded (`%27`). The closing bulletin has `tipoBoletim` `Fechamento PTAX`; use its `cotacaoVenda`.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/exchange/ptax.test.ts` (undici `MockAgent` at the HTTP boundary):

```ts
import { MockAgent } from 'undici';
import { beforeEach, expect, test } from 'vitest';
import { convertToCents, fetchPtaxSell } from './ptax';

const HOST = 'https://olinda.bcb.gov.br';
let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

function reply(date: string, bulletins: { tipoBoletim: string; cotacaoVenda: number }[]) {
  agent
    .get(HOST)
    .intercept({ path: (path) => path.includes(`dataCotacao=%27${date}%27`), method: 'GET' })
    .reply(200, { value: bulletins.map((b) => ({ ...b, cotacaoCompra: b.cotacaoVenda - 0.0006 })) });
}

test('takes the sell rate of the closing bulletin on the date', async () => {
  reply('08-31-2026', [
    { tipoBoletim: 'Abertura', cotacaoVenda: 5.1814 },
    { tipoBoletim: 'Fechamento PTAX', cotacaoVenda: 5.4321 },
  ]);
  expect(await fetchPtaxSell({ currency: 'USD', date: '2026-08-31', dispatcher: agent })).toEqual({
    currency: 'USD',
    date: '2026-08-31',
    rateE4: 54321,
    source: 'PTAX venda, fechamento',
  });
});

test('walks back to the last business day when the date has no closing bulletin', async () => {
  reply('08-30-2026', []);
  reply('08-29-2026', []);
  reply('08-28-2026', [{ tipoBoletim: 'Fechamento PTAX', cotacaoVenda: 5.2005 }]);
  expect(await fetchPtaxSell({ currency: 'USD', date: '2026-08-30', dispatcher: agent })).toMatchObject({
    date: '2026-08-28',
    rateE4: 52005,
  });
});

test('gives up after maxDaysBack', async () => {
  for (const d of ['10-10-2026', '10-09-2026']) reply(d, []);
  await expect(
    fetchPtaxSell({ currency: 'USD', date: '2026-10-10', dispatcher: agent, maxDaysBack: 1 }),
  ).rejects.toThrow(/PTAX/);
});

test('convertToCents: 1234.00 USD at 5.4321 is R$ 6703.21, rounded half up', () => {
  expect(convertToCents(123400, 54321)).toBe(670321);
  expect(convertToCents(1, 54321)).toBe(5);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/exchange`
Expected: FAIL, `./ptax` does not exist.

- [ ] **Step 3: Implement**

`apps/server/src/exchange/ptax.ts`:

```ts
import { type Dispatcher, request } from 'undici';

export const BACEN_CURRENCY: Record<string, string> = { '220': 'USD', '978': 'EUR' };

export interface PtaxRate {
  currency: string;
  date: string;
  rateE4: number;
  source: 'PTAX venda, fechamento';
}

const BASE =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)';

export async function fetchPtaxSell(options: {
  currency: string;
  date: string;
  dispatcher?: Dispatcher;
  maxDaysBack?: number;
}): Promise<PtaxRate> {
  const day = new Date(`${options.date}T12:00:00Z`);
  for (let back = 0; back <= (options.maxDaysBack ?? 10); back++) {
    const iso = day.toISOString().slice(0, 10);
    const [year, month, date] = iso.split('-');
    const url = `${BASE}?@moeda=%27${options.currency}%27&@dataCotacao=%27${month}-${date}-${year}%27&%24format=json`;
    const response = await request(url, {
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.body.json()) as { value?: { tipoBoletim: string; cotacaoVenda: number }[] };
    const closing = body.value?.find((bulletin) => bulletin.tipoBoletim === 'Fechamento PTAX');
    if (closing) {
      return {
        currency: options.currency,
        date: iso,
        rateE4: Math.round(closing.cotacaoVenda * 10_000),
        source: 'PTAX venda, fechamento',
      };
    }
    day.setUTCDate(day.getUTCDate() - 1);
  }
  throw new Error(`No PTAX closing rate for ${options.currency} up to ${options.date}.`);
}

export function convertToCents(foreignCents: number, rateE4: number): number {
  // Integer math: cents times the rate scaled by 10 000, rounded half away from zero.
  return Math.round((foreignCents * rateE4) / 10_000);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): PTAX sell closing rate with the last-business-day fallback"
```

---

### Task 5: DPS number reservation and the pending invoice row

**Files:**
- Modify: `apps/server/src/repos/EmitterRepository.ts`, `apps/server/src/repos/InvoiceRepository.ts`
- Create: `apps/server/src/repos/issueRepos.test.ts`

**Interfaces:**
- Produces:
  - `EmitterRepository.reserveDpsNumber(ctx, emitterId): number` (atomic `UPDATE ... SET next_dps_number = next_dps_number + 1 RETURNING`, returns the reserved number; throws when the emitter is not in the account)
  - `InvoiceRepository.createPending(ctx, input: { emitterId; dpsId; dpsSeries; dpsNumber; competence; serviceCents; description; customerId: string | null; customerDocument: string | null; customerName: string | null; serviceCode: string; environment; templateOf: string; createdBy: string }): string`
  - `InvoiceRepository.markIssued(ctx, invoiceId, invoice: ProviderInvoice): void` (fills the access key, number, issued at, the projection, and the gzip XML; status `issued`; links stored events)
  - `InvoiceRepository.markRejected(ctx, invoiceId, errors: { code: string; message: string }[]): void` (status `rejected`, `sefinMessages`)
  - `InvoiceRepository.markUnknown(ctx, invoiceId, reason: string): void` (status `unknown`, `sefinMessages: [{ code: 'uncertain', message: reason }]`)
  - `InvoiceRepository.issueState(ctx, invoiceId): { status; dpsId; dpsSeries; dpsNumber; emitterId; templateOf; competence; serviceCents; description; customerId } | null`

`invoices.dps_id` exists since Stage 1a-3. A pending row has no access key; the unique index on `access_key` allows many NULLs.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/repos/issueRepos.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedTenant } from '../../test/fixtures';
import { providerInvoice } from '../../test/providerData';
import { type Database, openDatabase } from '../db/openDatabase';
import { EmitterRepository } from './EmitterRepository';
import { InvoiceRepository } from './InvoiceRepository';

let db: Database;
let close: () => void;
beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

function setup() {
  const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
  const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
  const emitterId = new EmitterRepository(db).create(a, {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1',
    specialRegime: '0',
    dpsSeries: '900',
  }).id;
  return { a, b, emitterId };
}

test('reserveDpsNumber hands out 1, 2, 3 and never the same number twice', () => {
  const { a, b, emitterId } = setup();
  const emitters = new EmitterRepository(db);
  const numbers = [emitters.reserveDpsNumber(a, emitterId), emitters.reserveDpsNumber(a, emitterId), emitters.reserveDpsNumber(a, emitterId)];
  expect(numbers).toEqual([1, 2, 3]);
  expect(() => emitters.reserveDpsNumber(b, emitterId)).toThrow(/not found/);
});

test('a pending row becomes issued with the provider invoice', () => {
  const { a, emitterId } = setup();
  const invoices = new InvoiceRepository(db);
  const id = invoices.createPending(a, {
    emitterId,
    dpsId: 'DPS355030821234567800019500900000000000000042',
    dpsSeries: '900',
    dpsNumber: 42,
    competence: '2026-09-30',
    serviceCents: 150000,
    description: 'Consultoria',
    customerId: null,
    customerDocument: '98765432000110',
    customerName: 'Cliente Exemplo Ltda',
    serviceCode: '010101',
    environment: 'producao_restrita',
    templateOf: 'template-id',
    createdBy: a.userId,
  });
  expect(invoices.issueState(a, id)).toMatchObject({ status: 'pending', dpsNumber: 42 });
  invoices.markIssued(a, id, providerInvoice());
  expect(invoices.get(a, id)).toMatchObject({ status: 'issued', number: '42', origin: 'app' });
  expect(invoices.xml(a, id)).toBe('<NFSe>synthetic</NFSe>');
});

test('rejected and unknown keep the Sefin messages', () => {
  const { a, emitterId } = setup();
  const invoices = new InvoiceRepository(db);
  const base = {
    emitterId,
    dpsSeries: '900',
    competence: '2026-09-30',
    serviceCents: 150000,
    description: 'x',
    customerId: null,
    customerDocument: null,
    customerName: null,
    serviceCode: '010101',
    environment: 'producao_restrita' as const,
    templateOf: 't',
    createdBy: a.userId,
  };
  const rejected = invoices.createPending(a, { ...base, dpsId: 'D1', dpsNumber: 1 });
  invoices.markRejected(a, rejected, [{ code: 'E0001', message: 'Campo inválido' }]);
  expect(invoices.issueState(a, rejected)?.status).toBe('rejected');
  const unknown = invoices.createPending(a, { ...base, dpsId: 'D2', dpsNumber: 2 });
  invoices.markUnknown(a, unknown, 'timeout');
  expect(invoices.issueState(a, unknown)?.status).toBe('unknown');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/repos/issueRepos.test.ts`
Expected: FAIL, the methods do not exist.

- [ ] **Step 3: Implement**

In `EmitterRepository.ts`:

```ts
  reserveDpsNumber(ctx: AccountContext, emitterId: string): number {
    // One UPDATE ... RETURNING: SQLite runs it atomically, so two requests never get one number.
    const row = this.db
      .update(emitters)
      .set({ nextDpsNumber: sql`${emitters.nextDpsNumber} + 1` })
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .returning({ next: emitters.nextDpsNumber })
      .get();
    if (!row) throw new Error('Emitter not found in this account.');
    return row.next - 1;
  }
```

(import `sql` from `drizzle-orm`).

In `InvoiceRepository.ts`, add the five methods. `createPending` inserts with `status: 'pending'`, `origin: 'app'`, `accessKey: null`, `issCents: null`, `netCents: serviceCents`, and `xmlGzip: null`, after `requireEmitter`. `markIssued` updates the row (scoped by joining the emitter of `ctx.accountId`) with the same projection `upsertSynced` writes, plus `accessKey`, `status: 'issued'`, and then links events by access key, as `upsertSynced` does. `issueState` selects the listed columns scoped by account. Every method that writes first checks that the invoice belongs to `ctx.accountId` and throws `Invoice not found in this account.` otherwise.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): reserve DPS numbers and track pending, issued, rejected, and unknown invoices"
```

---

### Task 6: Issue service and the issue, draft, and exchange-rate routes

**Files:**
- Create: `apps/server/src/issue/IssueService.ts`
- Create: `apps/server/src/routes/issue.ts`, `apps/server/src/routes/issue.test.ts`
- Modify: `apps/server/src/providers/providerFactory.ts`, `apps/server/src/app.ts`, `apps/server/test/testApp.ts`, `apps/server/src/routes/routeSweep.test.ts`

**Interfaces:**
- Consumes: `InvoiceIssuer`, `IssueRequest`, `IssueOutcome` (Task 3); `readTemplate`, `TemplateUnsupportedError` (Task 2); `fetchPtaxSell`, `convertToCents`, `BACEN_CURRENCY` (Task 4); `reserveDpsNumber` and the invoice methods (Task 5); `VaultCertificateStore`, `CustomerRepository`, `AuditLog`, guards.
- Produces:
  - `type IssuerFactory = (input: { environment: Environment; certificate: CertificateMaterial }) => InvoiceIssuer`; `nacionalIssuerFactory(urls?: { sefin: string; adn: string }): IssuerFactory`; `AppDeps.issuerFactory?: IssuerFactory`; `AppDeps.ptax?: typeof fetchPtaxSell`
  - `class IssueService` with `issue(ctx, input): Promise<IssueResultView>`, `reconcile(ctx, invoiceId)`, `cancel(ctx, invoiceId, reason, justification)` (Tasks 6 to 8)
  - Routes:
    - `GET /api/accounts/:accountId/invoices/:invoiceId/draft` → `200 { templateInvoiceId, emitterId, competence, serviceCents, description, customer: InvoiceParty | null, foreign: { currency: 'USD' | ...; amountCents: number } | null }`; `422 template_unsupported { paths }`
    - `GET /api/accounts/:accountId/exchange-rate?currency=220&date=YYYY-MM-DD` → `200 { currency, date, rate: '5.4321', rateE4, source }`; `502 ptax_unavailable`
    - `POST /api/accounts/:accountId/invoices/issue` `{ templateInvoiceId, competence, serviceCents, foreignAmountCents?, description?, customerId? }` (write) → `201 { id, status: 'issued' | 'rejected' | 'unknown', number?, accessKey?, errors? }`; `422 template_unsupported`; `400 invalid_amount`, `400 competence_after_issue`

Issue flow (RFC "Send, protected against duplicates"):
1. Guard `write`. Load the template invoice (`invoices.get` + `xml`); 404 when it is not in the account; 409 `template_not_issued` unless its status is `issued` or `cancelled`.
2. Read the template (`readTemplate`); `TemplateUnsupportedError` → 422 with `paths` (Review Focus 3). Nothing is reserved yet.
3. Validate: `serviceCents > 0` (400 `invalid_amount`); the competence is not after today's Brasília date (400 `competence_after_issue`); an export template needs `foreignAmountCents > 0` (400 `invalid_amount`).
4. Customer: `customerId` given → the stored customer of this account (404 `customer_not_found`), turned into an `InvoiceParty`; else the template's customer.
5. In one transaction: `reserveDpsNumber`, compute the DPS id, `createPending`, audit `invoice.issue` with `detail: 'pending'`.
6. Load the active certificate; build the issuer for the emitter's environment; `issue(...)`.
7. `issued` → `markIssued` + upsert the customer through `CustomerRepository.upsertImported` (keeps the register current); `rejected` → `markRejected`; `uncertain` → `markUnknown`. Audit the result.
8. Answer `201` with the final status. A rejection is a normal answer (status `rejected` with `errors`), not an HTTP error: the row exists.

The draft route returns what the 1b-2 form pre-fills: the template's competence moved to the last day of the current month is a UI choice, so the route returns the template's own values and the UI decides.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/routes/issue.test.ts` uses the fake, a real test certificate, and a synced template invoice. Build the template on the fake with the export builder input of Task 2 (issue it on the fake with `NacionalClient`, then sync it), so the template is a real NFS-e of the fake:

```ts
import { makeTestCertificate } from '@notaflow/test-kit';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { issueExportOnFake } from '../../test/fakeInvoices';
import { seedTenant } from '../../test/fixtures';
import { createTestApp, type TestApp } from '../../test/testApp';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function withTemplate() {
  const a = seedTenant(t.db, { accountName: 'A', email: 'owner@example.com' });
  const cert = makeTestCertificate({ cnpj: '12345678000195' });
  const headers = await t.as('owner@example.com');
  const onboard = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/emitters`,
    headers,
    payload: {
      pfxBase64: cert.pfx.toString('base64'),
      password: cert.password,
      municipality: '4113700',
      simplesNacional: '3',
      simplesRegime: '1',
      specialRegime: '0',
      dpsSeries: '900',
    },
  });
  const emitterId = onboard.json<{ id: string }>().id;
  await issueExportOnFake(t.fake);
  await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`, headers, payload: {} });
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  const templateInvoiceId = list.json<{ items: { id: string }[] }>().items[0]?.id ?? '';
  expect(templateInvoiceId).not.toBe('');
  return { a, emitterId, headers, templateInvoiceId };
}

test('the draft copies the template and marks it as an export', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate();
  const draft = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/draft`, headers });
  expect(draft.json()).toMatchObject({
    templateInvoiceId,
    serviceCents: 1086420,
    foreign: { currency: 'USD', amountCents: 200000 },
    customer: { document: { type: 'NIF' } },
  });
});

test('issue similar: pending, then issued with a new DPS number and the new amounts', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate();
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 670321, foreignAmountCents: 123400, description: 'Serviços de setembro' },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ status: 'issued', accessKey: expect.any(String) });
  const { id } = response.json<{ id: string }>();
  const detail = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${id}`, headers });
  expect(detail.json()).toMatchObject({ status: 'issued', serviceCents: 670321, description: 'Serviços de setembro', origin: 'app' });
});

test('two issues at the same time get two different DPS numbers', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate();
  const payload = { templateInvoiceId, competence: '2026-09-30', serviceCents: 100, foreignAmountCents: 20 };
  const [one, two] = await Promise.all([
    t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/issue`, headers, payload }),
    t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/issue`, headers, payload }),
  ]);
  expect([one?.json().status, two?.json().status]).toEqual(['issued', 'issued']);
  expect(one?.json().accessKey).not.toBe(two?.json().accessKey);
});

test('a zero amount and a future competence are refused before anything is reserved', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate();
  const url = `/api/accounts/${a.accountId}/invoices/issue`;
  const zero = await t.app.inject({ method: 'POST', url, headers, payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 0, foreignAmountCents: 1 } });
  expect(zero.json()).toEqual({ error: 'invalid_amount' });
  const future = await t.app.inject({ method: 'POST', url, headers, payload: { templateInvoiceId, competence: '2999-01-31', serviceCents: 1, foreignAmountCents: 1 } });
  expect(future.json()).toEqual({ error: 'competence_after_issue' });
});

test('the exchange rate route returns the PTAX sell closing rate', async () => {
  const ptax = new MockAgent();
  ptax.disableNetConnect();
  ptax
    .get('https://olinda.bcb.gov.br')
    .intercept({ path: (p) => p.includes('08-31-2026'), method: 'GET' })
    .reply(200, { value: [{ tipoBoletim: 'Fechamento PTAX', cotacaoVenda: 5.4321, cotacaoCompra: 5.181 }] });
  const own = await createTestApp({ ptaxDispatcher: ptax });
  const a = seedTenant(own.db, { accountName: 'A', email: 'x@example.com' });
  const response = await own.app.inject({
    method: 'GET',
    url: `/api/accounts/${a.accountId}/exchange-rate?currency=220&date=2026-08-31`,
    headers: await own.as('x@example.com'),
  });
  await own.close();
  expect(response.json()).toEqual({ currency: 'USD', date: '2026-08-31', rate: '5.4321', rateE4: 54321, source: 'PTAX venda, fechamento' });
});
```

Add to `apps/server/test/fakeInvoices.ts` an `issueExportOnFake(fake)` that issues the Task 2 export `DpsInput` (unsigned) on the fake, and add `ptaxDispatcher?: Dispatcher` to `createTestApp` options, passed to `buildApp` as `ptaxDispatcher`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/routes/issue.test.ts`
Expected: FAIL with 404 on the new routes.

- [ ] **Step 3: Implement**

- `providerFactory.ts`: `nacionalIssuerFactory(urls?)` returns `new NacionalIssuer({ client: new NacionalClient({ environment, dispatcher: createMtlsDispatcher(certificate), ...(urls ? { urls } : {}) }), certificate, environment, appVersion: 'notaflow-1b' })`.
- `IssueService.ts` holds the flow above, with the repositories, the certificate store, the issuer factory, and the audit log; `issue` returns `{ id, status, number?, accessKey?, errors? }`.
- `routes/issue.ts` registers the three routes with JSON schemas (`competence` pattern `^\d{4}-\d{2}-\d{2}$`, `serviceCents` and `foreignAmountCents` integers `>= 0`, `description` up to 2000 characters), maps `TemplateUnsupportedError` to `422 { error: 'template_unsupported', paths }`, and maps any `fetchPtaxSell` failure to `502 ptax_unavailable`.
- `app.ts`: build the issue service with `deps.issuerFactory ?? nacionalIssuerFactory(config.nacionalUrls)` and register the routes; pass `deps.ptaxDispatcher` to the exchange-rate route.
- `routeSweep.test.ts`: the new routes use `:accountId` and `:invoiceId`, already in its map; nothing else to add.

`HttpError` has no room for `paths`; add an optional `extra?: Record<string, unknown>` to `HttpError` and spread it into the error body in `handleError`, with a test in `app.test.ts` first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): issue similar with a reserved DPS number, a draft, and the PTAX rate"
```

---

### Task 7: Reconciliation of unknown invoices

**Files:**
- Modify: `apps/server/src/issue/IssueService.ts`, `apps/server/src/routes/issue.ts`
- Create: `apps/server/src/routes/reconcile.test.ts`

**Interfaces:**
- Produces: `POST /api/accounts/:accountId/invoices/:invoiceId/reconcile` (write) → `200 { id, status, accessKey? }`; `409 not_unknown` when the invoice is not `unknown` or `pending`.

Rules (RFC "Uncertain result"):
1. `findIssued(dpsId)` → found → `markIssued`, audit `invoice.reconcile` `found`.
2. Not found → resend the **same** DPS (same series and number, a fresh `dhEmi`) through `issue`; the outcome updates the row as in Task 6; audit `invoice.reconcile` `resent`.
3. Still uncertain → stays `unknown`.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/routes/reconcile.test.ts` (reuse `withTemplate` by moving it to `apps/server/test/issueSetup.ts` in this step, imported by both files):

```ts
test('a timeout leaves the invoice unknown; reconcile finds it, with no second NFS-e', async () => {
  const { a, emitterId, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'delay', ms: 600 });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 1000, foreignAmountCents: 200 },
  });
  expect(issued.json()).toMatchObject({ status: 'unknown' });
  const { id } = issued.json<{ id: string }>();
  const reconciled = await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`, headers, payload: {} });
  expect(reconciled.json()).toMatchObject({ id, status: 'issued', accessKey: expect.any(String) });
  // A blind resend would have made a second NFS-e; the feed must hold the template and one new invoice.
  await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/emitters/${emitterId}/sync`, headers, payload: {} });
  const list = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices`, headers });
  expect(list.json()).toMatchObject({ total: 2 });
});

test('when the Sefin never stored it, reconcile resends the same DPS number', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('issue', { kind: 'reply', status: 503, body: 'down' });
  const issued = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/issue`,
    headers,
    payload: { templateInvoiceId, competence: '2026-09-30', serviceCents: 1000, foreignAmountCents: 200 },
  });
  const { id } = issued.json<{ id: string }>();
  expect(issued.json().status).toBe('unknown');
  const reconciled = await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/${id}/reconcile`, headers, payload: {} });
  expect(reconciled.json()).toMatchObject({ status: 'issued' });
});

test('reconcile of an issued invoice is 409 not_unknown', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({ method: 'POST', url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/reconcile`, headers, payload: {} });
  expect(response.statusCode).toBe(409);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/routes/reconcile.test.ts`
Expected: FAIL with 404 on the reconcile route.

- [ ] **Step 3: Implement** `IssueService.reconcile` and the route as described.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): reconcile unknown invoices by DPS id, resending only when none exists"
```

---

### Task 8: Cancel

**Files:**
- Modify: `apps/server/src/issue/IssueService.ts`, `apps/server/src/routes/issue.ts`
- Create: `apps/server/src/routes/cancel.test.ts`

**Interfaces:**
- Produces: `POST /api/accounts/:accountId/invoices/:invoiceId/cancel` `{ reason: '1' | '2' | '9', justification }` (write; 15 to 255 characters after trimming) → `200 { id, status: 'cancelled' }`; `409 not_issued`; `422 { error: 'sefin_rejected', code, message }`.

Rules (RFC "Flow: cancel"): the invoice must be `issued`; the issuer runs in the invoice's environment; a registered event is stored with `recordEvent` (when the Sefin returned it) and the invoice becomes `cancelled`; a rejection keeps the invoice `issued`. Audit `invoice.cancel` with the result.

- [ ] **Step 1: Write the failing tests**

```ts
test('cancel stores the event and the invoice becomes cancelled', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const url = `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`;
  const response = await t.app.inject({ method: 'POST', url, headers, payload: { reason: '1', justification: 'Valor do serviço incorreto' } });
  expect(response.json()).toEqual({ id: templateInvoiceId, status: 'cancelled' });
  const detail = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}`, headers });
  expect(detail.json()).toMatchObject({ status: 'cancelled', events: [{ code: '101101', reasonCode: '1' }] });
});

test('a second cancel is 409 not_issued', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const url = `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`;
  const payload = { reason: '1', justification: 'Valor do serviço incorreto' };
  await t.app.inject({ method: 'POST', url, headers, payload });
  expect((await t.app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(409);
});

test('a Sefin rejection keeps the invoice issued and returns the Sefin message', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  t.fake.next('event', { kind: 'reply', status: 400, body: { erro: { Codigo: 'E1235', Descricao: 'Prazo de cancelamento expirado' } } });
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`,
    headers,
    payload: { reason: '1', justification: 'Valor do serviço incorreto' },
  });
  expect(response.statusCode).toBe(422);
  expect(response.json()).toEqual({ error: 'sefin_rejected', code: 'E1235', message: 'Prazo de cancelamento expirado' });
});

test('a short justification is 400', async () => {
  const { a, headers, templateInvoiceId } = await withTemplate(t);
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/accounts/${a.accountId}/invoices/${templateInvoiceId}/cancel`,
    headers,
    payload: { reason: '1', justification: 'curta' },
  });
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run, fail, implement, run, pass** as in the earlier tasks.

Run: `pnpm vitest run apps/server/src/routes/cancel.test.ts` → FAIL (404); implement; `pnpm vitest run apps/server && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server
git commit -m "feat(server): cancel an issued invoice and store the cancellation event"
```

---

### Task 9: Customer detail and edit by hand

**Files:**
- Modify: `apps/server/src/repos/CustomerRepository.ts`, `apps/server/src/routes/customers.ts`
- Create: `apps/server/src/routes/customers.test.ts`
- Modify: `apps/server/src/routes/routeSweep.test.ts` (`:customerId`)

**Interfaces:**
- Produces:
  - `CustomerRepository.get(ctx, customerId)` (public now) and `setManual` extended to `address`
  - `GET /api/accounts/:accountId/customers/:customerId` → `200` (without `manualFields`), `404`
  - `PUT /api/accounts/:accountId/customers/:customerId` `{ name?, email?, phone?, municipalRegistration?, address? }` (write) → `200` the updated customer; every field sent becomes a manual field (RFC: never overwritten by the sync); audit `customer.edit`

- [ ] **Step 1: Write the failing tests** for: an edit sticks and survives a re-sync of the same invoice (`upsertImported` keeps the manual value); another account gets 404; a member can edit (write, not owner-only); a suspended account cannot.

- [ ] **Step 2: Run, fail, implement, run, pass.** Add `customerId` to the sweep's parameter map (create one customer in `beforeAll` through `CustomerRepository.upsertImported`).

- [ ] **Step 3: Commit**

```bash
git add apps/server
git commit -m "feat(server): customer detail and edits by hand that the sync never overwrites"
```

---

### Task 10: Docs, the real-template check, and the RFC

**Files:**
- Create: `docs/ENGINEERING/ARCHITECTURE/INVOICE_LIFECYCLE.md`
- Create: `spikes/2026-10-template-check/run.ts` (read-only, local database)
- Modify: `docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md`, `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md`, `apps/server/AGENTS.md`, root `package.json`

- [ ] **Step 1: Run the whole suite**

Run: `pnpm test && pnpm typecheck && pnpm lint && pytest services/signer-py`
Expected: PASS.

- [ ] **Step 2: Check the template reader on the real invoices (local only)**

`spikes/2026-10-template-check/run.ts` opens `apps/server/data/notaflow.db` read-only, reads every stored invoice XML, runs `readTemplate`, and prints only `number: ok` or `number: unsupported <paths>`. It also rebuilds each template with `buildDpsXml` and the invoice's own per-issue values and prints `round trip: same` or `differs`. It prints no amount, key, or name. Add the root script `"spike:template-check": "tsx spikes/2026-10-template-check/run.ts"`.

Run: `pnpm spike:template-check`
Expected: every production invoice of the emitter prints `ok` and `same`. If one is `unsupported`, add the field to the builder and the reader (with a synthetic fixture and a test first) before Stage 1b-2.

- [ ] **Step 3: Write the docs**

`INVOICE_LIFECYCLE.md`: the status diagram of the RFC, the issue flow (reserve, pending, send, outcome), reconciliation rules, cancel, E0014, the template rule (copy every group, refuse unknown fields), and the PTAX rule with the evidence from the August invoice.

In the RFC: mark the DPS-reuse question still open (no evidence yet); in "Signer decision" nothing changes; in "Flow: issue a new invoice" add one line that the export BRL amount is suggested from the PTAX sell closing rate of the competence date and stays editable; in "Packages" add the `InvoiceIssuer` port to `core`.

- [ ] **Step 4: Commit**

```bash
git add docs apps/server/AGENTS.md spikes/2026-10-template-check package.json
git commit -m "docs: invoice lifecycle, the PTAX rule, and the real-template check"
```
