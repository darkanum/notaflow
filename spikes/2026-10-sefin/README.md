# Spike: Sefin Produção Restrita (2026-10)

This spike proves, against the national test environment, that NotaFlow can sign, issue, query, and cancel an NFS-e. It runs only in produção restrita. The invoices there have no fiscal value.

## Steps

1. Connection test: `GET /parametrizacao/{cMun}/convenio` over mTLS.
2. Issue a DPS signed by the Node signer, with each profile (`rsa-sha1-c14n`, `rsa-sha256-exc-c14n`).
3. Issue a DPS signed by the Python signer, with each profile.
4. Send a DPS that the Sefin should reject, then send the same DPS number again, valid. This shows if a rejected number can be reused.
5. Read back the first issued NFS-e by access key.
6. Cancel that NFS-e.
7. Query a DPS id that was never sent. The expected answer is `not_found`.
8. Read the first ADN batch (`/DFe/0`).

## Run it

1. Copy `.env.example` to `.env.local` at the repo root and fill it. Keep the `.pfx` outside the repo.
2. Install the Python signer once: `pip install -e "services/signer-py[test]"`.
3. Run `pnpm spike:sefin`.

The script writes `spikes/2026-10-sefin/results.local.json`. It holds real data (CNPJ, access keys), so git ignores it. Never commit it. Copy only sanitized conclusions into the RFC.
