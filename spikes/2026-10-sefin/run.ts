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
const client = new NacionalClient({
  environment: 'producao_restrita',
  dispatcher: createMtlsDispatcher(certificate),
});
const nodeSigner = new NodeSigner();
const results: Record<string, unknown> = { certificateNotAfter: certificate.notAfter };
const appVersion = 'notaflow-spike-0';
// Start from the clock so a rerun never reuses a DPS number from an earlier run.
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
    customer: {
      document: { type: 'CNPJ', value: env('NOTAFLOW_CUSTOMER_CNPJ') },
      name: env('NOTAFLOW_CUSTOMER_NAME'),
    },
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

const issued = Object.values(results).find(
  (r): r is { kind: 'issued'; accessKey: string } =>
    typeof r === 'object' && r !== null && (r as { kind?: string }).kind === 'issued',
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
    const signed = await nodeSigner.sign({
      xml,
      elementName: 'infPedReg',
      certificate,
      profile: 'rsa-sha1-c14n',
    });
    return client.registerEvent(issued.accessKey, signed);
  });
}

await step('7_find_by_dps_id_unknown', () => client.findByDpsId(buildDpsXml(dps('never sent')).id));
await step('8_dfe_first_batch', async () => {
  const batch = await client.fetchDfe(0, certificate.cnpj);
  return {
    status: batch.status,
    count: batch.documents.length,
    types: [...new Set(batch.documents.map((d) => d.type))],
  };
});

writeFileSync(new URL('./results.local.json', import.meta.url), JSON.stringify(results, null, 2));
console.log('Saved spikes/2026-10-sefin/results.local.json');
