# Invoice Lifecycle

The server issues a new NFS-e by copying a stored one ("issue similar"), protects every issue against duplicates with a pending row and a lookup by DPS id, and cancels an issued invoice. The screens come in Stage 1b-2; this page describes the API and its rules.

## Status

```
pending ──► issued ──► cancelled
   │
   ├──► rejected
   └──► unknown ──► issued | rejected   (after reconciliation)
```

A synced invoice starts as `issued` or `cancelled`. Only an invoice issued by the app passes through `pending`, `rejected`, or `unknown`.

## Issue

`POST /api/accounts/:accountId/invoices/issue` with the template invoice, the competence, the amounts, and optionally a new description and a stored customer.

1. **Template.** The stored XML of an `issued` or `cancelled` invoice is read by `readTemplate`. Every fiscal group is copied as it is: ISS taxation, PIS/COFINS, Simples, `IBSCBS`, `comExt`. A field that the DPS builder cannot write is refused with 422 `template_unsupported` and the field paths. The template never loses a field in silence.
2. **Checks, before anything is reserved.** The service amount is above zero (the Sefin accepts zero, so the app refuses it). An export template needs the amount in the foreign currency. The competence is not after today in Brasília. The emitter has an active certificate. A chosen customer has a document.
3. **Reserve.** In one transaction: the next DPS number of the emitter, a `pending` row with the DPS id, and an audit entry. The number is never one that the emitter already used in its series, also for invoices issued before the app.
4. **Send.** The DPS is built from the template, signed (Node signer, `rsa-sha256-exc-c14n`), and sent. The issue date is now minus 60 seconds, because the Sefin refuses a future date.
5. **Outcome.**
   - Issued: the row gets the access key, the number, and the XML; the customer register is updated.
   - Rejected: the row keeps the Sefin codes and messages. This is a normal answer (201 with `status: 'rejected'`), because the row exists.
   - Uncertain (timeout, 5xx, network): the row becomes `unknown`.

## E0014

E0014 means "an NFS-e already exists for this DPS". The issuer then looks the invoice up by DPS id and returns it. The service accepts it only when its competence, amount, description, and customer document match the pending row (`isOwnInvoice`). Otherwise another system used that DPS number, and the row becomes `rejected` with E0014, so the user issues again with the next number.

## Reconcile

`POST /api/accounts/:accountId/invoices/:invoiceId/reconcile`, for a `pending` or `unknown` row, always in the row's own environment (the emitter may have switched since):

1. `GET /dps/{id}` at the Sefin. Found: the row becomes `issued`, after the same check as above.
2. Not found: the app resends the **same** DPS number with a fresh issue date. The pending row keeps everything the resend needs, including the foreign amount.
3. Still uncertain: the row stays `unknown`.

The app never resends blindly. The ADN sync can also complete an `unknown` row: an invoice with the same emitter and DPS id takes over that row instead of adding a second one, after the same `isOwnInvoice` check. When the check fails, the row becomes `rejected` with E0014 and the synced invoice gets its own row.

## Cancel

`POST /api/accounts/:accountId/invoices/:invoiceId/cancel` with the reason (1, 2, or 9) and a justification of 15 to 255 characters after trimming. The event goes to the Sefin in the invoice's own environment. A registered event is stored and the invoice becomes `cancelled`, also when the event XML is unreadable. A Sefin refusal is 422 `sefin_rejected` with its code and message; the invoice stays `issued`.

## Export amount (PTAX)

For an export invoice, the BRL amount is suggested from the PTAX **sell** rate of the **closing bulletin** ("Fechamento PTAX") of the Banco Central on the competence date. Without a closing bulletin on that date (a weekend or a holiday), the rate of the last business day before it is used, and the answer names that date. The user can always change the BRL amount.

Evidence: one real export invoice of the first emitter used exactly this rate. Two earlier ones match no PTAX closing rate, probably a bank contract rate. That is why the amount stays editable.

`GET /api/accounts/:accountId/exchange-rate?currency=220&date=YYYY-MM-DD` returns the rate. Rates are integers scaled by 10 000 (`54321` for 5.4321), so no float touches money.

## Customers

`PUT /api/accounts/:accountId/customers/:customerId` edits name, email, phone, municipal registration, and address. Every field sent becomes a manual field, which the sync never overwrites.

Code: `apps/server/src/issue/`, `packages/provider-nacional/src/template/`, `packages/provider-nacional/src/NacionalIssuer.ts`.
