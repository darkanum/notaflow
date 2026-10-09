# Fake Nacional: AI Context

An in-memory fake of the Sefin Nacional and the ADN, for local development and tests without a real certificate. It never runs in production.

## Quick Reference

- Entry point: `startFakeNacional` (`src/index.ts`). Run it by hand with `pnpm fake:nacional`.
- Point a client at it: `new NacionalClient({ environment: 'producao_restrita', dispatcher: new Agent(), urls: fake.urls })`.
- Force a scenario: `fake.next('issue', { kind: 'delay', ms: 1000 })`, or `POST /__fake/next` with the same JSON plus `route`.

## Documentation Index

- [Stage 1a-1 plan](../../docs/ENGINEERING/PLANS/2026/10/PLAN_STAGE_1A_1_PROVIDER_READ.md) - why the fake exists and what it mirrors
- [RFC Stage 0 Results](../../docs/ENGINEERING/RFCS/2026/10/RFC_NFSE_EMITTER.md#stage-0-results) - the real behavior it copies

## Key Rules

1. Copy only behavior seen from the real Sefin or ADN, and name the source in the test. Where the real behavior is unknown, say so in a comment.
2. The fake does not check signatures or the XSD. Only produção restrita proves those.
3. It listens on 127.0.0.1 only.
