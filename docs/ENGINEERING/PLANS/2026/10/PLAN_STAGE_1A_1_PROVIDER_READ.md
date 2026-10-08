# Stage 1a-1 (Provider Read Side and Fake Sefin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the server (Stage 1a-2 and 1a-3) a tested `InvoiceProvider` that reads invoices and events from the national system, and a local fake of the Sefin and the ADN to develop and test against without a real certificate.

**Architecture:** `core` gets the read-side domain types (`ProviderInvoice`, `ProviderEvent`, `SyncBatch`) and the `InvoiceProvider` port. `provider-nacional` gets an XML reader on `@xmldom/xmldom`, a parser for the NFS-e and the event XML, and `NacionalProvider`, which maps ADN batches to `SyncBatch`. A new package `fake-nacional` is an in-memory HTTP server with the same routes and response shapes as the Sefin and the ADN, plus a way to force a scenario (timeout, 429, a fixed reply). The last task reads the real production ADN, read-only, with Lincoln's certificate, to prove the parser on real invoices.

**Tech Stack:** Node 22 or later, pnpm 10, TypeScript 5, Vitest 3, `undici` 7, `@xmldom/xmldom` 0.9, `node:http`.

**Spec:** [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md), sections "Flow: sync from the ADN", "Flow: find by access key", "Data Model", "Testing", and "Stage 0 Results".

**Stage 1a split:** Stage 1a has three plans. This plan (1a-1) is the provider read side and the fake. Plan 1a-2 is the server foundation: database, authentication, accounts, roles, the certificate vault, and the audit log. Plan 1a-3 is the sync job, the read API, the UI, and the admin panel. Plans 1a-2 and 1a-3 start from the interfaces this plan produces.

## Global Constraints

- Never use TypeScript non-null assertions (`value!`). ESLint enforces it.
- A credential never enters git. Tests use `@notaflow/test-kit` certificates and synthetic data. The test CNPJ is `12345678000195`. No real invoice XML, access key, NIF, or customer data enters the repository.
- Amounts are integer cents in code. Only XML builders and parsers convert to and from decimal strings.
- A CNPJ is a 14-character string `[0-9A-Z]`.
- `core` does not import XML, HTTP, database, or Node-only modules.
- Every XML builder validates against the vendored XSD in a test.
- Scripts must run on Windows and Linux. No `VAR=value cmd` prefixes.
- Comments are a budget: one line, only the non-obvious why.
- Docs are in English, follow the writing standard, and contain no em dash character.
- Commits carry no AI attribution. Never pass `--no-verify`. The pre-commit hook runs `gitleaks`; on Lincoln's Windows machine, add its folder to `PATH` first (see the Stage 0 ledger).
- The fake runs only on `127.0.0.1` and is never part of a production build.

## Review Focus

1. An ADN document whose XML does not parse (a new layout, a truncated file). Expected: the batch keeps the other documents, the bad one becomes `skipped` with the reason, and the cursor still moves, so the sync never stops on one document. Pinned in Task 4.
2. The ADN answers `/DFe/{NSU}` inclusive of `NSU` (the manual is not clear). Expected: no document comes back twice, and a batch that holds only the last NSU again reports `hasMore: false`, so the sync does not loop. Pinned in Task 4.
3. An invoice whose customer has no document (`cNaoNIF`) or no `toma` group at all. Expected: `customer.document` is `null`, or `customer` is `null`; the parser does not throw. Pinned in Task 2.
4. An invoice where the emitter is the customer (a received invoice) in the emitter's ADN feed. Expected: `skipped` with reason `received invoice`, as the RFC says for Stage 1. Pinned in Task 4.
5. A description with accents and XML entities (`Consultoria em análise & ção <teste>`) through issue, the fake, the ADN feed, and the parser. Expected: the parsed description equals the input. Pinned in Task 7.

---

## File Structure

```
packages/core/src/
  index.ts                               exports the new types and the port
  domain/ProviderInvoice.ts              Environment, ProviderInvoice, InvoiceParty, PartyAddress, ProviderEvent
  ports/InvoiceProvider.ts               SyncDocument, SyncBatch, InvoiceProvider
packages/provider-nacional/
  package.json                           adds @xmldom/xmldom
  src/index.ts                           exports the parser, NacionalProvider, NfseParseError
  src/dps/types.ts                       Environment now comes from core
  src/xml/formatters.ts                  adds decimalToCents
  src/xml/readXml.ts                     NfseParseError and namespace-aware element helpers
  src/parse/parseNfseXml.ts              NFS-e XML to ProviderInvoice
  src/parse/parseEventXml.ts             event XML to ProviderEvent
  src/http/NacionalClient.ts             optional urls override
  src/NacionalProvider.ts                InvoiceProvider for the national system
  test/fixtures/NFSE_DOMESTIC.xml        synthetic NFS-e, domestic customer
  test/fixtures/NFSE_EXPORT.xml          synthetic NFS-e, foreign customer
  test/fixtures/EVENT_CANCEL.xml         synthetic cancellation event
  test/fixtures.ts                       reads a fixture file
packages/fake-nacional/
  package.json, tsconfig.json, AGENTS.md
  src/index.ts                           startFakeNacional and the types
  src/fakeXml.ts                         reads the DPS, builds the NFS-e and the event XML
  src/startFakeNacional.ts               the HTTP server, the store, the scenario queue
  src/cli.ts                             pnpm fake:nacional
  src/testData.ts                        dpsInput shared by the fake tests
  src/startFakeNacional.test.ts          the fake, through the real NacionalClient
  src/provider.e2e.test.ts               NacionalProvider against the fake
spikes/2026-10-adn-read/run.ts           read-only production ADN check (Lincoln runs it)
```

---

### Task 1: Read-side domain types and the `InvoiceProvider` port

**Files:**
- Create: `packages/core/src/domain/ProviderInvoice.ts`
- Create: `packages/core/src/ports/InvoiceProvider.ts`
- Create: `packages/core/src/ports/InvoiceProvider.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/provider-nacional/src/dps/types.ts:1`
- Modify: `packages/core/AGENTS.md`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `@notaflow/core`):
  - `type Environment = 'producao' | 'producao_restrita'`
  - `type PartyDocument = { type: 'CNPJ' | 'CPF' | 'NIF'; value: string }`
  - `type PartyAddress = DomesticAddress | ForeignPartyAddress` (fields below)
  - `interface InvoiceParty { document: PartyDocument | null; name: string; municipalRegistration?: string; address?: PartyAddress; email?: string; phone?: string }`
  - `interface ProviderInvoice` (fields below)
  - `interface ProviderEvent { accessKey: string; code: string; registeredAt: Date; reasonCode?: string; justification?: string; xml: string }`
  - `type SyncDocument`, `interface SyncBatch { documents: SyncDocument[]; lastNsu: number; hasMore: boolean }`
  - `interface InvoiceProvider { checkConnection(municipality: string): Promise<void>; fetchSince(nsu: number): Promise<SyncBatch>; getInvoice(accessKey: string): Promise<ProviderInvoice | null> }`
  - `function isSyncInvoice(document: SyncDocument): document is Extract<SyncDocument, { kind: 'invoice' }>`

`core` has no runtime code yet except this type guard, which gives the task a test.

- [ ] **Step 1: Write the failing test**

`packages/core/src/ports/InvoiceProvider.test.ts`:

```ts
import { expect, test } from 'vitest';
import { isSyncInvoice, type SyncDocument } from '../index';

test('isSyncInvoice tells an invoice document from an event and a skipped one', () => {
  const documents: SyncDocument[] = [
    { kind: 'skipped', nsu: 1, reason: 'received invoice' },
    {
      kind: 'event',
      nsu: 2,
      event: { accessKey: 'K', code: '101101', registeredAt: new Date(0), xml: '<evento/>' },
    },
  ];
  expect(documents.filter(isSyncInvoice)).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core`
Expected: FAIL, `isSyncInvoice` is not exported.

- [ ] **Step 3: Write the types and the guard**

`packages/core/src/domain/ProviderInvoice.ts`:

```ts
export type Environment = 'producao' | 'producao_restrita';

export interface PartyDocument {
  type: 'CNPJ' | 'CPF' | 'NIF';
  value: string;
}

export interface DomesticAddress {
  kind: 'domestic';
  municipality: string; // IBGE, 7 digits
  zip: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export interface ForeignPartyAddress {
  kind: 'foreign';
  country: string; // ISO 3166-1 alpha-2
  postalCode: string;
  city: string;
  region: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export type PartyAddress = DomesticAddress | ForeignPartyAddress;

export interface InvoiceParty {
  // null when the invoice says the customer has no document (cNaoNIF).
  document: PartyDocument | null;
  name: string;
  municipalRegistration?: string;
  address?: PartyAddress;
  email?: string;
  phone?: string;
}

// An invoice as the provider reports it. The XML is the source of truth; the rest is a projection.
export interface ProviderInvoice {
  accessKey: string;
  number: string;
  environment: Environment;
  issuedAt: Date;
  competence: string; // YYYY-MM-DD
  dps: { id: string; series: string; number: number };
  provider: { cnpj: string; name: string };
  customer: InvoiceParty | null;
  service: { nationalTaxCode: string; description: string; nbsCode?: string };
  amounts: { serviceCents: number; issCents?: number; netCents: number };
  xml: string;
}

export interface ProviderEvent {
  accessKey: string;
  code: string; // 101101 = cancellation
  registeredAt: Date;
  reasonCode?: string;
  justification?: string;
  xml: string;
}
```

`packages/core/src/ports/InvoiceProvider.ts`:

```ts
import type { ProviderEvent, ProviderInvoice } from '../domain/ProviderInvoice';

export type SyncDocument =
  | { kind: 'invoice'; nsu: number; invoice: ProviderInvoice }
  | { kind: 'event'; nsu: number; event: ProviderEvent }
  | { kind: 'skipped'; nsu: number; reason: string };

export interface SyncBatch {
  documents: SyncDocument[];
  // The cursor to store with this batch; equal to the input NSU when the batch is empty.
  lastNsu: number;
  hasMore: boolean;
}

export interface InvoiceProvider {
  checkConnection(municipality: string): Promise<void>;
  fetchSince(nsu: number): Promise<SyncBatch>;
  getInvoice(accessKey: string): Promise<ProviderInvoice | null>;
}

export function isSyncInvoice(
  document: SyncDocument,
): document is Extract<SyncDocument, { kind: 'invoice' }> {
  return document.kind === 'invoice';
}
```

`packages/core/src/index.ts`:

```ts
export type {
  DomesticAddress,
  Environment,
  ForeignPartyAddress,
  InvoiceParty,
  PartyAddress,
  PartyDocument,
  ProviderEvent,
  ProviderInvoice,
} from './domain/ProviderInvoice';
export { isSyncInvoice } from './ports/InvoiceProvider';
export type { InvoiceProvider, SyncBatch, SyncDocument } from './ports/InvoiceProvider';
export type { CertificateMaterial, SignatureProfile, SignRequest, Signer } from './ports/Signer';
```

