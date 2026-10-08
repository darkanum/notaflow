import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildDpsXml,
  formatBrasiliaDate,
  type DpsInput,
  type ForeignTrade,
  type IssueResult,
} from '@notaflow/provider-nacional';
import {
  appVersion,
  cancelInvoice,
  certificate,
  client,
  env,
  issuedKeys,
  nodeSigner,
  password,
  pfx,
  RESULTS_URL,
} from './session';

const results: Record<string, unknown> = { certificateNotAfter: certificate.notAfter };
// Start from the clock so a rerun never reuses a DPS number from an earlier run.
let nextNumber = Math.floor(Date.now() / 1000) % 1_000_000_000;

function dps(description: string, serviceCents = 1000): DpsInput {
  const issuedAt = new Date(Date.now() - 60_000);
  return {
    environment: 'producao_restrita',
    issuedAt,
    appVersion,
    series: env('NOTAFLOW_DPS_SERIES'),
    number: nextNumber++,
    competence: formatBrasiliaDate(issuedAt),
    emitterMunicipality: env('NOTAFLOW_EMITTER_MUNICIPALITY'),
    provider: {
      cnpj: certificate.cnpj,
      ...(process.env.NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION
        ? { municipalRegistration: process.env.NOTAFLOW_EMITTER_MUNICIPAL_REGISTRATION }
        : {}),
      simplesNacional: env('NOTAFLOW_SIMPLES_NACIONAL') as DpsInput['provider']['simplesNacional'],
      ...(process.env.NOTAFLOW_SIMPLES_REGIME
        ? {
            simplesRegime: process.env.NOTAFLOW_SIMPLES_REGIME as NonNullable<
              DpsInput['provider']['simplesRegime']
            >,
          }
        : {}),
      specialRegime: env('NOTAFLOW_SPECIAL_REGIME') as DpsInput['provider']['specialRegime'],
    },
    ...(foreignCustomer ? exportParts() : domesticParts()),
    service: {
      municipality: env('NOTAFLOW_EMITTER_MUNICIPALITY'),
      nationalTaxCode: env('NOTAFLOW_SERVICE_NATIONAL_CODE'),
      description,
      ...(process.env.NOTAFLOW_SERVICE_NBS ? { nbsCode: process.env.NOTAFLOW_SERVICE_NBS } : {}),
      ...(foreignCustomer ? { foreignTrade: foreignTrade(serviceCents) } : {}),
    },
    amounts: { serviceCents },
  };
}

// With a NIF the spike mirrors the emitter's real export invoice; without it, a domestic one.
const foreignCustomer = Boolean(process.env.NOTAFLOW_CUSTOMER_NIF);

function domesticParts(): Pick<DpsInput, 'customer' | 'tax'> {
  return {
    customer: {
      document: { type: 'CNPJ', value: env('NOTAFLOW_CUSTOMER_CNPJ') },
      name: env('NOTAFLOW_CUSTOMER_NAME'),
    },
    tax: { issqnTaxation: '1', issRetention: '1' },
  };
}

function exportParts(): Pick<DpsInput, 'customer' | 'tax' | 'ibsCbs'> {
  const country = env('NOTAFLOW_CUSTOMER_COUNTRY');
  return {
    customer: {
      document: { type: 'NIF', value: env('NOTAFLOW_CUSTOMER_NIF') },
      name: env('NOTAFLOW_CUSTOMER_NAME'),
      address: {
        country,
        postalCode: env('NOTAFLOW_CUSTOMER_POSTAL_CODE'),
        city: env('NOTAFLOW_CUSTOMER_CITY'),
        region: env('NOTAFLOW_CUSTOMER_REGION'),
        street: env('NOTAFLOW_CUSTOMER_STREET'),
        number: env('NOTAFLOW_CUSTOMER_NUMBER'),
        district: env('NOTAFLOW_CUSTOMER_DISTRICT'),
      },
    },
    tax: {
      issqnTaxation: '3',
      resultCountry: country,
      issRetention: '1',
      pisCofins: { cst: '00', retention: '0' },
      ...(process.env.NOTAFLOW_SIMPLES_TOTAL_PERCENT
        ? { simplesTotalPercent: process.env.NOTAFLOW_SIMPLES_TOTAL_PERCENT }
        : {}),
    },
    ibsCbs: {
      purpose: '0',
      finalConsumer: '0',
      operationCode: '100302',
      destination: '0',
      cst: '410',
      classCode: '410027',
    },
  };
}

