# ADN Sync

The server copies every invoice and event of each emitter from the ADN into SQLite. The ADN is the source of truth and the backup: after a database loss, a sync from NSU 0 rebuilds invoices, events, and imported customers.

## Flow

1. `SyncService.syncEmitter` reads the emitter's environment and the cursor (last NSU) of that environment. Production and produção restrita are separate ADNs, so each has its own cursor.
2. It calls `InvoiceProvider.fetchSince(cursor)`. A 429, a 5xx, or a network error is retried after 1, 5, and 15 seconds.
3. In one transaction it applies the batch (`applyDocument`) and saves the new cursor. A crash resumes from the last committed batch.
4. It repeats until the ADN has nothing new, then records the run in `sync_state`.

## Documents

- An NFS-e of the emitter: upsert the invoice by access key and the customer by document.
- An event: stored by access key, also before its invoice exists. A cancellation (101101) sets the invoice to `cancelled`.
- A skipped document (an invoice the emitter received, an unknown type, or a file that does not parse): counted; the cursor still moves.
- A customer field edited by hand is never overwritten.

## When it runs

- Every 30 minutes for every emitter (`startScheduler` in `main.ts`).
- Right after onboarding.
- On "Sincronizar agora" (`POST /api/accounts/:accountId/emitters/:emitterId/sync`). One sync per emitter at a time; a second request answers 409 `sync_running`.

## Find by access key

`POST /api/accounts/:accountId/invoices/lookup` reads the issuer CNPJ from the key, refuses a key of a CNPJ that is not an emitter of the account (404, without calling the Sefin), gets the invoice from the Sefin, and stores it through the same `applyDocument` path.

Code: `apps/server/src/sync/`.
