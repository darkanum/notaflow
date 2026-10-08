export { buildDpsId } from './dps/buildDpsId';
export { buildDpsXml, NFSE_NAMESPACE, SCHEMA_VERSION } from './dps/buildDpsXml';
export type { Address, DpsInput, Environment, ForeignAddress, ForeignTrade } from './dps/types';
export { escapeXml } from './xml/escapeXml';
export { centsToDecimal, formatBrasiliaDate, formatBrasiliaDateTime } from './xml/formatters';
export { buildCancelEventXml } from './events/buildCancelEventXml';
export type { CancelEventInput, CancelReason } from './events/buildCancelEventXml';
export { createMtlsDispatcher } from './http/createMtlsDispatcher';
export { ENDPOINTS } from './http/endpoints';
export { gunzipBase64, gzipBase64 } from './http/gzipBase64';
export { NacionalClient, NacionalHttpError } from './http/NacionalClient';
export type {
  DfeBatch,
  DfeDocument,
  DpsLookup,
  EventResult,
  IssueResult,
  SefinError,
} from './http/NacionalClient';
