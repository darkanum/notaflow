import { expect, test } from 'vitest';
import { isSyncInvoice, type SyncDocument } from '../index';

test('isSyncInvoice tells an invoice document from an event and a skipped one', () => {
  const documents: SyncDocument[] = [
    { kind: 'skipped', nsu: 1, reason: 'received invoice' },
    {
      kind: 'event',
      nsu: 2,
      event: { accessKey: 'K', code: '101101', registeredAt: new Date(0), xml: '<evento/>' },
    },
  ];
  expect(documents.filter(isSyncInvoice)).toEqual([]);
});
