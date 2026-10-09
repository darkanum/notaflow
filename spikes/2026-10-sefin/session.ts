import { readFileSync } from 'node:fs';
import {
  buildCancelEventXml,
  createMtlsDispatcher,
  NacionalClient,
  type EventResult,
} from '@notaflow/provider-nacional';
import { loadCertificate, NodeSigner } from '@notaflow/signer-node';

export const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
};

export const pfx = readFileSync(env('NOTAFLOW_PFX_PATH'));
export const password = env('NOTAFLOW_PFX_PASSWORD');
export const certificate = loadCertificate(pfx, password);
export const client = new NacionalClient({
  environment: 'producao_restrita',
  dispatcher: createMtlsDispatcher(certificate),
});
export const nodeSigner = new NodeSigner();
export const appVersion = 'notaflow-spike-0';
export const RESULTS_URL = new URL('./results.local.json', import.meta.url);

export async function cancelInvoice(accessKey: string): Promise<EventResult> {
  const { xml } = buildCancelEventXml({
    environment: 'producao_restrita',
    requestedAt: new Date(Date.now() - 60_000),
    appVersion,
    authorCnpj: certificate.cnpj,
    accessKey,
    reason: '1',
    justification: 'Teste de cancelamento do spike NotaFlow',
  });
  const signed = await nodeSigner.sign({
    xml,
    elementName: 'infPedReg',
    certificate,
    profile: 'rsa-sha256-exc-c14n',
  });
  return client.registerEvent(accessKey, signed);
}

// Every invoice the spike issues must be cancelled, so this walks nested step results too.
export function issuedKeys(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as { kind?: unknown; accessKey?: unknown };
  if (record.kind === 'issued' && typeof record.accessKey === 'string') return [record.accessKey];
  return Object.values(value).flatMap(issuedKeys);
}
