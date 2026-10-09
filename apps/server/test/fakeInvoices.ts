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

function clientFor(fake: Pick<FakeNacional, 'urls'>) {
  return new NacionalClient({
    environment: 'producao_restrita',
    dispatcher: new Agent(),
    urls: fake.urls,
  });
}

// The fake does not check signatures, so these DPS are sent unsigned.
export async function issueOnFake(
  fake: Pick<FakeNacional, 'urls'>,
  count: number,
  start = 1,
): Promise<string[]> {
  const client = clientFor(fake);
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
  const { xml } = buildCancelEventXml({
    environment: 'producao_restrita',
    requestedAt: new Date(),
    appVersion: 'notaflow-test',
    authorCnpj: '12345678000195',
    accessKey,
    reason: '1',
    justification: 'Teste de cancelamento no fake',
  });
  const result = await clientFor(fake).registerEvent(accessKey, xml);
  if (result.kind !== 'registered') throw new Error('fake did not cancel');
}