function foreignTrade(serviceCents: number): ForeignTrade {
  return {
    mode: '1',
    providerLink: '0',
    currency: '220',
    // A rough BRL to USD rate is enough for the spike; the Sefin does not check it.
    amountInCurrencyCents: Math.round(serviceCents / 5),
    providerSupport: '02',
    customerSupport: '02',
    temporaryGoods: '1',
    mdic: '0',
  };
}

function pythonSign(xml: string, elementId: string, profile: string): string {
  const result = spawnSync(process.env.PYTHON ?? 'python', ['-m', 'notaflow_signer.cli', 'sign'], {
    cwd: fileURLToPath(new URL('../../services/signer-py', import.meta.url)),
    input: JSON.stringify({
      xml,
      pfx_b64: pfx.toString('base64'),
      password,
      element_id: elementId,
      profile,
    }),
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
    return summary(
      await client.issue(
        await nodeSigner.sign({ xml, elementName: 'infDPS', certificate, profile }),
      ),
    );
  });
  await step(`3_python_${profile}`, async () => {
    const { id, xml } = buildDpsXml(dps(`Spike NotaFlow python ${profile} ação`));
    return summary(await client.issue(pythonSign(xml, id, profile)));
  });
}

await step('4_reuse_after_rejection', async () => {
  // A zero service amount should be rejected; then the same DPS number goes again, valid.
  const input = dps('Spike reuse', 0);
  const sign = (i: DpsInput) =>
    nodeSigner.sign({
      xml: buildDpsXml(i).xml,
      elementName: 'infDPS',
      certificate,
      profile: 'rsa-sha1-c14n',
    });
  const first = await client.issue(await sign(input));
  const retry: DpsInput = {
    ...input,
    amounts: { serviceCents: 1000 },
    issuedAt: new Date(Date.now() - 60_000),
  };
  const second = await client.issue(await sign(retry));
  return { first: summary(first), secondSameNumber: summary(second) };
});

const issued = [...new Set(issuedKeys(results))];
const first = issued[0];

if (first) {
  await step('5_get_nfse', async () => (await client.getNfse(first)).slice(0, 200));
}
// Every issued invoice is cancelled; produção restrita invoices must not stay active.
await step('6_cancel', async () => {
  const cancelled: Record<string, unknown> = {};
  for (const accessKey of issued) {
    try {
      cancelled[accessKey] = await cancelInvoice(accessKey);
    } catch (error) {
      cancelled[accessKey] = { thrown: error instanceof Error ? error.message : String(error) };
    }
  }
  return cancelled;
});

await step('7_find_by_dps_id_unknown', () => client.findByDpsId(buildDpsXml(dps('never sent')).id));
await step('8_dfe_first_batch', async () => {
  const batch = await client.fetchDfe(0, certificate.cnpj);
  return {
    status: batch.status,
    count: batch.documents.length,
    types: [...new Set(batch.documents.map((d) => d.type))],
  };
});

const cancelResults = (results['6_cancel'] ?? {}) as Record<string, { kind?: string }>;
console.log(`Issued (${issued.length}):`, issued.join(', ') || 'none');
console.log(
  'Cancelled:',
  issued.filter((key) => cancelResults[key]?.kind === 'registered').join(', ') || 'none',
);
console.log(
  'NOT cancelled, run pnpm spike:sefin:cancel:',
  issued.filter((key) => cancelResults[key]?.kind !== 'registered').join(', ') || 'none',
);

writeFileSync(RESULTS_URL, JSON.stringify(results, null, 2));
console.log('Saved spikes/2026-10-sefin/results.local.json');
