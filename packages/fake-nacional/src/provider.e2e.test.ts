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
      customer: {
        document: { type: 'CNPJ', value: '98765432000110' },
        name: 'Cliente Exemplo Ltda',
      },
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
