import {
  buildCancelEventXml,
  buildDpsXml,
  type DpsInput,
  gzipBase64,
  NacionalClient,
} from '@notaflow/provider-nacional';
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
    expect(result.nfseXml).toContain(
      '<xDescServ>Consultoria em análise &amp; ção &lt;teste&gt;</xDescServ>',
    );
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
    expect(result.kind === 'registered' && result.eventXml).toContain(
      `<chNFSe>${accessKey}</chNFSe>`,
    );
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
