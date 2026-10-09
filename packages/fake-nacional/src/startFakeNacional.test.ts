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
