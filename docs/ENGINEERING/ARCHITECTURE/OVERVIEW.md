# Architecture Overview

NotaFlow is one app container behind a Cloudflare tunnel. A Fastify server holds the domain, the certificate vault, and the jobs, and it serves the React UI. Each invoice system is a provider package behind a port. The full design is in the [RFC](../RFCS/2026/10/RFC_NFSE_EMITTER.md).

```
nfse.vapulab.com
   │  Cloudflare Access (email one-time PIN now, Google later)
   ▼
cloudflared ──► server (Fastify) ──► provider "nacional" ──► Sefin / ADN (mTLS)
 (container)       │   also serves the web build
                   ├──► Signer (Node, or the Python sidecar)
                   └──► SQLite (Docker volume), certificates encrypted at rest
```

## Packages

| Package | Responsibility |
| --- | --- |
| `packages/core` | Domain types and ports. No I/O. |
| `packages/test-kit` | Test-only helpers, such as self-signed e-CNPJ certificates. |
| `packages/signer-node` | Loads a `.pfx` and signs XML (`Signer` port). |
| `packages/provider-nacional` | DPS and event XML, and the Sefin and ADN client. |
| `services/signer-py` | Python `Signer`, kept as plan B. |
| `apps/server` | API, persistence, vault, jobs, authorization (Stage 1a). |
| `apps/web` | UI (Stage 1a). |

## Ports

**`Signer`** signs one element of an XML document by its `Id`, and places the `Signature` right after that element. It has two profiles: `rsa-sha1-c14n` and `rsa-sha256-exc-c14n`. The Stage 0 spike decides which implementation and profile production uses.

**`InvoiceProvider`** (Stage 1a) is what a new invoice system implements: issue, query, sync, cancel, and parse XML into the core model. The national system is the first one.

**`CertificateStore`** (Stage 1a) stores and loads tenant certificates. Each certificate is encrypted with its own data key, and `NFSE_MASTER_KEY` wraps that key.

## Rules that hold across packages

- `core` does not import XML, HTTP, or database code.
- Every XML builder validates against the official XSD in a test.
- mTLS uses the PEM key and certificate from `loadCertificate`, never the raw `.pfx`.
