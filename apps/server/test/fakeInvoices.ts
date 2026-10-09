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

// The synthetic export invoice of the provider fixture NFSE_EXPORT_FULL.xml, as DPS number 6.
export const exportInput: DpsInput = {
  environment: 'producao_restrita',
  issuedAt: new Date('2026-09-02T16:12:54Z'),
  appVersion: 'notaflow-test',
  series: '900',
  number: 6,
  competence: '2026-08-31',
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
  amounts: { serviceCents: 1086420 },
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

export async function issueExportOnFake(
  fake: Pick<FakeNacional, 'urls'>,
  overrides: Partial<DpsInput> = {},
): Promise<string> {
  const result = await clientFor(fake).issue(buildDpsXml({ ...exportInput, ...overrides }).xml);
  if (result.kind !== 'issued') throw new Error(`fake did not issue: ${JSON.stringify(result)}`);
  return result.accessKey;
}
