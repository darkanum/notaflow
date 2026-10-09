import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import {
  buildDpsXml,
  readTemplate,
  TemplateUnsupportedError,
} from '@notaflow/provider-nacional';

// Read-only, local database. Prints invoice numbers and tag names only: no amount, key, or name.
const db = new DatabaseSync('apps/server/data/notaflow.db', { readOnly: true });
const rows = db
  .prepare('SELECT number, xml_gzip FROM invoices WHERE xml_gzip IS NOT NULL ORDER BY number')
  .all() as { number: string | null; xml_gzip: Uint8Array }[];

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function infDps(xml: string): string {
  const match = /<infDPS[\s>][\s\S]*<\/infDPS>/.exec(xml);
  if (!match) throw new Error('no infDPS');
  return match[0];
}

// Leaf tag=value pairs; numbers compare by value, so 10.5 and 10.50 are the same.
function leaves(xml: string): string[] {
  return [...xml.matchAll(/<(\w+)>([^<]*)<\/\1>/g)]
    .map(([, tag, raw]) => {
      const value = (raw ?? '').replace(/&(\w+);/g, (all, name: string) => ENTITIES[name] ?? all);
      return `${tag}=${/^\d+\.\d+$/.test(value) ? Number(value) : value}`;
    })
    .sort();
}

function leaf(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  if (!match?.[1]) throw new Error(`no ${tag}`);
  return match[1];
}

for (const row of rows) {
  const label = row.number ?? '(no number)';
  const xml = gunzipSync(row.xml_gzip).toString('utf8');
  let template;
  try {
    template = readTemplate(xml);
  } catch (error) {
    const detail =
      error instanceof TemplateUnsupportedError ? `unsupported ${error.paths.join(', ')}` : 'unreadable';
    console.log(`${label}: ${detail}`);
    continue;
  }
  const source = infDps(xml);
  const { serviceCents, ...rest } = template;
  const rebuilt = infDps(
    buildDpsXml({
      ...rest,
      environment: leaf(source, 'tpAmb') === '1' ? 'producao' : 'producao_restrita',
      issuedAt: new Date(leaf(source, 'dhEmi')),
      appVersion: leaf(source, 'verAplic'),
      series: leaf(source, 'serie'),
      number: Number(leaf(source, 'nDPS')),
      competence: leaf(source, 'dCompet'),
      amounts: { serviceCents },
    }).xml,
  );
  const want = leaves(source);
  const got = leaves(rebuilt);
  const differing = [
    ...want.filter((pair) => !got.includes(pair)),
    ...got.filter((pair) => !want.includes(pair)),
  ].map((pair) => pair.split('=')[0]);
  console.log(
    `${label}: ok, round trip: ${differing.length === 0 ? 'same' : `differs in ${[...new Set(differing)].join(', ')}`}`,
  );
}
db.close();
