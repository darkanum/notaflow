import { loadCertificate } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { Agent, MockAgent } from 'undici';
import { beforeEach, describe, expect, test } from 'vitest';
import { createMtlsDispatcher } from './createMtlsDispatcher';
import { gunzipBase64, gzipBase64 } from './gzipBase64';
import { NacionalClient } from './NacionalClient';

const SEFIN = 'https://sefin.producaorestrita.nfse.gov.br';
const ADN = 'https://adn.producaorestrita.nfse.gov.br';
const KEY = '3'.repeat(50);
const DPS_ID = 'DPS355030821234567800019500900000000000000001';
const DFE_PATH = (nsu: number) => `/contribuintes/DFe/${nsu}?cnpjConsulta=12345678000195&lote=true`;

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

test('createMtlsDispatcher builds an Agent from PEM material', () => {
  const testCert = makeTestCertificate();
  expect(createMtlsDispatcher(loadCertificate(testCert.pfx, testCert.password))).toBeInstanceOf(Agent);
});

describe('issue', () => {
  test('201 returns issued with the decompressed NFS-e', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(201, {
      idDps: DPS_ID,
      chaveAcesso: KEY,
      nfseXmlGZipB64: gzipBase64('<NFSe/>'),
      alertas: [],
    });
    expect(await client.issue('<DPS/>')).toEqual({
      kind: 'issued',
      accessKey: KEY,
      dpsId: DPS_ID,
      nfseXml: '<NFSe/>',
      alerts: [],
    });
  });

  test('sends the DPS as gzip + base64 in dpsXmlGZipB64', async () => {
    let body = '';
    agent
      .get(SEFIN)
      .intercept({
        path: '/SefinNacional/nfse',
        method: 'POST',
        body: (b) => {
          body = b;
          return true;
        },
      })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64('<NFSe/>') });
    await client.issue('<DPS>ç</DPS>');
    expect(gunzipBase64((JSON.parse(body) as { dpsXmlGZipB64: string }).dpsXmlGZipB64)).toBe('<DPS>ç</DPS>');
  });

  test('400 returns rejected with the Sefin errors', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(400, { idDPS: DPS_ID, erros: [{ codigo: 'E0014', descricao: 'DPS duplicada' }] });
    expect(await client.issue('<DPS/>')).toEqual({
      kind: 'rejected',
      dpsId: DPS_ID,
      errors: [{ codigo: 'E0014', descricao: 'DPS duplicada' }],
    });
  });

  test('500 returns uncertain', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(500, 'boom');
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });

  test('a 201 without an access key returns uncertain', async () => {
    agent.get(SEFIN).intercept({ path: '/SefinNacional/nfse', method: 'POST' }).reply(201, {});
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });

  test('a timeout returns uncertain', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: '/SefinNacional/nfse', method: 'POST' })
      .reply(201, { idDps: DPS_ID, chaveAcesso: KEY, nfseXmlGZipB64: gzipBase64('<NFSe/>') })
      .delay(1000);
    expect((await client.issue('<DPS/>')).kind).toBe('uncertain');
  });
});

describe('findByDpsId', () => {
  test('200 returns found', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' })
      .reply(200, { idDps: DPS_ID, chaveAcesso: KEY });
    expect(await client.findByDpsId(DPS_ID)).toEqual({ kind: 'found', accessKey: KEY });
  });

  test('404 returns not_found', async () => {
    agent.get(SEFIN).intercept({ path: `/SefinNacional/dps/${DPS_ID}`, method: 'GET' }).reply(404, {});
    expect(await client.findByDpsId(DPS_ID)).toEqual({ kind: 'not_found' });
  });
});

describe('registerEvent', () => {
  test('201 returns registered', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(201, { eventoXmlGZipB64: gzipBase64('<evento/>') });
    expect(await client.registerEvent(KEY, '<pedRegEvento/>')).toEqual({ kind: 'registered', eventXml: '<evento/>' });
  });

  test('400 returns rejected with the single erro object', async () => {
    agent
      .get(SEFIN)
      .intercept({ path: `/SefinNacional/nfse/${KEY}/eventos`, method: 'POST' })
      .reply(400, { erro: { codigo: 'E1234', descricao: 'Prazo expirado' } });
    expect(await client.registerEvent(KEY, '<x/>')).toEqual({
      kind: 'rejected',
      error: { codigo: 'E1234', descricao: 'Prazo expirado' },
    });
  });
});

describe('fetchDfe', () => {
  test('decodes each document', async () => {
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
            ArquivoXml: gzipBase64('<NFSe/>'),
            DataHoraGeracao: '2026-10-08T10:00:00',
          },
        ],
        Erros: [],
      });
    const batch = await client.fetchDfe(0, '12345678000195');
    expect(batch.status).toBe('DOCUMENTOS_LOCALIZADOS');
    expect(batch.documents).toEqual([
      { nsu: 1, accessKey: KEY, type: 'NFSE', xml: '<NFSe/>', createdAt: '2026-10-08T10:00:00' },
    ]);
  });

  test('404 with NENHUM_DOCUMENTO_LOCALIZADO is an empty batch, not an error', async () => {
    agent
      .get(ADN)
      .intercept({ path: DFE_PATH(42), method: 'GET' })
      .reply(404, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [], Erros: [] });
    expect(await client.fetchDfe(42, '12345678000195')).toEqual({
      status: 'NENHUM_DOCUMENTO_LOCALIZADO',
      documents: [],
      errors: [],
    });
  });

  test('429 throws a retryable error', async () => {
    agent.get(ADN).intercept({ path: DFE_PATH(0), method: 'GET' }).reply(429, {});
    await expect(client.fetchDfe(0, '12345678000195')).rejects.toMatchObject({ retryable: true });
  });
});
