# Server: AI Context

The Fastify API: authentication, accounts and roles, the certificate vault, emitter onboarding, and the audit log. Plan 1a-3 adds the sync job and the read API.

## Quick Reference

- Entry: `src/main.ts` (`pnpm dev:server`); app wiring: `src/app.ts`; config: `src/config.ts`
- Database: `src/db/schema.ts`; migrations in `drizzle/` (`pnpm --filter @notaflow/server exec drizzle-kit generate --name <name>`)
- Tests: `test/testApp.ts` builds the app on an in-memory database, signs Access tokens, and starts the fake national system
- Local run: copy `.env.example` to `.env.local`, then `pnpm fake:nacional`, `pnpm seed:admin <email> <name>`, and `pnpm dev:server`

## Documentation Index

- [Tenancy](../../docs/ENGINEERING/ARCHITECTURE/TENANCY.md) - accounts, roles, guards, and the route sweep
- [ADN Sync](../../docs/ENGINEERING/ARCHITECTURE/SYNC.md) - cursor, retries, and document rules
- [Certificate Vault](../../docs/ENGINEERING/ARCHITECTURE/CERTIFICATE_VAULT.md) - envelope encryption and key rotation
- [RFC](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md) - flows and the security model

## Key Rules

1. Every account query goes through a repository method that takes an `AccountContext`, built only by `accountContext()` in `src/auth/guards.ts`.
2. A new route with a new path parameter must be added to the route sweep (`src/routes/routeSweep.test.ts`).
3. Never log or return a certificate, a password, or the master key.
4. A schema change needs a new migration in the same commit.
