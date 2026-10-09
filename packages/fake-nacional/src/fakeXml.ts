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
  if (!id || !cnpj || !municipality || !serviceAmount) {
    throw new Error('Not a DPS the fake can read.');
  }
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
