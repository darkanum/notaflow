# Core: AI Context

The domain types and the ports (interfaces) that every other package implements or consumes. No I/O.

## Quick Reference

- Entry point: `src/index.ts`
- Ports: `Signer` (`src/ports/Signer.ts`), `InvoiceProvider` (`src/ports/InvoiceProvider.ts`, read side). `CertificateStore` arrives in Stage 1a-2.
- Domain: `ProviderInvoice`, `ProviderEvent`, `InvoiceParty` (`src/domain/ProviderInvoice.ts`).
- Depends on: nothing.

## Documentation Index

- [Architecture Overview](../../docs/ENGINEERING/ARCHITECTURE/OVERVIEW.md) - packages and ports

## Key Rules

1. Never import XML, HTTP, database, or Node-only modules here.
