import { type Dispatcher, request } from 'undici';
import type { Environment } from '../dps/types';
import { ENDPOINTS } from './endpoints';
import { gunzipBase64, gzipBase64 } from './gzipBase64';

export interface SefinError {
  codigo: string;
  descricao: string;
  complemento?: string;
}

export type IssueResult =
  | { kind: 'issued'; accessKey: string; dpsId: string; nfseXml: string; alerts: SefinError[] }
  | { kind: 'rejected'; dpsId: string; errors: SefinError[] }
  | { kind: 'uncertain'; reason: string; accessKey?: string };

export type DpsLookup = { kind: 'found'; accessKey: string } | { kind: 'not_found' };

export type EventResult =
  { kind: 'registered'; eventXml: string | null } | { kind: 'rejected'; error: SefinError };

export interface DfeDocument {
  nsu: number;
  accessKey: string;
  type: string;
  eventType?: string;
  xml: string;
  createdAt: string;
}

export interface DfeBatch {
  status: 'DOCUMENTOS_LOCALIZADOS' | 'NENHUM_DOCUMENTO_LOCALIZADO' | 'REJEICAO';
  documents: DfeDocument[];
  errors: unknown[];
}

export class NacionalHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly body: unknown,
  ) {
    super(`Unexpected HTTP ${status} from the national NFS-e API`);
    this.name = 'NacionalHttpError';
  }
}

interface RawDfeItem {
  NSU: number;
  ChaveAcesso: string;
  TipoDocumento: string;
  TipoEvento?: string;
  ArquivoXml: string;
  DataHoraGeracao: string;
}

type Json = Record<string, unknown>;

function tryGunzip(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return gunzipBase64(value);
  } catch {
    return null;
  }
}

function httpError(status: number, body: unknown): NacionalHttpError {
  return new NacionalHttpError(status, status >= 500 || status === 429, body);
}

export class NacionalClient {
  private readonly urls: { sefin: string; adn: string };
  private readonly dispatcher: Dispatcher;
  private readonly timeoutMs: number;

  constructor(options: { environment: Environment; dispatcher: Dispatcher; timeoutMs?: number }) {
    this.urls = ENDPOINTS[options.environment];
    this.dispatcher = options.dispatcher;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async issue(signedDpsXml: string): Promise<IssueResult> {
    let response: { status: number; body: unknown };
    try {
      response = await this.call('POST', `${this.urls.sefin}/nfse`, {
        dpsXmlGZipB64: gzipBase64(signedDpsXml),
      });
    } catch (error) {
      return { kind: 'uncertain', reason: error instanceof Error ? error.message : String(error) };
    }
    const body = (response.body ?? {}) as Json;
    if (response.status === 201) {
      // A 201 we cannot read may still be a real invoice, so it is uncertain, never an error.
      if (typeof body.chaveAcesso !== 'string') {
        return { kind: 'uncertain', reason: 'HTTP 201 without an access key' };
      }
      const nfseXml = tryGunzip(body.nfseXmlGZipB64);
      if (nfseXml === null) {
        return {
          kind: 'uncertain',
          reason: 'HTTP 201 without a readable NFS-e XML',
          accessKey: body.chaveAcesso,
        };
      }
      return {
        kind: 'issued',
        accessKey: body.chaveAcesso,
        dpsId: String(body.idDps),
        nfseXml,
        alerts: (body.alertas as SefinError[] | undefined) ?? [],
      };
    }
    if (response.status === 400) {
      // The success body says idDps; the error body says idDPS.
      return {
        kind: 'rejected',
        dpsId: String(body.idDPS ?? body.idDps ?? ''),
        errors: (body.erros as SefinError[] | undefined) ?? [],
      };
    }
    return { kind: 'uncertain', reason: `HTTP ${response.status}` };
  }

  async findByDpsId(dpsId: string): Promise<DpsLookup> {
    const { status, body } = await this.call(
      'GET',
      `${this.urls.sefin}/dps/${encodeURIComponent(dpsId)}`,
    );
    if (status === 200) return { kind: 'found', accessKey: String((body as Json).chaveAcesso) };
    // A proxy or gateway 404 is not an answer about the DPS, so only a JSON body means not found.
    if (status === 404) {
      if (typeof body === 'object' && body !== null && !Array.isArray(body))
        return { kind: 'not_found' };
      throw new NacionalHttpError(status, true, body);
    }
    throw httpError(status, body);
  }

  async getNfse(accessKey: string): Promise<string> {
    const { status, body } = await this.call(
      'GET',
      `${this.urls.sefin}/nfse/${encodeURIComponent(accessKey)}`,
    );
    if (status !== 200) throw httpError(status, body);
    return gunzipBase64(String((body as Json).nfseXmlGZipB64));
  }

  async registerEvent(accessKey: string, signedEventXml: string): Promise<EventResult> {
    const url = `${this.urls.sefin}/nfse/${encodeURIComponent(accessKey)}/eventos`;
    const { status, body } = await this.call('POST', url, {
      pedidoRegistroEventoXmlGZipB64: gzipBase64(signedEventXml),
    });
    const data = (body ?? {}) as Json;
    // The event exists once the Sefin answers 201, even when its XML is unreadable.
    if (status === 201) return { kind: 'registered', eventXml: tryGunzip(data.eventoXmlGZipB64) };
    if (status === 400 || status === 401)
      return { kind: 'rejected', error: data.erro as SefinError };
    throw httpError(status, body);
  }

  async fetchDfe(nsu: number, cnpj: string): Promise<DfeBatch> {
    const url = `${this.urls.adn}/contribuintes/DFe/${nsu}?cnpjConsulta=${encodeURIComponent(cnpj)}&lote=true`;
    const { status, body } = await this.call('GET', url);
    // The ADN answers 400 and 404 with a full batch body, so read the body before the status.
    const data = body as {
      StatusProcessamento?: DfeBatch['status'];
      LoteDFe?: RawDfeItem[];
      Erros?: unknown[];
    } | null;
    if (data?.StatusProcessamento && (status === 200 || status === 400 || status === 404)) {
      return {
        status: data.StatusProcessamento,
        documents: (data.LoteDFe ?? []).map((item) => ({
          nsu: item.NSU,
          accessKey: item.ChaveAcesso,
          type: item.TipoDocumento,
          ...(item.TipoEvento ? { eventType: item.TipoEvento } : {}),
          xml: gunzipBase64(item.ArquivoXml),
          createdAt: item.DataHoraGeracao,
        })),
        errors: data.Erros ?? [],
      };
    }
    throw httpError(status, body);
  }

  async checkConvenio(municipality: string): Promise<unknown> {
    const url = `${this.urls.adn}/parametrizacao/${encodeURIComponent(municipality)}/convenio`;
    const { status, body } = await this.call('GET', url);
    if (status !== 200) throw httpError(status, body);
    return body;
  }

  private async call(
    method: 'GET' | 'POST',
    url: string,
    json?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await request(url, {
      method,
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        accept: 'application/json',
        ...(json ? { 'content-type': 'application/json' } : {}),
      },
      ...(json ? { body: JSON.stringify(json) } : {}),
    });
    const text = await response.body.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Keep the raw text: some 5xx answers are HTML.
    }
    return { status: response.statusCode, body };
  }
}
