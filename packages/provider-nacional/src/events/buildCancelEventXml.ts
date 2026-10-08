import { NFSE_NAMESPACE, SCHEMA_VERSION } from '../dps/buildDpsXml';
import type { Environment } from '../dps/types';
import { escapeXml } from '../xml/escapeXml';
import { formatBrasiliaDateTime } from '../xml/formatters';

export type CancelReason = '1' | '2' | '9';

export interface CancelEventInput {
  environment: Environment;
  requestedAt: Date;
  appVersion: string;
  authorCnpj: string;
  accessKey: string; // 50 characters, TSChaveNFSe
  reason: CancelReason;
  justification: string;
}

const CANCEL_EVENT_CODE = '101101';
// The event Id pattern (TSIdPedRegEvt) is stricter than TSChaveNFSe: type 1 = CPF, 2 = CNPJ (may hold letters).
const ACCESS_KEY = /^[0-9]{8}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{27}$/;

export function buildCancelEventXml(input: CancelEventInput): { id: string; xml: string } {
  if (!ACCESS_KEY.test(input.accessKey)) throw new RangeError('Invalid access key.');
  const justification = input.justification.trim();
  if (justification.length < 15 || justification.length > 255) {
    throw new RangeError('The justification must have 15 to 255 characters.');
  }

  const id = `PRE${input.accessKey}${CANCEL_EVENT_CODE}`;
  const xml =
    `<pedRegEvento xmlns="${NFSE_NAMESPACE}" versao="${SCHEMA_VERSION}">` +
    `<infPedReg Id="${id}">` +
    `<tpAmb>${input.environment === 'producao' ? '1' : '2'}</tpAmb>` +
    `<verAplic>${escapeXml(input.appVersion)}</verAplic>` +
    `<dhEvento>${formatBrasiliaDateTime(input.requestedAt)}</dhEvento>` +
    `<CNPJAutor>${escapeXml(input.authorCnpj)}</CNPJAutor>` +
    `<chNFSe>${input.accessKey}</chNFSe>` +
    `<e${CANCEL_EVENT_CODE}>` +
    `<xDesc>Cancelamento de NFS-e</xDesc>` +
    `<cMotivo>${input.reason}</cMotivo>` +
    `<xMotivo>${escapeXml(justification)}</xMotivo>` +
    `</e${CANCEL_EVENT_CODE}>` +
    `</infPedReg></pedRegEvento>`;

  return { id, xml };
}
