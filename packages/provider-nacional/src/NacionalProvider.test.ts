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
  replyBatch(0, [item(1, 'NFSE', '<broken'), item(2, 'NFSE', readFixture('NFSE_DOMESTIC.xml'))]);
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
    .reply(200, {
      chaveAcesso: KEY,
      nfseXmlGZipB64: gzipBase64(readFixture('NFSE_DOMESTIC.xml')),
    });
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