In `packages/provider-nacional/src/dps/types.ts`, replace line 1 (`export type Environment = 'producao' | 'producao_restrita';`) with:

```ts
import type { Environment } from '@notaflow/core';

export type { Environment };
```

In `packages/core/AGENTS.md`, replace the "Ports" line with:

```markdown
- Ports: `Signer` (`src/ports/Signer.ts`), `InvoiceProvider` (`src/ports/InvoiceProvider.ts`, read side). `CertificateStore` arrives in Stage 1a-2.
- Domain: `ProviderInvoice`, `ProviderEvent`, `InvoiceParty` (`src/domain/ProviderInvoice.ts`).
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS, and `tsc` reports no error in any package (the provider still builds with `Environment` from `core`).

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/provider-nacional/src/dps/types.ts
git commit -m "feat(core): read-side invoice types and the InvoiceProvider port"
```

---

### Task 2: Parse the NFS-e XML into `ProviderInvoice`

**Files:**
- Modify: `packages/provider-nacional/package.json` (add `@xmldom/xmldom`)
- Modify: `packages/provider-nacional/src/xml/formatters.ts`, `src/xml/formatters.test.ts`
- Create: `packages/provider-nacional/src/xml/readXml.ts`
- Create: `packages/provider-nacional/src/parse/parseNfseXml.ts`
- Create: `packages/provider-nacional/src/parse/parseNfseXml.test.ts`
- Create: `packages/provider-nacional/test/fixtures.ts`
- Create: `packages/provider-nacional/test/fixtures/NFSE_DOMESTIC.xml`, `NFSE_EXPORT.xml`
- Modify: `packages/provider-nacional/src/index.ts`

**Interfaces:**
- Consumes: `ProviderInvoice`, `InvoiceParty`, `PartyAddress`, `Environment` from `@notaflow/core` (Task 1).
- Produces:
  - `decimalToCents(value: string): number` (throws `RangeError`)
  - `class NfseParseError extends Error`
  - `parseXmlRoot(xml: string, rootName: string): Element`, `child(parent: Element, name: string): Element | undefined`, `childElements(parent: Element): Element[]`, `text(parent: Element, ...names: string[]): string | undefined`, `requiredText(parent: Element, ...names: string[]): string`, `requiredChild(parent: Element, ...names: string[]): Element` (all in `src/xml/readXml.ts`)
  - `parseNfseXml(xml: string): ProviderInvoice`
  - `readFixture(name: string): string` (test helper in `test/fixtures.ts`)

The fixtures copy the shape of a real national NFS-e (Stage 0 run 2): `infNFSe` holds the Sefin fields and the original `DPS`. All data is synthetic.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @notaflow/provider-nacional add @xmldom/xmldom@^0.9.6`
Expected: `package.json` lists `"@xmldom/xmldom": "^0.9.6"` under `dependencies`.

- [ ] **Step 2: Write the failing tests for `decimalToCents`**

Append to `packages/provider-nacional/src/xml/formatters.test.ts` and add `decimalToCents` to its import from `./formatters`:

```ts
test.each([
  ['0.00', 0],
  ['10', 1000],
  ['10.5', 1050],
  ['18135.60', 1813560],
  ['1234567.89', 123456789],
])('decimalToCents(%s) = %i', (value, cents) => {
  expect(decimalToCents(value)).toBe(cents);
});

test('decimalToCents rejects a value that is not a non-negative decimal with up to 2 places', () => {
  for (const value of ['', '-1.00', '1.234', 'abc', '1,50']) {
    expect(() => decimalToCents(value)).toThrow(RangeError);
  }
});
```

- [ ] **Step 3: Write the fixtures and the failing parser tests**

`packages/provider-nacional/test/fixtures.ts`:

```ts
import { readFileSync } from 'node:fs';

export function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}
```

`packages/provider-nacional/test/fixtures/NFSE_DOMESTIC.xml` (one line in the file is fine; it is shown wrapped here):

```xml
<?xml version="1.0" encoding="utf-8"?><NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS35503082212345678000195000000000004226100000000420"><xLocEmi>São Paulo</xLocEmi><nNFSe>42</nNFSe><cStat>100</cStat><dhProc>2026-10-01T10:00:00-03:00</dhProc><emit><CNPJ>12345678000195</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></emit><valores><vISSQN>30.00</vISSQN><vLiq>1470.00</vLiq></valores><DPS versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infDPS Id="DPS355030821234567800019500900000000000000042"><tpAmb>2</tpAmb><dhEmi>2026-10-01T10:00:00-03:00</dhEmi><verAplic>notaflow-0.0.0</verAplic><serie>900</serie><nDPS>42</nDPS><dCompet>2026-09-30</dCompet><tpEmit>1</tpEmit><cLocEmi>3550308</cLocEmi><prest><CNPJ>12345678000195</CNPJ><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest><toma><CNPJ>98765432000110</CNPJ><IM>7654321</IM><xNome>Cliente Exemplo &amp; Filhos Ltda</xNome><end><endNac><cMun>3550308</cMun><CEP>01310100</CEP></endNac><xLgr>Av. Paulista</xLgr><nro>1000</nro><xCpl>Sala 1</xCpl><xBairro>Bela Vista</xBairro></end><fone>11999990000</fone><email>financeiro@example.com</email></toma><serv><locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest><cServ><cTribNac>010101</cTribNac><xDescServ>Consultoria em análise &amp; ção &lt;teste&gt;</xDescServ><cNBS>115022000</cNBS></cServ></serv><valores><vServPrest><vServ>1500.00</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores></infDPS></DPS></infNFSe></NFSe>
```

`packages/provider-nacional/test/fixtures/NFSE_EXPORT.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?><NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS41137002212345678000195000000000000726100000000070"><xLocEmi>Londrina</xLocEmi><nNFSe>7</nNFSe><cStat>100</cStat><dhProc>2026-10-02T09:30:00-03:00</dhProc><emit><CNPJ>12345678000195</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></emit><valores><vLiq>1000.00</vLiq></valores><IBSCBS><cLocalidadeIncid>9999999</cLocalidadeIncid><valores><vBC>1000.00</vBC></valores></IBSCBS><DPS versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infDPS Id="DPS411370021234567800019500900000000000000007"><tpAmb>1</tpAmb><dhEmi>2026-10-02T09:30:00-03:00</dhEmi><verAplic>notaflow-0.0.0</verAplic><serie>900</serie><nDPS>7</nDPS><dCompet>2026-09-30</dCompet><tpEmit>1</tpEmit><cLocEmi>4113700</cLocEmi><prest><CNPJ>12345678000195</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest><toma><NIF>00-0000000</NIF><xNome>Foreign Customer Inc</xNome><end><endExt><cPais>US</cPais><cEndPost>99999</cEndPost><xCidade>Testville</xCidade><xEstProvReg>NY</xEstProvReg></endExt><xLgr>1 Example Street</xLgr><nro>1</nro><xBairro>Downtown</xBairro></end></toma><serv><locPrest><cLocPrestacao>4113700</cLocPrestacao></locPrest><cServ><cTribNac>010701</cTribNac><xDescServ>Serviços de TI para tomador no exterior</xDescServ><cNBS>115080000</cNBS></cServ></serv><valores><vServPrest><vServ>1000.00</vServ></vServPrest><trib><tribMun><tribISSQN>3</tribISSQN><cPaisResult>US</cPaisResult><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores></infDPS></DPS></infNFSe></NFSe>
```

`packages/provider-nacional/src/parse/parseNfseXml.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { NfseParseError } from '../xml/readXml';
import { parseNfseXml } from './parseNfseXml';

describe('parseNfseXml', () => {
  test('reads a domestic invoice', () => {
    const xml = readFixture('NFSE_DOMESTIC.xml');
    expect(parseNfseXml(xml)).toEqual({
      accessKey: '35503082212345678000195000000000004226100000000420',
      number: '42',
      environment: 'producao_restrita',
      issuedAt: new Date('2026-10-01T13:00:00Z'),
      competence: '2026-09-30',
      dps: { id: 'DPS355030821234567800019500900000000000000042', series: '900', number: 42 },
      provider: { cnpj: '12345678000195', name: 'EMPRESA TESTE LTDA' },
      customer: {
        document: { type: 'CNPJ', value: '98765432000110' },
        name: 'Cliente Exemplo & Filhos Ltda',
        municipalRegistration: '7654321',
        address: {
          kind: 'domestic',
          municipality: '3550308',
          zip: '01310100',
          street: 'Av. Paulista',
          number: '1000',
          complement: 'Sala 1',
          district: 'Bela Vista',
        },
        email: 'financeiro@example.com',
        phone: '11999990000',
      },
      service: {
        nationalTaxCode: '010101',
        description: 'Consultoria em análise & ção <teste>',
        nbsCode: '115022000',
      },
      amounts: { serviceCents: 150000, issCents: 3000, netCents: 147000 },
      xml,
    });
  });

  test('reads an export invoice with a foreign customer and no ISS', () => {
    const invoice = parseNfseXml(readFixture('NFSE_EXPORT.xml'));
    expect(invoice.environment).toBe('producao');
    expect(invoice.customer).toEqual({
      document: { type: 'NIF', value: '00-0000000' },
      name: 'Foreign Customer Inc',
      address: {
        kind: 'foreign',
        country: 'US',
        postalCode: '99999',
        city: 'Testville',
        region: 'NY',
        street: '1 Example Street',
        number: '1',
        district: 'Downtown',
      },
    });
    expect(invoice.amounts).toEqual({ serviceCents: 100000, netCents: 100000 });
  });

  test('a customer with cNaoNIF has a null document', () => {
    const xml = readFixture('NFSE_EXPORT.xml').replace(
      '<NIF>00-0000000</NIF>',
      '<cNaoNIF>1</cNaoNIF>',
    );
    expect(parseNfseXml(xml).customer?.document).toBeNull();
  });

  test('an invoice without a toma group has a null customer', () => {
    const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<toma>.*<\/toma>/, '');
    expect(parseNfseXml(xml).customer).toBeNull();
  });

  test('throws NfseParseError for XML that is not an NFS-e', () => {
    expect(() => parseNfseXml('<other/>')).toThrow(NfseParseError);
    expect(() => parseNfseXml('not xml at all <')).toThrow(NfseParseError);
  });

  test('throws NfseParseError when a required field is missing', () => {
    const xml = readFixture('NFSE_DOMESTIC.xml').replace('<nNFSe>42</nNFSe>', '');
    expect(() => parseNfseXml(xml)).toThrow(/nNFSe/);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm vitest run packages/provider-nacional/src/xml packages/provider-nacional/src/parse`
Expected: FAIL, `decimalToCents`, `./parseNfseXml`, and `../xml/readXml` do not exist.

- [ ] **Step 5: Implement `decimalToCents`**

Append to `packages/provider-nacional/src/xml/formatters.ts`:

```ts
export function decimalToCents(value: string): number {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) throw new RangeError(`Invalid decimal amount: ${value}`);
  const [, units = '0', fraction = ''] = match;
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'));
}
```

- [ ] **Step 6: Implement the XML reader**

`packages/provider-nacional/src/xml/readXml.ts`:

```ts
import { DOMParser, type Element } from '@xmldom/xmldom';
import { NFSE_NAMESPACE } from '../dps/buildDpsXml';

export class NfseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NfseParseError';
  }
}

