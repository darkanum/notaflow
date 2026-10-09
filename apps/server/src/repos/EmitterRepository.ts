import { randomUUID } from 'node:crypto';
import type { AccountContext, Environment } from '@notaflow/core';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters } from '../db/schema';

export type EmitterRow = typeof emitters.$inferSelect;
export type NewEmitter = Omit<
  typeof emitters.$inferInsert,
  'id' | 'accountId' | 'environment' | 'provider' | 'nextDpsNumber' | 'createdAt'
>;

export class EmitterRepository {
  constructor(private readonly db: Database) {}

  list(ctx: AccountContext): EmitterRow[] {
    return this.db.select().from(emitters).where(eq(emitters.accountId, ctx.accountId)).all();
  }

  get(ctx: AccountContext, emitterId: string): EmitterRow | null {
    return (
      this.db
        .select()
        .from(emitters)
        .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
        .get() ?? null
    );
  }

  findByCnpj(ctx: AccountContext, cnpj: string): EmitterRow | null {
    return (
      this.db
        .select()
        .from(emitters)
        .where(and(eq(emitters.cnpj, cnpj), eq(emitters.accountId, ctx.accountId)))
        .get() ?? null
    );
  }

  // Answers only yes or no, so a caller learns nothing else about the other account.
  isCnpjTakenElsewhere(ctx: AccountContext, cnpj: string): boolean {
    return (
      this.db
        .select({ id: emitters.id })
        .from(emitters)
        .where(and(eq(emitters.cnpj, cnpj), ne(emitters.accountId, ctx.accountId)))
        .get() !== undefined
    );
  }

  create(ctx: AccountContext, input: NewEmitter): EmitterRow {
    return this.db
      .insert(emitters)
      .values({ ...input, id: randomUUID(), accountId: ctx.accountId })
      .returning()
      .get();
  }

  reserveDpsNumber(ctx: AccountContext, emitterId: string): number {
    // One UPDATE ... RETURNING: SQLite runs it atomically, so two requests never get one number.
    const row = this.db
      .update(emitters)
      .set({ nextDpsNumber: sql`${emitters.nextDpsNumber} + 1` })
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .returning({ next: emitters.nextDpsNumber })
      .get();
    if (!row) throw new Error('Emitter not found in this account.');
    return row.next - 1;
  }

  setEnvironment(ctx: AccountContext, emitterId: string, environment: Environment): boolean {
    return (
      this.db
        .update(emitters)
        .set({ environment })
        .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
        .run().changes > 0
    );
  }
}
