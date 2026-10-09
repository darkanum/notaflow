import { readFileSync, writeFileSync } from 'node:fs';
import {
  createMtlsDispatcher,
  NacionalClient,
  NacionalProvider,
} from '@notaflow/provider-nacional';
import { loadCertificate } from '@notaflow/signer-node';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
};

const certificate = loadCertificate(
  readFileSync(env('NOTAFLOW_PFX_PATH')),
  env('NOTAFLOW_PFX_PASSWORD'),
);
// Read-only: this script calls fetchSince and getInvoice only. It never issues or cancels.
const client = new NacionalClient({
  environment: 'producao',
  dispatcher: createMtlsDispatcher(certificate),
});
const provider = new NacionalProvider(client, certificate.cnpj);

const MAX_BATCHES = 20;
const counts = { invoice: 0, event: 0, skipped: 0 };
const skipReasons: Record<string, number> = {};
const rawTypes = new Set<string>();
const batches: { requested: number; firstNsu: number | null; newDocuments: number }[] = [];
// Local file only: these lines name customers and amounts, so they never go to the RFC.
const invoices: {
  number: string;
  competence: string;
  serviceCents: number;
  customer: string;
}[] = [];
let firstAccessKey: string | undefined;
let nsu = 0;

for (let count = 0; count < MAX_BATCHES; count++) {
  const raw = await client.fetchDfe(nsu, certificate.cnpj);
  raw.documents.forEach((document) => rawTypes.add(document.type));
  const batch = await provider.fetchSince(nsu);
  batches.push({
    requested: nsu,
    firstNsu: raw.documents[0]?.nsu ?? null,
    newDocuments: batch.documents.length,
  });
  for (const document of batch.documents) {
    counts[document.kind]++;
    if (document.kind === 'skipped') {
      skipReasons[document.reason] = (skipReasons[document.reason] ?? 0) + 1;
    }
    if (document.kind === 'invoice') {
      firstAccessKey ??= document.invoice.accessKey;
      invoices.push({
        number: document.invoice.number,
        competence: document.invoice.competence,
        serviceCents: document.invoice.amounts.serviceCents,
        customer: document.invoice.customer?.name ?? '(none)',
      });
    }
  }
  console.log(`batch from NSU ${nsu}: ${batch.documents.length} new, lastNsu ${batch.lastNsu}`);
  nsu = batch.lastNsu;
  if (!batch.hasMore) break;
}

const lookup = firstAccessKey
  ? ((await provider.getInvoice(firstAccessKey))?.number ?? 'null')
  : 'no invoice to look up';
const summary = { counts, skipReasons, rawTypes: [...rawTypes], batches, lastNsu: nsu, lookup };
writeFileSync(
  new URL('./results.local.json', import.meta.url),
  JSON.stringify({ ...summary, invoices }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
console.log('Saved spikes/2026-10-adn-read/results.local.json');
