import type { AccountContext, Environment } from '@notaflow/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters, syncState } from '../db/schema';

export type SyncStateRow = typeof syncState.$inferSelect;

export class SyncStateRepository {
  constructor(private readonly db: Database) {}

  get(ctx: AccountContext, emitterId: string, environment: Environment): SyncStateRow {
    const row = this.db
      .select({ state: syncState })
      .from(syncState)
      .innerJoin(emitters, eq(emitters.id, syncState.emitterId))
      .where(
        and(
          eq(syncState.emitterId, emitterId),
          eq(syncState.environment, environment),
          eq(emitters.accountId, ctx.accountId),
        ),
      )
      .get();
    return (
      row?.state ?? {
        emitterId,
        environment,
        lastNsu: 0,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
      }
    );
  }

  saveCursor(ctx: AccountContext, emitterId: string, environment: Environment, lastNsu: number) {
    this.upsert(ctx, emitterId, environment, { lastNsu });
  }

  recordRun(
    ctx: AccountContext,
    emitterId: string,
    environment: Environment,
    result: { at: Date; error: string | null },
  ): void {
    this.upsert(ctx, emitterId, environment, {
      lastRunAt: result.at,
      lastError: result.error,
      ...(result.error === null ? { lastSuccessAt: result.at } : {}),
    });
  }

  private upsert(
    ctx: AccountContext,
    emitterId: string,
    environment: Environment,
    values: Partial<Omit<SyncStateRow, 'emitterId' | 'environment'>>,
  ): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
    this.db
      .insert(syncState)
      .values({ emitterId, environment, ...values })
      .onConflictDoUpdate({ target: [syncState.emitterId, syncState.environment], set: values })
      .run();
  }
}
