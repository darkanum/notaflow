# Signer Node: AI Context

Loads a tenant `.pfx` into `CertificateMaterial` and signs XML for the `Signer` port of `@notaflow/core`.

## Quick Reference

- Entry points: `loadCertificate`, `NodeSigner`, `verifyXmlSignature` (`src/index.ts`)
- Depends on: `@notaflow/core`, `node-forge`, `xml-crypto`

## Documentation Index

- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - where the signer sits

## Key Rules

1. Never log or return the PEM strings outside the signer and the mTLS dispatcher.
2. Load the `.pfx` with `node-forge`, never with Node's TLS: OpenSSL 3 refuses legacy RC2 files.
