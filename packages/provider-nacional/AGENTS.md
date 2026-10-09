# Provider Nacional: AI Context

The national NFS-e system (Sefin Nacional and ADN): builds the DPS and the event XML, and calls the APIs over mTLS.

## Quick Reference

- Entry points: `buildDpsXml`, `buildCancelEventXml`, `NacionalClient`, `createMtlsDispatcher` (`src/index.ts`)
- Schemas: `schemas/` (official XSD, see `schemas/SOURCE.md`)
- Depends on: `@notaflow/core`, `undici`. Tests need Python with `lxml` (`tools/xsd/requirements.txt`).

## Documentation Index

- [RFC: NotaFlow NFS-e Emitter](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md) - flows and API facts
- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - where the provider sits

## Key Rules

1. Every XML builder has a test that validates against the vendored XSD.
2. Update `schemas/` only from the official gov.br zip, and record the URL and date in `schemas/SOURCE.md`.
