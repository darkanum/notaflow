import { readFileSync, writeFileSync } from 'node:fs';
import { cancelInvoice, issuedKeys, RESULTS_URL } from './session';

// Cancels every invoice a spike run issued and left active; a cancelled one answers rejected.
const results = JSON.parse(readFileSync(RESULTS_URL, 'utf8')) as Record<string, unknown>;
const { cancellations: _previous, ...steps } = results;
const cancellations: Record<string, unknown> = {};

for (const accessKey of [...new Set(issuedKeys(steps))]) {
  try {
    const result = await cancelInvoice(accessKey);
    cancellations[accessKey] =
      result.kind === 'registered'
        ? { kind: 'registered' }
        : { kind: 'rejected', error: result.error };
  } catch (error) {
    cancellations[accessKey] = { thrown: error instanceof Error ? error.message : String(error) };
  }
  console.log('cancel', accessKey.slice(-6), JSON.stringify(cancellations[accessKey]));
}

writeFileSync(RESULTS_URL, JSON.stringify({ ...results, cancellations }, null, 2));
console.log('Saved the cancellations in spikes/2026-10-sefin/results.local.json');