export function parseXmlRoot(xml: string, rootName: string): Element {
  let root: Element | null;
  try {
    const parser = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message);
      },
    });
    root = parser.parseFromString(xml, 'text/xml').documentElement;
  } catch (error) {
    throw new NfseParseError(`Invalid XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!root || root.localName !== rootName || root.namespaceURI !== NFSE_NAMESPACE) {
    throw new NfseParseError(`Expected <${rootName}> in the NFS-e namespace.`);
  }
  return root;
}

// Direct children only: names such as CNPJ and valores repeat at several depths.
export function childElements(parent: Element): Element[] {
  const result: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    const element = node as Element;
    if (node.nodeType === 1 && element.namespaceURI === NFSE_NAMESPACE) result.push(element);
  }
  return result;
}

export function child(parent: Element, name: string): Element | undefined {
  return childElements(parent).find((element) => element.localName === name);
}

function path(parent: Element, names: string[]): Element | undefined {
  let current: Element | undefined = parent;
  for (const name of names) current = current ? child(current, name) : undefined;
  return current;
}

export function requiredChild(parent: Element, ...names: string[]): Element {
  const element = path(parent, names);
  if (!element) throw new NfseParseError(`Missing ${names.join('/')}.`);
  return element;
}

export function text(parent: Element, ...names: string[]): string | undefined {
  const value = path(parent, names)?.textContent ?? undefined;
  return value === '' ? undefined : value;
}

export function requiredText(parent: Element, ...names: string[]): string {
  const value = text(parent, ...names);
  if (value === undefined) throw new NfseParseError(`Missing ${names.join('/')}.`);
  return value;
}
```

- [ ] **Step 7: Implement the parser**

`packages/provider-nacional/src/parse/parseNfseXml.ts`:

```ts
import type { Element } from '@xmldom/xmldom';
import type { InvoiceParty, PartyAddress, PartyDocument, ProviderInvoice } from '@notaflow/core';
import { decimalToCents } from '../xml/formatters';
import {
  child,
  NfseParseError,
  parseXmlRoot,
  requiredChild,
  requiredText,
  text,
} from '../xml/readXml';

export function parseNfseXml(xml: string): ProviderInvoice {
  const info = requiredChild(parseXmlRoot(xml, 'NFSe'), 'infNFSe');
  const dps = requiredChild(info, 'DPS', 'infDPS');
  const accessKey = (info.getAttribute('Id') ?? '').replace(/^NFS/, '');
  if (!/^[0-9A-Z]{50}$/.test(accessKey)) throw new NfseParseError('Invalid infNFSe/@Id.');
  const iss = text(info, 'valores', 'vISSQN');
  const nbsCode = text(dps, 'serv', 'cServ', 'cNBS');
  const toma = child(dps, 'toma');

  return {
    accessKey,
    number: requiredText(info, 'nNFSe'),
    environment: requiredText(dps, 'tpAmb') === '1' ? 'producao' : 'producao_restrita',
    issuedAt: new Date(requiredText(info, 'dhProc')),
    competence: requiredText(dps, 'dCompet'),
    dps: {
      id: dps.getAttribute('Id') ?? '',
      series: requiredText(dps, 'serie'),
      number: Number(requiredText(dps, 'nDPS')),
    },
    provider: { cnpj: requiredText(info, 'emit', 'CNPJ'), name: requiredText(info, 'emit', 'xNome') },
    customer: toma ? party(toma) : null,
    service: {
      nationalTaxCode: requiredText(dps, 'serv', 'cServ', 'cTribNac'),
      description: requiredText(dps, 'serv', 'cServ', 'xDescServ'),
      ...(nbsCode ? { nbsCode } : {}),
    },
    amounts: {
      serviceCents: cents(requiredText(dps, 'valores', 'vServPrest', 'vServ')),
      ...(iss ? { issCents: cents(iss) } : {}),
      netCents: cents(requiredText(info, 'valores', 'vLiq')),
    },
    xml,
  };
}

function cents(value: string): number {
  try {
    return decimalToCents(value);
  } catch {
    throw new NfseParseError(`Invalid amount: ${value}`);
  }
}

function party(toma: Element): InvoiceParty {
  const municipalRegistration = text(toma, 'IM');
  const end = child(toma, 'end');
  const email = text(toma, 'email');
  const phone = text(toma, 'fone');
  return {
    document: document(toma),
    name: requiredText(toma, 'xNome'),
    ...(municipalRegistration ? { municipalRegistration } : {}),
    ...(end ? { address: address(end) } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function document(toma: Element): PartyDocument | null {
  for (const type of ['CNPJ', 'CPF', 'NIF'] as const) {
    const value = text(toma, type);
    if (value) return { type, value };
  }
  return null;
}

function address(end: Element): PartyAddress {
  const complement = text(end, 'xCpl');
  const common = {
    street: requiredText(end, 'xLgr'),
    number: requiredText(end, 'nro'),
    ...(complement ? { complement } : {}),
    district: requiredText(end, 'xBairro'),
  };
  if (child(end, 'endExt')) {
    return {
      kind: 'foreign',
      country: requiredText(end, 'endExt', 'cPais'),
      postalCode: requiredText(end, 'endExt', 'cEndPost'),
      city: requiredText(end, 'endExt', 'xCidade'),
      region: requiredText(end, 'endExt', 'xEstProvReg'),
      ...common,
    };
  }
  return {
    kind: 'domestic',
    municipality: requiredText(end, 'endNac', 'cMun'),
    zip: requiredText(end, 'endNac', 'CEP'),
    ...common,
  };
}
```

Add to `packages/provider-nacional/src/index.ts`:

```ts
export { parseNfseXml } from './parse/parseNfseXml';
export { NfseParseError } from './xml/readXml';
```

and add `decimalToCents` to the existing `./xml/formatters` export line.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck && pnpm lint`
Expected: PASS. If the domestic test fails only on key order of `customer`, the comparison is wrong, not the parser: `toEqual` ignores key order, so read the diff for a value mismatch.

- [ ] **Step 9: Commit**

```bash
git add packages/provider-nacional pnpm-lock.yaml
git commit -m "feat(provider-nacional): parse the NFS-e XML into ProviderInvoice"
```

---

### Task 3: Parse the event XML into `ProviderEvent`

**Files:**
- Create: `packages/provider-nacional/test/fixtures/EVENT_CANCEL.xml`
- Create: `packages/provider-nacional/src/parse/parseEventXml.ts`
- Create: `packages/provider-nacional/src/parse/parseEventXml.test.ts`
- Modify: `packages/provider-nacional/src/index.ts`

**Interfaces:**
- Consumes: `parseXmlRoot`, `requiredChild`, `requiredText`, `text`, `childElements`, `NfseParseError` (Task 2); `ProviderEvent` (Task 1).
- Produces: `parseEventXml(xml: string): ProviderEvent`.

The fixture copies the shape of the event the Sefin returned in Stage 0 run 2: `evento/infEvento` holds `dhProc` and the signed `pedRegEvento`.

- [ ] **Step 1: Write the fixture and the failing test**

`packages/provider-nacional/test/fixtures/EVENT_CANCEL.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?><evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento Id="EVT35503082212345678000195000000000004226100000000420101101001"><verAplic>SefinNacional_1.6.0</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>2026-10-03T18:28:43-03:00</dhProc><nDFSe>0</nDFSe><pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infPedReg Id="PRE35503082212345678000195000000000004226100000000420101101"><tpAmb>2</tpAmb><verAplic>notaflow-0.0.0</verAplic><dhEvento>2026-10-03T18:27:44-03:00</dhEvento><CNPJAutor>12345678000195</CNPJAutor><chNFSe>35503082212345678000195000000000004226100000000420</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro no valor do serviço</xMotivo></e101101></infPedReg></pedRegEvento></infEvento></evento>
```

`packages/provider-nacional/src/parse/parseEventXml.test.ts`:

```ts
import { expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { NfseParseError } from '../xml/readXml';
import { parseEventXml } from './parseEventXml';

test('reads a cancellation event', () => {
  const xml = readFixture('EVENT_CANCEL.xml');
  expect(parseEventXml(xml)).toEqual({
    accessKey: '35503082212345678000195000000000004226100000000420',
    code: '101101',
    registeredAt: new Date('2026-10-03T21:28:43Z'),
    reasonCode: '1',
    justification: 'Erro no valor do serviço',
    xml,
  });
});

test('reads an event type it does not know, without a reason', () => {
  const xml = readFixture('EVENT_CANCEL.xml')
    .replace(/<e101101>.*<\/e101101>/, '<e105102><xDesc>Outro</xDesc></e105102>');
  const event = parseEventXml(xml);
  expect(event.code).toBe('105102');
  expect(event.reasonCode).toBeUndefined();
});

test('throws NfseParseError for an event without a detail group', () => {
  const xml = readFixture('EVENT_CANCEL.xml').replace(/<e101101>.*<\/e101101>/, '');
  expect(() => parseEventXml(xml)).toThrow(NfseParseError);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/provider-nacional/src/parse/parseEventXml.test.ts`
Expected: FAIL, `./parseEventXml` does not exist.

- [ ] **Step 3: Implement the parser**

`packages/provider-nacional/src/parse/parseEventXml.ts`:

```ts
import type { ProviderEvent } from '@notaflow/core';
import {
  childElements,
  NfseParseError,
  parseXmlRoot,
  requiredChild,
  requiredText,
  text,
} from '../xml/readXml';

export function parseEventXml(xml: string): ProviderEvent {
  const info = requiredChild(parseXmlRoot(xml, 'evento'), 'infEvento');
  const request = requiredChild(info, 'pedRegEvento', 'infPedReg');
  const detail = childElements(request).find((element) =>
    /^e[0-9]{6}$/.test(element.localName ?? ''),
  );
  if (!detail?.localName) throw new NfseParseError('Missing the event detail group (e######).');
  const reasonCode = text(detail, 'cMotivo');
  const justification = text(detail, 'xMotivo');
  return {
    accessKey: requiredText(request, 'chNFSe'),
    code: detail.localName.slice(1),
    registeredAt: new Date(requiredText(info, 'dhProc')),
    ...(reasonCode ? { reasonCode } : {}),
    ...(justification ? { justification } : {}),
    xml,
  };
}
```

Add to `packages/provider-nacional/src/index.ts`:

```ts
export { parseEventXml } from './parse/parseEventXml';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/provider-nacional
git commit -m "feat(provider-nacional): parse the event XML into ProviderEvent"
```

---

### Task 4: `NacionalProvider` and the client URL override

**Files:**
- Modify: `packages/provider-nacional/src/http/NacionalClient.ts` (constructor options)
- Modify: `packages/provider-nacional/src/http/NacionalClient.test.ts`
- Create: `packages/provider-nacional/src/NacionalProvider.ts`
- Create: `packages/provider-nacional/src/NacionalProvider.test.ts`
- Modify: `packages/provider-nacional/src/index.ts`
- Modify: `packages/provider-nacional/AGENTS.md`

**Interfaces:**
- Consumes: `NacionalClient` (`fetchDfe`, `getNfse`, `checkConvenio`), `NacionalHttpError`, `DfeDocument` (Stage 0); `parseNfseXml` (Task 2); `parseEventXml` (Task 3); `InvoiceProvider`, `SyncBatch`, `SyncDocument`, `ProviderInvoice` (Task 1).
- Produces:
  - `new NacionalClient({ environment, dispatcher, timeoutMs?, urls?: { sefin: string; adn: string } })`
  - `class NacionalProvider implements InvoiceProvider`, `constructor(client: NacionalClient, emitterCnpj: string)`

Rules from the RFC and the Review Focus:
- A document with an NSU at or below the requested NSU is dropped (Review Focus 2).
- `hasMore` is `true` only when the batch had at least one new document.
- An NFS-e whose `emit/CNPJ` is not the emitter's is `skipped`, reason `received invoice` (Review Focus 4).
- An `NfseParseError` becomes `skipped`, reason `parse error: <message>` (Review Focus 1). Any other error propagates.
- A `REJEICAO` batch throws `NacionalHttpError(400, false, errors)`.
- `getInvoice` returns `null` on HTTP 404.

- [ ] **Step 1: Write the failing client tests**

Append to the top-level tests in `packages/provider-nacional/src/http/NacionalClient.test.ts`:

```ts
test('the urls option sends requests to another host', async () => {
  const local = new NacionalClient({
    environment: 'producao_restrita',
    dispatcher: agent,
    urls: { sefin: 'http://127.0.0.1:4010/SefinNacional', adn: 'http://127.0.0.1:4010/adn' },
  });
  agent
    .get('http://127.0.0.1:4010')
    .intercept({ path: '/adn/parametrizacao/3550308/convenio', method: 'GET' })
    .reply(200, { mensagem: 'ok' });
  expect(await local.checkConvenio('3550308')).toEqual({ mensagem: 'ok' });
});
```

Append to the `fetchDfe` block of the same file:

```ts
  test('a document with a corrupt ArquivoXml keeps the batch, with an empty xml', async () => {
    agent
      .get(ADN)
      .intercept({ path: DFE_PATH(0), method: 'GET' })
      .reply(200, {
        StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
        LoteDFe: [
          {
            NSU: 1,
            ChaveAcesso: KEY,
            TipoDocumento: 'NFSE',
            ArquivoXml: 'not-gzip',
            DataHoraGeracao: '2026-10-01T10:00:00',
          },
        ],
        Erros: [],
      });
    expect((await client.fetchDfe(0, '12345678000195')).documents[0]?.xml).toBe('');
  });
```

Today `fetchDfe` calls `gunzipBase64` on each item, so one corrupt `ArquivoXml` throws a zlib error and fails the whole batch. With an empty string instead, `parseNfseXml` throws an `NfseParseError`, and `NacionalProvider` turns the document into `skipped` (Review Focus 1).

- [ ] **Step 2: Write the failing provider tests**

`packages/provider-nacional/src/NacionalProvider.test.ts`:

```ts
import { MockAgent } from 'undici';
import { beforeEach, expect, test } from 'vitest';
import { readFixture } from '../test/fixtures';
import { gzipBase64 } from './http/gzipBase64';
import { NacionalClient } from './http/NacionalClient';
import { NacionalProvider } from './NacionalProvider';

const ADN = 'https://adn.producaorestrita.nfse.gov.br';
const SEFIN = 'https://sefin.producaorestrita.nfse.gov.br';
const CNPJ = '12345678000195';
const KEY = '35503082212345678000195000000000004226100000000420';
const dfePath = (nsu: number) => `/contribuintes/DFe/${nsu}?cnpjConsulta=${CNPJ}&lote=true`;

let agent: MockAgent;
let provider: NacionalProvider;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  const client = new NacionalClient({ environment: 'producao_restrita', dispatcher: agent });
  provider = new NacionalProvider(client, CNPJ);
});

function item(nsu: number, type: string, xml: string) {
  return {
    NSU: nsu,
    ChaveAcesso: KEY,
    TipoDocumento: type,
    ArquivoXml: gzipBase64(xml),
    DataHoraGeracao: '2026-10-01T10:00:00',
  };
}

function replyBatch(nsu: number, items: unknown[]) {
  agent
    .get(ADN)
    .intercept({ path: dfePath(nsu), method: 'GET' })
    .reply(200, { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: items, Erros: [] });
}

test('maps an NFS-e and an event to sync documents and moves the cursor', async () => {
  replyBatch(10, [
    item(11, 'NFSE', readFixture('NFSE_DOMESTIC.xml')),
    item(12, 'EVENTO', readFixture('EVENT_CANCEL.xml')),
  ]);
  const batch = await provider.fetchSince(10);
  expect(batch.lastNsu).toBe(12);
  expect(batch.hasMore).toBe(true);
  expect(batch.documents.map((d) => d.kind)).toEqual(['invoice', 'event']);
  expect(batch.documents[0]).toMatchObject({ nsu: 11, invoice: { accessKey: KEY, number: '42' } });
});

test('an empty ADN answer keeps the cursor and stops', async () => {
  agent
    .get(ADN)
    .intercept({ path: dfePath(12), method: 'GET' })
    .reply(404, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] });
  expect(await provider.fetchSince(12)).toEqual({ documents: [], lastNsu: 12, hasMore: false });
});

test('drops a document at the requested NSU, so an inclusive ADN does not loop', async () => {
  replyBatch(12, [item(12, 'EVENTO', readFixture('EVENT_CANCEL.xml'))]);
  expect(await provider.fetchSince(12)).toEqual({ documents: [], lastNsu: 12, hasMore: false });
});

test('a document that does not parse is skipped and the cursor still moves', async () => {
  replyBatch(0, [
    item(1, 'NFSE', '<broken'),
    item(2, 'NFSE', readFixture('NFSE_DOMESTIC.xml')),
  ]);
  const batch = await provider.fetchSince(0);
  expect(batch.lastNsu).toBe(2);
  expect(batch.documents[0]).toMatchObject({ kind: 'skipped', nsu: 1 });
  expect(batch.documents[0]).toHaveProperty('reason', expect.stringMatching(/^parse error: /));
  expect(batch.documents[1]?.kind).toBe('invoice');
});

test('an invoice issued by another CNPJ is skipped as received', async () => {
  const received = readFixture('NFSE_DOMESTIC.xml').replace(
    '<emit><CNPJ>12345678000195</CNPJ>',
    '<emit><CNPJ>98765432000110</CNPJ>',
  );
  replyBatch(0, [item(1, 'NFSE', received)]);
  expect((await provider.fetchSince(0)).documents).toEqual([
    { kind: 'skipped', nsu: 1, reason: 'received invoice' },
  ]);
});

test('an unknown document type is skipped with its type', async () => {
  replyBatch(0, [item(1, 'DPS_PENDENTE', '<x/>')]);
  expect((await provider.fetchSince(0)).documents).toEqual([
    { kind: 'skipped', nsu: 1, reason: 'document type DPS_PENDENTE' },
  ]);
});

test('a REJEICAO batch throws a non-retryable error', async () => {
  agent
    .get(ADN)
    .intercept({ path: dfePath(0), method: 'GET' })
    .reply(400, { StatusProcessamento: 'REJEICAO', LoteDFe: [], Erros: [{ Codigo: 'E2001' }] });
  await expect(provider.fetchSince(0)).rejects.toMatchObject({ status: 400, retryable: false });
});

test('getInvoice parses the NFS-e and returns null on 404', async () => {
  agent
    .get(SEFIN)
    .intercept({ path: `/SefinNacional/nfse/${KEY}`, method: 'GET' })
    .reply(200, { chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64(readFixture('NFSE_DOMESTIC.xml')) });
  expect((await provider.getInvoice(KEY))?.number).toBe('42');

  agent
    .get(SEFIN)
    .intercept({ path: `/SefinNacional/nfse/${KEY}`, method: 'GET' })
    .reply(404, { erro: { Codigo: 'E404', Descricao: 'NFS-e não encontrada' } });
  expect(await provider.getInvoice(KEY)).toBeNull();
});

test('checkConnection resolves on 200 and throws on another status', async () => {
  const path = '/parametrizacao/3550308/convenio';
  agent.get(ADN).intercept({ path, method: 'GET' }).reply(200, { mensagem: 'ok' });
  await expect(provider.checkConnection('3550308')).resolves.toBeUndefined();
  agent.get(ADN).intercept({ path, method: 'GET' }).reply(501, 'Not Implemented');
  await expect(provider.checkConnection('3550308')).rejects.toMatchObject({ status: 501 });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/provider-nacional/src/NacionalProvider.test.ts packages/provider-nacional/src/http`
Expected: FAIL. `./NacionalProvider` does not exist. The URL override test fails with a MockAgent "no match" error, because the client still calls the gov.br host. The corrupt `ArquivoXml` test fails with a zlib error.

- [ ] **Step 4: Add the URL override to the client**

In `packages/provider-nacional/src/http/NacionalClient.ts`, change the constructor:

```ts
  constructor(options: {
    environment: Environment;
    dispatcher: Dispatcher;
    timeoutMs?: number;
    // Points the client at the local fake (packages/fake-nacional) instead of gov.br.
    urls?: { sefin: string; adn: string };
  }) {
    this.urls = options.urls ?? ENDPOINTS[options.environment];
    this.dispatcher = options.dispatcher;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }
```

In `fetchDfe`, replace `xml: gunzipBase64(item.ArquivoXml),` with:

```ts
          xml: tryGunzip(item.ArquivoXml) ?? '',
```

`tryGunzip` already exists in the same file (Stage 0 fix pass).

- [ ] **Step 5: Implement `NacionalProvider`**

`packages/provider-nacional/src/NacionalProvider.ts`:

```ts
import type { InvoiceProvider, ProviderInvoice, SyncBatch, SyncDocument } from '@notaflow/core';
import { type DfeDocument, type NacionalClient, NacionalHttpError } from './http/NacionalClient';
import { parseEventXml } from './parse/parseEventXml';
import { parseNfseXml } from './parse/parseNfseXml';
import { NfseParseError } from './xml/readXml';

export class NacionalProvider implements InvoiceProvider {
  constructor(
    private readonly client: NacionalClient,
    private readonly emitterCnpj: string,
  ) {}

  async checkConnection(municipality: string): Promise<void> {
    await this.client.checkConvenio(municipality);
  }

  async fetchSince(nsu: number): Promise<SyncBatch> {
    const batch = await this.client.fetchDfe(nsu, this.emitterCnpj);
    if (batch.status === 'REJEICAO') throw new NacionalHttpError(400, false, batch.errors);
    // The ADN manual does not say whether /DFe/{NSU} includes NSU itself, so drop it either way.
    const fresh = batch.documents.filter((document) => document.nsu > nsu);
    return {
      documents: fresh.map((document) => this.toSyncDocument(document)),
      lastNsu: fresh.reduce((last, document) => Math.max(last, document.nsu), nsu),
      hasMore: fresh.length > 0,
    };
  }

  async getInvoice(accessKey: string): Promise<ProviderInvoice | null> {
    try {
      return parseNfseXml(await this.client.getNfse(accessKey));
    } catch (error) {
      if (error instanceof NacionalHttpError && error.status === 404) return null;
      throw error;
    }
  }

  private toSyncDocument(document: DfeDocument): SyncDocument {
    const { nsu } = document;
    try {
      if (document.type === 'NFSE') {
        const invoice = parseNfseXml(document.xml);
        if (invoice.provider.cnpj !== this.emitterCnpj) {
          return { kind: 'skipped', nsu, reason: 'received invoice' };
        }
        return { kind: 'invoice', nsu, invoice };
      }
      if (document.type === 'EVENTO') return { kind: 'event', nsu, event: parseEventXml(document.xml) };
      return { kind: 'skipped', nsu, reason: `document type ${document.type}` };
    } catch (error) {
      if (error instanceof NfseParseError) {
        return { kind: 'skipped', nsu, reason: `parse error: ${error.message}` };
      }
      throw error;
    }
  }
}
```

Add to `packages/provider-nacional/src/index.ts`:

```ts
export { NacionalProvider } from './NacionalProvider';
```

In `packages/provider-nacional/AGENTS.md`, replace the "Entry points" line with:

```markdown
- Entry points: `NacionalProvider` (the `InvoiceProvider`), `parseNfseXml`, `parseEventXml`, `buildDpsXml`, `buildCancelEventXml`, `NacionalClient`, `createMtlsDispatcher` (`src/index.ts`)
- Local fake for development and tests: `packages/fake-nacional` (pass its `urls` to `NacionalClient`)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/provider-nacional && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/provider-nacional
git commit -m "feat(provider-nacional): NacionalProvider maps ADN batches to sync documents"
```

---

### Task 5: Fake Sefin, part 1: package, issue, and lookups

**Files:**
- Create: `packages/fake-nacional/package.json`, `tsconfig.json`, `AGENTS.md`
- Create: `packages/fake-nacional/src/fakeXml.ts`
- Create: `packages/fake-nacional/src/startFakeNacional.ts`
- Create: `packages/fake-nacional/src/index.ts`
- Create: `packages/fake-nacional/src/testData.ts`
- Create: `packages/fake-nacional/src/startFakeNacional.test.ts`

**Interfaces:**
- Consumes: `gzipBase64`, `gunzipBase64`, `NFSE_NAMESPACE`, `NacionalClient`, `buildDpsXml` from `@notaflow/provider-nacional`.
- Produces (exported from `@notaflow/fake-nacional`):
  - `startFakeNacional(options?: { port?: number; emitterName?: string }): Promise<FakeNacional>`
  - `interface FakeNacional { urls: { sefin: string; adn: string }; next(route: FakeRoute, outcome: FakeOutcome): void; reset(): void; close(): Promise<void> }`
  - `type FakeRoute = 'issue' | 'getNfse' | 'getDps' | 'event' | 'dfe' | 'convenio'`
  - `type FakeOutcome = { kind: 'reply'; status: number; body: unknown } | { kind: 'delay'; ms: number }`
  - `dpsInput: DpsInput` in `src/testData.ts`, shared by the tests of Tasks 5 to 7. A test file must not import another test file, or Vitest registers its tests twice.

The fake mirrors what Stage 0 saw from the real Sefin:
- It refuses a DPS without the XML declaration with E1229.
- It refuses a second DPS with the same id with E0014, and its error objects use `Codigo` and `Descricao`.
- It answers an unknown DPS id with HTTP 404 and a JSON body.
- It issues a DPS with a zero amount (the real Sefin did).
- It does not check the signature or the XSD. The real Sefin is the only proof of those.

Access keys follow the national layout, so `buildCancelEventXml` accepts them: municipality (7), environment `2` (1), registration type `2` (1), CNPJ (14), NFS-e number (13), `YYMM` (4), code (9), check digit (1).

- [ ] **Step 1: Create the package**

`packages/fake-nacional/package.json`:

```json
{
  "name": "@notaflow/fake-nacional",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@notaflow/provider-nacional": "workspace:*",
    "@xmldom/xmldom": "^0.9.6"
  },
  "devDependencies": {
    "@notaflow/signer-node": "workspace:*",
    "@notaflow/test-kit": "workspace:*",
    "undici": "^7.2.0"
  }
}
```

`packages/fake-nacional/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/fake-nacional/AGENTS.md`:

```markdown
# Fake Nacional: AI Context

An in-memory fake of the Sefin Nacional and the ADN, for local development and tests without a real certificate. It never runs in production.

## Quick Reference

- Entry point: `startFakeNacional` (`src/index.ts`). Run it by hand with `pnpm fake:nacional`.
- Point a client at it: `new NacionalClient({ environment: 'producao_restrita', dispatcher: new Agent(), urls: fake.urls })`.
- Force a scenario: `fake.next('issue', { kind: 'delay', ms: 1000 })`, or `POST /__fake/next` with the same JSON plus `route`.

## Documentation Index

- [Stage 1a-1 plan](../../docs/ENGINEERING/PLANS/2026/10/PLAN_STAGE_1A_1_PROVIDER_READ.md) - why the fake exists and what it mirrors
- [RFC Stage 0 Results](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md#stage-0-results) - the real behavior it copies

## Key Rules

1. Copy only behavior seen from the real Sefin or ADN, and name the source in the test. Where the real behavior is unknown, say so in a comment.
2. The fake does not check signatures or the XSD. Only produção restrita proves those.
3. It listens on 127.0.0.1 only.
```

Run: `pnpm install`
Expected: the workspace links `@notaflow/fake-nacional`.

- [ ] **Step 2: Write the failing tests**

`packages/fake-nacional/src/testData.ts`:

```ts
import type { DpsInput } from '@notaflow/provider-nacional';

export const dpsInput: DpsInput = {
  environment: 'producao_restrita',
  issuedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-test',
  series: '900',
  number: 1,
  competence: '2026-10-01',
  emitterMunicipality: '3550308',
  provider: { cnpj: '12345678000195', simplesNacional: '1', specialRegime: '0' },
  customer: { document: { type: 'CNPJ', value: '98765432000110' }, name: 'Cliente Exemplo Ltda' },
  service: {
    municipality: '3550308',
    nationalTaxCode: '010101',
    description: 'Consultoria em análise & ção <teste>',
  },
  amounts: { serviceCents: 150000 },
  tax: { issqnTaxation: '1', issRetention: '1' },
};
```

`packages/fake-nacional/src/startFakeNacional.test.ts`:

```ts
import { buildDpsXml, gzipBase64, NacionalClient } from '@notaflow/provider-nacional';
import { Agent } from 'undici';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type FakeNacional, startFakeNacional } from './index';
import { dpsInput } from './testData';

let fake: FakeNacional;
let client: NacionalClient;

beforeEach(async () => {
  fake = await startFakeNacional();
  client = new NacionalClient({
    environment: 'producao_restrita',
    dispatcher: new Agent(),
    urls: fake.urls,
    timeoutMs: 300,
  });
});

afterEach(() => fake.close());

describe('issue', () => {
  test('issues a DPS and returns a 50-character access key and the NFS-e', async () => {
    const result = await client.issue(buildDpsXml(dpsInput).xml);
    expect(result.kind).toBe('issued');
    if (result.kind !== 'issued') return;
    expect(result.accessKey).toMatch(/^[0-9]{8}2[0-9A-Z]{14}[0-9]{27}$/);
    expect(result.nfseXml).toContain('<nNFSe>1</nNFSe>');
    expect(result.nfseXml).toContain('<xDescServ>Consultoria em análise &amp; ção &lt;teste&gt;</xDescServ>');
  });

  test('refuses a DPS without the XML declaration with E1229, like the real Sefin', async () => {
    // NacionalClient always adds the declaration, so send through a raw request.
    const response = await fetch(`${fake.urls.sefin}/nfse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dpsXmlGZipB64: gzipBase64(buildDpsXml(dpsInput).xml) }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ erros: [{ Codigo: 'E1229' }] });
  });

  test('refuses the same DPS id twice with E0014', async () => {
    const { xml } = buildDpsXml(dpsInput);
    await client.issue(xml);
    expect(await client.issue(xml)).toMatchObject({
      kind: 'rejected',
      errors: [{ codigo: 'E0014' }],
    });
  });

  test('numbers NFS-e per fake instance from 1', async () => {
    await client.issue(buildDpsXml(dpsInput).xml);
    const second = await client.issue(buildDpsXml({ ...dpsInput, number: 2 }).xml);
    expect(second.kind === 'issued' && second.nfseXml).toContain('<nNFSe>2</nNFSe>');
  });
});

describe('lookups', () => {
  test('finds an issued DPS by id and the NFS-e by access key', async () => {
    const { id, xml } = buildDpsXml(dpsInput);
    const issued = await client.issue(xml);
    if (issued.kind !== 'issued') throw new Error('not issued');
    expect(await client.findByDpsId(id)).toEqual({ kind: 'found', accessKey: issued.accessKey });
    expect(await client.getNfse(issued.accessKey)).toBe(issued.nfseXml);
  });

  test('an unknown DPS id is a JSON 404, so the client says not_found', async () => {
    expect(await client.findByDpsId(buildDpsXml(dpsInput).id)).toEqual({ kind: 'not_found' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/fake-nacional`
Expected: FAIL, `./index` does not exist.

- [ ] **Step 4: Implement the fake XML helpers**

`packages/fake-nacional/src/fakeXml.ts`:

```ts
import { DOMParser, type Element } from '@xmldom/xmldom';
import { NFSE_NAMESPACE } from '@notaflow/provider-nacional';

export interface DpsFacts {
  id: string;
  municipality: string;
  cnpj: string;
  serviceAmount: string;
}

function first(scope: Element, name: string): Element | undefined {
  return scope.getElementsByTagNameNS(NFSE_NAMESPACE, name).item(0) ?? undefined;
}

export function readDps(xml: string): DpsFacts {
  const root = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
  const info = root ? first(root, 'infDPS') : undefined;
  const prest = info ? first(info, 'prest') : undefined;
  const cnpj = prest ? first(prest, 'CNPJ')?.textContent : undefined;
  const municipality = info ? first(info, 'cLocEmi')?.textContent : undefined;
  const serviceAmount = info ? first(info, 'vServ')?.textContent : undefined;
  const id = info?.getAttribute('Id');
  if (!id || !cnpj || !municipality || !serviceAmount) throw new Error('Not a DPS the fake can read.');
  return { id, municipality, cnpj, serviceAmount };
}

export function stripDeclarationAndSignature(xml: string): string {
  return xml.replace(/^<\?xml[^>]*\?>/, '').replace(/<Signature[\s\S]*<\/Signature>/, '');
}

export function buildAccessKey(dps: DpsFacts, nfseNumber: number, at: Date): string {
  const yymm = at.toISOString().slice(2, 7).replace('-', '');
  const sequence = String(nfseNumber);
  return `${dps.municipality}22${dps.cnpj}${sequence.padStart(13, '0')}${yymm}${sequence.padStart(9, '0')}0`;
}

export function buildNfseXml(input: {
  accessKey: string;
  nfseNumber: number;
  processedAt: string;
  emitterName: string;
  dps: DpsFacts;
  dpsXml: string;
}): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?><NFSe versao="1.01" xmlns="${NFSE_NAMESPACE}">` +
    `<infNFSe Id="NFS${input.accessKey}"><xLocEmi>Fake</xLocEmi>` +
    `<nNFSe>${input.nfseNumber}</nNFSe><cStat>100</cStat><dhProc>${input.processedAt}</dhProc>` +
    `<emit><CNPJ>${input.dps.cnpj}</CNPJ><xNome>${input.emitterName}</xNome></emit>` +
    `<valores><vLiq>${input.dps.serviceAmount}</vLiq></valores>` +
    stripDeclarationAndSignature(input.dpsXml) +
    `</infNFSe></NFSe>`
  );
}

export function buildEventXml(input: {
  accessKey: string;
  code: string;
  processedAt: string;
  requestXml: string;
}): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?><evento versao="1.01" xmlns="${NFSE_NAMESPACE}">` +
    `<infEvento Id="EVT${input.accessKey}${input.code}001"><verAplic>fake-nacional</verAplic>` +
    `<ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>${input.processedAt}</dhProc><nDFSe>0</nDFSe>` +
    stripDeclarationAndSignature(input.requestXml) +
    `</infEvento></evento>`
  );
}
```

The emitter name goes into XML unescaped. `startFakeNacional` escapes it with `escapeXml` from `@notaflow/provider-nacional` before it calls `buildNfseXml`.

- [ ] **Step 5: Implement the server with issue and lookups**

`packages/fake-nacional/src/startFakeNacional.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  escapeXml,
  formatBrasiliaDateTime,
  gunzipBase64,
  gzipBase64,
} from '@notaflow/provider-nacional';
import { buildAccessKey, buildNfseXml, readDps } from './fakeXml';

export type FakeRoute = 'issue' | 'getNfse' | 'getDps' | 'event' | 'dfe' | 'convenio';
export type FakeOutcome = { kind: 'reply'; status: number; body: unknown } | { kind: 'delay'; ms: number };

export interface FakeNacional {
  urls: { sefin: string; adn: string };
  next(route: FakeRoute, outcome: FakeOutcome): void;
  reset(): void;
  close(): Promise<void>;
}

interface FakeInvoice {
  accessKey: string;
  dpsId: string;
  emitterCnpj: string;
  nfseXml: string;
  cancelled: boolean;
}

export interface FakeDfeEntry {
  nsu: number;
  accessKey: string;
  emitterCnpj: string;
  type: 'NFSE' | 'EVENTO';
  eventType?: string;
  xml: string;
  createdAt: string;
}

interface Reply {
  status: number;
  body: unknown;
}

const E0014 =
  'Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe em uma NFS-e gerada a partir de uma DPS enviada anteriormente.';

export class FakeState {
  invoices = new Map<string, FakeInvoice>();
  keysByDpsId = new Map<string, string>();
  dfe: FakeDfeEntry[] = [];
  nfseCount = 0;

  addDfe(entry: Omit<FakeDfeEntry, 'nsu' | 'createdAt'>): void {
    this.dfe.push({ ...entry, nsu: this.dfe.length + 1, createdAt: new Date().toISOString() });
  }
}

export async function startFakeNacional(
  options: { port?: number; emitterName?: string } = {},
): Promise<FakeNacional> {
  let state = new FakeState();
  const queue = new Map<FakeRoute, FakeOutcome[]>();
  const emitterName = escapeXml(options.emitterName ?? 'EMPRESA TESTE LTDA');

  const routes: { route: FakeRoute; method: string; pattern: RegExp; handle: Handler }[] = [
    { route: 'issue', method: 'POST', pattern: /^\/SefinNacional\/nfse$/, handle: issue },
    { route: 'getNfse', method: 'GET', pattern: /^\/SefinNacional\/nfse\/([0-9A-Z]{50})$/, handle: getNfse },
    { route: 'getDps', method: 'GET', pattern: /^\/SefinNacional\/dps\/([0-9A-Z]+)$/, handle: getDps },
  ];

  type Handler = (match: RegExpMatchArray, body: string, url: URL) => Reply;

  function issue(_match: RegExpMatchArray, body: string): Reply {
    const dpsXml = gunzipBase64((JSON.parse(body) as { dpsXmlGZipB64: string }).dpsXmlGZipB64);
    if (!dpsXml.startsWith('<?xml')) {
      return reject(400, 'E1229', 'Xml não está utilizando codificação UTF-8.');
    }
    const dps = readDps(dpsXml);
    if (state.keysByDpsId.has(dps.id)) {
      return { status: 400, body: { idDPS: dps.id, erros: [{ Codigo: 'E0014', Descricao: E0014 }] } };
    }
    const now = new Date();
    const nfseNumber = ++state.nfseCount;
    const accessKey = buildAccessKey(dps, nfseNumber, now);
    const processedAt = formatBrasiliaDateTime(now);
    const nfseXml = buildNfseXml({ accessKey, nfseNumber, processedAt, emitterName, dps, dpsXml });
    state.invoices.set(accessKey, {
      accessKey,
      dpsId: dps.id,
      emitterCnpj: dps.cnpj,
      nfseXml,
      cancelled: false,
    });
    state.keysByDpsId.set(dps.id, accessKey);
    state.addDfe({ accessKey, emitterCnpj: dps.cnpj, type: 'NFSE', xml: nfseXml });
    return {
      status: 201,
      body: {
        tipoAmbiente: 2,
        versaoAplicativo: 'fake-nacional',
        dataHoraProcessamento: processedAt,
        idDps: dps.id,
        chaveAcesso: accessKey,
        nfseXmlGZipB64: gzipBase64(nfseXml),
        alertas: [],
      },
    };
  }

  function getNfse(match: RegExpMatchArray): Reply {
    const invoice = state.invoices.get(match[1] ?? '');
    if (!invoice) return reject(404, 'E0404', 'NFS-e não encontrada.');
    return {
      status: 200,
      body: { chaveAcesso: invoice.accessKey, nfseXmlGZipB64: gzipBase64(invoice.nfseXml) },
    };
  }

  function getDps(match: RegExpMatchArray): Reply {
    const accessKey = state.keysByDpsId.get(match[1] ?? '');
    // Stage 0 run 2: the real Sefin answers an unknown DPS id with a JSON 404.
    if (!accessKey) return reject(404, 'E0404', 'DPS não encontrada.');
    return { status: 200, body: { idDps: match[1], chaveAcesso: accessKey } };
  }

  function reject(status: number, code: string, message: string): Reply {
    return { status, body: { erros: [{ Codigo: code, Descricao: message }] } };
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = await readBody(request);
    if (request.method === 'POST' && url.pathname === '/__fake/next') {
      const { route, ...outcome } = JSON.parse(body) as { route: FakeRoute } & FakeOutcome;
      fake.next(route, outcome as FakeOutcome);
      return send(response, { status: 204, body: null });
    }
    if (request.method === 'POST' && url.pathname === '/__fake/reset') {
      fake.reset();
      return send(response, { status: 204, body: null });
    }
    for (const { route, method, pattern, handle: run } of routes) {
      const match = request.method === method ? url.pathname.match(pattern) : null;
      if (!match) continue;
      const outcome = queue.get(route)?.shift();
      if (outcome?.kind === 'reply') return send(response, outcome);
      const reply = run(match, body, url);
      // A delay keeps the state change, like a real timeout after the Sefin stored the invoice.
      if (outcome?.kind === 'delay') await new Promise((resolve) => setTimeout(resolve, outcome.ms));
      return send(response, reply);
    }
    send(response, { status: 404, body: { erro: 'no fake route' } });
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, { status: 500, body: { erro: error instanceof Error ? error.message : String(error) } });
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const fake: FakeNacional = {
    urls: { sefin: `${base}/SefinNacional`, adn: `${base}/adn` },
    next(route, outcome) {
      queue.set(route, [...(queue.get(route) ?? []), outcome]);
    },
    reset() {
      state = new FakeState();
      queue.clear();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return fake;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response: ServerResponse, reply: Reply): void {
  // The client may have given up already (a delay scenario); writing then is harmless.
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(reply.body === null ? '' : JSON.stringify(reply.body));
}
```

`packages/fake-nacional/src/index.ts`:

```ts
export { startFakeNacional } from './startFakeNacional';
export type { FakeDfeEntry, FakeNacional, FakeOutcome, FakeRoute } from './startFakeNacional';
```

`escapeXml` and `formatBrasiliaDateTime` are already exported by `@notaflow/provider-nacional` (Stage 0).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/fake-nacional && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fake-nacional pnpm-lock.yaml
git commit -m "feat(fake-nacional): local fake Sefin with issue and lookups"
```

---

### Task 6: Fake Sefin, part 2: events, the ADN feed, the convênio, scenarios, and the CLI

**Files:**
- Modify: `packages/fake-nacional/src/startFakeNacional.ts`
- Modify: `packages/fake-nacional/src/startFakeNacional.test.ts`
- Create: `packages/fake-nacional/src/cli.ts`
- Modify: `package.json` (root script `fake:nacional`)
- Modify: `AGENTS.md` (package table), `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md` (packages table and ports)

**Interfaces:**
- Consumes: `startFakeNacional`, `FakeState`, `buildEventXml` (Task 5); `buildCancelEventXml`, `NacionalClient` from `@notaflow/provider-nacional`.
- Produces: routes `POST /SefinNacional/nfse/{key}/eventos`, `GET /adn/contribuintes/DFe/{nsu}`, `GET /adn/parametrizacao/{cMun}/convenio`; the root script `pnpm fake:nacional`.

ADN feed rules:
- The feed holds every NFS-e and event in creation order, with NSU from 1.
- `GET /adn/contribuintes/DFe/{nsu}?cnpjConsulta=X&lote=true` returns up to 50 entries of CNPJ `X` with NSU greater than `nsu`.
- With entries: HTTP 200, `DOCUMENTOS_LOCALIZADOS`. With none: HTTP 404, `NENHUM_DOCUMENTO_LOCALIZADO` (Stage 0 run 2).

The real body of an event rejection is unknown (RFC "Stage 0 Results"). The fake answers a second cancellation with `{ erro: { Codigo, Descricao } }`, the shape the client reads today, and says so in a comment. Plan 1b replaces it once the real body is captured.

- [ ] **Step 1: Write the failing tests**

Append to `packages/fake-nacional/src/startFakeNacional.test.ts`. Add `buildCancelEventXml` and `type DpsInput` to its `@notaflow/provider-nacional` import:

```ts
const KEY_OF = async (input: DpsInput = dpsInput): Promise<string> => {
  const result = await client.issue(buildDpsXml(input).xml);
  if (result.kind !== 'issued') throw new Error('not issued');
  return result.accessKey;
};

function cancelXml(accessKey: string): string {
  return buildCancelEventXml({
    environment: 'producao_restrita',
    requestedAt: new Date(),
    appVersion: 'notaflow-test',
    authorCnpj: '12345678000195',
    accessKey,
    reason: '1',
    justification: 'Teste de cancelamento no fake',
  }).xml;
}

describe('events', () => {
  test('registers a cancellation and returns the event XML', async () => {
    const accessKey = await KEY_OF();
    const result = await client.registerEvent(accessKey, cancelXml(accessKey));
    expect(result.kind).toBe('registered');
    expect(result.kind === 'registered' && result.eventXml).toContain(`<chNFSe>${accessKey}</chNFSe>`);
  });

  test('a second cancellation is rejected', async () => {
    const accessKey = await KEY_OF();
    await client.registerEvent(accessKey, cancelXml(accessKey));
    expect(await client.registerEvent(accessKey, cancelXml(accessKey))).toMatchObject({
      kind: 'rejected',
      error: { codigo: 'E0840' },
    });
  });
});

describe('ADN feed', () => {
  test('lists the NFS-e and the event of the CNPJ in NSU order', async () => {
    const accessKey = await KEY_OF();
    await client.registerEvent(accessKey, cancelXml(accessKey));
    const batch = await client.fetchDfe(0, '12345678000195');
    expect(batch.status).toBe('DOCUMENTOS_LOCALIZADOS');
    expect(batch.documents.map((d) => [d.nsu, d.type])).toEqual([
      [1, 'NFSE'],
      [2, 'EVENTO'],
    ]);
  });

  test('answers 404 NENHUM_DOCUMENTO_LOCALIZADO past the end and for another CNPJ', async () => {
    await KEY_OF();
    expect((await client.fetchDfe(1, '12345678000195')).status).toBe('NENHUM_DOCUMENTO_LOCALIZADO');
    expect((await client.fetchDfe(0, '98765432000110')).documents).toEqual([]);
  });

  test('returns at most 50 documents per batch', async () => {
    for (let n = 1; n <= 51; n++) await KEY_OF({ ...dpsInput, number: n });
    expect((await client.fetchDfe(0, '12345678000195')).documents).toHaveLength(50);
    expect((await client.fetchDfe(50, '12345678000195')).documents).toHaveLength(1);
  });
});

describe('convênio and scenarios', () => {
  test('the convênio says the municipality joined the national emitter', async () => {
    expect(await client.checkConvenio('3550308')).toMatchObject({
      parametrosConvenio: { aderenteEmissorNacional: 1 },
    });
  });

  test('a reply scenario answers once, then the route behaves normally', async () => {
    fake.next('dfe', { kind: 'reply', status: 429, body: {} });
    await expect(client.fetchDfe(0, '12345678000195')).rejects.toMatchObject({ retryable: true });
    expect((await client.fetchDfe(0, '12345678000195')).status).toBe('NENHUM_DOCUMENTO_LOCALIZADO');
  });

  test('a delay scenario stores the invoice although the client times out', async () => {
    fake.next('issue', { kind: 'delay', ms: 600 });
    const { id, xml } = buildDpsXml(dpsInput);
    expect((await client.issue(xml)).kind).toBe('uncertain');
    expect((await client.findByDpsId(id)).kind).toBe('found');
  });

  test('POST /__fake/next queues a scenario over HTTP', async () => {
    await fetch(fake.urls.sefin.replace('/SefinNacional', '/__fake/next'), {
      method: 'POST',
      body: JSON.stringify({ route: 'convenio', kind: 'reply', status: 503, body: 'down' }),
    });
    await expect(client.checkConvenio('3550308')).rejects.toMatchObject({ status: 503 });
  });

  test('reset clears invoices and scenarios', async () => {
    await KEY_OF();
    fake.next('convenio', { kind: 'reply', status: 503, body: 'down' });
    fake.reset();
    expect((await client.fetchDfe(0, '12345678000195')).documents).toEqual([]);
    await expect(client.checkConvenio('3550308')).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/fake-nacional`
Expected: FAIL. The new routes answer `404 no fake route`, so `registerEvent` throws, `fetchDfe` throws, and `checkConvenio` throws.

- [ ] **Step 3: Add the routes**

In `packages/fake-nacional/src/startFakeNacional.ts`, add `buildEventXml` to the `./fakeXml` import, and add three entries to `routes`:

```ts
    { route: 'event', method: 'POST', pattern: /^\/SefinNacional\/nfse\/([0-9A-Z]{50})\/eventos$/, handle: event },
    { route: 'dfe', method: 'GET', pattern: /^\/adn\/contribuintes\/DFe\/([0-9]+)$/, handle: dfe },
    { route: 'convenio', method: 'GET', pattern: /^\/adn\/parametrizacao\/([0-9]{7})\/convenio$/, handle: convenio },
```

Add the handlers next to `getDps`:

```ts
  function event(match: RegExpMatchArray, body: string): Reply {
    const invoice = state.invoices.get(match[1] ?? '');
    if (!invoice) return reject(404, 'E0404', 'NFS-e não encontrada.');
    const requestXml = gunzipBase64(
      (JSON.parse(body) as { pedidoRegistroEventoXmlGZipB64: string }).pedidoRegistroEventoXmlGZipB64,
    );
    if (!requestXml.startsWith('<?xml')) {
      return reject(400, 'E1229', 'Xml não está utilizando codificação UTF-8.');
    }
    if (invoice.cancelled) {
      // The real rejection body is unknown (RFC Stage 0 Results); this is the shape the client reads.
      return { status: 400, body: { erro: { Codigo: 'E0840', Descricao: 'NFS-e já cancelada.' } } };
    }
    const code = /<e([0-9]{6})>/.exec(requestXml)?.[1] ?? '101101';
    const eventXml = buildEventXml({
      accessKey: invoice.accessKey,
      code,
      processedAt: formatBrasiliaDateTime(new Date()),
      requestXml,
    });
    invoice.cancelled = code === '101101' || invoice.cancelled;
    state.addDfe({
      accessKey: invoice.accessKey,
      emitterCnpj: invoice.emitterCnpj,
      type: 'EVENTO',
      eventType: code,
      xml: eventXml,
    });
    return { status: 201, body: { eventoXmlGZipB64: gzipBase64(eventXml) } };
  }

  function dfe(match: RegExpMatchArray, _body: string, url: URL): Reply {
    const after = Number(match[1]);
    const cnpj = url.searchParams.get('cnpjConsulta');
    const entries = state.dfe.filter((e) => e.nsu > after && e.emitterCnpj === cnpj).slice(0, 50);
    if (entries.length === 0) {
      return {
        status: 404,
        body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] },
      };
    }
    return {
      status: 200,
      body: {
        StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
        LoteDFe: entries.map((e) => ({
          NSU: e.nsu,
          ChaveAcesso: e.accessKey,
          TipoDocumento: e.type,
          ...(e.eventType ? { TipoEvento: e.eventType } : {}),
          ArquivoXml: gzipBase64(e.xml),
          DataHoraGeracao: e.createdAt,
        })),
        Erros: [],
      },
    };
  }

  function convenio(): Reply {
    return {
      status: 200,
      body: {
        parametrosConvenio: {
          aderenteAmbienteNacional: 1,
          aderenteEmissorNacional: 1,
          situacaoEmissaoPadraoContribuintesRFB: 1,
          aderenteMAN: 0,
          permiteAproveitametoDeCreditos: true,
        },
        mensagem: 'Parâmetros do convênio recuperados com sucesso.',
      },
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/fake-nacional && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Add the CLI and the docs**

`packages/fake-nacional/src/cli.ts`:

```ts
import { startFakeNacional } from './startFakeNacional';

const port = Number(process.argv[2] ?? process.env.FAKE_NACIONAL_PORT ?? 4010);
const fake = await startFakeNacional({ port });
console.log(`Fake Sefin: ${fake.urls.sefin}`);
console.log(`Fake ADN:   ${fake.urls.adn}`);
console.log('Scenarios:  POST /__fake/next {"route":"issue","kind":"delay","ms":31000}');
```

In the root `package.json`, add to `scripts`:

```json
    "fake:nacional": "tsx packages/fake-nacional/src/cli.ts"
```

Run: `pnpm fake:nacional` in one terminal, then in another `curl http://127.0.0.1:4010/adn/parametrizacao/3550308/convenio`
Expected: the JSON with `aderenteEmissorNacional: 1`. Stop the fake with Ctrl+C.

In the root `AGENTS.md` package table, add a row after "National provider":

```markdown
| Fake Sefin and ADN | [packages/fake-nacional/AGENTS.md](packages/fake-nacional/AGENTS.md) |
```

and add to the commands table:

```markdown
| `pnpm fake:nacional` | Local fake of the Sefin and the ADN on port 4010 |
```

In `docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md`, add a packages row:

```markdown
| `packages/fake-nacional` | In-memory fake of the Sefin and the ADN for development and tests. Never in production. |
```

and replace the `InvoiceProvider` paragraph with:

```markdown
**`InvoiceProvider`** is what an invoice system implements. The read side (Stage 1a) checks the connection, fetches documents since a cursor (`fetchSince`), and gets one invoice by access key. Issue and cancel join in Stage 1b. `NacionalProvider` is the national implementation.
```

- [ ] **Step 6: Commit**

```bash
git add packages/fake-nacional package.json AGENTS.md docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md
git commit -m "feat(fake-nacional): events, ADN feed, convenio, scenarios, and the CLI"
```

---

### Task 7: `NacionalProvider` end to end against the fake

**Files:**
- Create: `packages/fake-nacional/src/provider.e2e.test.ts`

**Interfaces:**
- Consumes: `startFakeNacional` and `dpsInput` from `src/testData.ts` (Tasks 5 and 6); `NacionalProvider`, `NacionalClient`, `buildDpsXml`, `buildCancelEventXml` from `@notaflow/provider-nacional`; `NodeSigner`, `loadCertificate` from `@notaflow/signer-node`; `makeTestCertificate` from `@notaflow/test-kit`.
- Produces: nothing new. This task proves Tasks 2 to 6 fit together, and pins Review Focus 5.

This test signs with the real `NodeSigner` and the `rsa-sha256-exc-c14n` profile (the Stage 0 decision), so the XML that reaches the parser has the same shape as in production.

- [ ] **Step 1: Write the test**

`packages/fake-nacional/src/provider.e2e.test.ts`:

```ts
import {
  buildCancelEventXml,
  buildDpsXml,
  type DpsInput,
  NacionalClient,
  NacionalProvider,
} from '@notaflow/provider-nacional';
import { loadCertificate, NodeSigner } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { Agent } from 'undici';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type FakeNacional, startFakeNacional } from './index';
import { dpsInput } from './testData';

const testCert = makeTestCertificate();
const certificate = loadCertificate(testCert.pfx, testCert.password);
const signer = new NodeSigner();
let fake: FakeNacional;
let client: NacionalClient;
let provider: NacionalProvider;

beforeAll(async () => {
  fake = await startFakeNacional();
  client = new NacionalClient({
    environment: 'producao_restrita',
    dispatcher: new Agent(),
    urls: fake.urls,
    timeoutMs: 300,
  });
  provider = new NacionalProvider(client, '12345678000195');
});

afterAll(() => fake.close());

async function issueSigned(input: DpsInput): Promise<string> {
  const signed = await signer.sign({
    xml: buildDpsXml(input).xml,
    elementName: 'infDPS',
    certificate,
    profile: 'rsa-sha256-exc-c14n',
  });
  const result = await client.issue(signed);
  if (result.kind !== 'issued') throw new Error(`not issued: ${JSON.stringify(result)}`);
  return result.accessKey;
}

test('an issued invoice comes back through the ADN feed with every field intact', async () => {
  const accessKey = await issueSigned(dpsInput);
  const batch = await provider.fetchSince(0);
  expect(batch).toMatchObject({ lastNsu: 1, hasMore: true });
  expect(batch.documents[0]).toMatchObject({
    kind: 'invoice',
    nsu: 1,
    invoice: {
      accessKey,
      environment: 'producao_restrita',
      competence: '2026-10-01',
      dps: { series: '900', number: 1 },
      provider: { cnpj: '12345678000195', name: 'EMPRESA TESTE LTDA' },
      customer: { document: { type: 'CNPJ', value: '98765432000110' }, name: 'Cliente Exemplo Ltda' },
      service: { nationalTaxCode: '010101', description: 'Consultoria em análise & ção <teste>' },
      amounts: { serviceCents: 150000, netCents: 150000 },
    },
  });
  expect(await provider.fetchSince(1)).toEqual({ documents: [], lastNsu: 1, hasMore: false });
});

test('a cancellation arrives as an event after the invoice', async () => {
  const accessKey = await issueSigned({ ...dpsInput, number: 2 });
  const signed = await signer.sign({
    xml: buildCancelEventXml({
      environment: 'producao_restrita',
      requestedAt: new Date(),
      appVersion: 'notaflow-test',
      authorCnpj: '12345678000195',
      accessKey,
      reason: '1',
      justification: 'Teste de cancelamento no fake',
    }).xml,
    elementName: 'infPedReg',
    certificate,
    profile: 'rsa-sha256-exc-c14n',
  });
  expect((await client.registerEvent(accessKey, signed)).kind).toBe('registered');
  const events = (await provider.fetchSince(0)).documents.filter((d) => d.kind === 'event');
  expect(events.at(-1)).toMatchObject({
    kind: 'event',
    event: { accessKey, code: '101101', reasonCode: '1' },
  });
});

test('getInvoice finds an issued invoice and returns null for an unknown key', async () => {
  const accessKey = await issueSigned({ ...dpsInput, number: 3 });
  expect((await provider.getInvoice(accessKey))?.accessKey).toBe(accessKey);
  expect(await provider.getInvoice(accessKey.replace(/.$/, '9'))).toBeNull();
});

test('a 429 from the ADN reaches the caller as a retryable error', async () => {
  fake.next('dfe', { kind: 'reply', status: 429, body: {} });
  await expect(provider.fetchSince(0)).rejects.toMatchObject({ status: 429, retryable: true });
});
```

The fake builds the access key with check digit `0`, so `accessKey.replace(/.$/, '9')` is a key the fake never issued.

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run packages/fake-nacional/src/provider.e2e.test.ts`
Expected: PASS. This task adds no production code. If a test fails, the defect is in Tasks 2 to 6: fix it there, with a unit test in that task's file that reproduces the failure first.

- [ ] **Step 3: Prove the test can fail**

Temporarily change `description: 'Consultoria em análise & ção <teste>'` in the first `toMatchObject` to `'Consultoria em analise'`, run the test, and see it fail on `description`. Revert the change.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm test && pnpm typecheck && pnpm lint && pytest services/signer-py`
Expected: PASS, with no test skipped except the openssl test on a machine without openssl.

- [ ] **Step 5: Commit**

```bash
git add packages/fake-nacional/src/provider.e2e.test.ts
git commit -m "test(fake-nacional): NacionalProvider end to end against the fake"
```

---

### Task 8: Read the production ADN, read-only (Lincoln runs it)

**Files:**
- Create: `spikes/2026-10-adn-read/run.ts`
- Modify: `package.json` (root script `spike:adn-read`)
- Modify: `docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md` (results and plan links)

**Interfaces:**
- Consumes: `NacionalProvider`, `NacionalClient`, `createMtlsDispatcher` from `@notaflow/provider-nacional`; `loadCertificate` from `@notaflow/signer-node`.
- Produces: `spikes/2026-10-adn-read/results.local.json` (git-ignored by `spikes/**/results.local.*`) and an RFC section.

This script calls only `fetchSince` and `getInvoice` against `producao`. It never issues and never cancels. It answers four questions with real data:
1. Does `parseNfseXml` read every real invoice of the emitter? (count of `parse error` skips)
2. Is `/DFe/{NSU}` inclusive? (`batches[].firstNsu` equal to `requested` means yes)
3. What `TipoDocumento` values does the ADN send? (the provider maps `NFSE` and `EVENTO` only)
4. Does the production ADN return the emitter's invoices, unlike produção restrita in Stage 0?

- [ ] **Step 1: Write the script**

`spikes/2026-10-adn-read/run.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { createMtlsDispatcher, NacionalClient, NacionalProvider } from '@notaflow/provider-nacional';
import { loadCertificate } from '@notaflow/signer-node';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
};

const certificate = loadCertificate(
  readFileSync(env('NOTAFLOW_PFX_PATH')),
  env('NOTAFLOW_PFX_PASSWORD'),
);
// Read-only: this script calls fetchSince and getInvoice only. It never issues or cancels.
const client = new NacionalClient({
  environment: 'producao',
  dispatcher: createMtlsDispatcher(certificate),
});
const provider = new NacionalProvider(client, certificate.cnpj);

const MAX_BATCHES = 20;
const counts = { invoice: 0, event: 0, skipped: 0 };
const skipReasons: Record<string, number> = {};
const rawTypes = new Set<string>();
const batches: { requested: number; firstNsu: number | null; newDocuments: number }[] = [];
// Local file only: these lines name customers and amounts, so they never go to the RFC.
const invoices: { number: string; competence: string; serviceCents: number; customer: string }[] = [];
let firstAccessKey: string | undefined;
let nsu = 0;

for (let count = 0; count < MAX_BATCHES; count++) {
  const raw = await client.fetchDfe(nsu, certificate.cnpj);
  raw.documents.forEach((document) => rawTypes.add(document.type));
  const batch = await provider.fetchSince(nsu);
  batches.push({
    requested: nsu,
    firstNsu: raw.documents[0]?.nsu ?? null,
    newDocuments: batch.documents.length,
  });
  for (const document of batch.documents) {
    counts[document.kind]++;
    if (document.kind === 'skipped') {
      skipReasons[document.reason] = (skipReasons[document.reason] ?? 0) + 1;
    }
    if (document.kind === 'invoice') {
      firstAccessKey ??= document.invoice.accessKey;
      invoices.push({
        number: document.invoice.number,
        competence: document.invoice.competence,
        serviceCents: document.invoice.amounts.serviceCents,
        customer: document.invoice.customer?.name ?? '(none)',
      });
    }
  }
  console.log(`batch from NSU ${nsu}: ${batch.documents.length} new, lastNsu ${batch.lastNsu}`);
  nsu = batch.lastNsu;
  if (!batch.hasMore) break;
}

const lookup = firstAccessKey
  ? ((await provider.getInvoice(firstAccessKey))?.number ?? 'null')
  : 'no invoice to look up';
const summary = { counts, skipReasons, rawTypes: [...rawTypes], batches, lastNsu: nsu, lookup };
writeFileSync(
  new URL('./results.local.json', import.meta.url),
  JSON.stringify({ ...summary, invoices }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
console.log('Saved spikes/2026-10-adn-read/results.local.json');
```

The script calls `fetchDfe` and `fetchSince` for the same NSU on purpose: the raw call shows what the ADN sends, and the provider call shows what the sync will see. That is two GETs per batch, which is fine for at most 20 batches.

In the root `package.json`, add to `scripts`:

```json
    "spike:adn-read": "tsx --env-file=.env.local spikes/2026-10-adn-read/run.ts"
```

- [ ] **Step 2: Check the script without the network**

Run: `pnpm typecheck && pnpm lint && git check-ignore -v spikes/2026-10-adn-read/results.local.json`
Expected: no error, and `git check-ignore` prints the `spikes/**/results.local.*` rule.

- [ ] **Step 3: Commit the script**

```bash
git add spikes/2026-10-adn-read/run.ts package.json
git commit -m "chore(spike): read-only check of the production ADN with NacionalProvider"
```

- [ ] **Step 4: Lincoln runs the script (manual)**

Lincoln runs `pnpm spike:adn-read` with the `.env.local` of Stage 0 (only `NOTAFLOW_PFX_PATH` and `NOTAFLOW_PFX_PASSWORD` are read).
Expected: one line per batch and a summary. `counts.invoice` is at least the number of invoices Lincoln issued in the Emissor Nacional, and `skipReasons` has no `parse error` entry.

If `skipReasons` has a `parse error`: copy the message, write a synthetic fixture with the same structure (no real data), add a failing test to `parseNfseXml.test.ts`, fix the parser, and run the script again.

- [ ] **Step 5: Record the results in the RFC**

In `RFC_NFSE_EMITTER.md`, add at the end of "Stage 0 Results" a subsection, with counts and facts only (no CNPJ, no access key, no customer name, no amount):

```markdown
### Production ADN read (Stage 1a-1, 2026-10-xx)

- Documents read: N invoices, N events, N skipped (reasons: ...).
- `/DFe/{NSU}` is inclusive / exclusive of NSU: the first document of a batch had NSU equal to / greater than the requested one.
- `TipoDocumento` values seen: ...
- `getInvoice` by access key: worked / failed (...).
```

Fill each line from `results.local.json`. In the "Documentation" section of the RFC, replace `PLANS/2026/10/PLAN_STAGE_1.md` with:

```
  PLANS/2026/10/PLAN_STAGE_1A_1_PROVIDER_READ.md
  PLANS/2026/10/PLAN_STAGE_1A_2_SERVER_FOUNDATION.md
  PLANS/2026/10/PLAN_STAGE_1A_3_SYNC_AND_UI.md
```

In "Testing", add a line:

```markdown
- **Local fake (`packages/fake-nacional`):** an in-memory Sefin and ADN for development and for server integration tests. It copies behavior seen from the real system, such as E0014, E1229, and the JSON 404. It does not check signatures.
```

- [ ] **Step 6: Commit**

```bash
git add docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md
git commit -m "docs(rfc): record the production ADN read and the Stage 1a plans"
```
